/**
 * Learning Proposals & Evidence Engine (Phase 29.1)
 *
 * Implements deterministic pattern extraction over durable PostgreSQL data.
 * Paradigm: Observe → Attribute → Learn → Propose (NEVER mutate production policies).
 *
 * Evidence Quality Thresholds (Deterministic & Documented):
 *   N < 3:   "insufficient_data" (preserved as raw data, no proposal generated)
 *   3 <= N <= 5: "observed" (early signal, low confidence)
 *   6 <= N <= 10: "directional" (directional trend, medium confidence)
 *   11 <= N <= 20: "repeatable" (recurring pattern across multiple items)
 *   N > 20:  "confirmed" (statistically robust pattern across significant history)
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  artifacts,
  learningObservations,
  learningProposals,
  learningSignals,
  performanceSignals,
  publications,
  results,
  styleProfiles,
  type EvidenceQuality,
  type InsertLearningObservation,
  type InsertLearningProposal,
  type LearningObservation,
  type LearningProposal,
  type ProposalStatus,
  type ProposalType,
} from "@shared/schema";
import type { ContentDatabase } from "../storage";
import { learningIdentityKey } from "./identity";
import type { LearningStoragePort } from "./store";

export const MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL = 3;

/**
 * Deterministically evaluates evidence quality based strictly on verified sample count.
 */
export function evaluateEvidenceQuality(sampleCount: number): EvidenceQuality {
  if (sampleCount < 3) return "insufficient_data";
  if (sampleCount <= 5) return "observed";
  if (sampleCount <= 10) return "directional";
  if (sampleCount <= 20) return "repeatable";
  return "confirmed";
}

/**
 * Deterministic identity keys for observations and proposals.
 */
export function observationIdentityKey(
  ownerId: number,
  dimension: string,
  observationType: string,
  targetScope: string,
  metricName: string,
  window = "all_time",
): string {
  return learningIdentityKey(["v1", "obs", ownerId, dimension, observationType, targetScope, metricName, window]);
}

export function proposalIdentityKey(
  ownerId: number,
  proposalType: string,
  targetScope: string,
  metricName: string,
  window = "all_time",
): string {
  return learningIdentityKey(["v1", "prop", ownerId, proposalType, targetScope, metricName, window]);
}

export interface ExtractionResult {
  observations: LearningObservation[];
  proposals: LearningProposal[];
  stats: {
    publicationsAnalyzed: number;
    approvalsAnalyzed: number;
    observationsGenerated: number;
    proposalsGenerated: number;
  };
}

/**
 * Runs deterministic pattern extraction over durable empirical signals for a given owner.
 * All queries are strictly owner-scoped at the SQL level.
 */
export async function extractObservationsAndProposals(
  db: ContentDatabase,
  store: LearningStoragePort,
  ownerId: number,
): Promise<ExtractionResult> {
  const resultObservations: LearningObservation[] = [];
  const resultProposals: LearningProposal[] = [];

  // 1. Fetch published publications with artifacts and performance metrics
  const ownerPubs = await db
    .select({
      id: publications.id,
      channel: publications.channel,
      state: publications.state,
      artifactId: publications.artifactId,
      createdAt: publications.createdAt,
    })
    .from(publications)
    .where(and(eq(publications.userId, ownerId), eq(publications.state, "published")));

  const pubIds = ownerPubs.map((p) => p.id);
  const artifactIds = Array.from(new Set(ownerPubs.map((p) => p.artifactId)));

  const ownerArtifacts =
    artifactIds.length === 0
      ? []
      : await db
          .select({
            id: artifacts.id,
            channel: artifacts.channel,
            format: artifacts.format,
          })
          .from(artifacts)
          .where(inArray(artifacts.id, artifactIds));

  const artifactMap = new Map<number, { channel: string; format: string }>();
  for (const a of ownerArtifacts) {
    artifactMap.set(a.id, { channel: a.channel, format: a.format });
  }

  // Fetch performance signals for these publications
  const perfRows =
    pubIds.length === 0
      ? []
      : await db
          .select({
            id: performanceSignals.id,
            publicationId: performanceSignals.publicationId,
            artifactId: performanceSignals.artifactId,
            channel: performanceSignals.channel,
            metric: performanceSignals.metric,
            value: performanceSignals.value,
            availability: performanceSignals.availability,
          })
          .from(performanceSignals)
          .where(eq(performanceSignals.userId, ownerId));

  // Build per-publication metric totals
  const pubMetricsMap = new Map<number, { engagements: number; impressions: number | null }>();
  for (const row of perfRows) {
    if (row.availability !== "observed" || row.value === null) continue;
    const cur = pubMetricsMap.get(row.publicationId) ?? { engagements: 0, impressions: null };
    const numVal = Number(row.value) || 0;
    if (row.metric === "impressions" || row.metric === "views") {
      cur.impressions = (cur.impressions ?? 0) + numVal;
    } else if (["likes", "shares", "comments", "clicks", "engagements"].includes(row.metric)) {
      cur.engagements += numVal;
    }
    pubMetricsMap.set(row.publicationId, cur);
  }

  // Group publications by (channel, format)
  type FormatGroup = {
    channel: string;
    format: string;
    pubIds: number[];
    artIds: number[];
    totalEngagements: number;
    totalImpressions: number | null;
    measuredCount: number;
  };

  const channelFormatGroups = new Map<string, FormatGroup>();
  const channelTotals = new Map<string, { totalEngagements: number; totalPubs: number; measuredPubs: number }>();

  for (const p of ownerPubs) {
    const art = artifactMap.get(p.artifactId);
    if (!art) continue;
    const groupKey = `${p.channel}:${art.format}`;
    const cur = channelFormatGroups.get(groupKey) ?? {
      channel: p.channel,
      format: art.format,
      pubIds: [],
      artIds: [],
      totalEngagements: 0,
      totalImpressions: null,
      measuredCount: 0,
    };
    cur.pubIds.push(p.id);
    cur.artIds.push(p.artifactId);

    const m = pubMetricsMap.get(p.id);
    if (m) {
      cur.totalEngagements += m.engagements;
      if (m.impressions !== null) {
        cur.totalImpressions = (cur.totalImpressions ?? 0) + m.impressions;
      }
      cur.measuredCount += 1;
    }
    channelFormatGroups.set(groupKey, cur);

    const chTotal = channelTotals.get(p.channel) ?? { totalEngagements: 0, totalPubs: 0, measuredPubs: 0 };
    chTotal.totalPubs += 1;
    if (m) {
      chTotal.totalEngagements += m.engagements;
      chTotal.measuredPubs += 1;
    }
    channelTotals.set(p.channel, chTotal);
  }

  // --- DIMENSION 1: Content & Distribution Patterns ---
  for (const [key, group] of Array.from(channelFormatGroups.entries())) {
    const chTotal = channelTotals.get(group.channel);
    if (!chTotal || chTotal.totalPubs < 3) continue;

    const sampleCount = group.pubIds.length;
    const quality = evaluateEvidenceQuality(sampleCount);

    // Compute candidate engagement per post vs channel average
    const candidateAvg = group.measuredCount > 0 ? group.totalEngagements / group.measuredCount : group.totalEngagements / sampleCount;
    const baselineAvg = chTotal.measuredPubs > 0 ? chTotal.totalEngagements / chTotal.measuredPubs : chTotal.totalEngagements / chTotal.totalPubs;

    const diffPct = baselineAvg > 0 ? ((candidateAvg - baselineAvg) / baselineAvg) * 100 : 0;

    const obsIdentity = observationIdentityKey(
      ownerId,
      "distribution",
      "format_channel_performance",
      `channel:${group.channel};format:${group.format}`,
      "engagements_per_post",
    );

    const obsInsert: InsertLearningObservation = {
      userId: ownerId,
      dimension: "distribution",
      observationType: "format_channel_performance",
      targetScope: `channel:${group.channel};format:${group.format}`,
      candidatePopulation: {
        channel: group.channel,
        format: group.format,
        sampleCount,
        measuredCount: group.measuredCount,
      },
      comparisonPopulation: {
        channel: group.channel,
        baseline: "all_channel_formats",
        sampleCount: chTotal.totalPubs,
        measuredCount: chTotal.measuredPubs,
      },
      metricName: "engagements_per_post",
      candidateValue: candidateAvg.toFixed(4),
      comparisonValue: baselineAvg.toFixed(4),
      differencePercentage: diffPct.toFixed(2),
      evidenceQuality: quality,
      evidenceEntityIds: {
        publicationIds: group.pubIds.slice(0, 20),
        artifactIds: group.artIds.slice(0, 20),
      },
      measurementWindow: "all_time",
      identityKey: obsIdentity,
    };

    const { row: obsRow } = await store.insertLearningObservation(obsInsert);
    resultObservations.push(obsRow);

    // Only generate proposals when sample size meets minimum qualification (>= 3) and meaningful delta (>= +15%)
    if (sampleCount >= MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL && diffPct >= 15) {
      const propIdentity = proposalIdentityKey(
        ownerId,
        "format_distribution",
        `channel:${group.channel};format:${group.format}`,
        "engagements_per_post",
      );

      const propInsert: InsertLearningProposal = {
        userId: ownerId,
        observationId: obsRow.id,
        proposalType: "format_distribution",
        targetScope: `channel:${group.channel};format:${group.format}`,
        title: `Consider increasing ${group.format} content on ${group.channel}`,
        rationale: `Observed: ${group.format} content on ${group.channel} showed ${diffPct.toFixed(1)}% higher average engagements compared to the channel baseline across ${sampleCount} publications.`,
        expectedImpactHypothesis: `Prioritizing ${group.format} format for upcoming ${group.channel} opportunities is expected to maintain above-average engagement based on historical performance.`,
        evidenceQuality: quality,
        evidenceSummary: {
          sampleCount,
          candidateValue: candidateAvg.toFixed(2),
          baselineValue: baselineAvg.toFixed(2),
          differencePercentage: diffPct.toFixed(1),
          publicationIds: group.pubIds.slice(0, 10),
          artifactIds: group.artIds.slice(0, 10),
        },
        status: "proposed",
        identityKey: propIdentity,
      };

      const { row: propRow } = await store.insertLearningProposal(propInsert);
      resultProposals.push(propRow);
    }
  }

  // --- DIMENSION 2: Style Profile Associations ---
  const approvalSignals = await db
    .select({
      id: learningSignals.id,
      artifactId: learningSignals.artifactId,
      payload: learningSignals.payload,
    })
    .from(learningSignals)
    .where(and(eq(learningSignals.userId, ownerId), eq(learningSignals.signalType, "approval")));

  const totalApprovals = approvalSignals.length;
  const firstPassApprovals = approvalSignals.filter((r) => {
    const kind = (r.payload as { kind?: string } | null)?.kind;
    return kind === "first_pass_approval" || kind === "approved_without_edits";
  }).length;
  const overallApprovalRate = totalApprovals > 0 ? firstPassApprovals / totalApprovals : 0;

  const styleProfilesList = await db
    .select({
      id: styleProfiles.id,
      name: styleProfiles.name,
      sampleCount: styleProfiles.sampleCount,
      isActive: styleProfiles.isActive,
    })
    .from(styleProfiles)
    .where(eq(styleProfiles.userId, ownerId));

  for (const sp of styleProfilesList) {
    const sampleCount = sp.sampleCount ?? 0;
    if (sampleCount < MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL) continue;

    const quality = evaluateEvidenceQuality(sampleCount);
    const obsIdentity = observationIdentityKey(
      ownerId,
      "style",
      "style_profile_strength",
      `style:${sp.id}`,
      "sample_confidence",
    );

    const obsInsert: InsertLearningObservation = {
      userId: ownerId,
      dimension: "style",
      observationType: "style_profile_strength",
      targetScope: `style:${sp.id}`,
      candidatePopulation: {
        profileId: sp.id,
        name: sp.name,
        sampleCount,
        isActive: sp.isActive,
      },
      comparisonPopulation: {
        baseline: "all_style_references",
        totalProfiles: styleProfilesList.length,
      },
      metricName: "sample_count",
      candidateValue: sampleCount.toFixed(4),
      comparisonValue: (styleProfilesList.length > 0 ? (styleProfilesList.reduce((acc, p) => acc + (p.sampleCount ?? 0), 0) / styleProfilesList.length) : sampleCount).toFixed(4),
      differencePercentage: "0.00",
      evidenceQuality: quality,
      evidenceEntityIds: {},
      measurementWindow: "all_time",
      identityKey: obsIdentity,
    };

    const { row: obsRow } = await store.insertLearningObservation(obsInsert);
    resultObservations.push(obsRow);

    if (sampleCount >= 5 && sp.isActive) {
      const propIdentity = proposalIdentityKey(
        ownerId,
        "style_association",
        `style:${sp.id}`,
        "first_pass_approval",
      );

      const propInsert: InsertLearningProposal = {
        userId: ownerId,
        observationId: obsRow.id,
        proposalType: "style_association",
        targetScope: `style:${sp.id}`,
        title: `Maintain writing voice alignment using "${sp.name}"`,
        rationale: `Observed: Style profile "${sp.name}" is grounded in ${sampleCount} verified writing samples with active editorial alignment.`,
        expectedImpactHypothesis: `Applying "${sp.name}" to generation opportunities stabilizes tonal consistency and reduces the need for substantial revisions.`,
        evidenceQuality: quality,
        evidenceSummary: {
          profileId: sp.id,
          profileName: sp.name,
          sampleCount,
          overallApprovalRate: (overallApprovalRate * 100).toFixed(1) + "%",
        },
        status: "proposed",
        identityKey: propIdentity,
      };

      const { row: propRow } = await store.insertLearningProposal(propInsert);
      resultProposals.push(propRow);
    }
  }

  // --- DIMENSION 3: Workflow & Publication Reliability ---
  if (pubIds.length >= MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL) {
    const pubChannelMap = new Map<number, string>();
    for (const p of ownerPubs) {
      pubChannelMap.set(p.id, p.channel);
    }

    const ownerResults = await db
      .select({
        publicationId: results.publicationId,
        outcome: results.outcome,
      })
      .from(results)
      .where(inArray(results.publicationId, pubIds));

    // Group results by channel
    const channelResults = new Map<string, { total: number; successful: number; failed: number }>();
    for (const r of ownerResults) {
      const channel = pubChannelMap.get(r.publicationId) ?? "unknown";
      const cur = channelResults.get(channel) ?? { total: 0, successful: 0, failed: 0 };
      cur.total += 1;
      if (r.outcome === "published") cur.successful += 1;
      else if (r.outcome === "failed") cur.failed += 1;
      channelResults.set(channel, cur);
    }

    for (const [channel, stats] of Array.from(channelResults.entries())) {
      if (stats.total < MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL) continue;
      const failureRate = (stats.failed / stats.total) * 100;
      const quality = evaluateEvidenceQuality(stats.total);

      const obsIdentity = observationIdentityKey(
        ownerId,
        "production",
        "workflow_reliability",
        `channel:${channel}`,
        "publication_failure_rate",
      );

      const obsInsert: InsertLearningObservation = {
        userId: ownerId,
        dimension: "production",
        observationType: "workflow_reliability",
        targetScope: `channel:${channel}`,
        candidatePopulation: {
          channel,
          total: stats.total,
          failed: stats.failed,
          successful: stats.successful,
        },
        comparisonPopulation: {
          baseline: "zero_failure_target",
          targetRate: 0,
        },
        metricName: "publication_failure_rate",
        candidateValue: failureRate.toFixed(4),
        comparisonValue: "0.0000",
        differencePercentage: failureRate.toFixed(2),
        evidenceQuality: quality,
        evidenceEntityIds: {},
        measurementWindow: "all_time",
        identityKey: obsIdentity,
      };

      const { row: obsRow } = await store.insertLearningObservation(obsInsert);
      resultObservations.push(obsRow);

      if (failureRate >= 20) {
        const propIdentity = proposalIdentityKey(
          ownerId,
          "workflow_reliability",
          `channel:${channel}`,
          "publication_failure_rate",
        );

        const propInsert: InsertLearningProposal = {
          userId: ownerId,
          observationId: obsRow.id,
          proposalType: "workflow_reliability",
          targetScope: `channel:${channel}`,
          title: `Inspect dispatch reliability for ${channel}`,
          rationale: `Observed: ${channel} experienced a ${failureRate.toFixed(1)}% publication failure rate across ${stats.total} attempted deliveries.`,
          expectedImpactHypothesis: `Validating account authentication tokens and network rate limits for ${channel} will restore delivery reliability.`,
          evidenceQuality: quality,
          evidenceSummary: {
            channel,
            totalDispatches: stats.total,
            failedDispatches: stats.failed,
            failureRate: `${failureRate.toFixed(1)}%`,
          },
          status: "proposed",
          identityKey: propIdentity,
        };

        const { row: propRow } = await store.insertLearningProposal(propInsert);
        resultProposals.push(propRow);
      }
    }
  }

  return {
    observations: resultObservations,
    proposals: resultProposals,
    stats: {
      publicationsAnalyzed: ownerPubs.length,
      approvalsAnalyzed: totalApprovals,
      observationsGenerated: resultObservations.length,
      proposalsGenerated: resultProposals.length,
    },
  };
}
