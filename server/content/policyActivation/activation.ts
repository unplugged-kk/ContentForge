/**
 * Human-Gated Policy Activation service (Phase 29.3).
 *
 * Approve -> Activate -> Preserve History. A PolicyCandidate never becomes
 * active on its own -- only this module, called from an explicit,
 * authenticated human HTTP action, may flip which GenerationPolicy revision
 * is `status = 'active'` for a policyKey. GenerationPolicy rows are never
 * mutated after creation (the Phase 1 invariant is reused as-is); activation
 * only creates a new immutable revision (or reuses an identical existing one
 * by content hash) and re-points the active flag, inside one transaction.
 */

import { and, desc, eq, sql as rawSql } from "drizzle-orm";
import type { ContentDatabase } from "../storage";
import {
  generationPolicies,
  policyCandidates,
  experiments,
  experimentEvaluations,
  policyActivations,
  type GenerationPolicy,
  type PolicyCandidate,
  type PolicyActivation,
} from "@shared/schema";
import { canonicalJson } from "../policy";
import { createHash } from "node:crypto";
import { activationIdentityKey, rollbackIdentityKey } from "./identity";

export class PolicyActivationError extends Error {
  constructor(message: string, readonly code: string = "INELIGIBLE") {
    super(message);
    this.name = "PolicyActivationError";
  }
}

function parseScopeChannel(scope: string): string | null {
  const match = scope.match(/channel:([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function parseScopeFormat(scope: string): string | null {
  const match = scope.match(/format:([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/** `pol:<format>:<channel>` -- the exact scheme `resolveGenerationPolicy` already uses. */
export function policyKeyForScope(targetScope: string): string {
  const format = parseScopeFormat(targetScope);
  const channel = parseScopeChannel(targetScope);
  if (!format || !channel) {
    throw new PolicyActivationError(
      `targetScope "${targetScope}" does not declare both format: and channel: -- cannot resolve a policyKey`,
      "INVALID_SCOPE",
    );
  }
  return `pol:${format}:${channel}`;
}

export interface ActivationResult {
  activation: PolicyActivation;
  policy: GenerationPolicy;
  previousPolicy: GenerationPolicy | null;
  alreadyActivated: boolean;
}

/**
 * Validates that a candidate is eligible for production activation.
 * Server-side only -- never inferred from frontend state.
 */
async function assertEligible(
  db: ContentDatabase,
  candidate: PolicyCandidate,
  userId: number,
): Promise<void> {
  if (candidate.userId !== userId) {
    throw new PolicyActivationError("Policy candidate does not belong to the requesting owner", "FORBIDDEN");
  }
  if (candidate.status !== "approved_for_future") {
    throw new PolicyActivationError(
      `Policy candidate must be reviewed and approved_for_future before activation (current: ${candidate.status})`,
      "NOT_APPROVED",
    );
  }

  const [experiment] = await db
    .select()
    .from(experiments)
    .where(and(eq(experiments.id, candidate.experimentId), eq(experiments.userId, userId)));
  if (!experiment) {
    throw new PolicyActivationError(`Source experiment ${candidate.experimentId} not found`, "NOT_FOUND");
  }
  if (experiment.status !== "completed") {
    throw new PolicyActivationError(`Source experiment is not completed (status: ${experiment.status})`, "EXPERIMENT_NOT_COMPLETE");
  }
  if (experiment.decision === "invalidated") {
    throw new PolicyActivationError("Source experiment decision was invalidated", "INVALIDATED");
  }
  if (experiment.decision !== "variant_promising" && experiment.decision !== "variant_preferred") {
    throw new PolicyActivationError(
      `Source experiment decision does not permit promotion (decision: ${experiment.decision})`,
      "DECISION_DOES_NOT_PERMIT",
    );
  }

  if (candidate.evaluationId === null) {
    throw new PolicyActivationError("Policy candidate has no linked evaluation", "NO_EVALUATION");
  }
  const [evaluation] = await db
    .select()
    .from(experimentEvaluations)
    .where(and(eq(experimentEvaluations.id, candidate.evaluationId), eq(experimentEvaluations.userId, userId)));
  if (!evaluation) {
    throw new PolicyActivationError(`Evaluation ${candidate.evaluationId} not found`, "NOT_FOUND");
  }
  if (evaluation.evidenceQuality === "insufficient_data") {
    throw new PolicyActivationError("Evidence is insufficient to activate this candidate", "INSUFFICIENT_EVIDENCE");
  }
  const guardrails = (evaluation.guardrailResults ?? []) as Array<{ status: string }>;
  if (guardrails.some((g) => g.status === "regressed")) {
    throw new PolicyActivationError("A guardrail regressed for this candidate's evaluation", "GUARDRAIL_FAILED");
  }
}

/**
 * Activates a PolicyCandidate: creates (or reuses) an immutable GenerationPolicy
 * revision for the candidate's scope, atomically flips the active pointer, and
 * records a durable audit event. Idempotent -- a repeat call for an
 * already-activated candidate returns the original activation unchanged.
 */
export async function activatePolicyCandidate(
  db: ContentDatabase,
  candidateId: number,
  userId: number,
  reason?: string,
  actor: "human" | "autonomous_controller" = "human",
): Promise<ActivationResult> {
  const [candidate] = await db.select().from(policyCandidates).where(eq(policyCandidates.id, candidateId));
  if (!candidate) {
    throw new PolicyActivationError(`Policy candidate ${candidateId} not found`, "NOT_FOUND");
  }

  // Idempotency (§18): a prior activation of this exact candidate already exists.
  const idKey = activationIdentityKey(candidateId);
  const [existingActivation] = await db
    .select()
    .from(policyActivations)
    .where(eq(policyActivations.identityKey, idKey));
  if (existingActivation) {
    if (existingActivation.userId !== userId) {
      throw new PolicyActivationError("Policy candidate does not belong to the requesting owner", "FORBIDDEN");
    }
    const [policy] = await db
      .select()
      .from(generationPolicies)
      .where(eq(generationPolicies.id, existingActivation.activatedPolicyId));
    const previousPolicy = existingActivation.previousPolicyId
      ? (await db.select().from(generationPolicies).where(eq(generationPolicies.id, existingActivation.previousPolicyId)))[0] ?? null
      : null;
    return { activation: existingActivation, policy, previousPolicy, alreadyActivated: true };
  }

  await assertEligible(db, candidate, userId);

  const policyKey = policyKeyForScope(candidate.targetScope);
  const format = parseScopeFormat(candidate.targetScope)!;
  const channel = parseScopeChannel(candidate.targetScope)!;
  const specHash = createHash("sha256")
    .update(canonicalJson({ policyKey, config: candidate.proposedConfiguration }))
    .digest("hex");

  try {
    return await db.transaction(async (tx) => {
      const [priorActive] = await tx
        .select()
        .from(generationPolicies)
        .where(and(eq(generationPolicies.policyKey, policyKey), eq(generationPolicies.status, "active")));

      const [maxVersionRow] = await tx
        .select({ maxVersion: rawSql<number>`coalesce(max(${generationPolicies.version}), 0)` })
        .from(generationPolicies)
        .where(eq(generationPolicies.policyKey, policyKey));
      const nextVersion = (maxVersionRow?.maxVersion ?? 0) + 1;

      // Archive the current active revision FIRST -- inserting the new row as
      // 'active' while an old one is still 'active' would trip the
      // single-active-per-key partial unique index against ourselves, not
      // just against a genuine concurrent writer.
      if (priorActive) {
        await tx
          .update(generationPolicies)
          .set({ status: "archived" })
          .where(eq(generationPolicies.id, priorActive.id));
      }

      const inserted = await tx
        .insert(generationPolicies)
        .values({
          userId,
          policyKey,
          version: nextVersion,
          name: candidate.title,
          format,
          channel,
          voiceId: null,
          templateId: null,
          objective: candidate.rationale,
          audience: null,
          constraints: candidate.proposedConfiguration as Record<string, unknown>,
          modelPreferences: {},
          specHash,
          status: "active",
          contextSnapshot: {
            activatedFrom: {
              policyCandidateId: candidate.id,
              experimentId: candidate.experimentId,
              evaluationId: candidate.evaluationId,
            },
          },
        })
        .onConflictDoNothing({ target: generationPolicies.specHash })
        .returning();

      let newPolicy: GenerationPolicy;
      if (inserted.length > 0) {
        newPolicy = inserted[0];
      } else {
        // Identical configuration already exists as a revision (possibly archived) -- reuse it.
        const [existingRevision] = await tx
          .select()
          .from(generationPolicies)
          .where(eq(generationPolicies.specHash, specHash));
        if (!existingRevision) {
          throw new Error(`Failed to create or load GenerationPolicy revision for spec ${specHash}`);
        }
        newPolicy = existingRevision;
      }

      // Archive every other active revision for this key, then guarantee the
      // target revision is active -- correct regardless of which branch above ran.
      await tx
        .update(generationPolicies)
        .set({ status: "archived" })
        .where(
          and(
            eq(generationPolicies.policyKey, policyKey),
            eq(generationPolicies.status, "active"),
            rawSql`${generationPolicies.id} != ${newPolicy.id}`,
          ),
        );
      const [activated] = await tx
        .update(generationPolicies)
        .set({ status: "active" })
        .where(eq(generationPolicies.id, newPolicy.id))
        .returning();

      const [activation] = await tx
        .insert(policyActivations)
        .values({
          userId,
          action: "activate",
          policyCandidateId: candidate.id,
          experimentId: candidate.experimentId,
          evaluationId: candidate.evaluationId,
          activatedPolicyId: activated.id,
          previousPolicyId: priorActive && priorActive.id !== activated.id ? priorActive.id : null,
          policyKey,
          reason: reason ?? null,
          actor,
          identityKey: idKey,
        })
        .onConflictDoNothing({ target: policyActivations.identityKey })
        .returning();

      if (!activation) {
        throw new Error(`Failed to record activation audit event for candidate ${candidate.id}`);
      }

      return {
        activation,
        policy: activated,
        previousPolicy: priorActive && priorActive.id !== activated.id ? priorActive : null,
        alreadyActivated: false,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error, "generation_policies_one_active_per_key_uq")) {
      throw new PolicyActivationError(
        `Another activation for scope "${policyKey}" completed concurrently -- retry to read the current state`,
        "CONCURRENT_ACTIVATION",
      );
    }
    throw error;
  }
}

/**
 * Rolls a policyKey scope back to whatever revision was active immediately
 * before its most recent activation event. Never deletes or mutates the
 * currently-active revision -- creates a new "rollback" activation event that
 * re-activates the prior revision, preserving full history.
 */
export async function rollbackPolicyForCandidate(
  db: ContentDatabase,
  candidateId: number,
  userId: number,
  reason?: string,
  actor: "human" | "autonomous_controller" = "human",
): Promise<ActivationResult> {
  const [candidate] = await db.select().from(policyCandidates).where(eq(policyCandidates.id, candidateId));
  if (!candidate) {
    throw new PolicyActivationError(`Policy candidate ${candidateId} not found`, "NOT_FOUND");
  }
  if (candidate.userId !== userId) {
    throw new PolicyActivationError("Policy candidate does not belong to the requesting owner", "FORBIDDEN");
  }
  const policyKey = policyKeyForScope(candidate.targetScope);

  const [latestEvent] = await db
    .select()
    .from(policyActivations)
    .where(and(eq(policyActivations.policyKey, policyKey), eq(policyActivations.userId, userId)))
    .orderBy(desc(policyActivations.createdAt))
    .limit(1);

  if (!latestEvent) {
    throw new PolicyActivationError(`No activation history exists for scope "${policyKey}"`, "NO_HISTORY");
  }
  if (latestEvent.action === "rollback") {
    // Idempotent: this scope is already in its rolled-back state. A second
    // rollback call must not toggle back -- it simply reports the current state.
    const [currentPolicy] = await db
      .select()
      .from(generationPolicies)
      .where(eq(generationPolicies.id, latestEvent.activatedPolicyId));
    return { activation: latestEvent, policy: currentPolicy, previousPolicy: null, alreadyActivated: true };
  }
  if (latestEvent.previousPolicyId === null) {
    throw new PolicyActivationError(`Scope "${policyKey}" has no prior revision to roll back to`, "NO_PRIOR_REVISION");
  }

  const targetPolicyId = latestEvent.previousPolicyId;

  try {
    return await db.transaction(async (tx) => {
      const [currentActive] = await tx
        .select()
        .from(generationPolicies)
        .where(and(eq(generationPolicies.policyKey, policyKey), eq(generationPolicies.status, "active")));

      if (currentActive && currentActive.id === targetPolicyId) {
        // Already at the rollback target -- idempotent no-op, return current state.
        return { activation: latestEvent, policy: currentActive, previousPolicy: null, alreadyActivated: true };
      }

      if (currentActive) {
        await tx
          .update(generationPolicies)
          .set({ status: "archived" })
          .where(eq(generationPolicies.id, currentActive.id));
      }
      const [reactivated] = await tx
        .update(generationPolicies)
        .set({ status: "active" })
        .where(eq(generationPolicies.id, targetPolicyId))
        .returning();
      if (!reactivated) {
        throw new Error(`Rollback target GenerationPolicy ${targetPolicyId} no longer exists`);
      }

      const idKey = rollbackIdentityKey(policyKey, targetPolicyId, Date.now());
      const [activation] = await tx
        .insert(policyActivations)
        .values({
          userId,
          action: "rollback",
          policyCandidateId: candidate.id,
          experimentId: candidate.experimentId,
          evaluationId: candidate.evaluationId,
          activatedPolicyId: reactivated.id,
          previousPolicyId: currentActive ? currentActive.id : null,
          policyKey,
          reason: reason ?? null,
          actor,
          identityKey: idKey,
        })
        .returning();

      return {
        activation,
        policy: reactivated,
        previousPolicy: currentActive ?? null,
        alreadyActivated: false,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error, "generation_policies_one_active_per_key_uq")) {
      throw new PolicyActivationError(
        `Another activation for scope "${policyKey}" completed concurrently -- retry to read the current state`,
        "CONCURRENT_ACTIVATION",
      );
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown, constraintName: string): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return !!pgError && pgError.code === "23505" && pgError.constraint === constraintName;
}

export async function getActivePolicyForKey(db: ContentDatabase, policyKey: string): Promise<GenerationPolicy | undefined> {
  const [row] = await db
    .select()
    .from(generationPolicies)
    .where(and(eq(generationPolicies.policyKey, policyKey), eq(generationPolicies.status, "active")));
  return row;
}

/** Used by generation to fill in defaults an explicit caller left unset. Never overrides an explicit value. */
export async function resolvePolicyForGeneration(
  db: ContentDatabase,
  format: string,
  channel: string,
): Promise<GenerationPolicy | undefined> {
  return getActivePolicyForKey(db, `pol:${format}:${channel}`);
}

export interface PolicyHistoryEntry {
  policy: GenerationPolicy;
  activation: PolicyActivation;
}

export async function listPolicyHistoryForOwner(
  db: ContentDatabase,
  userId: number,
  policyKey: string,
): Promise<PolicyHistoryEntry[]> {
  const events = await db
    .select()
    .from(policyActivations)
    .where(and(eq(policyActivations.policyKey, policyKey), eq(policyActivations.userId, userId)))
    .orderBy(desc(policyActivations.createdAt));

  if (events.length === 0) return [];

  const policyIds = Array.from(new Set(events.map((e) => e.activatedPolicyId)));
  const policies = await Promise.all(
    policyIds.map((id) => db.select().from(generationPolicies).where(eq(generationPolicies.id, id)).then((r) => r[0])),
  );
  const policyById = new Map(policies.filter(Boolean).map((p) => [p!.id, p!]));

  const entries: PolicyHistoryEntry[] = [];
  for (const activation of events) {
    const policy = policyById.get(activation.activatedPolicyId);
    if (policy) entries.push({ policy, activation });
  }
  return entries;
}

/**
 * Returns the set of PolicyCandidate IDs whose latest activation event is
 * `action = 'activate'` (i.e. not subsequently rolled back). Server-derived
 * truth for UI rendering — replaces ephemeral client-side `useState`.
 */
export async function getActivatedCandidateIds(
  db: ContentDatabase,
  userId: number,
): Promise<number[]> {
  // Group by policyCandidateId, take the latest event per candidate.
  // A candidate is "activated" if its most recent event is action='activate'.
  const events = await db
    .select()
    .from(policyActivations)
    .where(eq(policyActivations.userId, userId))
    .orderBy(desc(policyActivations.createdAt));

  const latestByCandidateId = new Map<number, string>();
  for (const event of events) {
    if (event.policyCandidateId != null && !latestByCandidateId.has(event.policyCandidateId)) {
      latestByCandidateId.set(event.policyCandidateId, event.action);
    }
  }

  const activatedIds: number[] = [];
  for (const [candidateId, action] of Array.from(latestByCandidateId.entries())) {
    if (action === "activate") {
      activatedIds.push(candidateId);
    }
  }
  return activatedIds;
}

/**
 * Phase 29.5 UX audit (§7): returns, for every currently-activated
 * candidate, whether that activation was performed by a human or the
 * autonomous controller -- so the UI can visually distinguish the two
 * rather than presenting them identically. Additive: does not change
 * `getActivatedCandidateIds`'s existing contract or callers.
 */
export async function getActivatedCandidateActors(
  db: ContentDatabase,
  userId: number,
): Promise<Record<number, "human" | "autonomous_controller">> {
  const events = await db
    .select()
    .from(policyActivations)
    .where(eq(policyActivations.userId, userId))
    .orderBy(desc(policyActivations.createdAt));

  const latestByCandidateId = new Map<number, { action: string; actor: "human" | "autonomous_controller" }>();
  for (const event of events) {
    if (event.policyCandidateId != null && !latestByCandidateId.has(event.policyCandidateId)) {
      latestByCandidateId.set(event.policyCandidateId, { action: event.action, actor: event.actor as "human" | "autonomous_controller" });
    }
  }

  const actors: Record<number, "human" | "autonomous_controller"> = {};
  for (const [candidateId, { action, actor }] of Array.from(latestByCandidateId.entries())) {
    if (action === "activate") {
      actors[candidateId] = actor;
    }
  }
  return actors;
}
