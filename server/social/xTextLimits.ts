/**
 * D24 / §40 — a pre-publication length validator for X, matching the shape the
 * threads and instagram transports already use.
 *
 * The problem it solves: X is the only channel with no validator before the
 * provider call. `server/social/x.ts` numbers each unit (`addThreadNumbering`,
 * which TRIMS the body to make room for "N/total") and only then does
 * `tweets[index].slice(0, 280)` cut it — silently, mid-word, and the post goes
 * out anyway. A draft a few characters too long is indistinguishable from a good
 * one until it is on the account.
 *
 * ── Why the obvious implementation is wrong ──────────────────────────────────
 * The first version of this file ran `addThreadNumbering()` and then compared
 * each RESULT to 280. That can essentially never fail, because the numbering
 * step has already done the trimming: the comparison is a value against itself
 * after the damage. It reported PASS for a 280-char unit in a 3-unit thread that
 * really does lose 5 characters.
 *
 * The correct question is the inverse: **given the suffix this unit will carry,
 * is the body too long to survive it?** That is the arithmetic the transport
 * itself applies (`threadUtils.ts`: `maxBody = 280 - num.length - 2`), so it is
 * reproduced here per unit index rather than assumed to be a flat 280.
 */
import { addThreadNumbering } from "../utils/threadUtils";

/** Hard per-unit ceiling applied by `tweets[index].slice(0, 280)`. */
export const X_MAX_UNIT_CHARS = 280;

/** 2 = the "\n\n" separator between body and numbering. */
const SEPARATOR_LEN = 2;

const ALREADY_NUMBERED = /\n\n\d+\/\d+\s*$/;

export type XTextValidation = {
  ok: boolean;
  /** Human-readable reason, null when ok. */
  error: string | null;
  /** Index of the first unit that would be cut, or null. */
  badUnit: number | null;
  /** Characters that would be destroyed on that unit. */
  lostChars: number;
};

/**
 * The body budget for a unit, given its 1-based position and the thread size.
 *
 * A single post is never numbered, so it gets the full 280. In a thread the unit
 * carries "\n\nN/total", whose length grows with the thread size and is shorter
 * for N=1 than for N=10 — hence per index, not per thread.
 */
export function xUnitBudgetAt(index: number, threadSize: number): number {
  if (threadSize <= 1) return X_MAX_UNIT_CHARS;
  const num = `${index + 1}/${threadSize}`;
  return X_MAX_UNIT_CHARS - SEPARATOR_LEN - num.length;
}

/**
 * The worst-case (smallest) body budget in a thread of this size — the budget of
 * its last unit. Exported so producing-side gates can assert one number instead
 * of re-deriving the arithmetic.
 */
export function xUnitBudget(threadSize: number): number {
  if (threadSize <= 1) return X_MAX_UNIT_CHARS;
  return xUnitBudgetAt(threadSize - 1, threadSize);
}

/**
 * Validate the units of an X post/thread BEFORE the provider is called.
 *
 * @param units one entry per tweet, in order. Blank entries are dropped because
 *              the transport drops them, and counting them would describe a
 *              thread size that never ships.
 */
export function validateXText(units: string[]): XTextValidation {
  const cleaned = units.map((u) => u.trim()).filter((u) => u.length > 0);

  if (cleaned.length === 0) {
    return { ok: false, error: "x text is empty", badUnit: null, lostChars: 0 };
  }

  const total = cleaned.length;

  for (let i = 0; i < total; i++) {
    const unit = cleaned[i];

    // An already-numbered unit is returned untouched by addThreadNumbering, so
    // the only way it can be damaged is the final flat slice.
    if (ALREADY_NUMBERED.test(unit)) {
      if (unit.length > X_MAX_UNIT_CHARS) {
        const lost = unit.length - X_MAX_UNIT_CHARS;
        return {
          ok: false,
          error:
            `x unit ${i + 1}/${total} would be cut: already-numbered unit is ` +
            `${unit.length} chars, limit ${X_MAX_UNIT_CHARS} (${lost} destroyed)`,
          badUnit: i,
          lostChars: lost,
        };
      }
      continue;
    }

    const budget = xUnitBudgetAt(i, total);
    if (unit.length > budget) {
      const lost = unit.length - budget;
      return {
        ok: false,
        error:
          `x unit ${i + 1}/${total} would be cut: ${unit.length} chars, but the ` +
          `"${i + 1}/${total}" suffix leaves room for ${budget} ` +
          `(${lost} destroyed)`,
        badUnit: i,
        lostChars: lost,
      };
    }
  }

  return { ok: true, error: null, badUnit: null, lostChars: 0 };
}

/**
 * Cross-check: the transport's real output must not be shorter than what this
 * validator promised would survive. Used by the test suite to prove the
 * arithmetic above agrees with `threadUtils`, rather than with a reading of it.
 */
export function transportPreserves(units: string[]): boolean {
  const cleaned = units.map((u) => u.trim()).filter((u) => u.length > 0);
  const numbered = addThreadNumbering(cleaned);
  if (numbered.length !== cleaned.length) return false;
  // A single post is never numbered by the transport, so its text must come back
  // unmodified — no suffix to strip.
  if (cleaned.length === 1) return numbered[0] === cleaned[0];
  return numbered.every((n, i) => {
    if (ALREADY_NUMBERED.test(cleaned[i])) return n === cleaned[i];
    const suffix = `\n\n${i + 1}/${cleaned.length}`;
    if (!n.endsWith(suffix)) return false;
    return n.slice(0, -suffix.length) === cleaned[i];
  });
}
