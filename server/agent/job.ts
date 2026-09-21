import { z } from "zod";
import { registerJob, hasJob, type JobDefinition, type JobContext, type JobQueueConfig } from "../jobs/registry";
import { JobFailure } from "../jobs/failures";
import type { AgentRuntime } from "./runtime";
import { DatabaseAgentStorage } from "./storage";

export const AGENT_RUN_JOB_TYPE = "agent.run";

export const agentRunPayloadSchema = z.object({
  agentRunId: z.number().int().positive(),
  ownerId: z.number().int().positive(),
});
export type AgentRunPayload = z.infer<typeof agentRunPayloadSchema>;

export function registerAgentRunJob(
  getRuntime: () => AgentRuntime,
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<AgentRunPayload> | undefined {
  if (hasJob(AGENT_RUN_JOB_TYPE)) return undefined;
  const definition: JobDefinition<AgentRunPayload> = {
    jobType: AGENT_RUN_JOB_TYPE,
    description: "Advance one durable AgentRun through the tool registry",
    payloadSchema: agentRunPayloadSchema,
    queue: {
      retryLimit: 2,
      retryDelaySeconds: 15,
      retryBackoff: true,
      expireInSeconds: 10 * 60,
      singletonSeconds: 30,
      ...queueOverrides,
    },
    handler: async (payload: AgentRunPayload, ctx: JobContext): Promise<void> => {
      const runtime = getRuntime();
      const run = await runtime.advance(payload.agentRunId, payload.ownerId);
      ctx.logger.info(
        { agentRunId: run.id, status: run.status, step: run.currentStep },
        "agent run advanced",
      );
      if (run.status === "failed") {
        throw JobFailure.permanent(run.errorMessage ?? "agent run failed");
      }
    },
  };
  registerJob(definition);
  return definition;
}

export async function enqueueAgentRun(
  storage: DatabaseAgentStorage,
  runId: number,
  ownerId: number,
  correlationId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const { getJobRuntime } = await import("../jobs/bootstrap");
  const result = await getJobRuntime().enqueue({
    jobType: AGENT_RUN_JOB_TYPE,
    payload: { agentRunId: runId, ownerId },
    correlationId,
    idempotencyKey: `agent.run:${idempotencyKey}`,
  });
  return !result.deduplicated;
}
