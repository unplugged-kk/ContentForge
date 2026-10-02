/**
 * Decision definition — `publish_gate`.
 *
 * The one place a model is allowed to say "do not publish this without a human".
 * It is deliberately narrow and fail-closed:
 *
 *   publish → the unattended path may proceed
 *   hold    → a human must decide (also the declared fallback, so an outage can
 *             never auto-approve)
 *   reject  → clearly not fit to be queued at all
 *
 * It cannot override a hard constraint, and it is only consulted on paths that
 * already have a human fallback (trusted auto-approval), so a `hold` is a normal
 * state, not a dead end.
 */

import type { JevQuestion, JevResponse } from "../jev";
import { publishThresholds } from "../policies";
import type { DecisionBuildInput, DecisionDefinition, DecisionOutcome } from "../registry";
import type { PublishGateDecision, PublishOutcome } from "../schemas";

const DIMENSIONS = ["ready_now", "distinct_from_recent", "platform_fit"] as const;

const QUESTIONS: Record<(typeof DIMENSIONS)[number], string> = {
  ready_now: "Is this ready to publish exactly as it stands?",
  distinct_from_recent: "Is this meaningfully distinct from what was published recently?",
  platform_fit: "Does this satisfy the platform's requirements for this format?",
};

export const publishGateDefinition: DecisionDefinition<PublishGateDecision> = {
  type: "publish_gate",

  buildQuestions(_input: DecisionBuildInput) {
    const questions: Record<string, JevQuestion> = {};
    for (const dimension of DIMENSIONS) {
      questions[dimension] = { type: "noul", instructions: QUESTIONS[dimension] };
    }
    return questions;
  },

  parse(_input: DecisionBuildInput, response: JevResponse): DecisionOutcome<PublishGateDecision> {
    const values: number[] = [];
    for (const dimension of DIMENSIONS) {
      const answer = response.answers[dimension];
      if (answer && answer.type === "noul" && Number.isFinite(answer.noul)) {
        values.push(Math.min(1, Math.max(0, answer.noul)));
      }
    }
    // Nothing readable must never become a publish: fall back (hold).
    if (values.length === 0) throw new Error("JEV_NO_PUBLISH_JUDGMENT");

    const readiness = response.answers.ready_now;
    const readyNow =
      readiness && readiness.type === "noul" && Number.isFinite(readiness.noul)
        ? Math.min(1, Math.max(0, readiness.noul))
        : 0;
    const composite = Number(
      (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4),
    );
    const { publish, reject } = publishThresholds();

    let outcome: PublishOutcome;
    if (readyNow >= publish && composite >= publish) outcome = "publish";
    else if (readyNow < reject) outcome = "reject";
    else outcome = "hold";

    return {
      decision: { outcome, score: composite },
      confidence: Number(readyNow.toFixed(4)),
      reasons: [`composite ${composite}, readiness ${readyNow} → "${outcome}"`],
      signals: { ready_now: readyNow },
    };
  },

  /**
   * Fail-closed: no answer, no outage, no exception may auto-approve. `hold`
   * hands the decision to a human, which is where the caller already stops.
   */
  fallback(_input: DecisionBuildInput) {
    return { outcome: "hold" as const, score: null };
  },

  /** Only `publish` lets content through unattended. */
  isPermissive(decision: unknown) {
    return (decision as PublishGateDecision).outcome === "publish";
  },
};
