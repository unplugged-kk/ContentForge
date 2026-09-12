/**
 * Durable job runtime (pg-boss).
 *
 * Locked decision (Ticket 06 §6): pg-boss is the queue. Redis/BullMQ are not
 * used. This module owns queue lifecycle, enqueue, worker dispatch, retry
 * classification, dead-lettering, and graceful shutdown — nothing domain
 * specific.
 *
 * Retry semantics map onto pg-boss like this:
 *   transient      -> throw; pg-boss retries with backoff, then auto dead-letters
 *   rate_limited   -> re-queue after the supplied delay and complete this
 *                     execution, so throttling never consumes an attempt
 *   permanent      -> copy to the dead-letter queue and complete (no retry)
 *   policy_human   -> same as permanent; never auto-retried
 *
 * pg-boss is pinned to v10 because the project targets Node 20 (`.nvmrc`,
 * Dockerfile, CI); v11+ requires Node >= 22.
 */

import PgBoss from "pg-boss";
import {
  createJobEnvelope,
  parseJobEnvelope,
  withAttempt,
  type JobEnvelope,
} from "./envelope";
import {
  JobFailure,
  classifyError,
  describeError,
  dispositionFor,
} from "./failures";
import { createJobScopedLogger, type LogSink } from "./logger";
import {
  getJob,
  listJobs,
  resolveQueueConfig,
  type JobContext,
  type JobDefinition,
} from "./registry";

export const DEFAULT_PGBOSS_SCHEMA = "pgboss";

export interface JobRuntimeOptions {
  connectionString: string;
  /** Postgres schema for pg-boss internals. Kept out of `public`. */
  schema?: string;
  logSink?: LogSink;
  /** pg-boss connection pool size. */
  max?: number;
}

export interface EnqueueInput<TPayload> {
  jobType: string;
  payload: TPayload;
  correlationId: string;
  idempotencyKey: string;
  /** Delay before the job becomes eligible. */
  startAfter?: Date | number;
}

export interface EnqueueResult {
  /** Queue job id, or null when an equivalent job was already queued (dedupe). */
  queueJobId: string | null;
  envelope: JobEnvelope;
  deduplicated: boolean;
}

export class JobRuntimeNotStartedError extends Error {
  constructor() {
    super("Job runtime has not been started");
    this.name = "JobRuntimeNotStartedError";
  }
}

type WorkerJob = PgBoss.JobWithMetadata<JobEnvelope>;

export class JobRuntime {
  private readonly options: JobRuntimeOptions & { schema: string };
  private boss: PgBoss | null = null;
  private readonly ensuredQueues = new Set<string>();
  private starting: Promise<void> | null = null;
  private stopping = false;

  constructor(options: JobRuntimeOptions) {
    this.options = { schema: DEFAULT_PGBOSS_SCHEMA, ...options };
  }

  getBoss(): PgBoss {
    if (!this.boss) throw new JobRuntimeNotStartedError();
    return this.boss;
  }

  isStarted(): boolean {
    return this.boss !== null;
  }

  async start(): Promise<void> {
    if (this.boss) return;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const boss = new PgBoss({
        connectionString: this.options.connectionString,
        schema: this.options.schema,
        ...(this.options.max ? { max: this.options.max } : {}),
      });

      boss.on("error", (error: unknown) => {
        this.options.logSink?.(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            msg: "pg-boss error",
            error: describeError(error),
          }),
        );
      });

      await boss.start();
      this.boss = boss;

      for (const definition of listJobs()) {
        await this.ensureQueue(definition);
        await this.registerWorker(definition);
      }
    })();

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.boss || this.stopping) return;
    this.stopping = true;
    const boss = this.boss;
    this.boss = null;
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
    } finally {
      this.stopping = false;
      this.ensuredQueues.clear();
    }
  }

  /** Register a job type that was registered *after* `start()`. */
  async registerLate(definition: JobDefinition): Promise<void> {
    await this.ensureQueue(definition);
    await this.registerWorker(definition);
  }

  async enqueue<TPayload>(input: EnqueueInput<TPayload>): Promise<EnqueueResult> {
    const definition = getJob(input.jobType);
    const payload = definition.payloadSchema.parse(input.payload);
    const envelope = createJobEnvelope({
      jobType: input.jobType,
      payload,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    });

    const queueJobId = await this.sendEnvelope(definition, envelope, {
      startAfter: input.startAfter,
    });

    return { queueJobId, envelope, deduplicated: queueJobId === null };
  }

  /** Re-queue a job that must be rescheduled rather than retried. */
  private async sendEnvelope(
    definition: JobDefinition,
    envelope: JobEnvelope,
    options: { startAfter?: Date | number } = {},
  ): Promise<string | null> {
    const boss = this.getBoss();
    await this.ensureQueue(definition);
    const config = resolveQueueConfig(definition);

    return boss.send(definition.jobType, envelope, {
      singletonKey: envelope.idempotencyKey,
      singletonSeconds: config.singletonSeconds,
      retryLimit: config.retryLimit,
      retryDelay: config.retryDelaySeconds,
      retryBackoff: config.retryBackoff,
      expireInSeconds: config.expireInSeconds,
      deadLetter: config.deadLetter,
      ...(options.startAfter !== undefined ? { startAfter: options.startAfter } : {}),
    });
  }

  private async ensureQueue(definition: JobDefinition): Promise<void> {
    const boss = this.getBoss();
    const config = resolveQueueConfig(definition);

    if (!this.ensuredQueues.has(config.deadLetter)) {
      await boss.createQueue(config.deadLetter, {
        name: config.deadLetter,
        retryLimit: 0,
        expireInSeconds: config.expireInSeconds,
      });
      this.ensuredQueues.add(config.deadLetter);
    }

    if (!this.ensuredQueues.has(definition.jobType)) {
      await boss.createQueue(definition.jobType, {
        name: definition.jobType,
        retryLimit: config.retryLimit,
        retryDelay: config.retryDelaySeconds,
        retryBackoff: config.retryBackoff,
        expireInSeconds: config.expireInSeconds,
        deadLetter: config.deadLetter,
      });
      this.ensuredQueues.add(definition.jobType);
    }
  }

  private async registerWorker(definition: JobDefinition): Promise<void> {
    const boss = this.getBoss();

    await boss.work(
      definition.jobType,
      { includeMetadata: true },
      async (jobs: WorkerJob[]) => {
        for (const job of jobs) {
          await this.executeOne(definition, job);
        }
      },
    );
  }

  private async executeOne(definition: JobDefinition, job: WorkerJob): Promise<void> {
    const startedAt = Date.now();
    let envelope: JobEnvelope;

    // Queue data is untrusted input: validate before use.
    try {
      envelope = parseJobEnvelope(job.data);
    } catch (error) {
      await this.deadLetter(definition, job.data, {
        reason: "invalid_envelope",
        error: describeError(error),
      });
      return;
    }

    const attempt = Math.max(job.retryCount + 1, envelope.attempt);
    envelope = withAttempt(envelope, attempt);

    const maxAttempts = job.retryLimit + 1;
    const logger = createJobScopedLogger(
      {
        jobType: definition.jobType,
        jobId: job.id,
        correlationId: envelope.correlationId,
        attempt,
      },
      this.options.logSink,
    );

    const ctx: JobContext = {
      jobId: job.id,
      jobType: definition.jobType,
      correlationId: envelope.correlationId,
      attempt,
      maxAttempts,
      idempotencyKey: envelope.idempotencyKey,
      signal: AbortSignal.timeout(job.expireInSeconds * 1000),
      logger,
    };

    try {
      const payload = definition.payloadSchema.parse(envelope.payload);
      await definition.handler(payload, ctx);
      logger.info(
        { durationMs: Date.now() - startedAt, outcome: "completed" },
        "job completed",
      );
      return;
    } catch (error) {
      const failureClass = classifyError(error);
      const disposition = dispositionFor(failureClass);
      const message = describeError(error);
      const durationMs = Date.now() - startedAt;

      if (disposition === "reschedule") {
        const retryAfterMs =
          error instanceof JobFailure && error.retryAfterMs !== undefined
            ? error.retryAfterMs
            : 60_000;
        try {
          await this.sendEnvelope(definition, envelope, {
            startAfter: new Date(Date.now() + retryAfterMs),
          });
          logger.warn(
            { failureClass, outcome: "rescheduled", retryAfterMs, durationMs },
            "job rescheduled",
          );
          return;
        } catch (requeueError) {
          logger.error(
            { failureClass, outcome: "reschedule_failed", error: describeError(requeueError) },
            "job reschedule failed",
          );
          throw error;
        }
      }

      if (disposition === "terminal") {
        await this.deadLetter(definition, envelope, { failureClass, error: message });
        logger.error(
          { failureClass, outcome: "deadletter", durationMs, error: message },
          "job failed terminally",
        );
        return;
      }

      // Transient: rethrow so pg-boss applies retry/backoff and dead-letters on
      // exhaustion.
      logger.warn(
        { failureClass, outcome: "retry", durationMs, error: message },
        "job failed, will retry",
      );
      throw error;
    }
  }

  private async deadLetter(
    definition: JobDefinition,
    payload: unknown,
    detail: Record<string, unknown>,
  ): Promise<void> {
    const boss = this.getBoss();
    const config = resolveQueueConfig(definition);
    try {
      await boss.send(config.deadLetter, {
        jobType: definition.jobType,
        failedAt: new Date().toISOString(),
        ...detail,
        envelope: payload,
      });
    } catch (error) {
      this.options.logSink?.(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          msg: "failed to write dead-letter record",
          jobType: definition.jobType,
          error: describeError(error),
        }),
      );
    }
  }
}
