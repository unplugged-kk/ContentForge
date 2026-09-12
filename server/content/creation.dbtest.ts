/**
 * DB-backed tests for the creation-intelligence layer (CannerAI parity phase 1).
 *
 * Real PostgreSQL, real constraints, real persistence. A deterministic
 * in-process model stands in for the LLM provider (the model port is the
 * boundary). Everything ContentForge owns is real.
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
  contentTemplates,
  generationJobs,
  generationPolicies,
  opportunities,
  researchEvidence,
  researchJobs,
  researchSources,
  results,
  scheduleOccurrences,
  schedules,
  publications,
  stories,
  voices,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import {
  createGenerationJob,
  runGenerationJob,
  type GenerationModelPort,
  type GenerationRequest,
} from "./generation";
import { resolveGenerationPolicy, PolicyInputError } from "./policy";
import { handleChatRequest } from "./chat";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `cr${Date.now().toString(36)}`;

describeDb("creation intelligence (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);

  /** Fake model: returns a valid payload for whichever format was requested. */
  function fakeModel(): GenerationModelPort {
    const seen: GenerationRequest[] = [];
    return {
      provider: "fake-model",
      async generate(request) {
        seen.push(request);
        const payload =
          request.format === "x_thread"
            ? { units: ["Hook: scheduling is policy now.", "Takeaway: platform teams own placement."] }
            : { text: "Kubernetes scheduling is now a policy surface." };
        return { payload, model: "fake-1", provider: "fake-model", cost: null, usage: {} };
      },
    };
  }

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
        excerpt: "scheduler plugins are a stable extension point",
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
    return { job, evidence, story };
  }

  async function seedOpportunity(suffix: string, format: string) {
    const { story, job } = await seedStory(suffix);
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "explain", objective: "educate", format, channel: "x" },
      { opportunities: content(), stories: storyStore() },
    );
    return { story, job, opportunity };
  }

  async function researchCounts() {
    const [jobs, sources, evidence] = await Promise.all([
      db.select({ id: researchJobs.id }).from(researchJobs).where(like(researchJobs.correlationId, `${RUN}%`)),
      db.select({ id: researchSources.id }).from(researchSources).where(like(researchSources.canonicalUrl, `%${RUN}%`)),
      db.select({ id: researchEvidence.id }).from(researchEvidence).where(like(researchEvidence.excerpt, `%${RUN}%`)),
    ]);
    return { jobs: jobs.length, sources: sources.length, evidence: evidence.length };
  }

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
    // Chat stories have no research job.
    const chatStories = await db
      .select({ id: stories.id })
      .from(stories)
      .where(like(stories.title, "%chat%"));
    const allStoryIds = [...storyIds, ...chatStories.map((s) => s.id)];

    const oppRows = allStoryIds.length
      ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.storyId, allStoryIds))
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
    if (allStoryIds.length) await db.delete(stories).where(inArray(stories.id, allStoryIds));
    if (jobIds.length) await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, jobIds));
    if (jobIds.length) await db.delete(researchSources).where(inArray(researchSources.jobId, jobIds));
    if (jobIds.length) await db.delete(researchJobs).where(inArray(researchJobs.id, jobIds));
    await pool.end().catch(() => {});
  });

  // ── Voice / template / policy persistence ───────────────────────────────────
  it("persists a voice and pins it from a policy revision", async () => {
    const store = content();
    const voice = await store.insertVoice({
      userId: 1,
      name: `${RUN} direct`,
      tone: "technical, direct",
      doRules: ["lead with the point"],
      dontRules: ["no hype"],
      vocabulary: ["p99"],
    });
    assert.ok(voice.id > 0);

    const { policy } = await resolveGenerationPolicy(
      { format: "x_post", channel: "x", voiceId: voice.id, model: "m1" },
      { content: store },
    );
    assert.equal(policy.voiceId, voice.id);
    const [row] = await db.select().from(generationPolicies).where(eq(generationPolicies.id, policy.id));
    assert.equal(row.voiceId, voice.id, "FN persists: policy → voice");
  });

  it("persists a template and rejects a format it does not support", async () => {
    const store = content();
    const template = await store.insertContentTemplate({
      userId: 1,
      name: `${RUN} hook-insight-takeaway`,
      supportedFormats: ["x_post"],
      supportedChannels: ["x"],
      structure: [{ name: "hook" }, { name: "insight" }, { name: "takeaway" }],
      constraints: { maxCharacters: 240 },
      instructions: "Keep it tight.",
    });
    assert.ok(template.id > 0);

    const { policy } = await resolveGenerationPolicy(
      { format: "x_post", channel: "x", templateId: template.id, model: "m1" },
      { content: store },
    );
    assert.equal(policy.templateId, template.id);
    // Template constraints are merged over the format-profile defaults.
    assert.equal((policy.constraints as Record<string, unknown>).maxCharacters, 240);

    await assert.rejects(
      () => resolveGenerationPolicy({ format: "x_thread", channel: "x", templateId: template.id }, { content: store }),
      /does not support/,
    );
  });

  it("addresses policy revisions by content: same spec reuses one row, a different voice makes a new one", async () => {
    const store = content();
    const voiceA = await store.insertVoice({ userId: 1, name: `${RUN} A`, tone: "direct" });
    const voiceB = await store.insertVoice({ userId: 1, name: `${RUN} B`, tone: "warm" });

    const a1 = await resolveGenerationPolicy({ format: "x_post", channel: "x", voiceId: voiceA.id, model: "m1" }, { content: store });
    const a2 = await resolveGenerationPolicy({ format: "x_post", channel: "x", voiceId: voiceA.id, model: "m1" }, { content: store });
    const b1 = await resolveGenerationPolicy({ format: "x_post", channel: "x", voiceId: voiceB.id, model: "m1" }, { content: store });

    assert.equal(a1.created, true);
    assert.equal(a2.created, false, "an identical spec reuses the revision");
    assert.equal(a2.policy.id, a1.policy.id);
    assert.notEqual(b1.specHash, a1.specHash);
    assert.equal(b1.policy.version > a1.policy.version, true, "a new revision bumps the version");
    assert.equal(PolicyInputError.prototype.isPrototypeOf(new PolicyInputError([])), true);
  });

  // ── GenerationJob: policy pinning, idempotency, regeneration ────────────────
  it("pins policyId + a frozen snapshot, and collapses duplicate delivery", async () => {
    const { opportunity } = await seedOpportunity("pin", "x_post");
    const deps = generationDepsFor(fakeModel());

    const first = await createGenerationJob(opportunity.id, {}, deps);
    const second = await createGenerationJob(opportunity.id, {}, deps);

    assert.equal(first.created, true);
    assert.equal(second.created, false, "duplicate delivery → the same job");
    assert.equal(second.job.id, first.job.id);
    assert.ok(first.job.policyId, "the job pins an immutable policy revision");
    assert.match(String(first.job.policySnapshot.systemPrompt), /Platform guidance/);
    assert.equal(first.effective.policyId, first.job.policyId);
  });

  it("distinguishes intentional regeneration: a new job and a linked Artifact revision", async () => {
    const { opportunity } = await seedOpportunity("regen", "x_post");
    const deps = generationDepsFor(fakeModel());

    const first = await createGenerationJob(opportunity.id, {}, deps);
    const firstRun = await runGenerationJob(first.job.id, deps);
    assert.equal(firstRun.status, "succeeded");

    const regen = await createGenerationJob(opportunity.id, { regenerate: true, rejectionReason: "too generic" }, deps);
    assert.equal(regen.created, true, "regeneration is a new job");
    assert.notEqual(regen.job.id, first.job.id);
    assert.equal(regen.job.priorArtifactId, firstRun.artifactId, "the new attempt links the prior revision");

    const regenRun = await runGenerationJob(regen.job.id, deps);
    assert.equal(regenRun.status, "succeeded");
    assert.notEqual(regenRun.artifactId, firstRun.artifactId);

    const [revision] = await db.select().from(artifacts).where(eq(artifacts.id, regenRun.artifactId!));
    assert.equal(revision.supersedesId, firstRun.artifactId);
    const [original] = await db.select().from(artifacts).where(eq(artifacts.id, firstRun.artifactId!));
    assert.equal(original.supersedesId, null, "the original revision is untouched");
  });

  // ── Multi-format from one Story ─────────────────────────────────────────────
  it("produces x_post and x_thread Artifacts from the same Story with no new research", async () => {
    const { story, job } = await seedStory("multiformat");
    const store = content();
    const deps = generationDepsFor(fakeModel());

    const before = await researchCounts();

    const post = await createOpportunityFromStory(
      story.id,
      { concept: "short", objective: "educate", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );
    const thread = await createOpportunityFromStory(
      story.id,
      { concept: "thread", objective: "educate", format: "x_thread", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );

    const postJob = await createGenerationJob(post.id, {}, deps);
    const threadJob = await createGenerationJob(thread.id, {}, deps);
    const postRun = await runGenerationJob(postJob.job.id, deps);
    const threadRun = await runGenerationJob(threadJob.job.id, deps);

    const postArtifact = (await store.getArtifact(postRun.artifactId!))!;
    const threadArtifact = (await store.getArtifact(threadRun.artifactId!))!;
    assert.equal(postArtifact.format, "x_post");
    assert.equal(threadArtifact.format, "x_thread");
    assert.equal(postArtifact.channel, "x");
    assert.ok(Array.isArray((threadArtifact.payload as Record<string, unknown>).units));
    assert.notEqual(postArtifact.id, threadArtifact.id);

    const after = await researchCounts();
    assert.deepEqual(after, before, "format changes never re-research");
    assert.equal((await storyStore().getStory(story.id))!.researchJobId, job.id);
  });

  it("same Story + Opportunity with different voices yields different policies and snapshots", async () => {
    const { opportunity } = await seedOpportunity("voice", "x_post");
    const store = content();
    const deps = generationDepsFor(fakeModel());
    const voiceA = await store.insertVoice({ userId: 1, name: `${RUN} voice A`, tone: "direct", dontRules: ["no hype"] });
    const voiceB = await store.insertVoice({ userId: 1, name: `${RUN} voice B`, tone: "warm, reflective" });

    const a = await createGenerationJob(opportunity.id, { voiceId: voiceA.id }, deps);
    const b = await createGenerationJob(opportunity.id, { voiceId: voiceB.id, regenerate: true }, deps);

    assert.notEqual(a.job.policyId, b.job.policyId, "different voices → different policy revisions");
    assert.match(a.effective.systemPrompt, /no hype/);
    assert.match(b.effective.systemPrompt, /warm, reflective/);
    assert.notEqual(a.job.idempotencyKey, b.job.idempotencyKey);
  });

  // ── Chat → Opportunity → GenerationJob → Artifact ──────────────────────────
  it("runs chat → human Story → Opportunity → GenerationJob → Artifact", async () => {
    const store = content();
    const model = fakeModel();
    const deps = {
      content: store,
      stories: storyStore(),
      opportunities: { opportunities: store, stories: storyStore() },
      intent: {
        provider: "fake",
        async extract() {
          return {
            title: `${RUN} chat story`,
            insightBody: "A conversational content request.",
            angles: ["one framing"],
            concept: "explain a thing",
            objective: "educate",
            audience: null,
            format: "x_post",
            channel: "x",
          };
        },
      },
      generation: generationDepsFor(model),
    };

    const researchBefore = await researchCounts();
    const result = await handleChatRequest(1, { message: "write about scheduler plugins" }, deps as never);

    assert.equal(result.storyCreated, true);
    assert.ok(result.generationJobId, "chat enqueued a normal generation job");

    const run = await runGenerationJob(result.generationJobId!, deps.generation);
    assert.equal(run.status, "succeeded");
    const artifact = (await store.getArtifact(run.artifactId!))!;
    assert.equal(artifact.format, "x_post");
    assert.equal(artifact.provenance, "generated");
    // A human Story carries no evidence, so attribution is explicit rather than faked.
    assert.deepEqual(artifact.attribution, []);
    assert.ok(artifact.attributionReason);

    const researchAfter = await researchCounts();
    assert.deepEqual(researchAfter, researchBefore, "chat does not create research");
  });
});
