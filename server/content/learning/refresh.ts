import type { Publication } from "@shared/schema";
import { JobFailure } from "../../jobs/failures";
import { getChannelAdapter } from "../adapters";
import type { ContentStoragePort } from "../storage";
import { db as defaultDb } from "../../db";
import type { ContentDatabase } from "../storage";
import { LEARNING_SCHEMA_VERSION, PERFORMANCE_SCHEMA_VERSION } from "./constants";
import { hourWindow, learningIdentityKey } from "./identity";
import { lineageToExplain, resolveLineage } from "./lineage";
import {
  metricsFailureToJobError,
  missingMetricsOutcome,
  validateNormalizedMetrics,
  type MetricFetchOutcome,
  type NormalizedMetric,
} from "./metrics";
import {
  ingestMetricRows,
  type LearningStoragePort,
} from "./store";

export interface AnalyticsRefreshDeps {
  content: ContentStoragePort;
  learning: LearningStoragePort;
  database?: ContentDatabase;
  now?: () => Date;
}

export interface RefreshResult {
  publicationId: number;
  status: "ingested" | "not_available" | "failed" | "skipped";
  created: number;
  reused: number;
  failureClass?: string;
  message?: string;
}

async function fetchViaAdapter(
  publication: Publication,
  now: Date,
): Promise<MetricFetchOutcome> {
  const adapter = getChannelAdapter(publication.channel);
  const window = hourWindow(now);
  if (!adapter.fetchMetrics) {
    return missingMetricsOutcome(
      publication.channel,
      publication.externalId ?? "",
      now,
      window.observedAt,
      window.window,
    );
  }
  if (!publication.externalId) {
    return missingMetricsOutcome(publication.channel, "", now, window.observedAt, window.window);
  }
  return adapter.fetchMetrics({
    channel: publication.channel,
    externalId: publication.externalId,
    publicationId: publication.id,
    correlationId: publication.correlationId,
    ownerUserId: publication.userId ?? null,
  });
}

export async function ingestNormalizedOutcome(
  publication: Publication,
  outcome: MetricFetchOutcome,
  deps: AnalyticsRefreshDeps,
): Promise<RefreshResult> {
  if (!outcome.ok) {
    metricsFailureToJobError(outcome);
  }
  const issues = validateNormalizedMetrics(outcome.metrics);
  if (issues.length) throw JobFailure.permanent(`invalid normalized metrics: ${issues.join("; ")}`);

  const result = await deps.content.getResultByPublication(publication.id);
  const inserted = await ingestMetricRows(
    deps.learning,
    {
      userId: publication.userId ?? null,
      publicationId: publication.id,
      resultId: result?.id ?? null,
      artifactId: publication.artifactId,
      channel: publication.channel,
      provider: outcome.provider,
      externalId: outcome.externalId || publication.externalId,
      observedAt: outcome.observedAt,
      retrievedAt: outcome.retrievedAt,
      measurementWindow: outcome.measurementWindow,
      normalizationVersion: outcome.normalizationVersion || PERFORMANCE_SCHEMA_VERSION,
      sourceRevision: null,
      provenance: {
        source: "channel_adapter",
        retrievedAt: outcome.retrievedAt.toISOString(),
        ...(outcome.unmapped && Object.keys(outcome.unmapped).length > 0
          ? { unmapped: outcome.unmapped }
          : {}),
      },
    },
    outcome.metrics,
  );

  const created = inserted.filter((r) => r.created).length;
  const reused = inserted.filter((r) => !r.created).length;
  const observed = outcome.metrics.filter((m) => m.availability === "observed");
  const database = deps.database ?? defaultDb;
  const lineage = await resolveLineage(database, {
    publicationId: publication.id,
    artifactId: publication.artifactId,
  });

  if (observed.length > 0) {
    const first = inserted.find((r) => r.row.availability === "observed")?.row;
    await deps.learning.insertLearningSignal({
      userId: publication.userId ?? null,
      signalType: "performance",
      sourceType: "publication",
      sourceId: publication.id,
      artifactId: publication.artifactId,
      priorArtifactId: null,
      publicationId: publication.id,
      resultId: result?.id ?? null,
      performanceSignalId: first?.id ?? null,
      generationJobId: lineage.generationJob?.id ?? null,
      generationPolicyId: lineage.generationPolicyId,
      opportunityId: lineage.opportunity?.id ?? null,
      storyId: lineage.story?.id ?? null,
      automationRunId: lineage.automationRunId,
      channel: publication.channel,
      format: lineage.artifact?.format ?? null,
      observedAt: outcome.observedAt,
      schemaVersion: LEARNING_SCHEMA_VERSION,
      payload: {
        kind: "performance_observed",
        provider: outcome.provider,
        normalizationVersion: outcome.normalizationVersion,
        metrics: observed.map((m) => m.metric),
        comparison: "descriptive",
        lineage: lineageToExplain(lineage),
      },
      confidence: "observed",
      identityKey: learningIdentityKey([
        "v1",
        "performance",
        publication.id,
        outcome.observedAt.getTime(),
        outcome.provider,
        outcome.normalizationVersion,
      ]),
    });
  }

  const anyObserved = observed.length > 0;
  return {
    publicationId: publication.id,
    status: anyObserved ? "ingested" : "not_available",
    created,
    reused,
  };
}

export async function refreshPublicationMetrics(
  publicationId: number,
  deps: AnalyticsRefreshDeps,
): Promise<RefreshResult> {
  const publication = await deps.content.getPublication(publicationId);
  if (!publication) throw JobFailure.permanent(`Publication ${publicationId} not found`);
  if (publication.state !== "published") {
    return { publicationId, status: "skipped", created: 0, reused: 0, message: "not published" };
  }
  const now = deps.now?.() ?? new Date();
  const outcome = await fetchViaAdapter(publication, now);
  return ingestNormalizedOutcome(publication, outcome, deps);
}

export async function ingestExplicitMetrics(
  publicationId: number,
  metrics: NormalizedMetric[],
  deps: AnalyticsRefreshDeps,
  options: { observedAt?: Date; provider?: string } = {},
): Promise<RefreshResult> {
  const publication = await deps.content.getPublication(publicationId);
  if (!publication) throw JobFailure.permanent(`Publication ${publicationId} not found`);
  const now = deps.now?.() ?? new Date();
  const observedAt = options.observedAt ?? hourWindow(now).observedAt;
  const outcome: MetricFetchOutcome = {
    ok: true,
    provider: options.provider ?? "operator",
    retrievedAt: now,
    observedAt,
    measurementWindow: hourWindow(observedAt).window,
    externalId: publication.externalId ?? "",
    normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
    metrics,
  };
  return ingestNormalizedOutcome(publication, outcome, deps);
}
