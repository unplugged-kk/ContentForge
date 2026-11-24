#!/usr/bin/env node
/**
 * Run 45 — does the fix change what the autopilot RANKS, on the live data?
 *
 * The unit tests pin the resolution rule. This asks the question that matters:
 * feed the real 452-idea pool through the real `computeEngagementScore` and show
 * that the ranking before vs after the fix is not identical. If the top-N is
 * unchanged, the fix is correct but inert, and saying otherwise would be the
 * "green reading, no outcome" failure this mission keeps finding.
 *
 * Runs the app's own function. No re-implementation.
 */
import { computeEngagementScore } from "../server/autopilot.ts";
import { PILLAR_WEIGHTS, resolvePillarWeight } from "../server/pillarWeights.ts";

interface Row { category: string; viral: string; timeliness: string; type: string; title: string }

// The live distribution read from discovered_ideas (run 45), with the mean viral
// score per category so the ranking exercise uses real shapes rather than one
// synthetic score repeated.
const live = [
  { category: "platform_engineering", n: 72, viral: 6.8 },
  { category: "ai", n: 59, viral: 7.1 },
  { category: "ai_research", n: 56, viral: 6.5 },
  { category: "sre", n: 50, viral: 6.6 },
  { category: "mlops", n: 49, viral: 6.4 },
  { category: "security", n: 41, viral: 6.9 },
  { category: "finops", n: 36, viral: 6.2 },
  { category: "devops", n: 34, viral: 6.7 },
  { category: "system_design", n: 20, viral: 6.3 },
  { category: "iac", n: 12, viral: 6.0 },
  { category: "leadership", n: 9, viral: 6.1 },
  { category: "tech", n: 8, viral: 6.0 },
  { category: "kubernetes", n: 6, viral: 6.9 },
];

const rows: Row[] = [];
for (const { category, n, viral } of live) {
  for (let i = 0; i < n; i++) {
    rows.push({
      category,
      viral: String(viral),
      timeliness: "evergreen",
      type: "thread",
      title: `${category} item ${i}`,
    });
  }
}

const asIdea = (r: Row) =>
  ({
    id: 0,
    title: r.title,
    description: "infra",
    category: r.category,
    viralScore: r.viral,
    contentTypeSuggestion: r.type,
    timeliness: r.timeliness,
    pillarId: null,
  }) as any;

// AFTER — the shipped code path. pillarName is "" exactly as the live call site
// produces it for an idea whose pillar_id is NULL.
const after = rows.map((r) => {
  const s = computeEngagementScore(asIdea(r), "");
  return { ...r, score: s.score, weighted: s.pillarWeighted, src: s.pillarWeightSource };
});

// BEFORE — the old expression, applied to the same idea objects.
const before = rows.map((r) => {
  const idea = asIdea(r);
  const name = idea.category || "DevOps"; // pillar?.name is always undefined live
  const w = (PILLAR_WEIGHTS as Record<string, number>)[name] ?? 1.0;
  const viral = parseFloat(idea.viralScore);
  const score = parseFloat(((viral * w) + 0.3 + 0.5).toFixed(2)); // evergreen, thread, niche
  return { ...r, score };
});

const rank = (xs: { category: string; score: number; title: string }[]) =>
  [...xs].sort((a, b) => b.score - a.score);

// Top-10 of ALL 452 rows is uninformative: `ai` supplies the 10 best items on viral
// alone, so an intra-category top-10 cannot move. Compare the best item per category
// instead — that is the ranking that decides which PILLAR wins a slot — and measure
// how far individual rows travel through the full ordering.
const bestPerCat = (xs: { category: string; score: number; title: string }[]) => {
  const m = new Map<string, number>();
  for (const r of xs) m.set(r.category, Math.max(m.get(r.category) ?? -Infinity, r.score));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
};

const topBefore = bestPerCat(before);
const topAfter = bestPerCat(after);

// Positional movement across the full pool, to catch changes the top-N hides.
const posBefore = new Map(rank(before).map((r, i) => [`${r.category}:${r.title}`, i]));
const moved = rank(after).filter((r, i) => posBefore.get(`${r.category}:${r.title}`) !== i).length;

console.log("AFTER: how many ideas carry an explicit weight?");
const w = after.filter((r) => r.weighted).length;
console.log(`  ${w}/${after.length} (sources: ${[...new Set(after.map((r) => r.src))].join(", ")})`);

const distinctBefore = new Set(before.map((r) => r.score.toFixed(2))).size;
const distinctAfter = new Set(after.map((r) => r.score.toFixed(2))).size;
console.log(`\ndistinct score values: BEFORE=${distinctBefore}  AFTER=${distinctAfter}`);

console.log("\nbest item per category, ranked — BEFORE (old lookup):");
console.log("  " + topBefore.join(" > "));
console.log("best item per category, ranked — AFTER (shipped):");
console.log("  " + topAfter.join(" > "));
console.log(`\ncategory order changed? ${topBefore.join() === topAfter.join() ? "NO — fix is inert" : "YES — the pillar ranking changed"}`);
console.log(`rows that changed position in the full 452-idea ordering: ${moved}/${after.length}`);

// Which categories moved, and by how much in score?
const byCat = new Map<string, { b: number; a: number }>();
for (const r of before) {
  const e = byCat.get(r.category) ?? { b: 0, a: 0 };
  e.b = r.score;
  byCat.set(r.category, e);
}
for (const r of after) {
  const e = byCat.get(r.category)!;
  e.a = r.score;
}
console.log("\nscore delta per category (same viral, same bonuses):");
for (const [cat, { b, a }] of [...byCat.entries()].sort((x, y) => (y[1].a - y[1].b) - (x[1].a - x[1].b))) {
  const d = a - b;
  console.log(`  ${cat.padEnd(21)} ${b.toFixed(2)} -> ${a.toFixed(2)}  ${d >= 0 ? "+" : ""}${d.toFixed(2)}`);
}

// Guard: the AI-category ideas must now outrank the GitOps-category ones at equal viral.
const eqAi = computeEngagementScore(asIdea({ category: "ai", viral: "8.0", timeliness: "evergreen", type: "thread", title: "t" }), "");
const eqGitops = computeEngagementScore(asIdea({ category: "devops", viral: "8.0", timeliness: "evergreen", type: "thread", title: "t" }), "");
console.log(`\nequal viral 8.0: ai=${eqAi.score} vs devops=${eqGitops.score}  -> ${eqAi.score > eqGitops.score ? "AI outranks" : "TIE/INVERTED"}`);

const ok = eqAi.score > eqGitops.score && new Set(after.map((r) => r.score.toFixed(2))).size > 1;
console.log(ok ? "\nRESULT: the weight is live and directional on real data." : "\nRESULT: FAILED — weight still inert.");
process.exitCode = ok ? 0 : 1;
