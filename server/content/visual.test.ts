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
  registerVisualProvider,
  getVisualProvider,
  hasVisualProvider,
  resetVisualProviders,
  validateVisualOutput,
  visualGenerationIdempotencyKey,
  InvalidVisualInputError,
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
});

describe("visual provider registry", () => {
  it("is deterministic: exact id, explicit capabilities, unknown refused", () => {
    resetVisualProviders();
    assert.equal(hasVisualProvider("local-fixture"), false);
    const fixture = createFixtureVisualProvider();
    registerVisualProvider(fixture);
    assert.equal(hasVisualProvider("local-fixture"), true);
    assert.deepEqual(getVisualProvider("local-fixture").capabilities, ["generate_image", "generate_slide"]);
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
