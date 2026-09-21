/**
 * Real PostgreSQL tests for the Phase 28.2F Today/Schedule list queries:
 * listArtifactsByOwner, listOccurrencesByOwnerRange, listPublicationsByOwner.
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
  results,
  scheduleOccurrences,
  schedules,
  stories,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { createArtifact, submitArtifactForReview, approveArtifact } from "./artifact";
import { createSchedule, dispatchDueOccurrences } from "./scheduling";
import { runPublication } from "./publication";
import { registerBuiltinChannelAdapters } from "./adapters";

registerBuiltinChannelAdapters();

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `ts${Date.now().toString(36)}`;

describeDb("today/schedule owner-scoped lists (db)", () => {
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
    const rows = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(like(researchJobs.correlationId, `${RUN}%`));
    const jobIds = rows.map((r) => r.id);
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
    const pubRows = schedIds.length
      ? await db.select({ id: publications.id }).from(publications).where(inArray(publications.scheduleId, schedIds))
      : [];
    const pubIds = pubRows.map((r) => r.id);

    if (pubIds.length) await db.delete(results).where(inArray(results.publicationId, pubIds));
    if (pubIds.length) await db.delete(publications).where(inArray(publications.id, pubIds));
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

  async function seedStory(suffix: string, userId: number) {
    const tag = `${RUN}-${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "kubernetes",
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
        excerpt: "today/schedule fixture",
        excerptHash: `${tag}`.padEnd(64, "0").slice(0, 64),
        retrievedAt: new Date(),
      })
      .returning();
    const [story] = await db
      .insert(stories)
      .values({
        userId,
        researchJobId: job.id,
        provenance: "researched",
        title: `${tag} story`,
        insightBody: "fixture",
        angles: ["fixture angle"],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    return { job, story };
  }

  async function seedArtifact(suffix: string, userId: number, readiness: "draft" | "in_review" | "approved") {
    const { story } = await seedStory(suffix, userId);
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "explain", objective: "educate", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "x_post",
        channel: "x",
        payload: { text: `today-schedule fixture ${suffix}` },
        attribution: [{ kind: "research_evidence", researchJobId: story.researchJobId, evidenceIds: [] }],
      },
      { artifacts: store },
    );
    if (readiness === "in_review" || readiness === "approved") {
      await submitArtifactForReview(artifact.id, { artifacts: store });
    }
    if (readiness === "approved") {
      await approveArtifact(artifact.id, { artifacts: store });
    }
    return { story, opportunity, artifact };
  }

  it("listArtifactsByOwner: filters by readiness and never crosses owners", async () => {
    const store = content();
    const mine = await seedArtifact("art-mine", 101, "in_review");
    await seedArtifact("art-theirs", 202, "in_review");

    const mineReview = await store.listArtifactsByOwner(101, { readiness: "in_review", limit: 50 });
    assert.ok(mineReview.some((a) => a.id === mine.artifact.id));
    assert.ok(mineReview.every((a) => a.userId === 101 || a.userId === null));

    const otherOwnerSees = await store.listArtifactsByOwner(202, { readiness: "in_review", limit: 50 });
    assert.ok(!otherOwnerSees.some((a) => a.id === mine.artifact.id));

    const approvedOnly = await store.listArtifactsByOwner(101, { readiness: "approved", limit: 50 });
    assert.ok(!approvedOnly.some((a) => a.id === mine.artifact.id));
  });

  it("listOccurrencesByOwnerRange: returns due occurrences joined with schedule + artifact, owner-scoped", async () => {
    const store = content();
    const { artifact } = await seedArtifact("occ", 303, "approved");
    const schedule = await createSchedule(artifact.id, {}, { content: store });

    const dispatch = await dispatchDueOccurrences(new Date(Date.now() + 1000), {
      content: store,
      enqueuePublication: async () => true,
    });
    const mine = dispatch.publications.find((p) => p.scheduleId === schedule.id);
    assert.ok(mine, "the schedule produced a due occurrence/publication");

    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    const rows = await store.listOccurrencesByOwnerRange(303, from, to, 50);
    assert.ok(rows.some((r) => r.schedule.id === schedule.id && r.artifact.id === artifact.id));

    const otherOwnerRows = await store.listOccurrencesByOwnerRange(999, from, to, 50);
    assert.ok(!otherOwnerRows.some((r) => r.schedule.id === schedule.id));

    const outOfRange = await store.listOccurrencesByOwnerRange(
      303,
      new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      new Date(Date.now() + 11 * 24 * 60 * 60 * 1000),
      50,
    );
    assert.ok(!outOfRange.some((r) => r.schedule.id === schedule.id));
  });

  it("listPublicationsByOwner: filters by state, joins Result, owner-scoped", async () => {
    const store = content();
    const { artifact } = await seedArtifact("pub", 404, "approved");
    const schedule = await createSchedule(artifact.id, {}, { content: store });
    const dispatch = await dispatchDueOccurrences(new Date(Date.now() + 1000), {
      content: store,
      enqueuePublication: async () => true,
    });
    const mine = dispatch.publications.find((p) => p.scheduleId === schedule.id)!;
    assert.ok(mine);

    await runPublication(mine.id, {
      content: store,
      adapterFor: () => ({
        channel: "x",
        supports: () => true,
        publish: async () => ({
          ok: true,
          providerCalled: true,
          externalId: "tweet-today-schedule",
          externalUrl: "https://x.com/i/status/tweet-today-schedule",
          publishedAt: new Date(),
          metrics: {},
        }),
        reconcile: async () => null,
      }),
    });

    const published = await store.listPublicationsByOwner(404, { state: "published", limit: 50 });
    const found = published.find((r) => r.publication.id === mine.id);
    assert.ok(found, "published publication is listed");
    assert.equal(found?.result?.outcome, "published");

    const failedFilter = await store.listPublicationsByOwner(404, { state: "failed", limit: 50 });
    assert.ok(!failedFilter.some((r) => r.publication.id === mine.id));

    const otherOwner = await store.listPublicationsByOwner(999, { limit: 50 });
    assert.ok(!otherOwner.some((r) => r.publication.id === mine.id));
  });
});
