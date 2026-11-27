/**
 * Pre-publication length validator for X (D24).
 *
 * Checks each unit against the budget left after `addThreadNumbering` appends
 * `\n\nN/total` so over-long units are rejected before reaching the provider
 * instead of being silently truncated.
 */
import { addThreadNumbering } from "../utils/threadUtils";

/** Hard per-unit ceiling applied by `tweets[index].slice(0, 280)`. */
export const X_MAX_UNIT_CHARS = 280;

/** Length of the `\n\n` separator between body and numbering. */
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
 * The body budget for a unit given its 0-based position and thread size.
 * A single post is unnumbered (280 chars); thread units reserve `\n\nN/total`.
 */
export function xUnitBudgetAt(index: number, threadSize: number): number {
  if (threadSize <= 1) return X_MAX_UNIT_CHARS;
  const num = `${index + 1}/${threadSize}`;
  return X_MAX_UNIT_CHARS - SEPARATOR_LEN - num.length;
}

/**
 * The worst-case (smallest) body budget in a thread of this size — the budget of
 * its last unit.
 */
export function xUnitBudget(threadSize: number): number {
  if (threadSize <= 1) return X_MAX_UNIT_CHARS;
  return xUnitBudgetAt(threadSize - 1, threadSize);
}

/**
 * Validate the units of an X post/thread before the provider is called.
 * Blank entries are dropped to match transport normalization.
 */
export function validateXText(units: string[]): XTextValidation {
  const cleaned = units.map((u) => u.trim()).filter((u) => u.length > 0);

  if (cleaned.length === 0) {
    return { ok: false, error: "x text is empty", badUnit: null, lostChars: 0 };
  }

  const total = cleaned.length;

  for (let i = 0; i < total; i++) {
    const unit = cleaned[i];

    // Already-numbered units pass through addThreadNumbering unchanged; only
    // the flat 280-char ceiling applies.
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
 * Cross-check that `addThreadNumbering` preserves every body byte for valid input.
 */
export function transportPreserves(units: string[]): boolean {
  const cleaned = units.map((u) => u.trim()).filter((u) => u.length > 0);
  const numbered = addThreadNumbering(cleaned);
  if (numbered.length !== cleaned.length) return false;
  if (cleaned.length === 1) return numbered[0] === cleaned[0];
  return numbered.every((n, i) => {
    if (ALREADY_NUMBERED.test(cleaned[i])) return n === cleaned[i];
    const suffix = `\n\n${i + 1}/${cleaned.length}`;
    if (!n.endsWith(suffix)) return false;
    return n.slice(0, -suffix.length) === cleaned[i];
  });
}
