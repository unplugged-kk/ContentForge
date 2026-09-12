/**
 * Generic, versioned job envelope for the durable queue.
 *
 * Transport-agnostic: the same envelope shape rides on pg-boss today and any
 * future queue without changing domain code. It carries no channel- or
 * provider-specific fields — those live inside `payload`.
 *
 * Attempt semantics: `attempt` is the attempt number of the current execution.
 * Enqueue sets it to 1; the worker rewrites it from the queue's retry count, so
 * a job observed in a handler always reports its true attempt.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const JOB_ENVELOPE_SCHEMA_VERSION = 1 as const;

export const jobEnvelopeSchema = z.object({
  jobId: z.string().min(1),
  jobType: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  createdAt: z.string().datetime(),
  attempt: z.number().int().positive(),
  payload: z.unknown(),
});

export type JobEnvelope<TPayload = unknown> = {
  jobId: string;
  jobType: string;
  schemaVersion: number;
  correlationId: string;
  idempotencyKey: string;
  createdAt: string;
  attempt: number;
  payload: TPayload;
};

export class InvalidJobEnvelopeError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid job envelope: ${issues.join("; ")}`);
    this.name = "InvalidJobEnvelopeError";
    this.issues = issues;
  }
}

export type CreateEnvelopeInput<TPayload> = {
  jobType: string;
  payload: TPayload;
  correlationId: string;
  idempotencyKey: string;
  createdAt?: Date;
  jobId?: string;
  attempt?: number;
  schemaVersion?: number;
};

export function createJobEnvelope<TPayload>(
  input: CreateEnvelopeInput<TPayload>,
): JobEnvelope<TPayload> {
  return {
    jobId: input.jobId ?? randomUUID(),
    jobType: input.jobType,
    schemaVersion: input.schemaVersion ?? JOB_ENVELOPE_SCHEMA_VERSION,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    attempt: input.attempt ?? 1,
    payload: input.payload,
  };
}

/** Validate untrusted queue data. Throws `InvalidJobEnvelopeError` with all issues. */
export function parseJobEnvelope<TPayload = unknown>(
  data: unknown,
): JobEnvelope<TPayload> {
  const result = jobEnvelopeSchema.safeParse(data);
  if (!result.success) {
    throw new InvalidJobEnvelopeError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data as JobEnvelope<TPayload>;
}

export function isJobEnvelope(data: unknown): data is JobEnvelope {
  return jobEnvelopeSchema.safeParse(data).success;
}

/** Return a copy of the envelope stamped with the attempt currently executing. */
export function withAttempt<TPayload>(
  envelope: JobEnvelope<TPayload>,
  attempt: number,
): JobEnvelope<TPayload> {
  return { ...envelope, attempt: Math.max(1, Math.trunc(attempt)) };
}
