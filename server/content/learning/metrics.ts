import { JobFailure, type FailureClass } from "../../jobs/failures";
import {
  CANONICAL_METRICS,
  PERFORMANCE_SCHEMA_VERSION,
  type CanonicalMetric,
} from "./constants";

export type MetricAvailability = "observed" | "not_available";

export interface NormalizedMetric {
  metric: CanonicalMetric;
  value: number | null;
  availability: MetricAvailability;
}

export interface MetricFetchRequest {
  channel: string;
  externalId: string;
  publicationId: number;
  correlationId: string;
  ownerUserId?: number | null;
}

export interface MetricFetchOutcome {
  ok: boolean;
  provider: string;
  retrievedAt: Date;
  observedAt: Date;
  measurementWindow: string | null;
  externalId: string;
  normalizationVersion: string;
  metrics: NormalizedMetric[];
  errorClass?: FailureClass;
  errorMessage?: string;
  /**
   * Provider metrics with no safe canonical mapping (e.g. Threads `quotes`).
   * Stored on PerformanceSignal.provenance, never coerced into another metric.
   */
  unmapped?: Record<string, number>;
}

export function notAvailableMetrics(): NormalizedMetric[] {
  return CANONICAL_METRICS.map((metric) => ({
    metric,
    value: null,
    availability: "not_available" as const,
  }));
}

export function missingMetricsOutcome(
  provider: string,
  externalId: string,
  retrievedAt: Date,
  observedAt: Date,
  measurementWindow: string | null,
): MetricFetchOutcome {
  return {
    ok: true,
    provider,
    retrievedAt,
    observedAt,
    measurementWindow,
    externalId,
    normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
    metrics: notAvailableMetrics(),
  };
}

function asNonNegativeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function pickCount(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (key in source) {
      const n = asNonNegativeNumber(source[key]);
      if (n !== null) return n;
    }
  }
  return null;
}

function metricRow(metric: CanonicalMetric, value: number | null): NormalizedMetric {
  if (value === null) return { metric, value: null, availability: "not_available" };
  return { metric, value, availability: "observed" };
}

/**
 * Map a provider-shaped metrics object into the canonical v1 set.
 * Unknown keys are ignored. Absent keys become `not_available`, never 0.
 */
export function normalizeProviderMetrics(
  source: Record<string, unknown>,
  channel: string,
): NormalizedMetric[] {
  const nested =
    source.public_metrics && typeof source.public_metrics === "object"
      ? (source.public_metrics as Record<string, unknown>)
      : source.metrics && typeof source.metrics === "object"
        ? (source.metrics as Record<string, unknown>)
        : source;

  const impressions = pickCount(nested, ["impressions", "impression_count", "views", "view_count"]);
  const likes = pickCount(nested, ["likes", "like_count"]);
  const comments = pickCount(nested, ["comments", "comment_count"]);
  const shares = pickCount(nested, ["shares", "share_count", "reposts", "retweets", "retweet_count"]);
  const clicks = pickCount(nested, ["clicks", "click_count", "url_link_clicks"]);
  const saves = pickCount(nested, ["saves", "bookmarks", "bookmark_count"]);
  const replies = pickCount(nested, ["replies", "reply_count"]);
  const followers = pickCount(nested, ["followers_gained", "followers", "follower_count"]);
  const engagement = pickCount(nested, ["engagement_rate"]);

  void channel;
  return [
    metricRow("impressions", impressions),
    metricRow("likes", likes),
    metricRow("comments", comments),
    metricRow("shares", shares),
    metricRow("clicks", clicks),
    metricRow("saves", saves),
    metricRow("replies", replies),
    metricRow("followers_gained", followers),
    metricRow("engagement_rate", engagement),
  ];
}

export function classifyMetricsHttpFailure(status: number, message: string): FailureClass {
  if (status === 429) return "rate_limited";
  if (status >= 500 || status === 408) return "transient";
  if (status === 401 || status === 403) return "permanent";
  if (status === 404) return "permanent";
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("econnreset") || lower.includes("temporarily")) {
    return "transient";
  }
  if (lower.includes("credential") || lower.includes("unauthorized") || lower.includes("invalid")) {
    return "permanent";
  }
  return "permanent";
}

export function metricsFailureToJobError(outcome: MetricFetchOutcome): never {
  const message = outcome.errorMessage ?? "metrics retrieval failed";
  if (outcome.errorClass === "rate_limited") throw JobFailure.rateLimited(message);
  if (outcome.errorClass === "transient") throw JobFailure.transient(message);
  if (outcome.errorClass === "policy_human") throw JobFailure.policyHuman(message);
  throw JobFailure.permanent(message);
}

export function validateNormalizedMetrics(metrics: NormalizedMetric[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const row of metrics) {
    if (!CANONICAL_METRICS.includes(row.metric)) {
      issues.push(`unknown metric ${row.metric}`);
      continue;
    }
    if (seen.has(row.metric)) issues.push(`duplicate metric ${row.metric}`);
    seen.add(row.metric);
    if (row.availability === "not_available") {
      if (row.value !== null) issues.push(`${row.metric}: not_available must have null value`);
    } else if (row.value === null || !Number.isFinite(row.value)) {
      issues.push(`${row.metric}: observed metric requires a numeric value`);
    }
  }
  return issues;
}
