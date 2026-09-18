/**
 * Unit tests for the Visual Intelligence primitives (Phase 3).
 *
 * No I/O: the storage seam is in-memory-shaped (local impl), the providers are
 * deterministic fixtures, and the domain services themselves never touch a
 * database. DB-backed behavior lives in `visual.dbtest.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeStorageKey,
  createLocalAssetStorage,
  hashIntent,
  modalityOfCapability,
  providerModalities,
  registerVisualProvider,
  resolveProviderModel,
  getVisualProvider,
  hasVisualProvider,
  resetVisualProviders,
  validateAudioOutput,
  validateVisualOutput,
  visualGenerationIdempotencyKey,
  InvalidVisualInputError,
  VisualModelUnsupportedError,
  VisualProviderNotRegisteredError,
} from "./visual";
import { createFixtureVisualProvider } from "./visualFixture";
import { createLocalAssetStorage as localStorage } from "./visual";

function png(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
}

describe("visual output validation (untrusted provider output)", () => {
  it("accepts a small valid PNG", () => {
    validateVisualOutput({ bytes: png(), mime: "image/png", width: 1, height: 1 });
  });

  it("rejects disallowed MIME (including SVG — scripts), empty bytes, oversize, bad dims", () => {
    assert.throws(
      () => validateVisualOutput({ bytes: png(), mime: "image/svg+xml", width: 1, height: 1 }),
      InvalidVisualInputError,
    );
    assert.throws(
      () => validateVisualOutput({ bytes: Buffer.alloc(0), mime: "image/png", width: 1, height: 1 }),
      InvalidVisualInputError,
    );
    assert.throws(
      () =>
        validateVisualOutput({
          bytes: Buffer.alloc(11 * 1024 * 1024),
          mime: "image/png",
          width: 1,
          height: 1,
        }),
      InvalidVisualInputError,
    );
    assert.throws(
      () => validateVisualOutput({ bytes: png(), mime: "image/png", width: 0, height: 1 }),
      InvalidVisualInputError,
    );
    assert.throws(
      () => validateVisualOutput({ bytes: png(), mime: "image/png", width: 9000, height: 1 }),
      InvalidVisualInputError,
    );
  });

  it("rejects path-traversal and non-content-addressed storage keys", () => {
    assertSafeStorageKey("local:abcdef0123");
    assert.throws(() => assertSafeStorageKey("../etc/passwd"), InvalidVisualInputError);
    assert.throws(() => assertSafeStorageKey("/abs/path.png"), InvalidVisualInputError);
    assert.throws(() => assertSafeStorageKey("s3://bucket/key"), InvalidVisualInputError);
  });
});

describe("audio output validation (untrusted provider output)", () => {
  const wav = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WAVEfmt "),
    Buffer.alloc(32),
  ]);

  it("accepts bounded WAV speech metadata", () => {
    validateAudioOutput({
      bytes: wav,
      mime: "audio/wav",
      durationMs: 1000,
      sampleRate: 24_000,
      channels: 1,
    });
  });

  it("rejects fake containers and missing media metadata", () => {
    assert.throws(
      () => validateAudioOutput({
        bytes: Buffer.from("not-wave"),
        mime: "audio/wav",
        durationMs: null,
        sampleRate: null,
        channels: null,
      }),
      InvalidVisualInputError,
    );
  });
});

describe("visual intent identity", () => {
  it("hashes deterministically and order-independently", () => {
    const a = hashIntent({ subject: "scheduler", aspectRatio: "1:1" });
    const b = hashIntent({ aspectRatio: "1:1", subject: "scheduler" });
    assert.equal(a, b);
    assert.equal(a.length, 64);
    assert.notEqual(a, hashIntent({ subject: "other", aspectRatio: "1:1" }));
  });

  it("distinguishes duplicate delivery from intentional regeneration", () => {
    const input = { opportunityId: 7, kind: "image" as const, intent: { subject: "x" } };
    assert.equal(visualGenerationIdempotencyKey(input), visualGenerationIdempotencyKey({ ...input }));
    assert.notEqual(
      visualGenerationIdempotencyKey(input),
      visualGenerationIdempotencyKey({ ...input, regenerationNonce: "regen-1" }),
    );
  });

  it("scopes direct media idempotency to the owner", () => {
    const input = { kind: "audio" as const, intent: { text: "same" } };
    assert.notEqual(
      visualGenerationIdempotencyKey({ ...input, userId: 1 }),
      visualGenerationIdempotencyKey({ ...input, userId: 2 }),
    );
  });
});

describe("visual provider registry", () => {
  it("is deterministic: exact id, explicit capabilities, unknown refused", () => {
    resetVisualProviders();
    assert.equal(hasVisualProvider("local-fixture"), false);
    const fixture = createFixtureVisualProvider();
    registerVisualProvider(fixture);
    assert.equal(hasVisualProvider("local-fixture"), true);
    assert.deepEqual(getVisualProvider("local-fixture").capabilities, [
      "generate_image",
      "generate_image_variations",
      "refine_image",
      "generate_slide",
    ]);
    assert.throws(() => getVisualProvider("nope"), VisualProviderNotRegisteredError);
    resetVisualProviders();
  });

  it("the fixture emits real bytes and counts calls", async () => {
    const fixture = createFixtureVisualProvider();
    const out = await fixture.generate({
      kind: "image",
      capability: "generate_image",
      snapshot: {},
      correlationId: "c",
    });
    assert.equal(out.mime, "image/png");
    assert.ok(out.bytes.length > 0);
    assert.equal(fixture.calls(), 1);
  });
});

describe("media modality (Phase 9 §5) — provider-agnostic capability model", () => {
  it("derives modality from capability without assuming image-only forever", () => {
    assert.equal(modalityOfCapability("generate_image"), "image");
    assert.equal(modalityOfCapability("generate_image_variations"), "image");
    assert.equal(modalityOfCapability("refine_image"), "image");
    assert.equal(modalityOfCapability("edit_image"), "image");
    assert.equal(modalityOfCapability("generate_slide"), "image");
    assert.equal(modalityOfCapability("generate_video"), "video");
    assert.equal(modalityOfCapability("refine_video"), "video");
    assert.equal(modalityOfCapability("generate_audio"), "audio");
  });

  it("providerModalities derives from capabilities when a provider declares none", () => {
    const fixture = createFixtureVisualProvider();
    assert.deepEqual(providerModalities(fixture), ["image"]);
  });

  it("providerModalities respects an explicit declaration over the derived default", () => {
    const provider = {
      ...createFixtureVisualProvider(),
      modalities: ["image", "video"] as const,
    };
    assert.deepEqual(providerModalities(provider), ["image", "video"]);
  });
});

describe("deterministic model selection (Phase 9 §9) — capability-based, never inferred", () => {
  it("accepts any model when the provider declares no model list", () => {
    const fixture = createFixtureVisualProvider();
    assert.doesNotThrow(() => resolveProviderModel(fixture, "anything"));
    assert.doesNotThrow(() => resolveProviderModel(fixture, undefined));
  });

  it("rejects a model outside the provider's declared list, before any provider call", () => {
    const provider = { ...createFixtureVisualProvider(), models: ["fixture-model-a", "fixture-model-b"] };
    assert.doesNotThrow(() => resolveProviderModel(provider, "fixture-model-a"));
    assert.throws(() => resolveProviderModel(provider, "gpt-nonexistent"), VisualModelUnsupportedError);
  });
});

describe("local asset storage (content-addressed seam)", () => {
  it("dedupes identical bytes and resolves keys", async () => {
    const storage = createLocalAssetStorage();
    const first = await storage.put(png(), "image/png");
    const second = await storage.put(png(), "image/png");
    assert.equal(first.storageKey, second.storageKey);
    assert.match(first.storageKey, /^local:[0-9a-f]{64}$/);
    assert.equal(storage.size(), 1, "no duplicate blobs");
    assert.deepEqual(await storage.get(first.storageKey), png());
  });

  it("archive makes bytes unavailable without deleting history", async () => {
    const storage = localStorage();
    const { storageKey } = await storage.put(png(), "image/png");
    await storage.archive(storageKey);
    await assert.rejects(() => storage.get(storageKey), InvalidVisualInputError);
  });
});

describe("visual specs and variation identity", () => {
  it("resolves specs from id, format×channel, and aspect ratio without a channel allowlist", async () => {
    const { resolveVisualSpec, getVisualSpec, validateVariationCount, variationIdentityKey, validateCarouselSlideCount } =
      await import("./visualSpecs");
    assert.equal(resolveVisualSpec({ specId: "x_image" }).usage, "x_image");
    assert.equal(resolveVisualSpec({ format: "video", channel: "x" }).id, "generic_social_video");
    assert.equal(resolveVisualSpec({ format: "video", channel: "instagram" }).id, "instagram_reel");
    assert.equal(resolveVisualSpec({ format: "video", aspectRatio: "16:9" }).id, "landscape_video");
    assert.equal(resolveVisualSpec({ aspectRatio: "16:9" }).id, "generic_landscape");
    assert.ok(getVisualSpec("social_portrait"));
    assert.equal(validateVariationCount(0), "variationCount must be an integer 1–8");
    assert.equal(validateVariationCount(4), null);
    assert.ok(validateCarouselSlideCount(1));
    assert.equal(validateCarouselSlideCount(3), null);
    assert.equal(variationIdentityKey(9, 2), "vg:9:pos:2");
  });
});
