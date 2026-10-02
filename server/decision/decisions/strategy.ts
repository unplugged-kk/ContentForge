/**
 * Decision definition — `content_strategy`.
 *
 * One call, several bounded choices: the lead angle, the audience, the goal, and
 * how far the topic sits inside the creator's standing. Batching them is
 * deliberate — four separate round-trips would pay four times for one act of
 * editorial judgment.
 *
 * Every candidate set is bounded by the caller's own data (the Story's angles,
 * the profile's audiences and goals), so Jev selects rather than invents, and
 * every field is nullable: an unanswered choice stays null and the caller keeps
 * what it already had.
 */

import type { JevQuestion, JevResponse } from "../jev";
import type { DecisionBuildInput, DecisionDefinition, DecisionOutcome } from "../registry";
import { EXPERTISE_BANDS, type ContentStrategyDecision, type ExpertiseBandValue } from "../schemas";

const EXPERTISE_OPTIONS: Record<ExpertiseBandValue, string> = {
  core: "squarely inside what the creator already has standing to discuss",
  adjacent: "related to their standing, but a step outside it",
  outside: "outside their standing — they would be a newcomer here",
};

function uniqueCandidates(values: string[] | undefined, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/** Exact match first, then containment — the same tolerance framing uses. */
function matchCandidate(choice: string, candidates: readonly string[]): string | null {
  const value = choice.trim().toLowerCase();
  if (!value) return null;
  for (const candidate of candidates) if (candidate.toLowerCase() === value) return candidate;
  for (const candidate of candidates) if (value.includes(candidate.toLowerCase())) return candidate;
  return null;
}

/** The bounded candidate sets this decision may choose from. */
export function strategyCandidates(input: DecisionBuildInput) {
  return {
    angles: uniqueCandidates(input.state.topic?.angles, 8),
    audiences: uniqueCandidates(input.state.audience?.options, 6),
    goals: uniqueCandidates(input.state.expertise?.goals, 6),
  };
}

export const contentStrategyDefinition: DecisionDefinition<ContentStrategyDecision> = {
  type: "content_strategy",

  buildQuestions(input: DecisionBuildInput) {
    const { angles, audiences, goals } = strategyCandidates(input);
    const questions: Record<string, JevQuestion> = {};

    // A one-option "choice" is not a decision: only ask when there is a real one.
    if (angles.length >= 2) {
      questions.angle = {
        type: "choice",
        instructions:
          `This story carries several angles. Which ONE should the piece lead with? ` +
          `Choose exactly one of: ${angles.join(" | ")}`,
        criteria: Object.fromEntries(angles.map((angle) => [angle, angle])),
      };
    }
    if (audiences.length >= 2) {
      questions.audience = {
        type: "choice",
        instructions:
          `Which audience should this piece target? Choose exactly one of: ${audiences.join(" | ")}`,
        criteria: Object.fromEntries(audiences.map((audience) => [audience, audience])),
      };
    }
    if (goals.length >= 2) {
      questions.goal = {
        type: "choice",
        instructions:
          `Which goal does this piece serve? Choose exactly one of: ${goals.join(" | ")}`,
        criteria: Object.fromEntries(goals.map((goal) => [goal, goal])),
      };
    }

    questions.expertise = {
      type: "choice",
      instructions:
        "How close is this topic to what the creator already has standing to discuss? " +
        "Choose exactly one of: core, adjacent, outside",
      criteria: EXPERTISE_OPTIONS,
    };

    return questions;
  },

  parse(input: DecisionBuildInput, response: JevResponse): DecisionOutcome<ContentStrategyDecision> {
    const { angles, audiences, goals } = strategyCandidates(input);

    const choose = (key: string, candidates: readonly string[]): string | null => {
      const answer = response.answers[key];
      return answer && answer.type === "choice" && typeof answer.choice === "string"
        ? matchCandidate(answer.choice, candidates)
        : null;
    };

    const bandAnswer = response.answers.expertise;
    const bandCandidate =
      bandAnswer && bandAnswer.type === "choice" && typeof bandAnswer.choice === "string"
        ? matchCandidate(bandAnswer.choice, EXPERTISE_BANDS as readonly string[])
        : null;
    const expertise = (bandCandidate as ExpertiseBandValue | null) ?? null;

    const decision: ContentStrategyDecision = {
      angle: choose("angle", angles),
      audience: choose("audience", audiences),
      goal: choose("goal", goals),
      expertise,
    };

    // Nothing readable at all is not a strategy: fall back rather than return an
    // all-null decision as if it were an answer.
    if (
      decision.angle === null &&
      decision.audience === null &&
      decision.goal === null &&
      decision.expertise === null
    ) {
      throw new Error("JEV_NO_STRATEGY_ANSWERS");
    }

    const confidences: number[] = [];
    for (const key of ["angle", "audience", "goal", "expertise"]) {
      const answer = response.answers[key];
      if (answer && answer.type === "choice" && Number.isFinite(answer.confidence)) {
        confidences.push(Math.min(1, Math.max(0, answer.confidence)));
      }
    }
    const confidence =
      confidences.length > 0
        ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(4))
        : undefined;

    const chosen = Object.entries(decision)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");

    return { decision, confidence, reasons: [`strategy: ${chosen}`] };
  },

  /** Deterministic: choose nothing. The caller keeps whatever it already had. */
  fallback(_input: DecisionBuildInput) {
    return { angle: null, audience: null, goal: null, expertise: null };
  },
};
