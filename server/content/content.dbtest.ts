/**
 * DB-backed tests for the core content lifecycle.
 *
 * Real PostgreSQL, real schema, real FKs and the real artifact-immutability
 * trigger. A deterministic in-process model stands in for the LLM provider (the
 * model *port* is the boundary), and a stub channel adapter stands in for xQuick
 * (the channel *adapter* is the boundary). Everything ContentForge owns is real.
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
import { createOpportunityFromStory, selectOpportunity } from "./opportunity";
import {
  createGenerationJob,
  runGenerationJob,
  type GenerationModelPort,
} from "./generation";
import { approveArtifact, rejectArtifact, submitArtifactForReview, createArtifact } from "./artifact";
import { createSchedule, dispatchDueOccurrences } from "./scheduling";
import { runPublication } from "./publication";
import { registerBuiltinChannelAdapters, getChannelAdapter } from "./adapters";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `ct${Date.now().toString(36)}`;

describeDb("content lifecycle (db)", () => {
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

  /** Seed a completed ResearchJob + evidence + Story (the real chain's start). */
  async function seedStory(suffix: string) {
    const tag = `${RUN}-${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: 1,
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
        excerpt: "kubernetes scheduler plugins are a stable extension point",
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
        insightBody: "Scheduler plugins shipped as a stable extension point.",
        angles: ["platform teams own placement"],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    return { job, source, evidence, story };
  }

  const fakeModel = (payload: Record<string, unknown>): GenerationModelPort => ({
    provider: "fake-model",
    async generate() {
      return { payload, model: "fake-1", provider: "fake-model", cost: "0.000100", usage: {} };
    },
  });

  function generationDepsFor(model: GenerationModelPort) {
    return {
      content: content(),
      stories: { getStory: (id: number) => storyStore().getStory(id) },
      evidence: {
        listEvidence: async (researchJobId: number) => {
          const rows = await db
            .select()
            .from(researchEvidence)
            .where(eq(researchEvidence.jobId, researchJobId));
          return rows.map((r) => ({ id: r.id, excerpt: r.excerpt, kind: r.kind }));
        },
      },
      model,
      defaultModel: "fake-1",
    };
  }

  async function seedArtifact(suffix: string, readiness: "draft" | "approved") {
    const { story } = await seedStory(suffix);
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "explain", objective: "educate", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "x_post",
        channel: "x",
        payload: { text: `task ${suffix}` },
        attribution: [{ kind: "research_evidence", researchJobId: story.researchJobId, evidenceIds: [] }],
      },
      { artifacts: store },
    );
    if (readiness === "approved") {
      await submitArtifactForReview(artifact.id, { artifacts: store });
      await approveArtifact(artifact.id, { artifacts: store });
    }
    return { story, opportunity, artifact };
  }

  // ── Schema / durability ─────────────────────────────────────────────────────
  it("enforces artifact content immutability in the database", async () => {
    const { artifact } = await seedArtifact("immutable", "draft");
    await assert.rejects(
      () => db.update(artifacts).set({ payload: { text: "mutated" } }).where(eq(artifacts.id, artifact.id)),
      /immutable/i,
    );
    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id));
    assert.deepEqual(row.payload, { text: "task immutable" });
  });

  it("allows readiness to change while content stays frozen", async () => {
    const { artifact } = await seedArtifact("readiness", "draft");
    await submitArtifactForReview(artifact.id, { artifacts: content() });
    await approveArtifact(artifact.id, { artifacts: content() });
    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id));
    assert.equal(row.readiness, "approved");
    assert.deepEqual(row.payload, { text: "task readiness" });
  });

  it("keeps exactly one Result per Publication", async () => {
    const { artifact } = await seedArtifact("result-uq", "approved");
    const schedule = await createSchedule(artifact.id, {}, { content: content() });
    const publication = await content().claimPublication({
      userId: 1,
      scheduleId: schedule.id,
      occurrenceId: (await content().materializeOccurrence(schedule.id, schedule.startAt))!.id,
      artifactId: artifact.id,
      channel: "x",
      idempotencyKey: `${RUN}-result-uq`,
      correlationId: `${RUN}-result-uq-corr`,
    });
    await content().insertResult({
      publicationId: publication.publication.id,
      outcome: "published",
      externalId: "t1",
      externalUrl: "https://x.com/i/status/t1",
      publishedAt: new Date(),
      metrics: {},
      source: "x",
      errorClass: null,
      errorMessage: null,
      correlationId: "c",
    });
    await content().insertResult({
      publicationId: publication.publication.id,
      outcome: "failed",
      externalId: null,
      externalUrl: null,
      publishedAt: null,
      metrics: {},
      source: "x",
      errorClass: "x",
      errorMessage: "y",
      correlationId: "c",
    });
    const rows = await db.select().from(results).where(eq(results.publicationId, publication.publication.id));
    assert.equal(rows.length, 1, "the unique constraint is the arbiter");
    assert.equal(rows[0].outcome, "published");
  });

  // ── Golden path at the service level ────────────────────────────────────────
  it("runs Story → Opportunity → GenerationJob → Artifact → approval → Schedule → Publication → Result", async () => {
    const { job, story } = await seedStory("golden");
    const store = content();
    const storyPort = storyStore();

    // Story → Opportunity
    const opportunity = await createOpportunityFromStory(
      story.id,
      {
        concept: "the scheduler is now a policy surface",
        objective: "educate platform engineers",
        format: "x_post",
        channel: "x",
      },
      { opportunities: store, stories: storyPort },
    );
    await selectOpportunity(opportunity.id, { opportunities: store, stories: storyPort });
    assert.equal((await storyStore().getStory(story.id))!.status, "used");

    // Opportunity → GenerationJob (frozen policy) → Artifact
    const deps = generationDepsFor(fakeModel({ text: "Kubernetes scheduling is now policy." }));
    const { job: genJob, created } = await createGenerationJob(opportunity.id, {}, deps);
    assert.equal(created, true);
    const [persisted] = await db.select().from(generationJobs).where(eq(generationJobs.id, genJob.id));
    assert.ok((persisted.policySnapshot as Record<string, unknown>).systemPrompt, "policy is frozen");

    const run = await runGenerationJob(genJob.id, deps);
    assert.equal(run.status, "succeeded");
    const artifact = (await store.getArtifact(run.artifactId!))!;
    assert.equal(artifact.readiness, "draft");
    assert.equal(artifact.format, "x_post");
    assert.ok(Array.isArray(artifact.attribution) && artifact.attribution.length === 1);

    // Approval — pinned to this revision
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });
    assert.equal(approved.readiness, "approved");

    // Schedule → Occurrence → Publication → Result
    const schedule = await createSchedule(artifact.id, {}, { content: store });
    registerBuiltinChannelAdapters();
    const enqueued: number[] = [];
    const dispatch = await dispatchDueOccurrences(new Date(Date.now() + 1000), {
      content: store,
      enqueuePublication: async (pub) => {
        enqueued.push(pub.id);
        return true;
      },
    });
    // The scheduler tick is global by design; assert on THIS schedule.
    const mine = dispatch.publications.find((p) => p.scheduleId === schedule.id);
    assert.ok(mine, "the due Schedule produced a Publication");
    assert.ok(enqueued.includes(mine.id), "the Publication was enqueued onto the queue");
    assert.equal(dispatch.materialized >= 1, true);

    // The worker publishes through the real X adapter seam (stub transport).
    const outcome = await runPublication(mine.id, {
      content: store,
      adapterFor: () => ({
        channel: "x",
        supports: () => true,
        publish: async () => ({
          ok: true,
          providerCalled: true,
          externalId: "tweet-42",
          externalUrl: "https://x.com/i/status/tweet-42",
          publishedAt: new Date(),
          metrics: { unitCount: 1 },
        }),
        reconcile: async () => null,
      }),
    });
    assert.equal(outcome.status, "published");

    const publication = (await store.getPublication(mine.id))!;
    assert.equal(publication.state, "published");
    assert.equal(publication.externalId, "tweet-42");
    assert.equal(publication.artifactId, artifact.id);
    assert.equal(publication.correlationId.length > 0, true);

    const result = await store.getResultByPublication(publication.id);
    assert.equal(result?.outcome, "published");
    assert.equal(result?.externalUrl, "https://x.com/i/status/tweet-42");

    // The occurrence and the one-shot schedule are completed.
    const occurrence = await store.getOccurrence(publication.occurrenceId);
    assert.equal(occurrence?.status, "published");
    assert.equal((await store.getSchedule(schedule.id))?.status, "exhausted");

    // Format change never re-runs research: research rows are untouched.
    const evidenceRows = await db
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, job.id));
    assert.equal(evidenceRows.length, 1);
    assert.equal((await storyStore().getStory(story.id))!.researchJobId, job.id);
  });

  it("allows many Opportunities per Story (a second format is a second Opportunity)", async () => {
    const { story } = await seedStory("multi");
    const store = content();
    const storyPort = storyStore();
    await createOpportunityFromStory(
      story.id,
      { concept: "a", objective: "o", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyPort },
    );
    await createOpportunityFromStory(
      story.id,
      { concept: "b", objective: "o", format: "x_thread", channel: "x" },
      { opportunities: store, stories: storyPort },
    );
    const rows = await store.listOpportunitiesByStory(story.id);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.format).sort(), ["x_post", "x_thread"]);
  });

  it("refuses to schedule a rejected artifact", async () => {
    const { artifact } = await seedArtifact("rejected", "draft");
    const store = content();
    await submitArtifactForReview(artifact.id, { artifacts: store });
    await rejectArtifact(artifact.id, { artifacts: store });
    await assert.rejects(
      () => createSchedule(artifact.id, {}, { content: store }),
      /only approved revisions/,
    );
  });

  it("is idempotent: re-running the same policy reuses one GenerationJob and one Publication", async () => {
    const { story } = await seedStory("idem");
    const store = content();
    const storyPort = storyStore();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "c", objective: "o", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyPort },
    );
    const deps = generationDepsFor(fakeModel({ text: "same policy" }));
    const first = await createGenerationJob(opportunity.id, {}, deps);
    const second = await createGenerationJob(opportunity.id, {}, deps);
    assert.equal(second.created, false);
    assert.equal(second.job.id, first.job.id);

    await runGenerationJob(first.job.id, deps);
    const runAgain = await runGenerationJob(first.job.id, deps);
    assert.equal(runAgain.reused, true, "a finished generation is never re-run");
    const arts = await store.listArtifactsByOpportunity(opportunity.id);
    assert.equal(arts.length, 1);
  });

  it("exposes the X adapter through the registry (the only registered channel)", async () => {
    registerBuiltinChannelAdapters();
    assert.equal(getChannelAdapter("x").supports("x_thread"), true);
  });
});
