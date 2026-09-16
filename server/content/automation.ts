/**
 * Automation / autopilot foundation (Phase 13).
 *
 * Automation creates DURABLE INTENT and then drives the EXISTING primitives. It
 * is deliberately not a second orchestration system, and it owns no domain state
 * of its own:
 *
 *   AutomationPolicy ──▶ AutomationRun ──▶ ResearchJob  (existing `research.run`)
 *                                      ──▶ Story        (existing `createStoryFromResearch`)
 *                                      ──▶ Opportunity[N] (Phase 12 `repurposeStory`)
 *                                      ──▶ GenerationJob  (existing `generation.run`)
 *                                      ──▶ Artifact → approval (the EXISTING state machine)
 *                                      ──▶ Schedule → Occurrence → Publication → Result
 *
 * What automation adds is exactly three things, all durable:
 *
 *   1. **Policy** — owner-scoped intent: trigger, research config, bounded
 *      targets, generation config, approval mode, publication behaviour, limits.
 *   2. **Run** — one execution record per logical trigger, carrying a FROZEN
 *      policy snapshot (`policyVersion` + `policySnapshot`) so a policy edit can
 *      never change a run that already started (§5/§20).
 *   3. **Advancement** — a bounded, idempotent step machine driven by the
 *      database: `research → story → fanout → settle`.
 *
 * Non-negotiable boundaries enforced structurally here:
 *   • No provider adapter, AI client or SourceProvider is reachable from this
 *     module. The only external work is enqueueing the EXISTING job types.
 *   • Every async payload is a durable id, never content.
 *   • The database — `automation_runs_idempotency_key_unique`,
 *     `stories_automation_run_uq`, the ResearchJob idempotency key and Phase
 *     12's `repurpose_key` — is the concurrency/idempotency arbiter. No
 *     in-memory lock exists.
 *   • Research content is DATA, never instructions: nothing read from research
 *     can change this run's policy, targets, channel, approval mode or
 *     execution instructions (§22). Those come only from the frozen snapshot,
 *     which comes only from trusted, owner-controlled persisted input.
 *   • Automation stops at a durable `awaiting_approval` state unless the policy
 *     EXPLICITLY declares `approvalMode: "trusted"` (§12).
 *
 * Deliberately NOT built here (see the phase documentation): autonomous topic
 * discovery/ranking, analytics-driven learning, notifications, a UI, and any
 * auto-publishing default. `triggerType` is a bounded enum precisely so a future
 * `discover_topics` trigger can be added without redesigning anything.
 */

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Artifact,
  AutomationApprovalMode,
  AutomationPolicy,
  AutomationRun,
  AutomationRunStatus,
  AutomationTriggerType,
  GenerationJob,
  ResearchJob,
} from "@shared/schema";
import { JobFailure, classifyError, describeError } from "../jobs/failures";
import type { ClaimJobInput, ClaimJobResult } from "../research/storage";
import { hasProvider } from "../research/registry";
import { createResearchJobBodySchema } from "../research/routes";
import { createStoryFromResearch } from "../story/service";
import type { StoryStoragePort } from "../story/storage";
import { approveArtifact, submitArtifactForReview, ArtifactStateError } from "./artifact";
import { createSchedule, parseRecurrenceIntervalMs } from "./scheduling";
import { repurposeStory, type RepurposeDeps, type RepurposeTargetInput } from "./repurposing";
import { canonicalJson } from "./policy";
import { getFormatProfile } from "./formatProfiles";
import type { ContentStoragePort, JsonRecord } from "./storage";
import type { AutomationStoragePort, InsertAutomationRunRow } from "./automationStorage";

// ── vocabulary ────────────────────────────────────────────────────────────────
export const AUTOMATION_TRIGGER_MANUAL: AutomationTriggerType = "manual";
export const AUTOMATION_TRIGGER_SCHEDULED: AutomationTriggerType = "scheduled";

/** How long one orchestrator hold on a run lasts before another tick may take it. */
export const AUTOMATION_ADVANCE_LEASE_MS = 30_000;

/**
 * Durable bound on orchestration attempts. A recoverable failure keeps the run
 * in its intermediate state so the next tick retries, but an unbounded retry
 * loop is not a recovery strategy — once this many advances have failed the run
 * is failed permanently and left for an operator.
 */
export const MAX_AUTOMATION_ATTEMPTS = 10;

/**
 * Operational defaults, not billing (§14). Bounded by default: a policy that
 * declares nothing still cannot run away.
 */
export const DEFAULT_AUTOMATION_LIMITS = {
  maxRunsPerDay: 24,
  maxOpportunitiesPerRun: 5,
  maxGeneratedArtifactsPerRun: 5,
} as const;

export const RUN_TERMINAL_STATUSES: readonly AutomationRunStatus[] = [
  "awaiting_approval",
  "completed",
  "partial",
  "failed",
];

export function isTerminalRunStatus(status: string): boolean {
  return (RUN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

// ── errors ────────────────────────────────────────────────────────────────────
export class AutomationPolicyInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid automation policy: ${issues.join("; ")}`);
    this.name = "AutomationPolicyInputError";
    this.issues = issues;
  }
}

/** Non-leaking: a foreign policy is indistinguishable from a missing one. */
export class AutomationPolicyNotFoundError extends Error {
  constructor(readonly policyId: number) {
    super(`Automation policy ${policyId} not found`);
    this.name = "AutomationPolicyNotFoundError";
  }
}

export class AutomationRunNotFoundError extends Error {
  constructor(readonly runId: number) {
    super(`Automation run ${runId} not found`);
    this.name = "AutomationRunNotFoundError";
  }
}

export class AutomationPolicyInactiveError extends Error {
  constructor(
    readonly policyId: number,
    readonly status: string,
  ) {
    super(`Automation policy ${policyId} is "${status}" and cannot be triggered`);
    this.name = "AutomationPolicyInactiveError";
  }
}

/** A durable operational boundary was reached — not a failure of the work. */
export class AutomationLimitError extends Error {
  constructor(
    readonly policyId: number,
    readonly limit: string,
    readonly allowed: number,
    readonly observed: number,
  ) {
    super(
      `Automation policy ${policyId} reached its ${limit} limit (${observed}/${allowed})`,
    );
    this.name = "AutomationLimitError";
  }
}

// ── policy schemas ────────────────────────────────────────────────────────────
export const automationTriggerConfigSchema = z.object({
  /** Required for `scheduled`: the first slot. */
  startAt: z.string().datetime().optional(),
  /** The EXISTING bounded recurrence grammar (`every:<n><unit>`, m/h/d/w). No RRULE. */
  recurrence: z.string().trim().min(1).max(200).optional(),
  /** Stored metadata only, exactly as `schedules.timezone` is. */
  timezone: z.string().trim().min(1).max(64).optional(),
});

/**
 * A target is Phase 12's `RepurposeTargetInput`. Structural validation only:
 * format × channel capability is validated by `repurposeStory` itself (which
 * reads the channel-adapter registry), so there is exactly one authority for
 * "can this pair actually be produced".
 */
export const automationTargetSchema = z.object({
  format: z.string().trim().min(1).max(50),
  channel: z.string().trim().min(1).max(50),
  concept: z.string().trim().min(1).max(2000).optional(),
  objective: z.string().trim().min(1).max(2000).optional(),
  audience: z.string().trim().min(1).max(2000).optional(),
  angle: z.string().trim().min(1).max(2000).optional(),
  /** `false` → create the Opportunity only (no GenerationJob for this target). */
  generate: z.boolean().optional(),
  voiceId: z.number().int().positive().nullable().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  constraints: z.record(z.unknown()).optional(),
});

export const automationGenerationConfigSchema = z.object({
  voiceId: z.number().int().positive().nullable().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  objective: z.string().trim().min(1).max(2000).optional(),
  audience: z.string().trim().min(1).max(2000).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  constraints: z.record(z.unknown()).optional(),
});

export const automationPublicationConfigSchema = z.object({
  /**
   * `none` (default) — automation never creates a Schedule; approval is a human
   * boundary. `on_approval` — after a trusted run approves its artifacts, each
   * approved revision is scheduled through the EXISTING `createSchedule`, so
   * publishing still flows through Schedule → Occurrence → Publication → Result.
   */
  mode: z.enum(["none", "on_approval"]).default("none"),
  /** Optional explicit first slot for the created Schedule; defaults to now. */
  startAt: z.string().datetime().optional(),
  recurrence: z.string().trim().min(1).max(200).optional(),
  count: z.number().int().positive().max(1000).optional(),
});

export const automationLimitsSchema = z.object({
  maxRunsPerDay: z.number().int().positive().max(1000).optional(),
  maxOpportunitiesPerRun: z.number().int().positive().max(50).optional(),
  maxGeneratedArtifactsPerRun: z.number().int().positive().max(50).optional(),
});

const automationPolicyBaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  status: z.enum(["active", "paused", "archived"]).default("active"),
  triggerType: z.enum(["manual", "scheduled"]),
  triggerConfig: automationTriggerConfigSchema.default({}),
  /** Validated against the EXISTING research request schema below. */
  researchConfig: z.record(z.unknown()),
  targets: z.array(automationTargetSchema).min(1).max(20),
  generationConfig: automationGenerationConfigSchema.default({}),
  approvalMode: z.enum(["approval_required", "trusted"]).default("approval_required"),
  publicationConfig: automationPublicationConfigSchema.default({ mode: "none" }),
  limits: automationLimitsSchema.default({}),
});

export type AutomationTriggerConfig = z.infer<typeof automationTriggerConfigSchema>;
export type AutomationGenerationConfig = z.infer<typeof automationGenerationConfigSchema>;
export type AutomationPublicationConfig = z.infer<typeof automationPublicationConfigSchema>;
export type AutomationLimits = z.infer<typeof automationLimitsSchema>;

/** The frozen, fully-resolved policy an AutomationRun executes against. */
export interface AutomationPolicySnapshot {
  policyId: number;
  policyVersion: number;
  policySpecHash: string;
  name: string;
  triggerType: AutomationTriggerType;
  triggerConfig: AutomationTriggerConfig;
  /** Already validated by `createResearchJobBodySchema` (minus the derived key). */
  researchConfig: Record<string, unknown>;
  targets: RepurposeTargetInput[];
  generationConfig: AutomationGenerationConfig;
  approvalMode: AutomationApprovalMode;
  publicationConfig: AutomationPublicationConfig;
  limits: Required<AutomationLimits>;
}

export interface NormalizedAutomationPolicy {
  name: string;
  status: string;
  triggerType: AutomationTriggerType;
  triggerConfig: AutomationTriggerConfig;
  researchConfig: Record<string, unknown>;
  targets: RepurposeTargetInput[];
  generationConfig: AutomationGenerationConfig;
  approvalMode: AutomationApprovalMode;
  publicationConfig: AutomationPublicationConfig & { mode: "none" | "on_approval" };
  limits: Required<AutomationLimits>;
}

/**
 * Normalize + validate a policy payload. This is the ONLY place that decides
 * whether a policy is acceptable, so the HTTP layer, the manual trigger and the
 * scheduler all see the same rules.
 *
 * Cross-field rules that a shape schema cannot express:
 *   • `scheduled` requires `triggerConfig.startAt`; its recurrence (when given)
 *     must parse under the EXISTING grammar — no second cron language exists.
 *   • `researchConfig` is the existing research request shape, minus the
 *     idempotency key: automation derives that from the run, so every run
 *     researches independently and no policy can pin one ResearchJob forever.
 *   • `publicationConfig.mode: "on_approval"` requires `approvalMode: "trusted"`,
 *     so auto-publishing can never be reached by accident (§13).
 */
export function normalizeAutomationPolicyInput(input: unknown): NormalizedAutomationPolicy {
  const parsed = automationPolicyBaseSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new AutomationPolicyInputError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const body = parsed.data;
  const issues: string[] = [];

  if (body.triggerType === AUTOMATION_TRIGGER_SCHEDULED) {
    if (!body.triggerConfig.startAt) {
      issues.push('triggerConfig.startAt is required for a "scheduled" policy');
    }
  } else if (body.triggerConfig.recurrence || body.triggerConfig.startAt) {
    issues.push('triggerConfig must be empty for a "manual" policy (no schedule exists)');
  }
  if (body.triggerConfig.recurrence) {
    try {
      parseRecurrenceIntervalMs(body.triggerConfig.recurrence);
    } catch (error) {
      issues.push(describeError(error));
    }
  }

  // The existing research contract is the authority on what research means.
  const research = createResearchJobBodySchema.safeParse(body.researchConfig);
  if (!research.success) {
    for (const issue of research.error.issues) {
      issues.push(`researchConfig.${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  } else if (research.data.idempotencyKey !== undefined) {
    issues.push(
      "researchConfig.idempotencyKey must not be set — automation derives it from the run so every run researches independently",
    );
  } else {
    const unknown = research.data.providerIds.filter((id) => !hasProvider(id));
    if (unknown.length > 0) issues.push(`researchConfig.providerIds: unknown provider(s) ${unknown.join(", ")}`);
  }

  for (let index = 0; index < body.targets.length; index += 1) {
    const target = body.targets[index];
    const profile = getFormatProfile(target.format, target.channel);
    if (!profile) {
      issues.push(
        `targets.${index}: no format profile for ${target.format} × ${target.channel} — register one before automating it`,
      );
    }
  }

  if (body.publicationConfig.mode === "on_approval" && body.approvalMode !== "trusted") {
    issues.push(
      'publicationConfig.mode "on_approval" requires approvalMode "trusted" — publishing is never reached implicitly',
    );
  }
  if (body.publicationConfig.recurrence) {
    try {
      parseRecurrenceIntervalMs(body.publicationConfig.recurrence);
    } catch (error) {
      issues.push(`publicationConfig.recurrence: ${describeError(error)}`);
    }
  }

  if (issues.length > 0) throw new AutomationPolicyInputError(issues);

  return {
    name: body.name,
    status: body.status,
    triggerType: body.triggerType,
    triggerConfig: body.triggerConfig,
    researchConfig: body.researchConfig,
    targets: body.targets as RepurposeTargetInput[],
    generationConfig: body.generationConfig,
    approvalMode: body.approvalMode,
    publicationConfig: body.publicationConfig,
    limits: resolveAutomationLimits(body.limits),
  };
}

export function resolveAutomationLimits(limits: unknown): Required<AutomationLimits> {
  const parsed = automationLimitsSchema.safeParse(limits ?? {});
  const value = parsed.success ? parsed.data : {};
  return {
    maxRunsPerDay: value.maxRunsPerDay ?? DEFAULT_AUTOMATION_LIMITS.maxRunsPerDay,
    maxOpportunitiesPerRun: value.maxOpportunitiesPerRun ?? DEFAULT_AUTOMATION_LIMITS.maxOpportunitiesPerRun,
    maxGeneratedArtifactsPerRun:
      value.maxGeneratedArtifactsPerRun ?? DEFAULT_AUTOMATION_LIMITS.maxGeneratedArtifactsPerRun,
  };
}

/**
 * Content-addressed identity of the execution-relevant policy spec. `name` and
 * `status` are deliberately excluded: renaming a policy or pausing it does not
 * change what a run would DO.
 */
export function automationPolicySpecHash(policy: NormalizedAutomationPolicy): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        triggerType: policy.triggerType,
        triggerConfig: policy.triggerConfig,
        researchConfig: policy.researchConfig,
        targets: policy.targets,
        generationConfig: policy.generationConfig,
        approvalMode: policy.approvalMode,
        publicationConfig: policy.publicationConfig,
        limits: policy.limits,
      }),
      "utf8",
    )
    .digest("hex");
}

/** Freeze a policy row into the immutable snapshot an AutomationRun executes. */
export function snapshotAutomationPolicy(policy: AutomationPolicy): AutomationPolicySnapshot {
  return {
    policyId: policy.id,
    policyVersion: policy.version,
    policySpecHash: policy.specHash,
    name: policy.name,
    triggerType: policy.triggerType as AutomationTriggerType,
    triggerConfig: policy.triggerConfig as AutomationTriggerConfig,
    researchConfig: policy.researchConfig as Record<string, unknown>,
    targets: (policy.targets ?? []) as RepurposeTargetInput[],
    generationConfig: policy.generationConfig as AutomationGenerationConfig,
    approvalMode: policy.approvalMode as AutomationApprovalMode,
    publicationConfig: policy.publicationConfig as AutomationPublicationConfig,
    limits: resolveAutomationLimits(policy.limits),
  };
}

// ── deps ──────────────────────────────────────────────────────────────────────
/**
 * The research surface automation needs. Deliberately a *narrow read + enqueue*
 * port: automation can request a ResearchJob and observe its durable state, and
 * has no access to providers, the engine, or execution. The engine itself is
 * reused unchanged through the existing `research.run` worker.
 */
export interface AutomationResearchPort {
  claimJob(input: ClaimJobInput): Promise<ClaimJobResult>;
  getJob(jobId: number): Promise<ResearchJob | undefined>;
  listEvidenceIds(jobId: number): Promise<number[]>;
  getEvidence(jobId: number): Promise<Array<{ id: number; excerpt: string; kind: string }>>;
  enqueueResearchRun(job: ResearchJob): Promise<void>;
}

export interface AutomationDeps {
  automation: AutomationStoragePort;
  content: ContentStoragePort;
  stories: StoryStoragePort;
  research: AutomationResearchPort;
  /** Phase 12's batch primitive, already wired to the same content/generation deps. */
  repurpose: RepurposeDeps;
  enqueueGeneration: (job: GenerationJob) => Promise<boolean>;
  /**
   * Enqueue the `automation.run` worker for one durable run — the ONLY way an
   * advance is scheduled. Mirrors `enqueuePublication`: the tick materializes
   * and enqueues, the worker executes. Nothing is ever advanced inline by a
   * request handler.
   */
  enqueueAutomationRun: (run: AutomationRun) => Promise<boolean>;
}

// ── policy service ────────────────────────────────────────────────────────────
export async function createAutomationPolicy(
  ownerId: number,
  input: unknown,
  deps: AutomationDeps,
): Promise<AutomationPolicy> {
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    throw new AutomationPolicyInputError(["ownerId must be a positive integer"]);
  }
  const normalized = normalizeAutomationPolicyInput(input);
  return deps.automation.insertAutomationPolicy({
    userId: ownerId,
    name: normalized.name,
    status: normalized.status,
    version: 1,
    specHash: automationPolicySpecHash(normalized),
    triggerType: normalized.triggerType,
    triggerConfig: normalized.triggerConfig as JsonRecord,
    researchConfig: normalized.researchConfig,
    targets: normalized.targets,
    generationConfig: normalized.generationConfig as JsonRecord,
    approvalMode: normalized.approvalMode,
    publicationConfig: normalized.publicationConfig as JsonRecord,
    limits: normalized.limits,
  });
}

/**
 * Mutate an owner-scoped policy. The current row is merged with the patch,
 * re-normalized as a WHOLE (so a patch can never produce an invalid policy) and
 * persisted as a NEW revision: `version` always advances, even when only the
 * name changed, because a policy edit is itself the revision boundary a
 * subsequent run must be able to name (§5/§20). Existing runs are untouched —
 * they hold their own frozen snapshot.
 */
export async function updateAutomationPolicy(
  policyId: number,
  ownerId: number,
  patch: Record<string, unknown>,
  deps: AutomationDeps,
): Promise<AutomationPolicy> {
  const existing = await deps.automation.getAutomationPolicyForOwner(policyId, ownerId);
  if (!existing) throw new AutomationPolicyNotFoundError(policyId);

  const merged = {
    name: patch.name ?? existing.name,
    status: patch.status ?? existing.status,
    triggerType: patch.triggerType ?? existing.triggerType,
    triggerConfig: patch.triggerConfig ?? existing.triggerConfig,
    researchConfig: patch.researchConfig ?? existing.researchConfig,
    targets: patch.targets ?? existing.targets,
    generationConfig: patch.generationConfig ?? existing.generationConfig,
    approvalMode: patch.approvalMode ?? existing.approvalMode,
    publicationConfig: patch.publicationConfig ?? existing.publicationConfig,
    limits: patch.limits ?? existing.limits,
  };
  const normalized = normalizeAutomationPolicyInput(merged);

  const updated = await deps.automation.updateAutomationPolicy(existing.id, {
    name: normalized.name,
    status: normalized.status,
    version: existing.version + 1,
    specHash: automationPolicySpecHash(normalized),
    triggerType: normalized.triggerType,
    triggerConfig: normalized.triggerConfig as JsonRecord,
    researchConfig: normalized.researchConfig,
    targets: normalized.targets,
    generationConfig: normalized.generationConfig as JsonRecord,
    approvalMode: normalized.approvalMode,
    publicationConfig: normalized.publicationConfig as JsonRecord,
    limits: normalized.limits,
  });
  if (!updated) throw new AutomationPolicyNotFoundError(policyId);
  return updated;
}

// ── trigger identity ──────────────────────────────────────────────────────────
/**
 * The durable identity of one logical trigger slot. Two scheduled ticks landing
 * on the same slot, or two manual requests carrying the same `requestKey`,
 * produce the SAME key and therefore exactly ONE run — enforced by
 * `automation_runs_idempotency_key_unique`, never by an application lock.
 *
 * `regenerationNonce` is the documented escape hatch, mirroring Phase 12's
 * `regenerate`: an explicit rerun produces a genuinely new run without
 * poisoning the base logical key for future ordinary duplicate delivery.
 */
export function automationRunIdempotencyKey(
  policyId: number,
  triggerType: AutomationTriggerType,
  triggerIdentity: string,
  regenerationNonce?: string | null,
): string {
  const base = `automation:${triggerType}:${policyId}:${triggerIdentity}`;
  const key = regenerationNonce ? `${base}:rerun:${regenerationNonce}` : base;
  return key.length > 300 ? `${key.slice(0, 260)}:${createHash("sha256").update(key).digest("hex").slice(0, 32)}` : key;
}

/** Deterministic ResearchJob identity for a run → research can never duplicate (§18). */
export function automationResearchIdempotencyKey(runId: number): string {
  return `automation:run:${runId}:research`;
}

/**
 * Queue-level dedup identity for ONE STEP of one run.
 *
 * The logical unit of work is the `(run, step)` pair — not the run — so two
 * ticks observing the same unfinished run schedule no redundant work, while a
 * run that has moved on to its next step is enqueued immediately instead of
 * waiting out a dedup window. The authoritative arbiter is still the durable
 * run row plus its single-flight lease; this only decides what is worth
 * scheduling.
 */
export function automationRunStepKey(runId: number, step: AutomationStep): string {
  return `automation:run:${runId}:${step}`;
}

/**
 * The most recent slot at or before `now` for a scheduled policy, or null when
 * none is due yet. `recurrence` reuses the EXISTING `every:<n><unit>` grammar —
 * there is no second cron language and no RRULE parser.
 *
 * Missed slots are deliberately not backfilled: a policy is not a backfill
 * engine, so an app that was offline for a week runs its most recent slot once
 * rather than firing a week of runs.
 */
export function dueAutomationSlot(policy: AutomationPolicy, now: Date): Date | null {
  const config = (policy.triggerConfig ?? {}) as AutomationTriggerConfig;
  if (!config.startAt) return null;
  const start = new Date(config.startAt);
  if (Number.isNaN(start.getTime())) return null;
  if (start.getTime() > now.getTime()) return null;
  if (!config.recurrence) return start;

  let intervalMs: number;
  try {
    intervalMs = parseRecurrenceIntervalMs(config.recurrence);
  } catch {
    return null;
  }
  const slotIndex = Math.floor((now.getTime() - start.getTime()) / intervalMs);
  return new Date(start.getTime() + slotIndex * intervalMs);
}

// ── run creation ──────────────────────────────────────────────────────────────
export interface CreateAutomationRunInput {
  policy: AutomationPolicy;
  triggerType: AutomationTriggerType;
  /** The logical trigger identity: a manual requestKey, or a slot's ISO instant. */
  triggerIdentity: string;
  regenerationNonce?: string | null;
  deps: AutomationDeps;
}

export interface CreatedAutomationRun {
  run: AutomationRun;
  created: boolean;
}

/**
 * Create (or idempotently reuse) the run for one logical trigger slot.
 *
 * Limits are enforced durably BEFORE the claim. Because a scheduled policy's
 * slot identity is deterministic, two ticks for the same slot collapse on the
 * unique key, so the daily cap cannot be raced by the real scheduler.
 */
export async function createAutomationRun(
  input: CreateAutomationRunInput,
): Promise<CreatedAutomationRun> {
  const { policy, triggerType, triggerIdentity, regenerationNonce, deps } = input;
  if (policy.userId === null) {
    throw new AutomationPolicyInputError([`automation policy ${policy.id} has no owner`]);
  }

  const limits = resolveAutomationLimits(policy.limits);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await deps.automation.countAutomationRunsSince(policy.id, since);
  if (recent >= limits.maxRunsPerDay) {
    throw new AutomationLimitError(policy.id, "maxRunsPerDay", limits.maxRunsPerDay, recent);
  }

  const snapshot = snapshotAutomationPolicy(policy);
  const row: InsertAutomationRunRow = {
    userId: policy.userId,
    policyId: policy.id,
    policyVersion: policy.version,
    policySpecHash: policy.specHash,
    policySnapshot: snapshot as unknown as JsonRecord,
    triggerType,
    idempotencyKey: automationRunIdempotencyKey(
      policy.id,
      triggerType,
      triggerIdentity,
      regenerationNonce,
    ),
    correlationId: randomUUID(),
  };
  return deps.automation.claimAutomationRun(row);
}

/**
 * Explicit, owner-scoped manual trigger. `requestKey` gives durable duplicate
 * collapse; `rerun: true` is a deliberate new execution (a fresh nonce) and
 * never poisons the base key — the same contract chat-to-post and Phase 12's
 * repurposing already established.
 *
 * The run is persisted and then ENQUEUED, never executed inline: the HTTP layer
 * only creates durable intent, exactly as `POST /api/research/jobs` does.
 */
export async function triggerAutomationPolicy(
  policyId: number,
  ownerId: number,
  body: { requestKey?: string; rerun?: boolean },
  deps: AutomationDeps,
): Promise<CreatedAutomationRun & { enqueued: boolean }> {
  const policy = await deps.automation.getAutomationPolicyForOwner(policyId, ownerId);
  if (!policy) throw new AutomationPolicyNotFoundError(policyId);
  if (policy.status !== "active") throw new AutomationPolicyInactiveError(policyId, policy.status);

  const requestKey = body.requestKey?.trim();
  const identity = requestKey && requestKey.length > 0 ? requestKey : `manual:${randomUUID()}`;
  const nonce = body.rerun ? randomUUID() : null;

  const { run, created } = await createAutomationRun({
    policy,
    triggerType: AUTOMATION_TRIGGER_MANUAL,
    triggerIdentity: identity,
    regenerationNonce: nonce,
    deps,
  });

  let enqueued = false;
  if (!isTerminalRunStatus(run.status)) {
    enqueued = await deps.enqueueAutomationRun(run);
  }
  return { run: (await deps.automation.getAutomationRun(run.id)) ?? run, created, enqueued };
}

// ── step machine ──────────────────────────────────────────────────────────────
export type AutomationStep = "research" | "story" | "fanout" | "settle";

/**
 * The next step is DERIVED from durable state, never stored as a cursor — the
 * same discipline Phase 4 applied to recurrence. A crashed advance therefore
 * resumes from exactly the right place with no reconciliation bookkeeping.
 */
export function deriveAutomationStep(run: AutomationRun, hasStory: boolean): AutomationStep {
  if (run.researchJobId === null) return "research";
  if (!hasStory) return "story";
  if (((run.outcomes ?? []) as unknown[]).length === 0) return "fanout";
  return "settle";
}

/** The step a run is on right now, read from durable state (never a stored cursor). */
export async function currentAutomationStep(
  run: AutomationRun,
  stories: Pick<StoryStoragePort, "getStoryByAutomationRun">,
): Promise<AutomationStep> {
  const story = await stories.getStoryByAutomationRun(run.id);
  return deriveAutomationStep(run, story !== undefined);
}

export interface AutomationAdvanceResult {
  runId: number;
  advanced: boolean;
  step?: AutomationStep;
  reason?: "not_found" | "terminal" | "leased" | "waiting" | "retryable" | "failed" | "settled";
  failureClass?: string;
  failureMessage?: string;
  status?: AutomationRunStatus;
}

/**
 * Advance a run by AT MOST ONE bounded step.
 *
 * Concurrency: the single-flight lease (`advance_lease_expires_at`) means of two
 * overlapping ticks — or a tick racing the `automation.run` worker — exactly one
 * proceeds; a crashed holder is reclaimed when the lease expires, so recovery
 * needs no in-memory state.
 *
 * Failure semantics (§15) are classified by the existing `JobFailure` taxonomy:
 *   • recoverable (transient / rate_limited) → the run stays in its intermediate
 *     state with the failure recorded, and the next tick retries the SAME step;
 *   • permanent → the run fails and no further state is fabricated;
 *   • approval blocked → NOT a failure; the run reaches `awaiting_approval`;
 *   • unknown external side effects → untouched here; they remain the
 *     Publication/reconciliation concern.
 */
export async function advanceAutomationRun(
  runId: number,
  deps: AutomationDeps,
): Promise<AutomationAdvanceResult> {
  const existing = await deps.automation.getAutomationRun(runId);
  if (!existing) return { runId, advanced: false, reason: "not_found" };
  if (isTerminalRunStatus(existing.status)) {
    return { runId, advanced: false, reason: "terminal", status: existing.status as AutomationRunStatus };
  }

  const run = await deps.automation.acquireAutomationRunLease(runId, AUTOMATION_ADVANCE_LEASE_MS);
  if (!run) return { runId, advanced: false, reason: "leased" };

  let step: AutomationStep | undefined;
  try {
    step = await currentAutomationStep(run, deps.stories);
    const outcome =
      step === "research"
        ? await runResearchStep(run, deps)
        : step === "story"
          ? await runStoryStep(run, deps)
          : step === "fanout"
            ? await runFanoutStep(run, deps)
            : await runSettleStep(run, deps);
    const latest = (await deps.automation.getAutomationRun(run.id)) ?? run;
    return {
      runId,
      advanced: !outcome.waiting,
      step,
      reason: outcome.waiting ? "waiting" : "settled",
      status: latest.status as AutomationRunStatus,
    };
  } catch (error) {
    return await failOrDefer(run, step, error, deps);
  } finally {
    await deps.automation.releaseAutomationRunLease(run.id);
  }
}

async function failOrDefer(
  run: AutomationRun,
  step: AutomationStep | undefined,
  error: unknown,
  deps: AutomationDeps,
): Promise<AutomationAdvanceResult> {
  const failureClass = classifyError(error);
  const message = describeError(error);

  const recoverable = failureClass === "transient" || failureClass === "rate_limited";
  if (recoverable && run.attempt < MAX_AUTOMATION_ATTEMPTS) {
    // Recoverable: keep every durable artifact of this run and retry later.
    await deps.automation.patchAutomationRun(run.id, { errorClass: failureClass, errorMessage: message });
    return {
      runId: run.id,
      advanced: false,
      step,
      reason: "retryable",
      failureClass,
      failureMessage: message,
    };
  }

  const terminalClass = recoverable ? "permanent" : failureClass;
  const detail = recoverable
    ? `${message} (gave up after ${run.attempt} attempt(s))`
    : message;
  await deps.automation.patchAutomationRun(run.id, {
    status: "failed",
    errorClass: terminalClass,
    errorMessage: detail,
    finishedAt: new Date(),
  });
  return {
    runId: run.id,
    advanced: false,
    step,
    reason: "failed",
    failureClass: terminalClass,
    failureMessage: detail,
    status: "failed",
  };
}

interface StepOutcome {
  waiting: boolean;
}

// ── step 1: research ──────────────────────────────────────────────────────────
/**
 * Create the run's ResearchJob and enqueue the EXISTING `research.run` worker.
 *
 * The job's idempotency key is derived from the run id, so duplicate delivery,
 * a worker retry or a re-advance after a crash can only ever produce ONE
 * ResearchJob — the database's UNIQUE constraint is the arbiter (§18).
 * Automation never runs research: it enqueues and observes.
 */
async function runResearchStep(run: AutomationRun, deps: AutomationDeps): Promise<StepOutcome> {
  const snapshot = run.policySnapshot as unknown as AutomationPolicySnapshot;
  const config = snapshot.researchConfig as {
    kind?: "directed" | "autonomous" | "human_input";
    query?: string;
    authorStatement?: string;
    providerIds?: string[];
    limit?: number;
    window?: unknown;
    budget?: unknown;
    providerConfig?: Record<string, Record<string, unknown>>;
  };

  const { job } = await deps.research.claimJob({
    correlationId: run.correlationId,
    idempotencyKey: automationResearchIdempotencyKey(run.id),
    kind: config.kind ?? "directed",
    query: config.query ?? null,
    providerIds: config.providerIds ?? ["rss"],
    userId: run.userId,
    initiation: {
      kind: config.kind ?? "directed",
      query: config.query ?? null,
      limit: config.limit ?? null,
      window: config.window ?? null,
      budget: config.budget ?? null,
      authorStatement: config.authorStatement ?? null,
      providerConfig: config.providerConfig ?? null,
      // Provenance: which automation run asked for this research.
      automationRunId: run.id,
    },
  });

  if (run.researchJobId !== job.id) {
    await deps.automation.patchAutomationRun(run.id, { researchJobId: job.id });
  }

  if (job.status !== "complete") {
    try {
      await deps.research.enqueueResearchRun(job);
    } catch (error) {
      throw JobFailure.transient(`research queue unavailable: ${describeError(error)}`);
    }
  }
  return { waiting: false };
}

// ── step 2: story ─────────────────────────────────────────────────────────────
/**
 * Derive the run's Story once the ResearchJob is complete, through the EXISTING
 * `createStoryFromResearch`. While research is still in flight this is not a
 * failure — the run simply stays in its durable intermediate state.
 *
 * The synthesis is DETERMINISTIC (policy name + research query + bounded
 * evidence excerpts). No AI client is reachable from this module, so automation
 * introduces no second model seam; model-written synthesis is an explicit
 * deferral, not a hidden call.
 */
async function runStoryStep(run: AutomationRun, deps: AutomationDeps): Promise<StepOutcome> {
  const researchJobId = run.researchJobId;
  if (researchJobId === null) throw JobFailure.permanent("automation run has no ResearchJob");

  const job = await deps.research.getJob(researchJobId);
  if (!job) throw JobFailure.permanent(`ResearchJob ${researchJobId} not found`);
  if (job.status === "queued" || job.status === "running") return { waiting: true };
  if (job.status !== "complete") {
    throw classifyResearchFailure(job);
  }

  const evidence = await deps.research.getEvidence(job.id);
  if (evidence.length === 0) {
    throw JobFailure.permanent(`ResearchJob ${job.id} produced no usable research output (no evidence)`);
  }

  const snapshot = run.policySnapshot as unknown as AutomationPolicySnapshot;
  await createStoryFromResearch(
    job.id,
    synthesizeStory(snapshot, job, evidence),
    {
      stories: deps.stories,
      research: {
        getJob: (id) => deps.research.getJob(id),
        listEvidenceIds: (id) => deps.research.listEvidenceIds(id),
      },
    },
    { automationRunId: run.id },
  );
  return { waiting: false };
}

function classifyResearchFailure(job: ResearchJob): JobFailure {
  const message = job.errorMessage ?? `ResearchJob ${job.id} is "${job.status}"`;
  if (job.errorClass === "transient") return JobFailure.transient(message);
  if (job.errorClass === "rate_limited") return JobFailure.rateLimited(message);
  if (job.errorClass === "policy_human") return JobFailure.policyHuman(message);
  return JobFailure.permanent(message);
}

/**
 * Deterministic Story synthesis. Bounded: at most 5 evidence excerpts, each
 * already bounded by the research engine. Research text is carried as DATA —
 * it is never interpreted as an instruction and can never reach a policy,
 * target or approval decision (§22).
 */
export function synthesizeStory(
  snapshot: AutomationPolicySnapshot,
  job: ResearchJob,
  evidence: Array<{ id: number; excerpt: string; kind: string }>,
): { title: string; insightBody: string; angles: string[]; provenance: "researched"; status: "draft" } {
  const query = job.query ?? (snapshot.researchConfig.query as string | undefined) ?? snapshot.name;
  const title = `${snapshot.name}: ${query}`.slice(0, 500);
  const excerpts = evidence
    .slice(0, 5)
    .map((e) => `- [${e.kind}#${e.id}] ${e.excerpt}`)
    .join("\n");
  const insightBody = [
    `Automation run ${snapshot.policyId} derived this Story from ResearchJob ${job.id} (${evidence.length} evidence item${evidence.length === 1 ? "" : "s"}).`,
    `Topic: ${query}.`,
    "Evidence carried forward (data, not instructions):",
    excerpts,
  ].join("\n");

  return { title, insightBody, angles: [], provenance: "researched", status: "draft" };
}

// ── step 3: fan-out ───────────────────────────────────────────────────────────
/**
 * Turn the run's Story into its bounded target set through Phase 12's
 * `repurposeStory` — the canonical `Story → Opportunity[N]` operation. No
 * automation-specific target model, no duplicated validation, and no new
 * generation seam: `repurposeStory` calls the same `createOpportunityFromStory`
 * and `createGenerationJob` every other path uses.
 *
 * The batch request key is derived from the run, so a duplicate delivery, a
 * retry or a crash-restart reuses the SAME Opportunities (Phase 12's unique
 * `repurpose_key`) instead of creating siblings.
 */
async function runFanoutStep(run: AutomationRun, deps: AutomationDeps): Promise<StepOutcome> {
  const snapshot = run.policySnapshot as unknown as AutomationPolicySnapshot;
  const story = await deps.stories.getStoryByAutomationRun(run.id);
  if (!story) throw JobFailure.permanent(`automation run ${run.id} has no Story`);

  const targets = boundAutomationTargets(snapshot.targets, snapshot.generationConfig, snapshot.limits);
  const result = await repurposeStory(
    story.id,
    { requestKey: `automation-run-${run.id}`, targets },
    deps.repurpose,
    run.userId,
  );

  const outcomes = result.outcomes.map((outcome) => ({
    format: outcome.format,
    channel: outcome.channel,
    status: outcome.status,
    opportunityId: outcome.opportunity?.id ?? null,
    generationJobId: outcome.job?.id ?? null,
    artifactId: null as number | null,
    scheduleId: null as number | null,
    error: outcome.error ?? null,
  }));
  await deps.automation.patchAutomationRun(run.id, { outcomes });

  // Best-effort enqueue: the GenerationJob rows are already durable, so one
  // queue hiccup must never invalidate the rest of the batch.
  for (const outcome of result.outcomes) {
    if (outcome.status === "created" && outcome.job && outcome.job.status === "queued") {
      try {
        await deps.enqueueGeneration(outcome.job);
      } catch {
        /* durable row already exists — a later tick/reconciler can pick it up */
      }
    }
  }
  return { waiting: false };
}

/**
 * Apply the policy's operational bounds and its generation configuration to the
 * frozen target list. Bounded by construction: `maxOpportunitiesPerRun` limits
 * how many targets are attempted at all, and `maxGeneratedArtifactsPerRun`
 * limits how many of those actually produce content. Excess targets are not
 * dropped silently — they become opportunity-only, which is visible in the
 * run's outcomes.
 */
export function boundAutomationTargets(
  targets: RepurposeTargetInput[],
  generationConfig: AutomationGenerationConfig,
  limits: Required<AutomationLimits>,
): RepurposeTargetInput[] {
  let generated = 0;
  return targets.slice(0, limits.maxOpportunitiesPerRun).map((target) => {
    const merged: RepurposeTargetInput = {
      ...target,
      ...(generationConfig.objective && !target.objective ? { objective: generationConfig.objective } : {}),
      ...(generationConfig.audience && !target.audience ? { audience: generationConfig.audience } : {}),
      ...(generationConfig.model && !target.model ? { model: generationConfig.model } : {}),
      ...(generationConfig.constraints && !target.constraints ? { constraints: generationConfig.constraints } : {}),
      ...(generationConfig.voiceId != null && target.voiceId == null ? { voiceId: generationConfig.voiceId } : {}),
      ...(generationConfig.templateId != null && target.templateId == null
        ? { templateId: generationConfig.templateId }
        : {}),
    };
    if (merged.generate === false) return merged;
    generated += 1;
    return generated > limits.maxGeneratedArtifactsPerRun ? { ...merged, generate: false } : merged;
  });
}

// ── step 4: settle ────────────────────────────────────────────────────────────
interface TargetOutcome {
  format: string;
  channel: string;
  status: string;
  opportunityId: number | null;
  generationJobId: number | null;
  artifactId: number | null;
  scheduleId: number | null;
  error: string | null;
}

/**
 * Bring the run to a terminal, HONEST state.
 *
 * Partial success is first-class (§16): each target's outcome is recorded
 * independently and a failing sibling never rolls back work that already
 * succeeded. Approval is an explicit boundary (§12): with
 * `approvalMode: "approval_required"` the run stops at `awaiting_approval` and
 * automation makes NO publication decision. Only a policy that explicitly
 * declared `trusted` moves artifacts through the Artifact model's OWN
 * documented transitions, and only `publicationConfig.mode: "on_approval"`
 * creates a Schedule — still via the existing `createSchedule`, so publishing
 * continues to flow through Occurrence → Publication → Result.
 */
async function runSettleStep(run: AutomationRun, deps: AutomationDeps): Promise<StepOutcome> {
  const snapshot = run.policySnapshot as unknown as AutomationPolicySnapshot;
  const previous = (run.outcomes ?? []) as TargetOutcome[];

  const outcomes: TargetOutcome[] = [];
  let pending = 0;
  let succeeded = 0;
  let failedOrInvalid = 0;

  for (const outcome of previous) {
    if (outcome.status === "invalid" || outcome.opportunityId === null) {
      failedOrInvalid += 1;
      outcomes.push(outcome);
      continue;
    }
    if (outcome.generationJobId === null) {
      // Opportunity-only target: the policy asked for no content here.
      succeeded += 1;
      outcomes.push(outcome);
      continue;
    }

    const job = await deps.content.getGenerationJob(outcome.generationJobId);
    if (!job) {
      failedOrInvalid += 1;
      outcomes.push({ ...outcome, status: "failed", error: "generation job no longer exists" });
      continue;
    }
    if (job.status === "queued" || job.status === "running") {
      pending += 1;
      outcomes.push(outcome);
      continue;
    }

    const artifact = await deps.content.getArtifactByGenerationJob(job.id);
    if (job.status === "succeeded" && artifact) {
      succeeded += 1;
      outcomes.push({ ...outcome, artifactId: artifact.id, error: null });
    } else {
      failedOrInvalid += 1;
      outcomes.push({
        ...outcome,
        status: "failed",
        error: job.errorMessage ?? `generation ${job.status}`,
      });
    }
  }

  if (pending > 0) {
    // Not a failure: the run stays durably here and the next tick re-settles.
    await deps.automation.patchAutomationRun(run.id, { outcomes });
    return { waiting: true };
  }

  const wantsArtifacts = outcomes.some((o) => o.generationJobId !== null);
  const trusted = snapshot.approvalMode === "trusted";

  if (trusted) {
    for (const outcome of outcomes) {
      if (outcome.artifactId === null) continue;
      outcome.scheduleId = await settleTrustedArtifact(outcome.artifactId, snapshot, deps);
    }
  }

  await deps.automation.patchAutomationRun(run.id, {
    outcomes,
    status:
      failedOrInvalid === outcomes.length
        ? "failed"
        : failedOrInvalid > 0
          ? "partial"
          : !wantsArtifacts || trusted
            ? "completed"
            : "awaiting_approval",
    errorClass: failedOrInvalid === outcomes.length ? "permanent" : null,
    errorMessage:
      failedOrInvalid === outcomes.length ? "no automation target produced content" : null,
    finishedAt: new Date(),
  });
  return { waiting: false };
}

/**
 * Trusted-mode approval. Uses ONLY the Artifact model's documented transitions
 * (`draft → in_review → approved`); there is no hidden approval state and no
 * bypass flag. Idempotent: an artifact already approved is left alone, and a
 * Schedule is only created when the policy asked for one and none exists yet.
 */
async function settleTrustedArtifact(
  artifactId: number,
  snapshot: AutomationPolicySnapshot,
  deps: AutomationDeps,
): Promise<number | null> {
  let artifact: Artifact | undefined = await deps.content.getArtifact(artifactId);
  if (!artifact) return null;

  if (artifact.readiness === "draft") {
    artifact = await submitArtifactForReview(artifactId, { artifacts: deps.content });
  }
  if (artifact.readiness === "in_review") {
    try {
      artifact = await approveArtifact(artifactId, { artifacts: deps.content });
    } catch (error) {
      if (!(error instanceof ArtifactStateError)) throw error;
      artifact = await deps.content.getArtifact(artifactId);
    }
  }
  if (!artifact || artifact.readiness !== "approved") return null;

  if (snapshot.publicationConfig.mode !== "on_approval") return null;
  const existing = await deps.content.listSchedulesByArtifact(artifact.id);
  if (existing.length > 0) return existing[0].id;

  const schedule = await createSchedule(
    artifact.id,
    {
      ...(snapshot.publicationConfig.startAt ? { startAt: snapshot.publicationConfig.startAt } : {}),
      ...(snapshot.publicationConfig.recurrence ? { recurrence: snapshot.publicationConfig.recurrence } : {}),
      ...(snapshot.publicationConfig.count ? { count: snapshot.publicationConfig.count } : {}),
    },
    { content: deps.content },
  );
  return schedule.id;
}

// ── driver ────────────────────────────────────────────────────────────────────
export interface ScheduledAutomationDispatchResult {
  considered: number;
  created: number;
  deduplicated: number;
  limited: number;
}

/**
 * Create runs for every scheduled policy whose current slot is due. The slot's
 * absolute instant is the trigger identity, so the unique key — not this loop —
 * guarantees one run per slot no matter how many ticks overlap (§8).
 */
export async function dispatchScheduledAutomationPolicies(
  now: Date,
  deps: AutomationDeps,
  limit = 25,
): Promise<ScheduledAutomationDispatchResult> {
  const result: ScheduledAutomationDispatchResult = {
    considered: 0,
    created: 0,
    deduplicated: 0,
    limited: 0,
  };
  const policies = await deps.automation.listActiveScheduledPolicies(limit);
  for (const policy of policies) {
    const slot = dueAutomationSlot(policy, now);
    if (!slot) continue;
    result.considered += 1;
    try {
      const { created } = await createAutomationRun({
        policy,
        triggerType: AUTOMATION_TRIGGER_SCHEDULED,
        triggerIdentity: slot.toISOString(),
        deps,
      });
      if (created) result.created += 1;
      else result.deduplicated += 1;
    } catch (error) {
      if (error instanceof AutomationLimitError) {
        result.limited += 1;
        continue;
      }
      throw error;
    }
  }
  return result;
}

export interface AutomationDispatchResult {
  scheduled: ScheduledAutomationDispatchResult;
  /** Unfinished runs whose advance job was enqueued on this tick. */
  enqueued: number;
  runIds: number[];
}

/**
 * One automation tick: create runs for due scheduled policies, then enqueue the
 * `automation.run` worker for every run whose orchestration is unfinished.
 *
 * This mirrors `dispatchDueOccurrences` exactly — the tick MATERIALIZES and
 * ENQUEUES, it never executes — and reuses the existing scheduler architecture
 * (§7): it is driven by the same periodic content-scheduler cron the occurrence
 * dispatcher already runs on, and is exposed over HTTP for deterministic
 * operator/test triggering. No second cron framework, and no second scheduling
 * table (the run's unique trigger key is the slot arbiter).
 *
 * Re-enqueueing an unfinished run every tick IS the recovery mechanism: a
 * crashed or deferred advance is simply re-delivered, and the single-flight
 * lease plus the derived-step design make every step idempotent.
 */
export async function dispatchAutomationDueRuns(
  now: Date,
  deps: AutomationDeps,
  limit = 25,
): Promise<AutomationDispatchResult> {
  const scheduled = await dispatchScheduledAutomationPolicies(now, deps, limit);
  const runs = await deps.automation.listAdvanceableAutomationRuns(limit);
  const result: AutomationDispatchResult = { scheduled, enqueued: 0, runIds: [] };
  for (const run of runs) {
    const enqueued = await deps.enqueueAutomationRun(run);
    if (enqueued) result.enqueued += 1;
    result.runIds.push(run.id);
  }
  return result;
}

// ── observability (§25/§33) ───────────────────────────────────────────────────
export interface AutomationRunArtifactSummary {
  artifactId: number;
  readiness: string;
  scheduleId: number | null;
  publicationId: number | null;
  publicationState: string | null;
  resultOutcome: string | null;
}

export interface AutomationRunSummary {
  runId: number;
  status: AutomationRunStatus;
  policyVersion: number;
  triggerType: string;
  triggerIdentity: string;
  researchJobId: number | null;
  storyId: number | null;
  artifacts: AutomationRunArtifactSummary[];
  awaitingApproval: number;
  published: number;
  unknown: number;
  failed: number;
}

/**
 * Derive the downstream picture from durable references — the entities remain
 * the source of truth, so this is a read, never a second state machine. It is
 * exactly what a future notification layer needs to say "run awaiting approval"
 * / "run completed" / "publication unknown" (§25) without a telemetry system.
 */
export async function summarizeAutomationRun(
  run: AutomationRun,
  deps: AutomationDeps,
): Promise<AutomationRunSummary> {
  const story = await deps.stories.getStoryByAutomationRun(run.id);
  const outcomes = (run.outcomes ?? []) as TargetOutcome[];
  const artifacts: AutomationRunArtifactSummary[] = [];
  let awaitingApproval = 0;
  let published = 0;
  let unknown = 0;
  let failed = 0;

  for (const outcome of outcomes) {
    if (outcome.artifactId === null) continue;
    const artifact = await deps.content.getArtifact(outcome.artifactId);
    if (!artifact) continue;

    const schedules = await deps.content.listSchedulesByArtifact(artifact.id);
    const scheduleId = schedules[0]?.id ?? outcome.scheduleId ?? null;
    const publications =
      scheduleId === null || !deps.content.listPublicationsBySchedule
        ? []
        : await deps.content.listPublicationsBySchedule(scheduleId);
    const publication = publications[0];
    const result = publication ? await deps.content.getResultByPublication(publication.id) : undefined;

    if (artifact.readiness !== "approved") awaitingApproval += 1;
    if (publication?.state === "failed" && publication.providerCalled) unknown += 1;
    if (result?.outcome === "published") published += 1;
    if (result?.outcome === "failed") failed += 1;

    artifacts.push({
      artifactId: artifact.id,
      readiness: artifact.readiness,
      scheduleId,
      publicationId: publication?.id ?? null,
      publicationState: publication?.state ?? null,
      resultOutcome: result?.outcome ?? null,
    });
  }

  return {
    runId: run.id,
    status: run.status as AutomationRunStatus,
    policyVersion: run.policyVersion,
    triggerType: run.triggerType,
    triggerIdentity: run.idempotencyKey,
    researchJobId: run.researchJobId,
    storyId: story?.id ?? null,
    artifacts,
    awaitingApproval,
    published,
    unknown,
    failed,
  };
}

export type { RepurposeDeps, RepurposeTargetInput };
