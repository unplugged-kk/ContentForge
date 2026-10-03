/**
 * Typed decision shapes.
 *
 * Jev answers are signals; these schemas define the *decision* a caller acts on,
 * and every decision is validated against its schema before it leaves the
 * engine. A malformed answer never reaches execution — it becomes the declared
 * fallback.
 */

import { z } from "zod";
import type { DecisionType } from "./policies";

// ── research ─────────────────────────────────────────────────────────────────
export const TRIAGE_VERDICTS = ["drop", "watch", "pursue"] as const;
export type TriageVerdict = (typeof TRIAGE_VERDICTS)[number];

export const triageDecisionSchema = z.object({
  /** `skip` ⇒ nothing is worth keeping from this batch. */
  action: z.enum(["proceed", "skip"]),
  /** Indices (into the supplied candidate list) that survive to evidence. */
  keep: z.array(z.number().int().nonnegative()).max(200),
  drop: z.array(z.number().int().nonnegative()).max(200),
  perCandidate: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        score: z.number().min(0).max(1),
        decision: z.enum(TRIAGE_VERDICTS),
      }),
    )
    .max(200),
});
export type TriageDecision = z.infer<typeof triageDecisionSchema>;

export const DEPTHS = ["quick", "standard", "deep"] as const;
export type ResearchDepthValue = (typeof DEPTHS)[number];

export const researchDepthDecisionSchema = z.object({ depth: z.enum(DEPTHS) });
export type ResearchDepthDecision = z.infer<typeof researchDepthDecisionSchema>;

// ── opportunity ──────────────────────────────────────────────────────────────
export const OPPORTUNITY_BANDS = ["low", "medium", "high", "unknown"] as const;
export type OpportunityBand = (typeof OPPORTUNITY_BANDS)[number];

export const opportunityScoreDecisionSchema = z.object({
  /** null ⇒ no score could be computed (Jev unavailable and no signals). Never fabricated. */
  score: z.number().min(0).max(1).nullable(),
  band: z.enum(OPPORTUNITY_BANDS),
});
export type OpportunityScoreDecision = z.infer<typeof opportunityScoreDecisionSchema>;

// ── quality ──────────────────────────────────────────────────────────────────
/**
 * `hold` is the fail-closed outcome: the gate could not evaluate the content, so
 * it neither approves nor condemns it. It never auto-approves.
 */
export const QUALITY_OUTCOMES = ["approve", "revise", "reject", "hold"] as const;
export type QualityOutcome = (typeof QUALITY_OUTCOMES)[number];

export const qualityGateDecisionSchema = z.object({
  outcome: z.enum(QUALITY_OUTCOMES),
  /** Composite of the quality dimensions; null when the gate could not evaluate. */
  score: z.number().min(0).max(1).nullable(),
});
export type QualityGateDecision = z.infer<typeof qualityGateDecisionSchema>;

// ── strategy ─────────────────────────────────────────────────────────────────
export const EXPERTISE_BANDS = ["core", "adjacent", "outside"] as const;
export type ExpertiseBandValue = (typeof EXPERTISE_BANDS)[number];

/**
 * One bounded strategy call covers several related choices (lead angle, audience,
 * goal, expertise band) rather than four separate round-trips. Every field is
 * nullable: an unanswered choice stays null instead of being invented, and the
 * caller keeps whatever it already had.
 */
export const contentStrategyDecisionSchema = z.object({
  /** The Story angle to lead with — chosen from the Story's own angles. */
  angle: z.string().min(1).max(500).nullable(),
  /** The audience to target — chosen from the audiences the profile declares. */
  audience: z.string().min(1).max(500).nullable(),
  goal: z.string().min(1).max(500).nullable(),
  expertise: z.enum(EXPERTISE_BANDS).nullable(),
});
export type ContentStrategyDecision = z.infer<typeof contentStrategyDecisionSchema>;

// ── publishing ───────────────────────────────────────────────────────────────
/**
 * `hold` = a human must decide. It never auto-approves, which is precisely what
 * an unattended path needs: no answer cannot become a publish.
 */
export const PUBLISH_OUTCOMES = ["publish", "hold", "reject"] as const;
export type PublishOutcome = (typeof PUBLISH_OUTCOMES)[number];

export const publishGateDecisionSchema = z.object({
  outcome: z.enum(PUBLISH_OUTCOMES),
  score: z.number().min(0).max(1).nullable(),
});
export type PublishGateDecision = z.infer<typeof publishGateDecisionSchema>;

// ── format ───────────────────────────────────────────────────────────────────
/**
 * Narrow-only by construction: `kept` must be a subset of the pairs the caller
 * allowed, so a decision can never invent a format a policy never permitted.
 */
export const formatSelectDecisionSchema = z.object({
  kept: z
    .array(
      z.object({
        channel: z.string().min(1).max(50),
        format: z.string().min(1).max(50),
      }),
    )
    .max(20),
});
export type FormatSelectDecision = z.infer<typeof formatSelectDecisionSchema>;

// ── legacy (Phase 6) ─────────────────────────────────────────────────────────
/**
 * JC-01. Dimension keys deliberately match the legacy prompt's own keys
 * (`hook_power`, `value_density`, …) so a shadow run can be compared with the
 * model's scores without a translation layer.
 */
export const VIRAL_DIMENSIONS = [
  "hook_power",
  "value_density",
  "emotional_trigger",
  "shareability",
  "uniqueness",
  "readability",
  "cta_strength",
  "timeliness",
] as const;
export type ViralDimension = (typeof VIRAL_DIMENSIONS)[number];

export const viralScoreDecisionSchema = z.object({
  /** null ⇒ no score could be computed. Never fabricated. */
  overall: z.number().min(0).max(1).nullable(),
  dimensions: z.record(z.number().min(0).max(1)),
});
export type ViralScoreDecision = z.infer<typeof viralScoreDecisionSchema>;

// ── dispatch table ───────────────────────────────────────────────────────────
export const DECISION_SCHEMAS = {
  research_triage: triageDecisionSchema,
  research_depth: researchDepthDecisionSchema,
  opportunity_score: opportunityScoreDecisionSchema,
  quality_gate: qualityGateDecisionSchema,
  content_strategy: contentStrategyDecisionSchema,
  publish_gate: publishGateDecisionSchema,
  format_select: formatSelectDecisionSchema,
  viral_score: viralScoreDecisionSchema,
} as const satisfies Record<DecisionType, z.ZodTypeAny>;

export function validateDecision<T extends DecisionType>(
  type: T,
  value: unknown,
): z.infer<(typeof DECISION_SCHEMAS)[T]> {
  return DECISION_SCHEMAS[type].parse(value) as z.infer<(typeof DECISION_SCHEMAS)[T]>;
}

// ── the envelope ─────────────────────────────────────────────────────────────
export const decisionResultSchema = z.object({
  decision: z.unknown(),
  confidence: z.number().min(0).max(1).optional(),
  reasons: z.array(z.string()).max(10),
  signals: z.record(z.unknown()).optional(),
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
  decisionType: z.string().min(1),
  /** true ⇒ Jev was not used or was unusable; a declared fallback produced this. */
  fallback: z.boolean(),
  level: z.literal("soft"),
});

export interface DecisionResult<T = unknown> {
  decision: T;
  confidence?: number;
  reasons: string[];
  signals?: Record<string, unknown>;
  policyId: string;
  policyVersion: string;
  decisionType: string;
  fallback: boolean;
  /** Always soft. Hard constraints are code-owned and re-checked by the caller. */
  level: "soft";
}
