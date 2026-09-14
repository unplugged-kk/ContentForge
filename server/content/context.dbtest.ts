/**
 * DB-backed tests for Phase 10 — the canonical ContextAssembly seam.
 *
 * Real PostgreSQL: real `user_profile` / `context_vault` / `style_profiles`
 * rows (the pre-existing, previously-disconnected stores), real
 * `generation_policies` content-addressing, real frozen `policy_snapshot` on
 * `generation_jobs`. The only stand-in is the LLM provider (a deterministic
 * fake `GenerationModelPort`) — `createGenerationJob` itself never calls it;
 * only `runGenerationJob` (the worker) does.
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
  contextVault,
  // (kept alongside opportunities/generationJobs for FK-safe cleanup order)
  generationJobs,
  generationPolicies,
  opportunities,
  researchEvidence,
  researchJobs,
  researchSources,
  stories,
  styleProfiles,
  userProfile,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { createGenerationJob, runGenerationJob, type GenerationModelPort } from "./generation";
import { registerBuiltinChannelAdapters } from "./adapters";
import { assembleContext, createDatabaseContextReader } from "./context";
import type { EffectiveGenerationRequest } from "./policy";

registerBuiltinChannelAdapters();

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `cx${Date.now().toString(36)}`;
// Distinct owner per suite run so owner-isolation assertions never collide
// with anything else touching user_profile/context_vault/style_profiles.
const OWNER_A = 800_000 + (Date.now() % 90_000);
const OWNER_B = OWNER_A + 1;

describeDb("context assembly (db)", () => {
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
    const storyRows = await db.select({ id: stories.id }).from(stories).where(like(stories.title, `${RUN}%`));
    const storyIds = storyRows.map((r) => r.id);
    const oppRows = storyIds.length
      ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.storyId, storyIds))
      : [];
    const oppIds = oppRows.map((r) => r.id);
    if (oppIds.length) {
      await db.delete(artifacts).where(inArray(artifacts.opportunityId, oppIds));
      await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
      await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    }
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));

    const jobRows = await db.select({ id: researchJobs.id }).from(researchJobs).where(like(researchJobs.correlationId, `${RUN}%`));
    const jobIds = jobRows.map((r) => r.id);
    if (jobIds.length) {
      await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, jobIds));
      await db.delete(researchSources).where(inArray(researchSources.jobId, jobIds));
      await db.delete(researchJobs).where(inArray(researchJobs.id, jobIds));
    }

    await db.delete(userProfile).where(inArray(userProfile.userId, [OWNER_A, OWNER_B]));
    await db.delete(contextVault).where(inArray(contextVault.userId, [OWNER_A, OWNER_B]));
    await db.delete(styleProfiles).where(inArray(styleProfiles.userId, [OWNER_A, OWNER_B]));
    await db.delete(generationPolicies).where(like(generationPolicies.name, `${RUN}%`));
    await pool.end().catch(() => {});
  });

  async function seedStory(suffix: string) {
    const tag = `${RUN}-${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: OWNER_A,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "context assembly",
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
        excerpt: "context should shape generation deterministically",
        excerptHash: `${tag}`.padEnd(64, "0").slice(0, 64),
        retrievedAt: new Date(),
      })
      .returning();
    const [story] = await db
      .insert(stories)
      .values({
        userId: OWNER_A,
        researchJobId: job.id,
        provenance: "researched",
        title: `${tag} story`,
        insightBody: "Context assembly is one seam, not several.",
        angles: [],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "context test", objective: "prove the seam", format: "x_post", channel: "x" },
      { opportunities: content(), stories: storyStore() },
    );
    return { story, opportunity };
  }

  const fakeModel: GenerationModelPort = {
    provider: "fake-model",
    async generate() {
      return { payload: { text: "generated" }, model: "fake-1", provider: "fake-model", cost: "0", usage: {} };
    },
  };

  function generationDeps(contextReader = createDatabaseContextReader(db)) {
    return {
      content: content(),
      stories: { getStory: (id: number) => storyStore().getStory(id) },
      evidence: {
        listEvidence: async (researchJobId: number) => {
          const rows = await db.select().from(researchEvidence).where(eq(researchEvidence.jobId, researchJobId));
          return rows.map((r) => ({ id: r.id, excerpt: r.excerpt, kind: r.kind }));
        },
      },
      model: fakeModel,
      defaultModel: "fake-1",
      contextReader,
    };
  }

  it("resolves real user_profile + context_vault + style_profiles rows into one ordered assembly", async () => {
    await db.insert(userProfile).values({
      userId: OWNER_A,
      niche: "DevOps",
      audienceDescription: "platform engineers",
      brandVoice: "direct",
    });
    await db.insert(contextVault).values({
      userId: OWNER_A,
      title: `${RUN} favorite reference`,
      content: "a real saved reference",
      isFavorite: true,
    });
    await db.insert(styleProfiles).values({
      userId: OWNER_A,
      name: `${RUN} style`,
      stylePromptSnippet: "short, punchy sentences",
      isFavorite: true,
    });

    const assembly = await assembleContext(OWNER_A, createDatabaseContextReader(db));
    assert.deepEqual(assembly.sources.map((s) => s.type), ["profile", "reference", "style"]);
  });

  it("owner isolation: owner B's assembly never includes owner A's rows", async () => {
    const assembly = await assembleContext(OWNER_B, createDatabaseContextReader(db));
    assert.equal(assembly.sources.length, 0, "owner B has no context rows of its own");
  });

  it("active/inactive: a non-favorited vault item is excluded; favoriting it includes it", async () => {
    const [item] = await db
      .insert(contextVault)
      .values({ userId: OWNER_A, title: `${RUN} inactive`, content: "not favorited yet", isFavorite: false })
      .returning();

    const before = await assembleContext(OWNER_A, createDatabaseContextReader(db));
    assert.ok(!before.sources.some((s) => s.id === `vault:${item.id}`));

    await db.update(contextVault).set({ isFavorite: true }).where(eq(contextVault.id, item.id));
    const after = await assembleContext(OWNER_A, createDatabaseContextReader(db));
    assert.ok(after.sources.some((s) => s.id === `vault:${item.id}`));

    await db.delete(contextVault).where(eq(contextVault.id, item.id));
  });

  it("GenerationPolicy identity: a changed context source produces a different policy row", async () => {
    const { opportunity } = await seedStory("policy-diff");

    await db.insert(contextVault).values({ userId: OWNER_A, title: `${RUN} v1`, content: "context version A", isFavorite: true });
    const jobA = await createGenerationJob(opportunity.id, {}, generationDeps());

    // Mutate context, then create a SECOND, independent generation request
    // (a fresh regenerate) for the same Opportunity.
    await db.insert(contextVault).values({ userId: OWNER_A, title: `${RUN} v2`, content: "context version B", isFavorite: true });
    const jobB = await createGenerationJob(opportunity.id, { regenerate: true }, generationDeps());

    assert.notEqual(jobA.job.policyId, jobB.job.policyId, "different context -> different policy identity");
  });

  it("equivalent context assemblies (same rows, resolved twice) produce the SAME policy identity", async () => {
    const { opportunity } = await seedStory("policy-same");
    await db.insert(contextVault).values({ userId: OWNER_A, title: `${RUN} stable`, content: "unchanged context", isFavorite: true });

    const jobA = await createGenerationJob(opportunity.id, {}, generationDeps());
    const jobB = await createGenerationJob(opportunity.id, {}, generationDeps());

    assert.equal(jobA.job.policyId, jobB.job.policyId, "identical spec, including context, reuses ONE policy revision");
    assert.equal(jobA.job.id, jobB.job.id, "duplicate delivery collapses to the same job, not a new one");
  });

  // ── the mutation test (Ticket 10 §21 — the most important Phase 10 test) ────
  it("context mutation: Job A keeps context A after context changes to B; Artifact A is untouched", async () => {
    const { opportunity } = await seedStory("mutation");

    await db.insert(contextVault).values({ userId: OWNER_A, title: `${RUN} mutation-A`, content: "MUTATION_TEST_CONTEXT_A", isFavorite: true });
    const jobA = await createGenerationJob(opportunity.id, {}, generationDeps());
    const snapshotA = jobA.job.policySnapshot as unknown as EffectiveGenerationRequest;
    assert.match(snapshotA.systemPrompt, /MUTATION_TEST_CONTEXT_A/);

    // Change context to B.
    await db.insert(contextVault).values({ userId: OWNER_A, title: `${RUN} mutation-B`, content: "MUTATION_TEST_CONTEXT_B", isFavorite: true });

    const jobB = await createGenerationJob(opportunity.id, { regenerate: true }, generationDeps());
    const snapshotB = jobB.job.policySnapshot as unknown as EffectiveGenerationRequest;
    assert.match(snapshotB.systemPrompt, /MUTATION_TEST_CONTEXT_A/, "B legitimately still sees A (A is favorited and still active)");
    assert.match(snapshotB.systemPrompt, /MUTATION_TEST_CONTEXT_B/);

    // Re-read Job A from the database: its frozen snapshot must be BYTE-IDENTICAL
    // to what was captured at creation, proving no mutation occurred.
    const reloadedA = await content().getGenerationJob(jobA.job.id);
    const reloadedSnapshotA = reloadedA!.policySnapshot as unknown as EffectiveGenerationRequest;
    assert.deepEqual(reloadedSnapshotA, snapshotA, "Job A's frozen snapshot is untouched by the later context change");
    assert.notEqual(jobA.job.policyId, jobB.job.policyId);
  });

  // ── the negative/restart test (Ticket 10 §22 — queue-then-mutate) ───────────
  it("negative test: a job created before a context mutation executes against the FROZEN context, never the current one", async () => {
    const { opportunity } = await seedStory("negative");

    await db.insert(contextVault).values({ userId: OWNER_A, title: `${RUN} frozen`, content: "FROZEN_CONTEXT_MARKER", isFavorite: true });
    const jobA = await createGenerationJob(opportunity.id, {}, generationDeps());

    // Simulate "restart": mutate context AFTER the job is durably queued, but
    // BEFORE the worker ever executes it.
    await db.insert(contextVault).values({ userId: OWNER_A, title: `${RUN} after-queue`, content: "CONTEXT_AFTER_QUEUEING", isFavorite: true });

    // Execution never re-resolves context — it reads only the frozen snapshot.
    const run = await runGenerationJob(jobA.job.id, generationDeps());
    assert.equal(run.status, "succeeded");

    const finalJob = await content().getGenerationJob(jobA.job.id);
    const finalSnapshot = finalJob!.policySnapshot as unknown as EffectiveGenerationRequest;
    assert.match(finalSnapshot.systemPrompt, /FROZEN_CONTEXT_MARKER/);
    assert.ok(
      !finalSnapshot.systemPrompt.includes("CONTEXT_AFTER_QUEUEING"),
      "context added after queueing must never appear in the executed job's frozen request",
    );
  });

  it("provenance: the policy row's context_snapshot names sources by id/type, never raw bodies", async () => {
    const { opportunity } = await seedStory("provenance");
    await db.insert(contextVault).values({ userId: OWNER_A, title: `${RUN} prov`, content: "PROVENANCE_SECRET_BODY", isFavorite: true });

    const jobA = await createGenerationJob(opportunity.id, {}, generationDeps());
    const policy = await content().getGenerationPolicy(jobA.job.policyId!);
    const snapshot = policy!.contextSnapshot as { contextHash: string; sourceRefs: Array<{ id: string; type: string }> };
    assert.ok(snapshot.sourceRefs.some((r) => r.type === "reference"));
    assert.ok(!JSON.stringify(snapshot).includes("PROVENANCE_SECRET_BODY"), "no raw source body in durable provenance");
  });
});
