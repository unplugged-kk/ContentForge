import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWeeklyLearningDigest,
  type WeeklyDigestEntry,
} from "./weeklyDigest";

const NOW = new Date("2026-11-27T12:00:00Z");

describe("weekly learning cohort digest (INC-08)", () => {
  it("preserves explicit missingness and never coerces absent or not_available metrics to 0", () => {
    const observations: WeeklyDigestEntry[] = [
      {
        publicationId: 1,
        channel: "x",
        format: "x_thread",
        topicTag: "mlops",
        hookType: "metric",
        publishedAt: "2026-11-25T10:00:00Z",
        metrics: [],
      },
      {
        publicationId: 2,
        channel: "x",
        format: "x_thread",
        topicTag: "mlops",
        hookType: "metric",
        publishedAt: "2026-11-26T10:00:00Z",
        metrics: [
          {
            metric: "impressions",
            value: null,
            availability: "not_available",
            observedAt: "2026-11-26T15:00:00Z",
          },
          {
            metric: "engagement_rate",
            value: null,
            availability: "not_available",
            observedAt: "2026-11-26T15:00:00Z",
          },
        ],
      },
    ];

    const digest = buildWeeklyLearningDigest({ observations, windowDays: 7, now: NOW });
    assert.equal(digest.totalPublications, 2);
    assert.equal(digest.observedPublications, 0);
    assert.equal(digest.missingMetricsPublications, 2);
    assert.equal(digest.cohorts.length, 1);

    const cohort = digest.cohorts[0];
    assert.equal(cohort.sampleSize, 2);
    assert.equal(cohort.observedCount, 0);
    assert.equal(cohort.missingMetricsCount, 2);
    assert.equal(cohort.medianImpressions, null);
    assert.equal(cohort.medianEngagementRate, null);
    assert.ok(cohort.missingReasons.includes("no_metrics_logged"));
    assert.ok(cohort.missingReasons.includes("impressions_not_available"));
    assert.ok(cohort.missingReasons.includes("engagement_rate_not_available"));
    assert.equal(cohort.confidence, "insufficient");
  });

  it("deduplicates duplicate metric rows and duplicate publication entries without skewing medians", () => {
    const duplicateMetric = {
      metric: "impressions",
      value: 1000,
      availability: "observed" as const,
      observedAt: "2026-11-25T12:00:00Z",
      identityKey: "perf:10:impressions:2026-11-25T12",
    };

    const observations: WeeklyDigestEntry[] = [
      {
        publicationId: 10,
        channel: "linkedin",
        format: "linkedin_post",
        topicTag: "data-infra",
        hookType: "story",
        publishedAt: "2026-11-24T09:00:00Z",
        metrics: [
          duplicateMetric,
          { ...duplicateMetric },
          {
            metric: "engagement_rate",
            value: 0.04,
            availability: "observed",
            observedAt: "2026-11-25T12:00:00Z",
          },
          {
            metric: "engagement_rate",
            value: 0.04,
            availability: "observed",
            observedAt: "2026-11-25T12:00:00Z",
          },
        ],
      },
      {
        publicationId: 10,
        channel: "linkedin",
        format: "linkedin_post",
        topicTag: "data-infra",
        hookType: "story",
        publishedAt: "2026-11-24T09:00:00Z",
        metrics: [duplicateMetric],
      },
      {
        publicationId: 11,
        channel: "linkedin",
        format: "linkedin_post",
        topicTag: "data-infra",
        hookType: "story",
        publishedAt: "2026-11-25T09:00:00Z",
        metrics: [
          { metric: "impressions", value: 2000, availability: "observed", observedAt: "2026-11-26T09:00:00Z" },
          { metric: "engagement_rate", value: 0.06, availability: "observed", observedAt: "2026-11-26T09:00:00Z" },
        ],
      },
      {
        publicationId: 12,
        channel: "linkedin",
        format: "linkedin_post",
        topicTag: "data-infra",
        hookType: "story",
        publishedAt: "2026-11-26T09:00:00Z",
        metrics: [
          { metric: "impressions", value: 5000, availability: "observed", observedAt: "2026-11-27T09:00:00Z" },
          { metric: "engagement_rate", value: 0.09, availability: "observed", observedAt: "2026-11-27T09:00:00Z" },
        ],
      },
    ];

    const digest = buildWeeklyLearningDigest({ observations, windowDays: 7, now: NOW });
    assert.equal(digest.excluded.duplicatePublications, 1);
    assert.ok(digest.deduplicatedMetricRows >= 3);
    assert.equal(digest.cohorts[0].sampleSize, 3);
    assert.equal(digest.cohorts[0].medianImpressions, 2000);
    assert.equal(digest.cohorts[0].medianEngagementRate, 0.06);
  });

  it("handles late metrics, future snapshot cutoffs, out-of-window posts, and deleted/failed posts", () => {
    const observations: WeeklyDigestEntry[] = [
      {
        publicationId: 20,
        channel: "x",
        format: "x_post",
        topicTag: "aiops",
        hookType: "contrarian",
        publishedAt: "2026-11-21T08:00:00Z",
        metrics: [
          { metric: "impressions", value: 400, availability: "observed", observedAt: "2026-11-21T12:00:00Z" },
          { metric: "impressions", value: 1800, availability: "observed", observedAt: "2026-11-27T11:00:00Z" },
          { metric: "impressions", value: 99999, availability: "observed", observedAt: "2026-11-28T00:00:00Z" },
          { metric: "engagement_rate", value: 0.05, availability: "observed", observedAt: "2026-11-27T11:00:00Z" },
        ],
      },
      {
        publicationId: 21,
        channel: "x",
        format: "x_post",
        topicTag: "aiops",
        hookType: "contrarian",
        publishedAt: "2026-11-18T08:00:00Z",
        metrics: [
          { metric: "impressions", value: 50000, availability: "observed", observedAt: "2026-11-26T10:00:00Z" },
        ],
      },
      {
        publicationId: 22,
        channel: "x",
        format: "x_post",
        topicTag: "aiops",
        hookType: "contrarian",
        publishedAt: "2026-11-26T08:00:00Z",
        deleted: true,
        metrics: [{ metric: "impressions", value: 8000, availability: "observed", observedAt: "2026-11-26T12:00:00Z" }],
      },
      {
        publicationId: 23,
        channel: "x",
        format: "x_post",
        topicTag: "aiops",
        hookType: "contrarian",
        publishedAt: "2026-11-26T08:00:00Z",
        state: "failed",
      },
    ];

    const digest = buildWeeklyLearningDigest({ observations, windowDays: 7, now: NOW });
    assert.equal(digest.totalPublications, 1);
    assert.equal(digest.excluded.outOfWindow, 1);
    assert.equal(digest.excluded.deletedOrUnpublished, 2);
    assert.equal(digest.cohorts[0].medianImpressions, 1800);
  });

  it("enforces UTC timezone boundary stability across equivalent ISO offsets", () => {
    const boundaryNow = new Date("2026-11-27T00:00:00Z");
    const observations: WeeklyDigestEntry[] = [
      {
        publicationId: 30,
        channel: "x",
        format: "x_post",
        topicTag: "tz",
        hookType: "question",
        publishedAt: "2026-11-19T19:00:00-05:00",
        impressions: 500,
        engagementRate: 0.03,
      },
      {
        publicationId: 31,
        channel: "x",
        format: "x_post",
        topicTag: "tz",
        hookType: "question",
        publishedAt: "2026-11-20T05:30:00+05:30",
        impressions: 700,
        engagementRate: 0.04,
      },
      {
        publicationId: 32,
        channel: "x",
        format: "x_post",
        topicTag: "tz",
        hookType: "question",
        publishedAt: "2026-11-19T18:59:59-05:00",
        impressions: 9000,
        engagementRate: 0.5,
      },
    ];

    const digest = buildWeeklyLearningDigest({ observations, windowDays: 7, now: boundaryNow });
    assert.equal(digest.totalPublications, 2);
    assert.equal(digest.excluded.outOfWindow, 1);
    assert.deepEqual(digest.cohorts[0].publicationIds, [30, 31]);
    assert.equal(digest.cohorts[0].medianImpressions, 600);
  });

  it("enforces small-sample non-causal caution across insufficient, directional, and moderate tiers", () => {
    const makeSeries = (
      startId: number,
      count: number,
      topicTag: string,
      rate: number,
      impressions: number,
    ): WeeklyDigestEntry[] =>
      Array.from({ length: count }, (_, idx) => ({
        publicationId: startId + idx,
        channel: "x",
        format: "x_thread",
        topicTag,
        hookType: "how_to",
        publishedAt: new Date(NOW.getTime() - (idx + 1) * 3_600_000).toISOString(),
        impressions,
        engagementRate: rate,
      }));

    const insufficientOnly = buildWeeklyLearningDigest({
      observations: makeSeries(1, 2, "small", 0.25, 10_000),
      windowDays: 7,
      now: NOW,
    });
    assert.equal(insufficientOnly.cohorts[0].confidence, "insufficient");
    assert.match(insufficientOnly.cohorts[0].cautionNote, /insufficient|observational/i);
    assert.match(insufficientOnly.nextExperiment, /insufficient|log metrics|at least/i);

    const multiTier = buildWeeklyLearningDigest({
      observations: [
        ...makeSeries(100, 1, "lucky-outlier", 0.5, 50_000),
        ...makeSeries(200, 4, "directional-cohort", 0.08, 3_000),
        ...makeSeries(300, 10, "moderate-cohort", 0.05, 4_000),
      ],
      windowDays: 7,
      now: NOW,
    });

    assert.deepEqual(
      multiTier.cohorts.map((c) => [c.topicTag, c.confidence]),
      [
        ["moderate-cohort", "moderate"],
        ["directional-cohort", "directional"],
        ["lucky-outlier", "insufficient"],
      ],
    );
    for (const cohort of multiTier.cohorts) {
      assert.doesNotMatch(cohort.cautionNote, /\bcaused\b|\bproves\b/i);
      assert.match(cohort.cautionNote, /observational/i);
    }
    assert.match(multiTier.nextExperiment, /moderate-cohort/);
    assert.match(multiTier.nextExperiment, /directional-cohort/);
  });
});
