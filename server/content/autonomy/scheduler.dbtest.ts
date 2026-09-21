/**
 * Phase 31 §29 — durable scheduler proofs against the REAL pg-boss runtime
 * (isolated `pgboss_sched` schema) and the REAL autonomy controller.
 *
 * Each test seeds its own owner(s) so budgets/cooldowns never interfere.
 * Proves: durable creation, sweep activation, kill switch, mode, automation
 * flag, breaker, evidence floor, guardrails, budget, cooldown, cross-owner
 * denial, duplicate-delivery safety, 10-way concurrency, scope independence,
 * restart recovery, stale-candidate handling, transient-failure retry
 * classification, and that human 29.3 activation still works.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and as andOp, eq, gte, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import {
  experiments,
  experimentVariants,
  experimentEvaluations,
  policyCandidates,
  policyActivations,
  autonomyConfigs,
  autonomyDecisions,
} from "@shared/schema";
import { getOrCreateAutonomyConfig, updateAutonomyConfig } from "./config";
import { activatePolicyCandidate } from "../policyActivation/activation";
import { resetJobRegistry, getJob } from "../../jobs/registry";
import type { JobContext } from "../../jobs/registry";
import { JobRuntime } from "../../jobs/runtime";
import { JobFailure } from "../../jobs/failures";
import {
  AUTONOMY_EVALUATE_JOB_TYPE,
  registerAutonomyEvaluateJob,
  enqueueAutonomyEvaluation,
} from "./job";
import { reconcileAutonomySchedule } from "./scheduler";

const CONNECTION = process.env.TEST_DATABASE_URL;
const SCHEMA = "pgboss_sched";
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `as${Date.now().toString(36)}`;
const OWNER = 970_000 + (Date.now() % 20_000);

function owner(i: number): number {
  return OWNER + i * 100;
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

function testLogger() {
  const lines: Array<{ level: string; message: string }> = [];
  const sink = (level: string) => (fields: Record<string, unknown>, message: string) => {
    lines.push({ level, message: `${message} ${JSON.stringify(fields)}` });
  };
  return {
    lines,
    logger: { info: sink("info"), warn: sink("warn"), error: sink("error") },
  };
}

function testCtx(overrides: Partial<JobContext> = {}): JobContext {
  const t = testLogger();
  return {
    jobId: "test-job",
    jobType: AUTONOMY_EVALUATE_JOB_TYPE,
    correlationId: "test-corr",
    attempt: 1,
    maxAttempts: 4,
    idempotencyKey: "test-key",
    signal: new AbortController().signal,
    logger: t.logger,
    ...overrides,
  };
}

describeDb("durable autonomous scheduler (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  let admin: pg.Pool;
  let runtime: JobRuntime;

  async function seedEligibleCandidate(
    o: number,
    opts: { scope?: string; evidenceQuality?: string; guardrailRegressed?: boolean } = {},
  ) {
    const tag = `${RUN}-o${o}-${Math.random().toString(36).slice(2, 8)}`;
    const scope = opts.scope ?? `channel:x;format:post-${tag}`;
    const [exp] = await db
      .insert(experiments)
      .values({
        userId: o,
        name: `Exp ${tag}`,
        hypothesis: "h",
        objective: "o",
        targetScope: scope,
        experimentType: "format_distribution",
        primaryMetric: "engagements_per_post",
        status: "completed",
        decision: "variant_preferred",
        identityKey: `as-exp:${tag}`,
      })
      .returning();
    const [variant] = await db
      .insert(experimentVariants)
      .values({
        userId: o,
        experimentId: exp.id,
        variantKey: "variant_a",
        name: "Variant A",
        isControl: false,
        policySnapshot: { objective: `Tested ${tag}` },
        trafficWeight: 50,
      })
      .returning();
    const [evaluation] = await db
      .insert(experimentEvaluations)
      .values({
        userId: o,
        experimentId: exp.id,
        evaluationWindow: "final",
        primaryMetric: "engagements_per_post",
        evidenceQuality: opts.evidenceQuality ?? "repeatable",
        recommendedDecision: "variant_preferred",
        guardrailResults: opts.guardrailRegressed
          ? [{ metric: "m", controlValue: "1%", variantValue: "20%", differencePercentage: "19%", status: "regressed" }]
          : [],
        summary: "s",
        identityKey: `as-eval:${tag}`,
      })
      .returning();
    const [candidate] = await db
      .insert(policyCandidates)
      .values({
        userId: o,
        experimentId: exp.id,
        variantId: variant.id,
        evaluationId: evaluation.id,
        title: `Candidate ${tag}`,
        rationale: "r",
        targetScope: scope,
        proposedConfiguration: { objective: `Tested config ${tag}` },
        status: "approved_for_future",
        identityKey: `as-cand:${tag}`,
      })
      .returning();
    return { candidate, scope };
  }

  async function fullyEnable(o: number, patch: Record<string, unknown> = {}) {
    await getOrCreateAutonomyConfig(db, o);
    return updateAutonomyConfig(
      db,
      o,
      {
        enabled: true,
        mode: "bounded_activation",
        activationAutomationEnabled: true,
        rollbackEnabled: true,
        minimumEvidenceQuality: "repeatable",
        maxActivationsPerDay: 5,
        maxActivationsPerWeek: 10,
        maxConsecutiveActivations: 5,
        cooldownMinutes: 0,
        ...patch,
      } as Parameters<typeof updateAutonomyConfig>[2],
      o,
    );
  }

  async function activationCount(o: number): Promise<number> {
    const rows = await db
      .select({ id: policyActivations.id })
      .from(policyActivations)
      .where(
        andOp(eq(policyActivations.userId, o), eq(policyActivations.actor, "autonomous_controller")),
      );
    return rows.length;
  }

  async function decisionCodes(o: number): Promise<string[]> {
    const rows = await db
      .select({ code: autonomyDecisions.code })
      .from(autonomyDecisions)
      .where(eq(autonomyDecisions.userId, o));
    return rows.map((r) => String(r.code));
  }

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    admin = new pg.Pool({ connectionString: CONNECTION });
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    resetJobRegistry();
    registerAutonomyEvaluateJob(
      { db, getRuntime: () => runtime },
      { retryDelaySeconds: 1, retryBackoff: false, singletonSeconds: 5, expireInSeconds: 120 },
    );
    runtime = new JobRuntime({ connectionString: CONNECTION!, schema: SCHEMA });
    await runtime.start();
  });

  after(async () => {
    if (!CONNECTION) return;
    await runtime.stop().catch(() => {});
    const inRange = (col: any) => andOp(gte(col, OWNER), lt(col, OWNER + 20_000));
    await db.delete(autonomyDecisions).where(inRange(autonomyDecisions.userId));
    await db.delete(autonomyConfigs).where(inRange(autonomyConfigs.userId));
    await db.delete(policyActivations).where(inRange(policyActivations.userId));
    await db.delete(policyCandidates).where(inRange(policyCandidates.userId));
    await db.delete(experimentEvaluations).where(inRange(experimentEvaluations.userId));
    await db.delete(experimentVariants).where(inRange(experimentVariants.userId));
    await db.delete(experiments).where(inRange(experiments.userId));
    await db
      .delete(schema.generationPolicies)
      .where(inRange(schema.generationPolicies.userId));
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
    await pool.end();
  });

  it("creates durable work visible in the pg-boss schema", async () => {
    const o = owner(1);
    const { scope } = await seedEligibleCandidate(o);
    await fullyEnable(o);
    const result = await enqueueAutonomyEvaluation(runtime, {
      ownerId: o,
      targetScope: scope,
      correlationId: `${RUN}-durable`,
    });
    assert.ok(result.queueJobId, "job persisted with a queue id");
    assert.equal(result.deduplicated, false);
    const rows = await admin.query(`select id from ${SCHEMA}.job limit 1`);
    assert.ok(rows.rowCount !== null && rows.rowCount >= 1, "job row durable in pg-boss schema");
  });

  it("sweep executes an eligible candidate through the controller", async () => {
    const o = owner(2);
    const { scope, candidate } = await seedEligibleCandidate(o);
    await fullyEnable(o);
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-sweep` });
    await waitFor(async () => (await activationCount(o)) >= 1, 25_000, "autonomous activation");
    const [activation] = await db
      .select()
      .from(policyActivations)
      .where(andOp(eq(policyActivations.userId, o), eq(policyActivations.actor, "autonomous_controller")));
    assert.ok(activation, "activation journaled with autonomous actor");
    assert.equal(activation.policyCandidateId, candidate.id);
  });

  it("kill switch denies without activation", async () => {
    const o = owner(3);
    const { scope } = await seedEligibleCandidate(o);
    await getOrCreateAutonomyConfig(db, o); // defaults: disabled
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-kill` });
    await waitFor(async () => (await decisionCodes(o)).length >= 1, 25_000, "deny decision");
    assert.equal(await activationCount(o), 0);
    assert.ok((await decisionCodes(o)).some((c) => /DISABLED|UNCONFIGURED/.test(c)));
  });

  it("non-bounded mode denies without activation", async () => {
    const o = owner(4);
    const { scope } = await seedEligibleCandidate(o);
    await fullyEnable(o, { mode: "observe_only" });
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-mode` });
    await waitFor(async () => (await decisionCodes(o)).length >= 1, 25_000, "deny decision");
    assert.equal(await activationCount(o), 0);
  });

  it("automation flag off denies without activation", async () => {
    const o = owner(5);
    const { scope } = await seedEligibleCandidate(o);
    await fullyEnable(o, { activationAutomationEnabled: false });
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-flag` });
    await waitFor(async () => (await decisionCodes(o)).length >= 1, 25_000, "deny decision");
    assert.equal(await activationCount(o), 0);
  });

  it("open breaker denies without activation", async () => {
    const o = owner(6);
    const { scope } = await seedEligibleCandidate(o);
    await fullyEnable(o);
    const { openCircuitBreaker } = await import("./config");
    await openCircuitBreaker(db, o, "test");
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-breaker` });
    await waitFor(async () => (await decisionCodes(o)).length >= 1, 25_000, "deny decision");
    assert.equal(await activationCount(o), 0);
    assert.ok((await decisionCodes(o)).some((c) => /CIRCUIT/.test(c)));
  });

  it("insufficient evidence denies without activation", async () => {
    const o = owner(7);
    const { scope } = await seedEligibleCandidate(o, { evidenceQuality: "observed" });
    await fullyEnable(o, { minimumEvidenceQuality: "repeatable" });
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-ev` });
    await waitFor(async () => (await decisionCodes(o)).length >= 1, 25_000, "deny decision");
    assert.equal(await activationCount(o), 0);
  });

  it("regressed guardrail denies without activation", async () => {
    const o = owner(8);
    const { scope } = await seedEligibleCandidate(o, { guardrailRegressed: true });
    await fullyEnable(o);
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-guard` });
    await waitFor(async () => (await decisionCodes(o)).length >= 1, 25_000, "deny decision");
    assert.equal(await activationCount(o), 0);
  });

  it("daily budget is enforced across scheduled executions", async () => {
    const o = owner(9);
    const first = await seedEligibleCandidate(o);
    const second = await seedEligibleCandidate(o);
    await fullyEnable(o, { maxActivationsPerDay: 1, maxActivationsPerWeek: 10 });
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: first.scope, correlationId: `${RUN}-b1` });
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: second.scope, correlationId: `${RUN}-b2` });
    await waitFor(async () => (await decisionCodes(o)).length >= 2, 25_000, "both decisions");
    assert.equal(await activationCount(o), 1, "exactly one activation under a daily budget of 1");
    assert.ok((await decisionCodes(o)).some((c) => /BUDGET/.test(c)));
  });

  it("cooldown cannot be bypassed by a second scheduled job", async () => {
    const o = owner(10);
    const scope = "channel:x;format:post-cooldown";
    const first = await seedEligibleCandidate(o, { scope });
    // Second candidate, same scope (same policy key) for the cooldown check.
    const tag = `${RUN}-cd2`;
    const [exp] = await db
      .insert(experiments)
      .values({
        userId: o, name: `Exp ${tag}`, hypothesis: "h", objective: "o", targetScope: scope,
        experimentType: "format_distribution", primaryMetric: "engagements_per_post",
        status: "completed", decision: "variant_preferred", identityKey: `as-exp:${tag}`,
      })
      .returning();
    const [variant] = await db
      .insert(experimentVariants)
      .values({
        userId: o, experimentId: exp.id, variantKey: "variant_a", name: "A", isControl: false,
        policySnapshot: { objective: tag }, trafficWeight: 50,
      })
      .returning();
    const [evaluation] = await db
      .insert(experimentEvaluations)
      .values({
        userId: o, experimentId: exp.id, evaluationWindow: "final",
        primaryMetric: "engagements_per_post", evidenceQuality: "repeatable",
        recommendedDecision: "variant_preferred", guardrailResults: [], summary: "s",
        identityKey: `as-eval:${tag}`,
      })
      .returning();
    await db.insert(policyCandidates).values({
      userId: o, experimentId: exp.id, variantId: variant.id, evaluationId: evaluation.id,
      title: `Candidate ${tag}`, rationale: "r", targetScope: scope,
      proposedConfiguration: { objective: tag }, status: "approved_for_future",
      identityKey: `as-cand:${tag}`,
    });
    await fullyEnable(o, { maxActivationsPerDay: 5, maxActivationsPerWeek: 10, cooldownMinutes: 60 });
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-c1` });
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-c2`, at: new Date(Date.now() + 3_600_000) });
    await waitFor(async () => (await activationCount(o)) >= 1, 25_000, "first activation");
    await waitFor(async () => (await decisionCodes(o)).length >= 2, 25_000, "both decisions");
    assert.equal(await activationCount(o), 1, "cooldown blocks the second activation");
    void first;
  });

  it("cross-owner execution is denied", async () => {
    const a = owner(11);
    const b = owner(12);
    const seeded = await seedEligibleCandidate(b);
    await fullyEnable(a);
    await fullyEnable(b);
    // Targeted payload naming B's candidate under A's identity: the
    // controller must deny on ownership, never activate.
    await enqueueAutonomyEvaluation(runtime, {
      ownerId: a,
      targetScope: seeded.scope,
      candidateId: seeded.candidate.id,
      correlationId: `${RUN}-xowner`,
    });
    await waitFor(async () => (await decisionCodes(a)).length >= 1, 25_000, "deny decision");
    assert.equal(await activationCount(a), 0);
    assert.equal(await activationCount(b), 0, "B's candidate untouched");
    assert.ok((await decisionCodes(a)).some((c) => /UNKNOWN_STATE|FORBIDDEN/.test(c)));
  });

  it("duplicate enqueue within the window collapses to one job", async () => {
    const o = owner(13);
    const { scope } = await seedEligibleCandidate(o);
    await fullyEnable(o);
    const at = new Date();
    const first = await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-dup`, at });
    const second = await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: scope, correlationId: `${RUN}-dup`, at });
    assert.ok(first.queueJobId);
    assert.equal(second.deduplicated, true, "same key in window deduplicates");
    assert.equal(second.queueJobId, null);
    await waitFor(async () => (await activationCount(o)) >= 1, 25_000, "single activation");
    // Budget 5/day: even if both somehow executed, controller idempotency
    // (alreadyActivated + budgets) bounds the outcome; assert at most one.
    assert.ok((await activationCount(o)) <= 1);
  });

  it("10 simultaneous same-owner same-scope triggers yield at most one activation", async () => {
    const o = owner(14);
    const { scope } = await seedEligibleCandidate(o);
    await fullyEnable(o, { maxActivationsPerDay: 5, maxActivationsPerWeek: 10 });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        enqueueAutonomyEvaluation(runtime, {
          ownerId: o,
          targetScope: scope,
          correlationId: `${RUN}-race-${i}`,
          at: new Date(Date.now() + i * 3_600_000),
        }),
      ),
    );
    await waitFor(async () => (await decisionCodes(o)).length >= 10, 40_000, "all executions decided");
    assert.ok((await activationCount(o)) <= 1, "per-owner lock serializes to at most one activation");
  });

  it("same owner different scopes activate independently", async () => {
    const o = owner(15);
    const first = await seedEligibleCandidate(o);
    const second = await seedEligibleCandidate(o);
    await fullyEnable(o, { maxActivationsPerDay: 5, maxActivationsPerWeek: 10 });
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: first.scope, correlationId: `${RUN}-s1` });
    await enqueueAutonomyEvaluation(runtime, { ownerId: o, targetScope: second.scope, correlationId: `${RUN}-s2` });
    await waitFor(async () => (await activationCount(o)) >= 2, 25_000, "both scopes activate");
  });

  it("10 executions across different owners activate independently", async () => {
    // NOTE ordering: this test must run before the restart test (which swaps
    // the suite runtime) and away from the reconcile test (whose enqueued jobs
    // would contend for the single test worker). It proves owner isolation
    // under concurrency, not worker throughput.
    const seeds = await Promise.all(
      Array.from({ length: 10 }, (_, i) => seedEligibleCandidate(owner(21 + i))),
    );
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => fullyEnable(owner(21 + i))),
    );
    await Promise.all(
      seeds.map((s, i) =>
        enqueueAutonomyEvaluation(runtime, {
          ownerId: owner(21 + i),
          targetScope: s.scope,
          correlationId: `${RUN}-multi-${i}`,
        }),
      ),
    ).then((outcomes) => {
      outcomes.forEach((o, i) => {
        assert.ok(o.queueJobId, `job ${i} persisted (not deduplicated)`);
      });
    });
    await waitFor(
      async () => {
        for (let i = 0; i < 10; i++) {
          if ((await activationCount(owner(21 + i))) < 1) return false;
        }
        return true;
      },
      90_000,
      "all owners activate",
    );
    // No owner sees another owner's activation.
    for (let i = 0; i < 10; i++) {
      assert.equal(await activationCount(owner(21 + i)), 1);
    }
  });

  it("restart recovers a pending job without loss", async () => {
    const o = owner(16);
    const { scope } = await seedEligibleCandidate(o);
    await fullyEnable(o);
    await runtime.enqueue({
      jobType: AUTONOMY_EVALUATE_JOB_TYPE,
      payload: { ownerId: o, targetScope: scope, correlationId: `${RUN}-restart` },
      correlationId: `${RUN}-restart`,
      idempotencyKey: `autonomy-evaluate:${o}:${scope}:restart:${Date.now()}`,
      startAfter: new Date(Date.now() + 2000),
    });
    await runtime.stop();
    // The registry is process-global: the fresh runtime picks up the already
    // registered job type on start. Pending jobs survive in the schema.
    const { JobRuntime: FreshRuntime } = await import("../../jobs/runtime");
    const fresh = new FreshRuntime({ connectionString: CONNECTION!, schema: SCHEMA });
    await fresh.start();
    try {
      await waitFor(async () => (await activationCount(o)) >= 1, 30_000, "post-restart activation");
    } finally {
      await fresh.stop().catch(() => {});
    }
    // Restore the suite runtime for remaining tests.
    runtime = new JobRuntime({ connectionString: CONNECTION!, schema: SCHEMA });
    await runtime.start();
  });

  it("stale candidate completes quietly without activation", async () => {
    const o = owner(17);
    await fullyEnable(o);
    const def = getJob(AUTONOMY_EVALUATE_JOB_TYPE);
    assert.ok(def);
    await def.handler(
      { ownerId: o, targetScope: "channel:x;format:post", correlationId: `${RUN}-stale`, candidateId: 2_000_000_000 },
      testCtx(),
    );
    assert.equal(await activationCount(o), 0);
  });

  it("scope-moved candidate completes quietly without activation", async () => {
    const o = owner(18);
    const { candidate } = await seedEligibleCandidate(o);
    await fullyEnable(o);
    const def = getJob(AUTONOMY_EVALUATE_JOB_TYPE);
    assert.ok(def);
    await def.handler(
      { ownerId: o, targetScope: "channel:other;format:other", correlationId: `${RUN}-moved`, candidateId: candidate.id },
      testCtx(),
    );
    assert.equal(await activationCount(o), 0);
  });

  it("unexpected handler errors classify as transient (retryable)", async () => {
    // The handler converts every unexpected throw to JobFailure.transient;
    // DENYs never throw (they complete). Here we pin the classification
    // contract the handler relies on.
    const { classifyError } = await import("../../jobs/failures");
    assert.equal(classifyError(new Error("boom")), "transient");
    assert.equal(classifyError(JobFailure.permanent("nope")), "permanent");
    assert.equal(classifyError(JobFailure.policyHuman("needs human")), "policy_human");
  });

  it("reconcile discovers due pairs and enqueues without duplicates", async () => {
    const o = owner(19);
    const { scope } = await seedEligibleCandidate(o);
    await fullyEnable(o);
    const { reconcileAutonomySchedule: reconcile } = await import("./scheduler");
    const first = await reconcile(db, runtime);
    assert.ok(first.pairs >= 1);
    assert.ok(first.enqueued >= 1);
    const second = await reconcile(db, runtime);
    assert.equal(second.failed, 0);
    assert.ok(second.deduplicated >= 1, "second sweep deduplicates within the window");
    // Drain: reconcile enqueues real jobs for every due pair in the file;
    // let the worker finish them so later tests never contend for it.
    await waitFor(async () => {
      const r = await admin.query(
        `select count(*)::int as c from ${SCHEMA}.job where name = '${AUTONOMY_EVALUATE_JOB_TYPE}' and state in ('created','retry','active')`,
      );
      return r.rows[0].c === 0;
    }, 90_000, "reconciled jobs drain");
  });

  it("state changed after enqueue controls execution (reread proof)", async () => {
    const o = owner(31);
    const { scope } = await seedEligibleCandidate(o);
    await fullyEnable(o);
    // Payload created while enabled; kill switch flips before execution.
    const def = getJob(AUTONOMY_EVALUATE_JOB_TYPE);
    assert.ok(def);
    const { disableAutonomy } = await import("./config");
    await disableAutonomy(db, o, o);
    await def.handler(
      { ownerId: o, targetScope: scope, correlationId: `${RUN}-reread` },
      testCtx(),
    );
    assert.equal(await activationCount(o), 0, "post-enqueue kill switch denies");
    assert.ok((await decisionCodes(o)).some((c) => /DISABLED/.test(c)));
  });

  it("malformed payloads are rejected, never executed", async () => {
    await assert.rejects(
      () =>
        runtime.enqueue({
          jobType: AUTONOMY_EVALUATE_JOB_TYPE,
          payload: { ownerId: 1, targetScope: "x", correlationId: "c", policy: { objective: "smuggled" } },
          correlationId: "c",
          idempotencyKey: `test-malformed-${Date.now()}`,
        }),
      /policy/,
      "strict schema rejects smuggled objects at enqueue",
    );
  });
  it("human 29.3 activation still works alongside the scheduler", async () => {
    const o = owner(20);
    const { candidate } = await seedEligibleCandidate(o);
    await fullyEnable(o);
    const result = await activatePolicyCandidate(db, candidate.id, o, "human regression check", "human");
    assert.ok(result.policy, "human activation succeeds");
    assert.equal(result.activation.actor, "human");
  });
});
