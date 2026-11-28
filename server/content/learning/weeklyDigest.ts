/**
 * Deterministic Weekly Cohort Digest (INC-08).
 *
 * Pure cohort analyzer over owner-scoped publications and performance signals.
 * Groups comparable published items by `(channel, format, topicTag, hookType)`
 * within a UTC window, preserves explicit missingness (never coercing absent or
 * `not_available` metrics to 0), deduplicates repeated metric snapshots, and
 * emits strictly non-causal observational summaries with sample-size caution.
 */

import { eq, inArray } from "drizzle-orm";
import {
  artifacts,
  opportunities,
  performanceSignals,
  publications,
  results,
} from "@shared/schema";
import type { ContentDatabase } from "../storage";

export type CohortConfidence = "insufficient" | "directional" | "moderate";

export interface WeeklyDigestMetricPoint {
  metric: string;
  value: number | null;
  availability: "observed" | "not_available";
  observedAt: Date | string;
  identityKey?: string | null;
  provider?: string | null;
}

export interface WeeklyDigestEntry {
  publicationId: number;
  artifactId?: number | null;
  channel: string;
  format: string;
  topicTag?: string | null;
  hookType?: string | null;
  publishedAt: Date | string | null;
  /** Deleted or unpublished rows are excluded from cohort statistics. */
  deleted?: boolean;
  /** Defaults to `"published"`; any other state is excluded. */
  state?: string;
  metrics?: WeeklyDigestMetricPoint[];
  /** Optional direct convenience values when callers already resolved latest metrics. */
  impressions?: number | null;
  engagementRate?: number | null;
  missingReason?: string | null;
}

export interface WeeklyDigestCohort {
  key: string;
  channel: string;
  format: string;
  topicTag: string;
  hookType: string;
  sampleSize: number;
  observedCount: number;
  impressionsObservedCount: number;
  engagementRateObservedCount: number;
  missingMetricsCount: number;
  missingReasons: string[];
  medianImpressions: number | null;
  medianEngagementRate: number | null;
  confidence: CohortConfidence;
  cautionNote: string;
  publicationIds: number[];
}

export interface WeeklyLearningDigest {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  totalPublications: number;
  observedPublications: number;
  missingMetricsPublications: number;
  missingReasons: string[];
  deduplicatedMetricRows: number;
  excluded: {
    outOfWindow: number;
    deletedOrUnpublished: number;
    duplicatePublications: number;
    missingPublishedAt: number;
  };
  cohorts: WeeklyDigestCohort[];
  nextExperiment: string;
  methodologyNote: string;
}

const MS_PER_DAY = 86_400_000;
const ENGAGEMENT_INTERACTION_METRICS = new Set([
  "likes",
  "comments",
  "shares",
  "replies",
  "saves",
]);

const CONFIDENCE_RANK: Record<CohortConfidence, number> = {
  moderate: 3,
  directional: 2,
  insufficient: 1,
};

function toUtcMs(input: Date | string | null | undefined): number | null {
  if (input == null) return null;
  const date = input instanceof Date ? input : new Date(input);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTag(value: string | null | undefined, fallback: string): string {
  const cleaned = typeof value === "string" ? value.trim().toLowerCase() : "";
  return cleaned || fallback;
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Number(raw.toFixed(6));
}

export function classifyCohortConfidence(sampleSize: number, observedCount: number): CohortConfidence {
  const effective = Math.min(sampleSize, observedCount);
  if (effective < 3) return "insufficient";
  if (effective < 10) return "directional";
  return "moderate";
}

function cautionNoteFor(
  confidence: CohortConfidence,
  sampleSize: number,
  observedCount: number,
): string {
  if (confidence === "insufficient") {
    return `Observational only (n=${observedCount} observed / ${sampleSize} published): insufficient sample size (< 3); do not infer causation or change policy yet.`;
  }
  if (confidence === "directional") {
    return `Observational only (n=${observedCount} observed / ${sampleSize} published): directional correlation only; small samples cannot establish causation.`;
  }
  return `Observational only (n=${observedCount} observed / ${sampleSize} published): moderate observational sample; treat differences as correlation, not proven causation, and validate via controlled experiment.`;
}

interface ResolvedPublicationMetrics {
  impressions: number | null;
  engagementRate: number | null;
  missingReasons: string[];
  deduplicatedMetricRows: number;
}

function resolvePublicationMetrics(
  entry: WeeklyDigestEntry,
  windowEndMs: number,
): ResolvedPublicationMetrics {
  const rawMetrics = entry.metrics ?? [];
  const seenKeys = new Set<string>();
  const uniquePoints: Array<{ point: WeeklyDigestMetricPoint; observedAtMs: number }> = [];
  let deduplicatedMetricRows = 0;

  for (const point of rawMetrics) {
    const observedAtMs = toUtcMs(point.observedAt);
    if (observedAtMs === null) continue;
    // Ignore snapshots dated after the digest's `now` cutoff for point-in-time reproducibility.
    if (observedAtMs > windowEndMs) continue;

    const dedupeKey = point.identityKey?.trim()
      ? `id:${point.identityKey.trim()}`
      : `sig:${point.metric}|${observedAtMs}|${point.availability}|${point.value === null ? "null" : point.value}`;

    if (seenKeys.has(dedupeKey)) {
      deduplicatedMetricRows += 1;
      continue;
    }
    seenKeys.add(dedupeKey);
    uniquePoints.push({ point, observedAtMs });
  }

  // Keep latest snapshot per metric within the digest cutoff.
  const latestByMetric = new Map<
    string,
    { point: WeeklyDigestMetricPoint; observedAtMs: number }
  >();
  for (const item of uniquePoints) {
    const prev = latestByMetric.get(item.point.metric);
    if (!prev || item.observedAtMs > prev.observedAtMs) {
      latestByMetric.set(item.point.metric, item);
      continue;
    }
    if (
      item.observedAtMs === prev.observedAtMs &&
      item.point.availability === "observed" &&
      prev.point.availability !== "observed"
    ) {
      latestByMetric.set(item.point.metric, item);
    }
  }

  const reasons = new Set<string>();
  if (entry.missingReason?.trim()) reasons.add(entry.missingReason.trim());

  let impressions: number | null =
    typeof entry.impressions === "number" && Number.isFinite(entry.impressions)
      ? entry.impressions
      : null;
  const impressionsPoint = latestByMetric.get("impressions")?.point;
  if (impressionsPoint) {
    if (
      impressionsPoint.availability === "observed" &&
      impressionsPoint.value !== null &&
      Number.isFinite(impressionsPoint.value)
    ) {
      impressions = impressionsPoint.value;
    } else if (impressionsPoint.availability === "not_available") {
      reasons.add("impressions_not_available");
    }
  }

  let engagementRate: number | null =
    typeof entry.engagementRate === "number" && Number.isFinite(entry.engagementRate)
      ? entry.engagementRate
      : null;
  const ratePoint = latestByMetric.get("engagement_rate")?.point;
  if (ratePoint) {
    if (
      ratePoint.availability === "observed" &&
      ratePoint.value !== null &&
      Number.isFinite(ratePoint.value)
    ) {
      engagementRate = ratePoint.value;
    } else if (ratePoint.availability === "not_available") {
      reasons.add("engagement_rate_not_available");
    }
  }

  // Derive engagementRate only when impressions > 0 and at least one interaction
  // metric was explicitly observed (never fabricating from missing metrics).
  if (engagementRate === null && impressions !== null && impressions > 0 && !ratePoint) {
    let interactionSum = 0;
    let interactionObserved = 0;
    for (const metricName of Array.from(ENGAGEMENT_INTERACTION_METRICS)) {
      const p = latestByMetric.get(metricName)?.point;
      if (p && p.availability === "observed" && p.value !== null && Number.isFinite(p.value)) {
        interactionSum += p.value;
        interactionObserved += 1;
      }
    }
    if (interactionObserved > 0) {
      engagementRate = Number((interactionSum / impressions).toFixed(6));
    }
  }

  if (impressions === null && engagementRate === null) {
    if (uniquePoints.length === 0) {
      reasons.add("no_metrics_logged");
    } else if (reasons.size === 0) {
      reasons.add("metrics_not_available");
    }
  } else {
    if (impressions === null && !reasons.has("impressions_not_available")) {
      reasons.add("impressions_missing");
    }
    if (engagementRate === null && !reasons.has("engagement_rate_not_available")) {
      reasons.add("engagement_rate_missing");
    }
  }

  return {
    impressions,
    engagementRate,
    missingReasons: Array.from(reasons).sort(),
    deduplicatedMetricRows,
  };
}

function formatPercent(rate: number): string {
  const pct = rate <= 1 ? rate * 100 : rate;
  return `${pct.toFixed(1)}%`;
}

function buildNextExperiment(
  cohorts: WeeklyDigestCohort[],
  totalPublications: number,
  missingMetricsPublications: number,
): string {
  if (totalPublications === 0 || cohorts.length === 0) {
    return "No in-window published posts yet. Publish and log metrics for at least 3 posts in one channel/format cohort to establish a directional baseline.";
  }

  const actionable = cohorts.filter((c) => c.confidence !== "insufficient");
  if (actionable.length === 0) {
    const top = cohorts[0];
    const remaining = Math.max(1, 3 - Math.min(top.sampleSize, top.observedCount));
    if (missingMetricsPublications > 0) {
      const target = cohorts.find((c) => c.missingMetricsCount > 0) ?? top;
      return `Sample size is insufficient across all cohorts (< 3 observed). Log metrics for the ${missingMetricsPublications} published post(s) missing observations (starting with ${target.channel}/${target.format} · ${target.topicTag}) before selecting an experiment.`;
    }
    return `Sample size is insufficient across all cohorts (< 3 observed). Publish and log metrics for at least ${remaining} more post(s) in ${top.channel}/${top.format} (topic: ${top.topicTag}, hook: ${top.hookType}) to reach a directional baseline.`;
  }

  const leader = actionable[0];
  const leaderMetricText =
    leader.medianEngagementRate !== null
      ? `${formatPercent(leader.medianEngagementRate)} median engagement rate`
      : leader.medianImpressions !== null
        ? `${Math.round(leader.medianImpressions)} median impressions`
        : `${leader.observedCount} observed posts`;

  const runnerUp = actionable[1];
  if (runnerUp) {
    const runnerMetricText =
      runnerUp.medianEngagementRate !== null
        ? `${formatPercent(runnerUp.medianEngagementRate)} median engagement rate`
        : runnerUp.medianImpressions !== null
          ? `${Math.round(runnerUp.medianImpressions)} median impressions`
          : `${runnerUp.observedCount} observed posts`;
    return `Run a low-risk 3-post split test comparing ${leader.channel}/${leader.format} (${leader.topicTag}, hook: ${leader.hookType}; n=${leader.observedCount}, ${leaderMetricText}) against ${runnerUp.channel}/${runnerUp.format} (${runnerUp.topicTag}, hook: ${runnerUp.hookType}; n=${runnerUp.observedCount}, ${runnerMetricText}) while keeping posting time fixed; treat current differences as observational until confirmed.`;
  }

  return `Keep ${leader.channel}/${leader.format} (${leader.topicTag}, hook: ${leader.hookType}; n=${leader.observedCount}, ${leaderMetricText}) as your control baseline and test one alternative hook across the next 3 posts to compare observational lift.`;
}

/**
 * Pure weekly cohort analyzer. Deterministic for a fixed `(observations, windowDays, now)`.
 */
export function buildWeeklyLearningDigest(input: {
  observations: WeeklyDigestEntry[];
  windowDays?: number;
  now?: Date;
}): WeeklyLearningDigest {
  const windowDays =
    typeof input.windowDays === "number" && Number.isFinite(input.windowDays)
      ? Math.min(Math.max(Math.trunc(input.windowDays), 1), 90)
      : 7;
  const now = input.now instanceof Date ? input.now : new Date();
  const windowEndMs = now.getTime();
  const windowStartMs = windowEndMs - windowDays * MS_PER_DAY;

  const excluded = {
    outOfWindow: 0,
    deletedOrUnpublished: 0,
    duplicatePublications: 0,
    missingPublishedAt: 0,
  };

  // Deduplicate by publicationId while merging any metric rows carried across duplicates.
  const dedupedByPub = new Map<number, WeeklyDigestEntry>();
  for (const entry of input.observations) {
    if (entry.deleted || (entry.state !== undefined && entry.state !== "published")) {
      excluded.deletedOrUnpublished += 1;
      continue;
    }

    const publishedAtMs = toUtcMs(entry.publishedAt);
    if (publishedAtMs === null) {
      excluded.missingPublishedAt += 1;
      continue;
    }
    if (publishedAtMs < windowStartMs || publishedAtMs > windowEndMs) {
      excluded.outOfWindow += 1;
      continue;
    }

    const existing = dedupedByPub.get(entry.publicationId);
    if (existing) {
      excluded.duplicatePublications += 1;
      dedupedByPub.set(entry.publicationId, {
        ...existing,
        topicTag: existing.topicTag || entry.topicTag,
        hookType: existing.hookType || entry.hookType,
        impressions: existing.impressions ?? entry.impressions,
        engagementRate: existing.engagementRate ?? entry.engagementRate,
        missingReason: existing.missingReason ?? entry.missingReason,
        metrics: [...(existing.metrics ?? []), ...(entry.metrics ?? [])],
      });
      continue;
    }
    dedupedByPub.set(entry.publicationId, entry);
  }

  interface Bucket {
    channel: string;
    format: string;
    topicTag: string;
    hookType: string;
    publicationIds: number[];
    impressions: number[];
    engagementRates: number[];
    observedCount: number;
    missingMetricsCount: number;
    missingReasons: Set<string>;
  }

  const buckets = new Map<string, Bucket>();
  const globalMissingReasons = new Set<string>();
  let totalDeduplicatedMetricRows = 0;
  let observedPublications = 0;
  let missingMetricsPublications = 0;

  const orderedEntries = Array.from(dedupedByPub.values()).sort(
    (a, b) => a.publicationId - b.publicationId,
  );

  for (const entry of orderedEntries) {
    const channel = normalizeTag(entry.channel, "unknown");
    const format = normalizeTag(entry.format, "unknown");
    const topicTag = normalizeTag(entry.topicTag, "untagged");
    const hookType = normalizeTag(entry.hookType, "unspecified");
    const key = `${channel}|${format}|${topicTag}|${hookType}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        channel,
        format,
        topicTag,
        hookType,
        publicationIds: [],
        impressions: [],
        engagementRates: [],
        observedCount: 0,
        missingMetricsCount: 0,
        missingReasons: new Set<string>(),
      };
      buckets.set(key, bucket);
    }

    bucket.publicationIds.push(entry.publicationId);

    const resolved = resolvePublicationMetrics(entry, windowEndMs);
    totalDeduplicatedMetricRows += resolved.deduplicatedMetricRows;

    if (resolved.impressions !== null) bucket.impressions.push(resolved.impressions);
    if (resolved.engagementRate !== null) bucket.engagementRates.push(resolved.engagementRate);

    const hasAnyObserved = resolved.impressions !== null || resolved.engagementRate !== null;
    const isMissingCore = resolved.impressions === null || resolved.engagementRate === null;

    if (hasAnyObserved) {
      bucket.observedCount += 1;
      observedPublications += 1;
    }
    if (isMissingCore) {
      bucket.missingMetricsCount += 1;
      missingMetricsPublications += 1;
    }
    for (const reason of resolved.missingReasons) {
      bucket.missingReasons.add(reason);
      globalMissingReasons.add(reason);
    }
  }

  const cohorts: WeeklyDigestCohort[] = Array.from(buckets.entries()).map(([key, bucket]) => {
    const sampleSize = bucket.publicationIds.length;
    const confidence = classifyCohortConfidence(sampleSize, bucket.observedCount);
    return {
      key,
      channel: bucket.channel,
      format: bucket.format,
      topicTag: bucket.topicTag,
      hookType: bucket.hookType,
      sampleSize,
      observedCount: bucket.observedCount,
      impressionsObservedCount: bucket.impressions.length,
      engagementRateObservedCount: bucket.engagementRates.length,
      missingMetricsCount: bucket.missingMetricsCount,
      missingReasons: Array.from(bucket.missingReasons).sort(),
      medianImpressions: computeMedian(bucket.impressions),
      medianEngagementRate: computeMedian(bucket.engagementRates),
      confidence,
      cautionNote: cautionNoteFor(confidence, sampleSize, bucket.observedCount),
      publicationIds: bucket.publicationIds,
    };
  });

  cohorts.sort((a, b) => {
    const confDiff = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (confDiff !== 0) return confDiff;

    const aRate = a.medianEngagementRate ?? -1;
    const bRate = b.medianEngagementRate ?? -1;
    if (bRate !== aRate) return bRate - aRate;

    const aImp = a.medianImpressions ?? -1;
    const bImp = b.medianImpressions ?? -1;
    if (bImp !== aImp) return bImp - aImp;

    if (b.observedCount !== a.observedCount) return b.observedCount - a.observedCount;
    if (b.sampleSize !== a.sampleSize) return b.sampleSize - a.sampleSize;
    return a.key.localeCompare(b.key);
  });

  const totalPublications = orderedEntries.length;
  const nextExperiment = buildNextExperiment(cohorts, totalPublications, missingMetricsPublications);

  return {
    windowDays,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    totalPublications,
    observedPublications,
    missingMetricsPublications,
    missingReasons: Array.from(globalMissingReasons).sort(),
    deduplicatedMetricRows: totalDeduplicatedMetricRows,
    excluded,
    cohorts,
    nextExperiment,
    methodologyNote:
      "Cohort medians are descriptive and observational only; missing metrics are preserved as null (never coerced to 0), and small samples (< 3 insufficient, 3-9 directional, >= 10 moderate) never establish causation.",
  };
}

function readStringField(record: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!record || typeof record !== "object") return null;
  const rawResponse = record.rawResponse;
  if (rawResponse && typeof rawResponse === "object") {
    const nested = (rawResponse as Record<string, unknown>)[key];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  const direct = record[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return null;
}

/**
 * Owner-scoped database loader feeding `buildWeeklyLearningDigest`.
 */
export async function computeWeeklyLearningDigest(
  db: ContentDatabase,
  ownerId: number,
  options: { windowDays?: number; now?: Date } = {},
): Promise<WeeklyLearningDigest> {
  const ownerPubs = await db
    .select({
      id: publications.id,
      artifactId: publications.artifactId,
      channel: publications.channel,
      state: publications.state,
      createdAt: publications.createdAt,
      updatedAt: publications.updatedAt,
    })
    .from(publications)
    .where(eq(publications.userId, ownerId));

  if (ownerPubs.length === 0) {
    return buildWeeklyLearningDigest({
      observations: [],
      windowDays: options.windowDays,
      now: options.now,
    });
  }

  const pubIds = ownerPubs.map((p) => p.id);
  const artifactIds = Array.from(new Set(ownerPubs.map((p) => p.artifactId)));

  const [ownerResults, ownerSignals, ownerArtifacts] = await Promise.all([
    db
      .select({
        publicationId: results.publicationId,
        outcome: results.outcome,
        publishedAt: results.publishedAt,
        metrics: results.metrics,
      })
      .from(results)
      .where(inArray(results.publicationId, pubIds)),
    db
      .select({
        publicationId: performanceSignals.publicationId,
        metric: performanceSignals.metric,
        value: performanceSignals.value,
        availability: performanceSignals.availability,
        observedAt: performanceSignals.observedAt,
        identityKey: performanceSignals.identityKey,
        provider: performanceSignals.provider,
      })
      .from(performanceSignals)
      .where(inArray(performanceSignals.publicationId, pubIds)),
    artifactIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: artifacts.id,
            format: artifacts.format,
            opportunityId: artifacts.opportunityId,
          })
          .from(artifacts)
          .where(inArray(artifacts.id, artifactIds)),
  ]);

  const oppIds = Array.from(new Set(ownerArtifacts.map((a) => a.opportunityId)));
  const ownerOpps =
    oppIds.length === 0
      ? []
      : await db
          .select({
            id: opportunities.id,
            angle: opportunities.angle,
            scoreBreakdown: opportunities.scoreBreakdown,
          })
          .from(opportunities)
          .where(inArray(opportunities.id, oppIds));

  const resultByPub = new Map(ownerResults.map((r) => [r.publicationId, r]));
  const artifactById = new Map(ownerArtifacts.map((a) => [a.id, a]));
  const oppById = new Map(ownerOpps.map((o) => [o.id, o]));
  const signalsByPub = new Map<number, WeeklyDigestMetricPoint[]>();

  for (const sig of ownerSignals) {
    const list = signalsByPub.get(sig.publicationId) ?? [];
    list.push({
      metric: sig.metric,
      value: sig.value === null ? null : Number(sig.value),
      availability: sig.availability === "observed" ? "observed" : "not_available",
      observedAt: sig.observedAt,
      identityKey: sig.identityKey,
      provider: sig.provider,
    });
    signalsByPub.set(sig.publicationId, list);
  }

  const observations: WeeklyDigestEntry[] = ownerPubs.map((pub) => {
    const res = resultByPub.get(pub.id);
    const artifact = artifactById.get(pub.artifactId);
    const opp = artifact ? oppById.get(artifact.opportunityId) : undefined;
    const resMetrics = (res?.metrics ?? null) as Record<string, unknown> | null;
    const oppBreakdown = (opp?.scoreBreakdown ?? null) as Record<string, unknown> | null;

    const topicTag =
      readStringField(resMetrics, "topicTag") ??
      readStringField(oppBreakdown, "topicTag") ??
      null;
    const hookType =
      readStringField(resMetrics, "hookType") ??
      readStringField(oppBreakdown, "hookType") ??
      null;

    return {
      publicationId: pub.id,
      artifactId: pub.artifactId,
      channel: pub.channel,
      format: artifact?.format ?? "unknown",
      topicTag,
      hookType,
      publishedAt: res?.publishedAt ?? pub.updatedAt ?? pub.createdAt,
      state: pub.state,
      deleted: pub.state === "cancelled" || pub.state === "failed" || res?.outcome === "failed",
      metrics: signalsByPub.get(pub.id) ?? [],
    };
  });

  return buildWeeklyLearningDigest({
    observations,
    windowDays: options.windowDays,
    now: options.now,
  });
}
