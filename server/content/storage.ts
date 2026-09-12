/**
 * Persistence for the core content lifecycle.
 *
 * ResearchJob → Story → Opportunity → GenerationJob → Artifact → Schedule
 * (series + occurrences) → Publication → Result. One storage layer because the
 * entities form one chain and share the same durability rules; the domain
 * *decisions* live in the per-boundary service files, not here.
 *
 * Behind an interface so services are testable without a database.
 */

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import {
  artifacts,
  generationJobs,
  opportunities,
  publications,
  results,
  scheduleOccurrences,
  schedules,
  type Artifact,
  type ArtifactReadiness,
  type GenerationJob,
  type Opportunity,
  type OpportunityStatus,
  type Publication,
  type PublicationState,
  type Result,
  type Schedule,
  type ScheduleOccurrence,
} from "@shared/schema";
import { db as defaultDb } from "../db";

export type ContentDatabase = NodePgDatabase<typeof schema>;

export type JsonRecord = Record<string, unknown>;

// ── Opportunity ───────────────────────────────────────────────────────────────
export interface InsertOpportunityRow {
  userId?: number | null;
  storyId: number;
  concept: string;
  objective: string;
  audience: string | null;
  angle: string | null;
  format: string;
  channel: string;
  status: OpportunityStatus;
  score: string | null;
  scoreBreakdown: JsonRecord;
  proposer: string;
}

// ── GenerationJob ─────────────────────────────────────────────────────────────
export interface InsertGenerationJobRow {
  userId?: number | null;
  opportunityId: number;
  format: string;
  channel: string;
  policySnapshot: JsonRecord;
  idempotencyKey: string;
  correlationId: string;
  priorArtifactId: number | null;
  rejectionReason: string | null;
}

export interface ClaimGenerationJobResult {
  job: GenerationJob;
  created: boolean;
}

// ── Artifact ──────────────────────────────────────────────────────────────────
export interface InsertArtifactRow {
  userId?: number | null;
  generationJobId: number | null;
  opportunityId: number;
  format: string;
  channel: string;
  payload: JsonRecord;
  readiness: ArtifactReadiness;
  supersedesId: number | null;
  provenance: string;
  attribution: unknown[];
  attributionReason: string | null;
}

// ── Schedule / Occurrence ─────────────────────────────────────────────────────
export interface InsertScheduleRow {
  userId?: number | null;
  artifactId: number;
  channel: string;
  recurrence: string | null;
  timezone: string;
  count: number;
  startAt: Date;
}

// ── Publication ───────────────────────────────────────────────────────────────
export interface InsertPublicationRow {
  userId?: number | null;
  scheduleId: number;
  occurrenceId: number;
  artifactId: number;
  channel: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface ClaimPublicationResult {
  publication: Publication;
  created: boolean;
}

// ── Result ────────────────────────────────────────────────────────────────────
export interface InsertResultRow {
  userId?: number | null;
  publicationId: number;
  outcome: string;
  externalId: string | null;
  externalUrl: string | null;
  publishedAt: Date | null;
  metrics: JsonRecord;
  source: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  correlationId: string | null;
}

export interface ContentStoragePort {
  insertOpportunity(row: InsertOpportunityRow): Promise<Opportunity>;
  getOpportunity(id: number): Promise<Opportunity | undefined>;
  listOpportunitiesByStory(storyId: number): Promise<Opportunity[]>;
  updateOpportunityStatus(
    id: number,
    status: OpportunityStatus,
    killReason: string | null,
  ): Promise<Opportunity | undefined>;

  claimGenerationJob(row: InsertGenerationJobRow): Promise<ClaimGenerationJobResult>;
  getGenerationJob(id: number): Promise<GenerationJob | undefined>;
  markGenerationRunning(id: number): Promise<void>;
  markGenerationSucceeded(
    id: number,
    meta: { model: string | null; provider: string | null; cost: string | null; attempt: number },
  ): Promise<void>;
  markGenerationFailed(
    id: number,
    failureClass: string,
    message: string,
    attempt: number,
  ): Promise<void>;

  insertArtifact(row: InsertArtifactRow): Promise<Artifact>;
  getArtifact(id: number): Promise<Artifact | undefined>;
  getArtifactByGenerationJob(generationJobId: number): Promise<Artifact | undefined>;
  listArtifactsByOpportunity(opportunityId: number): Promise<Artifact[]>;
  setArtifactReadiness(
    id: number,
    readiness: ArtifactReadiness,
    approvedAt: Date | null,
  ): Promise<Artifact | undefined>;
  listArtifactsByOpportunityAndReadiness(
    opportunityId: number,
    readiness: ArtifactReadiness,
  ): Promise<Artifact[]>;

  insertSchedule(row: InsertScheduleRow): Promise<Schedule>;
  getSchedule(id: number): Promise<Schedule | undefined>;
  listSchedulesByArtifact(artifactId: number): Promise<Schedule[]>;
  listActiveSchedules(now: Date, limit: number): Promise<Schedule[]>;
  setScheduleStatus(id: number, status: string): Promise<void>;

  materializeOccurrence(scheduleId: number, at: Date): Promise<ScheduleOccurrence | undefined>;
  getOccurrence(id: number): Promise<ScheduleOccurrence | undefined>;
  getOccurrenceByScheduleTime(scheduleId: number, at: Date): Promise<ScheduleOccurrence | undefined>;
  listDueOccurrences(now: Date, limit: number): Promise<ScheduleOccurrence[]>;
  markOccurrenceStatus(id: number, status: string): Promise<void>;

  claimPublication(row: InsertPublicationRow): Promise<ClaimPublicationResult>;
  getPublication(id: number): Promise<Publication | undefined>;
  acquirePublicationLease(
    id: number,
    owner: string,
    leaseMs: number,
  ): Promise<Publication | undefined>;
  updatePublication(
    id: number,
    patch: {
      state?: PublicationState;
      attempt?: number;
      providerCalled?: boolean;
      externalId?: string | null;
      lastError?: string | null;
      releaseLease?: boolean;
    },
  ): Promise<void>;
  listStalePublishing(now: Date, limit: number): Promise<Publication[]>;

  insertResult(row: InsertResultRow): Promise<Result | undefined>;
  getResultByPublication(publicationId: number): Promise<Result | undefined>;
}

export class DatabaseContentStorage implements ContentStoragePort {
  constructor(private readonly database: ContentDatabase = defaultDb) {}

  // ── Opportunity ─────────────────────────────────────────────────────────────
  async insertOpportunity(row: InsertOpportunityRow): Promise<Opportunity> {
    const [inserted] = await this.database.insert(opportunities).values(row).returning();
    return inserted;
  }

  async getOpportunity(id: number): Promise<Opportunity | undefined> {
    const [row] = await this.database
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, id))
      .limit(1);
    return row;
  }

  async listOpportunitiesByStory(storyId: number): Promise<Opportunity[]> {
    return this.database
      .select()
      .from(opportunities)
      .where(eq(opportunities.storyId, storyId))
      .orderBy(asc(opportunities.id));
  }

  async updateOpportunityStatus(
    id: number,
    status: OpportunityStatus,
    killReason: string | null,
  ): Promise<Opportunity | undefined> {
    const [row] = await this.database
      .update(opportunities)
      .set({ status, killReason, updatedAt: new Date() })
      .where(eq(opportunities.id, id))
      .returning();
    return row;
  }

  // ── GenerationJob ───────────────────────────────────────────────────────────
  async claimGenerationJob(row: InsertGenerationJobRow): Promise<ClaimGenerationJobResult> {
    const inserted = await this.database
      .insert(generationJobs)
      .values({ ...row, status: "queued" })
      .onConflictDoNothing({ target: generationJobs.idempotencyKey })
      .returning();

    if (inserted.length > 0) return { job: inserted[0], created: true };

    const [existing] = await this.database
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.idempotencyKey, row.idempotencyKey))
      .limit(1);
    return { job: existing, created: false };
  }

  async getGenerationJob(id: number): Promise<GenerationJob | undefined> {
    const [row] = await this.database
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, id))
      .limit(1);
    return row;
  }

  async markGenerationRunning(id: number): Promise<void> {
    await this.database
      .update(generationJobs)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(generationJobs.id, id), eq(generationJobs.status, "queued")));
  }

  async markGenerationSucceeded(
    id: number,
    meta: { model: string | null; provider: string | null; cost: string | null; attempt: number },
  ): Promise<void> {
    await this.database
      .update(generationJobs)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        model: meta.model,
        provider: meta.provider,
        cost: meta.cost,
        attempt: meta.attempt,
        errorClass: null,
        errorMessage: null,
      })
      .where(eq(generationJobs.id, id));
  }

  async markGenerationFailed(
    id: number,
    failureClass: string,
    message: string,
    attempt: number,
  ): Promise<void> {
    await this.database
      .update(generationJobs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorClass: failureClass,
        errorMessage: message,
        attempt,
      })
      .where(eq(generationJobs.id, id));
  }

  // ── Artifact ────────────────────────────────────────────────────────────────
  async insertArtifact(row: InsertArtifactRow): Promise<Artifact> {
    const [inserted] = await this.database.insert(artifacts).values(row).returning();
    return inserted;
  }

  async getArtifact(id: number): Promise<Artifact | undefined> {
    const [row] = await this.database.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
    return row;
  }

  async getArtifactByGenerationJob(generationJobId: number): Promise<Artifact | undefined> {
    const [row] = await this.database
      .select()
      .from(artifacts)
      .where(eq(artifacts.generationJobId, generationJobId))
      .limit(1);
    return row;
  }

  async listArtifactsByOpportunity(opportunityId: number): Promise<Artifact[]> {
    return this.database
      .select()
      .from(artifacts)
      .where(eq(artifacts.opportunityId, opportunityId))
      .orderBy(asc(artifacts.id));
  }

  async listArtifactsByOpportunityAndReadiness(
    opportunityId: number,
    readiness: ArtifactReadiness,
  ): Promise<Artifact[]> {
    return this.database
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.opportunityId, opportunityId), eq(artifacts.readiness, readiness)))
      .orderBy(asc(artifacts.id));
  }

  async setArtifactReadiness(
    id: number,
    readiness: ArtifactReadiness,
    approvedAt: Date | null,
  ): Promise<Artifact | undefined> {
    const [row] = await this.database
      .update(artifacts)
      .set({ readiness, approvedAt })
      .where(eq(artifacts.id, id))
      .returning();
    return row;
  }

  // ── Schedule / Occurrence ───────────────────────────────────────────────────
  async insertSchedule(row: InsertScheduleRow): Promise<Schedule> {
    const [inserted] = await this.database.insert(schedules).values(row).returning();
    return inserted;
  }

  async getSchedule(id: number): Promise<Schedule | undefined> {
    const [row] = await this.database.select().from(schedules).where(eq(schedules.id, id)).limit(1);
    return row;
  }

  async listSchedulesByArtifact(artifactId: number): Promise<Schedule[]> {
    return this.database
      .select()
      .from(schedules)
      .where(eq(schedules.artifactId, artifactId))
      .orderBy(asc(schedules.id));
  }

  async listActiveSchedules(now: Date, limit: number): Promise<Schedule[]> {
    return this.database
      .select()
      .from(schedules)
      .where(and(eq(schedules.status, "active"), lte(schedules.startAt, now)))
      .orderBy(asc(schedules.startAt))
      .limit(limit);
  }

  async setScheduleStatus(id: number, status: string): Promise<void> {
    await this.database
      .update(schedules)
      .set({ status, updatedAt: new Date() })
      .where(eq(schedules.id, id));
  }

  async materializeOccurrence(
    scheduleId: number,
    at: Date,
  ): Promise<ScheduleOccurrence | undefined> {
    const inserted = await this.database
      .insert(scheduleOccurrences)
      .values({ scheduleId, occurrenceTime: at })
      .onConflictDoNothing({
        target: [scheduleOccurrences.scheduleId, scheduleOccurrences.occurrenceTime],
      })
      .returning();
    if (inserted.length > 0) return inserted[0];
    const [existing] = await this.database
      .select()
      .from(scheduleOccurrences)
      .where(
        and(
          eq(scheduleOccurrences.scheduleId, scheduleId),
          eq(scheduleOccurrences.occurrenceTime, at),
        ),
      )
      .limit(1);
    return existing;
  }

  async getOccurrence(id: number): Promise<ScheduleOccurrence | undefined> {
    const [row] = await this.database
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.id, id))
      .limit(1);
    return row;
  }

  async getOccurrenceByScheduleTime(
    scheduleId: number,
    at: Date,
  ): Promise<ScheduleOccurrence | undefined> {
    const [row] = await this.database
      .select()
      .from(scheduleOccurrences)
      .where(
        and(
          eq(scheduleOccurrences.scheduleId, scheduleId),
          eq(scheduleOccurrences.occurrenceTime, at),
        ),
      )
      .limit(1);
    return row;
  }

  async listDueOccurrences(now: Date, limit: number): Promise<ScheduleOccurrence[]> {
    return this.database
      .select()
      .from(scheduleOccurrences)
      .where(
        and(eq(scheduleOccurrences.status, "pending"), lte(scheduleOccurrences.occurrenceTime, now)),
      )
      .orderBy(asc(scheduleOccurrences.occurrenceTime))
      .limit(limit);
  }

  async markOccurrenceStatus(id: number, status: string): Promise<void> {
    await this.database
      .update(scheduleOccurrences)
      .set({ status })
      .where(eq(scheduleOccurrences.id, id));
  }

  // ── Publication ─────────────────────────────────────────────────────────────
  async claimPublication(row: InsertPublicationRow): Promise<ClaimPublicationResult> {
    const inserted = await this.database
      .insert(publications)
      .values({ ...row, state: "queued" })
      .onConflictDoNothing({ target: publications.idempotencyKey })
      .returning();
    if (inserted.length > 0) return { publication: inserted[0], created: true };

    const [existing] = await this.database
      .select()
      .from(publications)
      .where(eq(publications.idempotencyKey, row.idempotencyKey))
      .limit(1);
    return { publication: existing, created: false };
  }

  async getPublication(id: number): Promise<Publication | undefined> {
    const [row] = await this.database
      .select()
      .from(publications)
      .where(eq(publications.id, id))
      .limit(1);
    return row;
  }

  /**
   * Single-flight lease: only one worker may hold a publication in `publishing`.
   * Acquisition is a conditional UPDATE, so it is atomic under concurrency.
   */
  async acquirePublicationLease(
    id: number,
    owner: string,
    leaseMs: number,
  ): Promise<Publication | undefined> {
    const now = new Date();
    const expires = new Date(now.getTime() + leaseMs);
    const rows = await this.database
      .update(publications)
      .set({
        state: "publishing",
        leaseOwner: owner,
        leaseExpiresAt: expires,
        attempt: sql`${publications.attempt} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(publications.id, id),
          inArray(publications.state, ["scheduled", "queued", "publishing", "failed"]),
          or(
            isNull(publications.leaseExpiresAt),
            lt(publications.leaseExpiresAt, now),
            eq(publications.leaseOwner, owner),
          ),
        ),
      )
      .returning();
    return rows[0];
  }

  async updatePublication(
    id: number,
    patch: {
      state?: PublicationState;
      attempt?: number;
      providerCalled?: boolean;
      externalId?: string | null;
      lastError?: string | null;
      releaseLease?: boolean;
    },
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.state !== undefined) set.state = patch.state;
    if (patch.attempt !== undefined) set.attempt = patch.attempt;
    if (patch.providerCalled !== undefined) set.providerCalled = patch.providerCalled;
    if (patch.externalId !== undefined) set.externalId = patch.externalId;
    if (patch.lastError !== undefined) set.lastError = patch.lastError;
    if (patch.releaseLease) {
      set.leaseOwner = null;
      set.leaseExpiresAt = null;
    }
    await this.database.update(publications).set(set).where(eq(publications.id, id));
  }

  async listStalePublishing(now: Date, limit: number): Promise<Publication[]> {
    return this.database
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.state, "publishing"),
          lt(publications.leaseExpiresAt, now),
        ),
      )
      .orderBy(asc(publications.id))
      .limit(limit);
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  async insertResult(row: InsertResultRow): Promise<Result | undefined> {
    const inserted = await this.database
      .insert(results)
      .values(row)
      .onConflictDoNothing({ target: results.publicationId })
      .returning();
    if (inserted.length > 0) return inserted[0];
    return this.getResultByPublication(row.publicationId);
  }

  async getResultByPublication(publicationId: number): Promise<Result | undefined> {
    const [row] = await this.database
      .select()
      .from(results)
      .where(eq(results.publicationId, publicationId))
      .limit(1);
    return row;
  }
}
