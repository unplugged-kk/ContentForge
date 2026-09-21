/**
 * Real-Postgres tests for Phase 29.4 — Bounded Autonomous Optimization.
 *
 * Covers: config persistence and safe defaults, owner isolation, the kill
 * switch, mode enforcement, the activation-automation flag, evidence
 * threshold, the policy-field allowlist, activation budgets (daily/weekly),
 * cooldown, policy churn, oscillation, the circuit breaker (open + human-only
 * reset), autonomous rollback, and the full §45 production-policy scenario.
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and as andOp, eq, gte, lt, sql as rawSql } from "drizzle-orm";
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
  generationPolicies,
  autonomyConfigs,
  autonomyDecisions,
} from "@shared/schema";
import { policyKeyForScope } from "../policyActivation/activation";
import {
  getOrCreateAutonomyConfig,
  updateAutonomyConfig,
  disableAutonomy,
  resetCircuitBreaker,
} from "./config";
import { evaluateActivationEligibility, executeAutonomousActivation, executeAutonomousRollback } from "./controller";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `au_${Date.now().toString(36)}`;
const OWNER_A = 960_000 + (Date.now() % 30_000);
const OWNER_B = OWNER_A + 1;

describeDb("bounded autonomous optimization (Phase 29.4 db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
  });

  after(async () => {
    if (!CONNECTION) return;
    const inRange = (col: any) => andOp(gte(col, OWNER_A), lt(col, OWNER_A + 10_000));
    await db.delete(autonomyDecisions).where(inRange(autonomyDecisions.userId));
    await db.delete(autonomyConfigs).where(inRange(autonomyConfigs.userId));
    await db.delete(policyActivations).where(inRange(policyActivations.userId));
    await db.delete(policyCandidates).where(inRange(policyCandidates.userId));
    await db.delete(experimentEvaluations).where(inRange(experimentEvaluations.userId));
    await db.delete(experimentVariants).where(inRange(experimentVariants.userId));
    await db.delete(experiments).where(inRange(experiments.userId));
    await db.delete(generationPolicies).where(inRange(generationPolicies.userId));
    await pool.end();
  });

  let seq = 0;
  async function seedEligibleCandidate(
    owner: number,
    opts: { channel?: string; format?: string; guardrailRegressed?: boolean; evidenceQuality?: string; proposedConfiguration?: Record<string, unknown> } = {},
  ) {
    seq += 1;
    const tag = `${RUN}-${seq}`;
    const channel = opts.channel ?? "linkedin";
    const format = opts.format ?? `carousel${seq}`;
    const scope = `channel:${channel};format:${format}`;

    const [exp] = await db
      .insert(experiments)
      .values({
        userId: owner,
        name: `Exp ${tag}`,
        hypothesis: "h",
        objective: "o",
        targetScope: scope,
        experimentType: "format_distribution",
        primaryMetric: "engagements_per_post",
        status: "completed",
        decision: "variant_preferred",
        identityKey: `au-exp:${tag}`,
      })
      .returning();

    const [variant] = await db
      .insert(experimentVariants)
      .values({
        userId: owner,
        experimentId: exp.id,
        variantKey: "variant_a",
        name: "Variant A",
        isControl: false,
        policySnapshot: { format },
        trafficWeight: 50,
      })
      .returning();

    const [evaluation] = await db
      .insert(experimentEvaluations)
      .values({
        userId: owner,
        experimentId: exp.id,
        evaluationWindow: "final",
        primaryMetric: "engagements_per_post",
        evidenceQuality: opts.evidenceQuality ?? "repeatable",
        recommendedDecision: "variant_preferred",
        guardrailResults: opts.guardrailRegressed
          ? [{ metric: "publication_failure_rate", controlValue: "1%", variantValue: "20%", differencePercentage: "19%", status: "regressed" }]
          : [],
        summary: "Observed higher engagement under controlled assignment.",
        identityKey: `au-eval:${tag}`,
      })
      .returning();

    const [candidate] = await db
      .insert(policyCandidates)
      .values({
        userId: owner,
        experimentId: exp.id,
        variantId: variant.id,
        evaluationId: evaluation.id,
        title: `Candidate ${tag}`,
        rationale: "Promoted from controlled experiment",
        targetScope: scope,
        proposedConfiguration: opts.proposedConfiguration ?? { objective: `Tested config ${tag}` },
        status: "approved_for_future",
        identityKey: `au-cand:${tag}`,
      })
      .returning();

    return { exp, variant, evaluation, candidate, scope };
  }

  async function fullyEnable(owner: number, patch: Partial<Parameters<typeof updateAutonomyConfig>[2]> = {}) {
    await getOrCreateAutonomyConfig(db, owner);
    return updateAutonomyConfig(
      db,
      owner,
      {
        enabled: true,
        mode: "bounded_activation",
        activationAutomationEnabled: true,
        rollbackEnabled: true,
        minimumEvidenceQuality: "repeatable",
        maxActivationsPerDay: 5,
        maxActivationsPerWeek: 10,
        maxConsecutiveActivations: 2,
        cooldownMinutes: 0,
        ...patch,
      },
      owner,
    );
  }

  it("getOrCreateAutonomyConfig returns safe, conservative defaults for a never-configured owner", async () => {
    const owner = OWNER_A + 5000;
    const config = await getOrCreateAutonomyConfig(db, owner);
    assert.equal(config.enabled, false);
    assert.equal(config.mode, "disabled");
    assert.equal(config.experimentAutomationEnabled, false);
    assert.equal(config.activationAutomationEnabled, false);
    assert.equal(config.rollbackEnabled, false);
    assert.equal(config.circuitBreakerState, "closed");
    assert.equal(config.minimumEvidenceQuality, "confirmed");
  });

  it("denies activation entirely when config has never been touched (kill switch off by default)", async () => {
    const owner = OWNER_A + 1000;
    const { candidate } = await seedEligibleCandidate(owner);
    const { gate } = await evaluateActivationEligibility(db, owner, candidate.id);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "UNCONFIGURED");
  });

  it("kill switch: disabling autonomy denies a subsequent eligible activation attempt", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A);
    await fullyEnable(OWNER_A);
    await disableAutonomy(db, OWNER_A, OWNER_A);
    const { gate } = await evaluateActivationEligibility(db, OWNER_A, candidate.id);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "DISABLED");
  });

  it("mode enforcement: experiment_only mode denies activation even when enabled", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A);
    await fullyEnable(OWNER_A, { mode: "experiment_only" });
    const { gate } = await evaluateActivationEligibility(db, OWNER_A, candidate.id);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "MODE_NOT_PERMITTED");
  });

  it("activationAutomationEnabled=false denies even in bounded_activation mode", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A);
    await fullyEnable(OWNER_A, { activationAutomationEnabled: false });
    const { gate } = await evaluateActivationEligibility(db, OWNER_A, candidate.id);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "ACTIVATION_AUTOMATION_DISABLED");
  });

  it("denies when evidence quality is below the configured minimum", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A, { evidenceQuality: "directional" });
    await fullyEnable(OWNER_A);
    const { gate } = await evaluateActivationEligibility(db, OWNER_A, candidate.id);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "INSUFFICIENT_EVIDENCE");
  });

  it("denies when a guardrail regressed, overriding an otherwise-eligible candidate", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A, { guardrailRegressed: true });
    await fullyEnable(OWNER_A);
    const { gate } = await evaluateActivationEligibility(db, OWNER_A, candidate.id);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "GUARDRAIL_FAILED");
  });

  it("denies (never activates) when the proposed configuration contains a forbidden field", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A, { proposedConfiguration: { voiceId: "v1", apiKey: "leaked" } });
    await fullyEnable(OWNER_A);
    const { gate } = await evaluateActivationEligibility(db, OWNER_A, candidate.id);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "FORBIDDEN_FIELD");
  });

  it("unknown state (foreign owner) is denied, never treated as safe", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A);
    await fullyEnable(OWNER_B);
    const { gate } = await evaluateActivationEligibility(db, OWNER_B, candidate.id);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "UNKNOWN_STATE");
  });

  it("owner isolation: an untouched owner's config/budget is unaffected by another owner's activity", async () => {
    const owner = OWNER_A + 2000;
    const untouched = OWNER_A + 3000;
    const { candidate } = await seedEligibleCandidate(owner);
    await fullyEnable(owner);
    await executeAutonomousActivation(db, owner, candidate.id);

    const untouchedConfig = await getOrCreateAutonomyConfig(db, untouched);
    assert.equal(untouchedConfig.enabled, false, "an owner never configured must not be affected by another owner's activity");

    const untouchedDecisions = await db.select().from(autonomyDecisions).where(eq(autonomyDecisions.userId, untouched));
    assert.equal(untouchedDecisions.length, 0);
  });

  it("§45 production-policy scenario: an eligible candidate is autonomously activated end-to-end", async () => {
    const owner = OWNER_A + 4000;
    const { candidate, scope } = await seedEligibleCandidate(owner);
    await fullyEnable(owner);

    const result = await executeAutonomousActivation(db, owner, candidate.id);
    assert.equal(result.gate.allowed, true);
    assert.ok(result.activation);
    assert.equal(result.activation!.policy.status, "active");

    const [auditRow] = await db.select().from(policyActivations).where(eq(policyActivations.id, result.activation!.activation.id));
    assert.equal(auditRow.actor, "autonomous_controller", "actor is recorded truthfully, never impersonating a human");

    const decisions = await db
      .select()
      .from(autonomyDecisions)
      .where(eq(autonomyDecisions.candidateId, candidate.id));
    assert.ok(decisions.some((d) => d.outcome === "allowed" && d.decisionType === "activation"));

    const active = await db
      .select()
      .from(generationPolicies)
      .where(eq(generationPolicies.policyKey, policyKeyForScope(scope)));
    assert.equal(active.filter((p) => p.status === "active").length, 1, "exactly one active revision for the scope");
  });

  it("activation budget: exhausting the daily limit denies further autonomous activations", async () => {
    const owner = OWNER_A + 4100;
    await fullyEnable(owner, { maxActivationsPerDay: 1, cooldownMinutes: 0 });
    const c1 = await seedEligibleCandidate(owner, { channel: "budget", format: `${RUN}-b1` });
    const c2 = await seedEligibleCandidate(owner, { channel: "budget2", format: `${RUN}-b2` });

    const r1 = await executeAutonomousActivation(db, owner, c1.candidate.id);
    assert.equal(r1.gate.allowed, true);

    const r2 = await executeAutonomousActivation(db, owner, c2.candidate.id);
    assert.equal(r2.gate.allowed, false);
    assert.equal(r2.gate.code, "BUDGET_EXHAUSTED_DAILY");
  });

  it("cooldown: a second activation attempt for the SAME scope within the cooldown window is denied", async () => {
    const owner = OWNER_A + 4200;
    await fullyEnable(owner, { maxActivationsPerDay: 10, cooldownMinutes: 1440 });
    const scopeTag = `${RUN}-cooldown`;
    const c1 = await seedEligibleCandidate(owner, { channel: "x", format: scopeTag });
    const c2 = await seedEligibleCandidate(owner, { channel: "x", format: scopeTag });

    const r1 = await executeAutonomousActivation(db, owner, c1.candidate.id);
    assert.equal(r1.gate.allowed, true);

    const r2 = await executeAutonomousActivation(db, owner, c2.candidate.id);
    assert.equal(r2.gate.allowed, false);
    assert.equal(r2.gate.code, "COOLDOWN_ACTIVE");
  });

  it("policy churn: exceeding maxConsecutiveActivations for one scope with no human intervention denies further activation", async () => {
    const owner = OWNER_A + 4300;
    await fullyEnable(owner, { maxActivationsPerDay: 10, maxConsecutiveActivations: 1, cooldownMinutes: 0 });
    const scopeTag = `${RUN}-churn`;
    const c1 = await seedEligibleCandidate(owner, { channel: "x", format: scopeTag });
    const c2 = await seedEligibleCandidate(owner, { channel: "x", format: scopeTag });

    const r1 = await executeAutonomousActivation(db, owner, c1.candidate.id);
    assert.equal(r1.gate.allowed, true);

    const r2 = await executeAutonomousActivation(db, owner, c2.candidate.id);
    assert.equal(r2.gate.allowed, false);
    assert.equal(r2.gate.code, "POLICY_CHURN");
  });

  it("circuit breaker: only a human can clear it once opened, and it blocks activation while open", async () => {
    const owner = OWNER_A + 4400;
    const config = await fullyEnable(owner);
    await db.update(autonomyConfigs).set({ circuitBreakerState: "open", circuitBreakerReason: "test-forced" }).where(eq(autonomyConfigs.id, config.id));

    const { candidate } = await seedEligibleCandidate(owner);
    const denied = await evaluateActivationEligibility(db, owner, candidate.id);
    assert.equal(denied.gate.allowed, false);
    assert.equal(denied.gate.code, "CIRCUIT_OPEN");

    const cleared = await resetCircuitBreaker(db, owner, owner);
    assert.equal(cleared.circuitBreakerState, "closed");

    const nowAllowed = await evaluateActivationEligibility(db, owner, candidate.id);
    assert.equal(nowAllowed.gate.allowed, true);
  });

  it("rollback: an autonomous rollback re-activates the prior revision as a new immutable event", async () => {
    const owner = OWNER_A + 4500;
    await fullyEnable(owner, { maxActivationsPerDay: 10, cooldownMinutes: 0 });
    const scopeTag = `${RUN}-rb`;
    const c1 = await seedEligibleCandidate(owner, { channel: "x", format: scopeTag });
    const c2 = await seedEligibleCandidate(owner, { channel: "x", format: scopeTag });

    const r1 = await executeAutonomousActivation(db, owner, c1.candidate.id);
    const r2 = await executeAutonomousActivation(db, owner, c2.candidate.id);
    assert.equal(r1.gate.allowed, true);
    assert.equal(r2.gate.allowed, true);

    const rollback = await executeAutonomousRollback(db, owner, c2.candidate.id, {
      code: "GUARDRAIL_BREACH",
      reason: "post-activation publication failure rate exceeded threshold",
    });
    assert.equal(rollback.gate.allowed, true);
    assert.equal(rollback.activation!.policy.id, r1.activation!.policy.id, "rolled back to the immediately-prior revision");

    const [p2] = await db.select().from(generationPolicies).where(eq(generationPolicies.id, r2.activation!.policy.id));
    assert.equal(p2.status, "archived", "the rolled-back-from revision is preserved, never deleted");
  });

  it("rollback is denied when rollbackEnabled is false", async () => {
    const owner = OWNER_A + 4600;
    await fullyEnable(owner, { rollbackEnabled: false, cooldownMinutes: 0 });
    const scopeTag = `${RUN}-rbdisabled`;
    const c1 = await seedEligibleCandidate(owner, { channel: "x", format: scopeTag });
    await updateAutonomyConfig(db, owner, { rollbackEnabled: true }, owner);
    await executeAutonomousActivation(db, owner, c1.candidate.id);
    await updateAutonomyConfig(db, owner, { rollbackEnabled: false }, owner);

    const result = await executeAutonomousRollback(db, owner, c1.candidate.id, { code: "MANUAL_SIGNAL", reason: "test" });
    assert.equal(result.gate.allowed, false);
    assert.equal(result.gate.code, "ROLLBACK_DISABLED");
  });

  it("repeated autonomous rollbacks for one scope open the circuit breaker instead of rolling back indefinitely", async () => {
    const owner = OWNER_A + 4700;
    await fullyEnable(owner, { maxActivationsPerDay: 20, maxConsecutiveActivations: 100, cooldownMinutes: 0 });
    const scopeTag = `${RUN}-oscillate`;
    const c1 = await seedEligibleCandidate(owner, { channel: "x", format: scopeTag });
    const c2 = await seedEligibleCandidate(owner, { channel: "x", format: scopeTag });

    await executeAutonomousActivation(db, owner, c1.candidate.id);
    await executeAutonomousActivation(db, owner, c2.candidate.id);
    await executeAutonomousRollback(db, owner, c2.candidate.id, { code: "GUARDRAIL_BREACH", reason: "r1" });
    await executeAutonomousActivation(db, owner, c2.candidate.id);
    const secondRollback = await executeAutonomousRollback(db, owner, c2.candidate.id, { code: "GUARDRAIL_BREACH", reason: "r2" });

    assert.equal(secondRollback.gate.allowed, false);
    assert.equal(secondRollback.gate.code, "CIRCUIT_OPENED_OSCILLATION");

    const config = await getOrCreateAutonomyConfig(db, owner);
    assert.equal(config.circuitBreakerState, "open");
  });

  it("budget race: two concurrent activations for DIFFERENT scopes under the SAME owner never both succeed past a budget of 1 (Phase 29.4 deep audit §8/§19)", async () => {
    const owner = OWNER_A + 4900;
    await fullyEnable(owner, { maxActivationsPerDay: 1, maxActivationsPerWeek: 10, cooldownMinutes: 0, maxConsecutiveActivations: 10 });
    const c1 = await seedEligibleCandidate(owner, { channel: "race1", format: `${RUN}-race1` });
    const c2 = await seedEligibleCandidate(owner, { channel: "race2", format: `${RUN}-race2` });

    const [r1, r2] = await Promise.all([
      executeAutonomousActivation(db, owner, c1.candidate.id),
      executeAutonomousActivation(db, owner, c2.candidate.id),
    ]);

    const allowedCount = [r1, r2].filter((r) => r.gate.allowed).length;
    assert.equal(allowedCount, 1, "exactly one of the two concurrent cross-scope activations may pass a daily budget of 1");

    const activatedRows = await db
      .select({ count: rawSql<number>`count(*)::int` })
      .from(policyActivations)
      .where(andOp(eq(policyActivations.userId, owner), eq(policyActivations.actor, "autonomous_controller"), eq(policyActivations.action, "activate")));
    assert.equal(activatedRows[0].count, 1, "the database must show exactly one autonomous activation, not two");
  });

  it("every evaluation, allowed or denied, is durably logged with a machine-readable code and reason", async () => {
    const owner = OWNER_A + 4800;
    const { candidate } = await seedEligibleCandidate(owner, { evidenceQuality: "observed" });
    await fullyEnable(owner);
    await evaluateActivationEligibility(db, owner, candidate.id);

    const rows = await db.select().from(autonomyDecisions).where(eq(autonomyDecisions.candidateId, candidate.id));
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].outcome, "denied");
    assert.equal(rows[0].code, "INSUFFICIENT_EVIDENCE");
    assert.ok(rows[0].reason.length > 0);
  });
});
