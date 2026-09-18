/**
 * Content API: the minimum HTTP surface for the core lifecycle.
 *
 *   Story → Opportunity → GenerationJob → Artifact → (approval)
 *         → Schedule → Occurrence → Publication → Result
 *
 * The HTTP layer persists intent and enqueues long-running work; it never runs
 * generation or publication inline.
 */

import { Router } from "express";
import { z } from "zod";
import type {
  Artifact,
  ContentTemplate,
  GenerationJob,
  GenerationPolicy,
  Opportunity,
  Publication,
  Schedule,
  VisualAsset,
  VisualGeneration,
  Voice,
} from "@shared/schema";
import { getUserId } from "../middleware/userContext";
import type { ContentStoragePort } from "./storage";
import {
  createOpportunityFromStory,
  killOpportunity,
  selectOpportunity,
  InvalidOpportunityInputError,
  OpportunityNotFoundError,
  OpportunityStateError,
  StoryNotFoundError,
  StoryNotUsableError,
  type OpportunityDeps,
} from "./opportunity";
import {
  createGenerationJob,
  loadGenerationContext,
  OpportunityKilledError,
  StoryMissingForOpportunityError,
  type GenerationDeps,
} from "./generation";
import {
  cancelRepurposingPlan,
  inspectRepurposingPlan,
  MAX_COUNT_PER_TARGET,
  MAX_OPPORTUNITIES_PER_PLAN,
  MAX_TARGETS_PER_PLAN,
  repurposeStory,
  RepurposeInputError,
  RepurposingPlanNotFoundError,
} from "./repurposing";
import {
  approveArtifact,
  createArtifact,
  createHumanEditRevision,
  getArtifactHistory,
  rejectArtifact,
  submitArtifactForReview,
  ArtifactMediaReferenceError,
  ArtifactNotFoundError,
  ArtifactStateError,
  InvalidArtifactPayloadError,
} from "./artifact";
import {
  archiveTemplate,
  archiveVoice,
  AuthoringInputError,
  createTemplate,
  createVoice,
  listTemplateRevisions,
  listVoiceRevisions,
  reviseTemplate,
  reviseVoice,
} from "./authoring";
import {
  createSchedule,
  dispatchDueOccurrences,
  ArtifactNotSchedulableError,
  ScheduleInputError,
} from "./scheduling";
import { publishArtifactToChannels, DistributionInputError } from "./distribution";
import { reconcileUnknownPublications } from "./publication";
import { assembleContext } from "./context";
import { requestStyleAnalysis, activateStyleProfile, publicReference, publicStyleProfile, ReferenceNotFoundError, StyleServiceInputError, StyleProfileNotFoundError } from "./styleService";
import { listChannelAdapters } from "./adapters";
import { listFormatProfiles } from "./formatProfiles";
import {
  createVisualGeneration,
  VisualServiceInputError,
} from "./visualService";
import {
  createLocalAssetStorage,
  InvalidVisualInputError,
  VisualCapabilityUnsupportedError,
  VisualModelUnsupportedError,
} from "./visual";
import {
  ChatInputError,
  ChatStoryNotFoundError,
  handleChatRequest,
  type ChatDeps,
} from "./chat";
import {
  PolicyInputError,
  TemplateFormatMismatchError,
  TemplateNotFoundError,
  VoiceNotFoundError,
} from "./policy";

export interface ContentApiDeps {
  content: ContentStoragePort;
  opportunities: OpportunityDeps;
  generation: GenerationDeps;
  chat: ChatDeps;
  /** Byte store for visuals (local impl in tests; application wires its own). */
  visualStorage: import("./visual").AssetStoragePort;
  enqueueGeneration: (job: GenerationJob) => Promise<boolean>;
  enqueuePublication: (publication: Publication) => Promise<boolean>;
  enqueueVisual: (generation: VisualGeneration) => Promise<boolean>;
  /** Optional so existing test doubles that build `ContentApiDeps` by hand are unaffected. */
  style?: import("./styleService").StyleServiceDeps;
  enqueueStyleAnalysis?: (analysis: import("@shared/schema").StyleAnalysis) => Promise<boolean>;
  learning?: import("./learning/record").LearningRecorder;
}

// ── serializers ───────────────────────────────────────────────────────────────
const serializeGenerationPolicy = (p: GenerationPolicy) => ({
  id: p.id,
  policyKey: p.policyKey,
  version: p.version,
  name: p.name,
  format: p.format,
  channel: p.channel,
  voiceId: p.voiceId,
  templateId: p.templateId,
  objective: p.objective,
  audience: p.audience,
  constraints: p.constraints,
  modelPreferences: p.modelPreferences,
  specHash: p.specHash,
  status: p.status,
  createdAt: p.createdAt,
});

const serializeVoice = (v: Voice) => ({
  id: v.id,
  voiceKey: v.voiceKey,
  version: v.version,
  name: v.name,
  description: v.description,
  tone: v.tone,
  vocabulary: v.vocabulary,
  sentenceStyle: v.sentenceStyle,
  formatting: v.formatting,
  doRules: v.doRules,
  dontRules: v.dontRules,
  examples: v.examples,
  status: v.status,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
});

const serializeTemplate = (t: ContentTemplate) => ({
  id: t.id,
  templateKey: t.templateKey,
  version: t.version,
  name: t.name,
  description: t.description,
  supportedFormats: t.supportedFormats,
  supportedChannels: t.supportedChannels,
  structure: t.structure,
  variables: t.variables,
  constraints: t.constraints,
  instructions: t.instructions,
  status: t.status,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

const serializeVisualGeneration = (g: VisualGeneration) => ({
  id: g.id,
  kind: g.kind,
  providerId: g.providerId,
  capability: g.capability,
  status: g.status,
  attempt: g.attempt,
  opportunityId: g.opportunityId,
  generationJobId: g.generationJobId,
  errorClass: g.errorClass,
  errorMessage: g.errorMessage,
  correlationId: g.correlationId,
  variationCount: g.variationCount,
  specId: g.specId,
  sourceVisualAssetId: g.sourceVisualAssetId,
  startedAt: g.startedAt,
  finishedAt: g.finishedAt,
  createdAt: g.createdAt,
});

const serializeVisualAsset = (a: VisualAsset) => ({
  id: a.id,
  kind: a.kind,
  mime: a.mime,
  width: a.width,
  height: a.height,
  byteSize: a.byteSize,
  durationMs: a.durationMs,
  container: a.container,
  codec: a.codec,
  frameRate: a.frameRate,
  contentHash: a.contentHash,
  altText: a.altText,
  caption: a.caption,
  role: a.role,
  supersedesId: a.supersedesId,
  provenance: a.provenance,
  status: a.status,
  visualGenerationId: a.visualGenerationId,
  position: a.position,
  createdAt: a.createdAt,
});

const serializeOpportunity = (o: Opportunity) => ({
  id: o.id,
  storyId: o.storyId,
  concept: o.concept,
  objective: o.objective,
  audience: o.audience,
  angle: o.angle,
  format: o.format,
  channel: o.channel,
  status: o.status,
  score: o.score,
  proposer: o.proposer,
  killReason: o.killReason,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
});

const serializeGenerationJob = (j: GenerationJob) => ({
  id: j.id,
  opportunityId: j.opportunityId,
  format: j.format,
  channel: j.channel,
  status: j.status,
  attempt: j.attempt,
  /** The exact immutable policy revision this attempt used. */
  policyId: j.policyId,
  model: j.model,
  provider: j.provider,
  policySnapshot: j.policySnapshot,
  correlationId: j.correlationId,
  errorClass: j.errorClass,
  errorMessage: j.errorMessage,
  startedAt: j.startedAt,
  finishedAt: j.finishedAt,
  createdAt: j.createdAt,
});

const serializeArtifact = (a: Artifact) => ({
  id: a.id,
  generationJobId: a.generationJobId,
  opportunityId: a.opportunityId,
  format: a.format,
  channel: a.channel,
  payload: a.payload,
  readiness: a.readiness,
  approvedAt: a.approvedAt,
  supersedesId: a.supersedesId,
  provenance: a.provenance,
  attribution: a.attribution,
  attributionReason: a.attributionReason,
  createdAt: a.createdAt,
});

const serializeSchedule = (s: Schedule) => ({
  id: s.id,
  artifactId: s.artifactId,
  channel: s.channel,
  intentKey: s.intentKey,
  recurrence: s.recurrence,
  timezone: s.timezone,
  count: s.count,
  startAt: s.startAt,
  status: s.status,
  createdAt: s.createdAt,
});

const serializePublication = (p: Publication) => ({
  id: p.id,
  scheduleId: p.scheduleId,
  occurrenceId: p.occurrenceId,
  artifactId: p.artifactId,
  channel: p.channel,
  state: p.state,
  attempt: p.attempt,
  providerCalled: p.providerCalled,
  externalId: p.externalId,
  lastError: p.lastError,
  correlationId: p.correlationId,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

// ── request schemas ───────────────────────────────────────────────────────────
const createOpportunityBody = z.object({
  storyId: z.number().int().positive(),
  concept: z.string().trim().min(1).max(2000),
  objective: z.string().trim().min(1).max(2000),
  format: z.string().trim().min(1).max(50),
  channel: z.string().trim().min(1).max(50),
  audience: z.string().trim().min(1).max(2000).optional(),
  angle: z.string().trim().min(1).max(2000).optional(),
  proposer: z.enum(["human", "autonomous"]).default("human"),
  score: z.number().optional(),
  scoreBreakdown: z.record(z.unknown()).optional(),
});

const createGenerationBody = z.object({
  opportunityId: z.number().int().positive(),
  voiceId: z.number().int().positive().nullable().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  objective: z.string().trim().min(1).max(2000).optional(),
  audience: z.string().trim().min(1).max(2000).optional(),
  constraints: z.record(z.unknown()).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  priorArtifactId: z.number().int().positive().optional(),
  rejectionReason: z.string().trim().min(1).max(2000).optional(),
  /** Intentional regeneration → a new job/revision (see §21). */
  regenerate: z.boolean().optional(),
});

const repurposeTargetBody = z.object({
  format: z.string().trim().min(1).max(50),
  channel: z.string().trim().min(1).max(50),
  concept: z.string().trim().min(1).max(2000).optional(),
  objective: z.string().trim().min(1).max(2000).optional(),
  audience: z.string().trim().min(1).max(2000).optional(),
  angle: z.string().trim().min(1).max(2000).optional(),
  /** Opportunity only, no GenerationJob for this target. Default: generate. */
  generate: z.boolean().optional(),
  voiceId: z.number().int().positive().nullable().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  constraints: z.record(z.unknown()).optional(),
  /** Intentional new derivation for THIS target — bypasses reuse-by-key. */
  regenerate: z.boolean().optional(),
  count: z.number().int().min(1).max(MAX_COUNT_PER_TARGET).optional(),
});

const repurposeStoryBody = z.object({
  requestKey: z.string().trim().min(1).max(200).optional(),
  targets: z.array(repurposeTargetBody).min(1).max(MAX_TARGETS_PER_PLAN),
  limits: z
    .object({
      maxTargetsPerPlan: z.number().int().min(1).max(MAX_TARGETS_PER_PLAN).optional(),
      maxCountPerTarget: z.number().int().min(1).max(MAX_COUNT_PER_TARGET).optional(),
      maxOpportunities: z.number().int().min(1).max(MAX_OPPORTUNITIES_PER_PLAN).optional(),
    })
    .optional(),
});

const reviseArtifactBody = z.object({
  /** The exact revision the client edited — guards against a stale base. */
  baseArtifactId: z.number().int().positive(),
  payload: z.record(z.unknown()),
  attributionReason: z.string().trim().min(1).max(500).optional(),
});

/**
 * Format-driven Artifact authoring (Ticket 07 §media contract). `format` and
 * `channel` are never taken from the request — they are the Opportunity's own,
 * exactly as generation already does — so this route can never create an
 * Artifact whose (format, channel) pair was not already validated at
 * Opportunity creation.
 */
const createArtifactBody = z.object({
  payload: z.record(z.unknown()),
  attribution: z.array(z.unknown()).optional(),
  attributionReason: z.string().trim().min(1).max(500).optional(),
});

const createVoiceBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  tone: z.string().trim().max(200).optional(),
  vocabulary: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  sentenceStyle: z.string().trim().max(200).optional(),
  formatting: z.record(z.unknown()).optional(),
  doRules: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  dontRules: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  examples: z.array(z.unknown()).max(20).optional(),
});

const createTemplateBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  supportedFormats: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  supportedChannels: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  structure: z.array(z.unknown()).max(50).optional(),
  variables: z.array(z.unknown()).max(50).optional(),
  constraints: z.record(z.unknown()).optional(),
  instructions: z.string().trim().max(4000).optional(),
});

const createScheduleBody = z.object({
  artifactId: z.number().int().positive(),
  startAt: z.string().datetime().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  count: z.number().int().positive().max(1000).optional(),
  recurrence: z.string().trim().min(1).max(200).optional(),
  /** Optional channel override; omitted → Artifact.channel (legacy). Never an intentKey. */
  channel: z.string().trim().min(1).max(50).optional(),
});

const publishArtifactBody = z.object({
  targets: z
    .array(
      z.object({
        channel: z.string().trim().min(1).max(50),
        startAt: z.string().datetime().optional(),
        timezone: z.string().trim().min(1).max(64).optional(),
        count: z.number().int().positive().max(1000).optional(),
        recurrence: z.string().trim().min(1).max(200).optional(),
        republishKey: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(20),
  republishKey: z.string().trim().min(1).max(100).optional(),
});

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function message(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  return null;
}

function planDeps(deps: ContentApiDeps) {
  return {
    opportunities: deps.opportunities,
    generation: deps.generation,
    plans: deps.content as import("./repurposing").RepurposingPlanPort,
  };
}

export function createContentRouter(deps: ContentApiDeps): Router {
  const router = Router();

  // ── Opportunities ───────────────────────────────────────────────────────────
  router.post("/opportunities", async (req, res, next) => {
    try {
      const body = createOpportunityBody.parse(req.body ?? {});
      const { storyId, ...rest } = body;
      const opportunity = await createOpportunityFromStory(storyId, rest, deps.opportunities);
      return res.status(201).json(serializeOpportunity(opportunity));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof InvalidOpportunityInputError) return res.status(400).json({ message: error.message });
      if (error instanceof StoryNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof StoryNotUsableError) return res.status(409).json({ message: error.message });
      return next(error);
    }
  });

  /**
   * Repurposing (Phase 12): one existing Story -> N independently addressable
   * Opportunities, each optionally carried straight through to a queued
   * GenerationJob. Never touches research or a SourceProvider -- only the
   * Story's already-durable evidence is read, through the same
   * `createGenerationJob` path every other Opportunity already uses.
   *
   * Partial success by design: an invalid target is reported as such (207)
   * without rolling back its valid siblings.
   */
  router.post("/stories/:id/repurpose", async (req, res, next) => {
    const storyId = parseId(req.params.id);
    if (storyId === null) return res.status(400).json({ message: "Invalid story id" });
    try {
      const body = repurposeStoryBody.parse(req.body ?? {});
      const result = await repurposeStory(
        storyId,
        body,
        planDeps(deps),
        getUserId(req) ?? 1,
      );

      for (const outcome of result.outcomes) {
        if (outcome.job && outcome.job.status === "queued") {
          try {
            await deps.enqueueGeneration(outcome.job);
          } catch {
            // Best-effort: the GenerationJob row is already durable; a later
            // retry/backfill can still pick it up. One target's queue hiccup
            // must never invalidate the rest of the batch.
          }
        }
      }

      return res.status(207).json({
        storyId: result.storyId,
        planId: result.plan?.id ?? null,
        plan: result.plan
          ? {
              id: result.plan.id,
              status: result.plan.status,
              requestKey: result.plan.requestKey,
              planVersion: result.plan.planVersion,
            }
          : null,
        progress: result.progress,
        outcomes: result.outcomes.map((o) => ({
          format: o.format,
          channel: o.channel,
          slot: o.slot,
          status: o.status,
          opportunityId: o.opportunity?.id ?? null,
          generationJobId: o.job?.id ?? null,
          error: o.error ?? null,
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof RepurposeInputError) return res.status(400).json({ message: error.message });
      if (error instanceof StoryNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof StoryNotUsableError) return res.status(409).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/repurposing/capabilities", async (_req, res) => {
    return res.json({
      formats: listFormatProfiles().map((profile) => ({
        format: profile.format,
        channel: profile.channel,
        visual: profile.constraints.visual ?? "none",
      })),
      limits: {
        maxTargetsPerPlan: MAX_TARGETS_PER_PLAN,
        maxCountPerTarget: MAX_COUNT_PER_TARGET,
        maxOpportunities: MAX_OPPORTUNITIES_PER_PLAN,
      },
    });
  });

  router.get("/repurposing/plans/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid plan id" });
    try {
      const view = await inspectRepurposingPlan(
        id,
        planDeps(deps),
        getUserId(req) ?? 1,
      );
      return res.json({
        id: view.plan.id,
        storyId: view.plan.storyId,
        status: view.plan.status,
        requestKey: view.plan.requestKey,
        planVersion: view.plan.planVersion,
        progress: view.progress,
        snapshot: view.plan.snapshot,
        outcomes: view.outcomes.map((o) => ({
          format: o.format,
          channel: o.channel,
          slot: o.slot,
          status: o.status,
          opportunityId: o.opportunity?.id ?? null,
          generationJobId: o.job?.id ?? null,
          error: o.error ?? null,
        })),
        createdAt: view.plan.createdAt,
        completedAt: view.plan.completedAt,
      });
    } catch (error) {
      if (error instanceof RepurposingPlanNotFoundError) return res.status(404).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/repurposing/plans/:id/opportunities", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid plan id" });
    try {
      const view = await inspectRepurposingPlan(
        id,
        planDeps(deps),
        getUserId(req) ?? 1,
      );
      return res.json(
        view.outcomes
          .filter((o) => o.opportunity)
          .map((o) => serializeOpportunity(o.opportunity!)),
      );
    } catch (error) {
      if (error instanceof RepurposingPlanNotFoundError) return res.status(404).json({ message: error.message });
      return next(error);
    }
  });

  router.post("/repurposing/plans/:id/cancel", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid plan id" });
    try {
      const plan = await cancelRepurposingPlan(
        id,
        planDeps(deps),
        getUserId(req) ?? 1,
      );
      return res.json({ id: plan.id, status: plan.status, storyId: plan.storyId });
    } catch (error) {
      if (error instanceof RepurposingPlanNotFoundError) return res.status(404).json({ message: error.message });
      return next(error);
    }
  });

  router.post("/repurposing/plans/:id/run", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid plan id" });
    try {
      const view = await inspectRepurposingPlan(
        id,
        planDeps(deps),
        getUserId(req) ?? 1,
      );
      const snapshot = view.plan.snapshot as { targets?: unknown };
      const targets = Array.isArray(snapshot.targets) ? snapshot.targets : [];
      const result = await repurposeStory(
        view.plan.storyId,
        { requestKey: view.plan.requestKey, targets: targets as Array<{ format: string; channel: string }> },
        planDeps(deps),
        getUserId(req) ?? 1,
      );
      for (const outcome of result.outcomes) {
        if (outcome.job && outcome.job.status === "queued") {
          try {
            await deps.enqueueGeneration(outcome.job);
          } catch {
            /* durable row already exists */
          }
        }
      }
      return res.status(207).json({
        storyId: result.storyId,
        planId: result.plan?.id ?? view.plan.id,
        progress: result.progress,
        outcomes: result.outcomes.map((o) => ({
          format: o.format,
          channel: o.channel,
          slot: o.slot,
          status: o.status,
          opportunityId: o.opportunity?.id ?? null,
          generationJobId: o.job?.id ?? null,
          error: o.error ?? null,
        })),
      });
    } catch (error) {
      if (error instanceof RepurposingPlanNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof RepurposeInputError) return res.status(400).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/opportunities/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid opportunity id" });
    try {
      const opportunity = await deps.content.getOpportunity(id);
      if (!opportunity) return res.status(404).json({ message: "Opportunity not found" });
      return res.json(serializeOpportunity(opportunity));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/opportunities", async (req, res, next) => {
    const storyId = parseId(req.query.storyId);
    if (storyId === null) return res.status(400).json({ message: "storyId query parameter is required" });
    try {
      const rows = await deps.content.listOpportunitiesByStory(storyId);
      return res.json(rows.map(serializeOpportunity));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/opportunities/:id/select", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid opportunity id" });
    try {
      return res.json(serializeOpportunity(await selectOpportunity(id, deps.opportunities)));
    } catch (error) {
      message(error);
      if (error instanceof OpportunityNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof OpportunityStateError) return res.status(409).json({ message: error.message });
      return next(error);
    }
  });

  router.post("/opportunities/:id/kill", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid opportunity id" });
    const killReason = typeof req.body?.killReason === "string" ? req.body.killReason : "";
    try {
      return res.json(serializeOpportunity(await killOpportunity(id, killReason, deps.opportunities)));
    } catch (error) {
      if (error instanceof InvalidOpportunityInputError) return res.status(400).json({ message: error.message });
      if (error instanceof OpportunityNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof OpportunityStateError) return res.status(409).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/opportunities/:id/artifacts", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid opportunity id" });
    try {
      const rows = await deps.content.listArtifactsByOpportunity(id);
      return res.json(rows.map(serializeArtifact));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Author a draft Artifact under this Opportunity. Format-driven: the same
   * route handles `x_post`, `linkedin_post`, `image`, `thumbnail`, and any
   * future registered format, because `format`/`channel` come from the
   * Opportunity (already validated against the adapter registry at Opportunity
   * creation) and `payload` is validated against that format's registered
   * schema — never a second, format-specific endpoint or business path.
   */
  router.post("/opportunities/:id/artifacts", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid opportunity id" });
    try {
      const body = createArtifactBody.parse(req.body ?? {});
      const opportunity = await deps.content.getOpportunity(id);
      if (!opportunity) return res.status(404).json({ message: "Opportunity not found" });
      const artifact = await createArtifact(
        {
          userId: getUserId(req) ?? 1,
          generationJobId: null,
          opportunityId: opportunity.id,
          format: opportunity.format,
          channel: opportunity.channel,
          payload: body.payload,
          provenance: "human_edit",
          attribution: body.attribution,
          attributionReason: body.attributionReason ?? null,
        },
        { artifacts: deps.content },
      );
      return res.status(201).json(serializeArtifact(artifact));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof InvalidArtifactPayloadError) return res.status(422).json({ message: error.message });
      if (error instanceof ArtifactMediaReferenceError) {
        const notFound = /not found/.test(error.message);
        return res.status(notFound ? 404 : 409).json({ message: error.message });
      }
      return next(error);
    }
  });

  // ── GenerationJobs ──────────────────────────────────────────────────────────
  router.post("/generation-jobs", async (req, res, next) => {
    try {
      const body = createGenerationBody.parse(req.body ?? {});
      const { opportunityId, ...options } = body;
      const { job, created } = await createGenerationJob(opportunityId, options, deps.generation);

      if (job.status === "queued") {
        try {
          await deps.enqueueGeneration(job);
        } catch (error) {
          return res.status(503).json({
            message: "Generation queue unavailable",
            id: job.id,
            correlationId: job.correlationId,
            detail: message(error),
          });
        }
      }
      return res.status(created ? 201 : 200).json(serializeGenerationJob(job));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof OpportunityNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof OpportunityKilledError) return res.status(409).json({ message: error.message });
      if (error instanceof StoryMissingForOpportunityError) return res.status(409).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/generation-jobs/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid generation job id" });
    try {
      const job = await deps.content.getGenerationJob(id);
      if (!job) return res.status(404).json({ message: "Generation job not found" });
      const artifact = await deps.content.getArtifactByGenerationJob(job.id);
      return res.json({ ...serializeGenerationJob(job), artifactId: artifact?.id ?? null });
    } catch (error) {
      return next(error);
    }
  });

  // ── Artifacts + approval ────────────────────────────────────────────────────
  router.get("/artifacts/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid artifact id" });
    try {
      const artifact = await deps.content.getArtifact(id);
      if (!artifact) return res.status(404).json({ message: "Artifact not found" });
      return res.json(serializeArtifact(artifact));
    } catch (error) {
      return next(error);
    }
  });

  for (const [action, handler] of [
    ["submit-review", submitArtifactForReview],
    ["approve", approveArtifact],
    ["reject", rejectArtifact],
  ] as const) {
    router.post(`/artifacts/:id/${action}`, async (req, res, next) => {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid artifact id" });
      try {
        const artifact = await handler(id, { artifacts: deps.content, learning: deps.learning });
        return res.json(serializeArtifact(artifact));
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) return res.status(404).json({ message: error.message });
        if (error instanceof ArtifactStateError) return res.status(409).json({ message: error.message });
        if (error instanceof InvalidArtifactPayloadError) return res.status(422).json({ message: error.message });
        return next(error);
      }
    });
  }

  // ── Artifact revisions (human editing) ──────────────────────────────────────
  /** Full revision chain for an artifact's Opportunity, oldest first. */
  router.get("/artifacts/:id/history", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid artifact id" });
    try {
      const chain = await getArtifactHistory(id, { artifacts: deps.content });
      return res.json(chain.map(serializeArtifact));
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) return res.status(404).json({ message: error.message });
      return next(error);
    }
  });

  /**
   * Human edit → a NEW revision. The prior revision is never mutated and the new
   * one starts at `draft` (no inherited approval).
   */
  router.post("/artifacts/:id/revise", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid artifact id" });
    try {
      const body = reviseArtifactBody.parse(req.body ?? {});
      if (body.baseArtifactId !== id) {
        return res.status(409).json({
          message: `stale revision: baseArtifactId ${body.baseArtifactId} does not match artifact ${id}`,
        });
      }
      const artifact = await createHumanEditRevision(
        id,
        body.payload,
        { artifacts: deps.content, learning: deps.learning },
        { attributionReason: body.attributionReason ?? null },
      );
      return res.status(201).json(serializeArtifact(artifact));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof ArtifactNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof InvalidArtifactPayloadError) return res.status(422).json({ message: error.message });
      return next(error);
    }
  });

  /**
   * One Artifact revision → N independent Publications (Phase 16).
   * Creates durable Schedule (+ due Publication) intent per target; never
   * publishes inline. Duplicate deliveries reuse logical identity; pass
   * `republishKey` for an explicit new Publication.
   */
  router.post("/artifacts/:id/publications", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid artifact id" });
    try {
      const body = publishArtifactBody.parse(req.body ?? {});
      const result = await publishArtifactToChannels(
        id,
        body,
        {
          content: deps.content,
          enqueuePublication: deps.enqueuePublication,
        },
        getUserId(req) ?? 1,
      );
      return res.status(207).json({
        artifactId: result.artifactId,
        outcomes: result.outcomes.map((o) => ({
          channel: o.channel,
          status: o.status,
          scheduleId: o.schedule?.id ?? null,
          publicationId: o.publication?.id ?? null,
          created: o.created ?? false,
          error: o.error ?? null,
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof DistributionInputError) return res.status(400).json({ message: error.message });
      if (error instanceof ArtifactNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof ArtifactNotSchedulableError) return res.status(409).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/artifacts/:id/publications", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid artifact id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const artifact = await deps.content.getArtifactForOwner(id, ownerId);
      if (!artifact) return res.status(404).json({ message: "Artifact not found" });
      const rows = await deps.content.listPublicationsByArtifact(id);
      const owned = rows.filter((p) => p.userId === null || p.userId === ownerId);
      return res.json(owned.map(serializePublication));
    } catch (error) {
      return next(error);
    }
  });

  // ── Schedules ───────────────────────────────────────────────────────────────
  router.post("/schedules", async (req, res, next) => {
    try {
      const body = createScheduleBody.parse(req.body ?? {});
      const { artifactId, ...options } = body;
      const schedule = await createSchedule(artifactId, options, { content: deps.content });
      return res.status(201).json(serializeSchedule(schedule));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof ScheduleInputError) return res.status(400).json({ message: error.message });
      if (error instanceof ArtifactNotSchedulableError) return res.status(409).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/schedules/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid schedule id" });
    try {
      const schedule = await deps.content.getSchedule(id);
      if (!schedule) return res.status(404).json({ message: "Schedule not found" });
      return res.json(serializeSchedule(schedule));
    } catch (error) {
      return next(error);
    }
  });

  // ── Scheduler tick + publications ───────────────────────────────────────────
  /** One scheduler tick: materialize due occurrences and enqueue publications. */
  router.post("/publications/dispatch", async (_req, res, next) => {
    try {
      const now = new Date();
      const result = await dispatchDueOccurrences(
        now,
        { content: deps.content, enqueuePublication: deps.enqueuePublication },
        100,
      );
      // Real provider-side reconciliation for Publications parked as `unknown`
      // (see `reconcileUnknownPublications`). Reused here so tests/operators
      // have a deterministic manual trigger identical to the periodic tick.
      const reconciled = await reconcileUnknownPublications(
        now,
        { content: deps.content, enqueuePublication: deps.enqueuePublication },
        100,
      );
      return res.json({
        materialized: result.materialized,
        enqueued: result.enqueued,
        publications: result.publications.map(serializePublication),
        reconciled,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/publications/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid publication id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const publication = await deps.content.getPublication(id);
      if (!publication || (publication.userId !== null && publication.userId !== ownerId)) {
        return res.status(404).json({ message: "Publication not found" });
      }
      const result = await deps.content.getResultByPublication(id);
      return res.json({ ...serializePublication(publication), result: result ?? null });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/publications/:id/result", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid publication id" });
    try {
      const result = await deps.content.getResultByPublication(id);
      if (!result) return res.status(404).json({ message: "Result not found" });
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  });

  /** Registered channels (so the API can explain what can actually publish). */
  router.get("/channels", (_req, res) => {
    return res.json({ channels: listChannelAdapters().map((a) => a.channel).sort() });
  });

  // ── Voices ──────────────────────────────────────────────────────────────────
  router.post("/voices", async (req, res, next) => {
    try {
      const body = createVoiceBody.parse(req.body ?? {});
      const voice = await createVoice(getUserId(req) ?? 1, body, { content: deps.content });
      return res.status(201).json(serializeVoice(voice));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof AuthoringInputError) return res.status(400).json({ message: error.message });
      return next(error);
    }
  });

  /** Create the next revision under the same key; the prior revision is untouched. */
  router.post("/voices/:id/revise", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid voice id" });
    try {
      const voice = await reviseVoice(id, req.body ?? {}, { content: deps.content });
      return res.status(201).json(serializeVoice(voice));
    } catch (error) {
      if (error instanceof AuthoringInputError) return res.status(400).json({ message: error.message });
      if (error instanceof VoiceNotFoundError) return res.status(404).json({ message: error.message });
      return next(error);
    }
  });

  router.post("/voices/:id/archive", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid voice id" });
    try {
      const archived = await archiveVoice(id, { content: deps.content });
      return res.json(serializeVoice(archived));
    } catch (error) {
      if (error instanceof VoiceNotFoundError) return res.status(404).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/voices/:id/revisions", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid voice id" });
    try {
      const voice = await deps.content.getVoice(id);
      if (!voice) return res.status(404).json({ message: "Voice not found" });
      const revisions = await listVoiceRevisions(voice.voiceKey ?? `voice:${voice.id}`, { content: deps.content });
      return res.json(revisions.map(serializeVoice));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/voices", async (_req, res, next) => {
    try {
      return res.json((await deps.content.listVoices()).map(serializeVoice));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/voices/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid voice id" });
    try {
      const voice = await deps.content.getVoice(id);
      if (!voice) return res.status(404).json({ message: "Voice not found" });
      return res.json(serializeVoice(voice));
    } catch (error) {
      return next(error);
    }
  });

  // ── Templates ───────────────────────────────────────────────────────────────
  router.post("/templates", async (req, res, next) => {
    try {
      const body = createTemplateBody.parse(req.body ?? {});
      const template = await createTemplate(getUserId(req) ?? 1, body, { content: deps.content });
      return res.status(201).json(serializeTemplate(template));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof AuthoringInputError) return res.status(400).json({ message: error.message });
      return next(error);
    }
  });

  /** Create the next revision under the same key; the prior revision is untouched. */
  router.post("/templates/:id/revise", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid template id" });
    try {
      const template = await reviseTemplate(id, req.body ?? {}, { content: deps.content });
      return res.status(201).json(serializeTemplate(template));
    } catch (error) {
      if (error instanceof AuthoringInputError) return res.status(400).json({ message: error.message });
      if (error instanceof TemplateNotFoundError) return res.status(404).json({ message: error.message });
      return next(error);
    }
  });

  router.post("/templates/:id/archive", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid template id" });
    try {
      const archived = await archiveTemplate(id, { content: deps.content });
      return res.json(serializeTemplate(archived));
    } catch (error) {
      if (error instanceof TemplateNotFoundError) return res.status(404).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/templates/:id/revisions", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid template id" });
    try {
      const template = await deps.content.getContentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      const revisions = await listTemplateRevisions(
        template.templateKey ?? `tpl:${template.id}`,
        { content: deps.content },
      );
      return res.json(revisions.map(serializeTemplate));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/templates", async (_req, res, next) => {
    try {
      return res.json((await deps.content.listContentTemplates()).map(serializeTemplate));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/templates/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid template id" });
    try {
      const template = await deps.content.getContentTemplate(id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      return res.json(serializeTemplate(template));
    } catch (error) {
      return next(error);
    }
  });

  // ── Generation policies (immutable, content-addressed revisions) ─────────────
  router.get("/generation-policies", async (_req, res, next) => {
    try {
      return res.json((await deps.content.listGenerationPolicies()).map(serializeGenerationPolicy));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/generation-policies/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid policy id" });
    try {
      const policy = await deps.content.getGenerationPolicy(id);
      if (!policy) return res.status(404).json({ message: "Generation policy not found" });
      return res.json(serializeGenerationPolicy(policy));
    } catch (error) {
      return next(error);
    }
  });

  // ── Chat-to-post ────────────────────────────────────────────────────────────
  router.post("/generation/chat", async (req, res, next) => {
    try {
      const result = await handleChatRequest(getUserId(req) ?? 1, req.body ?? {}, deps.chat);
      if (result.generationJobId !== null) {
        const job = await deps.content.getGenerationJob(result.generationJobId);
        if (job && job.status === "queued") {
          try {
            await deps.enqueueGeneration(job);
          } catch (error) {
            return res.status(503).json({
              message: "Generation queue unavailable",
              opportunityId: result.opportunity.id,
              generationJobId: job.id,
              detail: message(error),
            });
          }
        }
      }
      return res.status(201).json({
        storyId: result.storyId,
        storyCreated: result.storyCreated,
        reused: result.reused,
        opportunity: serializeOpportunity(result.opportunity),
        generationJobId: result.generationJobId,
        correlationId: result.correlationId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof ChatInputError) return res.status(400).json({ message: error.message });
      if (error instanceof ChatStoryNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof PolicyInputError) return res.status(400).json({ message: error.message });
      if (error instanceof VoiceNotFoundError || error instanceof TemplateNotFoundError) {
        return res.status(404).json({ message: error.message });
      }
      if (error instanceof TemplateFormatMismatchError) return res.status(409).json({ message: error.message });
      return next(error);
    }
  });

  // ── Visual generations ──────────────────────────────────────────────────────
  /** Enqueue a durable visual generation; the worker produces the asset. */
  router.post("/visual-generations", async (req, res, next) => {
    try {
      const { generation, created } = await createVisualGeneration(
        getUserId(req) ?? 1,
        req.body ?? {},
        { content: deps.content, storage: deps.visualStorage, contextReader: deps.generation.contextReader },
      );
      if (generation.status === "requested") {
        try {
          await deps.enqueueVisual(generation);
        } catch (error) {
          return res.status(503).json({
            message: "Visual queue unavailable",
            id: generation.id,
            correlationId: generation.correlationId,
            detail: message(error),
          });
        }
      }
      return res.status(created ? 201 : 200).json(serializeVisualGeneration(generation));
    } catch (error) {
      if (error instanceof VisualServiceInputError || error instanceof InvalidVisualInputError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof VisualCapabilityUnsupportedError || error instanceof VisualModelUnsupportedError) {
        return res.status(409).json({ message: error.message });
      }
      return next(error);
    }
  });

  router.get("/visual-generations/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid visual generation id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const generation = await deps.content.getVisualGeneration(id);
      if (!generation || (generation.userId !== null && generation.userId !== ownerId)) {
        return res.status(404).json({ message: "Visual generation not found" });
      }
      const assets = await deps.content.listVisualAssetsForGeneration(generation.id);
      const owned = assets.filter((a) => a.userId === null || a.userId === ownerId);
      return res.json({
        ...serializeVisualGeneration(generation),
        visualAssetId: owned[0]?.id ?? null,
        assets: owned.map(serializeVisualAsset),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/visual-assets/:id/refine", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid visual asset id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const source = await deps.content.getVisualAsset(id);
      if (!source || (source.userId !== null && source.userId !== ownerId)) {
        return res.status(404).json({ message: "Visual asset not found" });
      }
      const instruction = typeof req.body?.instruction === "string" ? req.body.instruction : "";
      const { generation, created } = await createVisualGeneration(
        ownerId,
        {
          kind: source.kind === "thumbnail" ? "thumbnail" : "image",
          providerId: (req.body?.providerId as string | undefined) ?? "local-fixture",
          capability: "refine_image",
          intent: { subject: "refinement", instruction },
          sourceVisualAssetId: source.id,
          instruction,
          regenerate: true,
        },
        { content: deps.content, storage: deps.visualStorage, contextReader: deps.generation.contextReader },
      );
      if (generation.status === "requested") {
        try {
          await deps.enqueueVisual(generation);
        } catch (error) {
          return res.status(503).json({
            message: "Visual queue unavailable",
            id: generation.id,
            correlationId: generation.correlationId,
            detail: message(error),
          });
        }
      }
      return res.status(created ? 201 : 200).json(serializeVisualGeneration(generation));
    } catch (error) {
      if (error instanceof VisualServiceInputError || error instanceof InvalidVisualInputError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof VisualCapabilityUnsupportedError || error instanceof VisualModelUnsupportedError) {
        return res.status(409).json({ message: error.message });
      }
      return next(error);
    }
  });

  // ── Visual assets ───────────────────────────────────────────────────────────
  /**
   * Provider-facing, token-scoped media fetch. No session. The token is a
   * time-bounded grant for one storage key — not a directory listing.
   */
  router.get("/provider-media/:token", async (req, res, next) => {
    try {
      const token = String(req.params.token ?? "");
      if (!/^[a-f0-9]{48}$/i.test(token) || !deps.visualStorage.getProviderGrant) {
        return res.status(404).json({ message: "Media grant not found" });
      }
      const grant = deps.visualStorage.getProviderGrant(token);
      if (!grant) return res.status(404).json({ message: "Media grant not found" });
      res.setHeader("Content-Type", grant.mime);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).end(grant.bytes);
    } catch (error) {
      return next(error);
    }
  });

  /** Owner-scoped listing. */
  router.get("/visual-assets", async (req, res, next) => {
    const requested = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 50;
    try {
      const assets = await deps.content.listVisualAssets(getUserId(req) ?? 1, limit);
      return res.json(assets.map(serializeVisualAsset));
    } catch (error) {
      return next(error);
    }
  });

  /** Owner-scoped read. */
  router.get("/visual-assets/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid visual asset id" });
    try {
      const asset = await deps.content.getVisualAsset(id);
      if (!asset || asset.userId !== null && asset.userId !== (getUserId(req) ?? 1)) {
        return res.status(404).json({ message: "Visual asset not found" });
      }
      return res.json(serializeVisualAsset(asset));
    } catch (error) {
      return next(error);
    }
  });

  // ── Video generations (Phase 19) — same VisualGeneration table, kind=video ──
  router.post("/video-generations", async (req, res, next) => {
    try {
      const { generation, created } = await createVisualGeneration(
        getUserId(req) ?? 1,
        { ...(req.body ?? {}), kind: "video" },
        { content: deps.content, storage: deps.visualStorage, contextReader: deps.generation.contextReader },
      );
      if (generation.status === "requested") {
        try {
          await deps.enqueueVisual(generation);
        } catch (error) {
          return res.status(503).json({
            message: "Visual queue unavailable",
            id: generation.id,
            correlationId: generation.correlationId,
            detail: message(error),
          });
        }
      }
      return res.status(created ? 201 : 200).json(serializeVisualGeneration(generation));
    } catch (error) {
      if (error instanceof VisualServiceInputError || error instanceof InvalidVisualInputError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof VisualCapabilityUnsupportedError || error instanceof VisualModelUnsupportedError) {
        return res.status(409).json({ message: error.message });
      }
      return next(error);
    }
  });

  router.get("/video-generations/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid video generation id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const generation = await deps.content.getVisualGeneration(id);
      if (
        !generation ||
        generation.kind !== "video" ||
        (generation.userId !== null && generation.userId !== ownerId)
      ) {
        return res.status(404).json({ message: "Video generation not found" });
      }
      const assets = await deps.content.listVisualAssetsForGeneration(generation.id);
      const owned = assets.filter((a) => a.userId === null || a.userId === ownerId);
      return res.json({
        ...serializeVisualGeneration(generation),
        visualAssetId: owned[0]?.id ?? null,
        assets: owned.map(serializeVisualAsset),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/video-assets/:id/refine", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid video asset id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const source = await deps.content.getVisualAsset(id);
      if (
        !source ||
        source.kind !== "video" ||
        (source.userId !== null && source.userId !== ownerId)
      ) {
        return res.status(404).json({ message: "Video asset not found" });
      }
      const instruction = typeof req.body?.instruction === "string" ? req.body.instruction : "";
      const { generation, created } = await createVisualGeneration(
        ownerId,
        {
          kind: "video",
          providerId: (req.body?.providerId as string | undefined) ?? "local-video-fixture",
          capability: "refine_video",
          intent: { subject: "refinement", instruction },
          sourceVisualAssetId: source.id,
          instruction,
          regenerate: true,
        },
        { content: deps.content, storage: deps.visualStorage, contextReader: deps.generation.contextReader },
      );
      if (generation.status === "requested") {
        try {
          await deps.enqueueVisual(generation);
        } catch (error) {
          return res.status(503).json({
            message: "Visual queue unavailable",
            id: generation.id,
            correlationId: generation.correlationId,
            detail: message(error),
          });
        }
      }
      return res.status(created ? 201 : 200).json(serializeVisualGeneration(generation));
    } catch (error) {
      if (error instanceof VisualServiceInputError || error instanceof InvalidVisualInputError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof VisualCapabilityUnsupportedError || error instanceof VisualModelUnsupportedError) {
        return res.status(409).json({ message: error.message });
      }
      return next(error);
    }
  });

  router.get("/video-assets/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid video asset id" });
    try {
      const asset = await deps.content.getVisualAsset(id);
      if (
        !asset ||
        asset.kind !== "video" ||
        (asset.userId !== null && asset.userId !== (getUserId(req) ?? 1))
      ) {
        return res.status(404).json({ message: "Video asset not found" });
      }
      return res.json(serializeVisualAsset(asset));
    } catch (error) {
      return next(error);
    }
  });

  // ── Artifact ↔ visual attachment ────────────────────────────────────────────
  const attachVisualBody = z.object({
    visualAssetId: z.number().int().positive(),
    role: z.string().trim().max(60).optional(),
    position: z.number().int().min(0).max(1000).optional(),
  });

  /**
   * Attach an owner-visible visual revision to an artifact. The artifact's own
   * payload must also carry the reference — the ref row is the durable audit
   * trail; the payload is what renderers consume.
   */
  router.post("/artifacts/:id/visuals", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid artifact id" });
    try {
      const body = attachVisualBody.parse(req.body ?? {});
      const userId = getUserId(req) ?? 1;
      const [artifact, asset] = await Promise.all([
        deps.content.getArtifact(id),
        deps.content.getVisualAsset(body.visualAssetId),
      ]);
      if (!artifact) return res.status(404).json({ message: "Artifact not found" });
      if (!asset || asset.userId !== null && asset.userId !== userId) {
        return res.status(404).json({ message: "Visual asset not found" });
      }
      if (asset.status !== "ready") {
        return res.status(409).json({ message: `Visual asset ${asset.id} is "${asset.status}", not ready` });
      }
      const ref = await deps.content.insertVisualAssetRef({
        userId,
        artifactId: id,
        visualAssetId: asset.id,
        role: body.role ?? asset.role ?? null,
        position: body.position ?? 0,
      });
      return res.status(201).json(ref);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      return next(error);
    }
  });

  router.get("/artifacts/:id/visuals", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid artifact id" });
    try {
      const artifact = await deps.content.getArtifact(id);
      if (!artifact) return res.status(404).json({ message: "Artifact not found" });
      return res.json(await deps.content.listVisualAssetRefs(id));
    } catch (error) {
      return next(error);
    }
  });

  // ── Context assembly (inspection only — sources are authored through their
  // existing owner-scoped surfaces: /api/profile, /api/vault, style profiles).
  /**
   * Owner-scoped preview of what `resolveGenerationPolicy` would currently
   * assemble. Read-only: this never mutates a source and never affects a
   * historical GenerationJob — it shows the SAME live state a *new*
   * generation would freeze, nothing more.
   */
  router.get("/context", async (req, res, next) => {
    try {
      const userId = getUserId(req) ?? 1;
      if (!deps.generation.contextReader) return res.json({ sources: [], contextHash: "no-context" });
      const assembly = await assembleContext(userId, deps.generation.contextReader);
      return res.json({
        sources: assembly.sources.map((s) => ({ id: s.id, type: s.type, content: s.content, provenance: s.provenance })),
        contextHash: assembly.contextHash,
      });
    } catch (error) {
      return next(error);
    }
  });

  // ── Style intelligence (Phase 11) — minimal surface for real-post learning ──
  const createReferenceBody = z.object({
    text: z.string().trim().min(1).max(20_000),
    sourceType: z
      .enum(["x_post", "x_thread", "linkedin_post", "instagram_caption", "article", "document", "pasted_text", "manual"])
      .default("manual"),
    title: z.string().trim().max(500).optional(),
    sourceUrl: z.string().trim().url().max(2000).optional(),
    sourcePlatform: z.string().trim().max(30).optional(),
  });

  /** Authored source content — the durable, owner-scoped input to style analysis. */
  router.post("/references", async (req, res, next) => {
    if (!deps.style) return res.status(503).json({ message: "Style analysis is not configured" });
    try {
      const body = createReferenceBody.parse(req.body ?? {});
      const userId = getUserId(req) ?? 1;
      const reference = await deps.style.storage.insertReference({
        userId,
        rawContent: body.text,
        sourceType: body.sourceType,
        title: body.title ?? null,
        sourceUrl: body.sourceUrl ?? null,
        sourcePlatform: body.sourcePlatform ?? null,
        provenance: "pasted_text",
      });
      return res.status(201).json(publicReference(reference));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      return next(error);
    }
  });

  router.get("/style/references", async (req, res, next) => {
    if (!deps.style) return res.status(503).json({ message: "Style analysis is not configured" });
    try {
      const userId = getUserId(req) ?? 1;
      const rows = await deps.style.storage.listOwnedReferences(userId);
      return res.json({ references: rows.map(publicReference) });
    } catch (error) {
      return next(error);
    }
  });

  const requestStyleAnalysisBody = z.object({
    regenerate: z.boolean().optional(),
  });

  const requestCorpusAnalysisBody = z.object({
    referenceIds: z.array(z.number().int().positive()).min(1).max(40),
    regenerate: z.boolean().optional(),
  });

  router.post("/references/:id/style-analysis", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid reference id" });
    if (!deps.style || !deps.enqueueStyleAnalysis) {
      return res.status(503).json({ message: "Style analysis is not configured" });
    }
    try {
      const body = requestStyleAnalysisBody.parse(req.body ?? {});
      const userId = getUserId(req) ?? 1;
      const { analysis, created } = await requestStyleAnalysis(userId, { referenceId: id, regenerate: body.regenerate }, deps.style);
      if (analysis.status === "requested") {
        try {
          await deps.enqueueStyleAnalysis(analysis);
        } catch (error) {
          return res.status(503).json({ message: "Style analysis queue unavailable", id: analysis.id, detail: message(error) });
        }
      }
      return res.status(created ? 201 : 200).json({
        id: analysis.id,
        status: analysis.status,
        correlationId: analysis.correlationId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof ReferenceNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof StyleServiceInputError) return res.status(400).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/style-analyses/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid style analysis id" });
    if (!deps.style) return res.status(503).json({ message: "Style analysis is not configured" });
    try {
      const userId = getUserId(req) ?? 1;
      const analysis = await deps.style.storage.getStyleAnalysis(id);
      if (!analysis || (analysis.userId !== null && analysis.userId !== userId)) {
        return res.status(404).json({ message: "Style analysis not found" });
      }
      const profile = await deps.style.storage.getStyleProfileByAnalysisId(id);
      return res.json({
        id: analysis.id,
        status: analysis.status,
        errorClass: analysis.errorClass,
        errorMessage: analysis.errorMessage,
        styleProfileId: profile?.id ?? null,
        kind: (analysis.requestSnapshot as { kind?: string } | null)?.kind ?? "single",
        sample: (analysis.requestSnapshot as { frozenReferences?: unknown[] } | null)?.frozenReferences?.length ?? 1,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/style-analyses/:id/observations", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid style analysis id" });
    if (!deps.style) return res.status(503).json({ message: "Style analysis is not configured" });
    try {
      const userId = getUserId(req) ?? 1;
      const analysis = await deps.style.storage.getStyleAnalysis(id);
      if (!analysis || (analysis.userId !== null && analysis.userId !== userId)) {
        return res.status(404).json({ message: "Style analysis not found" });
      }
      const observations = await deps.style.storage.listStyleObservations(id);
      return res.json({
        observations: observations.map((row) => ({
          id: row.id,
          category: row.category,
          key: row.observationKey,
          value: row.value,
          confidence: row.confidence,
          evidenceReferenceIds: row.evidenceReferenceIds,
          analysisVersion: row.analysisVersion,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/style/analyses", async (req, res, next) => {
    if (!deps.style || !deps.enqueueStyleAnalysis) {
      return res.status(503).json({ message: "Style analysis is not configured" });
    }
    try {
      const body = requestCorpusAnalysisBody.parse(req.body ?? {});
      const userId = getUserId(req) ?? 1;
      const { analysis, created } = await requestStyleAnalysis(
        userId,
        { referenceIds: body.referenceIds, regenerate: body.regenerate },
        deps.style,
      );
      if (analysis.status === "requested") {
        try {
          await deps.enqueueStyleAnalysis(analysis);
        } catch (error) {
          return res.status(503).json({ message: "Style analysis queue unavailable", id: analysis.id, detail: message(error) });
        }
      }
      return res.status(created ? 201 : 200).json({
        id: analysis.id,
        status: analysis.status,
        correlationId: analysis.correlationId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      if (error instanceof ReferenceNotFoundError) return res.status(404).json({ message: error.message });
      if (error instanceof StyleServiceInputError) return res.status(400).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/style/profiles", async (req, res, next) => {
    if (!deps.style) return res.status(503).json({ message: "Style analysis is not configured" });
    try {
      const userId = getUserId(req) ?? 1;
      const rows = await deps.style.storage.listStyleProfiles(userId);
      return res.json({ profiles: rows.map(publicStyleProfile) });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/style/profiles/:id/activate", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid style profile id" });
    if (!deps.style) return res.status(503).json({ message: "Style analysis is not configured" });
    try {
      const userId = getUserId(req) ?? 1;
      const profile = await activateStyleProfile(userId, id, deps.style);
      return res.json(publicStyleProfile(profile));
    } catch (error) {
      if (error instanceof StyleProfileNotFoundError) return res.status(404).json({ message: error.message });
      return next(error);
    }
  });

  router.get("/style-profiles/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid style profile id" });
    if (!deps.style) return res.status(503).json({ message: "Style analysis is not configured" });
    try {
      const userId = getUserId(req) ?? 1;
      const profile = await deps.style.storage.getStyleProfile(id);
      if (!profile || (profile.userId !== null && profile.userId !== userId)) {
        return res.status(404).json({ message: "Style profile not found" });
      }
      return res.json(publicStyleProfile(profile));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export { loadGenerationContext };

/** Router wired to the application's storage, queue, and channel adapters. */
export async function createDefaultContentRouter(): Promise<Router> {
  const [
    {
      contentStorage,
      visualAssetStorage,
      generationDeps,
      chatDeps,
      styleServiceDeps,
      learningRecorder,
      registerContentJobs,
      GENERATION_RUN_JOB_TYPE,
      PUBLICATION_RUN_JOB_TYPE,
      VISUAL_RUN_JOB_TYPE,
      STYLE_ANALYZE_JOB_TYPE,
    },
    { storyStorage },
    { getJobRuntime },
  ] = await Promise.all([
    import("./service"),
    import("../story/service"),
    import("../jobs/bootstrap"),
  ]);

  registerContentJobs();

  return createContentRouter({
    content: contentStorage,
    opportunities: { opportunities: contentStorage, stories: storyStorage },
    generation: generationDeps,
    chat: chatDeps,
    visualStorage: visualAssetStorage,
    enqueueGeneration: async (job) => {
      const result = await getJobRuntime().enqueue({
        jobType: GENERATION_RUN_JOB_TYPE,
        payload: { generationJobId: job.id },
        correlationId: job.correlationId,
        idempotencyKey: job.idempotencyKey,
      });
      return !result.deduplicated;
    },
    enqueuePublication: async (publication) => {
      const result = await getJobRuntime().enqueue({
        jobType: PUBLICATION_RUN_JOB_TYPE,
        payload: { publicationId: publication.id },
        correlationId: publication.correlationId,
        idempotencyKey: publication.idempotencyKey,
      });
      return !result.deduplicated;
    },
    enqueueVisual: async (generation) => {
      const result = await getJobRuntime().enqueue({
        jobType: VISUAL_RUN_JOB_TYPE,
        payload: { visualGenerationId: generation.id },
        correlationId: generation.correlationId,
        idempotencyKey: generation.idempotencyKey,
      });
      return !result.deduplicated;
    },
    style: styleServiceDeps,
    enqueueStyleAnalysis: async (analysis) => {
      const result = await getJobRuntime().enqueue({
        jobType: STYLE_ANALYZE_JOB_TYPE,
        payload: { styleAnalysisId: analysis.id },
        correlationId: analysis.correlationId,
        idempotencyKey: analysis.idempotencyKey,
      });
      return !result.deduplicated;
    },
    learning: learningRecorder,
  });
}
