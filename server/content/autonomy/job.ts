import { z } from "zod";
import { and as andOp, eq } from "drizzle-orm";
import {
  registerJob,
  hasJob,
  type JobDefinition,
  type JobContext,
  type JobQueueConfig,
} from "../../jobs/registry";
import { JobFailure } from "../../jobs/failures";
import type { JobRuntime } from "../../jobs/runtime";
import { policyCandidates } from "@shared/schema";
import type { ContentDatabase } from "../storage";
import { executeAutonomousActivation } from "./controller";

/**
 * Phase 31 — durable autonomous scheduler job (`autonomy.evaluate`).
 *
 * The scheduler answers only WHEN to ask. It never owns eligibility: the
 * handler rereads authoritative state and invokes the canonical Phase 29.4
 * controller (`executeAutonomousActivation`), which re-evaluates every gate
 * inside its own per-owner transaction and journals the outcome to
 * `autonomy_decisions`. A DENY is a successful evaluation (complete, never
 * retry); only unexpected infrastructure errors retry.
 *
 * Payloads carry durable identifiers only — never policy objects, blobs,
 * credentials, or tokens. Owner identity comes from the payload written by
 * server-side producers, is re-verified by the controller against the
 * candidate row, and is never derived from client input (this job type has
 * no HTTP entry point).
 */

export const AUTONOMY_EVALUATE_JOB_TYPE = "autonomy.evaluate";

/** pg-boss singleton window: evaluations are slow-moving (cooldown is 24h). */
export const AUTONOMY_EVALUATE_SINGLETON_SECONDS = 3600;

/** Maximum candidates evaluated per sweep execution (bounded fan-out). */
export const AUTONOMY_EVALUATE_SWEEP_LIMIT = 25;

export const autonomyEvaluatePayloadSchema = z
  .object({
    ownerId: z.number().int().positive(),
    targetScope: z.string().trim().min(1).max(100),
    correlationId: z.string().trim().min(1).max(200),
    /** Present for approval-triggered evaluations; absent for scope sweeps. */
    candidateId: z.number().int().positive().optional(),
  })
  // Strict: smuggled policy objects/blobs fail validation at enqueue AND at
  // worker re-validation (defense in depth for the IDs-only contract).
  .strict();
export type AutonomyEvaluatePayload = z.infer<typeof autonomyEvaluatePayloadSchema>;

export interface AutonomyEvaluateDeps {
  db: ContentDatabase;
  getRuntime: () => JobRuntime;
}

/**
 * Deterministic idempotency key. Same owner+scope+candidate within the same
 * UTC hour bucket collapses at enqueue time (pg-boss singleton) — never
 * Math.random(), never wall-clock-unique-per-call.
 */
export function autonomyEvaluateIdempotencyKey(
  ownerId: number,
  targetScope: string,
  candidateId: number | undefined,
  at: Date = new Date(),
): string {
  const hour = `${at.getUTCFullYear()}${String(at.getUTCMonth() + 1).padStart(2, "0")}${String(
    at.getUTCDate(),
  ).padStart(2, "0")}T${String(at.getUTCHours()).padStart(2, "0")}`;
  const candidate = candidateId === undefined ? "sweep" : `c${candidateId}`;
  return `autonomy-evaluate:${ownerId}:${targetScope}:${candidate}:${hour}`;
}

export function registerAutonomyEvaluateJob(
  deps: AutonomyEvaluateDeps,
  queueOverrides: Partial<JobQueueConfig> = {},
): JobDefinition<AutonomyEvaluatePayload> | undefined {
  if (hasJob(AUTONOMY_EVALUATE_JOB_TYPE)) return undefined;
  const definition: JobDefinition<AutonomyEvaluatePayload> = {
    jobType: AUTONOMY_EVALUATE_JOB_TYPE,
    description: "Ask the bounded-autonomy controller whether anything may activate (scheduler decides when, controller decides whether)",
    payloadSchema: autonomyEvaluatePayloadSchema,
    queue: {
      retryLimit: 3,
      retryDelaySeconds: 300,
      retryBackoff: true,
      expireInSeconds: 15 * 60,
      singletonSeconds: AUTONOMY_EVALUATE_SINGLETON_SECONDS,
      ...queueOverrides,
    },
    handler: async (payload: AutonomyEvaluatePayload, ctx: JobContext): Promise<void> => {
      const { ownerId, targetScope, candidateId } = payload;
      ctx.logger.info(
        { ownerId, targetScope, candidateId: candidateId ?? null, attempt: ctx.attempt },
        "autonomy evaluation started",
      );

      try {
        if (candidateId !== undefined) {
          await evaluateOne(deps.db, ownerId, targetScope, candidateId, ctx);
        } else {
          const rows = await deps.db
            .select({ id: policyCandidates.id })
            .from(policyCandidates)
            .where(
              andOp(
                eq(policyCandidates.userId, ownerId),
                eq(policyCandidates.targetScope, targetScope),
                eq(policyCandidates.status, "approved_for_future"),
              ),
            )
            .limit(AUTONOMY_EVALUATE_SWEEP_LIMIT);
          ctx.logger.info(
            { ownerId, targetScope, candidates: rows.length },
            "autonomy sweep discovered candidates",
          );
          for (const row of rows) {
            await evaluateOne(deps.db, ownerId, targetScope, row.id, ctx);
          }
        }
      } catch (error) {
        // DENYs never reach here (the controller converts them to results).
        // Anything else is unexpected infrastructure failure → transient retry.
        // Safe: activation runs inside the controller's transaction, so a
        // throw means nothing committed and re-execution re-evaluates.
        if (error instanceof JobFailure) throw error;
        throw JobFailure.transient(
          error instanceof Error ? error.message : "autonomy evaluation failed",
        );
      }

      ctx.logger.info({ ownerId, targetScope }, "autonomy evaluation completed");
    },
  };
  registerJob(definition);
  return definition;
}

/**
 * Evaluate exactly one candidate through the canonical controller. A stale
 * candidate (missing, or a different scope than this job's lease dimension)
 * completes quietly — the sweep for its own scope will pick it up.
 */
async function evaluateOne(
  db: ContentDatabase,
  ownerId: number,
  targetScope: string,
  candidateId: number,
  ctx: JobContext,
): Promise<void> {
  const [candidate] = await db
    .select({ id: policyCandidates.id, targetScope: policyCandidates.targetScope })
    .from(policyCandidates)
    .where(eq(policyCandidates.id, candidateId))
    .limit(1);
  if (!candidate) {
    ctx.logger.info({ ownerId, candidateId }, "candidate gone; evaluation skipped as stale");
    return;
  }
  if (candidate.targetScope !== targetScope) {
    ctx.logger.info(
      { ownerId, candidateId, candidateScope: candidate.targetScope, jobScope: targetScope },
      "candidate scope moved since enqueue; evaluation skipped as stale",
    );
    return;
  }
  const result = await executeAutonomousActivation(db, ownerId, candidateId);
  ctx.logger.info(
    {
      ownerId,
      candidateId,
      allowed: result.gate.allowed,
      code: result.gate.code,
      activated: result.activation !== undefined,
    },
    result.gate.allowed ? "autonomous activation executed" : "autonomous activation denied",
  );
}

/** Enqueue one evaluation. Returns the runtime's deduplication verdict. */
export async function enqueueAutonomyEvaluation(
  runtime: JobRuntime,
  input: { ownerId: number; targetScope: string; candidateId?: number; correlationId?: string; at?: Date },
): Promise<{ queueJobId: string | null; deduplicated: boolean }> {
  const correlationId =
    input.correlationId ?? `autonomy-${input.ownerId}-${Date.now().toString(36)}`;
  return runtime.enqueue({
    jobType: AUTONOMY_EVALUATE_JOB_TYPE,
    payload: {
      ownerId: input.ownerId,
      targetScope: input.targetScope,
      correlationId,
      ...(input.candidateId === undefined ? {} : { candidateId: input.candidateId }),
    },
    correlationId,
    idempotencyKey: autonomyEvaluateIdempotencyKey(
      input.ownerId,
      input.targetScope,
      input.candidateId,
      input.at,
    ),
  });
}
