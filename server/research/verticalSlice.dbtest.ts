/**
 * End-to-end vertical slice against PostgreSQL.
 *
 * HTTP API -> ResearchJob (durable) -> pg-boss -> research.run -> registered RSS
 * provider (reading rss_sources) -> NormalizedSource -> research engine ->
 * persisted sources/evidence. No network: RSS feed parsing is injected, but
 * every other layer is real.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise). Uses its own pg-boss schema.
 */

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { researchEvidence, researchJobs, researchSources, rssSources } from "@shared/schema";
import { RESEARCH_RUN_JOB_TYPE, registerResearchRunJob } from "./job";
import { createRssConfigLoader } from "./providers/rssConfig";
import { createRssProvider } from "./providers/rss";
import { ProviderExecutor, registerProvider, resetProviderRegistry } from "./registry";
import { ResearchEngine } from "./engine";
import { DatabaseResearchStorage } from "./storage";
import { createResearchRouter } from "./routes";
import { resetJobRegistry } from "../jobs/registry";
import { JobRuntime } from "../jobs/runtime";

const CONNECTION = process.env.TEST_DATABASE_URL;
const SCHEMA = "pgboss_vs";
const describeDb = CONNECTION ? describe : describe.skip;

const RUN = `vs${Date.now().toString(36)}`;
const FEED_URL = "https://example.com/feed.xml";

async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 30_000,
  label = "condition",
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describeDb("research vertical slice (db)", () => {
  let pool: pg.Pool;
  let db: NodePgDatabase<typeof schema>;
  let runtime: JobRuntime;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });

    // An RSS source configured the existing way.
    await db.insert(rssSources).values({
      userId: 1,
      name: `${RUN}-feed`,
      feedUrl: FEED_URL,
      isActive: true,
    });

    resetProviderRegistry();
    registerProvider(
      createRssProvider({
        parseFeed: async () => ({
          title: "Example Feed",
          items: [
            {
              title: "Kubernetes scheduling deep dive",
              link: `https://example.com/${RUN}/k8s`,
              guid: `${RUN}-k8s`,
              isoDate: "2026-09-01T00:00:00Z",
              contentSnippet: "kubernetes pod scheduling across nodes",
            },
            {
              title: "SRE notes",
              link: `https://example.com/${RUN}/sre`,
              guid: `${RUN}-sre`,
              isoDate: "2026-09-02T00:00:00Z",
              contentSnippet: "operating systems in production",
            },
          ],
        }),
        fetchArticle: async () => {
          throw new Error("article fetch not expected in this slice");
        },
        loadConfig: createRssConfigLoader(db),
      }),
    );

    const storage = new DatabaseResearchStorage(db);
    const engine = new ResearchEngine({
      executor: new ProviderExecutor({ logSink: () => {} }),
      storage,
      logSink: () => {},
    });

    resetJobRegistry();
    registerResearchRunJob({ engine, storage });

    runtime = new JobRuntime({ connectionString: CONNECTION, schema: SCHEMA });
    await runtime.start();

    const app = express();
    app.use(express.json());
    app.use(
      "/api/research",
      createResearchRouter({
        storage,
        enqueueResearchRun: async (job) => {
          await runtime.enqueue({
            jobType: RESEARCH_RUN_JOB_TYPE,
            payload: { jobId: job.id },
            correlationId: job.correlationId,
            idempotencyKey: job.idempotencyKey,
          });
        },
      }),
    );

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (!CONNECTION) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.stop();

    const jobs = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(like(researchJobs.correlationId, `${RUN}%`));
    const ids = jobs.map((job) => job.id);
    for (const id of ids) {
      await db.delete(researchEvidence).where(eq(researchEvidence.jobId, id));
      await db.delete(researchSources).where(eq(researchSources.jobId, id));
      await db.delete(researchJobs).where(eq(researchJobs.id, id));
    }
    await db.delete(rssSources).where(eq(rssSources.name, `${RUN}-feed`));

    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  });

  async function postJob(body: unknown) {
    const response = await fetch(`${baseUrl}/api/research/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function getJob(id: number) {
    const response = await fetch(`${baseUrl}/api/research/jobs/${id}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it("creates a research job durably and returns it", async () => {
    const { status, body } = await postJob({
      kind: "directed",
      query: "kubernetes",
      idempotencyKey: `${RUN}-create-1`,
    });

    assert.equal(status, 201);
    assert.ok(typeof body.id === "number");
    assert.equal(body.kind, "directed");
    assert.deepEqual(body.providerIds, ["rss"]);
    assert.ok(typeof body.correlationId === "string");
    assert.equal(body.status, "queued");
  });

  it("executes through the queue and persists sources and evidence", async () => {
    const created = await postJob({
      kind: "directed",
      query: "kubernetes",
      idempotencyKey: `${RUN}-run-1`,
    });
    const jobId = created.body.id as number;

    const completed = await waitFor(async () => {
      const { body } = await getJob(jobId);
      return body.status === "complete" ? body : undefined;
    }, 30_000, "research completion");

    assert.equal(completed.status, "complete");
    assert.ok((completed.sourceCount as number) >= 1);
    assert.ok((completed.evidenceCount as number) >= 1);
    assert.ok(completed.finishedAt);

    const sourcesResponse = await fetch(`${baseUrl}/api/research/jobs/${jobId}/sources`);
    const sources = (await sourcesResponse.json()) as Array<Record<string, unknown>>;
    assert.ok(sources.length >= 1);
    assert.equal(sources[0].provider, "rss");
    assert.equal(sources[0].backend, "rss-parser");
    assert.equal(sources[0].retrievalMethod, "feed");

    const evidenceResponse = await fetch(`${baseUrl}/api/research/jobs/${jobId}/evidence`);
    const evidence = (await evidenceResponse.json()) as Array<Record<string, unknown>>;
    assert.ok(evidence.length >= 1);
    assert.equal(evidence[0].origin, "sourced");
    assert.equal((evidence[0].excerptHash as string).length, 64);
    assert.ok(evidence[0].sourceId !== null);
  });

  it("returns the same job for a duplicate idempotency key", async () => {
    const key = `${RUN}-dup-1`;
    const first = await postJob({ kind: "directed", query: "kubernetes", idempotencyKey: key });
    const second = await postJob({ kind: "directed", query: "kubernetes", idempotencyKey: key });

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id);
  });

  it("does not duplicate research when a completed job is re-enqueued", async () => {
    const created = await postJob({
      kind: "directed",
      query: "kubernetes",
      idempotencyKey: `${RUN}-stable-1`,
    });
    const jobId = created.body.id as number;

    await waitFor(async () => {
      const { body } = await getJob(jobId);
      return body.status === "complete" ? body : undefined;
    }, 30_000, "initial completion");

    const before = await db
      .select({ id: researchEvidence.id })
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, jobId));

    // Same idempotency key again: the job is complete, so nothing is re-run.
    const again = await postJob({
      kind: "directed",
      query: "kubernetes",
      idempotencyKey: `${RUN}-stable-1`,
    });
    assert.equal(again.body.id, jobId);
    await new Promise((resolve) => setTimeout(resolve, 750));

    const after = await db
      .select({ id: researchEvidence.id })
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, jobId));
    assert.equal(after.length, before.length);
  });

  it("rejects a directed request without a query", async () => {
    const { status } = await postJob({ kind: "directed", idempotencyKey: `${RUN}-invalid` });
    assert.equal(status, 400);
  });

  it("rejects an unknown provider before creating a job", async () => {
    const { status, body } = await postJob({
      kind: "directed",
      query: "kubernetes",
      providerIds: ["not-a-provider"],
      idempotencyKey: `${RUN}-unknown-provider`,
    });
    assert.equal(status, 400);
    assert.match(String(body.message), /Unknown provider/);
  });

  it("404s an unknown research job", async () => {
    const { status } = await getJob(2_000_000_000);
    assert.equal(status, 404);
  });
});
