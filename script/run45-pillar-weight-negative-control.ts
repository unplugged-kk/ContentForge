#!/usr/bin/env node
/**
 * Run 45 — negative control: is the fix load-bearing, or does the new test pass
 * for reasons unrelated to the change?
 *
 * Re-implements the OLD lookup exactly (`PILLAR_WEIGHTS[pillarName] ?? 1.0`, name
 * taken from `pillar?.name || idea.category`) and runs the same assertions the new
 * suite runs. If the old logic also passes, the test proves nothing.
 *
 * Also measures the live pool through both implementations, so the before/after is
 * a number rather than a claim.
 */
import assert from "node:assert/strict";
import { PILLAR_WEIGHTS, PILLAR_WEIGHT_NAMESPACE, resolvePillarWeight } from "../server/pillarWeights.ts";

// ── the OLD implementation, verbatim in behaviour ──────────────────────────────
function oldResolve(pillarName, category) {
  const pillar = pillarName ? { name: pillarName } : undefined;
  const name = pillar?.name || category || "DevOps";
  return { weight: PILLAR_WEIGHTS[name] ?? 1.0, weighted: PILLAR_WEIGHTS[name] !== undefined };
}

const liveCategories = [
  ["platform_engineering", 72], ["ai", 59], ["ai_research", 56], ["sre", 50],
  ["mlops", 49], ["security", 41], ["finops", 36], ["devops", 34],
  ["system_design", 20], ["iac", 12], ["leadership", 9], ["tech", 8], ["kubernetes", 6],
];
const total = liveCategories.reduce((s, [, n]) => s + n, 0);

let oldMiss = 0, newMiss = 0;
const rows = [];
for (const [cat, n] of liveCategories) {
  const o = oldResolve(undefined, cat);
  const nw = resolvePillarWeight({ pillarName: null, category: cat });
  if (!o.weighted) oldMiss += n;
  if (!nw.weighted) newMiss += n;
  rows.push({ cat, n, old: o.weight, new: nw.weight, oldW: o.weighted, newW: nw.weighted });
}

console.log("per-category weight, old logic vs new");
console.log("category              n     OLD    NEW   delta");
for (const r of rows) {
  console.log(
    `${r.cat.padEnd(21)} ${String(r.n).padStart(3)}  ${r.old.toFixed(2)}   ${r.new.toFixed(2)}  ${(r.new - r.old >= 0 ? "+" : "") + (r.new - r.old).toFixed(2)}`,
  );
}
console.log(`\nOLD: ${total - oldMiss}/${total} ideas explicitly weighted (${oldMiss} fell back to 1.0)`);
console.log(`NEW: ${total - newMiss}/${total} ideas explicitly weighted (${newMiss} fell back to 1.0)`);

// Do the old weights actually tie on equal viral scores?
function distinctWeights(weights) {
  return new Set(weights.map((w) => w.toFixed(4))).size;
}
const oldW = rows.map((r) => r.old);
const newW = rows.map((r) => r.new);
console.log(`\ndistinct weights across the 13 live categories: OLD=${distinctWeights(oldW)}  NEW=${distinctWeights(newW)}`);
console.log("  (1 distinct weight means the multiplier cannot reorder anything)");

// ── negative control: the assertions the new suite makes, run on OLD logic ─────
let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS(old) ${label}`); }
  catch (e) { failures++; console.log(`  FAIL(old) ${label}  <- ${e.message.split("\n")[0]}`); }
};

console.log("\nrun the new suite's core assertions against the OLD logic:");
check("a seeded D27 pillar name resolves to a non-neutral weight", () => {
  const r = oldResolve("Kubernetes & platform engineering", null);
  assert.equal(r.weighted, true);
  assert.notEqual(r.weight, 1.0);
});
check("a live category slug resolves to an explicit weight", () => {
  const r = oldResolve(undefined, "gitops");
  assert.equal(r.weighted, true);
});
check("two ideas equal on viral do not tie on weight", () => {
  assert.notEqual(oldResolve(undefined, "ai").weight, oldResolve(undefined, "gitops").weight);
});
check("every live category resolves", () => {
  const unresolved = liveCategories.filter(([c]) => !oldResolve(undefined, c).weighted).map(([c]) => c);
  assert.deepEqual(unresolved, []);
});

console.log(`\nNEGATIVE CONTROL: ${failures}/4 of the new suite's core assertions FAIL on the old logic`);
console.log(failures >= 4
  ? "=> the fix is load-bearing: the test can only pass because of the change."
  : "=> WEAK: the test would pass without the change. Do not trust the green run.");

// Sanity: the new namespace covers every live category, no drift.
const covered = new Set(
  Object.values(PILLAR_WEIGHT_NAMESPACE.pillars).flatMap((p) => p.categories),
);
const uncovered = liveCategories.map(([c]) => c).filter((c) => !covered.has(c));
console.log(`\nlive categories not covered by the approved namespace: ${uncovered.length ? uncovered.join(", ") : "none"}`);

process.exitCode = failures >= 4 ? 0 : 1;
