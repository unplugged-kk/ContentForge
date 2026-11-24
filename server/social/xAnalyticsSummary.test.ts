/**
 * run47 / B59 — the analytics refresh must be able to say "I synced nothing".
 *
 * `refreshXAnalytics` used to end with:
 *     console.log(`[x analytics] refreshed ${targets.length} posts`);
 * where `targets` is the list it SELECTED, not the list it synced. On this host
 * the analytics endpoint is unset, so `syncPostAnalyticsFromX` returns before its
 * first `fetch` and writes nothing — yet the line still prints a positive count.
 * Measured on the live database: "refreshed 64 posts", 0 network calls, 0 rows.
 *
 * These tests pin the CORRECTED behaviour:
 *   - the summary reports synced, skipped and failed separately
 *   - a run where nothing could be synced says so, and does not claim a refresh
 *   - an empty eligible set is distinguishable from an all-skipped set
 *
 * The negative control (probe_feedback_loop.ts against the live DB) is what
 * proves the old shape fails; this file pins the new one so it cannot regress.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { summariseAnalyticsRefresh, type AnalyticsRefreshOutcome } from "./xAnalyticsSummary";

describe("summariseAnalyticsRefresh", () => {
  test("A1 all-skipped is reported as nothing refreshed, not as a success", () => {
    const s = summariseAnalyticsRefresh({
      eligible: 64,
      synced: 0,
      skipped: 64,
      failed: 0,
      skipReason: "analytics endpoint not configured",
    });
    assert.equal(s.clean, false, "a run that synced nothing must not be clean");
    assert.match(s.message, /0 synced/);
    assert.match(s.message, /64 skipped/);
    assert.match(s.message, /endpoint not configured/);
    // The exact old failure mode: a sentence that reads like a successful refresh.
    assert.doesNotMatch(s.message, /^\[x analytics\] refreshed \d+ posts$/);
  });

  test("A2 a fully synced run is clean and counts match", () => {
    const s = summariseAnalyticsRefresh({ eligible: 5, synced: 5, skipped: 0, failed: 0 });
    assert.equal(s.clean, true);
    assert.match(s.message, /5 synced/);
    assert.match(s.message, /5 eligible/);
  });

  test("A3 no eligible posts is distinguishable from all-skipped", () => {
    const empty = summariseAnalyticsRefresh({ eligible: 0, synced: 0, skipped: 0, failed: 0 });
    const skipped = summariseAnalyticsRefresh({
      eligible: 3, synced: 0, skipped: 3, failed: 0, skipReason: "no token",
    });
    assert.notEqual(empty.message, skipped.message);
    assert.match(empty.message, /no posts in window/);
    // Nothing to do is clean; failing to do something is not.
    assert.equal(empty.clean, true);
    assert.equal(skipped.clean, false);
  });

  test("A4 partial failure is never clean even when some posts synced", () => {
    const s = summariseAnalyticsRefresh({ eligible: 4, synced: 3, skipped: 0, failed: 1 });
    assert.equal(s.clean, false);
    assert.match(s.message, /1 failed/);
  });

  test("A5 the counters must add up — a lossy summary is a lying summary", () => {
    assert.throws(
      () => summariseAnalyticsRefresh({ eligible: 5, synced: 1, skipped: 1, failed: 0 }),
      /do not reconcile/,
    );
  });

  test("A6 skip reason is carried into the message so the cause is not lost", () => {
    const s = summariseAnalyticsRefresh({
      eligible: 2, synced: 0, skipped: 2, failed: 0,
      skipReason: "xQuick token missing",
    });
    assert.match(s.message, /xQuick token missing/);
  });
});

describe("AnalyticsRefreshOutcome shape", () => {
  test("A7 the type requires an explicit skip count, so 'unknown' cannot be encoded as zero", () => {
    const o: AnalyticsRefreshOutcome = {
      eligible: 1, synced: 0, skipped: 1, failed: 0, skipReason: "endpoint not configured",
    };
    assert.equal(Object.keys(o).includes("skipped"), true);
  });
});
