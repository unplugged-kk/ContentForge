/**
 * Decision definition — `quality_gate`.
 *
 * The deterministic quality provider supplies the evidence (repetition,
 * boilerplate, hedging, specificity, length fit, flags); Jev makes the policy
 * call. Code owns the thresholds and the composition, exactly as the research
 * triage does.
 *
 * The outcome the system acts on:
 *   approve → nothing blocks the artifact
 *   revise  → do not submit; send it back for another pass
 *   reject  → do not submit; the content is not worth reviewing
 *   hold    → the gate could not evaluate it (fail-closed: never auto-approves)
 */

import type { JevQuestion, JevResponse } from "../jev";
import { qualityThresholds } from "../policies";
import type { DecisionBuildInput, DecisionDefinition, DecisionOutcome } from "../registry";
import type { QualityGateDecision, QualityOutcome } from "../schemas";

const DIMENSIONS = ["specific", "original", "clear", "audience_fit"] as const;
type Dimension = (typeof DIMENSIONS)[number];

const QUESTIONS: Record<Dimension | "publish_worthy", string> = {
  specific: "Does this make concrete, checkable assertions rather than vague generalities?",
  original: "Does this avoid phrasing the audience sees constantly (filler, boilerplate)?",
  clear: "Is this clear and well-structured for the platform and format?",
  audience_fit: "Would this land with the intended audience?",
  publish_worthy: "Is this good enough to publish as-is, without another revision?",
};

export const qualityGateDefinition: DecisionDefinition<QualityGateDecision> = {
  type: "quality_gate",

  buildQuestions(_input: DecisionBuildInput) {
    const questions: Record<string, JevQuestion> = {};
    for (const dimension of DIMENSIONS) {
      questions[dimension] = { type: "noul", instructions: QUESTIONS[dimension] };
    }
    questions.publish_worthy = { type: "noul", instructions: QUESTIONS.publish_worthy };
    return questions;
  },

  parse(_input: DecisionBuildInput, response: JevResponse): DecisionOutcome<QualityGateDecision> {
    const dimensionValues: number[] = [];
    for (const dimension of DIMENSIONS) {
      const answer = response.answers[dimension];
      if (answer && answer.type === "noul" && Number.isFinite(answer.noul)) {
        dimensionValues.push(Math.min(1, Math.max(0, answer.noul)));
      }
    }
    const worthiness = response.answers.publish_worthy;

    // Nothing readable is not a rejection: this gate must never condemn content
    // it could not evaluate. Throwing reaches the declared fallback (hold).
    if (dimensionValues.length === 0 || !worthiness || worthiness.type !== "noul") {
      throw new Error("JEV_NO_QUALITY_JUDGMENT");
    }

    const composite = Number(
      (dimensionValues.reduce((sum, value) => sum + value, 0) / dimensionValues.length).toFixed(4),
    );
    const publishWorthy = Math.min(1, Math.max(0, worthiness.noul));
    const { approve, revise } = qualityThresholds();

    let outcome: QualityOutcome;
    if (publishWorthy >= approve && composite >= approve) outcome = "approve";
    else if (composite >= revise || publishWorthy >= revise) outcome = "revise";
    else outcome = "reject";

    return {
      decision: { outcome, score: composite },
      confidence: Number(publishWorthy.toFixed(4)),
      reasons: [`composite ${composite}, publish-worthiness ${publishWorthy} → "${outcome}"`],
      signals: {
        specific: dimensionValues[0] ?? null,
        original: dimensionValues[1] ?? null,
        clear: dimensionValues[2] ?? null,
        audience_fit: dimensionValues[3] ?? null,
        publish_worthy: publishWorthy,
      },
    };
  },

  /**
   * Fail-closed: an outage holds. `hold` never approves, and the artifact
   * wiring treats it as "a human must decide" rather than as a block.
   */
  fallback(_input: DecisionBuildInput) {
    return { outcome: "hold" as const, score: null };
  },

  /** Only an approval lets content through, so only an approval needs confidence. */
  isPermissive(decision: unknown) {
    return (decision as QualityGateDecision).outcome === "approve";
  },
};
