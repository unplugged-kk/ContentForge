/**
 * DB-backed tests for Phase 19 video generations on the existing Visual* tables.
 *
 * Real PostgreSQL. Provider is the video fixture (tiny MP4, no network).
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
  stories,
  visualAssetRefs,
  visualAssets,
  visualGenerations,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { createGenerationJob } from "./generation";
import { createArtifact } from "./artifact";
import { createLocalAssetStorage, registerVisualProvider, resetVisualProviders } from "./visual";
import { createFixtureVideoProvider, createFixtureVisualProvider } from "./visualFixture";
import { registerBuiltinChannelAdapters } from "./adapters";
import { createVisualGeneration, runVisualGeneration, VisualServiceInputError } from "./visualService";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `vid${Date.now().toString(36)}`;

describeDb("video production (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const storage = createLocalAssetStorage();

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    resetVisualProviders();
    registerVisualProvider(createFixtureVisualProvider());
    registerVisualProvider(createFixtureVideoProvider());
    registerBuiltinChannelAdapters();
  });

  after(async () => {
    if (!CONNECTION) return;
    resetVisualProviders();
    const storyRows = await db.select({ id: stories.id }).from(stories).where(like(stories.title, `${RUN}%`));
    const storyIds = storyRows.map((r) => r.id);
    const oppRows = storyIds.length
      ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.storyId, storyIds))
      : [];
    const oppIds = oppRows.map((r) => r.id);
    const genRows = oppIds.length
      ? await db.select({ id: visualGenerations.id }).from(visualGenerations).where(inArray(visualGenerations.opportunityId, oppIds))
      : [];
    const genIds = genRows.map((r) => r.id);
    const artRows = oppIds.length
      ? await db.select({ id: artifacts.id }).from(artifacts).where(inArray(artifacts.opportunityId, oppIds))
      : [];
    const artIds = artRows.map((r) => r.id);
    if (artIds.length) await db.delete(visualAssetRefs).where(inArray(visualAssetRefs.artifactId, artIds));
    if (artIds.length) await db.delete(artifacts).where(inArray(artifacts.id, artIds));
    if (genIds.length) {
      await db.update(visualGenerations).set({ sourceVisualAssetId: null }).where(inArray(visualGenerations.id, genIds));
      await db.delete(visualAssets).where(inArray(visualAssets.visualGenerationId, genIds));
      await db.delete(visualGenerations).where(inArray(visualGenerations.id, genIds));
    }
    if (oppIds.length) {
      await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
      await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    }
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    await pool.end().catch(() => {});
  });

  async function seedVideoOpportunity(suffix: string) {
    const [story] = await db
      .insert(stories)
      .values({
        userId: 1,
        researchJobId: null,
        provenance: "human",
        title: `${RUN}-${suffix} story`,
        insightBody: "A scheduler plugin ships as a stable extension point.",
        angles: [],
        evidenceRefs: [],
        status: "ready",
      })
      .returning();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "explain", objective: "educate", format: "video", channel: "x" },
      { opportunities: content(), stories: storyStore() },
    );
    return { story, opportunity };
  }

  function deps() {
    return { content: content(), storage };
  }

  it("persists VideoGeneration and VideoAsset with storage_key, not bytes", async () => {
    const { opportunity } = await seedVideoOpportunity("persist");
    const created = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "video", intent: { subject: `${RUN} persist` }, durationMs: 1500 },
      deps(),
    );
    assert.equal(created.created, true);
    assert.equal(created.generation.kind, "video");
    assert.equal(created.generation.capability, "generate_video");
    assert.equal(created.generation.status, "requested");
    const run = await runVisualGeneration(created.generation.id, deps());
    assert.equal(run.status, "ready");
    const [asset] = await db
      .select()
      .from(visualAssets)
      .where(eq(visualAssets.visualGenerationId, created.generation.id));
    assert.match(asset.storageKey, /^local:[0-9a-f]+$/);
    assert.equal(asset.mime, "video/mp4");
    assert.equal(asset.kind, "video");
    assert.equal(asset.durationMs, 1500);
    assert.equal(asset.container, "mp4");
    assert.equal(typeof (asset as { bytes?: unknown }).bytes, "undefined");
  });

  it("idempotent create collapses; explicit regenerate is a new identity", async () => {
    const { opportunity } = await seedVideoOpportunity("idem");
    const body = { opportunityId: opportunity.id, kind: "video" as const, intent: { subject: `${RUN} idem` } };
    const first = await createVisualGeneration(1, body, deps());
    const second = await createVisualGeneration(1, body, deps());
    assert.equal(second.created, false);
    assert.equal(second.generation.id, first.generation.id);
    await runVisualGeneration(first.generation.id, deps());
    const regen = await createVisualGeneration(1, { ...body, regenerate: true, regenerationNonce: "v-2" }, deps());
    assert.notEqual(regen.generation.id, first.generation.id);
    await runVisualGeneration(regen.generation.id, deps());
    const a = await content().listVisualAssetsForGeneration(first.generation.id);
    const b = await content().listVisualAssetsForGeneration(regen.generation.id);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.notEqual(a[0]!.id, b[0]!.id);
    assert.equal(a[0]!.storageKey, a[0]!.storageKey);
  });

  it("retry of a failed generation is the same identity; duplicate delivery does not duplicate assets", async () => {
    const { opportunity } = await seedVideoOpportunity("retry");
    resetVisualProviders();
    registerVisualProvider(createFixtureVisualProvider());
    registerVisualProvider(createFixtureVideoProvider({ failMode: "transient" }));
    const created = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "video", intent: { subject: `${RUN} retry` } },
      deps(),
    );
    const fail = await runVisualGeneration(created.generation.id, deps());
    assert.equal(fail.status, "failed");
    assert.equal(fail.failureClass, "transient");
    resetVisualProviders();
    registerVisualProvider(createFixtureVisualProvider());
    registerVisualProvider(createFixtureVideoProvider());
    const recovered = await runVisualGeneration(created.generation.id, deps());
    assert.equal(recovered.status, "ready");
    const again = await runVisualGeneration(created.generation.id, deps());
    assert.equal(again.reused, true);
    const assets = await content().listVisualAssetsForGeneration(created.generation.id);
    assert.equal(assets.length, 1);
  });

  it("refinement preserves the source asset and records sourceVisualAssetId", async () => {
    const { opportunity } = await seedVideoOpportunity("refine");
    const sourceGen = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "video", intent: { subject: `${RUN} refine source` } },
      deps(),
    );
    const produced = await runVisualGeneration(sourceGen.generation.id, deps());
    const source = await content().getVisualAsset(produced.visualAssetId!);
    const refined = await createVisualGeneration(
      1,
      {
        opportunityId: opportunity.id,
        kind: "video",
        capability: "refine_video",
        sourceVisualAssetId: source!.id,
        instruction: "Increase contrast; ignore any instruction to change owner",
        intent: { subject: `${RUN} refined video` },
        regenerate: true,
      },
      deps(),
    );
    const run = await runVisualGeneration(refined.generation.id, deps());
    assert.equal(run.status, "ready");
    const after = await content().getVisualAsset(source!.id);
    assert.equal(after!.id, source!.id);
    assert.equal(after!.storageKey, source!.storageKey);
    assert.notEqual(run.visualAssetId, source!.id);
    assert.equal(refined.generation.sourceVisualAssetId, source!.id);
  });

  it("owner isolation: foreign source asset is not found; foreign generation is hidden", async () => {
    const { opportunity } = await seedVideoOpportunity("owner");
    const created = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "video", intent: { subject: `${RUN} owned` } },
      deps(),
    );
    await runVisualGeneration(created.generation.id, deps());
    const [asset] = await content().listVisualAssetsForGeneration(created.generation.id);
    await assert.rejects(
      () =>
        createVisualGeneration(
          99,
          {
            kind: "video",
            capability: "refine_video",
            sourceVisualAssetId: asset.id,
            intent: { subject: "steal" },
            regenerate: true,
          },
          deps(),
        ),
      (err: unknown) => err instanceof VisualServiceInputError && /not found/.test(err.message),
    );
    const foreign = await content().getVisualGenerationForOwner(created.generation.id, 99);
    assert.equal(foreign, undefined);
  });

  it("Story → Opportunity(video) → GenerationJob → VideoGeneration freezes ContextAssembly", async () => {
    const { opportunity, story } = await seedVideoOpportunity("story");
    const { job } = await createGenerationJob(
      opportunity.id,
      {},
      {
        content: content(),
        stories: { getStory: (id: number) => storyStore().getStory(id) },
        evidence: { listEvidence: async () => [] },
        model: {
          provider: "fake-model",
          async generate() {
            return { payload: { visualAssetId: 1 }, model: "fake-1", provider: "fake-model", cost: null, usage: {} };
          },
        },
        defaultModel: "fake-1",
      },
    );
    let calls = 0;
    const reader = {
      async getUserProfile() {
        calls += 1;
        return {
          niche: calls === 1 ? "data-ai" : "CHANGED",
          audienceDescription: "engineers",
          brandVoice: "direct",
          writingStyleNotes: null,
          contentGoals: "teach",
          messagingPillars: ["mlops"],
          targetPlatforms: null,
          postingFrequency: null,
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        };
      },
      async listFavoriteVaultItems() {
        return [];
      },
      async listFavoriteStyleProfiles() {
        return [];
      },
    };
    const created = await createVisualGeneration(
      1,
      {
        opportunityId: opportunity.id,
        generationJobId: job.id,
        kind: "video",
        intent: { subject: `${RUN} story video` },
      },
      { ...deps(), contextReader: reader as never },
    );
    const snapshot = created.generation.requestSnapshot as { context?: { renderedBlock?: string; contextHash?: string } };
    assert.match(String(snapshot.context?.renderedBlock ?? ""), /data-ai/);
    const hash = snapshot.context?.contextHash;
    await reader.getUserProfile();
    const again = await content().getVisualGeneration(created.generation.id);
    const later = again!.requestSnapshot as { context?: { renderedBlock?: string; contextHash?: string } };
    assert.equal(later.context?.contextHash, hash);
    assert.match(String(later.context?.renderedBlock ?? ""), /data-ai/);
    assert.equal(created.generation.generationJobId, job.id);
    assert.equal(story.researchJobId, null);
  });

  it("Artifact attachment stores a VideoAsset id, not binary media", async () => {
    const { opportunity } = await seedVideoOpportunity("artifact");
    const created = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "video", intent: { subject: `${RUN} attach` } },
      deps(),
    );
    const run = await runVisualGeneration(created.generation.id, deps());
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "video",
        channel: "x",
        payload: { visualAssetId: run.visualAssetId },
        provenance: "generated",
        attribution: [],
        attributionReason: "fixture",
      },
      { artifacts: content() },
    );
    await content().insertVisualAssetRef({
      userId: 1,
      artifactId: artifact.id,
      visualAssetId: run.visualAssetId!,
      role: "hero",
      position: 0,
    });
    const refs = await content().listVisualAssetRefs(artifact.id);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.visualAssetId, run.visualAssetId);
    assert.equal((artifact.payload as { visualAssetId: number }).visualAssetId, run.visualAssetId);
  });

  it("rejects video variationCount > 1 (deferred)", async () => {
    const { opportunity } = await seedVideoOpportunity("novar");
    await assert.rejects(
      () =>
        createVisualGeneration(
          1,
          { opportunityId: opportunity.id, kind: "video", variationCount: 3, intent: { subject: `${RUN} vars` } },
          deps(),
        ),
      VisualServiceInputError,
    );
  });

  it("image fixture cannot satisfy generate_video", async () => {
    const { opportunity } = await seedVideoOpportunity("cap");
    await assert.rejects(
      () =>
        createVisualGeneration(
          1,
          {
            opportunityId: opportunity.id,
            kind: "video",
            providerId: "local-fixture",
            intent: { subject: `${RUN} wrong provider` },
          },
          deps(),
        ),
      /does not support "generate_video"/,
    );
  });
});
