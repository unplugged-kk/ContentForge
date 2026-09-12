/**
 * `research.run` job type.
 *
 * The durable execution path for research: the API persists a ResearchJob and
 * enqueues `{ jobId }`; the worker loads that job, resolves provider config
 * generically, and hands it to the research engine. All retry/DLQ behaviour
 * comes from the job runtime — this handler only maps an engine outcome onto a
 * failure class.
 */

import { z } from "zod";
import type { ResearchJob } from "@shared/schema";
import { JobFailure } from "../jobs/failures";
import {
  getJob,
  hasJob,
  registerJob,
  type JobContext,
  type JobDefinition,
  type JobQueueConfig,
} from "../jobs/registry";
import type { ProviderBudget, TimeWindow } from "./contracts";
import { resolveProviderConfigs } from "./config";
import type { InitiationKind, ResearchRunInput, ResearchRunResult } from "./engine";

export const RESEARCH_RUN_JOB_TYPE = "research.run";

export const researchRunPayloadSchema = z.object({
  jobId: z.number().int().positive(),
});

export type ResearchRunPayload = z.infer<typeof researchRunPayloadSchema>;

/** The engine surface the handler needs (structural, so tests can fake it). */
export interface ResearchRunEngine {
  executeJob(job: ResearchJob, input: ResearchRunInput): Promise<ResearchRunResult>;
}

/** The storage surface the handler needs (structural). */
export interface ResearchRunStorage {
  getJob(jobId: number): Promise<ResearchJob | undefined>;
}

export interface ResearchRunDeps {
  engine: ResearchRunEngine;
  storage: ResearchRunStorage;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Build the engine input for a persisted job from its frozen initiation. */
export function researchInputForJob(job: ResearchJob | undefined): ResearchRunInput | null {
  if (!job) return null;
  const initiation = asRecord(job.initiation);
  const providerIds = job.providerIds ?? [];

  return {
    kind: job.kind as InitiationKind,
    query: job.query ?? undefined,
    providerIds,
    authorStatement:
      typeof initiation.authorStatement === "string" ? initiation.authorStatement : undefined,
    limit: typeof initiation.limit === "number" ? initiation.limit : undefined,
    window: (initiation.window ?? undefined) as TimeWindow | undefined,
    budget: (initiation.budget ?? undefined) as ProviderBudget | undefined,
    correlationId: job.correlationId,
    idempotencyKey: job.idempotencyKey,
    userId: job.userId,
  };
}

export function createResearchRunHandler(deps: ResearchRunDeps) {
  return async (payload: ResearchRunPayload, ctx: JobContext): Promise<void> => {
    const job = await deps.storage.getJob(payload.jobId);
    if (!job) {
      throw JobFailure.permanent(`ResearchJob ${payload.jobId} not found`);
    }

    // Duplicate delivery of an already-finished job is a no-op.
    if (job.status === "complete") {
      ctx.logger.info({ researchJobId: job.id }, "research job already complete");
      return;
    }

    const base = researchInputForJob(job);
    if (!base) throw JobFailure.permanent(`ResearchJob ${payload.jobId} is unreadable`);

    const providerConfig = await resolveProviderConfigs(base.providerIds, {
      userId: job.userId,
    });

    // Request-scoped provider config (e.g. explicit web URLs for a directed job)
    // is stored durably on the job's initiation and overrides the deployment
    // default per provider. The engine still only sees a config map.
    const scoped = asRecord(asRecord(job.initiation).providerConfig);
    const merged: Record<string, Record<string, unknown>> = { ...providerConfig };
    for (const providerId of Object.keys(scoped)) {
      merged[providerId] = {
        ...(merged[providerId] ?? {}),
        ...asRecord(scoped[providerId]),
      };
    }

    const result = await deps.engine.executeJob(job, { ...base, providerConfig: merged });

    if (result.status === "complete") {
      ctx.logger.info(
        {
          researchJobId: job.id,
          sourceCount: result.sourceCount,
          evidenceCount: result.evidenceCount,
          droppedCount: result.droppedCount,
          reused: result.reused,
        },
        "research job complete",
      );
      return;
    }

    const failureClass = result.failureClass ?? "transient";
    const message = result.failureMessage ?? "research failed";

    if (failureClass === "rate_limited") {
      throw JobFailure.rateLimited(message);
    }
    if (failureClass === "transient") {
      throw JobFailure.transient(message);
    }
    if (failureClass === "policy_human") {
      throw JobFailure.policyHuman(message);
    }
    throw JobFailure.permanent(message);
  };
}

/** Idempotent registration. Resets with `resetJobRegistry` in tests. */
export function registerResearchRunJob(
  deps: ResearchRunDeps,
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<ResearchRunPayload> {
  if (hasJob(RESEARCH_RUN_JOB_TYPE)) {
    return getJob(RESEARCH_RUN_JOB_TYPE) as JobDefinition<ResearchRunPayload>;
  }

  const definition: JobDefinition<ResearchRunPayload> = {
    jobType: RESEARCH_RUN_JOB_TYPE,
    description: "Run a persisted ResearchJob through the research engine",
    payloadSchema: researchRunPayloadSchema,
    queue: {
      retryLimit: 3,
      retryDelaySeconds: 300,
      retryBackoff: true,
      expireInSeconds: 15 * 60,
      singletonSeconds: 60,
      ...queueOverrides,
    },
    handler: createResearchRunHandler(deps),
  };
  registerJob(definition);
  return definition;
}
