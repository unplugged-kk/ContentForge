/**
 * The decision engine — the single entry point every decision flows through.
 *
 * Contract:
 *   • It returns a value. It never executes, publishes, writes content or calls
 *     an adapter. Execution re-runs its own hard validators afterwards.
 *   • Every result is **soft** and carries its policy identity, so the ledger can
 *     always answer "which policy produced this?".
 *   • Failure is declared, not improvised: each decision type names its fallback
 *     class, and an outage produces that fallback rather than an error. A Jev
 *     failure can never produce a publish.
 *   • Recording is best-effort — observability must never change a decision.
 */

import { jevConfigured, jevDecide, jevTransport, type JevQuestion } from "./jev";
import { newDecisionId, recordDecision, type DecisionLedgerPort } from "./ledger";
import { decisionEngineEnabled, decisionPolicy, type DecisionType } from "./policies";
import { getDecisionDefinition, type DecisionRefs } from "./registry";
import { validateDecision, type DecisionResult } from "./schemas";
import { hashState, normalizeState } from "./state";

export interface EngineDeps {
  /** Injected for tests; defaults to the real Jev client. */
  jevDecide?: typeof jevDecide;
  /** `null` disables recording; omitted ⇒ the shared database ledger. */
  ledger?: DecisionLedgerPort | null;
  enabled?: () => boolean;
  configured?: () => boolean;
  transport?: () => string | null;
}

export interface DecisionCallInput {
  type: DecisionType;
  state?: unknown;
  refs?: DecisionRefs;
  userId?: number | null;
  correlationId?: string | null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve the shared ledger lazily so the engine has no hard dependency on the
 * database: a process without one (a unit test, a script) still decides.
 */
async function defaultLedger(): Promise<DecisionLedgerPort | null> {
  try {
    const mod = await import("./service");
    return mod.decisionLedger;
  } catch {
    return null;
  }
}

export async function decide<T = unknown>(
  input: DecisionCallInput,
  deps: EngineDeps = {},
): Promise<DecisionResult<T>> {
  const policy = decisionPolicy(input.type);
  const definition = getDecisionDefinition(input.type);
  const state = normalizeState(input.state);
  const build = { state, refs: input.refs };
  const inputStateHash = hashState(state);
  const enabled = deps.enabled ?? decisionEngineEnabled;
  const configured = deps.configured ?? jevConfigured;
  const ledger = deps.ledger !== undefined ? deps.ledger : await defaultLedger();

  let latencyMs: number | null = null;
  let model: string | null = null;

  const finish = async (
    decision: T,
    meta: { fallback: boolean; reasons: string[]; confidence?: number; signals?: Record<string, unknown> },
  ): Promise<DecisionResult<T>> => {
    const result: DecisionResult<T> = {
      decision,
      confidence: meta.confidence,
      reasons: meta.reasons.slice(0, 10),
      signals: meta.signals,
      policyId: policy.id,
      policyVersion: policy.version,
      decisionType: input.type,
      fallback: meta.fallback,
      level: "soft",
    };

    if (policy.fallback !== "skip") {
      await recordDecision(ledger, {
        decisionId: newDecisionId(),
        userId: input.userId ?? null,
        decisionType: input.type,
        policyId: policy.id,
        policyVersion: policy.version,
        inputStateHash,
        decision: (result.decision ?? {}) as Record<string, unknown>,
        confidence: result.confidence ?? null,
        reasons: result.reasons,
        signals: result.signals,
        fallback: result.fallback,
        latencyMs,
        model,
        transport: (deps.transport ?? jevTransport)() ?? null,
        refs: input.refs,
        correlationId: input.correlationId ?? null,
      });
    }

    return result;
  };

  const fallback = (reason: string) => ({
    decision: definition.fallback(build, reason) as T,
    fallback: true,
    reasons: [reason],
  });

  if (!enabled()) {
    const f = fallback("decision engine disabled");
    return finish(f.decision, f);
  }
  if (!configured()) {
    const f = fallback("jev not configured");
    return finish(f.decision, f);
  }

  const questions: Record<string, JevQuestion> = definition.buildQuestions(build);
  if (Object.keys(questions).length === 0) {
    const f = fallback("no decision to make from this state");
    return finish(f.decision, f);
  }

  try {
    const started = Date.now();
    const response = await (deps.jevDecide ?? jevDecide)(state, questions);
    latencyMs = Date.now() - started;
    model = response.model;

    const outcome = definition.parse(build, response);

    // Invalid decisions never reach a caller: the schema throws, and the
    // declared fallback applies.
    const decision = validateDecision(input.type, outcome.decision) as T;

    // A low-confidence answer may not take a PERMISSIVE action (a keep, an
    // approve). Conservative outcomes — a drop, a reject, a hold — are safe to
    // honour at any confidence, so they are not downgraded to the fallback.
    const permissive = definition.isPermissive ? definition.isPermissive(decision) : true;
    if (
      policy.minConfidence > 0 &&
      permissive &&
      outcome.confidence !== undefined &&
      outcome.confidence < policy.minConfidence
    ) {
      const f = fallback(
        `confidence ${outcome.confidence} below policy minimum ${policy.minConfidence}`,
      );
      return finish(f.decision, f);
    }

    return finish(decision, {
      fallback: false,
      reasons: outcome.reasons,
      confidence: outcome.confidence,
      signals: outcome.signals,
    });
  } catch (error) {
    const f = fallback(`jev decision failed: ${describe(error)}`);
    return finish(f.decision, f);
  }
}
