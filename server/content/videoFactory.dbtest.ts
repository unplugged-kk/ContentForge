/**
 * DB-backed tests for Phase 21 Video Factory provider integration.
 *
 * Real PostgreSQL. The Video Factory process is not started — the memory
 * transport is the external boundary. Output is imported through AssetStoragePort.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { inArray, like } from "drizzle-orm";
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
import { createLocalAssetStorage, registerVisualProvider, resetVisualProviders } from "./visual";
import { createFixtureVideoProvider, createFixtureVisualProvider, fixtureMp4Bytes } from "./visualFixture";
import { registerBuiltinChannelAdapters } from "./adapters";
import { createVisualGeneration, runVisualGeneration } from "./visualService";
import { VIDEO_FACTORY_CONTRACT_VERSION, videoFactoryJobId } from "./videoFactoryContract";
import { createMemoryVideoFactoryTransport } from "./videoFactoryTransport";
import { createVideoFactoryProvider } from "./videoFactoryProvider";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `vf${Date.now().toString(36)}`;

describeDb("video-factory provider (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const storage = createLocalAssetStorage();
  let transport = createMemoryVideoFactoryTransport();

  function registerFactory() {
    resetVisualProviders();
    registerVisualProvider(createFixtureVisualProvider());
    registerVisualProvider(createFixtureVideoProvider());
    registerVisualProvider(createVideoFactoryProvider({ transport, pollBudgetMs: 0 }));
  }

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    registerFactory();
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

  async function seedVideoOpportunity(suffix: string, userId = 1) {
    const [story] = await db
      .insert(stories)
      .values({
        userId,
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

  async function createFactoryGeneration(suffix: string, extra: Record<string, unknown> = {}) {
    const { opportunity, story } = await seedVideoOpportunity(suffix);
    const created = await createVisualGeneration(
      1,
      {
        opportunityId: opportunity.id,
        kind: "video",
        providerId: "video-factory",
        intent: { subject: `${RUN} ${suffix}`, aspectRatio: "9:16" },
        durationMs: 1500,
        ...extra,
      },
      deps(),
    );
    return { ...created, opportunity, story };
  }

  it("stores provider identity; duplicate submit reuses the same external job", async () => {
    transport = createMemoryVideoFactoryTransport();
    registerFactory();
    const created = await createFactoryGeneration("ident");
    assert.equal(created.generation.providerId, "video-factory");
    const first = await runVisualGeneration(created.generation.id, deps());
    assert.equal(first.status, "failed");
    assert.equal(first.failureClass, "transient");
    const jobId = videoFactoryJobId(created.generation.id);
    assert.equal(transport.jobs.has(jobId), true);
    const retry = await runVisualGeneration(created.generation.id, deps());
    assert.equal(retry.status, "failed");
    assert.equal(transport.jobs.size, 1);
    assert.equal(Array.from(transport.jobs.keys())[0], jobId);
  });

  it("explicit regenerate creates a new external job identity", async () => {
    transport = createMemoryVideoFactoryTransport();
    registerFactory();
    const first = await createFactoryGeneration("regen-a");
    await runVisualGeneration(first.generation.id, deps());
    const second = await createVisualGeneration(
      1,
      {
        opportunityId: first.opportunity.id,
        kind: "video",
        providerId: "video-factory",
        intent: { subject: `${RUN} regen-a`, aspectRatio: "9:16" },
        durationMs: 1500,
        regenerate: true,
        regenerationNonce: "vf-2",
      },
      deps(),
    );
    await runVisualGeneration(second.generation.id, deps());
    assert.notEqual(second.generation.id, first.generation.id);
    assert.deepEqual(
      Array.from(transport.jobs.keys()).sort(),
      [videoFactoryJobId(first.generation.id), videoFactoryJobId(second.generation.id)].sort(),
    );
  });

  it("completed output is imported once into AssetStoragePort, not a factory path", async () => {
    transport = createMemoryVideoFactoryTransport();
    registerFactory();
    const created = await createFactoryGeneration("import");
    await runVisualGeneration(created.generation.id, deps());
    const jobId = videoFactoryJobId(created.generation.id);
    transport.complete(jobId, { bytes: fixtureMp4Bytes(), width: 1080, height: 1920, durationMs: 1500 });
    const ready = await runVisualGeneration(created.generation.id, deps());
    assert.equal(ready.status, "ready");
    const again = await runVisualGeneration(created.generation.id, deps());
    assert.equal(again.reused, true);
    const assets = await content().listVisualAssetsForGeneration(created.generation.id);
    assert.equal(assets.length, 1);
    assert.match(assets[0]!.storageKey, /^local:[0-9a-f]+$/);
    assert.doesNotMatch(assets[0]!.storageKey, /video-factory|\/Users\//);
    const meta = assets[0]!.metadata as Record<string, unknown>;
    assert.equal(meta.contractVersion, VIDEO_FACTORY_CONTRACT_VERSION);
    assert.equal(meta.externalJobId, jobId);
    assert.equal(typeof meta.outputIdentity, "string");
    assert.equal(typeof meta.outputPath, "undefined");
    const bytes = await storage.get(assets[0]!.storageKey);
    assert.equal(bytes.equals(fixtureMp4Bytes()), true);
  });

  it("unknown external state is not blindly resubmitted; restart recovers the same job", async () => {
    transport = createMemoryVideoFactoryTransport();
    registerFactory();
    const created = await createFactoryGeneration("restart");
    await runVisualGeneration(created.generation.id, deps());
    const jobId = videoFactoryJobId(created.generation.id);
    transport.setState(jobId, "unknown");
    const unknown = await runVisualGeneration(created.generation.id, deps());
    assert.equal(unknown.status, "failed");
    assert.equal(unknown.failureClass, "transient");
    assert.equal(transport.jobs.size, 1);
    transport.complete(jobId, { bytes: fixtureMp4Bytes(), width: 1080, height: 1920, durationMs: 1500 });
    const recovered = await runVisualGeneration(created.generation.id, deps());
    assert.equal(recovered.status, "ready");
    const assets = await content().listVisualAssetsForGeneration(created.generation.id);
    assert.equal(assets.length, 1);
  });

  it("ownership isolation: foreign generation is hidden and cannot import another owner's output", async () => {
    transport = createMemoryVideoFactoryTransport();
    registerFactory();
    const created = await createFactoryGeneration("owner");
    await runVisualGeneration(created.generation.id, deps());
    const jobId = videoFactoryJobId(created.generation.id);
    transport.complete(jobId, { bytes: fixtureMp4Bytes(), width: 1080, height: 1920, durationMs: 1500 });
    await runVisualGeneration(created.generation.id, deps());
    const foreign = await content().getVisualGenerationForOwner(created.generation.id, 99);
    assert.equal(foreign, undefined);
    const owned = await content().getVisualGenerationForOwner(created.generation.id, 1);
    assert.ok(owned);
    const assets = await content().listVisualAssetsForGeneration(created.generation.id);
    assert.equal(assets[0]!.userId, 1);
  });

  it("Story → Opportunity → GenerationJob → VideoGeneration keeps frozen context off the factory contract", async () => {
    transport = createMemoryVideoFactoryTransport();
    registerFactory();
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
    const reader = {
      async getUserProfile() {
        return {
          niche: "data-ai",
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
        providerId: "video-factory",
        intent: { subject: `${RUN} story vf`, aspectRatio: "9:16" },
        durationMs: 1500,
      },
      { ...deps(), contextReader: reader as never },
    );
    const snap = created.generation.requestSnapshot as { context?: { renderedBlock?: string } };
    assert.match(String(snap.context?.renderedBlock ?? ""), /data-ai/);
    await runVisualGeneration(created.generation.id, deps());
    const factoryJob = transport.jobs.get(videoFactoryJobId(created.generation.id));
    assert.ok(factoryJob);
    assert.doesNotMatch(factoryJob.request.brief, /data-ai/);
    assert.equal(created.generation.generationJobId, job.id);
    assert.equal(created.generation.opportunityId, opportunity.id);
    assert.equal(story.id, opportunity.storyId);
  });

  it("invalid factory output is permanent and does not persist a VideoAsset", async () => {
    transport = createMemoryVideoFactoryTransport();
    registerFactory();
    const created = await createFactoryGeneration("bad-out");
    await runVisualGeneration(created.generation.id, deps());
    transport.complete(videoFactoryJobId(created.generation.id), {
      bytes: Buffer.from("not-mp4"),
      width: 1080,
      height: 1920,
      durationMs: 1500,
    });
    const failed = await runVisualGeneration(created.generation.id, deps());
    assert.equal(failed.status, "failed");
    assert.equal(failed.failureClass, "permanent");
    const assets = await content().listVisualAssetsForGeneration(created.generation.id);
    assert.equal(assets.length, 0);
  });
});
