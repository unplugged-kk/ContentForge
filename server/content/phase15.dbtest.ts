/**
 * DB-backed tests for Phase 1.5 hardening:
 *  - voice/template immutable revisions (keys + versions)
 *  - policy snapshot stability when a voice/template changes afterwards
 *  - artifact human revision workflow + revision-pinned publications
 *  - scheduler tick durability / duplicate-dispatch safety
 *  - chat idempotency + explicit regeneration
 *
 * Real PostgreSQL. Requires TEST_DATABASE_URL (skipped otherwise).
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
  contentTemplates,
  generationJobs,
  generationPolicies,
  opportunities,
  publications,
  results,
  scheduleOccurrences,
  schedules,
  stories,
  voices,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { createGenerationJob, runGenerationJob, type GenerationModelPort } from "./generation";
import { approveArtifact, createHumanEditRevision, getArtifactHistory, submitArtifactForReview } from "./artifact";
import {
  createSchedule,
  dispatchDueOccurrences,
  publicationIdempotencyKey,
  ScheduleInputError,
} from "./scheduling";
import { runPublication } from "./publication";
import { createTemplate, createVoice, reviseVoice, reviseTemplate } from "./authoring";
import { handleChatRequest } from "./chat";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `p15${Date.now().toString(36)}`;

describeDb("phase 1.5 hardening (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);

  function fakeModel(): GenerationModelPort {
    return {
      provider: "fake-model",
      async generate(request) {
        const payload =
          request.format === "x_thread"
            ? { units: ["Hook", "Takeaway"] }
            : { text: "A generated post." };
        return { payload, model: "fake-1", provider: "fake-model", cost: null, usage: {} };
      },
    };
  }

  function generationDepsFor(model: GenerationModelPort) {
    return {
      content: content(),
      stories: { getStory: (id: number) => storyStore().getStory(id) },
      evidence: { listEvidence: async () => [] },
      model,
      defaultModel: "fake-1",
    };
  }

  async function seedOpportunity(suffix: string, format = "x_post") {
    const [story] = await db
      .insert(stories)
      .values({
        userId: 1,
        researchJobId: null,
        provenance: "human",
        title: `${RUN}-${suffix} story`,
        insightBody: "Scheduler plugins shipped as a stable extension point.",
        angles: [],
        evidenceRefs: [],
        status: "ready",
      })
      .returning();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "explain", objective: "educate", format, channel: "x" },
      { opportunities: content(), stories: storyStore() },
    );
    return { story, opportunity };
  }

  async function generateArtifact(opportunityId: number, model = fakeModel()) {
    const deps = generationDepsFor(model);
    const { job } = await createGenerationJob(opportunityId, {}, deps);
    const run = await runGenerationJob(job.id, deps);
    assert.equal(run.status, "succeeded");
    return run.artifactId!;
  }

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
  });

  after(async () => {
    if (!CONNECTION) return;
    const storyRows = await db
      .select({ id: stories.id })
      .from(stories)
      .where(like(stories.title, `${RUN}%`));
    const storyIds = storyRows.map((r) => r.id);
    const oppRows = storyIds.length
      ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.storyId, storyIds))
      : [];
    const oppIds = oppRows.map((r) => r.id);
    const artRows = oppIds.length
      ? await db.select({ id: artifacts.id }).from(artifacts).where(inArray(artifacts.opportunityId, oppIds))
      : [];
    const artIds = artRows.map((r) => r.id);
    const genRows = oppIds.length
      ? await db.select({ id: generationJobs.id }).from(generationJobs).where(inArray(generationJobs.opportunityId, oppIds))
      : [];
    const genIds = genRows.map((r) => r.id);
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
    if (schedIds.length) await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds));
    if (schedIds.length) await db.delete(schedules).where(inArray(schedules.id, schedIds));
    if (artIds.length) await db.delete(artifacts).where(inArray(artifacts.id, artIds));
    if (genIds.length) await db.delete(generationJobs).where(inArray(generationJobs.id, genIds));
    if (oppIds.length) await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    await db.delete(generationPolicies).where(like(generationPolicies.policyKey, "pol:%"));
    await db.delete(voices).where(like(voices.name, `${RUN}%`));
    await db.delete(contentTemplates).where(like(contentTemplates.name, `${RUN}%`));
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    await pool.end().catch(() => {});
  });

  // ── Voice / template versioning ─────────────────────────────────────────────
  it("persists voice revisions under one key and keeps the prior revision immutable", async () => {
    const store = content();
    const v1 = await createVoice(1, { name: `${RUN} voice`, tone: "technical" }, { content: store });
    const v2 = await reviseVoice(v1.id, { tone: "warmer" }, { content: store });

    assert.equal(v2.voiceKey, v1.voiceKey);
    assert.equal(v2.version, 2);
    const [row1] = await db.select().from(voices).where(eq(voices.id, v1.id));
    assert.equal(row1.tone, "technical", "revision 1 is unchanged");
    const revisions = await store.listVoicesByKey(v2.voiceKey!);
    assert.deepEqual(revisions.map((r) => r.version), [1, 2]);
  });

  it("persists template revisions and rejects a duplicate (key, version)", async () => {
    const store = content();
    const t1 = await createTemplate(1, { name: `${RUN} template`, structure: [{ text: "hook" }] }, { content: store });
    const t2 = await reviseTemplate(t1.id, { instructions: "tight" }, { content: store });
    assert.equal(t2.templateKey, t1.templateKey);
    assert.equal(t2.version, 2);

    await assert.rejects(() =>
      db.insert(contentTemplates).values({
        templateKey: t1.templateKey!,
        version: 2,
        name: "duplicate",
      }),
    );
  });

  // ── The critical policy-snapshot invariant ──────────────────────────────────
  it("changing a Voice after a GenerationJob exists does not change that job's snapshot", async () => {
    const { opportunity } = await seedOpportunity("voicesnap");
    const store = content();
    const voice = await createVoice(1, { name: `${RUN} voiceA`, tone: "direct" }, { content: store });

    const deps = generationDepsFor(fakeModel());
    const { job } = await createGenerationJob(opportunity.id, { voiceId: voice.id }, deps);
    const snapshotBefore = JSON.stringify(job.policySnapshot);
    assert.match(snapshotBefore, /direct/);

    // Edit the voice afterwards (a NEW revision under the same key).
    const voiceV2 = await reviseVoice(voice.id, { tone: "warm and reflective" }, { content: store });

    const [persisted] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id));
    assert.equal(JSON.stringify(persisted.policySnapshot), snapshotBefore, "the frozen request is stable");

    // A NEW generation that selects the new revision does pick it up.
    const later = await createGenerationJob(opportunity.id, { voiceId: voiceV2.id, regenerate: true }, deps);
    assert.notEqual(later.job.policyId, job.policyId);
    assert.match(JSON.stringify(later.job.policySnapshot), /warm and reflective/);
  });

  // ── Artifact human revision workflow ────────────────────────────────────────
  it("human edit creates a new revision; approval does not carry; publications stay pinned", async () => {
    const { opportunity } = await seedOpportunity("humanedit");
    const store = content();
    const artifactV1 = await generateArtifact(opportunity.id);

    // Approve revision 1.
    await submitArtifactForReview(artifactV1, { artifacts: store });
    const approvedV1 = await approveArtifact(artifactV1, { artifacts: store });
    assert.equal(approvedV1.readiness, "approved");

    // Pin revision 1 in a publication via a schedule + dispatch.
    const schedule = await createSchedule(artifactV1, {}, { content: store });
    const enqueued: number[] = [];
    await dispatchDueOccurrences(new Date(Date.now() + 1000), {
      content: store,
      enqueuePublication: async (p) => {
        enqueued.push(p.id);
        return true;
      },
    });
    assert.equal(enqueued.length, 1);
    const [pubV1] = await db.select().from(publications).where(eq(publications.id, enqueued[0]));
    assert.equal(pubV1.artifactId, artifactV1, "publication pins the exact revision");

    // Human edit → revision 2.
    const artifactV2 = await createHumanEditRevision(
      artifactV1,
      { text: "A hand-edited post." },
      { artifacts: store },
      { attributionReason: "human edit" },
    );
    assert.equal(artifactV2.supersedesId, artifactV1);
    assert.equal(artifactV2.readiness, "draft", "approval is NOT carried to the new revision");
    assert.equal(artifactV2.provenance, "human_edit");

    // Revision 1 is untouched.
    const [rowV1] = await db.select().from(artifacts).where(eq(artifacts.id, artifactV1));
    assert.equal(rowV1.readiness, "approved");
    assert.deepEqual(rowV1.payload, { text: "A generated post." });

    // The old publication still points at revision 1.
    const [still] = await db.select().from(publications).where(eq(publications.id, pubV1.id));
    assert.equal(still.artifactId, artifactV1);

    // Revision 2 is independently approvable and can be published.
    await submitArtifactForReview(artifactV2.id, { artifacts: store });
    const approvedV2 = await approveArtifact(artifactV2.id, { artifacts: store });
    assert.equal(approvedV2.readiness, "approved");
    const schedule2 = await createSchedule(artifactV2.id, {}, { content: store });
    const occurrence2 = (await store.materializeOccurrence(schedule2.id, schedule2.startAt))!;
    const pub2 = await store.claimPublication({
      scheduleId: schedule2.id,
      occurrenceId: occurrence2.id,
      artifactId: artifactV2.id,
      channel: "x",
      // Canonical identity, so a later scheduler tick recognises it as existing.
      idempotencyKey: publicationIdempotencyKey({
        scheduleId: schedule2.id,
        occurrenceId: occurrence2.id,
        artifactId: artifactV2.id,
      }),
      correlationId: `${RUN}-pub2-corr`,
    });
    assert.equal(pub2.publication.artifactId, artifactV2.id, "revision 2 can be published");
    assert.notEqual(pub2.publication.artifactId, pubV1.artifactId);

    // History is the full chain, oldest first.
    const history = await getArtifactHistory(artifactV2.id, { artifacts: store });
    assert.deepEqual(history.map((a) => a.id), [artifactV1, artifactV2.id]);
  });

  it("rejects an invalid human-edit payload without creating a revision", async () => {
    const { opportunity } = await seedOpportunity("badedit");
    const store = content();
    const artifact = await generateArtifact(opportunity.id);
    const before = await store.listArtifactsByOpportunity(opportunity.id);
    await assert.rejects(
      () => createHumanEditRevision(artifact, { units: [] }, { artifacts: store }, { attributionReason: "bad" }),
      /payload/i,
    );
    const after = await store.listArtifactsByOpportunity(opportunity.id);
    assert.equal(after.length, before.length, "no corrupt revision was created");
  });

  // ── Scheduler tick durability ───────────────────────────────────────────────
  it("a scheduler tick enqueues exactly one publication for a due occurrence, even across overlapping ticks", async () => {
    const { opportunity } = await seedOpportunity("tick");
    const store = content();
    const artifact = await generateArtifact(opportunity.id);
    await submitArtifactForReview(artifact, { artifacts: store });
    await approveArtifact(artifact, { artifacts: store });
    const schedule = await createSchedule(artifact, {}, { content: store });

    const enqueued: number[] = [];
    const deps = {
      content: store,
      enqueuePublication: async (p: { id: number }) => {
        enqueued.push(p.id);
        return true;
      },
    };
    const when = new Date(Date.now() + 1000);
    const [a, b] = await Promise.all([
      dispatchDueOccurrences(when, deps),
      dispatchDueOccurrences(when, deps),
    ]);

    assert.equal(
      a.enqueued + b.enqueued,
      1,
      `two overlapping ticks produce one effective publication (a=${a.enqueued}, b=${b.enqueued})`,
    );
    assert.equal(enqueued.length, 1);
    const rows = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    assert.equal(rows.length, 1);

    // Re-ticking is a no-op (durable state, not in-memory).
    const third = await dispatchDueOccurrences(when, deps);
    assert.equal(third.enqueued, 0);
    const after = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    assert.equal(after.length, 1);
  });

  it("scheduler state survives a process boundary (nothing in memory)", async () => {
    const { opportunity } = await seedOpportunity("durable");
    const store = content();
    const artifact = await generateArtifact(opportunity.id);
    await submitArtifactForReview(artifact, { artifacts: store });
    await approveArtifact(artifact, { artifacts: store });
    const schedule = await createSchedule(artifact, {}, { content: store });

    // A brand-new storage instance (fresh "process") sees the same durable state.
    const fresh = new DatabaseContentStorage(db);
    const enqueued: number[] = [];
    const result = await dispatchDueOccurrences(new Date(Date.now() + 1000), {
      content: fresh,
      enqueuePublication: async (p) => {
        enqueued.push(p.id);
        return true;
      },
    });
    assert.equal(result.enqueued, 1);
    const occurrence = await fresh.getOccurrenceByScheduleTime(schedule.id, schedule.startAt);
    assert.equal(occurrence?.status, "enqueued", "occurrence state is durable");
  });

  it("publication worker publishes through the adapter and records one Result", async () => {
    const { opportunity } = await seedOpportunity("pubworker");
    const store = content();
    const artifact = await generateArtifact(opportunity.id);
    await submitArtifactForReview(artifact, { artifacts: store });
    await approveArtifact(artifact, { artifacts: store });
    await createSchedule(artifact, {}, { content: store });

    const enqueued: number[] = [];
    await dispatchDueOccurrences(new Date(Date.now() + 1000), {
      content: store,
      enqueuePublication: async (p) => {
        enqueued.push(p.id);
        return true;
      },
    });

    const outcome = await runPublication(enqueued[0], {
      content: store,
      adapterFor: () => ({
        channel: "x",
        supports: () => true,
        publish: async () => ({
          ok: true,
          providerCalled: true,
          externalId: "tweet-9",
          externalUrl: "https://x.com/cf/status/tweet-9",
          publishedAt: new Date(),
          metrics: {},
        }),
        reconcile: async () => null,
      }),
    });
    assert.equal(outcome.status, "published");
    const result = await store.getResultByPublication(enqueued[0]);
    assert.equal(result?.outcome, "published");
  });

  // ── Recurrence: explicit, not faked ─────────────────────────────────────────
  it("keeps recurrence explicitly rejected rather than faking an expansion", async () => {
    const { opportunity } = await seedOpportunity("recurrence");
    const store = content();
    const artifact = await generateArtifact(opportunity.id);
    await submitArtifactForReview(artifact, { artifacts: store });
    await approveArtifact(artifact, { artifacts: store });

    await assert.rejects(
      () => createSchedule(artifact, { recurrence: "FREQ=DAILY" }, { content: store }),
      ScheduleInputError,
    );
    await assert.rejects(
      () => createSchedule(artifact, { count: 3 }, { content: store }),
      ScheduleInputError,
    );
  });

  // ── Chat idempotency + regeneration ─────────────────────────────────────────
  it("collapses a duplicate chat request and honours an explicit regeneration", async () => {
    const store = content();
    const deps = {
      content: store,
      stories: storyStore(),
      opportunities: { opportunities: store, stories: storyStore() },
      intent: {
        provider: "fake",
        async extract() {
          return {
            title: `${RUN} chat story`,
            insightBody: "A conversational request.",
            angles: [],
            concept: "explain a thing",
            objective: "educate",
            audience: null,
            format: "x_post",
            channel: "x",
          };
        },
      },
      generation: generationDepsFor(fakeModel()),
    };

    const key = `${RUN}-chat-key`;
    const first = await handleChatRequest(1, { message: "write about schedulers", idempotencyKey: key }, deps as never);
    const duplicate = await handleChatRequest(1, { message: "write about schedulers", idempotencyKey: key }, deps as never);

    assert.equal(first.reused, false);
    assert.equal(duplicate.reused, true, "a repeated request is collapsed");
    assert.equal(duplicate.opportunity.id, first.opportunity.id);
    assert.equal(duplicate.generationJobId, first.generationJobId, "no duplicate generation");

    const before = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(eq(generationJobs.opportunityId, first.opportunity.id));
    assert.equal(before.length, 1);

    // Intentional regeneration → a new job for the same opportunity.
    const regen = await handleChatRequest(
      1,
      { message: "write about schedulers", idempotencyKey: key, regenerate: true },
      deps as never,
    );
    const after = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(eq(generationJobs.opportunityId, first.opportunity.id));
    assert.equal(after.length, 2, "regeneration creates a second job");
    assert.notEqual(regen.generationJobId, first.generationJobId);
  });
});
