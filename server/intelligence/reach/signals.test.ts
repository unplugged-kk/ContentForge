/**
 * Reach signals: report only what was measured.
 *
 * The point of these tests is the honesty property — unmeasured metrics must not
 * read as zero performance, thin samples must not read as strong, and nothing
 * claims a trend the data cannot support.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeReachSignals, reachSignalRecord } from "./signals";

const totals = (rows: Array<[string, number, number, number]>) =>
  rows.map(([metric, total, observedCount, notAvailableCount]) => ({
    metric,
    total,
    observedCount,
    notAvailableCount,
  }));

describe("computeReachSignals", () => {
  it("reports insufficient with no history at all", () => {
    const signals = computeReachSignals({ publishedCount: 0 });
    assert.equal(signals.confidence, "insufficient");
    assert.equal(signals.historical_performance, 0);
    assert.equal(signals.reach_potential, 0);
    assert.deepEqual(signals.observedMetrics, []);
  });

  it("scores a measured engagement rate against the baseline", () => {
    const signals = computeReachSignals({
      publishedCount: 12,
      metricTotals: totals([
        ["impressions", 20_000, 12, 0],
        ["likes", 600, 12, 0],
        ["comments", 120, 12, 0],
      ]),
    });
    // (600+120)/20000 = 3.6% against a 6% ceiling → ~0.6
    assert.ok(signals.historical_performance > 0.55 && signals.historical_performance < 0.65);
    assert.equal(signals.confidence, "strong");
  });

  it("does NOT read unmeasured metrics as zero", () => {
    // Impressions were never observed: an engagement rate is not computable, and
    // the provider must say so rather than report 0 engagement.
    const signals = computeReachSignals({
      publishedCount: 8,
      metricTotals: totals([
        ["impressions", 0, 0, 8],
        ["likes", 0, 0, 8],
      ]),
    });
    assert.equal(signals.historical_performance, 0);
    assert.equal(signals.reach_potential, 0);
    assert.deepEqual(signals.observedMetrics, [], "not_available rows are not observations");
  });

  it("saturates reach potential on a log scale", () => {
    const small = computeReachSignals({
      publishedCount: 5,
      metricTotals: totals([["impressions", 500, 5, 0]]),
    });
    const large = computeReachSignals({
      publishedCount: 5,
      metricTotals: totals([["impressions", 250_000, 5, 0]]),
    });
    assert.ok(small.reach_potential < large.reach_potential);
    assert.ok(large.reach_potential <= 1);
  });

  it("grades confidence by sample size", () => {
    const withMetrics = (publishedCount: number) =>
      computeReachSignals({
        publishedCount,
        metricTotals: totals([["impressions", 5_000, publishedCount, 0]]),
      });
    assert.equal(withMetrics(2).confidence, "insufficient");
    assert.equal(withMetrics(4).confidence, "weak");
    assert.equal(withMetrics(30).confidence, "strong");
  });

  it("never returns a non-finite or out-of-range number", () => {
    const record = reachSignalRecord(
      computeReachSignals({
        publishedCount: 3,
        metricTotals: totals([
          ["impressions", Number.NaN, 1, 0],
          ["likes", -5, 1, 0],
        ]),
      }),
    );
    for (const [key, value] of Object.entries(record)) {
      assert.ok(Number.isFinite(value), `${key} must be finite`);
      assert.ok(value >= 0, `${key} must not be negative`);
    }
  });
});
