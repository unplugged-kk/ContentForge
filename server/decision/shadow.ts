/**
 * Shadow mode — compute and record a decision WITHOUT acting on it.
 *
 * The migration path for every boundary: run the decision layer beside the
 * existing behaviour, record what it would have chosen, compare, and only then
 * flip the flag. `shadowDecide` is deliberately just `decide` — the difference
 * is entirely in the caller, which ignores the result. Keeping it a separate,
 * named entry point makes the intent explicit at every call site.
 */

import { decide, type DecisionCallInput, type EngineDeps } from "./engine";
import type { DecisionResult } from "./schemas";

export async function shadowDecide<T = unknown>(
  input: DecisionCallInput,
  deps: EngineDeps = {},
): Promise<DecisionResult<T>> {
  return decide<T>(input, deps);
}

/**
 * Agreement between two candidate index sets (a Jev keep-set vs a golden or
 * human keep-set). Jaccard: 1 = identical, 0 = disjoint.
 */
export function agreementRate(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const value of Array.from(setA)) if (setB.has(value)) shared += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : Number((shared / union).toFixed(4));
}
