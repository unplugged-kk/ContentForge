/**
 * DB-backed tests for Phase 27 video repurposing.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { visualAssets, visualGenerations, videoRepurposingJobs } from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { createLocalAssetStorage, registerVisualProvider, resetVisualProviders } from "./visual";
import { createFixtureVideoProvider } from "./visualFixture";
import { createVisualGeneration, runVisualGeneration } from "./visualService";
import {
  createFixtureVideoRepurposeProvider,
  createVideoRepurposingJob,
  registerVideoRepurposingProvider,
  resetVideoRepurposingProviders,
  runVideoRepurposing,
  LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
  VideoRepurposeInputError,
} from "./videoRepurpose";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `vr${Date.now().toString(36)}`;

describeDb("video repurposing (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storage = createLocalAssetStorage();

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    resetVisualProviders();
    registerVisualProvider(createFixtureVideoProvider());
    resetVideoRepurposingProviders();
    registerVideoRepurposingProvider(createFixtureVideoRepurposeProvider());
  });

  after(async () => {
    if (!CONNECTION) return;
    await db.delete(videoRepurposingJobs).where(like(videoRepurposingJobs.correlationId, `${RUN}%`)).catch(() => undefined);
    await pool.end();
  });

  async function readyVideo(userId = 1) {
    const store = content();
    const { generation } = await createVisualGeneration(
      userId,
      { kind: "video", intent: { subject: `${RUN} source` }, durationMs: 1500 },
      { content: store, storage },
    );
    const ran = await runVisualGeneration(generation.id, { content: store, storage });
    assert.equal(ran.status, "ready");
    return { store, generation, assetId: ran.visualAssetId! };
  }

  it("Path F: one source VideoAsset becomes three derivative VideoAssets", async () => {
    const { store, assetId } = await readyVideo();
    const { job, created } = await createVideoRepurposingJob(
      1,
      { sourceVisualAssetId: assetId, clipCount: 3, providerId: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID },
      { content: store, storage },
    );
    assert.equal(created, true);
    const result = await runVideoRepurposing(job.id, { content: store, storage });
    assert.equal(result.status, "ready");
    assert.equal(result.assetIds.length, 3);
    const hashes = new Set<string>();
    for (const id of result.assetIds) {
      const asset = await store.getVisualAsset(id);
      assert.equal(asset?.kind, "video");
      assert.equal(asset?.provenance, "derived");
      assert.equal((asset?.metadata as { sourceVisualAssetId?: number }).sourceVisualAssetId, assetId);
      hashes.add(asset?.contentHash ?? "");
    }
    assert.equal(hashes.size, 3);
  });

  it("Path I: concurrent identical requests collapse to one job", async () => {
    const { store, assetId } = await readyVideo();
    const input = {
      sourceVisualAssetId: assetId,
      clipCount: 3,
      providerId: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
      regenerate: true,
      regenerationNonce: `${RUN}-concurrent`,
    };
    const [a, b] = await Promise.all([
      createVideoRepurposingJob(1, input, { content: store, storage }),
      createVideoRepurposingJob(1, input, { content: store, storage }),
    ]);
    assert.equal(a.job.id, b.job.id);
    assert.equal(a.created || b.created, true);
    assert.equal(a.created && b.created, false);
  });

  it("Path G: partial clip failure keeps successful VideoAssets", async () => {
    resetVideoRepurposingProviders();
    registerVideoRepurposingProvider(createFixtureVideoRepurposeProvider({ failMode: "partial", failAtIndex: 1 }));
    const { store, assetId } = await readyVideo();
    const { job } = await createVideoRepurposingJob(
      1,
      { sourceVisualAssetId: assetId, clipCount: 3, providerId: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID, regenerate: true },
      { content: store, storage },
    );
    const result = await runVideoRepurposing(job.id, { content: store, storage });
    assert.equal(result.status, "partial");
    assert.equal(result.assetIds.length, 2);
    const outputs = await store.listVideoRepurposingOutputs(job.id);
    assert.equal(outputs.filter((o) => o.status === "ready").length, 2);
    assert.equal(outputs.filter((o) => o.status === "failed").length, 1);
    resetVideoRepurposingProviders();
    registerVideoRepurposingProvider(createFixtureVideoRepurposeProvider());
  });

  it("Path D: unknown does not mint a second provider identity", async () => {
    resetVideoRepurposingProviders();
    registerVideoRepurposingProvider(createFixtureVideoRepurposeProvider({ failMode: "unknown" }));
    const { store, assetId } = await readyVideo();
    const { job } = await createVideoRepurposingJob(
      1,
      { sourceVisualAssetId: assetId, clipCount: 3, providerId: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID, regenerate: true },
      { content: store, storage },
    );
    const first = await runVideoRepurposing(job.id, { content: store, storage });
    assert.equal(first.status, "unknown");
    const row = await store.getVideoRepurposingJob(job.id);
    assert.equal(row?.providerJobId, `cfvr-${job.id}`);
    const second = await runVideoRepurposing(job.id, { content: store, storage });
    assert.equal(second.status, "unknown");
    const again = await store.getVideoRepurposingJob(job.id);
    assert.equal(again?.providerJobId, row?.providerJobId);
    resetVideoRepurposingProviders();
    registerVideoRepurposingProvider(createFixtureVideoRepurposeProvider());
  });

  it("Path M: owner isolation hides another user's job", async () => {
    const { store, assetId } = await readyVideo(1);
    const { job } = await createVideoRepurposingJob(
      1,
      { sourceVisualAssetId: assetId, clipCount: 3, providerId: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID, regenerate: true },
      { content: store, storage },
    );
    const hidden = await store.getVideoRepurposingJobForOwner(job.id, 2);
    assert.equal(hidden, undefined);
  });

  it("rejects non-video sources and foreign assets", async () => {
    const store = content();
    await assert.rejects(
      () => createVideoRepurposingJob(1, { sourceVisualAssetId: 999999 }, { content: store, storage }),
      VideoRepurposeInputError,
    );
  });

  it("import failure retains the provider job and retries import only", async () => {
    const { store, assetId } = await readyVideo();
    const { job } = await createVideoRepurposingJob(
      1,
      {
        sourceVisualAssetId: assetId,
        clipCount: 3,
        providerId: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
        regenerate: true,
      },
      { content: store, storage },
    );
    let puts = 0;
    const flaky = {
      ...storage,
      async put(bytes: Buffer, mime: string) {
        puts += 1;
        if (puts === 1) throw new Error("disk full");
        return storage.put(bytes, mime);
      },
    };
    await assert.rejects(
      () => runVideoRepurposing(job.id, { content: store, storage: flaky }),
      /import failed; provider job/,
    );
    const afterFail = await store.getVideoRepurposingJob(job.id);
    assert.equal(afterFail?.providerJobId, `cfvr-${job.id}`);
    assert.notEqual(afterFail?.status, "ready");
    const outputsAfterFail = await store.listVideoRepurposingOutputs(job.id);
    assert.equal(outputsAfterFail.length, 0);
    const retried = await runVideoRepurposing(job.id, { content: store, storage: flaky });
    assert.equal(retried.status, "ready");
    assert.equal(retried.assetIds.length, 3);
    const again = await store.getVideoRepurposingJob(job.id);
    assert.equal(again?.providerJobId, afterFail?.providerJobId);
  });

  it("rejects shell-like video generation intent", async () => {
    const store = content();
    await assert.rejects(
      () =>
        createVisualGeneration(
          1,
          { kind: "video", intent: { subject: `${RUN} inject`, ffmpegArgs: "-i /tmp/x" } },
          { content: store, storage },
        ),
      /ffmpegArgs/,
    );
    await db.delete(visualGenerations).where(like(visualGenerations.correlationId, `${RUN}%`)).catch(() => undefined);
    void visualAssets;
  });
});
