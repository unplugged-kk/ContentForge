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
import { storyStorage } from "../story/service";
import { z } from "zod";
import { DatabaseContentStorage } from "./storage";
import { createGatewayChatIntent, createGatewayGenerationModel } from "./model";
import {
  runGenerationJob,
  type GenerationDeps,
} from "./generation";
import type { ChatDeps } from "./chat";
import { runPublication, reconcileStalePublications, type PublicationDeps } from "./publication";
import { dispatchDueOccurrences } from "./scheduling";
import { registerBuiltinChannelAdapters } from "./adapters";
import cron from "node-cron";

export const contentStorage = new DatabaseContentStorage(db);

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
};

export const publicationDeps: PublicationDeps = {
  content: contentStorage,
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

/** Idempotent: register everything the content lifecycle offers. */
export function registerContentJobs(): void {
  registerBuiltinChannelAdapters();
  registerGenerationRunJob();
  registerPublicationRunJob();
}

// ── Durable scheduler tick ────────────────────────────────────────────────────
let contentSchedulerStarted = false;

/**
 * Periodic scheduler loop (Phase 1.5).
 *
 * The scheduler owns WHEN: it materializes due Occurrences and enqueues
 * Publications. It never publishes — `publication.run` does that.
 *
 * Correctness lives in PostgreSQL, not in this timer: the occurrence
 * `pending → enqueued` compare-and-set means at most one tick (in any process)
 * claims an occurrence, and the UNIQUE publication identity means a re-tick
 * cannot create or enqueue a second Publication. The in-process flag only avoids
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

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const result = await dispatchDueOccurrences(now, {
        content: contentStorage,
        enqueuePublication: async (publication) => {
          const { getJobRuntime } = await import("../jobs/bootstrap");
          const enqueued = await getJobRuntime().enqueue({
            jobType: PUBLICATION_RUN_JOB_TYPE,
            payload: { publicationId: publication.id },
            correlationId: publication.correlationId,
            idempotencyKey: publication.idempotencyKey,
          });
          return !enqueued.deduplicated;
        },
      });
      const reconciled = await reconcileStalePublications(now, publicationDeps);
      if (result.materialized > 0 || result.enqueued > 0 || reconciled > 0) {
        console.log(
          `[content-scheduler] materialized=${result.materialized} enqueued=${result.enqueued} reconciled=${reconciled}`,
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
