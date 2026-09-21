import { and, desc, eq, sql } from "drizzle-orm";
import {
  learningObservations,
  learningProposals,
  learningSignals,
  performanceSignals,
  type InsertLearningObservation,
  type InsertLearningProposal,
  type LearningObservation,
  type LearningProposal,
  type LearningSignal,
  type PerformanceSignal,
  type ProposalStatus,
} from "@shared/schema";
import { db as defaultDb } from "../../db";
import type { ContentDatabase, JsonRecord } from "../storage";
import { boundPayload, learningIdentityKey, performanceIdentityKey } from "./identity";
import { LEARNING_SCHEMA_VERSION, type SignalType, type SourceType } from "./constants";
import type { NormalizedMetric } from "./metrics";

export interface InsertPerformanceObservation {
  userId: number | null;
  publicationId: number;
  resultId: number | null;
  artifactId: number | null;
  channel: string;
  provider: string;
  externalId: string | null;
  metric: string;
  value: number | null;
  availability: "observed" | "not_available";
  observedAt: Date;
  retrievedAt: Date;
  measurementWindow: string | null;
  normalizationVersion: string;
  sourceRevision: string | null;
  provenance: JsonRecord;
}

export interface InsertLearningRow {
  userId: number | null;
  signalType: SignalType;
  sourceType: SourceType;
  sourceId: number;
  artifactId: number | null;
  priorArtifactId: number | null;
  publicationId: number | null;
  resultId: number | null;
  performanceSignalId: number | null;
  generationJobId: number | null;
  generationPolicyId: number | null;
  opportunityId: number | null;
  storyId: number | null;
  automationRunId: number | null;
  channel: string | null;
  format: string | null;
  observedAt: Date;
  schemaVersion: string;
  payload: JsonRecord;
  confidence: string | null;
  identityKey: string;
}

export interface LearningStoragePort {
  insertPerformanceObservation(
    row: InsertPerformanceObservation,
  ): Promise<{ row: PerformanceSignal; created: boolean }>;
  insertLearningSignal(row: InsertLearningRow): Promise<{ row: LearningSignal; created: boolean }>;
  getLearningSignalForOwner(id: number, ownerId: number): Promise<LearningSignal | undefined>;
  listLearningSignalsForOwner(
    ownerId: number,
    limit: number,
    filters?: { publicationId?: number; artifactId?: number; signalType?: string },
  ): Promise<LearningSignal[]>;
  listPerformanceForPublicationOwner(
    publicationId: number,
    ownerId: number,
  ): Promise<PerformanceSignal[]>;
  listPublishedPublicationIdsForOwner(ownerId: number, limit: number): Promise<number[]>;
  listRecentPublishedPublicationIds(limit: number): Promise<number[]>;
  countSignalsByType(ownerId: number): Promise<Record<string, number>>;

  insertLearningObservation(
    row: InsertLearningObservation,
  ): Promise<{ row: LearningObservation; created: boolean }>;
  getLearningObservationForOwner(id: number, ownerId: number): Promise<LearningObservation | undefined>;
  listLearningObservationsForOwner(
    ownerId: number,
    limit?: number,
    filters?: { dimension?: string; observationType?: string },
  ): Promise<LearningObservation[]>;

  insertLearningProposal(
    row: InsertLearningProposal,
  ): Promise<{ row: LearningProposal; created: boolean }>;
  getLearningProposalForOwner(id: number, ownerId: number): Promise<LearningProposal | undefined>;
  listLearningProposalsForOwner(
    ownerId: number,
    limit?: number,
    filters?: { status?: ProposalStatus; proposalType?: string },
  ): Promise<LearningProposal[]>;
  updateProposalStatus(
    id: number,
    ownerId: number,
    status: ProposalStatus,
    reviewedBy?: number,
    notes?: string,
  ): Promise<LearningProposal | undefined>;
}

export class DatabaseLearningStorage implements LearningStoragePort {
  constructor(private readonly database: ContentDatabase = defaultDb) {}

  async insertPerformanceObservation(
    row: InsertPerformanceObservation,
  ): Promise<{ row: PerformanceSignal; created: boolean }> {
    const identityKey = performanceIdentityKey({
      publicationId: row.publicationId,
      metric: row.metric,
      observedAt: row.observedAt,
      provider: row.provider,
      normalizationVersion: row.normalizationVersion,
    });
    const inserted = await this.database
      .insert(performanceSignals)
      .values({
        userId: row.userId,
        publicationId: row.publicationId,
        resultId: row.resultId,
        artifactId: row.artifactId,
        channel: row.channel,
        provider: row.provider,
        externalId: row.externalId,
        metric: row.metric,
        value: row.value === null ? null : String(row.value),
        availability: row.availability,
        observedAt: row.observedAt,
        retrievedAt: row.retrievedAt,
        measurementWindow: row.measurementWindow,
        normalizationVersion: row.normalizationVersion,
        sourceRevision: row.sourceRevision,
        provenance: boundPayload(row.provenance),
        identityKey,
      })
      .onConflictDoNothing({ target: performanceSignals.identityKey })
      .returning();
    if (inserted[0]) return { row: inserted[0], created: true };
    const [existing] = await this.database
      .select()
      .from(performanceSignals)
      .where(eq(performanceSignals.identityKey, identityKey))
      .limit(1);
    return { row: existing!, created: false };
  }

  async insertLearningSignal(row: InsertLearningRow): Promise<{ row: LearningSignal; created: boolean }> {
    const inserted = await this.database
      .insert(learningSignals)
      .values({
        ...row,
        schemaVersion: row.schemaVersion || LEARNING_SCHEMA_VERSION,
        payload: boundPayload(row.payload),
      })
      .onConflictDoNothing({ target: learningSignals.identityKey })
      .returning();
    if (inserted[0]) return { row: inserted[0], created: true };
    const [existing] = await this.database
      .select()
      .from(learningSignals)
      .where(eq(learningSignals.identityKey, row.identityKey))
      .limit(1);
    return { row: existing!, created: false };
  }

  async getLearningSignalForOwner(id: number, ownerId: number): Promise<LearningSignal | undefined> {
    const [row] = await this.database
      .select()
      .from(learningSignals)
      .where(and(eq(learningSignals.id, id), eq(learningSignals.userId, ownerId)))
      .limit(1);
    return row;
  }

  async listLearningSignalsForOwner(
    ownerId: number,
    limit: number,
    filters: { publicationId?: number; artifactId?: number; signalType?: string } = {},
  ): Promise<LearningSignal[]> {
    const clauses = [eq(learningSignals.userId, ownerId)];
    if (filters.publicationId != null) clauses.push(eq(learningSignals.publicationId, filters.publicationId));
    if (filters.artifactId != null) clauses.push(eq(learningSignals.artifactId, filters.artifactId));
    if (filters.signalType) clauses.push(eq(learningSignals.signalType, filters.signalType));
    return this.database
      .select()
      .from(learningSignals)
      .where(and(...clauses))
      .orderBy(desc(learningSignals.id))
      .limit(limit);
  }

  async listPerformanceForPublicationOwner(
    publicationId: number,
    ownerId: number,
  ): Promise<PerformanceSignal[]> {
    return this.database
      .select()
      .from(performanceSignals)
      .where(
        and(eq(performanceSignals.publicationId, publicationId), eq(performanceSignals.userId, ownerId)),
      )
      .orderBy(desc(performanceSignals.observedAt), performanceSignals.metric);
  }

  async listPublishedPublicationIdsForOwner(ownerId: number, limit: number): Promise<number[]> {
    const { publications } = await import("@shared/schema");
    const rows = await this.database
      .select({ id: publications.id })
      .from(publications)
      .where(and(eq(publications.userId, ownerId), eq(publications.state, "published")))
      .orderBy(desc(publications.id))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  async listRecentPublishedPublicationIds(limit: number): Promise<number[]> {
    const { publications } = await import("@shared/schema");
    const rows = await this.database
      .select({ id: publications.id })
      .from(publications)
      .where(eq(publications.state, "published"))
      .orderBy(desc(publications.id))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  async countSignalsByType(ownerId: number): Promise<Record<string, number>> {
    const rows = await this.database
      .select({
        signalType: learningSignals.signalType,
        c: sql<number>`count(*)::int`,
      })
      .from(learningSignals)
      .where(eq(learningSignals.userId, ownerId))
      .groupBy(learningSignals.signalType);
    const out: Record<string, number> = {};
    for (const row of rows) out[row.signalType] = Number(row.c);
    return out;
  }

  async insertLearningObservation(
    row: InsertLearningObservation,
  ): Promise<{ row: LearningObservation; created: boolean }> {
    const inserted = await this.database
      .insert(learningObservations)
      .values(row)
      .onConflictDoNothing({ target: learningObservations.identityKey })
      .returning();
    if (inserted[0]) return { row: inserted[0], created: true };
    const [existing] = await this.database
      .select()
      .from(learningObservations)
      .where(eq(learningObservations.identityKey, row.identityKey))
      .limit(1);
    return { row: existing!, created: false };
  }

  async getLearningObservationForOwner(id: number, ownerId: number): Promise<LearningObservation | undefined> {
    const [row] = await this.database
      .select()
      .from(learningObservations)
      .where(and(eq(learningObservations.id, id), eq(learningObservations.userId, ownerId)))
      .limit(1);
    return row;
  }

  async listLearningObservationsForOwner(
    ownerId: number,
    limit = 50,
    filters: { dimension?: string; observationType?: string } = {},
  ): Promise<LearningObservation[]> {
    const clauses = [eq(learningObservations.userId, ownerId)];
    if (filters.dimension) clauses.push(eq(learningObservations.dimension, filters.dimension));
    if (filters.observationType) clauses.push(eq(learningObservations.observationType, filters.observationType));
    return this.database
      .select()
      .from(learningObservations)
      .where(and(...clauses))
      .orderBy(desc(learningObservations.id))
      .limit(limit);
  }

  async insertLearningProposal(
    row: InsertLearningProposal,
  ): Promise<{ row: LearningProposal; created: boolean }> {
    const inserted = await this.database
      .insert(learningProposals)
      .values(row)
      .onConflictDoNothing({ target: learningProposals.identityKey })
      .returning();
    if (inserted[0]) return { row: inserted[0], created: true };
    const [existing] = await this.database
      .select()
      .from(learningProposals)
      .where(eq(learningProposals.identityKey, row.identityKey))
      .limit(1);
    return { row: existing!, created: false };
  }

  async getLearningProposalForOwner(id: number, ownerId: number): Promise<LearningProposal | undefined> {
    const [row] = await this.database
      .select()
      .from(learningProposals)
      .where(and(eq(learningProposals.id, id), eq(learningProposals.userId, ownerId)))
      .limit(1);
    return row;
  }

  async listLearningProposalsForOwner(
    ownerId: number,
    limit = 50,
    filters: { status?: ProposalStatus; proposalType?: string } = {},
  ): Promise<LearningProposal[]> {
    const clauses = [eq(learningProposals.userId, ownerId)];
    if (filters.status) clauses.push(eq(learningProposals.status, filters.status));
    if (filters.proposalType) clauses.push(eq(learningProposals.proposalType, filters.proposalType));
    return this.database
      .select()
      .from(learningProposals)
      .where(and(...clauses))
      .orderBy(desc(learningProposals.id))
      .limit(limit);
  }

  async updateProposalStatus(
    id: number,
    ownerId: number,
    status: ProposalStatus,
    reviewedBy?: number,
    notes?: string,
  ): Promise<LearningProposal | undefined> {
    const [updated] = await this.database
      .update(learningProposals)
      .set({
        status,
        reviewedAt: new Date(),
        reviewedBy: reviewedBy ?? ownerId,
        reviewNotes: notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(learningProposals.id, id), eq(learningProposals.userId, ownerId)))
      .returning();
    return updated;
  }
}

export function derivedIdentity(kind: string, sourceId: number, observedAt: Date): string {
  return learningIdentityKey(["v1", "derived", kind, sourceId, observedAt.getTime()]);
}

export { learningIdentityKey };

export function ingestMetricRows(
  store: LearningStoragePort,
  base: Omit<InsertPerformanceObservation, "metric" | "value" | "availability">,
  metrics: NormalizedMetric[],
): Promise<Array<{ row: PerformanceSignal; created: boolean }>> {
  return Promise.all(
    metrics.map((metric) =>
      store.insertPerformanceObservation({
        ...base,
        metric: metric.metric,
        value: metric.value,
        availability: metric.availability,
      }),
    ),
  );
}
