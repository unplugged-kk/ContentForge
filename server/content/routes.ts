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
import type { Artifact, GenerationJob, Opportunity, Publication, Schedule } from "@shared/schema";
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
  approveArtifact,
  rejectArtifact,
  submitArtifactForReview,
  ArtifactNotFoundError,
  ArtifactStateError,
  InvalidArtifactPayloadError,
} from "./artifact";
import {
  createSchedule,
  dispatchDueOccurrences,
  ArtifactNotSchedulableError,
  ScheduleInputError,
} from "./scheduling";
import { getChannelAdapter } from "./adapters";
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
  enqueueGeneration: (job: GenerationJob) => Promise<boolean>;
  enqueuePublication: (publication: Publication) => Promise<boolean>;
}

// ── serializers ───────────────────────────────────────────────────────────────
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
});

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function message(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  return null;
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
        const artifact = await handler(id, { artifacts: deps.content });
        return res.json(serializeArtifact(artifact));
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) return res.status(404).json({ message: error.message });
        if (error instanceof ArtifactStateError) return res.status(409).json({ message: error.message });
        if (error instanceof InvalidArtifactPayloadError) return res.status(422).json({ message: error.message });
        return next(error);
      }
    });
  }

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
      const result = await dispatchDueOccurrences(
        new Date(),
        { content: deps.content, enqueuePublication: deps.enqueuePublication },
        100,
      );
      return res.json({
        materialized: result.materialized,
        enqueued: result.enqueued,
        publications: result.publications.map(serializePublication),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/publications/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid publication id" });
    try {
      const publication = await deps.content.getPublication(id);
      if (!publication) return res.status(404).json({ message: "Publication not found" });
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
    const channels = ["x"].filter((channel) => {
      try {
        getChannelAdapter(channel);
        return true;
      } catch {
        return false;
      }
    });
    return res.json({ channels });
  });

  // ── Voices ──────────────────────────────────────────────────────────────────
  router.post("/voices", async (req, res, next) => {
    try {
      const body = createVoiceBody.parse(req.body ?? {});
      const voice = await deps.content.insertVoice({
        userId: getUserId(req) ?? 1,
        name: body.name,
        description: body.description ?? null,
        tone: body.tone ?? null,
        vocabulary: body.vocabulary ?? [],
        sentenceStyle: body.sentenceStyle ?? null,
        formatting: body.formatting ?? {},
        doRules: body.doRules ?? [],
        dontRules: body.dontRules ?? [],
        examples: body.examples ?? [],
      });
      return res.status(201).json(voice);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      return next(error);
    }
  });

  router.get("/voices", async (_req, res, next) => {
    try {
      return res.json(await deps.content.listVoices());
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
      return res.json(voice);
    } catch (error) {
      return next(error);
    }
  });

  // ── Templates ───────────────────────────────────────────────────────────────
  router.post("/templates", async (req, res, next) => {
    try {
      const body = createTemplateBody.parse(req.body ?? {});
      const template = await deps.content.insertContentTemplate({
        userId: getUserId(req) ?? 1,
        name: body.name,
        description: body.description ?? null,
        supportedFormats: body.supportedFormats ?? [],
        supportedChannels: body.supportedChannels ?? [],
        structure: body.structure ?? [],
        variables: body.variables ?? [],
        constraints: body.constraints ?? {},
        instructions: body.instructions ?? null,
      });
      return res.status(201).json(template);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
      return next(error);
    }
  });

  router.get("/templates", async (_req, res, next) => {
    try {
      return res.json(await deps.content.listContentTemplates());
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
      return res.json(template);
    } catch (error) {
      return next(error);
    }
  });

  // ── Generation policies (immutable, content-addressed revisions) ─────────────
  router.get("/generation-policies", async (_req, res, next) => {
    try {
      return res.json(await deps.content.listGenerationPolicies());
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
      return res.json(policy);
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

  return router;
}

export { loadGenerationContext };

/** Router wired to the application's storage, queue, and channel adapters. */
export async function createDefaultContentRouter(): Promise<Router> {
  const [
    {
      contentStorage,
      generationDeps,
      chatDeps,
      registerContentJobs,
      GENERATION_RUN_JOB_TYPE,
      PUBLICATION_RUN_JOB_TYPE,
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
  });
}
