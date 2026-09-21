/**
 * Job type registry.
 *
 * A job type is registered once with its payload schema, queue configuration,
 * and handler. The queue runtime derives everything it needs from the registry,
 * so adding a job kind never means editing queue plumbing.
 */

import type { z } from "zod";

export interface JobLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface JobContext {
  readonly jobId: string;
  readonly jobType: string;
  readonly correlationId: string;
  /** 1-based attempt for the current execution. */
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
  readonly logger: JobLogger;
}

export interface JobQueueConfig {
  /** Retries *after* the first attempt (pg-boss semantics). */
  retryLimit: number;
  retryDelaySeconds: number;
  retryBackoff: boolean;
  /** Seconds a single execution may run before it is considered expired. */
  expireInSeconds: number;
  /**
   * Enqueue-dedupe window, in seconds (pg-boss `singletonSeconds`). Two jobs
   * with the same idempotency key inside the same window collapse into one.
   *
   * This is a best-effort queue-level guard. The authoritative idempotency
   * arbiter is the domain row's UNIQUE constraint (Ticket 06 §7) — the queue
   * only prevents redundant work from being *scheduled*.
   */
  singletonSeconds: number;
  /** Dead-letter queue name. Defaults to `<jobType>.dlq`. */
  deadLetter?: string;
}

/** Delays match the [5, 30, 120] minute transient policy locked in Ticket 06 §9. */
export const DEFAULT_QUEUE_CONFIG: JobQueueConfig = {
  retryLimit: 3,
  retryDelaySeconds: 300,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
  singletonSeconds: 60,
};

export interface JobDefinition<TPayload = unknown> {
  readonly jobType: string;
  readonly description?: string;
  readonly payloadSchema: z.ZodType<TPayload>;
  readonly queue?: Partial<JobQueueConfig>;
  readonly handler: (payload: TPayload, ctx: JobContext) => Promise<void>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const registry = new Map<string, JobDefinition<any>>();

export class JobNotRegisteredError extends Error {
  constructor(jobType: string) {
    super(`No job registered for type "${jobType}"`);
    this.name = "JobNotRegisteredError";
  }
}

export function registerJob<TPayload>(definition: JobDefinition<TPayload>): void {
  if (!definition.jobType) throw new Error("jobType is required");
  if (registry.has(definition.jobType)) {
    throw new Error(`Job type "${definition.jobType}" is already registered`);
  }
  registry.set(definition.jobType, definition);
}

export function getJob(jobType: string): JobDefinition {
  const definition = registry.get(jobType);
  if (!definition) throw new JobNotRegisteredError(jobType);
  return definition;
}

export function hasJob(jobType: string): boolean {
  return registry.has(jobType);
}

export function listJobs(): JobDefinition[] {
  const jobs: JobDefinition[] = [];
  registry.forEach((definition) => jobs.push(definition));
  return jobs;
}

export function resolveQueueConfig(definition: JobDefinition): JobQueueConfig & {
  deadLetter: string;
} {
  const merged = { ...DEFAULT_QUEUE_CONFIG, ...definition.queue };
  return {
    ...merged,
    deadLetter: merged.deadLetter ?? `${definition.jobType}.dlq`,
  };
}

/** Test-only: clear all registrations. */
export function resetJobRegistry(): void {
  registry.clear();
}
