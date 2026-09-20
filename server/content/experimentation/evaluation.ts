/**
 * Experiment Evaluation Engine (Phase 29.2).
 *
 * Implements:
 * 1. Aggregation of durable performance signals and dispatch outcomes.
 * 2. Deduplication of multi-snapshot measurements to latest observedAt.
 * 3. Primary metric and guardrail calculations without fabricated zeroes.
 * 4. Evidence quality assessment (insufficient_data, observed, directional, repeatable, confirmed).
 * 5. Deterministic recommendation logic (inconclusive, control_preferred, variant_promising, variant_preferred, guardrail_failed).
 * 6. Non-causal correlational reporting.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { ContentDatabase } from "../storage";
import {
  publications,
  performanceSignals,
  results,
  artifacts,
  type Experiment,
  type ExperimentVariant,
  type ExperimentAssignment,
  type ExperimentEvaluation,
  type PolicyCandidate,
  type EvidenceQuality,
  type ExperimentDecision,
} from "@shared/schema";
import { evaluationIdentityKey, policyCandidateIdentityKey } from "./identity";
import type { ExperimentStoragePort } from "./store";

export interface EvaluationOptions {
  window?: "interim" | "final";
}

export interface MetricSummary {
  sampleCount: number;
  measuredCount: number;
  mean: string | null;
  availability: "observed" | "not_available" | "insufficient_data";
}

export interface VariantComparison {
  variantId: number;
  variantKey: string;
  sampleCount: number;
  measuredCount: number;
  mean: string | null;
  difference: string | null;
  differencePercentage: string | null;
  availability: "observed" | "not_available" | "insufficient_data";
}

export interface GuardrailResult {
  metric: string;
  controlValue: string | null;
  variantValue: string | null;
  differencePercentage: string | null;
  status: "passed" | "regressed" | "not_available";
}

export async function evaluateExperiment(
  db: ContentDatabase,
  store: ExperimentStoragePort,
  experimentId: number,
  userId: number,
  options: EvaluationOptions = {},
): Promise<ExperimentEvaluation> {
  const windowType = options.window ?? "interim";

  // 1. Load experiment and variants
  const experiment = await store.getExperimentForOwner(experimentId, userId);
  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found for owner ${userId}`);
  }

  const variants = experiment.variants;
  if (variants.length === 0) {
    throw new Error(`Experiment ${experimentId} has no variants`);
  }

  const control = variants.find((v) => v.isControl) ?? variants[0];
  const testVariants = variants.filter((v) => v.id !== control.id);

  // 2. Load all assignments for this experiment
  const assignments = await store.listAssignmentsForExperiment(experimentId, userId);

  // Map variantId -> array of assignments
  const assignmentsByVariant = new Map<number, ExperimentAssignment[]>();
  for (const v of variants) {
    assignmentsByVariant.set(v.id, []);
  }
  for (const a of assignments) {
    const list = assignmentsByVariant.get(a.variantId);
    if (list) list.push(a);
  }

  // 3. Extract publication IDs for control and variants
  const allAssignedPubIds = assignments
    .map((a) => a.publicationId)
    .filter((id): id is number => typeof id === "number" && id > 0);

  // 4. Fetch performance signals for these publications with latest-snapshot deduplication
  const perfRows =
    allAssignedPubIds.length === 0
      ? []
      : await db
          .select({
            publicationId: performanceSignals.publicationId,
            metric: performanceSignals.metric,
            value: performanceSignals.value,
            availability: performanceSignals.availability,
            observedAt: performanceSignals.observedAt,
          })
          .from(performanceSignals)
          .where(
            and(
              eq(performanceSignals.userId, userId),
              inArray(performanceSignals.publicationId, allAssignedPubIds),
            ),
          );

  // Deduplicate by (publicationId, metric) taking strictly the latest observedAt
  const latestMetricByPub = new Map<string, { value: number; observedAt: Date }>();
  for (const p of perfRows) {
    if (p.publicationId === null || p.availability !== "observed" || p.value === null) continue;
    const numVal = Number(p.value);
    if (!Number.isFinite(numVal)) continue;

    const key = `${p.publicationId}:${p.metric}`;
    const cur = latestMetricByPub.get(key);
    const obsAt = p.observedAt instanceof Date ? p.observedAt : new Date(p.observedAt ?? 0);
    if (!cur || obsAt > cur.observedAt) {
      latestMetricByPub.set(key, { value: numVal, observedAt: obsAt });
    }
  }

  // 5. Fetch workflow dispatch outcomes from results table
  const resultsRows =
    allAssignedPubIds.length === 0
      ? []
      : await db
          .select({
            publicationId: results.publicationId,
            outcome: results.outcome,
          })
          .from(results)
          .where(
            and(
              eq(results.userId, userId),
              inArray(results.publicationId, allAssignedPubIds),
            ),
          );

  const resultMap = new Map<number, string>();
  for (const r of resultsRows) {
    resultMap.set(r.publicationId, r.outcome);
  }

  // 6. Compute primary metric for control
  const primaryMetric = experiment.primaryMetric;
  const controlAssignments = assignmentsByVariant.get(control.id) ?? [];
  const controlSummary = computeVariantMetric(
    controlAssignments,
    primaryMetric,
    latestMetricByPub,
    resultMap,
  );

  // 7. Compute primary metric for test variants
  const variantComparisons: VariantComparison[] = [];
  for (const testVar of testVariants) {
    const testAssignments = assignmentsByVariant.get(testVar.id) ?? [];
    const varSummary = computeVariantMetric(
      testAssignments,
      primaryMetric,
      latestMetricByPub,
      resultMap,
    );

    let diff: string | null = null;
    let diffPct: string | null = null;

    if (controlSummary.mean !== null && varSummary.mean !== null) {
      const cMean = parseFloat(controlSummary.mean);
      const vMean = parseFloat(varSummary.mean);
      const rawDiff = vMean - cMean;
      diff = rawDiff.toFixed(2);
      if (cMean > 0) {
        diffPct = ((rawDiff / cMean) * 100).toFixed(1);
      } else if (vMean > 0) {
        diffPct = "100.0";
      } else {
        diffPct = "0.0";
      }
    }

    variantComparisons.push({
      variantId: testVar.id,
      variantKey: testVar.variantKey,
      sampleCount: varSummary.sampleCount,
      measuredCount: varSummary.measuredCount,
      mean: varSummary.mean,
      difference: diff,
      differencePercentage: diffPct,
      availability: varSummary.availability,
    });
  }

  // 8. Compute guardrail metrics (e.g. publication failure rate)
  const guardrailResults: GuardrailResult[] = [];
  const guardrails = (experiment.guardrailMetrics ?? []) as string[];

  for (const guardrail of guardrails) {
    if (guardrail === "publication_failure_rate") {
      const cFailRate = computeFailureRate(controlAssignments, resultMap);
      for (const testVar of testVariants) {
        const testAssignments = assignmentsByVariant.get(testVar.id) ?? [];
        const vFailRate = computeFailureRate(testAssignments, resultMap);

        let diffPct: string | null = null;
        let status: "passed" | "regressed" | "not_available" = "not_available";

        if (cFailRate !== null && vFailRate !== null) {
          const rawDiff = vFailRate - cFailRate;
          diffPct = (rawDiff * 100).toFixed(1);
          // If variant failure rate is materially higher (> 10% increase), guardrail regressed
          if (vFailRate > cFailRate + 0.10) {
            status = "regressed";
          } else {
            status = "passed";
          }
        }

        guardrailResults.push({
          metric: `${guardrail} (${testVar.variantKey})`,
          controlValue: cFailRate !== null ? `${(cFailRate * 100).toFixed(1)}%` : null,
          variantValue: vFailRate !== null ? `${(vFailRate * 100).toFixed(1)}%` : null,
          differencePercentage: diffPct ? `${diffPct}%` : null,
          status,
        });
      }
    }
  }

  // 9. Determine Evidence Quality
  const minSample = experiment.minSampleSize ?? 3;
  const primaryComparison = variantComparisons[0]; // Primary test variant
  const primaryMeasured = primaryComparison ? primaryComparison.measuredCount : 0;
  const controlMeasured = controlSummary.measuredCount;

  let evidenceQuality: EvidenceQuality = "insufficient_data";
  if (controlMeasured < minSample || primaryMeasured < minSample) {
    evidenceQuality = "insufficient_data";
  } else {
    const minCount = Math.min(controlMeasured, primaryMeasured);
    if (minCount >= 21) evidenceQuality = "confirmed";
    else if (minCount >= 11) evidenceQuality = "repeatable";
    else if (minCount >= 6) evidenceQuality = "directional";
    else evidenceQuality = "observed";
  }

  // 10. Determine Recommended Decision
  const recommendedDecision = determineRecommendedDecision(
    primaryComparison && primaryComparison.differencePercentage !== null
      ? parseFloat(primaryComparison.differencePercentage)
      : null,
    evidenceQuality,
    guardrailResults,
  );

  // 11. Generate non-causal summary
  const summary = generateEvaluationSummary(
    experiment.name,
    control.name,
    primaryComparison ? primaryComparison.variantKey : "variant",
    primaryMetric,
    controlSummary,
    primaryComparison,
    evidenceQuality,
    recommendedDecision,
  );

  const timestampMs = Date.now();
  const idKey = evaluationIdentityKey(experimentId, windowType, timestampMs);

  // 12. Persist evaluation
  const { row: evaluation } = await store.createEvaluation({
    userId,
    experimentId,
    evaluationWindow: windowType,
    primaryMetric,
    controlMetrics: controlSummary,
    variantMetrics: variantComparisons,
    guardrailResults,
    evidenceQuality,
    recommendedDecision,
    summary,
    identityKey: idKey,
  });

  return evaluation;
}

function computeVariantMetric(
  assignments: ExperimentAssignment[],
  metricName: string,
  metricMap: Map<string, { value: number; observedAt: Date }>,
  resultMap: Map<number, string>,
): MetricSummary {
  const publishedPubIds = assignments
    .map((a) => a.publicationId)
    .filter((id): id is number => typeof id === "number" && id > 0);

  if (publishedPubIds.length === 0) {
    return {
      sampleCount: assignments.length,
      measuredCount: 0,
      mean: null,
      availability: "insufficient_data",
    };
  }

  // If primary metric is publication success rate
  if (metricName === "publication_success_rate") {
    let successCount = 0;
    let attemptedCount = 0;
    for (const pid of publishedPubIds) {
      const outcome = resultMap.get(pid);
      if (outcome) {
        attemptedCount += 1;
        if (outcome === "published") successCount += 1;
      }
    }
    if (attemptedCount === 0) {
      return {
        sampleCount: assignments.length,
        measuredCount: 0,
        mean: null,
        availability: "insufficient_data",
      };
    }
    const rate = successCount / attemptedCount;
    return {
      sampleCount: assignments.length,
      measuredCount: attemptedCount,
      mean: rate.toFixed(4),
      availability: "observed",
    };
  }

  // Otherwise, read from metricMap
  let total = 0;
  let measuredCount = 0;
  for (const pid of publishedPubIds) {
    const item = metricMap.get(`${pid}:${metricName}`);
    if (item !== undefined) {
      total += item.value;
      measuredCount += 1;
    }
  }

  if (measuredCount === 0) {
    return {
      sampleCount: assignments.length,
      measuredCount: 0,
      mean: null,
      availability: "not_available",
    };
  }

  const mean = (total / measuredCount).toFixed(2);
  return {
    sampleCount: assignments.length,
    measuredCount,
    mean,
    availability: "observed",
  };
}

function computeFailureRate(
  assignments: ExperimentAssignment[],
  resultMap: Map<number, string>,
): number | null {
  const pubIds = assignments
    .map((a) => a.publicationId)
    .filter((id): id is number => typeof id === "number" && id > 0);

  if (pubIds.length === 0) return null;

  let attempted = 0;
  let failed = 0;
  for (const pid of pubIds) {
    const outcome = resultMap.get(pid);
    if (outcome) {
      attempted += 1;
      if (outcome === "failed") failed += 1;
    }
  }

  return attempted > 0 ? failed / attempted : null;
}

export function determineRecommendedDecision(
  differencePercentage: number | null,
  evidenceQuality: EvidenceQuality,
  guardrailResults: GuardrailResult[],
): ExperimentDecision {
  const anyGuardrailRegressed = guardrailResults.some((g) => g.status === "regressed");
  if (anyGuardrailRegressed) {
    return "guardrail_failed";
  }
  if (evidenceQuality === "insufficient_data" || differencePercentage === null) {
    return "inconclusive";
  }
  if (differencePercentage >= 10.0) {
    if (evidenceQuality === "directional" || evidenceQuality === "repeatable" || evidenceQuality === "confirmed") {
      return "variant_preferred";
    }
    return "variant_promising";
  }
  if (differencePercentage >= 5.0) {
    return "variant_promising";
  }
  if (differencePercentage <= -5.0) {
    return "control_preferred";
  }
  return "inconclusive";
}

export function generateEvaluationSummary(
  expName: string,
  controlName: string,
  variantKey: string,
  metric: string,
  control: MetricSummary,
  variant: VariantComparison | undefined,
  quality: EvidenceQuality,
  decision: ExperimentDecision,
): string {
  if (decision === "guardrail_failed") {
    return `Experiment "${expName}" evaluated with guardrail regressions. While primary metric ${metric} was tracked, critical dispatch or quality guardrails regressed materially under variant ${variantKey}. Recommending guardrail_failed.`;
  }

  if (quality === "insufficient_data" || !variant || variant.differencePercentage === null) {
    return `Experiment "${expName}" has insufficient verified observations to reach a statistical conclusion (control: ${control.measuredCount} measured, ${variantKey}: ${variant ? variant.measuredCount : 0} measured). Evaluation remains inconclusive.`;
  }

  const delta = parseFloat(variant.differencePercentage);
  const direction = delta >= 0 ? `higher (+${variant.differencePercentage}%)` : `lower (${variant.differencePercentage}%)`;

  return `Under controlled assignment for "${expName}", variant ${variantKey} observed ${direction} average ${metric} compared to ${controlName} across verified samples (quality: ${quality}). Result classified as ${decision}.`;
}

/**
 * Creates a PolicyCandidate from an accepted experiment variant.
 * Strictly separates experimental findings from live production policy.
 */
export async function createPolicyCandidateFromExperiment(
  store: ExperimentStoragePort,
  experimentId: number,
  variantId: number,
  userId: number,
  title?: string,
  reviewNotes?: string,
): Promise<PolicyCandidate> {
  const experiment = await store.getExperimentForOwner(experimentId, userId);
  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found for owner ${userId}`);
  }

  const variant = await store.getVariantForOwner(variantId, userId);
  if (!variant || variant.experimentId !== experimentId) {
    throw new Error(`Variant ${variantId} does not belong to experiment ${experimentId}`);
  }

  const latestEval = await store.getLatestEvaluationForExperiment(experimentId, userId);

  const candidateTitle = title || `Candidate Policy from ${experiment.name} (${variant.name})`;
  const rationale =
    latestEval?.summary ||
    `Promoted from controlled experiment ${experiment.name} based on measured performance.`;

  const idKey = policyCandidateIdentityKey(experimentId, variantId);

  const { row: candidate } = await store.createPolicyCandidate({
    userId,
    experimentId,
    variantId,
    evaluationId: latestEval?.id ?? null,
    title: candidateTitle,
    rationale,
    targetScope: experiment.targetScope,
    proposedConfiguration: variant.policySnapshot,
    status: "candidate",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: reviewNotes ?? null,
    identityKey: idKey,
  });

  return candidate;
}
