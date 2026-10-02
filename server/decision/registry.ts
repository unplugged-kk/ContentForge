/**
 * Decision registry — the one place that knows every decision type.
 *
 * A type is not usable until it appears here with all three parts: how to ask
 * (`buildQuestions`), how to turn the answer into a decision (`parse`), and what
 * to do when Jev is unavailable (`fallback`). `Record<DecisionType, …>` makes
 * that exhaustive at compile time — adding a policy without a definition fails
 * the build.
 */

import type { JevQuestion, JevResponse } from "./jev";
import type { DecisionType } from "./policies";
import type { ContentForgeState } from "./state";
import { researchDepthDefinition, researchTriageDefinition } from "./decisions/research";
import { opportunityScoreDefinition } from "./decisions/opportunity";
import { qualityGateDefinition } from "./decisions/quality";

/** Entity references a decision can be attached to (all optional). */
export interface DecisionRefs {
  researchJobId?: number;
  storyId?: number;
  opportunityId?: number;
  artifactId?: number;
  publicationId?: number;
  automationRunId?: number;
}

export interface DecisionBuildInput {
  state: ContentForgeState;
  refs?: DecisionRefs;
}

export interface DecisionOutcome<T> {
  decision: T;
  confidence?: number;
  reasons: string[];
  signals?: Record<string, unknown>;
}

export interface DecisionDefinition<T> {
  type: DecisionType;
  /**
   * The questions to ask. An EMPTY map means "there is nothing to decide from
   * this state" — the engine then produces the declared fallback without a call.
   */
  buildQuestions(input: DecisionBuildInput): Record<string, JevQuestion>;
  /** Map Jev's answers onto the typed decision. Throwing ⇒ the fallback applies. */
  parse(input: DecisionBuildInput, response: JevResponse): DecisionOutcome<T>;
  /**
   * Whether this decision lets something THROUGH (a keep, an approve). A
   * low-confidence answer may not take a permissive action; conservative
   * outcomes (drop, reject, hold) are safe to honour either way. Default: true.
   */
  isPermissive?(decision: unknown): boolean;
  /** The declared value when Jev is unavailable, unusable, or below confidence. */
  fallback(input: DecisionBuildInput, reason: string): T;
}

export const DECISION_REGISTRY: Record<DecisionType, DecisionDefinition<unknown>> = {
  research_triage: researchTriageDefinition,
  research_depth: researchDepthDefinition,
  opportunity_score: opportunityScoreDefinition,
  quality_gate: qualityGateDefinition,
};

export function getDecisionDefinition(type: DecisionType): DecisionDefinition<unknown> {
  return DECISION_REGISTRY[type];
}
