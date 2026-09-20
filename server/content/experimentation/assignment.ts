/**
 * Deterministic Assignment & Eligibility Engine (Phase 29.2).
 *
 * Implements:
 * 1. Reproducible variant allocation via SHA-256 hash modulo traffic weights.
 * 2. Server-side eligibility validation (channel, format, owner, status).
 * 3. Contamination prevention (one opportunity in at most one active experiment).
 */

import crypto from "node:crypto";
import type {
  Experiment,
  ExperimentVariant,
  ExperimentAssignment,
  Opportunity,
} from "@shared/schema";
import { assignmentIdentityKey } from "./identity";
import type { ExperimentStoragePort } from "./store";

export class ExperimentEligibilityError extends Error {
  constructor(message: string, readonly code: string = "INELIGIBLE") {
    super(message);
    this.name = "ExperimentEligibilityError";
  }
}

/**
 * Deterministically maps an (experimentId, opportunityId) pair to a variant
 * based on the variants' configured traffic weights.
 *
 * Does NOT use Math.random(). Guarantees the same opportunity always maps
 * to the exact same variant across multiple invocations.
 */
export function selectDeterministicVariant(
  experimentId: number,
  opportunityId: number,
  variants: Array<{ id: number; trafficWeight: number }>,
): { id: number; trafficWeight: number } {
  if (variants.length === 0) {
    throw new Error(`Cannot assign variant: experiment ${experimentId} has no variants`);
  }
  if (variants.length === 1) {
    return variants[0];
  }

  // Calculate total weight
  const totalWeight = variants.reduce((sum, v) => sum + Math.max(v.trafficWeight, 1), 0);

  // Compute deterministic 32-bit integer hash from (experimentId:opportunityId)
  const hashHex = crypto
    .createHash("sha256")
    .update(`${experimentId}:${opportunityId}`)
    .digest("hex")
    .slice(0, 8); // 8 hex chars = 32-bit unsigned int
  const hashVal = parseInt(hashHex, 16);

  // Map to bucket [0, totalWeight)
  const bucket = hashVal % totalWeight;

  let accumulator = 0;
  for (const variant of variants) {
    accumulator += Math.max(variant.trafficWeight, 1);
    if (bucket < accumulator) {
      return variant;
    }
  }

  return variants[0];
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Validates whether an Opportunity is eligible for an Experiment.
 * Enforces owner scoping, experiment status, channel/format compatibility,
 * and opportunity lifecycle state.
 */
export function checkOpportunityEligibility(
  opportunity: Opportunity,
  experiment: Experiment,
): EligibilityResult {
  // 1. Owner isolation
  if (opportunity.userId !== experiment.userId) {
    return { eligible: false, reason: "Opportunity does not belong to the experiment owner" };
  }

  // 2. Experiment status
  if (experiment.status !== "running" && experiment.status !== "ready") {
    return { eligible: false, reason: `Experiment is not running or ready (status: ${experiment.status})` };
  }

  // 3. Opportunity status - terminal/killed opportunities are never eligible
  if (opportunity.status === "killed") {
    return { eligible: false, reason: "Killed opportunities cannot be assigned to experiments" };
  }

  // 4. Scope matching (channel & format)
  const rules = (experiment.eligibilityRules ?? {}) as Record<string, unknown>;
  const targetScope = experiment.targetScope ?? "";

  // Check channel constraint
  const requiredChannel = (rules.channel as string) || parseScopeChannel(targetScope);
  if (requiredChannel && requiredChannel.toLowerCase() !== opportunity.channel.toLowerCase()) {
    return {
      eligible: false,
      reason: `Channel mismatch: opportunity is ${opportunity.channel}, experiment requires ${requiredChannel}`,
    };
  }

  // Check format constraint
  const requiredFormat = (rules.format as string) || parseScopeFormat(targetScope);
  if (requiredFormat && requiredFormat.toLowerCase() !== opportunity.format.toLowerCase()) {
    return {
      eligible: false,
      reason: `Format mismatch: opportunity is ${opportunity.format}, experiment requires ${requiredFormat}`,
    };
  }

  return { eligible: true };
}

function parseScopeChannel(scope: string): string | null {
  const match = scope.match(/channel:([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function parseScopeFormat(scope: string): string | null {
  const match = scope.match(/format:([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Performs server-side eligibility check, deterministic allocation, and durable
 * assignment of an Opportunity to an Experiment.
 */
export async function assignOpportunityToExperiment(
  store: ExperimentStoragePort,
  experimentId: number,
  opportunity: Opportunity,
  userId: number,
): Promise<{ assignment: ExperimentAssignment; variant: ExperimentVariant; alreadyAssigned: boolean }> {
  // 1. Check existing assignment for this opportunity (contamination rule §11: ONE opp -> ONE experiment)
  const existingAssignment = await store.getAssignmentForOpportunity(opportunity.id, userId);
  if (existingAssignment) {
    if (existingAssignment.experimentId !== experimentId) {
      throw new ExperimentEligibilityError(
        `Opportunity ${opportunity.id} is already assigned to active experiment ${existingAssignment.experimentId} (no cross-experiment contamination allowed)`,
        "CONTAMINATED",
      );
    }
    const variant = await store.getVariantForOwner(existingAssignment.variantId, userId);
    if (!variant) {
      throw new Error(`Variant ${existingAssignment.variantId} not found for assignment ${existingAssignment.id}`);
    }
    return { assignment: existingAssignment, variant, alreadyAssigned: true };
  }

  // 2. Load experiment and variants
  const experiment = await store.getExperimentForOwner(experimentId, userId);
  if (!experiment) {
    throw new ExperimentEligibilityError(`Experiment ${experimentId} not found for user ${userId}`, "NOT_FOUND");
  }

  // 3. Verify eligibility
  const eligibility = checkOpportunityEligibility(opportunity, experiment);
  if (!eligibility.eligible) {
    throw new ExperimentEligibilityError(eligibility.reason ?? "Opportunity is ineligible", "INELIGIBLE");
  }

  const variants = experiment.variants;
  if (variants.length === 0) {
    throw new ExperimentEligibilityError(`Experiment ${experimentId} has no variants configured`, "NO_VARIANTS");
  }

  // 4. Deterministic assignment
  const selectedVariantMeta = selectDeterministicVariant(
    experimentId,
    opportunity.id,
    variants.map((v) => ({ id: v.id, trafficWeight: v.trafficWeight })),
  );

  const selectedVariant = variants.find((v) => v.id === selectedVariantMeta.id)!;
  const idKey = assignmentIdentityKey(experimentId, opportunity.id);

  // 5. Persist durable assignment
  const { row: assignment } = await store.createAssignment({
    userId,
    experimentId,
    variantId: selectedVariant.id,
    opportunityId: opportunity.id,
    artifactId: null,
    publicationId: null,
    idempotencyKey: idKey,
  });

  return { assignment, variant: selectedVariant, alreadyAssigned: false };
}
