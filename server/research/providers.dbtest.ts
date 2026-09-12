/**
 * DB-backed tests for Phase 2 research expansion.
 *
 * Proves the durable guarantees the providers rely on: source identity is unique
 * per (job, provider, native id) as well as per canonical URL, evidence is unique
 * per (job, source, excerpt hash), mixed-provider aggregation persists one
 * durable job, and research is owner-scoped.
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
import { researchEvidence, researchJobs, researchSources } from "@shared/schema";
import type { NormalizedSource, ProviderDefinition } from "./contracts";
import { ResearchEngine } from "./engine";
import { ProviderExecutor, registerProvider, resetProviderRegistry } from "./registry";
import { DatabaseResearchStorage } from "./storage";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `p2${Date.now().toString(36)}`;

let pool: pg.Pool;
let db!: NodePgDatabase<typeof schema>;

function source(nativeId: string, provider: string, urlPath: string, text: string): NormalizedSource {
  const canonicalUrl = `https://${RUN}.test/${urlPath}`;
  return {
    ref: { provider, kind: "article", nativeId, canonicalUrl },
    provider,
    backend: "b1",
    providerVersion: "1.0.0",
    retrievalMethod: "api",
    accessClass: "open",
    canonicalUrl,
    title: `title ${nativeId}`,
    author: null,
    publishedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    retrievedAt: new Date().toISOString(),
    excerpt: text,
    contentHash: `hash-${provider}-${nativeId}`,
    metadata: {},
  };
}

function fakeProvider(id: string, behaviour: () => NormalizedSource[] | Promise<NormalizedSource[]>): ProviderDefinition {
  const stamp = (item: NormalizedSource): NormalizedSource => ({
    ...item,
    provider: id,
    ref: { ...item.ref, provider: id },
  });
  return {
    id,
    contractVersion: "1",
    version: "1",
    accessClass: "open",
    backends: [
      {
        id: "b1",
        capabilities: ["discover", "search"],
        discover: async () => (await behaviour()).map(stamp),
        search: async () => (await behaviour()).map(stamp),
      },
    ],
  };
}

describeDb("research providers (db)", () => {
  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
  });

  after(async () => {
    if (!CONNECTION) return;
    const jobs = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(like(researchJobs.correlationId, `${RUN}%`));
    const ids = jobs.map((j) => j.id);
    if (ids.length > 0) {
      await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, ids));
      await db.delete(researchSources).where(inArray(researchSources.jobId, ids));
      await db.delete(researchJobs).where(inArray(researchJobs.id, ids));
    }
    await pool.end().catch(() => {});
  });

  it("deduplicates a provider result durably by (job, provider, native id)", async () => {
    const [job] = await db
      .insert(researchJobs)
      .values({
        correlationId: `${RUN}-dedup-native`,
        idempotencyKey: `${RUN}-dedup-native-k`,
        kind: "directed",
        query: "q",
        status: "running",
        providerIds: ["reddit"],
      })
      .returning();

    const row = {
      jobId: job.id,
      provider: "reddit",
      backend: "reddit-json",
      kind: "post",
      nativeId: "t3_same",
      canonicalUrl: `https://${RUN}.test/a`,
      contentHash: "h",
      retrievedAt: new Date(),
    };
    await db.insert(researchSources).values(row);
    // Same provider + native id, different URL → rejected by the durable index.
    await assert.rejects(() =>
      db.insert(researchSources).values({ ...row, canonicalUrl: `https://${RUN}.test/b` }),
    );
    // Same URL, different native id → also rejected (URL identity).
    await assert.rejects(() =>
      db.insert(researchSources).values({ ...row, nativeId: "t3_other" }),
    );
    const rows = await db.select().from(researchSources).where(eq(researchSources.jobId, job.id));
    assert.equal(rows.length, 1);
  });

  it("keeps evidence unique per (job, source, excerpt hash)", async () => {
    const [job] = await db
      .insert(researchJobs)
      .values({
        correlationId: `${RUN}-dedup-evidence`,
        idempotencyKey: `${RUN}-dedup-evidence-k`,
        kind: "directed",
        query: "q",
        status: "running",
        providerIds: ["reddit"],
      })
      .returning();
    const [src] = await db
      .insert(researchSources)
      .values({
        jobId: job.id,
        provider: "reddit",
        backend: "reddit-json",
        kind: "post",
        nativeId: "t3_ev",
        canonicalUrl: `https://${RUN}.test/ev`,
        contentHash: "h",
        retrievedAt: new Date(),
      })
      .returning();

    const evidence = {
      jobId: job.id,
      sourceId: src.id,
      kind: "excerpt",
      origin: "sourced",
      excerpt: "same passage",
      excerptHash: "e".repeat(64),
      retrievedAt: new Date(),
    };
    await db.insert(researchEvidence).values(evidence);
    await assert.rejects(() => db.insert(researchEvidence).values(evidence));
    const rows = await db.select().from(researchEvidence).where(eq(researchEvidence.jobId, job.id));
    assert.equal(rows.length, 1);
  });

  it("runs a mixed-provider job into ONE durable ResearchJob with aggregated evidence", async () => {
    const ids = [`${RUN}_a`, `${RUN}_b`, `${RUN}_c`];
    resetProviderRegistry();
    registerProvider(fakeProvider(ids[0], () => [source("n1", ids[0], "a/1", "alpha passage")]));
    registerProvider(fakeProvider(ids[1], () => [source("n2", ids[1], "b/1", "beta passage")]));
    registerProvider(fakeProvider(ids[2], () => [source("n3", ids[2], "c/1", "gamma passage")]));

    const engine = new ResearchEngine({
      executor: new ProviderExecutor({ logSink: () => {} }),
      storage: new DatabaseResearchStorage(db),
      logSink: () => {},
    });

    const result = await engine.run({
      kind: "directed",
      query: "mixed",
      providerIds: ids,
      correlationId: `${RUN}-mixed`,
      idempotencyKey: `${RUN}-mixed-k`,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.sourceCount, 3, "one source per provider");
    assert.equal(result.diagnostics.length, 3, "every attempted provider is recorded");
    assert.ok(result.diagnostics.every((d) => d.outcome === "ok"));

    const rows = await db.select().from(researchSources).where(eq(researchSources.jobId, result.jobId));
    assert.deepEqual(rows.map((r) => r.provider).sort(), [...ids].sort());

    const evidence = await db.select().from(researchEvidence).where(eq(researchEvidence.jobId, result.jobId));
    assert.equal(evidence.length, 3);
    assert.ok(evidence.every((e) => e.origin === "sourced"));
    resetProviderRegistry();
  });

  it("records a degraded completion when only some providers succeed", async () => {
    const ok = `${RUN}_ok`;
    const down = `${RUN}_down`;
    resetProviderRegistry();
    registerProvider(fakeProvider(ok, () => [source("n1", ok, "ok/1", "usable passage")]));
    registerProvider(
      fakeProvider(down, () => {
        throw new Error("provider unavailable");
      }),
    );

    const engine = new ResearchEngine({
      executor: new ProviderExecutor({ logSink: () => {} }),
      storage: new DatabaseResearchStorage(db),
      logSink: () => {},
    });

    const result = await engine.run({
      kind: "directed",
      query: "degraded",
      providerIds: [down, ok],
      correlationId: `${RUN}-degraded`,
      idempotencyKey: `${RUN}-degraded-k`,
    });

    assert.equal(result.status, "complete", "partial success completes");
    const failed = result.diagnostics.find((d) => d.provider === down);
    assert.equal(failed?.outcome, "failed", "the degradation is observable");
    const evidence = await db.select().from(researchEvidence).where(eq(researchEvidence.jobId, result.jobId));
    assert.equal(evidence.length, 1, "successful evidence is retained");
    resetProviderRegistry();
  });

  it("scopes the job listing to the caller (legacy unowned rows stay visible)", async () => {
    const mine = 9_100_000 + Math.floor(Math.random() * 1000);
    const theirs = mine + 1;
    await db.insert(researchJobs).values([
      {
        correlationId: `${RUN}-owner-a`,
        idempotencyKey: `${RUN}-owner-a-k`,
        kind: "directed",
        query: "q",
        status: "complete",
        providerIds: ["rss"],
        userId: mine,
      },
      {
        correlationId: `${RUN}-owner-b`,
        idempotencyKey: `${RUN}-owner-b-k`,
        kind: "directed",
        query: "q",
        status: "complete",
        providerIds: ["rss"],
        userId: theirs,
      },
      {
        correlationId: `${RUN}-owner-null`,
        idempotencyKey: `${RUN}-owner-null-k`,
        kind: "directed",
        query: "q",
        status: "complete",
        providerIds: ["rss"],
        userId: null,
      },
    ]);

    const storage = new DatabaseResearchStorage(db);
    const visible = (await storage.listJobs(mine, 200)).map((j) => j.correlationId);
    assert.ok(visible.includes(`${RUN}-owner-a`), "sees its own job");
    assert.ok(!visible.includes(`${RUN}-owner-b`), "does not see another user's job");
    assert.ok(visible.includes(`${RUN}-owner-null`), "legacy unowned rows remain visible");
  });
});
