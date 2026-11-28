/**
 * Word-safe unit budget fitting for X posts and threads (run58 / B78).
 *
 * Shortens over-long generated text at a reader-acceptable boundary instead of
 * slicing mid-word:
 *   1. unchanged if already within budget
 *   2. last sentence boundary within budget
 *   3. last clause boundary (if it retains at least 60% of the budget)
 *   4. last word boundary + ellipsis (`…`)
 *   5. hard cut + ellipsis (`…`) for a single unbroken token
 *
 * Pure: no db, no network, no model, no env.
 */

/** Marker appended when text had to be shortened at a word or hard boundary. */
export const FIT_ELLIPSIS = "…";

/** Below this share of the budget, a clause break is skipped in favor of a word cut. */
const MIN_CLAUSE_SHARE = 0.6;

export type FitStrategy = "unchanged" | "sentence" | "clause" | "word" | "hard";

export type FitResult = {
  /** The text to store/publish. Never longer than `budget`. */
  text: string;
  /** Strategy applied; `unchanged` means the input already fit. */
  strategy: FitStrategy;
  /** True when text was shortened at all. */
  fitted: boolean;
  /** Characters removed from the trimmed input. 0 when unchanged. */
  removed: number;
};

const SENTENCE_END = /[.!?…]["'”’)\]]*\s/g;
const CLAUSE_END = /[;:,—–]["'”’)\]]*\s/g;

function lastBoundary(text: string, re: RegExp, limit: number): number {
  const window = text.slice(0, limit + 1);
  let best = -1;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(window)) !== null) {
    best = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  return best;
}

/**
 * Fit `text` into at most `budget` characters, preferring a readable boundary.
 */
export function fitUnitToBudget(text: string, budget: number): FitResult {
  const original = String(text ?? "").trim();

  if (budget <= 0) {
    return { text: "", strategy: "hard", fitted: original.length > 0, removed: original.length };
  }
  if (original.length <= budget) {
    return { text: original, strategy: "unchanged", fitted: false, removed: 0 };
  }

  const made = (candidate: string, strategy: FitStrategy): FitResult => {
    const cleaned = candidate.trimEnd();
    return {
      text: cleaned,
      strategy,
      fitted: true,
      removed: original.length - cleaned.length,
    };
  };

  const sentenceAt = lastBoundary(original, SENTENCE_END, budget);
  if (sentenceAt > 0) {
    return made(original.slice(0, sentenceAt), "sentence");
  }

  const clauseAt = lastBoundary(original, CLAUSE_END, budget);
  if (clauseAt > 0 && clauseAt >= budget * MIN_CLAUSE_SHARE) {
    return made(original.slice(0, clauseAt), "clause");
  }

  const room = budget - FIT_ELLIPSIS.length;
  if (room > 0) {
    const window = original.slice(0, room);
    const space = window.lastIndexOf(" ");
    if (space > 0) {
      return made(`${window.slice(0, space)}${FIT_ELLIPSIS}`, "word");
    }
  }

  return made(original.slice(0, Math.max(0, room)) + FIT_ELLIPSIS, "hard");
}

/**
 * Fit an array of thread units against their per-position suffix budgets
 * (e.g. from `xUnitBudgetAt`).
 */
export function fitUnitsForThread(texts: string[], budgets: number[]): FitResult[] {
  return texts.map((t, i) => fitUnitToBudget(t, budgets[i] ?? budgets[budgets.length - 1] ?? 280));
}
