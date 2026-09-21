import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { visualAssets, visualGenerations } from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import {
  createLocalAssetStorage,
  registerVisualProvider,
  resetVisualProviders,
  type VisualProviderPort,
} from "./visual";
import { createVisualGeneration, runVisualGeneration } from "./visualService";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `aud${Date.now().toString(36)}`;

function wavFixture(): Buffer {
  return Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(4096)]);
}

function audioProvider(): VisualProviderPort {
  return {
    providerId: "audio-contract-fixture",
    providerVersion: "1",
    capabilities: ["generate_audio"],
    modalities: ["audio"],
    models: ["speech/v1"],
    synchronous: true,
    async generate(request) {
      return {
        bytes: wavFixture(),
        mime: "audio/wav",
        width: null,
        height: null,
        durationMs: 1500,
        container: "wav",
        codec: "pcm_s16le",
        sampleRate: 24_000,
        channels: 1,
        altText: "test speech",
        provider: "audio-contract-fixture",
        providerVersion: "1",
        model: request.model ?? "speech/v1",
        cost: null,
        usage: { characters: 20, processingMs: 5, providerVoiceId: "voice-a" },
      };
    },
  };
}

describeDb("audio generation on the shared media pipeline (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const generationIds: number[] = [];
  const storage = createLocalAssetStorage();

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    resetVisualProviders();
    registerVisualProvider(audioProvider());
  });

  after(async () => {
    if (!CONNECTION) return;
    if (generationIds.length > 0) {
      await db.delete(visualAssets).where(inArray(visualAssets.visualGenerationId, generationIds));
      await db.delete(visualGenerations).where(inArray(visualGenerations.id, generationIds));
    }
    resetVisualProviders();
    await pool.end();
  });

  function deps() {
    return { content: new DatabaseContentStorage(db), storage };
  }

  it("persists immutable audio bytes as a content-addressed AudioAsset", async () => {
    const created = await createVisualGeneration(1, {
      kind: "audio",
      capability: "generate_audio",
      providerId: "audio-contract-fixture",
      model: "speech/v1",
      intent: {
        subject: `${RUN} durable speech`,
        text: `${RUN} durable speech`,
        voice: { providerId: "audio-contract-fixture", providerVoiceId: "voice-a", displayName: "Voice A" },
      },
    }, deps());
    generationIds.push(created.generation.id);
    const result = await runVisualGeneration(created.generation.id, deps());
    assert.equal(result.status, "ready");
    const [asset] = await deps().content.listVisualAssetsForGeneration(created.generation.id);
    assert.equal(asset?.kind, "audio");
    assert.equal(asset?.mime, "audio/wav");
    assert.equal(asset?.durationMs, 1500);
    assert.equal(asset?.width, null);
    assert.equal(asset?.metadata.sampleRate, 24_000);
    assert.equal(asset?.metadata.channels, 1);
    assert.equal(asset?.metadata.providerVoiceId, "voice-a");
    assert.match(asset?.storageKey ?? "", /^local:[a-f0-9]{64}$/);
    assert.equal((await storage.get(asset!.storageKey)).length, asset?.byteSize);
  });

  it("collapses concurrent identical requests into one logical generation", async () => {
    const request = {
      kind: "audio" as const,
      capability: "generate_audio" as const,
      providerId: "audio-contract-fixture",
      intent: { subject: `${RUN} duplicate`, text: `${RUN} duplicate` },
    };
    const [first, second] = await Promise.all([
      createVisualGeneration(1, request, deps()),
      createVisualGeneration(1, request, deps()),
    ]);
    generationIds.push(first.generation.id);
    assert.equal(first.generation.id, second.generation.id);
    assert.equal([first.created, second.created].filter(Boolean).length, 1);
  });

  it("does not collapse identical direct requests across owners", async () => {
    const request = {
      kind: "audio" as const,
      capability: "generate_audio" as const,
      providerId: "audio-contract-fixture",
      intent: { subject: `${RUN} owner scoped`, text: `${RUN} owner scoped` },
    };
    const first = await createVisualGeneration(1, request, deps());
    const second = await createVisualGeneration(2, request, deps());
    generationIds.push(first.generation.id, second.generation.id);
    assert.notEqual(first.generation.id, second.generation.id);
    assert.equal(first.generation.userId, 1);
    assert.equal(second.generation.userId, 2);
  });

  it("rejects unsupported models before provider execution", async () => {
    await assert.rejects(
      () => createVisualGeneration(1, {
        kind: "audio",
        providerId: "audio-contract-fixture",
        model: "unknown",
        intent: { subject: `${RUN} model`, text: `${RUN} model` },
      }, deps()),
      /does not support model/,
    );
  });
});
