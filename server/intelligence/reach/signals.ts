/**
 * Reach signals — deterministic, from our OWN performance history.
 *
 * Deliberately narrow. This provider reports only what ContentForge's data can
 * actually support:
 *
 *   • historical_performance — observed engagement rate against a baseline
 *   • reach_potential        — log-scaled observed reach volume
 *   • sample size + confidence — so a decision can discount thin evidence
 *
 * It does NOT report `trend_strength` or `topic_velocity`. Those need a real
 * time series (or an external signal feed), and inventing them from a summary
 * that carries no timing would be fabrication dressed as evidence. They land
 * when the Agent Reach ingest seam does.
 *
 * This is also why Agent Reach is not implemented as a scraper here: cookie-based
 * channels carry ban risk on accounts that are actually publishing. The first
 * increment is our own data plus an ingest seam for externally produced signals.
 */

export interface ReachChannelStat {
  channel: string;
  published: number;
  observedMetrics: number;
}

export interface ReachMetricTotal {
  metric: string;
  total: number;
  observedCount: number;
  notAvailableCount: number;
}

export interface ReachInput {
  publishedCount: number;
  byChannel?: readonly ReachChannelStat[];
  metricTotals?: readonly ReachMetricTotal[];
  /** The channel being judged, when the caller has one in mind. */
  channel?: string;
}

export type ReachConfidence = "strong" | "weak" | "insufficient";

export interface ReachSignals {
  /** 0..1 — observed engagement rate against a baseline. */
  historical_performance: number;
  /** 0..1 — log-scaled observed reach volume. */
  reach_potential: number;
  /** Publications behind these numbers. */
  sampleSize: number;
  confidence: ReachConfidence;
  /** Which metrics actually contributed — never claim what was not measured. */
  observedMetrics: string[];
}

export const REACH_BOUNDS = {
  /** An engagement rate at or above this reads as a full-credit history. */
  strongEngagementRate: 0.06,
  /** Impressions at or above this read as full-credit reach (log-scaled). */
  strongImpressions: 100_000,
  minSamplesForStrong: 10,
  minSamplesForWeak: 3,
} as const;

const ENGAGEMENT_METRICS = ["likes", "comments", "shares", "saves", "replies", "clicks"] as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function metricTotal(totals: readonly ReachMetricTotal[], metric: string): ReachMetricTotal | undefined {
  return totals.find((entry) => entry.metric === metric);
}

/** Only rows the provider actually observed count; `not_available` is not a zero. */
function observedValue(totals: readonly ReachMetricTotal[], metric: string): number | null {
  const row = metricTotal(totals, metric);
  if (!row || row.observedCount <= 0) return null;
  return row.total;
}

function logScale(value: number, ceiling: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return clamp01(Math.log10(value + 1) / Math.log10(ceiling + 1));
}

export function computeReachSignals(input: ReachInput): ReachSignals {
  const totals = input.metricTotals ?? [];
  const sampleSize = Math.max(0, input.publishedCount);

  const impressions = observedValue(totals, "impressions");
  const observedMetrics = totals.filter((row) => row.observedCount > 0).map((row) => row.metric);

  // Engagement rate is only meaningful when impressions were actually measured.
  let historicalPerformance = 0;
  let engagementMetricsObserved = 0;
  if (impressions !== null && impressions > 0) {
    let engagements = 0;
    for (const metric of ENGAGEMENT_METRICS) {
      const value = observedValue(totals, metric);
      if (value !== null) {
        engagements += value;
        engagementMetricsObserved += 1;
      }
    }
    if (engagementMetricsObserved > 0) {
      const rate = engagements / impressions;
      historicalPerformance = clamp01(rate / REACH_BOUNDS.strongEngagementRate);
    }
  }

  const reachPotential = impressions === null ? 0 : logScale(impressions, REACH_BOUNDS.strongImpressions);

  const confidence: ReachConfidence =
    sampleSize >= REACH_BOUNDS.minSamplesForStrong && observedMetrics.length > 0
      ? "strong"
      : sampleSize >= REACH_BOUNDS.minSamplesForWeak
        ? "weak"
        : "insufficient";

  return {
    historical_performance: Number(historicalPerformance.toFixed(4)),
    reach_potential: Number(reachPotential.toFixed(4)),
    sampleSize,
    confidence,
    observedMetrics,
  };
}

/** The numeric slice handed to the decision layer. */
export function reachSignalRecord(signals: ReachSignals): Record<string, number> {
  return {
    historical_performance: signals.historical_performance,
    reach_potential: signals.reach_potential,
    sample_size: signals.sampleSize,
  };
}
