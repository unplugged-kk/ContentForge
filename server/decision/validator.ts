/**
 * Hard constraints — the code-owned invariants a decision may never override.
 *
 * This module does not enforce anything itself: enforcement stays in the
 * modules that own each gate (artifact readiness, publication leases, rate
 * limits, access classes, payload caps), which continue to run exactly as they
 * do today. `validator.ts` exists so a caller can *assert* the relevant slice
 * before acting on a soft decision, and so the invariant list is in one place
 * and testable.
 *
 * A decision never substitutes for a hard check. `undefined` means "not
 * evaluated by this caller" — it is not a pass.
 */

export interface HardConstraints {
  /** artifact.readiness === "approved" (content/artifact.ts, publication.ts, scheduling.ts). */
  artifactApproved?: boolean;
  /** A provider call already happened — never blind-retry (publication.ts). */
  providerCalled?: boolean;
  /** A retry is being requested after a provider call. */
  retryRequested?: boolean;
  /** Source access class is dispatchable (research/registry.ts allowlist). */
  accessClassAllowed?: boolean;
  /** Payload is inside formatProfiles/payloadSchemas caps. */
  payloadWithinCaps?: boolean;
  /** Owner/attribution checks passed. */
  ownershipOk?: boolean;
  /** Single-flight lease held. */
  leaseHeld?: boolean;
  /** Publish/global rate-limit budget remaining. */
  rateBudgetRemaining?: number;
  /** Research/provider budget remaining. */
  budgetRemaining?: number;
}

export interface HardConstraintResult {
  ok: boolean;
  violations: string[];
}

/**
 * The invariant list, in one place. These are the gates that must keep working
 * with every decision flag on — an unapproved artifact stays unschedulable, a
 * retry after a provider call stays refused, an exhausted budget stays exhausted.
 */
export const HARD_GATE_INVARIANTS = [
  "an artifact must be approved before it is schedulable or publishable",
  "content is immutable at insert; a change is a new revision",
  "auto-publish requires an explicit trusted + on_approval policy pair",
  "after a provider call, publication never blind-retries",
  "single-flight leases are arbitrated by the database",
  "ownership and attribution are mandatory",
  "non-dispatchable access classes are refused at dispatch",
  "publish (30/min) and global (100/min) rate limits apply",
  "payload/format caps apply (x_post 280, threads 500, linkedin 3000, instagram 2200)",
  "autonomy evidence floor and oscillation ceiling are not tunable",
] as const;

/** Report every hard-constraint violation present in the supplied slice. */
export function hardConstraintViolations(constraints: HardConstraints | undefined): string[] {
  if (!constraints) return [];
  const violations: string[] = [];

  if (constraints.artifactApproved === false) violations.push("artifact_not_approved");
  if (constraints.accessClassAllowed === false) violations.push("access_class_not_allowed");
  if (constraints.payloadWithinCaps === false) violations.push("payload_exceeds_format_caps");
  if (constraints.ownershipOk === false) violations.push("ownership_mismatch");
  if (constraints.leaseHeld === false) violations.push("lease_not_held");
  if (constraints.providerCalled === true && constraints.retryRequested === true) {
    violations.push("provider_already_called");
  }
  if (constraints.rateBudgetRemaining !== undefined && constraints.rateBudgetRemaining <= 0) {
    violations.push("rate_budget_exhausted");
  }
  if (constraints.budgetRemaining !== undefined && constraints.budgetRemaining <= 0) {
    violations.push("budget_exhausted");
  }

  return violations;
}

export function assertHardConstraints(constraints: HardConstraints | undefined): HardConstraintResult {
  const violations = hardConstraintViolations(constraints);
  return { ok: violations.length === 0, violations };
}
