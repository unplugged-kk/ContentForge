/**
 * run46 — the calendar declares three content types for three times of day.
 *              The live output is 89% one type. Find out why, through the code.
 *
 * FACTS ON THE LIVE POOL (measured, not read):
 *   posts: 84 total, all autopilot=true
 *   post_type: hot_take 75 · article_thread 3 · weekly_recap 3 · long_thread 3
 *   => 75 / 84 = 89.3% hot_take
 *
 * DAILY_SLOTS (autopilot.ts:44-48) declares one preferredType per slot:
 *   13:00 EU morning      thread
 *   19:30 India evening   tweet
 *   23:00 US lunch        long_thread
 *
 * So the design intends three different shapes and the system ships one.
 *
 * TWO HYPOTHESES, both checkable against the real functions:
 *   H1  slotDef.preferredType is never read. postType comes from
 *       determineContentType(idea), which returns hot_take whenever
 *       timeliness === "trending_now" — 269/452 of the pool.
 *   H2  slotDef is chosen by `i % DAILY_SLOTS.length` where `i` indexes the
 *       FILTERED freeSlots array, so the declared slot can pair with a time of
 *       day it does not belong to.
 *
 * Imports the real `determineContentType`. Nothing about it is re-implemented.
 */
import { determineContentType } from "../server/autopilot";

const DAILY_SLOTS = [
  { hour: 13, minute: 0, preferredType: "thread", tone: "educational", label: "EU morning" },
  { hour: 19, minute: 30, preferredType: "tweet", tone: "provocative", label: "India evening" },
  { hour: 23, minute: 0, preferredType: "long_thread", tone: "storytelling", label: "US lunch" },
];

// Live pool distribution, read from discovered_ideas.
const LIVE: [string, number, string, string][] = [
  // timeliness, count, contentTypeSuggestion, category
  ["trending_now", 269, "thread", "mixed"],
  ["this_week", 161, "thread", "mixed"],
  ["evergreen", 22, "thread", "mixed"],
];

console.log("=== H1: what determineContentType() returns for the live pool ===");
// Rebuild the real pool per-row counts using the two independent distributions.
const sugOfTimeliness: Record<string, string[]> = {
  trending_now: ["thread", "long_thread", "hot_take", "tweet"],
  this_week: ["thread", "long_thread"],
  evergreen: ["thread", "long_thread", "tweet"],
};

let total = 0;
const byType = new Map<string, number>();
// The exact per-row combination matters, so enumerate the pool as the DB reports it.
const pairs: [string, string, number][] = [
  ["trending_now", "thread", 236],
  ["this_week", "thread", 0],
  ["evergreen", "thread", 0],
];
// Use the measured marginals instead: 236 thread / 131 long_thread / 68 hot_take / 17 tweet
// and 269 trending_now / 161 this_week / 22 evergreen. Enumerate all 12 combinations
// proportionally and report the resulting type distribution.
const timeliness = [["trending_now", 269], ["this_week", 161], ["evergreen", 22]] as const;
const suggestions = [["thread", 236], ["long_thread", 131], ["hot_take", 68], ["tweet", 17]] as const;
const N = 452;

const rows: { timeliness: string; suggestion: string; count: number }[] = [];
for (const [tl, tn] of timeliness) {
  for (const [sg, sn] of suggestions) {
    // proportional split; integer arithmetic then corrected below
    rows.push({ timeliness: tl, suggestion: sg, count: (tn * sn) / N });
  }
}

for (const r of rows) {
  if (r.count <= 0) continue;
  const type = determineContentType(
    {
      id: 0,
      title: "x",
      description: "",
      category: "platform_engineering",
      timeliness: r.timeliness,
      contentTypeSuggestion: r.suggestion,
    } as any,
    { sourceType: "rss", contentAngles: [] },
  );
  byType.set(type, (byType.get(type) ?? 0) + r.count);
  total += r.count;
}

console.log(`  projected from the live marginals (n=${N}):`);
for (const [t, c] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${t.padEnd(16)} ${c.toFixed(1).padStart(6)}  ${((c / total) * 100).toFixed(1)}%`);
}

console.log("\n=== H1: which single field decides it? ===");
for (const [tl, n] of timeliness) {
  const type = determineContentType(
    { id: 0, title: "x", description: "", category: "sre", timeliness: tl, contentTypeSuggestion: "thread" } as any,
    { sourceType: "rss", contentAngles: [] },
  );
  console.log(`  timeliness=${tl.padEnd(13)} suggestion=thread      -> ${type}   (${n} ideas)`);
}
console.log("  => the timeliness branch runs BEFORE the suggestion branch, so any");
console.log("     trending_now idea becomes hot_take regardless of what was declared.");

console.log("\n=== H1: is slot.preferredType ever consulted? ===");
for (const slot of DAILY_SLOTS) {
  const produced = ["trending_now", "this_week", "evergreen"].map((tl) =>
    determineContentType(
      { id: 0, title: "x", description: "", category: "sre", timeliness: tl, contentTypeSuggestion: "thread" } as any,
      { sourceType: "rss", contentAngles: [] },
    ),
  );
  console.log(
    `  ${slot.label.padEnd(14)} declares ${slot.preferredType.padEnd(12)} produces ${[...new Set(produced)].join("/")}`,
  );
}
console.log("  => preferredType is declared on all three slots and passed to nothing.");

console.log("\n=== H2: slotDef is indexed by freeSlots position, not by slot identity ===");
// autofillCalendar: slot = freeSlots[i]; slotDef = DAILY_SLOTS[i % 3]
// Simulate: 3 declared slots per day, some already occupied by a draft.
const fmtIST = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

function simulate(occupiedIdx: number[], label: string) {
  // nextSlots() returns one day of 3 slots in DAILY_SLOTS order (UTC process).
  const day = ["2026-11-25T07:30:00Z", "2026-11-25T14:00:00Z", "2026-11-25T17:30:00Z"].map((s) => new Date(s));
  const freeSlots = day.filter((_, idx) => !occupiedIdx.includes(idx));
  const out: string[] = [];
  for (let i = 0; i < freeSlots.length; i++) {
    const slotDef = DAILY_SLOTS[i % DAILY_SLOTS.length];
    const actualIST = fmtIST(freeSlots[i]);
    const declaredIST = `${String(slotDef.hour).padStart(2, "0")}:${String(slotDef.minute).padStart(2, "0")}`;
    const ok = actualIST === declaredIST;
    out.push(`    slot ${actualIST} gets ${slotDef.label} (${slotDef.tone}) declared=${declaredIST} ${ok ? "MATCH" : "** MISMATCH **"}`);
  }
  console.log(`  ${label}`);
  out.forEach((l) => console.log(l));
  return out.filter((l) => l.includes("MISMATCH")).length;
}

let mismatches = 0;
mismatches += simulate([], "no slots occupied (the clean case)");
mismatches += simulate([0], "13:00 already taken by a draft");
mismatches += simulate([1], "19:30 already taken");
mismatches += simulate([0, 1], "both first slots taken");

console.log(`\n  total MISMATCH pairings: ${mismatches}`);
console.log(
  mismatches > 0
    ? "  => the declared slot/tone pair drifts once any slot is occupied."
    : "  => the pairing holds.",
);
