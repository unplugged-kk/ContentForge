/**
 * Decision definition — `format_select` (the "framing" decision).
 *
 * Which of a policy's ALLOWED format × channel pairs should actually be
 * generated for a Story. The policy owns the allowed set; this decision may only
 * NARROW it, so it can never invent a pair, and it fails open — an outage, a
 * refusal or an unusable answer leaves the policy's targets untouched.
 *
 * Moved here from `content/framing.ts`, where it ran against `jevDecide`
 * directly: it was the last live decision with no policy version and no ledger
 * record.
 *
 * Jev's `choice` contract (verified against the live API): `instructions` is a
 * STRING and `criteria` is an OBJECT whose KEYS are the candidate answers.
 */

import type { JevQuestion, JevResponse } from "../jev";
import type { DecisionBuildInput, DecisionDefinition, DecisionOutcome } from "../registry";
import type { FormatSelectDecision } from "../schemas";

export type FormatTarget = { format: string; channel: string };

const MAX_STORY_CHARS = 1200;

/** Human hints for the formats the registry actually offers. */
const FORMAT_HINTS: Record<string, string> = {
  x_post: "a single short post (max ~280 characters)",
  x_thread: "a multi-post thread (2-5 posts)",
  x_article: "a long-form note post",
  linkedin_post: "a single LinkedIn post",
  threads_post: "a single Threads post",
  image: "a single image with a caption",
  video: "a short video",
};

export function formatHint(format: string): string {
  return FORMAT_HINTS[format] ?? format;
}

/** Formats allowed per channel, in the caller's order. */
export function formatsByChannel(targets: readonly FormatTarget[]): Map<string, string[]> {
  const byChannel = new Map<string, string[]>();
  for (const target of targets) {
    const list = byChannel.get(target.channel) ?? [];
    if (!list.includes(target.format)) list.push(target.format);
    byChannel.set(target.channel, list);
  }
  return byChannel;
}

/** Channels where there is a genuine choice to make. Order is deterministic. */
export function framingChannels(
  targets: readonly FormatTarget[],
): Array<{ channel: string; formats: string[] }> {
  return Array.from(formatsByChannel(targets))
    .filter(([, formats]) => formats.length >= 2)
    .map(([channel, formats]) => ({ channel, formats }));
}

/** Map Jev's choice back onto an allowed format. */
export function matchFormat(choice: string, formats: readonly string[]): string | null {
  const value = choice.trim().toLowerCase();
  if (!value) return null;
  for (const format of formats) if (format.toLowerCase() === value) return format;
  for (const format of formats) if (value.includes(format.toLowerCase())) return format;
  return null;
}

function allowedTargets(input: DecisionBuildInput): FormatTarget[] {
  return (input.state.targets ?? []).map((target) => ({
    channel: target.channel,
    format: target.format,
  }));
}

export const formatSelectDefinition: DecisionDefinition<FormatSelectDecision> = {
  type: "format_select",

  buildQuestions(input: DecisionBuildInput) {
    const targets = allowedTargets(input);
    const story = `"${input.state.topic?.title ?? "this story"}" — ${(input.state.topic?.query ?? "").slice(0, MAX_STORY_CHARS)}`;
    const questions: Record<string, JevQuestion> = {};

    framingChannels(targets).forEach(({ channel, formats }, index) => {
      const criteria: Record<string, string> = {};
      for (const format of formats) criteria[format] = formatHint(format);
      questions[`ch${index}`] = {
        type: "choice",
        instructions:
          `For the story ${story} — on channel "${channel}", ` +
          `which SINGLE format best fits this story? Choose exactly one.`,
        criteria,
      };
    });

    return questions;
  },

  parse(input: DecisionBuildInput, response: JevResponse): DecisionOutcome<FormatSelectDecision> {
    const targets = allowedTargets(input);
    const channels = framingChannels(targets);
    if (channels.length === 0) throw new Error("JEV_NO_FRAMING_CHOICE");

    const chosen = new Map<string, string>();
    const confidences: number[] = [];
    channels.forEach(({ channel, formats }, index) => {
      const answer = response.answers[`ch${index}`];
      const picked =
        answer && answer.type === "choice" && typeof answer.choice === "string"
          ? matchFormat(answer.choice, formats)
          : null;
      if (picked) {
        chosen.set(channel, picked);
        if (answer && answer.type === "choice" && Number.isFinite(answer.confidence)) {
          confidences.push(Math.min(1, Math.max(0, answer.confidence)));
        }
      }
    });

    // Nothing usable is not "choose nothing": reach the fallback, which keeps the
    // policy's targets whole.
    if (chosen.size === 0) throw new Error("JEV_NO_FRAMING_ANSWER");

    // Narrow only — a channel Jev did not speak about keeps every format.
    const kept = targets.filter((target) => {
      const picked = chosen.get(target.channel);
      return picked ? target.format === picked : true;
    });

    return {
      decision: { kept },
      confidence:
        confidences.length > 0
          ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(4))
          : undefined,
      reasons: [`narrowed to ${kept.length} of ${targets.length} allowed target(s)`],
    };
  },

  /** Fail-open: an outage leaves the policy's targets exactly as they were. */
  fallback(input: DecisionBuildInput) {
    return { kept: allowedTargets(input) };
  },
};
