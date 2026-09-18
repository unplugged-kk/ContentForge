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
import {
  analyzeResearch,
  depthBudget,
  expandQueries,
  filterByWindow,
  RESEARCH_LIMITS,
  resolveTimeWindow,
  type QueryExpansion,
  type ResearchAnalysis,
  type ResearchDepth,
  type ResolvedWindow,
} from "./intelligence";
import type { SeoContext, SeoProviderPort } from "./seo";
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
  depth?: ResearchDepth;
  seo?: boolean;
  /** Frozen expansion from a prior attempt of the same job. */
  expansion?: QueryExpansion;
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
  analysis?: ResearchAnalysis;
  seo?: SeoContext | null;
  failureClass?: string;
  failureMessage?: string;
}

export interface ResearchEngineDeps {
  executor: ProviderExecutor;
  storage: ResearchStoragePort;
  logSink?: LogSink;
  now?: () => Date;
  seo?: SeoProviderPort;
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
        window: resolveTimeWindow({ window: input.window, preset: input.window?.preset, asOf: input.window?.asOf }, this.now()),
        budget: input.budget ?? null,
        depth: input.depth ?? "standard",
        seo: input.seo ?? false,
        expansion: input.expansion ?? (input.query ? expandQueries(input.query, depthBudget(input.depth).maxExpandedQueries) : null),
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
    const budget = depthBudget(input.depth ?? "standard", input.limit);
    const timeoutMs = input.timeoutMs ?? budget.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = new Date(this.now().getTime() + timeoutMs);
    const resolvedWindow = resolveTimeWindow(
      { window: input.window, preset: input.window?.preset, asOf: input.window?.asOf },
      this.now(),
    );
    const expansion =
      input.expansion
      ?? (input.query ? expandQueries(input.query, budget.maxExpandedQueries) : null);

    await this.deps.storage.markRunning(job.id);

    const collected: NormalizedSource[] = [];
    const diagnostics: ProviderCallDiagnostics[] = [];

    try {
      if (input.kind !== "human_input") {
        const capability = capabilityFor(input.kind);
        const providerIds = input.providerIds.slice(0, RESEARCH_LIMITS.maxProviders);
        const concurrent = Math.min(RESEARCH_LIMITS.maxConcurrentProviders, Math.max(1, providerIds.length));
        for (let offset = 0; offset < providerIds.length; offset += concurrent) {
          const batch = providerIds.slice(offset, offset + concurrent);
          const outcomes = await Promise.all(
            batch.map((providerId) =>
              this.collectFromProvider(
                providerId,
                capability,
                { ...input, query: expansion?.original ?? input.query, window: resolvedWindow ?? input.window },
                correlationId,
                deadline,
              ),
            ),
          );
          for (const outcome of outcomes) {
            if (!outcome) continue;
            diagnostics.push(outcome.diagnostics);
            collected.push(...outcome.sources);
          }
        }

        const extraQueries = expansion?.expanded.slice(1) ?? [];
        const searchProviders = providerIds
          .filter((id) => this.deps.executor.supportsCapability(id, "search"))
          .slice(0, budget.extraSearchProviders);
        for (const extra of extraQueries) {
          if (collected.length >= budget.maxSources) break;
          if (searchProviders.length === 0) break;
          const extraOutcomes = await Promise.all(
            searchProviders.map((providerId) =>
              this.collectFromProvider(
                providerId,
                "search",
                { ...input, query: extra, window: resolvedWindow ?? input.window, limit: Math.min(5, budget.maxSources) },
                correlationId,
                deadline,
              ),
            ),
          );
          for (const outcome of extraOutcomes) {
            if (!outcome) continue;
            diagnostics.push(outcome.diagnostics);
            collected.push(...outcome.sources);
          }
        }
      }

      const { kept: deduped, dropped } = dedupeSources(collected);
      const windowed = filterByWindow(deduped, resolvedWindow);
      const kept = windowed.slice(0, budget.maxSources);

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

      const evidenceCount = await this.deps.storage.insertEvidence(job.id, derived.slice(0, RESEARCH_LIMITS.maxEvidence), stored);
      const collectionSummary = summarizeCollection(diagnostics);
      const prior = input.userId
        ? await this.deps.storage.listJobs(input.userId, 20)
        : [];
      const related = prior.filter((row) => row.id !== job.id && row.query === input.query).slice(0, 5);
      const priorUrls = (
        await Promise.all(related.slice(0, 3).map((row) => this.deps.storage.listSources(row.id)))
      ).flat().map((row) => row.canonicalUrl);

      let seo: SeoContext | null = null;
      if (input.seo && this.deps.seo && input.query) {
        const health = await this.deps.seo.health();
        if (health.available) {
          seo = await this.deps.seo.research(input.query);
        }
      }

      const analysis = analyzeResearch({
        query: input.query ?? "",
        sources: kept,
        diagnostics,
        summary: collectionSummary,
        window: resolvedWindow,
        expansion,
        depth: budget.depth,
        priorUrls,
        relatedJobIds: related.map((row) => row.id),
        now: this.now(),
      });
      if (seo) {
        (analysis as ResearchAnalysis & { seo?: SeoContext }).seo = seo;
      }
      await this.deps.storage.saveAnalysis(job.id, input.userId ?? job.userId ?? null, analysis);
      await this.deps.storage.markComplete(job.id, diagnostics);

      this.log(
        {
          correlationId,
          jobId: job.id,
          sourceCount: kept.length,
          evidenceCount,
          droppedCount: dropped.length,
          providers: input.providerIds.length,
          quality: analysis.quality,
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
        analysis,
        seo,
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
