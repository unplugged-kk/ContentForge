/**
 * Decision policies — the versioned, env-tunable identity of every decision
 * type in the ContentForge Decision OS.
 *
 * A change to a question, a threshold or a weight MUST bump `version`. The
 * ledger has to be able to answer "which policy produced this decision?", and
 * "did the newer policy do better?" is unanswerable if a behaviour change is
 * silent.
 *
 * Nothing here decides anything: this module is the static registry of policy
 * identity plus the env seams that tune it.
 */

/** How the engine behaves when Jev is unavailable or unusable. */
export type FallbackClass =
  /** Keep today's behaviour — never over-block on an outage (research/framing). */
  | "fail_open_keep"
  /** A code-owned fallback computes the value (opportunity score, depth). */
  | "deterministic"
  /** HOLD. Never auto-approve, never auto-publish, never auto-kill. */
  | "fail_closed_hold"
  /** Nothing is recorded or acted on. */
  | "skip";

export interface DecisionPolicy {
  /** Stable policy family id, e.g. "research-triage". */
  id: string;
  /** Bump on ANY behaviour change. Recorded on every ledger row (NOT NULL). */
  version: string;
  fallback: FallbackClass;
  /**
   * Below this confidence the engine uses the declared fallback instead of the
   * answer. `0` disables the check. Never let a low-confidence answer drive a
   * side effect.
   */
  minConfidence: number;
  /** Feature flag that must be "1" for a caller to act on this type (phases 3+). */
  flag?: string;
  description: string;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const POLICIES = {
  research_triage: {
    id: "research-triage",
    version: "v1",
    fallback: "fail_open_keep",
    minConfidence: 0,
    flag: "JEV_RESEARCH_GATE",
    description: "Which discovered sources survive to become evidence",
  },
  research_depth: {
    id: "research-depth",
    version: "v1",
    fallback: "deterministic",
    minConfidence: 0,
    flag: "JEV_RESEARCH_GATE",
    description: "How deep a research run should go for a given candidate",
  },
  opportunity_score: {
    id: "opportunity-score",
    version: "v1",
    fallback: "deterministic",
    minConfidence: 0.5,
    flag: "JEV_OPPORTUNITY_SCORE",
    description: "How good a content opportunity is (Jev signals, code weights)",
  },
  quality_gate: {
    id: "quality-gate",
    version: "v1",
    fallback: "fail_closed_hold",
    minConfidence: 0.4,
    flag: "JEV_CONTENT_GATE",
    description: "Is a generated artifact good enough to submit for review?",
  },
} as const satisfies Record<string, DecisionPolicy>;

export const DECISION_POLICIES = POLICIES;

export type DecisionType = keyof typeof POLICIES;

export const DECISION_TYPES = Object.keys(POLICIES) as DecisionType[];

export function isDecisionType(value: string): value is DecisionType {
  return Object.prototype.hasOwnProperty.call(POLICIES, value);
}

export function decisionPolicy(type: DecisionType): DecisionPolicy {
  return POLICIES[type];
}

/** Master switch. Off by default — merged code changes no behaviour. */
export function decisionEngineEnabled(): boolean {
  return process.env.JEV_DECISION_ENGINE_ENABLED === "1";
}

/** Whether a caller may act on this decision type (master flag AND its own). */
export function decisionTypeEnabled(type: DecisionType): boolean {
  if (!decisionEngineEnabled()) return false;
  const flag = POLICIES[type].flag;
  return flag ? process.env[flag] === "1" : false;
}

// ── tunables ─────────────────────────────────────────────────────────────────

export type TriageKeepPolicy = "pursue+watch" | "pursue";

/**
 * Which triage verdicts survive. The default keeps `watch` as well as `pursue` —
 * the pre-existing gate dropped every `watch` as soon as one candidate was
 * `pursue`, silently discarding usable sources.
 */
export function triageKeepPolicy(): TriageKeepPolicy {
  return process.env.JEV_TRIAGE_KEEP === "pursue" ? "pursue" : "pursue+watch";
}

export function opportunityBandThresholds(): { high: number; medium: number } {
  return {
    high: envNum("JEV_OPPORTUNITY_HIGH", 0.66),
    medium: envNum("JEV_OPPORTUNITY_MEDIUM", 0.4),
  };
}

export function qualityThresholds(): { approve: number; revise: number } {
  return {
    approve: envNum("JEV_QUALITY_APPROVE", 0.7),
    revise: envNum("JEV_QUALITY_REVISE", 0.45),
  };
}

/** The full registry, safe to expose over HTTP (no keys, no prompts). */
export function describePolicies(): Array<DecisionPolicy & { enabled: boolean }> {
  return DECISION_TYPES.map((type) => ({
    ...POLICIES[type],
    enabled: decisionTypeEnabled(type),
  }));
}
