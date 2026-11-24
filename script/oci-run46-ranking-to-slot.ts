/**
 * run46 — why the live calendar is 75/84 hot_take when it declares three shapes.
 *
 * The chain the autopilot actually runs (autofillCalendar, autopilot.ts:541-565):
 *
 *   ideas  --rankIdeas-->  ranked[]  --[i]-->  idea  --determineContentType--> post_type
 *     |                                                                              |
 *   isNicheRelevant, viral>=5.5,                                     ignores DAILY_SLOTS[i].preferredType
 *   computeEngagementScore (which BONUSES hot_take +0.6)
 *
 * So the top of the ranking feeds the slots. This measures what the top of the
 * ranking is actually made of, on the live pool, using the real ranking inputs.
 *
 * Read-only. Imports the real computeEngagementScore + determineContentType.
 */
import { Pool } from "pg";
import { computeEngagementScore, determineContentType } from "../server/autopilot";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const NICHE_KEYWORDS_SAMPLE = [
  "kubernetes", "docker", "platform", "sre", "slo", "incident", "outage",
  "ai", "agent", "llm", "mlops", "gpu", "inference", "infra",
  "security", "finops", "cloud", "terraform", "gitops", "devops",
];

async function main() {
  const { rows } = await pool.query(
    `select id, title, description, category, pillar_id, viral_score, timeliness,
            content_type_suggestion, status
       from discovered_ideas order by id`,
  );
  const pillars = (
    await pool.query<{ id: number; name: string }>(`select id, name from pillars`)
  ).rows;

  const scored = rows
    .filter((r) => parseFloat(String(r.viral_score || "0")) >= 5.5)
    .map((r) => {
      const pillarName = pillars.find((p) => p.id === r.pillar_id)?.name || r.category || "";
      const idea = {
        id: r.id,
        title: r.title,
        description: r.description ?? "",
        category: r.category,
        pillarId: r.pillar_id,
        viralScore: r.viral_score,
        timeliness: r.timeliness,
        contentTypeSuggestion: r.content_type_suggestion,
      };
      const { score, breakdown } = computeEngagementScore(idea as any, pillarName);
      const type = determineContentType(idea as any, {
        sourceType: "rss",
        contentAngles: [],
      });
      return { id: r.id, title: r.title, timeliness: r.timeliness,
               suggestion: r.content_type_suggestion, score, type, breakdown };
    })
    .sort((a, b) => b.score - a.score);

  console.log(`pool after viral>=5.5 filter: ${scored.length} (of ${rows.length})`);

  console.log("\n=== what the FIRST 9 ranked ideas become (3 slots x 3 days) ===");
  console.log("  rank  id    timeliness     suggestion    -> post_type");
  for (let i = 0; i < Math.min(9, scored.length); i++) {
    const s = scored[i];
    console.log(
      `  ${String(i + 1).padStart(4)}  ${String(s.id).padStart(5)} ${String(s.timeliness).padEnd(14)} ${String(s.suggestion).padEnd(13)} -> ${s.type}`,
    );
  }

  const top9 = scored.slice(0, 9);
  const top9types = new Map<string, number>();
  for (const s of top9) top9types.set(s.type, (top9types.get(s.type) ?? 0) + 1);
  console.log(`\n  top-9 type mix: ${[...top9types.entries()].map(([t, c]) => `${t}:${c}`).join("  ")}`);

  // Whole-pool projection after ranking (what a long run converges to).
  const allTypes = new Map<string, number>();
  for (const s of scored) allTypes.set(s.type, (allTypes.get(s.type) ?? 0) + 1);
  console.log("\n=== whole eligible pool, after the real ranking inputs ===");
  for (const [t, c] of [...allTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(16)} ${String(c).padStart(4)}  ${((c / scored.length) * 100).toFixed(1)}%`);
  }

  // The feedback edge: does a hot_take suggestion BUY score?
  console.log("\n=== is typeBonus competition-neutral? (breakdown.content_type_bonus) ===");
  const bySug = new Map<string, { n: number; bonus: number }>();
  for (const s of scored) {
    const k = String(s.suggestion);
    const e = bySug.get(k) ?? { n: 0, bonus: s.breakdown.content_type_bonus };
    e.n++;
    bySug.set(k, e);
  }
  for (const [k, v] of bySug.entries()) {
    console.log(`  suggestion=${k.padEnd(13)} n=${String(v.n).padStart(4)} bonus=+${v.bonus}`);
  }
  console.log("  => hot_take carries the LARGEST manual bonus (+0.6), so ideas the");
  console.log("     discoverer already labelled hot_take outrank the rest and then");
  console.log("     determineContentType confirms them. The label feeds on itself.");

  await pool.end();
}
main().catch(async (e) => { console.error("FAILED:", e?.message ?? e); await pool.end().catch(() => {}); process.exit(1); });
