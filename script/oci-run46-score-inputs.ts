/**
 * run46 — the OTHER four inputs to the ranking score.
 *
 * Run 45 found that `pillar_weight` was a constant 1.0 for all 452 ideas: the
 * lookup received a category slug, the table was keyed by pillar name, so it
 * missed 452/452 while emitting 1.0 as a normal-looking value.
 *
 * `computeEngagementScore` has four more inputs beside the pillar weight:
 *   viral_score · timeliness_bonus · content_type_bonus · niche_bonus
 *
 * The question this script answers is NOT "does the code look right". It is:
 * on the LIVE pool, through the REAL module, how many DISTINCT values does each
 * input take, and can any of them reorder a ranking? A term that is constant
 * across every row cannot reorder anything, whatever its name says.
 *
 * Reproduces run 45's own measurement method:
 *   load every discovered_ideas row from the live database, call the app's own
 *   computeEngagementScore, compare emitted inputs and the resulting order.
 *
 * Read-only. Imports the real module. No container touch, no write, no deploy.
 */
import { Pool } from "pg";
import { computeEngagementScore } from "../server/autopilot";

type Row = {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  pillar_id: number | null;
  viral_score: string | number | null;
  timeliness: string | null;
  content_type_suggestion: string | null;
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

function distinct(values: unknown[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = JSON.stringify(v);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

async function main() {
  const { rows } = await pool.query<Row>(
    `select id, title, description, category, pillar_id, viral_score, timeliness,
            content_type_suggestion
       from discovered_ideas
      order by id`,
  );
  const n = rows.length;
  console.log(`rows: ${n}`);
  if (!n) {
    console.log("RESULT: NO DATA — cannot evaluate");
    process.exit(2);
  }

  const pillarRows = await pool.query<{ id: number; name: string }>(
    `select id, name from pillars order by id`,
  );
  const pillars = pillarRows.rows;
  console.log(
    `pillars: ${pillars.length} [${pillars.map((p) => p.name).join(" | ")}]`,
  );

  // The exact shape computeEngagementScore expects.
  const scored = rows.map((r) => {
    const pillarName =
      pillars.find((p) => p.id === r.pillar_id)?.name || r.category || "DevOps";
    const idea = {
      id: r.id,
      title: r.title,
      description: r.description ?? "",
      category: r.category ?? undefined,
      pillarId: r.pillar_id,
      viralScore: r.viral_score as any,
      timeliness: r.timeliness as any,
      contentTypeSuggestion: r.content_type_suggestion as any,
    };
    const res = computeEngagementScore(idea as any, pillarName);
    return { id: r.id, title: r.title, ...res };
  });

  console.log("\n=== input: how many distinct values across the whole pool ===");
  const inputs: [string, unknown[]][] = [
    ["viral_score", scored.map((s) => s.breakdown.viral_score)],
    ["pillar_weight", scored.map((s) => s.breakdown.pillar_weight)],
    ["timeliness_bonus", scored.map((s) => s.breakdown.timeliness_bonus)],
    ["content_type_bonus", scored.map((s) => s.breakdown.content_type_bonus)],
    ["niche_bonus", scored.map((s) => s.breakdown.niche_bonus)],
    ["total_score", scored.map((s) => s.score)],
  ];
  for (const [name, vals] of inputs) {
    const d = distinct(vals);
    const entries = [...d.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `${k}:${c}`)
      .join("  ");
    const verdict = d.size === 1 ? "  <-- CONSTANT (cannot reorder)" : "";
    console.log(
      `  ${name.padEnd(20)} distinct=${String(d.size).padStart(3)}  ${entries}${verdict}`,
    );
  }

  // Can each term alone reorder the pool? Drop it and compare the full order.
  console.log("\n=== does dropping the term change the ranking order? ===");
  const baseline = [...scored].sort((a, b) => b.score - a.score).map((s) => s.id);
  const terms = [
    "timeliness_bonus",
    "content_type_bonus",
    "niche_bonus",
    "pillar_weight",
  ] as const;
  for (const term of terms) {
    const without = scored
      .map((s) => {
        let delta = 0;
        if (term === "pillar_weight") {
          // pillar is multiplicative; neutralise it to its fallback of 1.0
          const v = s.breakdown.viral_score;
          delta = v * 1.0 - v * s.breakdown.pillar_weight;
        } else {
          delta = -s.breakdown[term];
        }
        return { id: s.id, score: s.score + delta };
      })
      .sort((a, b) => b.score - a.score)
      .map((s) => s.id);
    let moved = 0;
    for (let i = 0; i < baseline.length; i++) {
      if (baseline[i] !== without[i]) moved++;
    }
    console.log(
      `  without ${term.padEnd(20)} rows displaced: ${String(moved).padStart(3)} / ${baseline.length}`,
    );
  }

  // What the *winner* looks like, and whether the bonus terms decide it.
  console.log("\n=== top 5 by current score ===");
  for (const s of scored.slice().sort((a, b) => b.score - a.score).slice(0, 5)) {
    console.log(
      `  #${s.id} score=${s.score} viral=${s.breakdown.viral_score} pillar=${s.breakdown.pillar_weight}` +
        ` tl=${s.breakdown.timeliness_bonus} type=${s.breakdown.content_type_bonus} niche=${s.breakdown.niche_bonus}` +
        ` src=${s.pillarWeightSource} | ${s.title.slice(0, 58)}`,
    );
  }

  // How often does the category slug itself carry the pillar weight (run 45's path)?
  const sources = distinct(scored.map((s) => s.pillarWeightSource));
  console.log(
    `\npillar weight resolution sources: ${[...sources.entries()]
      .map(([k, c]) => `${k}:${c}`)
      .join("  ")}`,
  );

  // For each bonus term, is the *populated* subset able to break a tie at all?
  console.log("\n=== tie-breaking power: rows sharing a viral_score ===");
  const byViral = new Map<string, typeof scored>();
  for (const s of scored) {
    const k = String(s.breakdown.viral_score);
    if (!byViral.has(k)) byViral.set(k, []);
    byViral.get(k)!.push(s);
  }
  const tiedGroups = [...byViral.values()].filter((g) => g.length > 1);
  const tiedRows = tiedGroups.reduce((a, g) => a + g.length, 0);
  console.log(
    `  viral buckets with >1 row: ${tiedGroups.length}, rows in them: ${tiedRows} / ${n}`,
  );
  for (const term of terms) {
    const deciding = tiedGroups.filter((g) => distinct(g.map((s) => s.breakdown[term])).size > 1).length;
    console.log(
      `  ${term.padEnd(20)} decides ${deciding} / ${tiedGroups.length} tied buckets`,
    );
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error("MEASUREMENT FAILED:", e?.message ?? e);
  await pool.end().catch(() => {});
  process.exit(1);
});
