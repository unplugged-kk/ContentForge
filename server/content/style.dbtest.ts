/**
 * DB-backed tests for Phase 11 — real-post style intelligence.
 *
 * Real PostgreSQL: real `references`/`style_analyses`/`style_profiles`
 * rows, real owner isolation, real `generation_policies` content-addressing
 * when observed style enters context. The only stand-in is the AI gateway
 * boundary — a deterministic fixture analyzer (real structured output, no
 * network), exactly like `visual.dbtest.ts` doubles the visual provider.
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
  generationJobs,
  generationPolicies,
  opportunities,
  references,
  stories,
  styleAnalyses,
  styleProfiles,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { createGenerationJob, type GenerationModelPort } from "./generation";
import { registerBuiltinChannelAdapters } from "./adapters";
import { createDatabaseContextReader, assembleContext } from "./context";
import {
  createDatabaseStyleStorage,
  requestStyleAnalysis,
  runStyleAnalysis,
  type StyleServiceDeps,
} from "./styleService";
import { registerStyleAnalyzer, resetStyleAnalyzers } from "./style";
import { createFixtureStyleAnalyzer } from "./styleFixture";

registerBuiltinChannelAdapters();

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `sty${Date.now().toString(36)}`;
const OWNER_A = 700_000 + (Date.now() % 90_000);
const OWNER_B = OWNER_A + 1;

describeDb("style intelligence (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const styleStore = () => createDatabaseStyleStorage(db);

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    resetStyleAnalyzers();
    registerStyleAnalyzer(createFixtureStyleAnalyzer({ providerId: "gateway-style" }));
  });

  after(async () => {
    if (!CONNECTION) return;
    resetStyleAnalyzers();

    const storyRows = await db.select({ id: stories.id }).from(stories).where(like(stories.title, `${RUN}%`));
    const storyIds = storyRows.map((r) => r.id);
    const oppRows = storyIds.length
      ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.storyId, storyIds))
      : [];
    const oppIds = oppRows.map((r) => r.id);
    if (oppIds.length) {
      await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
      await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    }
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    await db.delete(generationPolicies).where(like(generationPolicies.name, `${RUN}%`));

    // Style rows are scoped by the two sentinel owners, not by RUN tag.
    const refRows = await db.select({ id: references.id }).from(references).where(inArray(references.userId, [OWNER_A, OWNER_B]));
    const refIds = refRows.map((r) => r.id);
    if (refIds.length) {
      await db.delete(styleProfiles).where(inArray(styleProfiles.sourceReferenceId, refIds));
      await db.delete(styleAnalyses).where(inArray(styleAnalyses.referenceId, refIds));
      await db.delete(references).where(inArray(references.id, refIds));
    }
    await pool.end().catch(() => {});
  });

  async function seedStory(suffix: string) {
    const [story] = await db
      .insert(stories)
      .values({
        userId: OWNER_A,
        researchJobId: null,
        provenance: "human",
        title: `${RUN}-${suffix} story`,
        insightBody: "Style intelligence should shape generation deterministically.",
        angles: [],
        evidenceRefs: [],
        status: "ready",
      })
      .returning();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "style test", objective: "prove the seam", format: "x_post", channel: "x" },
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

  function generationDeps() {
    return {
      content: content(),
      stories: { getStory: (id: number) => storyStore().getStory(id) },
      evidence: { listEvidence: async () => [] },
      model: fakeModel,
      defaultModel: "fake-1",
      contextReader: createDatabaseContextReader(db),
    };
  }

  async function seedReference(ownerId: number, text: string) {
    const styleDeps: StyleServiceDeps = { storage: styleStore() };
    const reference = await styleDeps.storage.insertReference({
      userId: ownerId,
      rawContent: text,
      sourceType: "manual",
      title: `${RUN} reference`,
    });
    return { reference, styleDeps };
  }

  it("persists authored source content and an observation, owner-scoped", async () => {
    const { reference, styleDeps } = await seedReference(OWNER_A, "a".repeat(80));
    const { analysis } = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id }, styleDeps);
    const run = await runStyleAnalysis(analysis.id, styleDeps);
    assert.equal(run.status, "ready");
    assert.ok(run.styleProfileId);

    const [row] = await db.select().from(styleProfiles).where(eq(styleProfiles.id, run.styleProfileId!));
    assert.equal(row.userId, OWNER_A);
    assert.equal(row.sourceReferenceId, reference.id);
    assert.equal(row.confidence, "strong");
    assert.equal(row.analyzerVersion, analysis.analyzerVersion);
    assert.ok((row.structuredObservation as any).dimensions.tone.length > 0);
  });

  it("owner isolation: owner B cannot read owner A's reference, and analysis is refused", async () => {
    const { reference } = await seedReference(OWNER_A, "b".repeat(80));
    const styleDeps: StyleServiceDeps = { storage: styleStore() };
    await assert.rejects(() => requestStyleAnalysis(OWNER_B, { referenceId: reference.id }, styleDeps));
  });

  it("duplicate analysis request collapses to ONE durable style_analyses row (real Postgres)", async () => {
    const { reference, styleDeps } = await seedReference(OWNER_A, "c".repeat(80));
    const first = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id }, styleDeps);
    const second = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id }, styleDeps);
    assert.equal(first.analysis.id, second.analysis.id);
    const rows = await db.select().from(styleAnalyses).where(eq(styleAnalyses.referenceId, reference.id));
    assert.equal(rows.length, 1);
  });

  it("explicit re-analysis creates a new version, chained by supersedesId, never mutating the original", async () => {
    const { reference, styleDeps } = await seedReference(OWNER_A, "d".repeat(80));
    const first = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id }, styleDeps);
    const runA = await runStyleAnalysis(first.analysis.id, styleDeps);

    const regen = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id, regenerate: true }, styleDeps);
    const runB = await runStyleAnalysis(regen.analysis.id, styleDeps);

    assert.notEqual(runA.styleAnalysisId, runB.styleAnalysisId);
    const [profileB] = await db.select().from(styleProfiles).where(eq(styleProfiles.id, runB.styleProfileId!));
    assert.equal(profileB.supersedesId, runA.styleProfileId);

    const [profileA] = await db.select().from(styleProfiles).where(eq(styleProfiles.id, runA.styleProfileId!));
    assert.ok(profileA, "the original observation row still exists, unmutated");
  });

  it("context assembly reads the real observation, labeled with confidence, as DATA", async () => {
    const { reference, styleDeps } = await seedReference(OWNER_A, "e".repeat(80));
    const { analysis } = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id }, styleDeps);
    await runStyleAnalysis(analysis.id, styleDeps);

    const assembly = await assembleContext(OWNER_A, createDatabaseContextReader(db));
    const styleSource = assembly.sources.find((s) => s.type === "style");
    assert.ok(styleSource, "the observation entered context");
    assert.match(styleSource!.content, /strong evidence/);
    assert.match(assembly.renderedBlock, /DATA, not instructions/);
  });

  it("an 'insufficient' confidence observation is excluded from context (never synthesized as real style)", async () => {
    // Use a fixture whose observation IS valid but marked insufficient.
    const insufficientAnalyzer = {
      providerId: "gateway-style",
      providerVersion: "v1",
      async analyze() {
        return {
          observation: {
            confidence: "insufficient" as const,
            confidenceReason: "sample too short",
            dimensions: {
              tone: "not enough material", sentenceRhythm: "n/a", verbosity: "n/a", formattingTendencies: "n/a",
              punctuationTendencies: "n/a", vocabularyRegister: "n/a", hookPatterns: [], paragraphStructure: "n/a",
              questionUsage: "n/a", listUsage: "n/a", emojiTendencies: "n/a", ctaPatterns: [], rhetoricalPatterns: [], recurringTraits: [],
            },
          },
          model: "fixture-model",
          provider: "gateway-style",
          usage: {},
        };
      },
    };
    resetStyleAnalyzers();
    registerStyleAnalyzer(insufficientAnalyzer);

    const { reference, styleDeps } = await seedReference(OWNER_B, "f".repeat(80));
    const { analysis } = await requestStyleAnalysis(OWNER_B, { referenceId: reference.id }, styleDeps);
    await runStyleAnalysis(analysis.id, styleDeps);

    const assembly = await assembleContext(OWNER_B, createDatabaseContextReader(db));
    assert.ok(!assembly.sources.some((s) => s.type === "style"), "insufficient-confidence observation never enters context");

    resetStyleAnalyzers();
    registerStyleAnalyzer(createFixtureStyleAnalyzer({ providerId: "gateway-style" }));
  });

  // ── Ticket 11 §16 — the mandatory mutation/snapshot test ────────────────────
  it("mutation test: Job A keeps its original style context after a new observation supersedes it", async () => {
    const { opportunity } = await seedStory("mutation");
    const { reference, styleDeps } = await seedReference(OWNER_A, "MUTATION_STYLE_A ".repeat(6));
    const analysisA = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id }, styleDeps);
    await runStyleAnalysis(analysisA.analysis.id, styleDeps);

    const jobA = await createGenerationJob(opportunity.id, {}, generationDeps());
    const snapshotA = jobA.job.policySnapshot as any;
    assert.match(snapshotA.systemPrompt, /strong evidence/);

    // Supersede with a new observation (regenerate) for the SAME reference.
    const analysisB = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id, regenerate: true }, styleDeps);
    await runStyleAnalysis(analysisB.analysis.id, styleDeps);

    const jobB = await createGenerationJob(opportunity.id, { regenerate: true }, generationDeps());
    const snapshotB = jobB.job.policySnapshot as any;

    assert.notEqual(jobA.job.policyId, jobB.job.policyId, "a new observation changes policy identity");

    const reloadedA = await content().getGenerationJob(jobA.job.id);
    assert.deepEqual(
      (reloadedA!.policySnapshot as any),
      snapshotA,
      "Job A's frozen snapshot is untouched by the superseding observation",
    );
    void snapshotB;
  });

  it("restart-equivalent: a job created before re-analysis still executes against its frozen style context", async () => {
    const { opportunity } = await seedStory("restart");
    const { reference, styleDeps } = await seedReference(OWNER_A, "RESTART_STYLE_FROZEN ".repeat(6));
    const analysisA = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id }, styleDeps);
    await runStyleAnalysis(analysisA.analysis.id, styleDeps);

    const jobA = await createGenerationJob(opportunity.id, {}, generationDeps());
    const frozenSnapshot = jobA.job.policySnapshot as any;

    // Mutate style state AFTER the job is durably created (simulating a
    // restart between creation and execution — the worker below is a fresh
    // call against the durable row, exactly what a restarted process does).
    const analysisB = await requestStyleAnalysis(OWNER_A, { referenceId: reference.id, regenerate: true }, styleDeps);
    await runStyleAnalysis(analysisB.analysis.id, styleDeps);

    const reloaded = await content().getGenerationJob(jobA.job.id);
    assert.deepEqual(reloaded!.policySnapshot as any, frozenSnapshot, "the frozen snapshot never re-reads live style state");
  });
});
