/**
 * Decision definitions — opportunity family.
 *
 * Jev supplies the six signals; **code** composes the number
 * (`composeOpportunityScore`, the weighted composer that was built for exactly
 * this seam and never wired). The band is a threshold on that number, so the
 * composition stays deterministic and tunable without touching the model.
 */

import {
  composeOpportunityScore,
  DEFAULT_OPPORTUNITY_WEIGHTS,
  type JevQuestion,
  type JevResponse,
  type OpportunitySignals,
} from "../jev";
import { opportunityBandThresholds } from "../policies";
import type { DecisionBuildInput, DecisionDefinition, DecisionOutcome } from "../registry";
import type { OpportunityScoreDecision } from "../schemas";

const SIGNAL_KEYS = Object.keys(DEFAULT_OPPORTUNITY_WEIGHTS) as Array<keyof OpportunitySignals>;

const SIGNAL_QUESTIONS: Record<keyof OpportunitySignals, string> = {
  audience_relevance: "Would this land with the intended audience?",
  novelty: "Does this say something the audience has not already heard?",
  timeliness: "Is this worth acting on now rather than later?",
  practitioner_value: "Would a practitioner get something usable out of this?",
  discussion_potential: "Would this provoke useful discussion rather than silence?",
  differentiation: "Does this offer a distinct angle rather than a restatement?",
};

export const opportunityScoreDefinition: DecisionDefinition<OpportunityScoreDecision> = {
  type: "opportunity_score",

  buildQuestions(_input: DecisionBuildInput) {
    const questions: Record<string, JevQuestion> = {};
    for (const key of SIGNAL_KEYS) {
      questions[key] = { type: "noul", instructions: SIGNAL_QUESTIONS[key] };
    }
    return questions;
  },

  parse(_input: DecisionBuildInput, response: JevResponse): DecisionOutcome<OpportunityScoreDecision> {
    const partial: Partial<OpportunitySignals> = {};
    const signals: Record<string, unknown> = {};
    for (const key of SIGNAL_KEYS) {
      const answer = response.answers[key];
      // Only a finite, in-range signal counts; anything else is ignored rather
      // than allowed to skew the weighted composition.
      if (answer && answer.type === "noul" && Number.isFinite(answer.noul)) {
        const value = Math.min(1, Math.max(0, answer.noul));
        partial[key] = value;
        signals[key] = value;
      }
    }
    const present = Object.keys(partial).length;
    if (present === 0) throw new Error("JEV_NO_OPPORTUNITY_SIGNALS");

    const score = composeOpportunityScore(partial);
    const { high, medium } = opportunityBandThresholds();
    const band = score >= high ? "high" : score >= medium ? "medium" : "low";
    const values = Object.values(partial) as number[];

    return {
      decision: { score, band },
      confidence: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)),
      reasons: [`score ${score} over ${present} signal(s) → "${band}"`],
      signals,
    };
  },

  /**
   * The deterministic fallback has no signals, so it does not fabricate a score:
   * an unwired or unavailable scorer reports "unknown", never a made-up number.
   */
  fallback(_input: DecisionBuildInput) {
    return { score: null, band: "unknown" as const };
  },

  /**
   * Only claiming HIGH potential is a permissive act. A modest or low band is
   * conservative information — worth recording even when the answer is unsure —
   * so only a shaky "high" is withheld.
   */
  isPermissive(decision: unknown) {
    return (decision as OpportunityScoreDecision).band === "high";
  },
};
