/**
 * run46 — the before/after that matters: what the CALENDAR produces now.
 *
 * The unit tests pin the rule. This asks the question the mission keeps asking:
 * does the change alter real output, or is it correct-but-inert?
 *
 * Before: 75 of 84 published posts were hot_take (89.3%) while DAILY_SLOTS
 *         declared thread / tweet / long_thread for its three slots.
 * After:  the top of the real ranking, scored by the real computeEngagementScore,
 *         assigned to real slots resolved by real time, should produce three shapes.
 *
 * No database writes. No container touch.
 */
import { Pool } from "pg";
import {
  computeEngagementScore,
  determineContentType,
  resolveSlotDef,
} from "../server/autopilot";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  const { rows } = await pool.query(
    `select id, title, description, category, pillar_id, viral_score, timeliness,
            content_type_suggestion
       from discovered_ideas order by id`,
  );
  const pillars = (
    await pool.query<{ id: number; name: string }>(`select id, name from pillars`)
  ).rows;

  const ranked = rows
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
        contentAngles: [],
      };
      const { score } = computeEngagementScore(idea as any, pillarName);
      return { idea, score };
    })
    .sort((a, b) => b.score - a.score);

  // Three days of declared slots, exactly as nextSlots() would emit them (UTC proc).
  const dayIso = ["2026-11-25", "2026-11-26", "2026-11-27"];
  const slotTimes = dayIso.flatMap((d) => [
    new Date(`${d}T07:30:00Z`), // 13:00 IST
    new Date(`${d}T14:00:00Z`), // 19:30 IST
    new Date(`${d}T17:30:00Z`), // 23:00 IST
  ]);

  console.log("=== AFTER: 3 days of calendar, real ranking, real slot resolution ===");
  console.log("  n   slot(IST)  declared        -> produced     idea");
  const produced: string[] = [];
  for (let i = 0; i < slotTimes.length && i < ranked.length; i++) {
    const slotDef = resolveSlotDef(slotTimes[i]);
    const idea = ranked[i].idea;
    const type = determineContentType(idea, {
      sourceType: "rss",
      contentAngles: [],
      preferredType: slotDef.preferredType,
    });
    produced.push(type);
    const ist = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(slotTimes[i]);
    console.log(
      `  ${String(i + 1).padStart(2)}  ${ist}       ${slotDef.preferredType.padEnd(14)} -> ${type.padEnd(12)} #${idea.id} ${String(idea.title).slice(0, 34)}`,
    );
  }

  const mix = new Map<string, number>();
  for (const t of produced) mix.set(t, (mix.get(t) ?? 0) + 1);
  console.log(`\n  type mix over 9 slots: ${[...mix.entries()].map(([t, c]) => `${t}:${c}`).join("  ")}`);
  console.log(`  distinct types: ${mix.size} / 3 declared`);

  console.log("\n=== BEFORE (the old rule, same slots, same ranking) ===");
  // Old: preferredType ignored, trending_now forced hot_take.
  const DAILY = [
    { hour: 13, minute: 0, preferredType: "thread" },
    { hour: 19, minute: 30, preferredType: "tweet" },
    { hour: 23, minute: 0, preferredType: "long_thread" },
  ];
  const oldProduced: string[] = [];
  // Old slot pairing: freeSlots[i] paired with DAILY[i % 3], where freeSlots is
  // the day's slots minus occupied ones. Simulate all free (the friendliest case).
  for (let i = 0; i < slotTimes.length && i < ranked.length; i++) {
    const idea = ranked[i].idea;
    const sug = idea.contentTypeSuggestion || "";
    const tl = idea.timeliness || "evergreen";
    // Old determineContentType, reproduced in order:
    let t: string;
    if (sug === "article") t = "article";
    else if (sug === "hot_take" || tl === "trending_now") t = "hot_take";
    else if (sug === "long_thread") t = "long_thread";
    else if (sug === "tweet") t = "tweet";
    else t = "thread";
    oldProduced.push(t);
    const slotDef = DAILY[i % DAILY.length];
    console.log(`  ${String(i + 1).padStart(2)}  declares ${slotDef.preferredType.padEnd(12)} -> ${t.padEnd(12)} #${idea.id}`);
  }
  const oldMix = new Map<string, number>();
  for (const t of oldProduced) oldMix.set(t, (oldMix.get(t) ?? 0) + 1);
  console.log(`\n  type mix over 9 slots: ${[...oldMix.entries()].map(([t, c]) => `${t}:${c}`).join("  ")}`);
  console.log(`  distinct types: ${oldMix.size} / 3 declared`);

  console.log("\n=== VERDICT ===");
  console.log(`  live published history : hot_take 75 / 84 = 89.3%`);
  console.log(`  old rule on 9 slots    : ${oldMix.size} distinct type(s)`);
  console.log(`  fixed rule on 9 slots  : ${mix.size} distinct type(s)`);
  console.log(
    mix.size > oldMix.size
      ? "  => the change is LOAD-BEARING on real data: it produces the shapes the calendar declares."
      : "  => INERT on real data. Correctness alone would be the only claim.",
  );

  await pool.end();
}
main().catch(async (e) => { console.error("FAILED:", e?.message ?? e); await pool.end().catch(() => {}); process.exit(1); });
