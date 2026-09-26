/**
 * Bounded Autonomous Optimization -- deterministic controller (Phase 29.4).
 *
 * This module is the sole "authority" the spec requires: an AI agent's
 * confidence never decides whether a production change happens. Every
 * function here re-derives its answer from the database on every call --
 * nothing is cached, nothing trusts a client-supplied flag, and every
 * evaluation (allowed OR denied) is durably logged to `autonomy_decisions`
 * before returning, so "why did/didn't it act" is always answerable later.
 *
 * The controller NEVER writes to `generation_policies` directly. Activation
 * and rollback are executed exclusively through the existing Phase 29.3
 * service (`policyActivation/activation.ts`) -- there is exactly one
 * production policy-mutation code path in this codebase, human or
 * autonomous.
 */
import { and, desc, eq, sql as rawSql } from "drizzle-orm";
import type { ContentDatabase } from "../storage";
import {
  autonomyDecisions,
  policyActivations,
  policyCandidates,
  experimentEvaluations,
  generationPolicies,
  type AutonomyConfig,
  type PolicyCandidate,
} from "@shared/schema";
import { getAutonomyConfig } from "./config";
import { openCircuitBreaker } from "./config";
import { assertAllowedPolicyFields, ForbiddenPolicyFieldError } from "./policyFieldAllowlist";
import { activationDecisionIdentityKey, rollbackDecisionIdentityKey } from "./identity";
import {
  AUTONOMY_TIMEZONE,
  DAILY_WINDOW_MINUTES,
  WEEKLY_WINDOW_MINUTES,
  ROLLBACK_WINDOW_MINUTES,
  autonomyWindowBoundaries,
  cooldownElapsedMs,
} from "./time";
import {
  activatePolicyCandidate,
  rollbackPolicyForCandidate,
  policyKeyForScope,
  PolicyActivationError,
  type ActivationResult,
} from "../policyActivation/activation";

// Back-compat surface: `cooldownElapsed` now lives in the time-semantics module.
export { cooldownElapsed } from "./time";

export class AutonomyError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "AutonomyError";
  }
}

export interface GateResult {
  allowed: boolean;
  code: string;
  reason: string;
  context: Record<string, unknown>;
}

const EVIDENCE_RANK: Record<string, number> = {
  insufficient_data: 0,
  observed: 1,
  directional: 2,
  repeatable: 3,
  confirmed: 4,
};

/** §24: autonomous activation never proceeds below "repeatable", regardless of config. */
const AUTONOMY_HARD_MINIMUM_EVIDENCE = "repeatable";

/**
 * §28: a hard, non-configurable safety ceiling on autonomous rollbacks per
 * scope per day -- deliberately independent of `maxConsecutiveActivations`
 * (which governs activation churn, a separate concern the owner may tune).
 * Autonomy must not be able to raise its own oscillation ceiling.
 */
const ROLLBACK_OSCILLATION_THRESHOLD = 1;

/** Pure, unit-testable: is `quality` at least as strong as the effective (config-vs-hard-floor) minimum? */
export function meetsMinimumEvidence(quality: string, configuredMinimum: string): boolean {
  const effectiveMinimum =
    (EVIDENCE_RANK[configuredMinimum] ?? 0) >= EVIDENCE_RANK[AUTONOMY_HARD_MINIMUM_EVIDENCE]
      ? configuredMinimum
      : AUTONOMY_HARD_MINIMUM_EVIDENCE;
  return (EVIDENCE_RANK[quality] ?? 0) >= (EVIDENCE_RANK[effectiveMinimum] ?? 3);
}

/**
 * Pure, unit-testable: detects a strict A/B/A/B activation oscillation in the
 * 4 most recent events for a scope (newest first), per §28/§31.
 */
export function detectOscillation(recentNewestFirst: Array<{ activatedPolicyId: number }>): boolean {
  if (recentNewestFirst.length < 4) return false;
  const [e0, e1, e2, e3] = recentNewestFirst;
  return e0.activatedPolicyId === e2.activatedPolicyId && e1.activatedPolicyId === e3.activatedPolicyId && e0.activatedPolicyId !== e1.activatedPolicyId;
}

/** Pure, unit-testable: how many of the newest-first events are consecutively autonomous? */
export function countConsecutiveAutonomous(recentNewestFirst: Array<{ actor: string }>): number {
  let count = 0;
  for (const event of recentNewestFirst) {
    if (event.actor === "autonomous_controller") count += 1;
    else break;
  }
  return count;
}

async function recordDecision(
  db: ContentDatabase,
  userId: number,
  decisionType: "activation" | "rollback" | "experiment_selection",
  gate: GateResult,
  extra: {
    targetScope?: string | null;
    candidateId?: number | null;
    experimentId?: number | null;
    evaluationId?: number | null;
    proposalId?: number | null;
    previousPolicyId?: number | null;
    newPolicyId?: number | null;
    evidenceQuality?: string | null;
    identityKey: string;
  },
): Promise<void> {
  await db.insert(autonomyDecisions).values({
    userId,
    decisionType,
    targetScope: extra.targetScope ?? null,
    proposalId: extra.proposalId ?? null,
    experimentId: extra.experimentId ?? null,
    evaluationId: extra.evaluationId ?? null,
    candidateId: extra.candidateId ?? null,
    previousPolicyId: extra.previousPolicyId ?? null,
    newPolicyId: extra.newPolicyId ?? null,
    evidenceQuality: extra.evidenceQuality ?? null,
    context: gate.context,
    outcome: gate.allowed ? "allowed" : "denied",
    code: gate.code,
    reason: gate.reason,
    identityKey: extra.identityKey,
  });
}

/**
 * §7/§19/§41: serializes every autonomous decision+action for one owner
 * behind a Postgres row lock on that owner's `autonomy_configs` row.
 *
 * Without this, two concurrent `executeAutonomousActivation` calls for
 * *different* scopes (or a concurrent activation + rollback) can each read
 * the same pre-mutation budget/cooldown/churn counts and both pass their
 * gates before either commits, exceeding `maxActivationsPerDay` or
 * double-tripping the rollback-oscillation breaker. The per-scope
 * single-active-revision invariant is already DB-enforced (Phase 29.3's
 * partial unique index), but that says nothing about a per-owner budget
 * spanning multiple scopes. `SELECT ... FOR UPDATE` on the owner's config
 * row makes read-then-decide-then-write atomic per owner: a concurrent
 * caller blocks until the first transaction commits, then re-reads
 * genuinely post-commit counts. A never-configured owner has no row to
 * lock, but `baseGate` denies with UNCONFIGURED regardless, so no race is
 * possible for that case either.
 */
async function lockAutonomyConfigRow(tx: ContentDatabase, userId: number): Promise<void> {
  await tx.execute(rawSql`select id from autonomy_configs where user_id = ${userId} for update`);
}

function denied(code: string, reason: string, context: Record<string, unknown> = {}): GateResult {
  return { allowed: false, code, reason, context };
}

function allowed(context: Record<string, unknown> = {}): GateResult {
  return { allowed: true, code: "ELIGIBLE", reason: "All deterministic gates passed.", context };
}

/** Shared gates for both activation and rollback: kill switch, mode, ownership. §2, §7, §9, §33. */
function baseGate(config: AutonomyConfig | undefined, requiredMode: string[]): GateResult | null {
  if (!config) return denied("UNCONFIGURED", "Autonomy has never been configured for this owner -- treated as disabled.");
  if (!config.enabled) return denied("DISABLED", "Autonomy kill switch is off for this owner.");
  if (!requiredMode.includes(config.mode)) {
    return denied("MODE_NOT_PERMITTED", `Autonomy mode "${config.mode}" does not permit this action.`, { mode: config.mode });
  }
  if (config.circuitBreakerState === "open") {
    return denied("CIRCUIT_OPEN", `Circuit breaker is open: ${config.circuitBreakerReason ?? "no reason recorded"}.`, {
      circuitBreakerOpenedAt: config.circuitBreakerOpenedAt,
    });
  }
  return null;
}

/**
 * §33.7 — counts autonomous activations within a trailing window, with the
 * window boundary evaluated **by the database, in the database's own time
 * frame**.
 *
 * `created_at` is `timestamp WITHOUT time zone`, written by its
 * `CURRENT_TIMESTAMP` default as session-local wall clock. Comparing it against
 * a JS `Date` (serialised in the app process's zone) or against a driver-
 * materialised value mixes two different frames and is wrong under any
 * non-UTC session. `now() - make_interval(...)` keeps both sides of the
 * comparison in the session frame, so the result is identical for a UTC,
 * `Asia/Kolkata`, or `America/New_York` session.
 */
async function countAutonomousActivationsSince(
  db: ContentDatabase,
  userId: number,
  windowMinutes: number,
): Promise<number> {
  const [row] = await db
    .select({ count: rawSql<number>`count(*)::int` })
    .from(policyActivations)
    .where(
      and(
        eq(policyActivations.userId, userId),
        eq(policyActivations.actor, "autonomous_controller"),
        eq(policyActivations.action, "activate"),
        rawSql`${policyActivations.createdAt} >= (now() - make_interval(mins => ${windowMinutes}))::timestamp`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * §22-31: budget, cooldown, and churn/oscillation checks for a specific scope.
 * All counts come straight from `policy_activations` -- no in-memory or
 * per-request cache, so a process restart or a second worker sees the same
 * truth (§40, §41).
 */
async function checkActivationBudgetCooldownAndChurn(
  db: ContentDatabase,
  userId: number,
  config: AutonomyConfig,
  policyKey: string,
): Promise<GateResult | null> {
  const now = Date.now();
  const dayCount = await countAutonomousActivationsSince(db, userId, DAILY_WINDOW_MINUTES);
  if (dayCount >= config.maxActivationsPerDay) {
    return denied(
      "BUDGET_EXHAUSTED_DAILY",
      `Daily autonomous activation budget (${config.maxActivationsPerDay}) exhausted.`,
      { dayCount, ...autonomyWindowBoundaries(now, AUTONOMY_TIMEZONE) },
    );
  }
  const weekCount = await countAutonomousActivationsSince(db, userId, WEEKLY_WINDOW_MINUTES);
  if (weekCount >= config.maxActivationsPerWeek) {
    return denied(
      "BUDGET_EXHAUSTED_WEEKLY",
      `Weekly autonomous activation budget (${config.maxActivationsPerWeek}) exhausted.`,
      { weekCount, ...autonomyWindowBoundaries(now, AUTONOMY_TIMEZONE) },
    );
  }

  // Cooldown: the elapsed time is computed by the DATABASE (session-frame safe),
  // never by subtracting a driver-materialised naive timestamp from Date.now().
  const [latestForScope] = await db
    .select({
      action: policyActivations.action,
      elapsedMs: rawSql<number>`round(extract(epoch from (now() - ${policyActivations.createdAt})) * 1000)::bigint`,
    })
    .from(policyActivations)
    .where(and(eq(policyActivations.userId, userId), eq(policyActivations.policyKey, policyKey)))
    .orderBy(desc(policyActivations.createdAt))
    .limit(1);

  if (
    latestForScope &&
    latestForScope.action === "activate" &&
    !cooldownElapsedMs(Number(latestForScope.elapsedMs), config.cooldownMinutes)
  ) {
    return denied("COOLDOWN_ACTIVE", `Cooldown (${config.cooldownMinutes}m) has not elapsed since the last activation for this scope.`, {
      elapsedMinutes: Math.floor(Number(latestForScope.elapsedMs) / 60_000),
    });
  }

  // Churn/oscillation (§28, §31): count consecutive autonomous activations for
  // this scope with no human activation/rollback in between, and detect a
  // strict A->B->A->B ping-pong pattern across the last 4 events.
  const recentForScope = await db
    .select()
    .from(policyActivations)
    .where(and(eq(policyActivations.userId, userId), eq(policyActivations.policyKey, policyKey)))
    .orderBy(desc(policyActivations.createdAt))
    .limit(8);

  const consecutiveAutonomous = countConsecutiveAutonomous(recentForScope);
  if (consecutiveAutonomous >= config.maxConsecutiveActivations) {
    return denied(
      "POLICY_CHURN",
      `${consecutiveAutonomous} consecutive autonomous activations for this scope with no human intervention (limit ${config.maxConsecutiveActivations}).`,
      { consecutiveAutonomous },
    );
  }

  if (detectOscillation(recentForScope)) {
    return denied("OSCILLATION_DETECTED", "Detected an A/B/A/B activation oscillation pattern for this scope.", {
      pattern: recentForScope.slice(0, 4).map((e) => e.activatedPolicyId),
    });
  }

  return null;
}

export interface ActivationEligibility {
  gate: GateResult;
  candidate?: PolicyCandidate;
  policyKey?: string;
}

/**
 * Evaluates (without executing) whether `candidateId` may be autonomously
 * activated right now. Every call -- allowed or denied -- is logged.
 */
export async function evaluateActivationEligibility(
  db: ContentDatabase,
  userId: number,
  candidateId: number,
): Promise<ActivationEligibility> {
  const config = await getAutonomyConfig(db, userId);
  const base = baseGate(config, ["bounded_activation"]);
  if (base) {
    await recordDecision(db, userId, "activation", base, {
      candidateId,
      identityKey: activationDecisionIdentityKey(userId, candidateId, base.code),
    });
    return { gate: base };
  }
  if (!config!.activationAutomationEnabled) {
    const gate = denied("ACTIVATION_AUTOMATION_DISABLED", "Activation automation is not enabled for this owner.");
    await recordDecision(db, userId, "activation", gate, {
      candidateId,
      identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate };
  }

  const [candidate] = await db.select().from(policyCandidates).where(eq(policyCandidates.id, candidateId));
  if (!candidate || candidate.userId !== userId) {
    // §30: unknown or foreign-owned state is never treated as safe.
    const gate = denied("UNKNOWN_STATE", "Candidate does not exist or ownership could not be verified.");
    await recordDecision(db, userId, "activation", gate, {
      candidateId,
      identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate };
  }

  let policyKey: string;
  try {
    policyKey = policyKeyForScope(candidate.targetScope);
  } catch {
    const gate = denied("UNKNOWN_STATE", "Candidate scope could not be resolved to a policy key.");
    await recordDecision(db, userId, "activation", gate, {
      candidateId,
      targetScope: candidate.targetScope,
      identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate, candidate };
  }

  if (config!.allowedScopes && config!.allowedScopes.length > 0 && !config!.allowedScopes.includes(candidate.targetScope)) {
    const gate = denied("SCOPE_NOT_ALLOWED", `Scope "${candidate.targetScope}" is not on the autonomy scope allowlist.`);
    await recordDecision(db, userId, "activation", gate, {
      candidateId,
      targetScope: candidate.targetScope,
      identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate, candidate, policyKey };
  }

  try {
    assertAllowedPolicyFields(candidate.proposedConfiguration ?? {});
  } catch (error) {
    if (error instanceof ForbiddenPolicyFieldError) {
      const gate = denied("FORBIDDEN_FIELD", error.message, { fields: error.fields });
      await recordDecision(db, userId, "activation", gate, {
        candidateId,
        targetScope: candidate.targetScope,
        identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
      });
      return { gate, candidate, policyKey };
    }
    throw error;
  }

  if (candidate.evaluationId === null) {
    const gate = denied("UNKNOWN_STATE", "Candidate has no linked evaluation.");
    await recordDecision(db, userId, "activation", gate, {
      candidateId,
      targetScope: candidate.targetScope,
      identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate, candidate, policyKey };
  }
  const [evaluation] = await db
    .select()
    .from(experimentEvaluations)
    .where(and(eq(experimentEvaluations.id, candidate.evaluationId), eq(experimentEvaluations.userId, userId)));
  if (!evaluation) {
    const gate = denied("UNKNOWN_STATE", "Linked evaluation could not be found.");
    await recordDecision(db, userId, "activation", gate, {
      candidateId,
      targetScope: candidate.targetScope,
      identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate, candidate, policyKey };
  }

  if (!meetsMinimumEvidence(evaluation.evidenceQuality, config!.minimumEvidenceQuality)) {
    const gate = denied(
      "INSUFFICIENT_EVIDENCE",
      `Evidence quality "${evaluation.evidenceQuality}" is below the required minimum for autonomous activation.`,
      { evidenceQuality: evaluation.evidenceQuality, configuredMinimum: config!.minimumEvidenceQuality },
    );
    await recordDecision(db, userId, "activation", gate, {
      candidateId,
      targetScope: candidate.targetScope,
      evaluationId: evaluation.id,
      evidenceQuality: evaluation.evidenceQuality,
      identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate, candidate, policyKey };
  }

  const guardrails = (evaluation.guardrailResults ?? []) as Array<{ status: string }>;
  if (guardrails.some((g) => g.status === "regressed")) {
    const gate = denied("GUARDRAIL_FAILED", "A guardrail regressed for this candidate's evaluation.", { guardrails });
    await recordDecision(db, userId, "activation", gate, {
      candidateId,
      targetScope: candidate.targetScope,
      evaluationId: evaluation.id,
      evidenceQuality: evaluation.evidenceQuality,
      identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate, candidate, policyKey };
  }

  const budgetGate = await checkActivationBudgetCooldownAndChurn(db, userId, config!, policyKey);
  if (budgetGate) {
    await recordDecision(db, userId, "activation", budgetGate, {
      candidateId,
      targetScope: candidate.targetScope,
      evaluationId: evaluation.id,
      evidenceQuality: evaluation.evidenceQuality,
      identityKey: activationDecisionIdentityKey(userId, candidateId, budgetGate.code),
    });
    return { gate: budgetGate, candidate, policyKey };
  }

  const gate = allowed({ evidenceQuality: evaluation.evidenceQuality });
  await recordDecision(db, userId, "activation", gate, {
    candidateId,
    targetScope: candidate.targetScope,
    experimentId: candidate.experimentId,
    evaluationId: evaluation.id,
    evidenceQuality: evaluation.evidenceQuality,
    identityKey: activationDecisionIdentityKey(userId, candidateId, gate.code),
  });
  return { gate, candidate, policyKey };
}

export interface AutonomousActionResult {
  gate: GateResult;
  activation?: ActivationResult;
}

/**
 * Re-evaluates eligibility (never trusts a cached prior check -- §33, §40)
 * and, only if still eligible, executes the activation through the existing
 * Phase 29.3 service. `activatePolicyCandidate` independently re-verifies
 * its own eligibility rules too (defense in depth -- two independent checks
 * must both pass, not one).
 */
export async function executeAutonomousActivation(
  db: ContentDatabase,
  userId: number,
  candidateId: number,
): Promise<AutonomousActionResult> {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as ContentDatabase;
    await lockAutonomyConfigRow(txDb, userId);

    const eligibility = await evaluateActivationEligibility(txDb, userId, candidateId);
    if (!eligibility.gate.allowed) return { gate: eligibility.gate };

    try {
      const activation = await activatePolicyCandidate(
        txDb,
        candidateId,
        userId,
        "Autonomously activated by the bounded autonomy controller under passing deterministic gates.",
        "autonomous_controller",
      );
      return { gate: eligibility.gate, activation };
    } catch (error) {
      if (error instanceof PolicyActivationError) {
        const gate = denied(error.code, error.message);
        await recordDecision(txDb, userId, "activation", gate, {
          candidateId,
          identityKey: activationDecisionIdentityKey(userId, candidateId, `EXEC_${error.code}`),
        });
        return { gate };
      }
      throw error;
    }
  });
}

export interface RollbackTrigger {
  code: "GUARDRAIL_BREACH" | "RELIABILITY_REGRESSION" | "PUBLICATION_FAILURE_RATE" | "MANUAL_SIGNAL";
  reason: string;
  metric?: string;
  value?: number;
}

/**
 * Evaluates and, if eligible, executes an autonomous rollback for the scope
 * a candidate belongs to, in response to an explicit deterministic safety
 * trigger (§27) -- never a bare "confidence" judgment. Repeated triggers for
 * the same scope beyond `maxConsecutiveActivations` open the circuit
 * breaker (§28) rather than rolling back indefinitely.
 */
export async function executeAutonomousRollback(
  db: ContentDatabase,
  userId: number,
  candidateId: number,
  trigger: RollbackTrigger,
): Promise<AutonomousActionResult> {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as ContentDatabase;
    await lockAutonomyConfigRow(txDb, userId);
    return executeAutonomousRollbackLocked(txDb, userId, candidateId, trigger);
  });
}

async function executeAutonomousRollbackLocked(
  db: ContentDatabase,
  userId: number,
  candidateId: number,
  trigger: RollbackTrigger,
): Promise<AutonomousActionResult> {
  const config = await getAutonomyConfig(db, userId);
  const base = baseGate(config, ["bounded_activation"]);
  if (base) {
    await recordDecision(db, userId, "rollback", base, {
      candidateId,
      identityKey: rollbackDecisionIdentityKey(userId, candidateId, base.code),
    });
    return { gate: base };
  }
  if (!config!.rollbackEnabled) {
    const gate = denied("ROLLBACK_DISABLED", "Autonomous rollback is not enabled for this owner.");
    await recordDecision(db, userId, "rollback", gate, {
      candidateId,
      identityKey: rollbackDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate };
  }

  const [candidate] = await db.select().from(policyCandidates).where(eq(policyCandidates.id, candidateId));
  if (!candidate || candidate.userId !== userId) {
    const gate = denied("UNKNOWN_STATE", "Candidate does not exist or ownership could not be verified.");
    await recordDecision(db, userId, "rollback", gate, {
      candidateId,
      identityKey: rollbackDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate };
  }

  let policyKey: string;
  try {
    policyKey = policyKeyForScope(candidate.targetScope);
  } catch {
    const gate = denied("UNKNOWN_STATE", "Candidate scope could not be resolved to a policy key.");
    await recordDecision(db, userId, "rollback", gate, {
      candidateId,
      identityKey: rollbackDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate };
  }

  const [latestEvent] = await db
    .select()
    .from(policyActivations)
    .where(and(eq(policyActivations.userId, userId), eq(policyActivations.policyKey, policyKey)))
    .orderBy(desc(policyActivations.createdAt))
    .limit(1);
  if (!latestEvent || latestEvent.previousPolicyId === null) {
    const gate = denied("NO_PRIOR_REVISION", "No valid prior policy revision exists to roll back to.");
    await recordDecision(db, userId, "rollback", gate, {
      candidateId,
      targetScope: candidate.targetScope,
      identityKey: rollbackDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate };
  }
  const [priorRevisionStillExists] = await db
    .select()
    .from(generationPolicies)
    .where(eq(generationPolicies.id, latestEvent.previousPolicyId));
  if (!priorRevisionStillExists) {
    const gate = denied("UNKNOWN_STATE", "Recorded prior revision could not be located.");
    await recordDecision(db, userId, "rollback", gate, {
      candidateId,
      targetScope: candidate.targetScope,
      identityKey: rollbackDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate };
  }

  // Oscillation guard: too many autonomous rollbacks for this scope trips the breaker instead of rolling back again.
  const recentRollbacks = await db
    .select({ count: rawSql<number>`count(*)::int` })
    .from(policyActivations)
    .where(
      and(
        eq(policyActivations.userId, userId),
        eq(policyActivations.policyKey, policyKey),
        eq(policyActivations.action, "rollback"),
        eq(policyActivations.actor, "autonomous_controller"),
        // §33.7: window boundary evaluated in the database's own time frame.
        rawSql`${policyActivations.createdAt} >= (now() - make_interval(mins => ${ROLLBACK_WINDOW_MINUTES}))::timestamp`,
      ),
    );
  if ((recentRollbacks[0]?.count ?? 0) >= ROLLBACK_OSCILLATION_THRESHOLD) {
    await openCircuitBreaker(
      db,
      userId,
      `Repeated autonomous rollbacks for scope "${policyKey}" within 24h (trigger: ${trigger.code}).`,
    );
    const gate = denied("CIRCUIT_OPENED_OSCILLATION", "Repeated rollbacks detected -- circuit breaker opened, human intervention required.");
    await recordDecision(db, userId, "rollback", gate, {
      candidateId,
      targetScope: candidate.targetScope,
      identityKey: rollbackDecisionIdentityKey(userId, candidateId, gate.code),
    });
    return { gate };
  }

  const gate = allowed({ trigger });
  await recordDecision(db, userId, "rollback", gate, {
    candidateId,
    targetScope: candidate.targetScope,
    identityKey: rollbackDecisionIdentityKey(userId, candidateId, gate.code),
  });

  try {
    const activation = await rollbackPolicyForCandidate(
      db,
      candidateId,
      userId,
      `Autonomous rollback (${trigger.code}): ${trigger.reason}`,
      "autonomous_controller",
    );
    return { gate, activation };
  } catch (error) {
    if (error instanceof PolicyActivationError) {
      const failGate = denied(error.code, error.message);
      await recordDecision(db, userId, "rollback", failGate, {
        candidateId,
        identityKey: rollbackDecisionIdentityKey(userId, candidateId, `EXEC_${error.code}`),
      });
      return { gate: failGate };
    }
    throw error;
  }
}
