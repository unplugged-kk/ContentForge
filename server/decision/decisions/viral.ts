/**
 * Decision definition — `viral_score` (JC-01), the first legacy migration.
 *
 * The legacy `/api/viral/score` route asks a model for a 0-10 overall plus eight
 * named dimensions. This asks the decision layer the same eight questions as
 * bounded yes/no signals and composes the overall in code — the same split used
 * everywhere else (the model supplies signals; code owns the arithmetic).
 *
 * SHADOW ONLY for now: nothing consumes this decision. It is recorded so the two
 * can be COMPARED before anything is cut over, which is the plan's own
 * requirement for legacy candidates.
 *
 * Dimension keys match the legacy prompt's keys exactly, so a comparison needs no
 * translation.
 */

import type { JevQuestion, JevResponse } from "../jev";
import type { DecisionBuildInput, DecisionDefinition, DecisionOutcome } from "../registry";
import { VIRAL_DIMENSIONS, type ViralScoreDecision } from "../schemas";

const QUESTIONS: Record<string, string> = {
  hook_power: "Does the opening line stop the scroll?",
  value_density: "Does this deliver substantial value per sentence rather than padding?",
  emotional_trigger: "Does this provoke a real reaction rather than indifference?",
  shareability: "Would someone share this to look informed?",
  uniqueness: "Does this say something the audience has not already read a dozen times?",
  readability: "Is this easy to read on a phone in one pass?",
  cta_strength: "Does the close invite a concrete next action?",
  timeliness: "Is this relevant right now rather than evergreen filler?",
};

/** The legacy model's own 0-10 score travels in the state as `llm_overall_normalized`. */
export const LLM_OVERALL_KEY = "llm_overall_normalized";

export const viralScoreDefinition: DecisionDefinition<ViralScoreDecision> = {
  type: "viral_score",

  buildQuestions(_input: DecisionBuildInput) {
    const questions: Record<string, JevQuestion> = {};
    for (const dimension of VIRAL_DIMENSIONS) {
      questions[dimension] = { type: "noul", instructions: QUESTIONS[dimension] };
    }
    return questions;
  },

  parse(input: DecisionBuildInput, response: JevResponse): DecisionOutcome<ViralScoreDecision> {
    const dimensions: Record<string, number> = {};
    for (const dimension of VIRAL_DIMENSIONS) {
      const answer = response.answers[dimension];
      if (answer && answer.type === "noul" && Number.isFinite(answer.noul)) {
        dimensions[dimension] = Number(Math.min(1, Math.max(0, answer.noul)).toFixed(4));
      }
    }
    const values = Object.values(dimensions);
    if (values.length === 0) throw new Error("JEV_NO_VIRAL_SIGNALS");

    const overall = Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));

    // Echo the model's own score so the ledger row holds BOTH sides of the
    // comparison; without it the shadow run cannot be evaluated later.
    const llmOverall = input.state.quality?.signals?.[LLM_OVERALL_KEY];
    const signals: Record<string, unknown> = { ...dimensions };
    if (typeof llmOverall === "number" && Number.isFinite(llmOverall)) {
      signals[LLM_OVERALL_KEY] = llmOverall;
    }

    return {
      decision: { overall, dimensions },
      confidence: overall,
      reasons: [`overall ${overall} over ${values.length} dimension(s)`],
      signals,
    };
  },

  /** No signals, no score — an unwired or unavailable run reports null. */
  fallback(_input: DecisionBuildInput) {
    return { overall: null, dimensions: {} };
  },
};
