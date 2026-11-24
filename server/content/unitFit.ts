/**
 * Run 58 — fitting an X unit to its budget without destroying a word.
 *
 * ── The defect this replaces ─────────────────────────────────────────────────
 * Three sites in this app clamp a generated unit with a bare `slice(0, 280)`:
 *
 *   server/autopilot.ts:343   String(t.content || "").slice(0, 280)
 *   server/routes.ts:2311     String(t.content || "").slice(0, 280)
 *   server/utils/threadUtils.ts  trimmed.slice(0, maxBody)   (inside a thread)
 *
 * `slice` cuts at a character offset, so a unit that runs one character long
 * loses the rest of its final word and nothing reports it. Measured on the live
 * database (evidence/run58/measure_truncation.sh, 184 stored units):
 *
 *   units at exactly 280 chars            29
 *   of those, ending mid-word             26     22 of them in `posted` rows
 *
 * i.e. 22 posts that claim to be published carry a sentence that stops in the
 * middle of a word, e.g. `"...ction debt. What's your "` and `"...based on your
 * agent actua"`. `charCount` was stored from the *pre-slice* string in routes.ts,
 * so even the local record said the unit was longer than it is.
 *
 * ── Why the existing validator did not catch it ──────────────────────────────
 * `server/social/xTextLimits.ts` (D24/§40) is a correct check in the wrong
 * place. It asks "does this unit exceed its budget?" and runs in the adapter at
 * PUBLISH time, on text the generation step has already cut. A cut unit is
 * `<= 280` chars, so the answer is always no. Measured with the real validator
 * against the real rows (evidence/run58/probe_validator_reach.ts): it accepts
 * **26 of 26** mid-word cuts. Both calls return ok:true, and the 285-char control
 * still returns ok:false, so the validator is not broken — it is downstream.
 *
 * ── What this module does instead ───────────────────────────────────────────
 * Fit the text to the budget by removing a suffix at a **boundary a reader would
 * accept**, in this order:
 *
 *   1. it already fits                     -> return unchanged, `fitted: false`
 *   2. cut at the last sentence boundary   -> "…sentence." reads finished
 *   3. cut at the last clause boundary     ; : — ,  (only if that keeps a real share)
 *   4. cut at the last word boundary, then append "…" so the reader is TOLD
 *   5. no boundary exists (one long token) -> hard cut + "…"
 *
 * Step 4 is the one that matters. A word-boundary cut with no marker still looks
 * like a sentence that ends early; the ellipsis is the difference between "this
 * post is broken" and "this post was deliberately shortened". A hard cut is kept
 * for the pathological case rather than throwing, because a missing draft is
 * worse than a marked one — but it is counted, so callers can see it.
 *
 * Pure: no db, no network, no model, no env.
 */

/** Marker appended when the text had to be shortened. */
export const FIT_ELLIPSIS = "…";

/** Below this share of the budget, a cut is not worth taking — escalate a step. */
const MIN_CLAUSE_SHARE = 0.6;

export type FitStrategy = "unchanged" | "sentence" | "clause" | "word" | "hard";

export type FitResult = {
  /** The text to store/publish. Never longer than `budget`. */
  text: string;
  /** What was done. `unchanged` means the input already fit. */
  strategy: FitStrategy;
  /** True when text was shortened at all. */
  fitted: boolean;
  /** Characters removed from the input (after trim). 0 when unchanged. */
  removed: number;
};

const SENTENCE_END = /[.!?…]["'”’)\]]*\s/g;
const CLAUSE_END = /[;:,—–]["'”’)\]]*\s/g;

/** Last index at which a match ends, searching only within `limit`. */
function lastBoundary(text: string, re: RegExp, limit: number): number {
  const window = text.slice(0, limit + 1);
  let best = -1;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(window)) !== null) {
    best = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // defensive: never loop on a zero-width match
  }
  return best;
}

/**
 * Fit `text` into at most `budget` characters, preferring a readable boundary.
 *
 * @param text   the unit as generated (any length)
 * @param budget the ceiling the transport will enforce (`<= 280` for X)
 */
export function fitUnitToBudget(text: string, budget: number): FitResult {
  const original = String(text ?? "").trim();

  if (budget <= 0) return { text: "", strategy: "hard", fitted: original.length > 0, removed: original.length };
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

  // 2. sentence boundary, keeping the punctuation.
  const sentenceAt = lastBoundary(original, SENTENCE_END, budget);
  if (sentenceAt > 0) {
    return made(original.slice(0, sentenceAt), "sentence");
  }

  // 3. clause boundary, but only if it keeps a real share of the budget — a
  //    comma in the first third is not a better ending than a marked word cut.
  const clauseAt = lastBoundary(original, CLAUSE_END, budget);
  if (clauseAt > 0 && clauseAt >= budget * MIN_CLAUSE_SHARE) {
    return made(original.slice(0, clauseAt), "clause");
  }

  // 4. word boundary, with an ellipsis that fits inside the budget.
  const room = budget - FIT_ELLIPSIS.length;
  if (room > 0) {
    const window = original.slice(0, room);
    const space = window.lastIndexOf(" ");
    // A space at index 0 means one enormous token: fall through to the hard cut.
    if (space > 0) {
      return made(`${window.slice(0, space)}${FIT_ELLIPSIS}`, "word");
    }
  }

  // 5. no boundary to use — cut and mark it.
  return made(original.slice(0, Math.max(0, room)) + FIT_ELLIPSIS, "hard");
}

/**
 * Fit a whole array of units, applying the thread numbering's own suffix budget.
 *
 * The numbering (`"\n\nN/total"`) is appended by `addThreadNumbering` AFTER this
 * runs, so the budget here must already reserve room for it — otherwise the
 * transport's own trim cuts the word this function just protected. Budgets are
 * taken from `xUnitBudgetAt` in `xTextLimits` so there is one arithmetic, not two.
 */
export function fitUnitsForThread(texts: string[], budgets: number[]): FitResult[] {
  return texts.map((t, i) => fitUnitToBudget(t, budgets[i] ?? budgets[budgets.length - 1] ?? 280));
}
