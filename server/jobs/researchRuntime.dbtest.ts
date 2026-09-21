/**
 * DB-backed tests for the `research.run` job type going through the real
 * pg-boss runtime: registration, execution, transient retry, terminal DLQ, and
 * duplicate-enqueue safety.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise). Uses its own pg-boss schema.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import type { ResearchJob } from "@shared/schema";
import type { ResearchRunResult } from "../research/engine";
import {
  RESEARCH_RUN_JOB_TYPE,
  registerResearchRunJob,
  type ResearchRunDeps,
} from "../research/job";
import { hasJob, resetJobRegistry } from "./registry";
import { JobRuntime } from "./runtime";

const CONNECTION = process.env.TEST_DATABASE_URL;
const SCHEMA = "pgboss_rt";
const describeDb = CONNECTION ? describe : describe.skip;

const RUN = `rt${Date.now().toString(36)}`;
const IDEM_WINDOW_SECONDS = 5;

function makeJob(id: number, overrides: Partial<ResearchJob> = {}): ResearchJob {
  return {
    id,
    userId: 1,
    correlationId: `${RUN}-corr-${id}`,
    idempotencyKey: `${RUN}-idem-${id}`,
    kind: "directed",
    query: "kubernetes",
    status: "queued",
    initiation: {},
    diagnostics: [],
    providerIds: [],
    errorClass: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as ResearchJob;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 25_000,
  label = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function alignToSingletonWindow(seconds: number): Promise<void> {
  const windowMs = seconds * 1000;
  while (Date.now() % windowMs > windowMs / 2) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describeDb("research.run job runtime (db)", () => {
  let runtime: JobRuntime;
  let admin: pg.Pool;

  const jobs = new Map<number, ResearchJob>();
  const calls: Record<number, number> = {};
  const behaviour = new Map<number, (attempt: number) => Partial<ResearchRunResult>>();

  before(async () => {
    admin = new pg.Pool({ connectionString: CONNECTION });
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);

    resetJobRegistry();

    const deps: ResearchRunDeps = {
      storage: {
        async getJob(jobId) {
          return jobs.get(jobId);
        },
      },
      engine: {
        async executeJob(job) {
          const attempt = (calls[job.id] = (calls[job.id] ?? 0) + 1);
          const outcome = behaviour.get(job.id)?.(attempt) ?? { status: "complete" };
          return {
            jobId: job.id,
            correlationId: job.correlationId,
            status: "complete",
            reused: false,
            sourceCount: 1,
            evidenceCount: 1,
            droppedCount: 0,
            dropped: [],
            diagnostics: [],
            ...outcome,
          } as ResearchRunResult;
        },
      },
    };

    registerResearchRunJob(deps, {
      retryLimit: 2,
      retryDelaySeconds: 1,
      retryBackoff: false,
      expireInSeconds: 60,
      singletonSeconds: IDEM_WINDOW_SECONDS,
    });

    runtime = new JobRuntime({ connectionString: CONNECTION!, schema: SCHEMA });
    await runtime.start();
  });

  after(async () => {
    await runtime.stop();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("registers research.run with the runtime", () => {
    assert.equal(hasJob(RESEARCH_RUN_JOB_TYPE), true);
  });

  it("runs a research job to completion", async () => {
    const job = makeJob(1);
    jobs.set(job.id, job);

    const result = await runtime.enqueue({
      jobType: RESEARCH_RUN_JOB_TYPE,
      payload: { jobId: job.id },
      correlationId: job.correlationId,
      idempotencyKey: job.idempotencyKey,
    });

    assert.ok(result.queueJobId);
    await waitFor(() => (calls[1] ?? 0) >= 1, 25_000, "research run execution");
    assert.equal(calls[1], 1);
  });

  it("retries a transient research failure and then completes", async () => {
    const job = makeJob(2);
    jobs.set(job.id, job);
    behaviour.set(job.id, (attempt) =>
      attempt < 2
        ? { status: "failed", failureClass: "transient", failureMessage: "feed down" }
        : { status: "complete" },
    );

    await runtime.enqueue({
      jobType: RESEARCH_RUN_JOB_TYPE,
      payload: { jobId: job.id },
      correlationId: job.correlationId,
      idempotencyKey: job.idempotencyKey,
    });

    await waitFor(() => (calls[2] ?? 0) >= 2, 25_000, "research retry");
    assert.equal(calls[2], 2);
  });

  it("dead-letters a permanent research failure", async () => {
    const job = makeJob(3);
    jobs.set(job.id, job);
    behaviour.set(job.id, () => ({
      status: "failed",
      failureClass: "permanent",
      failureMessage: "no evidence",
    }));

    await runtime.enqueue({
      jobType: RESEARCH_RUN_JOB_TYPE,
      payload: { jobId: job.id },
      correlationId: job.correlationId,
      idempotencyKey: job.idempotencyKey,
    });

    await waitFor(
      async () => {
        const result = await admin.query(
          `select count(*)::int c from ${SCHEMA}.job where name = $1`,
          [`${RESEARCH_RUN_JOB_TYPE}.dlq`],
        );
        return result.rows[0].c >= 1;
      },
      25_000,
      "research dead letter",
    );

    const dlq = await admin.query(
      `select data from ${SCHEMA}.job where name = $1`,
      [`${RESEARCH_RUN_JOB_TYPE}.dlq`],
    );
    const record = dlq.rows[0].data;
    assert.equal(record.jobType, RESEARCH_RUN_JOB_TYPE);
    assert.equal(record.failureClass, "permanent");
    assert.equal(record.error, "no evidence");
    assert.equal(record.envelope.correlationId, job.correlationId);
  });

  it("rejects a payload that fails schema validation", async () => {
    await assert.rejects(
      runtime.enqueue({
        jobType: RESEARCH_RUN_JOB_TYPE,
        payload: { jobId: -1 },
        correlationId: "bad",
        idempotencyKey: `${RUN}-bad`,
      }),
      /jobId/,
    );
  });

  it("deduplicates a duplicate enqueue by idempotency key", async () => {
    const job = makeJob(4);
    jobs.set(job.id, job);
    await alignToSingletonWindow(IDEM_WINDOW_SECONDS);

    const first = await runtime.enqueue({
      jobType: RESEARCH_RUN_JOB_TYPE,
      payload: { jobId: job.id },
      correlationId: job.correlationId,
      idempotencyKey: job.idempotencyKey,
    });
    const second = await runtime.enqueue({
      jobType: RESEARCH_RUN_JOB_TYPE,
      payload: { jobId: job.id },
      correlationId: job.correlationId,
      idempotencyKey: job.idempotencyKey,
    });

    assert.equal(first.deduplicated, false);
    assert.equal(second.queueJobId, null);
    assert.equal(second.deduplicated, true);
  });
});
