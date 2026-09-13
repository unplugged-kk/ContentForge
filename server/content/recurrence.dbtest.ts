/**
 * DB-backed tests for Phase 4 recurrence: durable persistence, the
 * `(schedule_id, occurrence_time)` unique constraint as the concurrency
 * arbiter, one-slot-per-tick catch-up, exhaustion, restart-equivalent
 * recovery, and the one-shot regression — against real PostgreSQL.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import {
  artifacts,
  generationJobs,
  opportunities,
  publications,
  researchEvidence,
  researchJobs,
  researchSources,
  scheduleOccurrences,
  schedules,
  stories,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { approveArtifact, createArtifact, submitArtifactForReview } from "./artifact";
import { createSchedule, dispatchDueOccurrences, ScheduleInputError } from "./scheduling";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `rc${Date.now().toString(36)}`;

describeDb("recurrence (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
  });

  after(async () => {
    if (!CONNECTION) return;
    const jobRows = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(like(researchJobs.correlationId, `${RUN}%`));
    const jobIds = jobRows.map((r) => r.id);
    const storyRows = jobIds.length
      ? await db.select({ id: stories.id }).from(stories).where(inArray(stories.researchJobId, jobIds))
      : [];
    const storyIds = storyRows.map((r) => r.id);
    const oppRows = storyIds.length
      ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.storyId, storyIds))
      : [];
    const oppIds = oppRows.map((r) => r.id);
    const artRows = oppIds.length
      ? await db.select({ id: artifacts.id }).from(artifacts).where(inArray(artifacts.opportunityId, oppIds))
      : [];
    const artIds = artRows.map((r) => r.id);
    const schedRows = artIds.length
      ? await db.select({ id: schedules.id }).from(schedules).where(inArray(schedules.artifactId, artIds))
      : [];
    const schedIds = schedRows.map((r) => r.id);

    if (schedIds.length) await db.delete(publications).where(inArray(publications.scheduleId, schedIds));
    if (schedIds.length)
      await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds));
    if (schedIds.length) await db.delete(schedules).where(inArray(schedules.id, schedIds));
    if (artIds.length) await db.delete(artifacts).where(inArray(artifacts.id, artIds));
    if (oppIds.length) await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
    if (oppIds.length) await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    if (jobIds.length) await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, jobIds));
    if (jobIds.length) await db.delete(researchSources).where(inArray(researchSources.jobId, jobIds));
    if (jobIds.length) await db.delete(researchJobs).where(inArray(researchJobs.id, jobIds));
    await pool.end().catch(() => {});
  });

  async function seedApprovedArtifact(suffix: string) {
    const tag = `${RUN}-${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: 1,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "recurrence",
        status: "complete",
        providerIds: ["rss"],
        finishedAt: new Date(),
      })
      .returning();
    const [source] = await db
      .insert(researchSources)
      .values({
        jobId: job.id,
        provider: "rss",
        backend: "rss-parser",
        kind: "article",
        nativeId: `${tag}-src`,
        canonicalUrl: `https://example.com/${tag}`,
        contentHash: "a".repeat(64),
        retrievedAt: new Date(),
      })
      .returning();
    const [evidence] = await db
      .insert(researchEvidence)
      .values({
        jobId: job.id,
        sourceId: source.id,
        kind: "excerpt",
        origin: "sourced",
        excerpt: "recurring schedules stay a durable extension of the primitive",
        excerptHash: `${tag}`.padEnd(64, "0").slice(0, 64),
        retrievedAt: new Date(),
      })
      .returning();
    const [story] = await db
      .insert(stories)
      .values({
        userId: 1,
        researchJobId: job.id,
        provenance: "researched",
        title: `${tag} story`,
        insightBody: "Recurrence is a derived cursor, not a mutable one.",
        angles: [],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "recurrence", objective: "educate", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "x_post",
        channel: "x",
        payload: { text: `recurring post ${suffix}` },
        attribution: [{ kind: "research_evidence", researchJobId: job.id, evidenceIds: [] }],
      },
      { artifacts: store },
    );
    await submitArtifactForReview(artifact.id, { artifacts: store });
    return approveArtifact(artifact.id, { artifacts: store });
  }

  it("rejects malformed recurrence and never inserts a Schedule row", async () => {
    const artifact = await seedApprovedArtifact("bad-recurrence");
    await assert.rejects(
      () => createSchedule(artifact.id, { recurrence: "daily", count: 3 }, { content: content() }),
      ScheduleInputError,
    );
    const rows = await db.select().from(schedules).where(eq(schedules.artifactId, artifact.id));
    assert.equal(rows.length, 0, "an invalid schedule must never be persisted");
  });

  it("persists a recurring Schedule and advances the durable occurrence cursor", async () => {
    const artifact = await seedApprovedArtifact("advance");
    const startAt = new Date(Date.now() - 5000);
    const schedule = await createSchedule(
      artifact.id,
      { recurrence: "every:1h", count: 3, startAt: startAt.toISOString() },
      { content: content() },
    );
    assert.equal(schedule.recurrence, "every:1h");
    assert.equal(schedule.count, 3);

    const store = content();
    const now = new Date(startAt.getTime() + 10_000); // only slot 0 due
    await dispatchDueOccurrences(now, { content: store, enqueuePublication: async () => true });

    const occRows = await db
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.scheduleId, schedule.id));
    assert.equal(occRows.length, 1, "only the due slot materializes, not the whole series");
    assert.equal(occRows[0].occurrenceTime.getTime(), startAt.getTime());

    // Series not exhausted — schedule stays active.
    const [row] = await db.select().from(schedules).where(eq(schedules.id, schedule.id));
    assert.equal(row.status, "active");
  });

  it("catches up one slot per tick after a long offline period, bounded by count, then exhausts", async () => {
    const artifact = await seedApprovedArtifact("catchup");
    const startAt = new Date(Date.now() - 10 * 3_600_000); // 10 hours ago
    const schedule = await createSchedule(
      artifact.id,
      { recurrence: "every:1h", count: 2, startAt: startAt.toISOString() },
      { content: content() },
    );
    const store = content();
    const now = new Date(); // both slots are long overdue

    await dispatchDueOccurrences(now, { content: store, enqueuePublication: async () => true });
    let occRows = await db
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.scheduleId, schedule.id));
    assert.equal(occRows.length, 1, "one slot per tick even with many slots overdue");

    await dispatchDueOccurrences(now, { content: store, enqueuePublication: async () => true });
    occRows = await db.select().from(scheduleOccurrences).where(eq(scheduleOccurrences.scheduleId, schedule.id));
    assert.equal(occRows.length, 2, "the second tick catches up the remaining slot");

    const [row] = await db.select().from(schedules).where(eq(schedules.id, schedule.id));
    assert.equal(row.status, "exhausted", "series is exhausted once count is reached");

    // A third tick (simulating restart/re-run) must not over-materialize.
    await dispatchDueOccurrences(now, { content: store, enqueuePublication: async () => true });
    occRows = await db.select().from(scheduleOccurrences).where(eq(scheduleOccurrences.scheduleId, schedule.id));
    assert.equal(occRows.length, 2, "exhausted series never grows past count, even re-run");
  });

  it("concurrent ticks on the same recurring schedule never double-materialize a slot (DB unique constraint)", async () => {
    const artifact = await seedApprovedArtifact("concurrent");
    const startAt = new Date(Date.now() - 1000);
    const schedule = await createSchedule(
      artifact.id,
      { recurrence: "every:1h", count: 5, startAt: startAt.toISOString() },
      { content: content() },
    );
    const store = content();
    const now = new Date();

    await Promise.all([
      dispatchDueOccurrences(now, { content: store, enqueuePublication: async () => true }),
      dispatchDueOccurrences(now, { content: store, enqueuePublication: async () => true }),
      dispatchDueOccurrences(now, { content: store, enqueuePublication: async () => true }),
    ]);

    const occRows = await db
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.scheduleId, schedule.id));
    assert.equal(occRows.length, 1, "the unique (schedule_id, occurrence_time) index is the sole arbiter");
  });

  it("restart-equivalent recovery: a fresh storage instance resumes the same recurrence cursor", async () => {
    const artifact = await seedApprovedArtifact("restart");
    const startAt = new Date(Date.now() - 3_600_000 - 1000);
    const schedule = await createSchedule(
      artifact.id,
      { recurrence: "every:1h", count: 2, startAt: startAt.toISOString() },
      { content: content() },
    );

    // "Process restart": a brand-new DatabaseContentStorage over the same pool,
    // no in-memory state carried over.
    const firstProcess = content();
    await dispatchDueOccurrences(new Date(), {
      content: firstProcess,
      enqueuePublication: async () => true,
    });

    const restartedProcess = content();
    await dispatchDueOccurrences(new Date(), {
      content: restartedProcess,
      enqueuePublication: async () => true,
    });

    const occRows = await db
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.scheduleId, schedule.id))
      .orderBy(scheduleOccurrences.occurrenceTime);
    assert.equal(occRows.length, 2, "both slots materialized across the simulated restart");
    assert.equal(occRows[1].occurrenceTime.getTime() - occRows[0].occurrenceTime.getTime(), 3_600_000);
  });

  it("regression: one-shot scheduling is unaffected by the recurrence code path", async () => {
    const artifact = await seedApprovedArtifact("one-shot");
    const startAt = new Date(Date.now() - 1000);
    const schedule = await createSchedule(artifact.id, { startAt: startAt.toISOString() }, { content: content() });
    assert.equal(schedule.recurrence, null);
    assert.equal(schedule.count, 1);

    const store = content();
    await dispatchDueOccurrences(new Date(), { content: store, enqueuePublication: async () => true });
    const occRows = await db
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.scheduleId, schedule.id));
    assert.equal(occRows.length, 1);

    const [row] = await db.select().from(schedules).where(eq(schedules.id, schedule.id));
    assert.equal(row.status, "exhausted", "a one-shot's single occurrence exhausts the series");

    // Re-run must not create a second occurrence for a one-shot either.
    await dispatchDueOccurrences(new Date(), { content: store, enqueuePublication: async () => true });
    const occRows2 = await db
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.scheduleId, schedule.id));
    assert.equal(occRows2.length, 1);
  });
});
