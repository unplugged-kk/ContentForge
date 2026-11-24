/**
 * run47 · negative control for B59 — does the new test actually discriminate?
 *
 * Three parts, because a test that passes on both the old and the new code
 * proves nothing:
 *
 *  1. The forbidden-pattern assertion in A1 is applied to the OLD literal line
 *     ("refreshed 64 posts") — it must MATCH, i.e. the old line is rejected.
 *     If this part fails, A1 is decoration.
 *  2. summariseAnalyticsRefresh is driven with the live outcome the old code
 *     would have produced (64 selected, 0 synced) — its message must not read
 *     like a success.
 *  3. refreshXAnalytics is executed against the LIVE database with the endpoint
 *     unset, and the emitted line is captured. Before the fix this printed
 *     "refreshed 64 posts" having made zero network calls.
 */
import { summariseAnalyticsRefresh } from "../server/social/xAnalyticsSummary";

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
  if (!cond) failures++;
}

async function main() {
  // ── Part 1: the assertion rejects the exact string the old code emitted ──
  const OLD_LINE = "[x analytics] refreshed 64 posts";
  const forbidden = /^\[x analytics\] refreshed \d+ posts$/;
  check(
    "P1 A1's forbidden pattern rejects the old log line",
    forbidden.test(OLD_LINE),
    `pattern ${forbidden} applied to ${JSON.stringify(OLD_LINE)} -> ${forbidden.test(OLD_LINE)}`,
  );

  // ── Part 2: the summary built from the old code's numbers is not clean ──
  const oldShaped = summariseAnalyticsRefresh({
    eligible: 64, synced: 0, skipped: 64, failed: 0,
    skipReason: "XQUIK_ANALYTICS_ENDPOINT not configured",
  });
  check(
    "P2 64 selected / 0 synced is reported as incomplete, not refreshed",
    oldShaped.clean === false && !forbidden.test(oldShaped.message),
    `clean=${oldShaped.clean} message=${JSON.stringify(oldShaped.message)}`,
  );

  // ── Part 3: run the REAL function against the live DB, capture its line ──
  const { refreshXAnalytics } = await import("../server/social/x");
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...a: any[]) => { lines.push(a.join(" ")); };

  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...a: any[]) => { fetchCalls++; return (realFetch as any)(...a); }) as any;

  try {
    await refreshXAnalytics(400, 1);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }

  const emitted = lines.filter((l) => l.includes("[x analytics]")).join("\n");
  realLog(`\nP3 live refreshXAnalytics emitted:\n      ${emitted}`);
  realLog(`      network calls during that refresh: ${fetchCalls}`);
  check(
    "P3 the live line no longer claims a refresh it did not perform",
    !forbidden.test(emitted) && /skipped/.test(emitted),
    `emitted=${JSON.stringify(emitted)}`,
  );

  console.log(`\n${failures === 0 ? "CONTROL PASSED" : `CONTROL FAILED (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(3); });
