/**
 * Research engine.
 *
 * Owns orchestration, budgets, deadlines, provider selection policy, dedupe,
 * evidence derivation, provenance, and completion. It contains no provider
 * specifics: it asks the registry for a capability and receives
 * `NormalizedSource`.
 *
 * See plans/contentforge-product/RESEARCH-PROVIDERS.md §7, §10, §17.
 */

import { randomUUID } from "node:crypto";
import type { ResearchJob } from "@shared/schema";
import type { LogSink } from "../jobs/logger";
import { JobFailure, describeError } from "../jobs/failures";
import type {
  Capability,
  NormalizedSource,
  ProviderBudget,
  ProviderCallDiagnostics,
  TimeWindow,
} from "./contracts";
import {
  authorStatementEvidence,
  classifyEmptyCollection,
  dedupeSources,
  deriveEvidence,
  summarizeCollection,
  type DerivedEvidence,
  type DroppedSource,
  validateResearch,
} from "./engine-core";
import type { ProviderExecutor } from "./registry";
import type { ResearchStoragePort, StoredSource } from "./storage";

export type InitiationKind = "directed" | "autonomous" | "human_input";

export interface ResearchRunInput {
  kind: InitiationKind;
  /** Directed queries and autonomous topic seeds use the same field. */
  query?: string;
  /** Ordered provider ids. The engine stays blind to what they are. */
  providerIds: readonly string[];
  /** Required for `human_input`; becomes `author_statement` evidence. */
  authorStatement?: string;
  limit?: number;
  window?: TimeWindow;
  budget?: ProviderBudget;
  timeoutMs?: number;
  /** Defaults to a generated id; supply to make a run reproducible/idempotent. */
  correlationId?: string;
  idempotencyKey?: string;
  userId?: number | null;
  /**
   * Per-provider config slices, resolved by the caller (the job handler) so the
   * engine never learns where a provider keeps its configuration.
   */
  providerConfig?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface ResearchRunResult {
  jobId: number;
  correlationId: string;
  status: "complete" | "failed";
  reused: boolean;
  sourceCount: number;
  evidenceCount: number;
  droppedCount: number;
  dropped: DroppedSource[];
  diagnostics: ProviderCallDiagnostics[];
  failureClass?: string;
  failureMessage?: string;
}

export interface ResearchEngineDeps {
  executor: ProviderExecutor;
  storage: ResearchStoragePort;
  logSink?: LogSink;
  now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Directed work asks for `search`; autonomous work browses via `discover`. */
function capabilityFor(kind: InitiationKind): Capability {
  return kind === "autonomous" ? "discover" : "search";
}

export class ResearchEngine {
  private readonly deps: ResearchEngineDeps;
  private readonly now: () => Date;

  constructor(deps: ResearchEngineDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
  }

  async run(input: ResearchRunInput): Promise<ResearchRunResult> {
    this.assertRunnable(input);

    const correlationId = input.correlationId ?? randomUUID();
    const idempotencyKey = input.idempotencyKey ?? `research:${input.kind}:${correlationId}`;

    const { job, created } = await this.deps.storage.claimJob({
      correlationId,
      idempotencyKey,
      kind: input.kind,
      query: input.query ?? null,
      providerIds: input.providerIds,
      initiation: {
        kind: input.kind,
        query: input.query ?? null,
        limit: input.limit ?? null,
        window: input.window ?? null,
        budget: input.budget ?? null,
        // The statement itself is stored as evidence, not duplicated here.
        hasAuthorStatement: Boolean(input.authorStatement),
      },
      userId: input.userId ?? null,
    });

    // Idempotency: a repeated run for the same key reuses the existing job and
    // never mutates history (Ticket 04 §1).
    if (!created) return this.reusedResult(job);

    return this.execute(job, input, correlationId);
  }

  /**
   * Execute a ResearchJob that was already persisted. This is the durable path:
   * the API creates the row (so it is inspectable immediately) and the queue
   * worker runs it. Unlike `run`, this does not claim by idempotency key — a
   * retried delivery re-executes the same job instead of short-circuiting on
   * "already exists". Completed jobs are never re-run.
   */
  async executeJob(job: ResearchJob, input: ResearchRunInput): Promise<ResearchRunResult> {
    if (job.status === "complete") return this.reusedResult(job);
    return this.execute(job, input, job.correlationId);
  }

  private assertRunnable(input: ResearchRunInput): void {
    if (input.kind === "human_input" && !input.authorStatement?.trim()) {
      throw new Error("human_input research requires an authorStatement");
    }
    if (input.kind !== "human_input" && !input.query?.trim()) {
      throw new Error(`${input.kind} research requires a query`);
    }
  }

  private async reusedResult(job: ResearchJob): Promise<ResearchRunResult> {
    this.log(
      { correlationId: job.correlationId, jobId: job.id },
      "research run reused existing job",
    );
    const evidence = await this.deps.storage.getEvidenceForJob(job.id);
    return {
      jobId: job.id,
      correlationId: job.correlationId,
      status: job.status === "complete" ? "complete" : "failed",
      reused: true,
      sourceCount: 0,
      evidenceCount: evidence.length,
      droppedCount: 0,
      dropped: [],
      diagnostics: [],
      failureClass: job.errorClass ?? undefined,
      failureMessage: job.errorMessage ?? undefined,
    };
  }

  private async execute(
    job: ResearchJob,
    input: ResearchRunInput,
    correlationId: string,
  ): Promise<ResearchRunResult> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = new Date(this.now().getTime() + timeoutMs);

    await this.deps.storage.markRunning(job.id);

    const collected: NormalizedSource[] = [];
    const diagnostics: ProviderCallDiagnostics[] = [];

    try {
      if (input.kind !== "human_input") {
        const capability = capabilityFor(input.kind);
        for (const providerId of input.providerIds) {
          const outcome = await this.collectFromProvider(
            providerId,
            capability,
            input,
            correlationId,
            deadline,
          );
          if (outcome) {
            diagnostics.push(outcome.diagnostics);
            collected.push(...outcome.sources);
          }
        }
      }

      const { kept, dropped } = dedupeSources(collected);

      // Zero sources survived: distinguish "every provider failed" (a recoverable
      // job failure that the queue should retry/reschedule) from "providers ran
      // but produced nothing usable" (a permanent outcome). Locked Ticket 04 §2;
      // the decision itself lives in the pure `classifyEmptyCollection`.
      if (kept.length === 0) {
        const summary = summarizeCollection(diagnostics);
        const classified = classifyEmptyCollection(summary);
        if (classified) {
          await this.deps.storage.markFailed(
            job.id,
            classified.failureClass,
            classified.message,
            diagnostics,
          );
          this.log(
            {
              correlationId,
              jobId: job.id,
              failureClass: classified.failureClass,
              attempted: summary.attempted,
              failed: summary.failed,
              skipped: summary.skipped,
            },
            classified.message,
          );
          return {
            jobId: job.id,
            correlationId,
            status: "failed",
            reused: false,
            sourceCount: 0,
            evidenceCount: 0,
            droppedCount: dropped.length,
            dropped,
            diagnostics,
            failureClass: classified.failureClass,
            failureMessage: classified.message,
          };
        }
      }

      // Persist sources, then derive evidence against the stored ids so
      // provenance survives (Ticket 04 §5).
      const stored: StoredSource[] = await this.deps.storage.insertSources(job.id, kept);

      const derived: DerivedEvidence[] = deriveEvidence(kept);
      if (input.authorStatement) {
        derived.push(authorStatementEvidence(input.authorStatement, this.now()));
      }

      const validity = validateResearch({ sources: kept, evidence: derived });
      if (!validity.valid) {
        const message = `Research produced no usable evidence (${validity.reasons.join(", ")})`;
        await this.deps.storage.markFailed(job.id, "permanent", message, diagnostics);
        this.log({ correlationId, jobId: job.id, reasons: validity.reasons }, message);
        return {
          jobId: job.id,
          correlationId,
          status: "failed",
          reused: false,
          sourceCount: kept.length,
          evidenceCount: 0,
          droppedCount: dropped.length,
          dropped,
          diagnostics,
          failureClass: "permanent",
          failureMessage: message,
        };
      }

      const evidenceCount = await this.deps.storage.insertEvidence(job.id, derived, stored);
      await this.deps.storage.markComplete(job.id, diagnostics);

      this.log(
        {
          correlationId,
          jobId: job.id,
          sourceCount: kept.length,
          evidenceCount,
          droppedCount: dropped.length,
          providers: input.providerIds.length,
        },
        "research completed",
      );

      return {
        jobId: job.id,
        correlationId,
        status: "complete",
        reused: false,
        sourceCount: kept.length,
        evidenceCount,
        droppedCount: dropped.length,
        dropped,
        diagnostics,
      };
    } catch (error) {
      const failureClass = error instanceof JobFailure ? error.failureClass : "transient";
      const message = describeError(error);
      await this.deps.storage.markFailed(job.id, failureClass, message, diagnostics);
      this.log({ correlationId, jobId: job.id, failureClass, error: message }, "research failed");
      return {
        jobId: job.id,
        correlationId,
        status: "failed",
        reused: false,
        sourceCount: collected.length,
        evidenceCount: 0,
        droppedCount: 0,
        dropped: [],
        diagnostics,
        failureClass,
        failureMessage: message,
      };
    }
  }

  /**
   * One provider call, isolated so a single provider failure degrades to a
   * partial result instead of failing the job (Ticket 04 §2).
   */
  private async collectFromProvider(
    providerId: string,
    capability: Capability,
    input: ResearchRunInput,
    correlationId: string,
    deadline: Date,
  ): Promise<{ sources: NormalizedSource[]; diagnostics: ProviderCallDiagnostics } | null> {
    const startedAt = Date.now();

    if (!this.deps.executor.supportsCapability(providerId, capability)) {
      this.log(
        { correlationId, provider: providerId, capability },
        "provider skipped: capability unsupported",
      );
      return {
        sources: [],
        diagnostics: {
          provider: providerId,
          backend: null,
          capability,
          outcome: "skipped",
          message: "capability unsupported",
          fallbackOccurred: false,
          backendsAttempted: [],
          latencyMs: 0,
          resultCount: 0,
        },
      };
    }

    const ctx = {
      correlationId,
      deadline,
      budget: input.budget ?? {},
      config: input.providerConfig?.[providerId] ?? {},
      signal: AbortSignal.timeout(Math.max(1, deadline.getTime() - Date.now())),
    };

    try {
      const result =
        capability === "search"
          ? await this.deps.executor.search(providerId, ctx, {
              text: input.query ?? "",
              limit: input.limit,
              window: input.window,
            })
          : await this.deps.executor.discover(providerId, {
              ...ctx,
              limit: input.limit,
              window: input.window,
            });
      return { sources: result.data, diagnostics: result.diagnostics };
    } catch (error) {
      // ProviderUnavailableError carries diagnostics; anything else is recorded
      // generically so the job still completes with partial data.
      const embedded =
        typeof error === "object" && error !== null && "diagnostics" in error
          ? (error as { diagnostics: ProviderCallDiagnostics }).diagnostics
          : undefined;
      const diagnostics: ProviderCallDiagnostics =
        embedded ??
        {
          provider: providerId,
          backend: null,
          capability,
          outcome: "failed",
          failureClass: error instanceof JobFailure ? error.failureClass : "transient",
          message: describeError(error),
          fallbackOccurred: false,
          backendsAttempted: [],
          latencyMs: Date.now() - startedAt,
          resultCount: 0,
        };
      this.log(
        { correlationId, provider: providerId, capability, error: diagnostics.message },
        "provider failed; continuing with partial research",
      );
      return { sources: [], diagnostics };
    }
  }

  private log(fields: Record<string, unknown>, message: string): void {
    if (!this.deps.logSink) return;
    this.deps.logSink(
      JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: message, ...fields }),
    );
  }
}
