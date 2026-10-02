/**
 * Jev framing — the bounded decision of WHICH of a policy's allowed formats to
 * actually generate for one Story.
 *
 * The policy owns the allowed target set (format × channel): Jev may only
 * NARROW it, never invent a pair. One call per run, and fail-open — a decision
 * outage, a refusal or an unusable answer leaves the policy's targets untouched.
 */

import { jevConfigured, jevDecide, type JevQuestion } from "../decision/jev";

export type FramingTarget = { format: string; channel: string };

export interface FramingInput {
  storyTitle: string;
  insightBody: string;
  targets: FramingTarget[];
}

export interface FramingPort {
  /** The subset of `targets` to generate, or null to keep every target. */
  selectTargets(input: FramingInput): Promise<FramingTarget[] | null>;
}

const MAX_INSIGHT_CHARS = 1500;

export function framingEnabled(): boolean {
  return process.env.JEV_FRAMING === "1" && jevConfigured();
}

/** Formats allowed per channel, in policy order. */
export function formatsByChannel(targets: readonly FramingTarget[]): Map<string, string[]> {
  const byChannel = new Map<string, string[]>();
  for (const t of targets) {
    const list = byChannel.get(t.channel) ?? [];
    if (!list.includes(t.format)) list.push(t.format);
    byChannel.set(t.channel, list);
  }
  return byChannel;
}

/** One `choice` question per channel that actually has a choice to make. */
export function buildFramingQuestions(input: FramingInput): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  let i = 0;
  for (const [channel, formats] of Array.from(formatsByChannel(input.targets))) {
    if (formats.length < 2) continue;
    questions[`ch${i}`] = {
      type: "choice",
      instructions: {
        story: {
          title: input.storyTitle,
          insightBody: input.insightBody.slice(0, MAX_INSIGHT_CHARS),
        },
        channel,
        formats,
        question:
          `Channel "${channel}" accepts exactly one of these formats: ${formats.join(", ")}. ` +
          `Which SINGLE format best fits this story? Answer with exactly one of them.`,
      },
      criteria: { channel, formats },
    };
    i += 1;
  }
  return questions;
}

/** Map Jev's free-text choice back onto an allowed format. */
export function matchFormat(choice: string, formats: readonly string[]): string | null {
  const c = choice.trim().toLowerCase();
  if (!c) return null;
  for (const f of formats) if (f.toLowerCase() === c) return f;
  for (const f of formats) if (c.includes(f.toLowerCase())) return f;
  return null;
}

/**
 * Apply Jev's answers: a channel Jev spoke about keeps only the chosen format;
 * a channel it did not speak about (or that Jev answered unusably) is untouched.
 * Returns null when nothing usable came back, so the caller keeps the policy set.
 */
export function selectFramedTargets(
  input: FramingInput,
  answers: Record<string, { type?: string; choice?: unknown }>,
): FramingTarget[] | null {
  const questions = buildFramingQuestions(input);
  const keys = Object.keys(questions);
  if (keys.length === 0) return null;

  const chosen = new Map<string, string>();
  for (const key of keys) {
    const { channel, formats } = questions[key].criteria as { channel: string; formats: string[] };
    const answer = answers[key];
    const picked =
      answer && answer.type === "choice" && typeof answer.choice === "string"
        ? matchFormat(answer.choice, formats)
        : null;
    if (picked) chosen.set(channel, picked);
  }
  if (chosen.size === 0) return null;

  return input.targets.filter((t) => {
    const picked = chosen.get(t.channel);
    return picked ? t.format === picked : true;
  });
}

export function createJevFraming(): FramingPort {
  return {
    async selectTargets(input) {
      const questions = buildFramingQuestions(input);
      if (Object.keys(questions).length === 0) return null;
      const state = {
        story: { title: input.storyTitle, insightBody: input.insightBody.slice(0, MAX_INSIGHT_CHARS) },
        allowedTargets: input.targets,
      };
      const response = await jevDecide(state, questions);
      return selectFramedTargets(input, response.answers as Record<string, { type?: string; choice?: unknown }>);
    },
  };
}
