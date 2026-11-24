/**
 * Run 56 — is D27's pillar weighting actually load-bearing on the new ideas?
 *
 * Reads the live DB through the app's own storage, then scores the new
 * intel_2026-11-24 batch with the app's real `computeEngagementScore`. The claim
 * under test is not "a weight exists" but "the weight CHANGES the ranking", i.e.
 * it is not the neutral 1.0 that also means "not found".
 *
 * Read-only: no writes, no model calls.
 */
import "dotenv/config";

const HOST_DB_URL =
  process.env.D22_DATABASE_URL ??
  process.env.DATABASE_URL?.replace("@postgres:5432", "@127.0.0.1:5432");
if (!HOST_DB_URL) throw new Error("DATABASE_URL not resolvable");
process.env.DATABASE_URL = HOST_DB_URL;

async function main() {
  const { storage } = await import("../server/storage");
  const { computeEngagementScore } = await import("../server/autopilot");

  const ideas = await storage.getDiscoveredIdeas(1, "intel_2026-11-24");
  console.log(`batch ideas: ${ideas.length}`);
  if (!ideas.length) throw new Error("no ideas in the batch to score");

  const sources = new Map<string, number>();
  let weighted = 0;
  let fallback = 0;
  const rows: { id: number; cat: string; w: number; src: string; score: number; viral: number }[] = [];

  for (const idea of ideas) {
    // Production call shape: pillar?.name || idea.category. No row has a
    // pillar_id, so the name that arrives is the category.
    const s = computeEngagementScore(idea as any, (idea as any).category);
    if (s.pillarWeighted) weighted++;
    else fallback++;
    sources.set(s.pillarWeightSource, (sources.get(s.pillarWeightSource) ?? 0) + 1);
    rows.push({
      id: (idea as any).id,
      cat: String((idea as any).category),
      w: s.breakdown.pillar_weight,
      src: s.pillarWeightSource,
      score: s.score,
      viral: parseFloat(String((idea as any).viralScore)),
    });
    const u = (idea as any).sourceUrl;
    if (u) sources.set(`url:${new URL(u).host}`, (sources.get(`url:${new URL(u).host}`) ?? 0) + 1);
  }

  console.log(`\nweighted (explicit) : ${weighted}/${ideas.length}`);
  console.log(`fallback (neutral)  : ${fallback}`);
  const ws = new Set(rows.map((r) => r.w));
  const wsources = new Set(rows.map((r) => r.src));
  console.log(`distinct weights    : ${[...ws].sort().join(", ")}`);
  console.log(`distinct sources    : ${[...wsources].join(", ")}`);

  // Does the weight reorder anything? Compare score ranking against viral-only.
  const byScore = [...rows].sort((a, b) => b.score - a.score).map((r) => r.id);
  const byViral = [...rows].sort((a, b) => b.viral - a.viral).map((r) => r.id);
  const moved = byScore.filter((id, i) => id !== byViral[i]).length;
  console.log(`rank vs viral-only  : ${moved}/${rows.length} positions differ`);

  console.log("\nper idea:");
  for (const r of rows) {
    console.log(`  ${r.id}  ${r.cat.padEnd(21)} w=${r.w.toFixed(2)} (${r.src.padEnd(9)}) viral=${r.viral} score=${r.score}`);
  }

  // A weight that is 1.0 for every row cannot reorder anything, which is exactly
  // the defect run 45 fixed. Assert it stays fixed.
  if (ws.size < 2) {
    console.log("\nFAIL: every weight is identical — the weighting is not load-bearing");
    process.exit(1);
  }
  console.log("\nPASS: more than one distinct weight is in use");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
