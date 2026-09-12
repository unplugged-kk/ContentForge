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
import { runPublication, type PublicationDeps } from "./publication";
import { registerBuiltinChannelAdapters } from "./adapters";

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
