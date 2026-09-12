/**
 * DB-backed tests for the research engine and ResearchJob domain.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise). Uses the real schema; rows are
 * namespaced per run so the suite is re-runnable.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { researchEvidence, researchJobs, researchSources } from "@shared/schema";
import type { NormalizedSource, ProviderDefinition } from "./contracts";
import { ResearchEngine } from "./engine";
import { ProviderExecutor, registerProvider, resetProviderRegistry } from "./registry";
import { DatabaseResearchStorage } from "./storage";
import { JobFailure } from "../jobs/failures";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;

const RUN = `r${Date.now().toString(36)}`;

// Dedicated connection: the research storage layer takes an injected handle, so
// the suite never touches the application's own pool.
let testPool: pg.Pool;
let db!: NodePgDatabase<typeof schema>;

function source(nativeId: string, text: string, provider = "fake"): NormalizedSource {
  const canonicalUrl = `https://${RUN}.test/${nativeId}`;
  return {
    ref: { provider, kind: "article", nativeId, canonicalUrl },
    provider,
    backend: "b1",
    providerVersion: "1",
    retrievalMethod: "feed",
    accessClass: "open",
    canonicalUrl,
    title: `title ${nativeId}`,
    author: { name: "Ada" },
    publishedAt: new Date("2026-09-01T00:00:00Z").toISOString(),
    retrievedAt: new Date("2026-09-10T00:00:00Z").toISOString(),
    excerpt: text,
    contentHash: `hash-${nativeId}`,
    metadata: { feedUrl: "https://example.com/rss" },
  };
}

function fakeProvider(
  id: string,
  behaviour: () => Promise<NormalizedSource[]> | NormalizedSource[],
): ProviderDefinition {
  // A provider always stamps its own identity onto what it returns.
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

describeDb("research engine (db)", () => {
  let engine: ResearchEngine;
  const providerId = `${RUN}_ok`;
  const failingProviderId = `${RUN}_down`;
  const emptyProviderId = `${RUN}_empty`;

  before(async () => {
    if (!CONNECTION) return;
    testPool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(testPool, { schema });

    resetProviderRegistry();
    registerProvider(
      fakeProvider(providerId, () => [
        source("s1", "kubernetes pod scheduling deep dive"),
        source("s2", "a different passage about SRE"),
      ]),
    );
    registerProvider(
      fakeProvider(failingProviderId, () => {
        throw JobFailure.transient("provider is down");
      }),
    );
    // Succeeds, but genuinely yields nothing usable (Case C).
    registerProvider(fakeProvider(emptyProviderId, () => []));

    engine = new ResearchEngine({
      executor: new ProviderExecutor({ logSink: () => {} }),
      storage: new DatabaseResearchStorage(db),
      logSink: () => {},
    });
  });

  after(async () => {
    if (!CONNECTION) return;
    const jobs = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(like(researchJobs.correlationId, `${RUN}%`));
    const ids = jobs.map((job) => job.id);
    if (ids.length > 0) {
      await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, ids));
      await db.delete(researchSources).where(inArray(researchSources.jobId, ids));
      await db.delete(researchJobs).where(inArray(researchJobs.id, ids));
    }
    await testPool.end().catch(() => {});
  });

  it("completes a directed research job and records provenance", async () => {
    const result = await engine.run({
      kind: "directed",
      query: "kubernetes scheduling",
      providerIds: [providerId],
      correlationId: `${RUN}-c1`,
      idempotencyKey: `${RUN}-k1`,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.reused, false);
    assert.equal(result.evidenceCount, 2);

    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, result.jobId));
    assert.equal(job.status, "complete");
    assert.ok(job.finishedAt);
    assert.equal(job.correlationId, `${RUN}-c1`);

    const sources = await db
      .select()
      .from(researchSources)
      .where(eq(researchSources.jobId, result.jobId));
    assert.equal(sources.length, 2);
    // Provenance survives: provider, backend, version, retrieval method, URL.
    const one = sources.find((s) => s.nativeId === "s1")!;
    assert.equal(one.provider, providerId);
    assert.equal(one.backend, "b1");
    assert.equal(one.providerVersion, "1");
    assert.equal(one.retrievalMethod, "feed");
    assert.equal(one.accessClass, "open");
    assert.ok(one.canonicalUrl.startsWith(`https://${RUN}.test/`));

    const evidence = await db
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, result.jobId));
    assert.equal(evidence.length, 2);
    assert.ok(evidence.every((e) => e.origin === "sourced"));
    assert.ok(evidence.every((e) => e.kind === "excerpt"));
    assert.ok(evidence.every((e) => e.sourceId !== null), "evidence links to its source");
    assert.ok(evidence.every((e) => e.excerptHash.length === 64));
  });

  it("answers 'where did this come from?' from stored rows alone", async () => {
    const result = await engine.run({
      kind: "directed",
      query: "provenance check",
      providerIds: [providerId],
      correlationId: `${RUN}-c-prov`,
      idempotencyKey: `${RUN}-k-prov`,
    });

    const [evidence] = await db
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, result.jobId))
      .limit(1);
    const [source] = await db
      .select()
      .from(researchSources)
      .where(eq(researchSources.id, evidence.sourceId!));

    assert.equal(source.kind, "article");
    assert.ok(source.nativeId.length > 0);
    assert.ok(source.canonicalUrl.length > 0);
    assert.ok(source.retrievedAt instanceof Date);
    assert.equal(source.providerVersion, "1");
  });

  it("records a provider failure as degradation and still completes with partial data", async () => {
    const result = await engine.run({
      kind: "directed",
      query: "partial",
      providerIds: [failingProviderId, providerId],
      correlationId: `${RUN}-c2`,
      idempotencyKey: `${RUN}-k2`,
    });

    assert.equal(result.status, "complete", "one provider failing must not fail the job");
    const failedCall = result.diagnostics.find((d) => d.provider === failingProviderId);
    assert.ok(failedCall, "the failing provider is recorded");
    assert.equal(failedCall.outcome, "failed");
    assert.ok(failedCall.backendsAttempted.length > 0);

    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, result.jobId));
    assert.equal(job.status, "complete");
    const storedDiagnostics = job.diagnostics as unknown[];
    assert.ok(Array.isArray(storedDiagnostics) && storedDiagnostics.length >= 2);
  });

  it("Case A: fails TRANSIENTLY when every provider fails transiently (retryable)", async () => {
    const result = await engine.run({
      kind: "directed",
      query: "nothing",
      providerIds: [failingProviderId],
      correlationId: `${RUN}-c3`,
      idempotencyKey: `${RUN}-k3`,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "transient");
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, result.jobId));
    assert.equal(job.status, "failed");
    assert.ok(job.errorMessage);
    // The queue can retry this instead of dead-lettering a recoverable run.
    assert.equal(job.errorClass, "transient");
  });

  it("Case C: fails PERMANENTLY when a provider succeeds but yields no usable evidence", async () => {
    const result = await engine.run({
      kind: "directed",
      query: "empty",
      providerIds: [emptyProviderId],
      correlationId: `${RUN}-c3c`,
      idempotencyKey: `${RUN}-k3c`,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "permanent");
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, result.jobId));
    assert.equal(job.errorClass, "permanent");
  });

  it("reuses an existing job for the same idempotency key instead of re-running", async () => {
    const first = await engine.run({
      kind: "directed",
      query: "idempotent",
      providerIds: [providerId],
      correlationId: `${RUN}-c4`,
      idempotencyKey: `${RUN}-k4`,
    });
    const second = await engine.run({
      kind: "directed",
      query: "idempotent",
      providerIds: [providerId],
      correlationId: `${RUN}-c4-different`,
      idempotencyKey: `${RUN}-k4`,
    });

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.jobId, first.jobId, "no second job is created");
  });

  it("creates a NEW job on re-research rather than mutating history", async () => {
    const first = await engine.run({
      kind: "directed",
      query: "same subject",
      providerIds: [providerId],
      correlationId: `${RUN}-c5a`,
      idempotencyKey: `${RUN}-k5a`,
    });
    const second = await engine.run({
      kind: "directed",
      query: "same subject",
      providerIds: [providerId],
      correlationId: `${RUN}-c5b`,
      idempotencyKey: `${RUN}-k5b`,
    });

    assert.notEqual(second.jobId, first.jobId);

    const firstEvidence = await db
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, first.jobId));
    assert.equal(firstEvidence.length, 2, "the original job's evidence is untouched");
  });

  it("supports human input through author_statement evidence", async () => {
    const result = await engine.run({
      kind: "human_input",
      authorStatement: "We migrated 400 services to Crossplane in six months",
      providerIds: [],
      correlationId: `${RUN}-c6`,
      idempotencyKey: `${RUN}-k6`,
    });

    assert.equal(result.status, "complete");
    const evidence = await db
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, result.jobId));
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].kind, "author_statement");
    assert.equal(evidence[0].sourceId, null);
  });

  it("requires a query for directed research and a statement for human input", async () => {
    await assert.rejects(
      () =>
        engine.run({
          kind: "directed",
          providerIds: [providerId],
          correlationId: `${RUN}-c7`,
          idempotencyKey: `${RUN}-k7`,
        }),
      /requires a query/,
    );
    await assert.rejects(
      () =>
        engine.run({
          kind: "human_input",
          providerIds: [],
          correlationId: `${RUN}-c8`,
          idempotencyKey: `${RUN}-k8`,
        }),
      /authorStatement/,
    );
  });
});
