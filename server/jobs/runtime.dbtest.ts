/**
 * DB-backed tests for the durable job runtime.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise). The runtime uses its own
 * pg-boss schema so it never touches application queue state.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { z } from "zod";
import pg from "pg";
import { JobFailure } from "./failures";
import { registerJob, resetJobRegistry } from "./registry";
import { JobRuntime } from "./runtime";

const CONNECTION = process.env.TEST_DATABASE_URL;
const SCHEMA = "pgboss_test";
const describeDb = CONNECTION ? describe : describe.skip;

const RUN = `t${Date.now().toString(36)}`;
const LOGS: string[] = [];

function jobType(name: string): string {
  return `${RUN}.${name}`;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
  label = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * pg-boss derives its enqueue-dedupe bucket as
 *   epoch + singletonSeconds * floor(epoch(now) / singletonSeconds)
 * so two sends only collapse when they land in the same bucket. Wait until the
 * start of a fresh bucket before sending the pair, so the assertion is stable.
 */
async function alignToSingletonWindow(seconds: number): Promise<void> {
  const windowMs = seconds * 1000;
  while (Date.now() % windowMs > windowMs / 2) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

describeDb("job runtime (db)", () => {
  let runtime: JobRuntime;
  let admin: pg.Pool;

  const happy = jobType("happy");
  const flaky = jobType("flaky");
  const terminal = jobType("terminal");
  const idem = jobType("idem");

  const IDEM_WINDOW_SECONDS = 10;
  const delivered: string[] = [];
  const attempts: Record<string, number> = {};

  before(async () => {
    admin = new pg.Pool({ connectionString: CONNECTION });
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);

    resetJobRegistry();

    registerJob({
      jobType: happy,
      payloadSchema: z.object({ label: z.string() }),
      handler: async (payload) => {
        delivered.push(payload.label);
      },
    });

    registerJob({
      jobType: flaky,
      payloadSchema: z.object({ key: z.string() }),
      queue: { retryLimit: 3, retryDelaySeconds: 1, retryBackoff: false },
      handler: async (_payload, ctx) => {
        attempts[ctx.idempotencyKey] = ctx.attempt;
        if (ctx.attempt < 2) throw JobFailure.transient("flaky by design");
      },
    });

    registerJob({
      jobType: terminal,
      payloadSchema: z.object({ key: z.string() }),
      queue: { retryLimit: 5 },
      handler: async () => {
        throw JobFailure.permanent("never retry me");
      },
    });

    registerJob({
      jobType: idem,
      payloadSchema: z.object({ key: z.string() }),
      queue: { retryLimit: 0, singletonSeconds: IDEM_WINDOW_SECONDS },
      handler: async () => {
        await new Promise((r) => setTimeout(r, 400));
      },
    });

    runtime = new JobRuntime({
      connectionString: CONNECTION!,
      schema: SCHEMA,
      logSink: (line) => LOGS.push(line),
    });
    await runtime.start();
  });

  after(async () => {
    await runtime.stop();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("runs an enqueued job to completion", async () => {
    await runtime.enqueue({
      jobType: happy,
      payload: { label: "hello" },
      correlationId: "corr-happy",
      idempotencyKey: `${RUN}-happy-1`,
    });

    await waitFor(() => delivered.includes("hello"), 20_000, "happy job");
    assert.deepEqual(delivered, ["hello"]);
  });

  it("rejects a payload that fails schema validation", async () => {
    await assert.rejects(
      runtime.enqueue({
        jobType: happy,
        payload: { label: 123 },
        correlationId: "corr-bad",
        idempotencyKey: `${RUN}-bad-1`,
      }),
      /label/,
    );
  });

  it("deduplicates a second enqueue with the same idempotency key", async () => {
    const key = `${RUN}-idem-1`;
    await alignToSingletonWindow(IDEM_WINDOW_SECONDS);

    const first = await runtime.enqueue({
      jobType: idem,
      payload: { key },
      correlationId: "corr-idem",
      idempotencyKey: key,
    });
    const second = await runtime.enqueue({
      jobType: idem,
      payload: { key },
      correlationId: "corr-idem",
      idempotencyKey: key,
    });

    assert.ok(first.queueJobId);
    assert.equal(first.deduplicated, false);
    assert.equal(second.queueJobId, null);
    assert.equal(second.deduplicated, true);
  });

  it("retries a transient failure and succeeds on a later attempt", async () => {
    const key = `${RUN}-flaky-1`;
    await runtime.enqueue({
      jobType: flaky,
      payload: { key },
      correlationId: "corr-flaky",
      idempotencyKey: key,
    });

    await waitFor(() => attempts[key] === 2, 25_000, "flaky retry");
    assert.equal(attempts[key], 2);
  });

  it("dead-letters a permanent failure without consuming retries", async () => {
    const key = `${RUN}-terminal-1`;
    await runtime.enqueue({
      jobType: terminal,
      payload: { key },
      correlationId: "corr-terminal",
      idempotencyKey: key,
    });

    await waitFor(
      async () => {
        const r = await admin.query(
          `select count(*)::int c from ${SCHEMA}.job where name = $1`,
          [`${terminal}.dlq`],
        );
        return r.rows[0].c >= 1;
      },
      20_000,
      "dead letter entry",
    );

    const dlq = await admin.query(
      `select data from ${SCHEMA}.job where name = $1`,
      [`${terminal}.dlq`],
    );
    const record = dlq.rows[0].data;
    assert.equal(record.jobType, terminal);
    assert.equal(record.failureClass, "permanent");
    assert.equal(record.error, "never retry me");
    assert.equal(record.envelope.correlationId, "corr-terminal");
  });

  it("dead-letters an unparseable envelope", async () => {
    const boss = runtime.getBoss();
    await boss.send(happy, { not: "an envelope" } as never);

    await waitFor(
      async () => {
        const r = await admin.query(
          `select count(*)::int c from ${SCHEMA}.job where name = $1 and data->>'reason' = 'invalid_envelope'`,
          [`${happy}.dlq`],
        );
        return r.rows[0].c >= 1;
      },
      20_000,
      "invalid envelope dead letter",
    );
  });

  it("logs job identity with a correlation id", () => {
    const completed = LOGS.map((l) => JSON.parse(l)).find(
      (l) => l.msg === "job completed" && l.correlationId === "corr-happy",
    );
    assert.ok(completed, "expected a completion log line");
    assert.equal(completed.jobType, happy);
    assert.ok(completed.attempt >= 1);
    assert.ok(typeof completed.durationMs === "number");
    assert.equal(completed.outcome, "completed");
  });

  it("shuts down gracefully", async () => {
    const throwaway = new JobRuntime({
      connectionString: CONNECTION!,
      schema: SCHEMA,
      logSink: () => {},
    });
    await throwaway.start();
    assert.equal(throwaway.isStarted(), true);
    await throwaway.stop();
    assert.equal(throwaway.isStarted(), false);
  });
});
