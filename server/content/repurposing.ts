/**
 * Repurposing boundary: Story → RepurposingPlan → Opportunity[N].
 *
 * `repurposeStory` turns one durable Story into several independently
 * addressable Opportunities (and, unless a target opts out, their
 * GenerationJobs) without re-researching. It is a batch composition over the
 * EXISTING primitives (`createOpportunityFromStory`, `createGenerationJob`) —
 * no parallel lineage model, no second generation abstraction, no second
 * queue, no `MassRepurposeService`. Target-specific behavior (X post vs X
 * thread vs LinkedIn) falls out of `format`/`channel` differing per target,
 * exactly as it already does for any two ordinary Opportunities on the same
 * Story — nothing here branches on a platform name.
 *
 * Phase 25 generalizes the same function: a target `count` expands into
 * durable slot identities, a `RepurposingPlan` freezes the requested slots
 * plus plan-level ContextAssembly inputs, and progress is always derived
 * from Opportunity / GenerationJob / Artifact rows — never an in-memory cursor.
 *
 * The central invariant: this module never reaches research, a
 * SourceProvider, or the queue. `createGenerationJob` reads the Story's
 * EXISTING evidence (via `loadGenerationContext`); it never creates one.
 */

import { randomUUID } from "node:crypto";
import type { GenerationJob, Opportunity, RepurposingPlan } from "@shared/schema";
import {
  createOpportunityFromStory,
  formatChannelError,
  StoryNotFoundError,
  StoryNotUsableError,
  type OpportunityDeps,
} from "./opportunity";
import { createGenerationJob, type CreateGenerationJobInput, type GenerationDeps } from "./generation";
import { assembleContext, EMPTY_CONTEXT_ASSEMBLY, type ContextAssembly } from "./context";
import type { JsonRecord } from "./storage";

export const MAX_TARGETS_PER_PLAN = 20;
export const MAX_COUNT_PER_TARGET = 10;
export const MAX_OPPORTUNITIES_PER_PLAN = 50;

export interface RepurposeLimits {
  maxTargetsPerPlan: number;
  maxCountPerTarget: number;
  maxOpportunities: number;
}

export const DEFAULT_REPURPOSE_LIMITS: RepurposeLimits = {
  maxTargetsPerPlan: MAX_TARGETS_PER_PLAN,
  maxCountPerTarget: MAX_COUNT_PER_TARGET,
  maxOpportunities: MAX_OPPORTUNITIES_PER_PLAN,
};

export interface RepurposingPlanPort {
  claimRepurposingPlan(row: InsertRepurposingPlanRow): Promise<{ plan: RepurposingPlan; created: boolean }>;
  getRepurposingPlan(id: number): Promise<RepurposingPlan | undefined>;
  getRepurposingPlanForOwner?(id: number, ownerId: number): Promise<RepurposingPlan | undefined>;
  getRepurposingPlanByStoryRequest(storyId: number, requestKey: string): Promise<RepurposingPlan | undefined>;
  patchRepurposingPlan(id: number, patch: PatchRepurposingPlanRow): Promise<RepurposingPlan | undefined>;
}

export interface InsertRepurposingPlanRow {
  userId?: number | null;
  storyId: number;
  planVersion?: number;
  status?: string;
  requestKey: string;
  snapshot: JsonRecord;
  limits: JsonRecord;
}

export interface PatchRepurposingPlanRow {
  status?: string;
  snapshot?: JsonRecord;
  errorClass?: string | null;
  errorMessage?: string | null;
  completedAt?: Date | null;
}

export interface RepurposeDeps {
  opportunities: OpportunityDeps;
  generation: GenerationDeps;
  /** Optional so pre-Phase-25 test doubles keep working. Production always wires it. */
  plans?: RepurposingPlanPort;
}

export interface RepurposeTargetInput {
  format: string;
  channel: string;
  /** Number of independent Opportunities for this format×channel. Default 1. */
  count?: number;
  concept?: string;
  objective?: string;
  audience?: string;
  angle?: string;
  /** Opportunity only, no GenerationJob for this target. Default: generate. */
  generate?: boolean;
  voiceId?: number | null;
  templateId?: number | null;
  model?: string;
  constraints?: Record<string, unknown>;
  /**
   * Bypass idempotent reuse for THIS target — a deliberate new derivation
   * even though the batch's `requestKey` (and this target's format/channel)
   * matches an earlier repurpose call. Mirrors `CreateGenerationJobInput.regenerate`.
   */
  regenerate?: boolean;
}

export interface RepurposeInput {
  /**
   * Durable idempotency for the WHOLE batch. Omit for no dedup guarantee —
   * mirrors chat-to-post's optional `idempotencyKey`. Present, a duplicate
   * delivery of the same (storyId, requestKey, format, channel, slot) reuses
   * the existing Opportunity instead of creating a sibling.
   */
  requestKey?: string;
  targets: RepurposeTargetInput[];
  limits?: Partial<RepurposeLimits>;
}

export type RepurposeOutcomeStatus = "created" | "reused" | "invalid";

export interface RepurposeTargetOutcome {
  format: string;
  channel: string;
  slot: number;
  status: RepurposeOutcomeStatus;
  opportunity?: Opportunity;
  job?: GenerationJob;
  error?: string;
}

export type RepurposingPlanStatus =
  | "planning"
  | "queued"
  | "running"
  | "awaiting_approval"
  | "partial"
  | "completed"
  | "failed"
  | "cancelled";

export interface RepurposeProgress {
  targets: number;
  opportunitiesCreated: number;
  opportunitiesReused: number;
  invalid: number;
  jobsQueued: number;
  jobsSucceeded: number;
  jobsFailed: number;
  artifacts: number;
  awaitingApproval: number;
}

export interface RepurposeResult {
  storyId: number;
  plan?: RepurposingPlan;
  outcomes: RepurposeTargetOutcome[];
  progress: RepurposeProgress;
}

export interface ExpandedSlot {
  format: string;
  channel: string;
  slot: number;
  count: number;
  concept?: string;
  objective?: string;
  audience?: string;
  angle?: string;
  generate: boolean;
  voiceId?: number | null;
  templateId?: number | null;
  model?: string;
  constraints?: Record<string, unknown>;
  regenerate: boolean;
  error?: string;
  repurposeKey: string | null;
}

export class RepurposeInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid repurpose input: ${issues.join("; ")}`);
    this.name = "RepurposeInputError";
    this.issues = issues;
  }
}

export class RepurposingPlanNotFoundError extends Error {
  constructor(readonly planId: number) {
    super(`Repurposing plan ${planId} not found`);
    this.name = "RepurposingPlanNotFoundError";
  }
}

/**
 * Slot 1 keeps the Phase 12 key so existing automation / HTTP idempotency
 * continues to collapse. Slots 2+ append `:sN` — never a random nonce.
 */
export function repurposeKeyFor(
  storyId: number,
  requestKey: string,
  format: string,
  channel: string,
  slot = 1,
): string {
  const base = `repurpose:${storyId}:${requestKey}:${format}:${channel}`;
  return slot <= 1 ? base : `${base}:s${slot}`;
}

export function normalizeAngle(angle: string | undefined | null): string | null {
  if (typeof angle !== "string") return null;
  const trimmed = angle.trim().replace(/\s+/g, " ").toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveRepurposeLimits(limits?: Partial<RepurposeLimits>): RepurposeLimits {
  return {
    maxTargetsPerPlan: clampLimit(limits?.maxTargetsPerPlan, 1, MAX_TARGETS_PER_PLAN, MAX_TARGETS_PER_PLAN),
    maxCountPerTarget: clampLimit(limits?.maxCountPerTarget, 1, MAX_COUNT_PER_TARGET, MAX_COUNT_PER_TARGET),
    maxOpportunities: clampLimit(limits?.maxOpportunities, 1, MAX_OPPORTUNITIES_PER_PLAN, MAX_OPPORTUNITIES_PER_PLAN),
  };
}

function clampLimit(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Expand caller targets into durable slots. Counts for the same
 * format×channel accumulate so two `{x_post, x}` entries become slots 1 and 2
 * rather than colliding on the Phase 12 slot-1 key.
 */
export function expandRepurposeTargets(
  storyId: number,
  requestKey: string | undefined,
  targets: RepurposeTargetInput[],
  limits: RepurposeLimits = DEFAULT_REPURPOSE_LIMITS,
): { slots: ExpandedSlot[]; issues: string[] } {
  const issues: string[] = [];
  if (!Array.isArray(targets) || targets.length === 0) {
    return { slots: [], issues: ["at least one target is required"] };
  }
  if (targets.length > limits.maxTargetsPerPlan) {
    return {
      slots: [],
      issues: [`at most ${limits.maxTargetsPerPlan} targets are allowed per plan (got ${targets.length})`],
    };
  }

  const nextSlot = new Map<string, number>();
  const slots: ExpandedSlot[] = [];

  for (const target of targets) {
    const format = String(target?.format ?? "").trim();
    const channel = String(target?.channel ?? "").trim();
    const rawCount = target?.count;
    const count = rawCount === undefined || rawCount === null ? 1 : Number(rawCount);
    if (!Number.isInteger(count) || count < 1) {
      issues.push(`${format || "target"}/${channel || "?"}: count must be a positive integer`);
      continue;
    }
    if (count > limits.maxCountPerTarget) {
      issues.push(
        `${format || "target"}/${channel || "?"}: count ${count} exceeds maxCountPerTarget ${limits.maxCountPerTarget}`,
      );
      continue;
    }

    const pairError = !format || !channel ? "format and channel are required" : formatChannelError(format, channel);
    const pair = `${format}:${channel}`;

    for (let i = 0; i < count; i += 1) {
      const slot = (nextSlot.get(pair) ?? 0) + 1;
      nextSlot.set(pair, slot);
      slots.push({
        format,
        channel,
        slot,
        count,
        concept: target.concept,
        objective: target.objective,
        audience: target.audience,
        angle: target.angle,
        generate: target.generate !== false,
        voiceId: target.voiceId,
        templateId: target.templateId,
        model: target.model,
        constraints: target.constraints,
        regenerate: target.regenerate === true,
        error: pairError ?? undefined,
        repurposeKey:
          requestKey && !target.regenerate ? repurposeKeyFor(storyId, requestKey, format, channel, slot) : null,
      });
    }
  }

  if (slots.length > limits.maxOpportunities) {
    return {
      slots: [],
      issues: [
        `expanded slot count ${slots.length} exceeds maxOpportunities ${limits.maxOpportunities}`,
      ],
    };
  }
  return { slots, issues };
}

export function emptyProgress(): RepurposeProgress {
  return {
    targets: 0,
    opportunitiesCreated: 0,
    opportunitiesReused: 0,
    invalid: 0,
    jobsQueued: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    artifacts: 0,
    awaitingApproval: 0,
  };
}

export function progressFromOutcomes(outcomes: RepurposeTargetOutcome[]): RepurposeProgress {
  const progress = emptyProgress();
  progress.targets = outcomes.length;
  for (const outcome of outcomes) {
    if (outcome.status === "invalid") progress.invalid += 1;
    else if (outcome.status === "created") progress.opportunitiesCreated += 1;
    else if (outcome.status === "reused") progress.opportunitiesReused += 1;
    if (outcome.job?.status === "queued" || outcome.job?.status === "running") progress.jobsQueued += 1;
    if (outcome.job?.status === "succeeded") progress.jobsSucceeded += 1;
    if (outcome.job?.status === "failed") progress.jobsFailed += 1;
  }
  return progress;
}

export function aggregatePlanStatus(
  current: string | undefined,
  progress: RepurposeProgress,
): RepurposingPlanStatus {
  if (current === "cancelled") return "cancelled";
  const produced = progress.opportunitiesCreated + progress.opportunitiesReused;
  const failed = progress.invalid + progress.jobsFailed;
  if (progress.targets === 0) return "planning";
  if (progress.jobsQueued > 0) return produced > 0 ? "running" : "queued";
  if (produced === 0 && failed > 0) return "failed";
  if (failed > 0 && produced > 0) return "partial";
  if (progress.awaitingApproval > 0) return "awaiting_approval";
  if (produced > 0 && failed === 0) return "completed";
  return "queued";
}

function slotFromSnapshot(raw: unknown, requestKey: string | undefined, storyId: number): ExpandedSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const slot = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const format = String(slot.format ?? "");
    const channel = String(slot.channel ?? "");
    const n = Number(slot.slot ?? 1);
    const regenerate = slot.regenerate === true;
    return {
      format,
      channel,
      slot: Number.isInteger(n) && n > 0 ? n : 1,
      count: Number(slot.count ?? 1) || 1,
      concept: typeof slot.concept === "string" ? slot.concept : undefined,
      objective: typeof slot.objective === "string" ? slot.objective : undefined,
      audience: typeof slot.audience === "string" ? slot.audience : undefined,
      angle: typeof slot.angle === "string" ? slot.angle : undefined,
      generate: slot.generate !== false,
      voiceId: typeof slot.voiceId === "number" ? slot.voiceId : slot.voiceId === null ? null : undefined,
      templateId: typeof slot.templateId === "number" ? slot.templateId : slot.templateId === null ? null : undefined,
      model: typeof slot.model === "string" ? slot.model : undefined,
      constraints:
        slot.constraints && typeof slot.constraints === "object"
          ? (slot.constraints as Record<string, unknown>)
          : undefined,
      regenerate,
      error: typeof slot.error === "string" ? slot.error : undefined,
      repurposeKey:
        typeof slot.repurposeKey === "string"
          ? slot.repurposeKey
          : requestKey && !regenerate
            ? repurposeKeyFor(storyId, requestKey, format, channel, Number.isInteger(n) ? n : 1)
            : null,
    };
  });
}

async function freezePlanContext(
  ownerId: number | null | undefined,
  channels: string[],
  deps: RepurposeDeps,
): Promise<Record<string, ContextAssembly>> {
  const reader = deps.generation.contextReader;
  if (!reader || ownerId == null) return {};
  const unique = Array.from(new Set(channels.filter(Boolean)));
  const frozen: Record<string, ContextAssembly> = {};
  const fallback = await assembleContext(ownerId, reader);
  frozen._default = fallback;
  for (const channel of unique) {
    frozen[channel] = await assembleContext(ownerId, reader, { channel });
  }
  return frozen;
}

function contextForChannel(
  frozen: Record<string, ContextAssembly> | undefined,
  channel: string,
): ContextAssembly | undefined {
  if (!frozen) return undefined;
  return frozen[channel] ?? frozen._default;
}

/**
 * Story → N Opportunities (and, unless a target sets `generate: false`,
 * their GenerationJobs). Every target is validated independently — an
 * invalid target is reported as such but never rolls back its valid
 * siblings (partial success by design; §18). `callerUserId`, when supplied,
 * enforces ownership: a foreign Story is refused with the exact same
 * `StoryNotFoundError` a missing one produces (non-leaking).
 */
export async function repurposeStory(
  storyId: number,
  input: RepurposeInput,
  deps: RepurposeDeps,
  callerUserId?: number | null,
): Promise<RepurposeResult> {
  if (!Number.isInteger(storyId) || storyId <= 0) {
    throw new RepurposeInputError(["storyId must be a positive integer"]);
  }
  if (!input || !Array.isArray(input.targets) || input.targets.length === 0) {
    throw new RepurposeInputError(["at least one target is required"]);
  }

  const story = await deps.opportunities.stories.getStory(storyId);
  if (!story) throw new StoryNotFoundError(storyId);
  if (callerUserId != null && story.userId !== null && story.userId !== callerUserId) {
    // A foreign Story looks exactly like a missing one — no ownership leak.
    throw new StoryNotFoundError(storyId);
  }
  if (story.status === "archived") throw new StoryNotUsableError(storyId, story.status);

  const limits = resolveRepurposeLimits(input.limits);
  const callerRequestKey = typeof input.requestKey === "string" && input.requestKey.trim()
    ? input.requestKey.trim()
    : undefined;
  const requestKey = callerRequestKey ?? randomUUID();

  const expanded = expandRepurposeTargets(storyId, requestKey, input.targets, limits);
  if (expanded.issues.length > 0) throw new RepurposeInputError(expanded.issues);

  const plans = deps.plans;
  let plan: RepurposingPlan | undefined;
  let slots = expanded.slots;
  let frozenContext: Record<string, ContextAssembly> | undefined;

  if (plans) {
    const createdSnapshot: JsonRecord = {
      storyId,
      planVersion: 1,
      requestKey,
      targets: input.targets,
      slots: expanded.slots,
      limits,
    };
    const claimed = await plans.claimRepurposingPlan({
      userId: story.userId ?? callerUserId ?? null,
      storyId,
      planVersion: 1,
      status: "planning",
      requestKey,
      snapshot: createdSnapshot,
      limits: { ...limits },
    });
    plan = claimed.plan;
    if (plan.status === "cancelled") {
      const cancelledOutcomes: RepurposeTargetOutcome[] = slots.map((slot) => ({
        format: slot.format,
        channel: slot.channel,
        slot: slot.slot,
        status: "invalid",
        error: "plan cancelled",
      }));
      return {
        storyId,
        plan,
        outcomes: cancelledOutcomes,
        progress: progressFromOutcomes(cancelledOutcomes),
      };
    }
    if (!claimed.created && !input.targets.some((target) => target.regenerate)) {
      slots = slotFromSnapshot((plan.snapshot as JsonRecord).slots, plan.requestKey, storyId);
      const existingFrozen = (plan.snapshot as JsonRecord).contextByChannel;
      if (existingFrozen && typeof existingFrozen === "object") {
        frozenContext = existingFrozen as Record<string, ContextAssembly>;
      }
    }
    if (!frozenContext) {
      frozenContext = await freezePlanContext(story.userId ?? callerUserId, slots.map((s) => s.channel), deps);
      const snapshot = {
        ...((plan.snapshot as JsonRecord) ?? {}),
        contextByChannel: Object.fromEntries(
          Object.entries(frozenContext).map(([channel, assembly]) => [
            channel,
            { contextHash: assembly.contextHash, sourceRefs: assembly.sourceRefs, renderedBlock: assembly.renderedBlock, sources: assembly.sources },
          ]),
        ),
      };
      const patched = await plans.patchRepurposingPlan(plan.id, { snapshot, status: "queued" });
      if (patched) plan = patched;
    }
  }

  const content = deps.opportunities.opportunities;
  const outcomes: RepurposeTargetOutcome[] = [];

  for (const target of slots) {
    const format = target.format;
    const channel = target.channel;
    if (target.error) {
      outcomes.push({ format, channel, slot: target.slot, status: "invalid", error: target.error });
      continue;
    }

    let repurposeKey = target.repurposeKey;
    if (callerRequestKey && target.regenerate) {
      // Intentional new derivation: a fresh nonce keeps it unique without
      // ever colliding with (or being reusable via) the base logical key.
      repurposeKey = `${repurposeKeyFor(storyId, requestKey, format, channel, target.slot)}:regen:${randomUUID()}`;
    }

    if (repurposeKey && !target.regenerate) {
      const existing = await content.getOpportunityByRepurposeKey?.(repurposeKey);
      if (existing) {
        const job = await content.getLatestGenerationJobForOpportunity(existing.id);
        outcomes.push({ format, channel, slot: target.slot, status: "reused", opportunity: existing, job });
        continue;
      }
    }

    let opportunity: Opportunity;
    try {
      const slotLabel = target.slot > 1 ? ` #${target.slot}` : "";
      opportunity = await createOpportunityFromStory(
        storyId,
        {
          concept: target.concept ?? `${story.title} → ${format} (${channel})${slotLabel}`,
          objective: target.objective ?? story.title,
          format,
          channel,
          ...(target.audience ? { audience: target.audience } : {}),
          ...(target.angle ? { angle: target.angle } : {}),
          proposer: "human",
          ...(repurposeKey ? { repurposeKey } : {}),
        },
        deps.opportunities,
      );
    } catch (error) {
      // Two concurrent identical requests: the UNIQUE repurpose_key index
      // rejects the loser, which reuses the winner instead of failing.
      if (repurposeKey) {
        const winner = await content.getOpportunityByRepurposeKey?.(repurposeKey);
        if (winner) {
          const job = await content.getLatestGenerationJobForOpportunity(winner.id);
          outcomes.push({ format, channel, slot: target.slot, status: "reused", opportunity: winner, job });
          continue;
        }
      }
      outcomes.push({
        format,
        channel,
        slot: target.slot,
        status: "invalid",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    let job: GenerationJob | undefined;
    let jobError: string | undefined;
    if (target.generate !== false) {
      try {
        const frozen = contextForChannel(frozenContext, channel);
        const jobInput: CreateGenerationJobInput = {
          ...(target.voiceId !== undefined ? { voiceId: target.voiceId } : {}),
          ...(target.templateId !== undefined ? { templateId: target.templateId } : {}),
          ...(target.objective ? { objective: target.objective } : {}),
          ...(target.audience ? { audience: target.audience } : {}),
          ...(target.constraints ? { constraints: target.constraints } : {}),
          ...(target.model ? { model: target.model } : {}),
          ...(frozen ? { frozenContext: frozen } : {}),
        };
        const created = await createGenerationJob(opportunity.id, jobInput, deps.generation);
        job = created.job;
      } catch (error) {
        jobError = error instanceof Error ? error.message : String(error);
      }
    }

    outcomes.push({
      format,
      channel,
      slot: target.slot,
      status: "created",
      opportunity,
      ...(job ? { job } : {}),
      ...(jobError ? { error: jobError } : {}),
    });
  }

  const progress = progressFromOutcomes(outcomes);
  if (plan && plans) {
    const status = aggregatePlanStatus(plan.status, progress);
    const completedAt = status === "completed" || status === "failed" || status === "partial" ? new Date() : null;
    const patched = await plans.patchRepurposingPlan(plan.id, {
      status,
      completedAt,
    });
    if (patched) plan = patched;
  }

  return { storyId, plan, outcomes, progress };
}

export async function inspectRepurposingPlan(
  planId: number,
  deps: RepurposeDeps,
  callerUserId?: number | null,
): Promise<{ plan: RepurposingPlan; outcomes: RepurposeTargetOutcome[]; progress: RepurposeProgress }> {
  const plans = deps.plans;
  if (!plans) throw new RepurposingPlanNotFoundError(planId);
  const plan = await plans.getRepurposingPlan(planId);
  if (!plan) throw new RepurposingPlanNotFoundError(planId);
  if (callerUserId != null && plan.userId != null && plan.userId !== callerUserId) {
    throw new RepurposingPlanNotFoundError(planId);
  }

  const slots = slotFromSnapshot((plan.snapshot as JsonRecord).slots, plan.requestKey, plan.storyId);
  const content = deps.opportunities.opportunities;
  const outcomes: RepurposeTargetOutcome[] = [];
  for (const slot of slots) {
    if (slot.error) {
      outcomes.push({ format: slot.format, channel: slot.channel, slot: slot.slot, status: "invalid", error: slot.error });
      continue;
    }
    const key = slot.repurposeKey;
    const opportunity = key ? await content.getOpportunityByRepurposeKey?.(key) : undefined;
    if (!opportunity) {
      outcomes.push({ format: slot.format, channel: slot.channel, slot: slot.slot, status: "invalid", error: "opportunity not yet created" });
      continue;
    }
    const job = await content.getLatestGenerationJobForOpportunity(opportunity.id);
    outcomes.push({
      format: slot.format,
      channel: slot.channel,
      slot: slot.slot,
      status: "reused",
      opportunity,
      job,
    });
  }
  const progress = progressFromOutcomes(outcomes);
  if (content.listArtifactsByOpportunity) {
    for (const outcome of outcomes) {
      if (!outcome.opportunity) continue;
      const artifacts = await content.listArtifactsByOpportunity(outcome.opportunity.id);
      progress.artifacts += artifacts.length;
      progress.awaitingApproval += artifacts.filter((a) => a.readiness === "draft" || a.readiness === "in_review").length;
    }
  }
  const status = aggregatePlanStatus(plan.status, progress);
  if (status !== plan.status) {
    const patched = await plans.patchRepurposingPlan(plan.id, { status });
    return { plan: patched ?? plan, outcomes, progress };
  }
  return { plan, outcomes, progress };
}

export async function cancelRepurposingPlan(
  planId: number,
  deps: RepurposeDeps,
  callerUserId?: number | null,
): Promise<RepurposingPlan> {
  const { plan } = await inspectRepurposingPlan(planId, deps, callerUserId);
  if (plan.status === "completed") return plan;
  const patched = await deps.plans?.patchRepurposingPlan(plan.id, {
    status: "cancelled",
    completedAt: new Date(),
  });
  if (!patched) throw new RepurposingPlanNotFoundError(planId);
  return patched;
}

export { EMPTY_CONTEXT_ASSEMBLY };
