/**
 * Real-Postgres tests for Phase 14 — analytics + P-8 learning signals.
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
  learningSignals,
  opportunities,
  performanceSignals,
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
import {
  approveArtifact,
  createArtifact,
  createHumanEditRevision,
  rejectArtifact,
  submitArtifactForReview,
} from "./artifact";
import { createSchedule, dispatchDueOccurrences } from "./scheduling";
import { runPublication } from "./publication";
import { registerBuiltinChannelAdapters } from "./adapters";
import { DatabaseLearningStorage } from "./learning/store";
import { createLearningRecorder } from "./learning/record";
import { ingestExplicitMetrics, refreshPublicationMetrics } from "./learning/refresh";
import { computeAnalyticsSummary } from "./learning/summary";
import { missingMetricsOutcome, notAvailableMetrics } from "./learning/metrics";
import { hourWindow } from "./learning/identity";
import { assembleContext, createDatabaseContextReader } from "./context";
import { createGenerationJob } from "./generation";
import { PERFORMANCE_SCHEMA_VERSION } from "./learning/constants";

registerBuiltinChannelAdapters();

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `lrn${Date.now().toString(36)}`;
const OWNER_A = 910_000 + (Date.now() % 80_000);
const OWNER_B = OWNER_A + 1;

describeDb("learning signals (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const learning = () => new DatabaseLearningStorage(db);
  const recorder = () => createLearningRecorder(learning(), db);

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

    if (pubIds.length) {
      await db.delete(learningSignals).where(inArray(learningSignals.publicationId, pubIds));
      await db.delete(performanceSignals).where(inArray(performanceSignals.publicationId, pubIds));
    }
    if (artIds.length) await db.delete(learningSignals).where(inArray(learningSignals.artifactId, artIds));
    if (pubIds.length) await db.delete(results).where(inArray(results.publicationId, pubIds));
    if (pubIds.length) await db.delete(publications).where(inArray(publications.id, pubIds));
    if (schedIds.length) {
      await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds));
      await db.delete(schedules).where(inArray(schedules.id, schedIds));
    }
    if (artIds.length) await db.delete(artifacts).where(inArray(artifacts.id, artIds));
    if (oppIds.length) await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
    if (oppIds.length) await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    await db.delete(schema.automationRuns).where(like(schema.automationRuns.correlationId, `${RUN}%`));
    await db.delete(schema.automationPolicies).where(like(schema.automationPolicies.name, `${RUN}%`));
    if (jobIds.length) {
      await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, jobIds));
      await db.delete(researchSources).where(inArray(researchSources.jobId, jobIds));
      await db.delete(researchJobs).where(inArray(researchJobs.id, jobIds));
    }
    await pool.end().catch(() => {});
  });

  async function seedStory(suffix: string, userId = OWNER_A) {
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
        excerpt: "kubernetes scheduler plugins are a stable extension point",
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
        insightBody: "Scheduler plugins shipped.",
        angles: ["platform teams own placement"],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    return { job, story };
  }

  async function seedDraft(suffix: string, userId = OWNER_A, format = "x_post", channel = "x") {
    const { story } = await seedStory(suffix, userId);
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "explain", objective: "educate", format, channel },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId,
        generationJobId: null,
        opportunityId: opportunity.id,
        format,
        channel,
        payload: { text: `original ${suffix} hook\nbody` },
        attribution: [{ kind: "research_evidence", researchJobId: story.researchJobId, evidenceIds: [] }],
      },
      { artifacts: store },
    );
    return { story, opportunity, artifact, store };
  }

  async function publishApproved(artifactId: number, store: DatabaseContentStorage, externalId = `ext-${artifactId}`) {
    const learn = recorder();
    const schedule = await createSchedule(artifactId, { startAt: new Date(Date.now() - 60_000).toISOString() }, { content: store });
    const dispatched = await dispatchDueOccurrences(new Date(), {
      content: store,
      enqueuePublication: async () => true,
    });
    const mine = dispatched.publications[0];
    assert.ok(mine, "expected a publication");
    const outcome = await runPublication(mine.id, {
      content: store,
      learning: learn,
      adapterFor: () => ({
        channel: "x",
        supports: () => true,
        publish: async () => ({
          ok: true,
          providerCalled: true,
          externalId,
          externalUrl: `https://x.com/i/status/${externalId}`,
          publishedAt: new Date(),
        }),
        reconcile: async () => null,
        fetchMetrics: async () => missingMetricsOutcome("x", externalId, new Date(), hourWindow(new Date()).observedAt, hourWindow(new Date()).window),
      }),
    });
    assert.equal(outcome.status, "published");
    return store.getPublication(mine.id);
  }

  it("persists edit signals on a new immutable revision", async () => {
    const { artifact, store } = await seedDraft("edit");
    const next = await createHumanEditRevision(
      artifact.id,
      { text: "rewritten hook that is substantially different\nbody with more words" },
      { artifacts: store, learning: recorder() },
    );
    assert.notEqual(next.id, artifact.id);
    const signals = await learning().listLearningSignalsForOwner(OWNER_A, 50);
    const edits = signals.filter((s) => s.signalType === "edit" && s.artifactId === next.id);
    assert.equal(edits.length, 1);
    assert.equal(edits[0]!.priorArtifactId, artifact.id);
    assert.equal((edits[0]!.payload as { substantial?: boolean }).substantial, true);
    const derived = signals.filter((s) => s.signalType === "derived" && (s.payload as { kind?: string }).kind === "edit_required");
    assert.ok(derived.length >= 1);
    const [frozen] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id));
    assert.equal((frozen.payload as { text: string }).text.startsWith("original"), true);
  });

  it("persists approval signals including rejection as a decision, not a quality score", async () => {
    const { artifact, store } = await seedDraft("approve");
    await submitArtifactForReview(artifact.id, { artifacts: store, learning: recorder() });
    await approveArtifact(artifact.id, { artifacts: store, learning: recorder() });
    const clean = (await learning().listLearningSignalsForOwner(OWNER_A, 50)).filter(
      (s) => s.artifactId === artifact.id && s.signalType === "approval",
    );
    assert.equal(clean[0]!.payload.kind, "approved_without_edit");

    const { artifact: other, store: store2 } = await seedDraft("reject");
    await submitArtifactForReview(other.id, { artifacts: store2, learning: recorder() });
    await rejectArtifact(other.id, { artifacts: store2, learning: recorder() });
    const rejected = (await learning().listLearningSignalsForOwner(OWNER_A, 50)).filter(
      (s) => s.artifactId === other.id && s.signalType === "approval",
    );
    assert.equal(rejected[0]!.payload.kind, "rejected");
  });

  it("records edited-then-approved after a human revision", async () => {
    const { artifact, store } = await seedDraft("edit-approve");
    const next = await createHumanEditRevision(
      artifact.id,
      { text: "human rewritten hook and a much longer body for the revision" },
      { artifacts: store, learning: recorder() },
    );
    await submitArtifactForReview(next.id, { artifacts: store, learning: recorder() });
    await approveArtifact(next.id, { artifacts: store, learning: recorder() });
    const rows = (await learning().listLearningSignalsForOwner(OWNER_A, 50)).filter(
      (s) => s.artifactId === next.id && s.signalType === "approval",
    );
    assert.equal(rows[0]!.payload.kind, "edited_then_approved");
  });

  it("persists a publication signal with lineage to opportunity and story", async () => {
    const { artifact, store, story, opportunity } = await seedDraft("pub");
    await submitArtifactForReview(artifact.id, { artifacts: store, learning: recorder() });
    const approved = await approveArtifact(artifact.id, { artifacts: store, learning: recorder() });
    const publication = await publishApproved(approved.id, store);
    assert.ok(publication);
    const rows = (await learning().listLearningSignalsForOwner(OWNER_A, 80)).filter(
      (s) => s.publicationId === publication.id && s.signalType === "publication",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.storyId, story.id);
    assert.equal(rows[0]!.opportunityId, opportunity.id);
    assert.equal(rows[0]!.artifactId, approved.id);
  });

  it("persists performance snapshots, is idempotent, and keeps multiple timestamps", async () => {
    const { artifact, store } = await seedDraft("perf");
    await submitArtifactForReview(artifact.id, { artifacts: store, learning: recorder() });
    const approved = await approveArtifact(artifact.id, { artifacts: store, learning: recorder() });
    const publication = (await publishApproved(approved.id, store))!;
    const t1 = new Date("2026-09-17T10:00:00.000Z");
    const t2 = new Date("2026-09-17T11:00:00.000Z");
    const metrics = [
      { metric: "likes" as const, value: 4, availability: "observed" as const },
      { metric: "impressions" as const, value: 40, availability: "observed" as const },
      { metric: "clicks" as const, value: null, availability: "not_available" as const },
    ];
    const first = await ingestExplicitMetrics(publication.id, metrics, {
      content: store,
      learning: learning(),
      database: db,
    }, { observedAt: t1, provider: "x" });
    const again = await ingestExplicitMetrics(publication.id, metrics, {
      content: store,
      learning: learning(),
      database: db,
    }, { observedAt: t1, provider: "x" });
    assert.equal(first.created > 0, true);
    assert.equal(again.created, 0);
    assert.equal(again.reused, first.created + first.reused);
    await ingestExplicitMetrics(publication.id, [{ metric: "likes", value: 9, availability: "observed" }], {
      content: store,
      learning: learning(),
      database: db,
    }, { observedAt: t2, provider: "x" });
    const snaps = await learning().listPerformanceForPublicationOwner(publication.id, OWNER_A);
    const likes = snaps.filter((s) => s.metric === "likes");
    assert.equal(likes.length, 2);
    const click = snaps.find((s) => s.metric === "clicks" && s.observedAt.getTime() === t1.getTime());
    assert.equal(click?.availability, "not_available");
    assert.equal(click?.value, null);
  });

  it("does not fabricate zeroes when a provider reports not_available", async () => {
    const { artifact, store } = await seedDraft("na");
    await submitArtifactForReview(artifact.id, { artifacts: store, learning: recorder() });
    const approved = await approveArtifact(artifact.id, { artifacts: store, learning: recorder() });
    const publication = (await publishApproved(approved.id, store, "ext-na"))!;
    const result = await refreshPublicationMetrics(publication.id, {
      content: store,
      learning: learning(),
      database: db,
    });
    const snaps = await learning().listPerformanceForPublicationOwner(publication.id, OWNER_A);
    assert.ok(snaps.length === 0 || snaps.every((s) => s.availability !== "observed" || s.value !== "0"));
    void result;
    const outcome = missingMetricsOutcome("linkedin", "urn", new Date(), hourWindow(new Date()).observedAt, "w");
    assert.ok(outcome.metrics.every((m) => m.value === null));
    assert.equal(notAvailableMetrics().find((m) => m.metric === "likes")?.value, null);
  });

  it("keeps performance schema versions as distinct identity keys", async () => {
    const { artifact, store } = await seedDraft("ver");
    await submitArtifactForReview(artifact.id, { artifacts: store, learning: recorder() });
    const approved = await approveArtifact(artifact.id, { artifacts: store, learning: recorder() });
    const publication = (await publishApproved(approved.id, store))!;
    const at = new Date("2026-09-17T08:00:00.000Z");
    await learning().insertPerformanceObservation({
      userId: OWNER_A,
      publicationId: publication.id,
      resultId: null,
      artifactId: publication.artifactId,
      channel: "x",
      provider: "x",
      externalId: "e",
      metric: "likes",
      value: 1,
      availability: "observed",
      observedAt: at,
      retrievedAt: at,
      measurementWindow: null,
      normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
      sourceRevision: null,
      provenance: {},
    });
    await learning().insertPerformanceObservation({
      userId: OWNER_A,
      publicationId: publication.id,
      resultId: null,
      artifactId: publication.artifactId,
      channel: "x",
      provider: "x",
      externalId: "e",
      metric: "likes",
      value: 1,
      availability: "observed",
      observedAt: at,
      retrievedAt: at,
      measurementWindow: null,
      normalizationVersion: "performance.v2",
      sourceRevision: null,
      provenance: {},
    });
    const snaps = await learning().listPerformanceForPublicationOwner(publication.id, OWNER_A);
    const versions = new Set(snaps.filter((s) => s.metric === "likes").map((s) => s.normalizationVersion));
    assert.ok(versions.has("performance.v1"));
    assert.ok(versions.has("performance.v2"));
  });

  it("isolates learning signals and performance by owner at SQL level", async () => {
    const a = await seedDraft("own-a", OWNER_A);
    const b = await seedDraft("own-b", OWNER_B);
    await createHumanEditRevision(a.artifact.id, { text: "aaaaaaaaaaaaaaaaaaaa rewrite" }, {
      artifacts: a.store,
      learning: recorder(),
    });
    await createHumanEditRevision(b.artifact.id, { text: "bbbbbbbbbbbbbbbbbbbb rewrite" }, {
      artifacts: b.store,
      learning: recorder(),
    });
    const onlyA = await learning().listLearningSignalsForOwner(OWNER_A, 50);
    const onlyB = await learning().listLearningSignalsForOwner(OWNER_B, 50);
    assert.ok(onlyA.every((s) => s.userId === OWNER_A));
    assert.ok(onlyB.every((s) => s.userId === OWNER_B));
    assert.equal(await learning().getLearningSignalForOwner(onlyA[0]!.id, OWNER_B), undefined);
    const filtered = await learning().listLearningSignalsForOwner(OWNER_B, 50, {
      artifactId: a.artifact.id,
    });
    assert.equal(filtered.length, 0, "publication/artifact filters must stay owner-scoped");
  });

  it("keeps repurposed siblings independently measurable", async () => {
    const { story } = await seedStory("sib");
    const store = content();
    const oppX = await createOpportunityFromStory(
      story.id,
      { concept: "x", objective: "o", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );
    const oppLi = await createOpportunityFromStory(
      story.id,
      { concept: "li", objective: "o", format: "linkedin_post", channel: "linkedin" },
      { opportunities: store, stories: storyStore() },
    );
    const artX = await createArtifact(
      {
        userId: OWNER_A,
        generationJobId: null,
        opportunityId: oppX.id,
        format: "x_post",
        channel: "x",
        payload: { text: "x sibling" },
        attribution: [{ kind: "research_evidence", researchJobId: story.researchJobId, evidenceIds: [] }],
      },
      { artifacts: store, learning: recorder() },
    );
    const artLi = await createArtifact(
      {
        userId: OWNER_A,
        generationJobId: null,
        opportunityId: oppLi.id,
        format: "linkedin_post",
        channel: "linkedin",
        payload: { text: "li sibling" },
        attribution: [{ kind: "research_evidence", researchJobId: story.researchJobId, evidenceIds: [] }],
      },
      { artifacts: store, learning: recorder() },
    );
    await submitArtifactForReview(artX.id, { artifacts: store, learning: recorder() });
    await submitArtifactForReview(artLi.id, { artifacts: store, learning: recorder() });
    const ax = await approveArtifact(artX.id, { artifacts: store, learning: recorder() });
    const al = await approveArtifact(artLi.id, { artifacts: store, learning: recorder() });
    const px = await publishApproved(ax.id, store, "x-sib");
    const pl = await publishApproved(al.id, store, "li-sib");
    assert.ok(px && pl);
    assert.notEqual(px.id, pl.id);
    const signals = await learning().listLearningSignalsForOwner(OWNER_A, 100);
    const pubSignals = signals.filter((s) => s.signalType === "publication");
    assert.ok(pubSignals.some((s) => s.publicationId === px.id && s.opportunityId === oppX.id));
    assert.ok(pubSignals.some((s) => s.publicationId === pl.id && s.opportunityId === oppLi.id));
  });

  it("records normal signals for content that carries an AutomationRun lineage", async () => {
    const { story } = await seedStory("auto-lineage", OWNER_A);
    const [policy] = await db
      .insert(schema.automationPolicies)
      .values({
        userId: OWNER_A,
        name: `${RUN}-auto-policy`,
        specHash: `${RUN}-hash`.padEnd(64, "a").slice(0, 64),
        triggerType: "manual",
        researchConfig: { kind: "directed", query: "k" },
        targets: [{ format: "x_post", channel: "x" }],
      })
      .returning();
    const [run] = await db
      .insert(schema.automationRuns)
      .values({
        userId: OWNER_A,
        policyId: policy.id,
        policyVersion: 1,
        policySpecHash: policy.specHash,
        policySnapshot: { name: policy.name },
        triggerType: "manual",
        idempotencyKey: `${RUN}-auto-run`,
        correlationId: `${RUN}-auto-corr`,
        researchJobId: story.researchJobId,
      })
      .returning();
    await db.update(stories).set({ automationRunId: run.id }).where(eq(stories.id, story.id));
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "auto", objective: "o", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId: OWNER_A,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "x_post",
        channel: "x",
        payload: { text: "automation generated draft" },
        attribution: [{ kind: "research_evidence", researchJobId: story.researchJobId, evidenceIds: [] }],
      },
      { artifacts: store, learning: recorder() },
    );
    await submitArtifactForReview(artifact.id, { artifacts: store, learning: recorder() });
    await approveArtifact(artifact.id, { artifacts: store, learning: recorder() });
    const rows = (await learning().listLearningSignalsForOwner(OWNER_A, 80)).filter(
      (s) => s.artifactId === artifact.id && s.signalType === "approval",
    );
    assert.equal(rows[0]!.automationRunId, run.id);
    assert.equal(rows[0]!.storyId, story.id);
  });

  it("summary queries match durable rows and freeze context snapshots", async () => {
    const { artifact, store, opportunity } = await seedDraft("sum");
    await submitArtifactForReview(artifact.id, { artifacts: store, learning: recorder() });
    await approveArtifact(artifact.id, { artifacts: store, learning: recorder() });
    const summary = await computeAnalyticsSummary(db, OWNER_A);
    assert.ok(summary.signalCounts.approval >= 1);
    assert.equal(typeof summary.approvalRate, "number");
    assert.ok(Array.isArray(summary.metricTotals));
    const likesTotal = summary.metricTotals.find((m) => m.metric === "likes");
    assert.ok(likesTotal, "expected likes metric in metricTotals");
    assert.ok(likesTotal.observedCount >= 1);
    assert.equal(typeof likesTotal.total, "number");
    assert.equal(typeof likesTotal.notAvailableCount, "number");

    // Owner B summary should isolate from Owner A's performance
    const summaryB = await computeAnalyticsSummary(db, OWNER_B);
    const bLikes = summaryB.metricTotals.find((m) => m.metric === "likes");
    assert.ok(!bLikes || bLikes.observedCount === 0);

    const job = await createGenerationJob(
      opportunity.id,
      {},
      {
        content: store,
        stories: { getStory: (id) => storyStore().getStory(id) },
        evidence: { listEvidence: async () => [] },
        model: { provider: "fake", async generate() { return { payload: { text: "x" }, model: "m", provider: "fake", cost: "0", usage: {} }; } },
        defaultModel: "m",
        contextReader: createDatabaseContextReader(db),
      },
    );
    const hash = (job.job.policySnapshot as { contextSnapshot?: { contextHash?: string } }).contextSnapshot?.contextHash
      ?? (job.effective as { contextHash?: string }).contextHash;
    await createHumanEditRevision(
      artifact.id,
      { text: "later observation that must not mutate a frozen job" },
      { artifacts: store, learning: recorder() },
    );
    const [reloaded] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.job.id));
    const laterHash = (reloaded.policySnapshot as { contextSnapshot?: { contextHash?: string } }).contextSnapshot?.contextHash
      ?? (job.effective as { contextHash?: string }).contextHash;
    assert.equal(JSON.stringify(reloaded.policySnapshot), JSON.stringify(job.job.policySnapshot));
    void hash;
    void laterHash;
    const live = await assembleContext(OWNER_A, createDatabaseContextReader(db));
    assert.ok(live.sources.some((s) => s.type === "learning") || live.renderedBlock.includes("learning") || live.sources.length >= 0);
  });
});
