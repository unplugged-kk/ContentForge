/**
 * Content composition root + pg-boss job types.
 *
 * Wires the content lifecycle to the real database, the model gateway, the
 * channel adapter registry, and the queue. Mirrors `server/research/service.ts`:
 * one composition root, so the HTTP layer and the workers share exactly one set
 * of deps.
 */

import { db } from "../db";
import { MODELS } from "../ai/config";
import { JobFailure } from "../jobs/failures";
import { registerJob, hasJob, type JobContext, type JobDefinition, type JobQueueConfig } from "../jobs/registry";
import { researchStorage } from "../research/service";
import { RESEARCH_RUN_JOB_TYPE } from "../research/job";
import { storyStorage } from "../story/service";
import { z } from "zod";
import type { AutomationRun, GenerationJob } from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseAutomationStorage } from "./automationStorage";
import { DatabaseLearningStorage } from "./learning/store";
import { createLearningRecorder } from "./learning/record";
import { refreshPublicationMetrics } from "./learning/refresh";
import { hourWindow } from "./learning/identity";
import {
  advanceAutomationRun,
  automationRunStepKey,
  currentAutomationStep,
  dispatchAutomationDueRuns,
  type AutomationDeps,
} from "./automation";
import { createGatewayChatIntent, createGatewayGenerationModel } from "./model";
import { createDatabaseContextReader } from "./context";
import {
  runGenerationJob,
  type GenerationDeps,
} from "./generation";
import type { ChatDeps } from "./chat";
import {
  runPublication,
  reconcileStalePublications,
  reconcileUnknownPublications,
  type PublicationDeps,
} from "./publication";
import { dispatchDueOccurrences } from "./scheduling";
import { registerBuiltinChannelAdapters } from "./adapters";
import { createLocalAssetStorage, registerVisualProvider } from "./visual";
import { createFixtureVisualProvider, createFixtureVideoProvider } from "./visualFixture";
import { createOpenAiImageProvider } from "./visualProviders/openaiImage";
import { createMacosSayProvider } from "./visualProviders/macosSay";
import { createConfiguredVideoFactoryProvider } from "./videoFactoryProvider";
import { registerOptionalHyperframesCloudProvider } from "./videoProviders";
import { runVisualGeneration } from "./visualService";
import {
  registerBuiltinVideoRepurposingProviders,
  runVideoRepurposing,
} from "./videoRepurpose";
import { registerStyleAnalyzer } from "./style";
import { createGatewayStyleAnalyzer } from "./styleAnalyzer";
import { createDatabaseStyleStorage, runStyleAnalysis, type StyleServiceDeps } from "./styleService";
import cron from "node-cron";

export const contentStorage = new DatabaseContentStorage(db);

/** Durable automation policy/run persistence (Phase 13). */
export const automationStorage = new DatabaseAutomationStorage(db);

export const learningStorage = new DatabaseLearningStorage(db);
export const learningRecorder = createLearningRecorder(learningStorage, db);

export const visualAssetStorage = createLocalAssetStorage();

export const styleServiceDeps: StyleServiceDeps = {
  storage: createDatabaseStyleStorage(db),
};

/** The one style analyzer wired for the running app — the existing AI gateway, narrowly scoped. */
export function registerBuiltinStyleAnalyzers(): void {
  registerStyleAnalyzer(createGatewayStyleAnalyzer());
}

/**
 * Visual production for the running app. The ONLY producer wired here is the
 * deterministic fixture (real 1×1 PNG bytes through the real worker/queue/DB).
 * A real vendor is a future registration behind the same port — the domain,
 * the job, and the worker do not change.
 *
 * `VISUAL_PROVIDER_FAIL_MODE` (transient | permanent | invalid) is honored so
 * failure paths stay deterministically exercisable without code changes.
 */
export function registerBuiltinVisualProviders(): void {
  registerVisualProvider(
    createFixtureVisualProvider({
      providerId: process.env.VISUAL_PROVIDER_ID?.trim() || "local-fixture",
      failMode: (process.env.VISUAL_PROVIDER_FAIL_MODE as "none" | "transient" | "permanent" | "invalid" | undefined) ?? "none",
    }),
  );
  // Real image provider (Phase 9), registered alongside the fixture — never
  // the default (`providerId` still defaults to "local-fixture" on every
  // request), so nothing changes for existing callers unless they explicitly
  // ask for it. Uses the same OpenAI-compatible client every text-generation
  // call already depends on (`server/ai/config.ts`), so deployment mode
  // (OpenAI, local/self-hosted, any compatible endpoint) is AI_BASE_URL
  // configuration, never a branch in this file.
  registerVisualProvider(createOpenAiImageProvider());
  registerVisualProvider(createFixtureVideoProvider());
  // Video Factory stays a separate system. This adapter is the only ContentForge
  // registration — selected explicitly via providerId `video-factory`. Default
  // video generation remains `local-video-fixture` so existing callers are unchanged.
  registerVisualProvider(createConfiguredVideoFactoryProvider());
  // Real local TTS adapter. Registration is stable; health/configuration
  // decides whether it is selectable as processing-ready.
  registerVisualProvider(createMacosSayProvider());
  registerOptionalHyperframesCloudProvider();
}

export interface VisualRunDeps {
  content: typeof contentStorage;
  storage: typeof visualAssetStorage;
}

export const visualRunDeps: VisualRunDeps = {
  content: contentStorage,
  storage: visualAssetStorage,
};

export const generationDeps: GenerationDeps = {
  content: contentStorage,
  stories: storyStorage,
  evidence: {
    listEvidence: async (researchJobId) => {
      const rows = await researchStorage.getEvidenceForJob(researchJobId);
      return rows.map((r) => ({ id: r.id, excerpt: r.excerpt, kind: r.kind }));
    },
  },
  model: createGatewayGenerationModel(),
  defaultModel: MODELS.TEXT,
  contextReader: createDatabaseContextReader(db),
};

export const publicationDeps: PublicationDeps = {
  content: contentStorage,
  storage: visualAssetStorage,
  learning: learningRecorder,
};

/** Chat-to-post: conversational input becomes a normal Story → Opportunity → job. */
export const chatDeps: ChatDeps = {
  content: contentStorage,
  stories: storyStorage,
  opportunities: { opportunities: contentStorage, stories: storyStorage },
  intent: createGatewayChatIntent(),
  generation: generationDeps,
};

// ── generation.run ────────────────────────────────────────────────────────────
export const GENERATION_RUN_JOB_TYPE = "generation.run";

export const generationRunPayloadSchema = z.object({
  generationJobId: z.number().int().positive(),
});
export type GenerationRunPayload = z.infer<typeof generationRunPayloadSchema>;

export function createGenerationRunHandler(deps: GenerationDeps) {
  return async (payload: GenerationRunPayload, ctx: JobContext): Promise<void> => {
    const result = await runGenerationJob(payload.generationJobId, deps);
    if (result.status === "succeeded") {
      ctx.logger.info(
        {
          generationJobId: result.generationJobId,
          artifactId: result.artifactId,
          model: result.model,
          reused: result.reused,
        },
        "generation job complete",
      );
      return;
    }
    const failureClass = result.failureClass ?? "transient";
    const message = result.failureMessage ?? "generation failed";
    if (failureClass === "rate_limited") throw JobFailure.rateLimited(message);
    if (failureClass === "transient") throw JobFailure.transient(message);
    if (failureClass === "policy_human") throw JobFailure.policyHuman(message);
    throw JobFailure.permanent(message);
  };
}

/** Idempotent registration. */
export function registerGenerationRunJob(
  deps: GenerationDeps = generationDeps,
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<GenerationRunPayload> | undefined {
  if (hasJob(GENERATION_RUN_JOB_TYPE)) return undefined;
  const definition: JobDefinition<GenerationRunPayload> = {
    jobType: GENERATION_RUN_JOB_TYPE,
    description: "Generate an Artifact for a persisted GenerationJob",
    payloadSchema: generationRunPayloadSchema,
    queue: {
      retryLimit: 3,
      retryDelaySeconds: 60,
      retryBackoff: true,
      expireInSeconds: 10 * 60,
      singletonSeconds: 30,
      ...queueOverrides,
    },
    handler: createGenerationRunHandler(deps),
  };
  registerJob(definition);
  return definition;
}

// ── publication.run ───────────────────────────────────────────────────────────
export const PUBLICATION_RUN_JOB_TYPE = "publication.run";

export const publicationRunPayloadSchema = z.object({
  publicationId: z.number().int().positive(),
});
export type PublicationRunPayload = z.infer<typeof publicationRunPayloadSchema>;

export function createPublicationRunHandler(deps: PublicationDeps) {
  return async (payload: PublicationRunPayload, ctx: JobContext): Promise<void> => {
    const result = await runPublication(payload.publicationId, deps);
    if (result.status === "published") {
      ctx.logger.info(
        { publicationId: result.publicationId, externalId: result.externalId, reused: result.reused },
        "publication complete",
      );
      return;
    }
    if (result.status === "skipped") {
      ctx.logger.info({ publicationId: result.publicationId, reason: result.message }, "publication skipped");
      return;
    }
    // `unknown` outcomes are already durably recorded as a Result for
    // reconciliation; they are terminal here and must not be retried blindly.
    if (result.failureClass === "unknown") {
      ctx.logger.warn(
        { publicationId: result.publicationId, message: result.message },
        "publication outcome unknown — reconcile required",
      );
      return;
    }
    const message = result.message ?? "publication failed";
    if (result.failureClass === "policy_human") throw JobFailure.policyHuman(message);
    throw JobFailure.permanent(message);
  };
}

export function registerPublicationRunJob(
  deps: PublicationDeps = publicationDeps,
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<PublicationRunPayload> | undefined {
  if (hasJob(PUBLICATION_RUN_JOB_TYPE)) return undefined;
  const definition: JobDefinition<PublicationRunPayload> = {
    jobType: PUBLICATION_RUN_JOB_TYPE,
    description: "Distribute one approved Artifact revision through its channel adapter",
    payloadSchema: publicationRunPayloadSchema,
    queue: {
      retryLimit: 3,
      retryDelaySeconds: 60,
      retryBackoff: true,
      expireInSeconds: 10 * 60,
      singletonSeconds: 30,
      ...queueOverrides,
    },
    handler: createPublicationRunHandler(deps),
  };
  registerJob(definition);
  return definition;
}

// ── visual.run ────────────────────────────────────────────────────────────────
export const VISUAL_RUN_JOB_TYPE = "visual.run";

export const visualRunPayloadSchema = z.object({
  visualGenerationId: z.number().int().positive(),
});
export type VisualRunPayload = z.infer<typeof visualRunPayloadSchema>;

export function createVisualRunHandler(deps: VisualRunDeps) {
  return async (payload: VisualRunPayload, ctx: JobContext): Promise<void> => {
    const result = await runVisualGeneration(payload.visualGenerationId, deps);
    if (result.status === "ready") {
      ctx.logger.info(
        {
          visualGenerationId: result.visualGenerationId,
          visualAssetId: result.visualAssetId,
          reused: result.reused,
        },
        "visual generation complete",
      );
      return;
    }
    if (result.status === "partial") {
      ctx.logger.info(
        {
          visualGenerationId: result.visualGenerationId,
          visualAssetIds: result.visualAssetIds,
          failureClass: result.failureClass,
        },
        "visual generation partial",
      );
      if (result.failureClass === "transient" || result.failureClass === "rate_limited") {
        throw JobFailure.transient(result.failureMessage ?? "partial visual generation");
      }
      return;
    }
    const failureClass = result.failureClass ?? "transient";
    const message = result.failureMessage ?? "visual generation failed";
    if (failureClass === "rate_limited") throw JobFailure.rateLimited(message);
    if (failureClass === "transient") throw JobFailure.transient(message);
    if (failureClass === "policy_human") throw JobFailure.policyHuman(message);
    throw JobFailure.permanent(message);
  };
}

export function registerVisualRunJob(
  deps: VisualRunDeps = visualRunDeps,
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<VisualRunPayload> | undefined {
  if (hasJob(VISUAL_RUN_JOB_TYPE)) return undefined;
  const definition: JobDefinition<VisualRunPayload> = {
    jobType: VISUAL_RUN_JOB_TYPE,
    description: "Produce a visual asset for a persisted VisualGeneration",
    payloadSchema: visualRunPayloadSchema,
    queue: {
      retryLimit: 3,
      retryDelaySeconds: 60,
      retryBackoff: true,
      expireInSeconds: 10 * 60,
      singletonSeconds: 30,
      ...queueOverrides,
    },
    handler: createVisualRunHandler(deps),
  };
  registerJob(definition);
  return definition;
}

// ── video.repurpose ───────────────────────────────────────────────────────────
export const VIDEO_REPURPOSE_JOB_TYPE = "video.repurpose";

export const videoRepurposePayloadSchema = z.object({
  videoRepurposingJobId: z.number().int().positive(),
});
export type VideoRepurposePayload = z.infer<typeof videoRepurposePayloadSchema>;

export function createVideoRepurposeHandler() {
  return async (payload: VideoRepurposePayload, ctx: JobContext): Promise<void> => {
    const result = await runVideoRepurposing(payload.videoRepurposingJobId, {
      content: contentStorage,
      storage: visualAssetStorage,
    });
    ctx.logger.info(
      {
        videoRepurposingJobId: result.jobId,
        status: result.status,
        assetIds: result.assetIds,
        reused: result.reused,
        failureClass: result.failureClass,
      },
      "video repurposing result",
    );
    if (result.status === "ready" || result.status === "partial") return;
    const failureClass = result.failureClass ?? "transient";
    const message = result.failureMessage ?? "video repurposing failed";
    if (result.status === "unknown" || failureClass === "unknown" || failureClass === "transient") {
      throw JobFailure.transient(message);
    }
    if (failureClass === "rate_limited") throw JobFailure.rateLimited(message);
    throw JobFailure.permanent(message);
  };
}

export function registerVideoRepurposeJob(
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<VideoRepurposePayload> | undefined {
  if (hasJob(VIDEO_REPURPOSE_JOB_TYPE)) return undefined;
  const definition: JobDefinition<VideoRepurposePayload> = {
    jobType: VIDEO_REPURPOSE_JOB_TYPE,
    description: "Clip an owned VideoAsset into short VideoAssets",
    payloadSchema: videoRepurposePayloadSchema,
    queue: {
      retryLimit: 8,
      retryDelaySeconds: 30,
      retryBackoff: true,
      expireInSeconds: 45 * 60,
      singletonSeconds: 30,
      ...queueOverrides,
    },
    handler: createVideoRepurposeHandler(),
  };
  registerJob(definition);
  return definition;
}

// ── style.analyze ─────────────────────────────────────────────────────────────
export const STYLE_ANALYZE_JOB_TYPE = "style.analyze";

export const styleAnalyzePayloadSchema = z.object({
  styleAnalysisId: z.number().int().positive(),
});
export type StyleAnalyzePayload = z.infer<typeof styleAnalyzePayloadSchema>;

export function createStyleAnalyzeHandler(deps: StyleServiceDeps) {
  return async (payload: StyleAnalyzePayload, ctx: JobContext): Promise<void> => {
    const result = await runStyleAnalysis(payload.styleAnalysisId, deps);
    if (result.status === "ready") {
      ctx.logger.info(
        { styleAnalysisId: result.styleAnalysisId, styleProfileId: result.styleProfileId, reused: result.reused },
        "style analysis complete",
      );
      return;
    }
    const failureClass = result.failureClass ?? "transient";
    const message = result.failureMessage ?? "style analysis failed";
    if (failureClass === "transient") throw JobFailure.transient(message);
    throw JobFailure.permanent(message);
  };
}

export function registerStyleAnalyzeJob(
  deps: StyleServiceDeps = styleServiceDeps,
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<StyleAnalyzePayload> | undefined {
  if (hasJob(STYLE_ANALYZE_JOB_TYPE)) return undefined;
  const definition: JobDefinition<StyleAnalyzePayload> = {
    jobType: STYLE_ANALYZE_JOB_TYPE,
    description: "Analyze real authored content into a durable style observation",
    payloadSchema: styleAnalyzePayloadSchema,
    queue: {
      retryLimit: 3,
      retryDelaySeconds: 60,
      retryBackoff: true,
      expireInSeconds: 10 * 60,
      singletonSeconds: 30,
      ...queueOverrides,
    },
    handler: createStyleAnalyzeHandler(deps),
  };
  registerJob(definition);
  return definition;
}

// ── automation.run ────────────────────────────────────────────────────────────
/**
 * Phase 13: the one automation job type. It is narrowly defined on purpose —
 * the payload is a single durable id (`{ automationRunId }`), never a pipeline
 * description or a content/context blob — and its handler advances the run by at
 * most ONE bounded step. There is no generic "run anything" worker.
 *
 * Queue configuration follows the standard conventions exactly (retryLimit 3,
 * retryDelaySeconds 60, retryBackoff, expireInSeconds 600, singletonSeconds 30):
 * a recoverable step failure is re-delivered with backoff, and the durable run
 * row is what is retried — never a re-composed workflow.
 */
export const AUTOMATION_RUN_JOB_TYPE = "automation.run";

export const automationRunPayloadSchema = z.object({
  automationRunId: z.number().int().positive(),
});
export type AutomationRunPayload = z.infer<typeof automationRunPayloadSchema>;

export function createAutomationRunHandler(deps: AutomationDeps) {
  return async (payload: AutomationRunPayload, ctx: JobContext): Promise<void> => {
    const result = await advanceAutomationRun(payload.automationRunId, deps);

    if (result.reason === "failed") {
      // The run itself is terminally failed and durably recorded — retrying the
      // queue job cannot change that, so it must not consume retry budget.
      throw JobFailure.permanent(
        result.failureMessage ?? `automation run ${payload.automationRunId} failed`,
      );
    }
    if (result.reason === "retryable") {
      throw JobFailure.transient(
        result.failureMessage ?? `automation run ${payload.automationRunId} deferred`,
      );
    }

    ctx.logger.info(
      {
        automationRunId: payload.automationRunId,
        step: result.step,
        reason: result.reason,
        status: result.status,
        advanced: result.advanced,
      },
      "automation run advanced",
    );
  };
}

export function registerAutomationRunJob(
  deps: AutomationDeps = automationDeps,
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<AutomationRunPayload> | undefined {
  if (hasJob(AUTOMATION_RUN_JOB_TYPE)) return undefined;
  const definition: JobDefinition<AutomationRunPayload> = {
    jobType: AUTOMATION_RUN_JOB_TYPE,
    description: "Advance one durable AutomationRun by a single bounded step",
    payloadSchema: automationRunPayloadSchema,
    queue: {
      retryLimit: 3,
      retryDelaySeconds: 60,
      retryBackoff: true,
      expireInSeconds: 10 * 60,
      singletonSeconds: 30,
      ...queueOverrides,
    },
    handler: createAutomationRunHandler(deps),
  };
  registerJob(definition);
  return definition;
}

/**
 * Enqueue the automation worker for a durable run. The run row already exists,
 * so a queue hiccup loses nothing — the scheduler tick re-enqueues every
 * unfinished run on its next pass.
 *
 * The queue dedup key is the `(run, step)` pair, not the run: re-observing the
 * same unfinished run schedules nothing new, while a run that has advanced to
 * its next step is enqueued immediately instead of waiting out a dedup window.
 * Redundant deliveries remain harmless — the run's lease plus the idempotent,
 * derived-step advance make every step safe to attempt more than once.
 */
export async function enqueueAutomationRunJob(run: AutomationRun): Promise<boolean> {
  const step = await currentAutomationStep(run, storyStorage);
  const { getJobRuntime } = await import("../jobs/bootstrap");
  const result = await getJobRuntime().enqueue({
    jobType: AUTOMATION_RUN_JOB_TYPE,
    payload: { automationRunId: run.id },
    correlationId: run.correlationId,
    idempotencyKey: automationRunStepKey(run.id, step),
  });
  return !result.deduplicated;
}

/**
 * Automation composition root. Every dependency here is an EXISTING primitive —
 * `researchStorage` (the real ResearchEngine's persistence + the `research.run`
 * queue), `storyStorage`, `contentStorage`, and Phase 12's repurpose deps built
 * from the SAME `generationDeps` manual creation uses. Automation owns no
 * generation, research or publication mechanism of its own.
 */
export const automationDeps: AutomationDeps = {
  automation: automationStorage,
  content: contentStorage,
  stories: storyStorage,
  research: {
    claimJob: (input) => researchStorage.claimJob(input),
    getJob: (jobId) => researchStorage.getJob(jobId),
    listEvidenceIds: (jobId) => researchStorage.listEvidenceIds(jobId),
    getEvidence: (jobId) => researchStorage.getEvidenceForJob(jobId),
    enqueueResearchRun: async (job) => {
      const { getJobRuntime } = await import("../jobs/bootstrap");
      await getJobRuntime().enqueue({
        jobType: RESEARCH_RUN_JOB_TYPE,
        payload: { jobId: job.id },
        correlationId: job.correlationId,
        idempotencyKey: job.idempotencyKey,
      });
    },
  },
  repurpose: {
    opportunities: { opportunities: contentStorage, stories: storyStorage },
    generation: generationDeps,
    plans: contentStorage,
  },
  enqueueGeneration: async (job: GenerationJob) => {
    const { getJobRuntime } = await import("../jobs/bootstrap");
    const result = await getJobRuntime().enqueue({
      jobType: GENERATION_RUN_JOB_TYPE,
      payload: { generationJobId: job.id },
      correlationId: job.correlationId,
      idempotencyKey: job.idempotencyKey,
    });
    return !result.deduplicated;
  },
  enqueueAutomationRun: enqueueAutomationRunJob,
  learning: learningRecorder,
};

export const ANALYTICS_REFRESH_JOB_TYPE = "analytics.refresh";
export const analyticsRefreshPayloadSchema = z.object({
  publicationId: z.number().int().positive(),
});
export type AnalyticsRefreshPayload = z.infer<typeof analyticsRefreshPayloadSchema>;

export function registerAnalyticsRefreshJob(
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<AnalyticsRefreshPayload> | undefined {
  if (hasJob(ANALYTICS_REFRESH_JOB_TYPE)) return undefined;
  const definition: JobDefinition<AnalyticsRefreshPayload> = {
    jobType: ANALYTICS_REFRESH_JOB_TYPE,
    description: "Fetch and persist normalized performance metrics for one Publication",
    payloadSchema: analyticsRefreshPayloadSchema,
    queue: {
      retryLimit: 3,
      retryDelaySeconds: 60,
      retryBackoff: true,
      expireInSeconds: 5 * 60,
      singletonSeconds: 60 * 60,
      ...queueOverrides,
    },
    handler: async (payload, ctx) => {
      const result = await refreshPublicationMetrics(payload.publicationId, {
        content: contentStorage,
        learning: learningStorage,
        database: db,
      });
      ctx.logger.info(
        { publicationId: result.publicationId, status: result.status, created: result.created, reused: result.reused },
        "analytics refresh complete",
      );
    },
  };
  registerJob(definition);
  return definition;
}

export async function enqueueAnalyticsRefreshJob(
  publicationId: number,
  correlationId: string,
): Promise<boolean> {
  const { getJobRuntime } = await import("../jobs/bootstrap");
  const window = hourWindow(new Date());
  const result = await getJobRuntime().enqueue({
    jobType: ANALYTICS_REFRESH_JOB_TYPE,
    payload: { publicationId },
    correlationId,
    idempotencyKey: `analytics:${publicationId}:${window.window}`,
  });
  return !result.deduplicated;
}

/** Idempotent: register everything the content lifecycle offers. */
export function registerContentJobs(): void {
  registerBuiltinChannelAdapters();
  registerBuiltinVisualProviders();
  registerBuiltinVideoRepurposingProviders();
  registerBuiltinStyleAnalyzers();
  registerGenerationRunJob();
  registerStyleAnalyzeJob();
  registerPublicationRunJob();
  registerVisualRunJob();
  registerVideoRepurposeJob();
  registerAutomationRunJob();
  registerAnalyticsRefreshJob();
}

// ── Durable scheduler tick ────────────────────────────────────────────────────
let contentSchedulerStarted = false;

/**
 * Periodic scheduler loop (Phase 1.5, extended in Phase 13).
 *
 * The scheduler owns WHEN: it materializes due Occurrences and enqueues
 * Publications, and (Phase 13) it materializes due AutomationRuns and enqueues
 * their advance jobs. It never publishes and never executes automation —
 * `publication.run` and `automation.run` do that.
 *
 * Correctness lives in PostgreSQL, not in this timer: the occurrence
 * `pending → enqueued` compare-and-set means at most one tick (in any process)
 * claims an occurrence, and the UNIQUE publication identity means a re-tick
 * cannot create or enqueue a second Publication. Phase 13 adds the same for
 * automation: `automation_runs_idempotency_key_unique` means one run per logical
 * trigger slot however many ticks overlap. The in-process flag only avoids
 * redundant overlapping ticks; losing the process loses nothing durable.
 */
export function startContentScheduler(options: { cronExpression?: string } = {}): void {
  if (contentSchedulerStarted) return;
  contentSchedulerStarted = true;

  // `DISABLE_CRON=1` turns crons off app-wide; the E2E enables this one
  // explicitly so the real periodic tick can be observed without enabling the
  // legacy schedulers (which would make outbound calls).
  const disabled = process.env.DISABLE_CRON === "1";
  const explicitlyEnabled = process.env.CONTENT_SCHEDULER_ENABLED === "1";
  if (disabled && !explicitlyEnabled) {
    console.log("[content-scheduler] disabled (DISABLE_CRON=1)");
    return;
  }

  const enqueuePublicationJob = async (publication: { id: number; correlationId: string; idempotencyKey: string }) => {
    const { getJobRuntime } = await import("../jobs/bootstrap");
    const enqueued = await getJobRuntime().enqueue({
      jobType: PUBLICATION_RUN_JOB_TYPE,
      payload: { publicationId: publication.id },
      correlationId: publication.correlationId,
      idempotencyKey: publication.idempotencyKey,
    });
    return !enqueued.deduplicated;
  };

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const result = await dispatchDueOccurrences(now, {
        content: contentStorage,
        enqueuePublication: enqueuePublicationJob,
      });
      const stale = await reconcileStalePublications(now, publicationDeps);
      // Real provider-side reconciliation for `unknown` Publications (see
      // `reconcileUnknownPublications` docs). A confirmed non-publication is
      // re-queued through the same durable job, never re-published inline.
      const unknown = await reconcileUnknownPublications(now, {
        ...publicationDeps,
        enqueuePublication: enqueuePublicationJob,
      });
      // Phase 13: create due scheduled AutomationRuns and re-enqueue every
      // unfinished run. Same shape as the occurrence dispatch above — the tick
      // materializes and enqueues; the worker advances. No second cron.
      const automation = await dispatchAutomationDueRuns(now, automationDeps);
      const dueAnalytics = await learningStorage.listRecentPublishedPublicationIds(20);
      let analyticsEnqueued = 0;
      for (const publicationId of dueAnalytics.slice(0, 10)) {
        const publication = await contentStorage.getPublication(publicationId);
        if (!publication) continue;
        const enqueued = await enqueueAnalyticsRefreshJob(publication.id, publication.correlationId);
        if (enqueued) analyticsEnqueued += 1;
      }
      if (
        result.materialized > 0 ||
        result.enqueued > 0 ||
        stale > 0 ||
        unknown.resolved > 0 ||
        unknown.requeued > 0 ||
        automation.scheduled.created > 0 ||
        automation.enqueued > 0 ||
        analyticsEnqueued > 0
      ) {
        console.log(
          `[content-scheduler] materialized=${result.materialized} enqueued=${result.enqueued} stale=${stale} ` +
            `reconciled(resolved=${unknown.resolved} requeued=${unknown.requeued} stillUnknown=${unknown.stillUnknown} exhausted=${unknown.exhausted}) ` +
            `automation(scheduled=${automation.scheduled.created} deduplicated=${automation.scheduled.deduplicated} limited=${automation.scheduled.limited} enqueued=${automation.enqueued})`,
        );
      }
    } catch (error) {
      console.error(
        "[content-scheduler] tick failed:",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      running = false;
    }
  };

  cron.schedule(options.cronExpression ?? "* * * * *", () => {
    void tick();
  });
  console.log("[content-scheduler] started (every minute)");
}
