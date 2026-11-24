/**
 * run46 — is the posting calendar the one DAILY_SLOTS declares?
 *
 * `DAILY_SLOTS` (autopilot.ts:44-48) declares three IST slots:
 *   13:00 "EU morning" · 19:30 "India evening" · 23:00 "US lunch"
 *
 * The live calendar holds posts at 02:00, 04:00, 08:30, 10:30, 12:00 IST.
 * None of those is a declared slot.
 *
 * `nextSlots()` mixes two time models in four lines:
 *   toIST()      shifts the instant by +5.5h, so a Date's UTC fields read IST wall clock
 *   setHours()   sets hours in the PROCESS LOCAL timezone
 *   fromIST()    shifts back by -5.5h
 *
 * toIST/fromIST are instant arithmetic and are TZ-independent. setHours is not.
 * So the pair only cancels out when the process runs in UTC. This script proves
 * that by running the real `nextSlots` logic under both timezones rather than
 * reasoning about it.
 *
 * The real code is imported. Nothing is re-implemented except where marked.
 */
import { computeEngagementScore, determineContentType } from "../server/autopilot";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const toIST = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);
const fromIST = (d: Date) => new Date(d.getTime() - IST_OFFSET_MS);

// DAILY_SLOTS as declared in autopilot.ts:44-48 (read-only copy of the constants,
// because the array is not exported).
const DAILY_SLOTS = [
  { hour: 13, minute: 0, preferredType: "thread", tone: "educational", label: "EU morning" },
  { hour: 19, minute: 30, preferredType: "tweet", tone: "provocative", label: "India evening" },
  { hour: 23, minute: 0, preferredType: "long_thread", tone: "storytelling", label: "US lunch" },
];

// nextSlots(), transcribed verbatim from autopilot.ts:485-499.
function nextSlots(fromDate: Date, count: number): Date[] {
  const slots: Date[] = [];
  const istNow = toIST(fromDate);
  for (let day = 0; slots.length < count; day++) {
    const base = new Date(istNow);
    base.setDate(base.getDate() + day);
    for (const slot of DAILY_SLOTS) {
      if (slots.length >= count) break;
      const t = new Date(base);
      t.setHours(slot.hour, slot.minute, 0, 0);
      const utcTime = fromIST(t);
      if (utcTime > fromDate) slots.push(utcTime);
    }
  }
  return slots;
}

function fmtIST(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
function fmtUTC(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

console.log(`process TZ = ${process.env.TZ ?? "(unset — follows /etc/localtime)"}`);
console.log(`Intl resolved TZ = ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`local offset = ${-new Date().getTimezoneOffset()} min\n`);

const from = new Date("2026-11-24T04:00:00Z");
const slots = nextSlots(from, 6);

console.log("=== what nextSlots() actually returns, in THIS process TZ ===");
console.log("  utc                 ist    declared slot it should be");
for (const s of slots) {
  const ist = fmtIST(s);
  const declared = DAILY_SLOTS.find((d) => fmtIST(new Date(s)) === `${String(d.hour).padStart(2, "0")}:${String(d.minute).padStart(2, "0")}`);
  console.log(
    `  ${fmtUTC(s)}   ${ist}   ${declared ? `${declared.label} (${declared.preferredType})` : "NONE OF THE THREE"}`,
  );
}

const declaredIST = DAILY_SLOTS.map(
  (d) => `${String(d.hour).padStart(2, "0")}:${String(d.minute).padStart(2, "0")}`,
);
const actualIST = [...new Set(slots.map(fmtIST))];
const onSlot = actualIST.filter((t) => declaredIST.includes(t));
console.log(
  `\ndeclared IST slots      : ${declaredIST.join(", ")}`,
);
console.log(`produced IST slots      : ${actualIST.join(", ")}`);
console.log(
  `overlap                 : ${onSlot.length} / ${actualIST.length} distinct produced slots`,
);
console.log(
  onSlot.length === actualIST.length
    ? "RESULT: the calendar matches DAILY_SLOTS in this TZ"
    : "RESULT: THE CALENDAR DOES NOT MATCH DAILY_SLOTS IN THIS TZ",
);

// ── preferredType: declared per slot, and never read ────────────────────────
console.log("\n=== slot.preferredType: declared, then overwritten by determineContentType ===");
const ideas = [
  { timeliness: "trending_now", contentTypeSuggestion: "thread" },
  { timeliness: "this_week", contentTypeSuggestion: "thread" },
  { timeliness: "evergreen", contentTypeSuggestion: "tweet" },
  { timeliness: "evergreen", contentTypeSuggestion: "long_thread" },
  { timeliness: "evergreen", contentTypeSuggestion: "hot_take" },
];
for (const slot of DAILY_SLOTS) {
  const produced = ideas.map((i) =>
    determineContentType({ id: 0, title: "x", description: "", ...i } as any, {}),
  );
  console.log(
    `  ${slot.label.padEnd(14)} declares ${slot.preferredType.padEnd(12)} -> produced ${[...new Set(produced)].join(", ")}`,
  );
}

// What the live pool would actually produce for post_type.
console.log("\n=== live pool: what determineContentType returns ===");
const live = [
  { cat: "platform_engineering", n: 72, tl: "trending_now", sug: "thread" },
  { cat: "ai", n: 59, tl: "trending_now", sug: "thread" },
  { cat: "ai_research", n: 56, tl: "this_week", sug: "thread" },
  { cat: "sre", n: 50, tl: "trending_now", sug: "hot_take" },
  { cat: "mlops", n: 49, tl: "this_week", sug: "thread" },
];
for (const l of live) {
  const t = determineContentType(
    { id: 0, title: "x", description: "", category: l.cat, timeliness: l.tl, contentTypeSuggestion: l.sug } as any,
    { sourceType: "rss", contentAngles: [] },
  );
  console.log(`  ${l.cat.padEnd(21)} timeliness=${l.tl.padEnd(13)} suggestion=${l.sug.padEnd(12)} -> ${t}`);
}
