/**
 * Persistence for the research domain.
 *
 * Kept behind an interface so the engine is testable without a database, and so
 * the storage layer can migrate independently of orchestration.
 */

import { and, eq, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import {
  researchEvidence,
  researchJobs,
  researchSources,
  type ResearchEvidence,
  type ResearchJob,
  type ResearchSource,
} from "@shared/schema";
import { db as defaultDb } from "../db";

/** Database handle the storage layer writes to. Injected so tests can target a
 *  dedicated database without touching the application's connection. */
export type ResearchDatabase = NodePgDatabase<typeof schema>;
import type { NormalizedSource, ProviderCallDiagnostics } from "./contracts";
import type { DerivedEvidence } from "./engine-core";

export interface ClaimJobInput {
  correlationId: string;
  idempotencyKey: string;
  kind: "directed" | "autonomous" | "human_input";
  query?: string | null;
  providerIds: readonly string[];
  initiation: Record<string, unknown>;
  userId?: number | null;
}

export interface ClaimJobResult {
  job: ResearchJob;
  created: boolean;
}

export interface StoredSource {
  id: number;
  source: NormalizedSource;
}

export interface ResearchStoragePort {
  claimJob(input: ClaimJobInput): Promise<ClaimJobResult>;
  markRunning(jobId: number): Promise<void>;
  insertSources(jobId: number, sources: readonly NormalizedSource[]): Promise<StoredSource[]>;
  insertEvidence(jobId: number, evidence: readonly DerivedEvidence[], stored: readonly StoredSource[]): Promise<number>;
  markComplete(jobId: number, diagnostics: readonly ProviderCallDiagnostics[]): Promise<void>;
  markFailed(
    jobId: number,
    failureClass: string,
    message: string,
    diagnostics: readonly ProviderCallDiagnostics[],
  ): Promise<void>;
  getEvidenceForJob(jobId: number): Promise<Array<{ id: number; excerpt: string; kind: string }>>;
}

/**
 * Statuses that are final. Completed research and its evidence are immutable
 * (Ticket 03 §2), so every write path checks this first.
 */
const TERMINAL_STATUSES = new Set(["complete", "failed"]);

export class ResearchJobImmutableError extends Error {
  constructor(jobId: number, status: string) {
    super(`ResearchJob ${jobId} is ${status} and cannot be modified`);
    this.name = "ResearchJobImmutableError";
  }
}

export class DatabaseResearchStorage implements ResearchStoragePort {
  constructor(private readonly database: ResearchDatabase = defaultDb) {}

  async claimJob(input: ClaimJobInput): Promise<ClaimJobResult> {
    const existing = await this.database
      .select()
      .from(researchJobs)
      .where(eq(researchJobs.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing.length > 0) {
      return { job: existing[0], created: false };
    }

    const inserted = await this.database
      .insert(researchJobs)
      .values({
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        query: input.query ?? null,
        providerIds: [...input.providerIds],
        initiation: input.initiation,
        userId: input.userId ?? null,
        status: "queued",
      })
      // The unique index is the arbiter, not a prior SELECT (Ticket 06 §7).
      .onConflictDoNothing({ target: researchJobs.idempotencyKey })
      .returning();

    if (inserted.length > 0) return { job: inserted[0], created: true };

    const raced = await this.database
      .select()
      .from(researchJobs)
      .where(eq(researchJobs.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return { job: raced[0], created: false };
  }

  async markRunning(jobId: number): Promise<void> {
    // queued -> running on first execution; failed -> running when the queue
    // retries a transient failure. Completed jobs stay immutable.
    await this.database
      .update(researchJobs)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(researchJobs.id, jobId), ne(researchJobs.status, "complete")));
  }

  async insertSources(
    jobId: number,
    sources: readonly NormalizedSource[],
  ): Promise<StoredSource[]> {
    if (sources.length === 0) return [];

    const rows = sources.map((source) => ({
      jobId,
      provider: source.provider,
      backend: source.backend,
      kind: source.ref.kind,
      nativeId: source.ref.nativeId,
      canonicalUrl: source.canonicalUrl,
      title: source.title,
      author: source.author,
      publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
      retrievedAt: new Date(source.retrievedAt),
      retrievalMethod: source.retrievalMethod,
      accessClass: source.accessClass,
      providerVersion: source.providerVersion,
      integrationVersion: source.integrationVersion ?? null,
      contentHash: source.contentHash,
      excerpt: source.excerpt ?? null,
      metadata: source.metadata,
      warnings: source.warnings ?? [],
    }));

    const inserted = await this.database
      .insert(researchSources)
      .values(rows)
      .onConflictDoNothing({
        target: [researchSources.jobId, researchSources.canonicalUrl],
      })
      .returning({ id: researchSources.id, canonicalUrl: researchSources.canonicalUrl });

    const idByUrl = new Map(inserted.map((row) => [row.canonicalUrl, row.id]));

    // Re-read to include rows that lost the insert race, and to drop any that
    // were not persisted (never report a source the database rejected).
    const persisted = await this.database
      .select({ id: researchSources.id, canonicalUrl: researchSources.canonicalUrl })
      .from(researchSources)
      .where(eq(researchSources.jobId, jobId));
    const persistedByUrl = new Map(persisted.map((row) => [row.canonicalUrl, row.id]));

    const out: StoredSource[] = [];
    for (const source of sources) {
      const id = idByUrl.get(source.canonicalUrl) ?? persistedByUrl.get(source.canonicalUrl);
      if (id !== undefined) out.push({ id, source });
    }
    return out;
  }

  async insertEvidence(
    jobId: number,
    evidence: readonly DerivedEvidence[],
    stored: readonly StoredSource[],
  ): Promise<number> {
    if (evidence.length === 0) return 0;

    const rows = evidence.map((item) => ({
      jobId,
      sourceId: item.sourceIndex === null ? null : (stored[item.sourceIndex]?.id ?? null),
      kind: item.kind,
      origin: item.origin,
      excerpt: item.excerpt,
      excerptHash: item.excerptHash,
      retrievedAt: item.retrievedAt,
    }));

    const inserted = await this.database
      .insert(researchEvidence)
      .values(rows)
      .onConflictDoNothing({
        target: [
          researchEvidence.jobId,
          researchEvidence.sourceId,
          researchEvidence.excerptHash,
        ],
      })
      .returning({ id: researchEvidence.id });

    return inserted.length;
  }

  async markComplete(
    jobId: number,
    diagnostics: readonly ProviderCallDiagnostics[],
  ): Promise<void> {
    await this.database
      .update(researchJobs)
      .set({ status: "complete", finishedAt: new Date(), diagnostics: [...diagnostics] })
      .where(and(eq(researchJobs.id, jobId), eq(researchJobs.status, "running")));
  }

  async markFailed(
    jobId: number,
    failureClass: string,
    message: string,
    diagnostics: readonly ProviderCallDiagnostics[],
  ): Promise<void> {
    await this.database
      .update(researchJobs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorClass: failureClass,
        errorMessage: message,
        diagnostics: [...diagnostics],
      })
      .where(and(eq(researchJobs.id, jobId), eq(researchJobs.status, "running")));
  }

  async getEvidenceForJob(
    jobId: number,
  ): Promise<Array<{ id: number; excerpt: string; kind: string }>> {
    const rows = await this.database
      .select({
        id: researchEvidence.id,
        excerpt: researchEvidence.excerpt,
        kind: researchEvidence.kind,
      })
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, jobId));
    return rows;
  }

  async getJob(jobId: number): Promise<ResearchJob | undefined> {
    const rows = await this.database
      .select()
      .from(researchJobs)
      .where(eq(researchJobs.id, jobId))
      .limit(1);
    return rows[0];
  }

  async getJobByCorrelationId(correlationId: string): Promise<ResearchJob | undefined> {
    const rows = await this.database
      .select()
      .from(researchJobs)
      .where(eq(researchJobs.correlationId, correlationId))
      .limit(1);
    return rows[0];
  }

  async listSources(jobId: number): Promise<ResearchSource[]> {
    return this.database
      .select()
      .from(researchSources)
      .where(eq(researchSources.jobId, jobId))
      .orderBy(researchSources.id);
  }

  async listEvidence(jobId: number): Promise<ResearchEvidence[]> {
    return this.database
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, jobId))
      .orderBy(researchEvidence.id);
  }

  /** Evidence identities only — used by downstream provenance links (Story). */
  async listEvidenceIds(jobId: number): Promise<number[]> {
    const rows = await this.database
      .select({ id: researchEvidence.id })
      .from(researchEvidence)
      .where(eq(researchEvidence.jobId, jobId))
      .orderBy(researchEvidence.id);
    return rows.map((row) => row.id);
  }

  async isTerminal(jobId: number): Promise<boolean> {
    const job = await this.getJob(jobId);
    return job ? TERMINAL_STATUSES.has(job.status) : false;
  }

  async assertMutable(jobId: number): Promise<void> {
    const job = await this.getJob(jobId);
    if (job && TERMINAL_STATUSES.has(job.status)) {
      throw new ResearchJobImmutableError(jobId, job.status);
    }
  }
}
