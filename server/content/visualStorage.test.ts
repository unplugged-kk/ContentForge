/**
 * Durable asset storage (finding F3).
 *
 * The in-memory store is process state, so an asset ROW survives a restart
 * while its BYTES do not — observed live as `asset "local:…" is unavailable`
 * when a previously generated image was refined after the app restarted. These
 * tests pin the durable implementation, including that exact scenario: a fresh
 * storage instance (what a restart looks like) must still resolve the bytes.
 *
 * Pure filesystem, no database, no network.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { InvalidVisualInputError, createDiskAssetStorage } from "./visual";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cf-assets-"));
  dirs.push(dir);
  return dir;
}

function png(marker = "a"): Buffer {
  // Not a real PNG — storage is content-addressed and must not care.
  return Buffer.from(`PNG-ish bytes ${marker}`);
}

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createDiskAssetStorage — content addressing", () => {
  it("stores and resolves bytes, with metadata", async () => {
    const storage = createDiskAssetStorage({ dir: await tempDir() });
    const { storageKey, contentHash, byteSize } = await storage.put(png("one"), "image/png");
    assert.match(storageKey, /^local:[0-9a-f]{64}$/);
    assert.equal(byteSize, png("one").length);
    assert.equal(contentHash, storageKey.slice("local:".length));
    assert.deepEqual(await storage.get(storageKey), png("one"));
  });

  it("writes identical bytes once, and never duplicates the blob", async () => {
    const dir = await tempDir();
    const storage = createDiskAssetStorage({ dir });
    const first = await storage.put(png("same"), "image/png");
    const second = await storage.put(png("same"), "image/png");
    assert.equal(first.storageKey, second.storageKey);
    assert.equal(await storage.size(), 1);
    // bytes + sidecar metadata, and no leftover temp files
    const entries = await readdir(dir);
    assert.equal(entries.filter((n) => !n.endsWith(".json")).length, 1);
    assert.equal(entries.filter((n) => n.startsWith(".tmp-")).length, 0);
  });

  it("SURVIVES A RESTART — a new instance still resolves the bytes (F3)", async () => {
    const dir = await tempDir();
    const before = createDiskAssetStorage({ dir });
    const { storageKey } = await before.put(png("durable"), "image/png");

    // A fresh instance is what the next process sees: no shared memory at all.
    const afterRestart = createDiskAssetStorage({ dir });
    assert.deepEqual(await afterRestart.get(storageKey), png("durable"));
  });

  it("archives without deleting history, and reports the same unavailable error", async () => {
    const dir = await tempDir();
    const storage = createDiskAssetStorage({ dir });
    const { storageKey } = await storage.put(png("archived"), "image/png");
    await storage.archive(storageKey);

    await assert.rejects(() => storage.get(storageKey), InvalidVisualInputError);
    await assert.rejects(
      () => storage.get(storageKey),
      (error: unknown) =>
        error instanceof InvalidVisualInputError
        && error.message === `Invalid visual input: asset "${storageKey}" is unavailable`,
    );
    // The bytes are still on disk — archive is not a hard delete.
    const entries = await readdir(dir);
    assert.ok(entries.includes(storageKey.slice("local:".length)), "archived bytes must remain on disk");
  });

  it("reports an unknown asset as unavailable rather than throwing a raw fs error", async () => {
    const storage = createDiskAssetStorage({ dir: await tempDir() });
    await assert.rejects(
      () => storage.get(`local:${"0".repeat(64)}`),
      (error: unknown) => error instanceof InvalidVisualInputError,
    );
  });

  it("refuses a storage key that tries to escape the directory", async () => {
    const dir = await tempDir();
    const storage = createDiskAssetStorage({ dir });
    for (const key of ["local:../../etc/passwd", "../evil", "local:zzzz", "local:", "/etc/passwd"]) {
      await assert.rejects(() => storage.get(key), InvalidVisualInputError, `${key} must be rejected`);
    }
  });
});

describe("createDiskAssetStorage — provider fetch grants", () => {
  const withPublicBase = async <T>(fn: () => Promise<T>): Promise<T> => {
    const saved = process.env.CONTENTFORGE_PUBLIC_BASE_URL;
    process.env.CONTENTFORGE_PUBLIC_BASE_URL = "https://contentforge.example";
    try {
      return await fn();
    } finally {
      if (saved === undefined) delete process.env.CONTENTFORGE_PUBLIC_BASE_URL;
      else process.env.CONTENTFORGE_PUBLIC_BASE_URL = saved;
    }
  };

  it("issues a grant that resolves to the durable bytes", async () => {
    await withPublicBase(async () => {
      const storage = createDiskAssetStorage({ dir: await tempDir() });
      const { storageKey } = await storage.put(png("grant"), "image/jpeg");
      const grant = await storage.issueProviderFetchUrl({ storageKey });
      assert.ok(grant, "a configured public base URL must yield a fetch URL");
      assert.match(grant!.url, /^https:\/\/contentforge\.example\/api\/provider-media\/[0-9a-f]{48}$/);
      assert.ok(grant!.expiresAt.getTime() > Date.now());

      const token = grant!.url.split("/").pop()!;
      const resolved = await storage.getProviderGrant(token);
      assert.equal(resolved?.mime, "image/jpeg");
      assert.deepEqual(resolved?.bytes, png("grant"));
    });
  });

  it("resolves a grant from a DIFFERENT instance — the bytes are durable, the grant is not", async () => {
    await withPublicBase(async () => {
      const dir = await tempDir();
      const storage = createDiskAssetStorage({ dir });
      const { storageKey } = await storage.put(png("cross"), "image/png");
      const grant = await storage.issueProviderFetchUrl({ storageKey });
      const token = grant!.url.split("/").pop()!;

      // The new instance cannot know the token (grants are process-local and
      // short-lived by design) but it CAN still serve the bytes it references.
      const restarted = createDiskAssetStorage({ dir });
      assert.equal(await restarted.getProviderGrant(token), null);
      assert.deepEqual(await restarted.get(storageKey), png("cross"));
    });
  });

  it("returns null for unknown, expired and archived grants", async () => {
    await withPublicBase(async () => {
      const storage = createDiskAssetStorage({ dir: await tempDir() });
      assert.equal(await storage.getProviderGrant("f".repeat(48)), null);

      const expired = await storage.put(png("expired"), "image/png");
      const expiredGrant = await storage.issueProviderFetchUrl({ storageKey: expired.storageKey, ttlMs: 1 });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(await storage.getProviderGrant(expiredGrant!.url.split("/").pop()!), null);

      const archived = await storage.put(png("archived-grant"), "image/png");
      const archivedGrant = await storage.issueProviderFetchUrl({ storageKey: archived.storageKey });
      await storage.archive(archived.storageKey);
      assert.equal(await storage.getProviderGrant(archivedGrant!.url.split("/").pop()!), null);
    });
  });

  it("issues no URL when no public base is configured", async () => {
    const saved = process.env.CONTENTFORGE_PUBLIC_BASE_URL;
    delete process.env.CONTENTFORGE_PUBLIC_BASE_URL;
    try {
      const storage = createDiskAssetStorage({ dir: await tempDir() });
      const { storageKey } = await storage.put(png("nobase"), "image/png");
      assert.equal(await storage.issueProviderFetchUrl({ storageKey }), null);
    } finally {
      if (saved !== undefined) process.env.CONTENTFORGE_PUBLIC_BASE_URL = saved;
    }
  });

  it("a grant for an unknown asset is not issued", async () => {
    await withPublicBase(async () => {
      const storage = createDiskAssetStorage({ dir: await tempDir() });
      assert.equal(await storage.issueProviderFetchUrl({ storageKey: `local:${"a".repeat(64)}` }), null);
    });
  });
});
