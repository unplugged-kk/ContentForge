/**
 * Experimentation storage layer (Phase 29.2).
 *
 * Implements durable persistence for Experiments, Variants, Assignments,
 * Evaluations, and Policy Candidates on PostgreSQL.
 * Every read and write is strictly owner-scoped in SQL.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import type { ContentDatabase } from "../storage";
import {
  experiments,
  experimentVariants,
  experimentAssignments,
  experimentEvaluations,
  policyCandidates,
  type Experiment,
  type InsertExperiment,
  type ExperimentVariant,
  type InsertExperimentVariant,
  type ExperimentAssignment,
  type InsertExperimentAssignment,
  type ExperimentEvaluation,
  type InsertExperimentEvaluation,
  type PolicyCandidate,
  type InsertPolicyCandidate,
  type ExperimentStatus,
  type ExperimentDecision,
  type PolicyCandidateStatus,
} from "@shared/schema";

export interface ExperimentWithDetails extends Experiment {
  variants: ExperimentVariant[];
  latestEvaluation?: ExperimentEvaluation | null;
}

export interface ExperimentStoragePort {
  createExperiment(row: InsertExperiment): Promise<{ row: Experiment; created: boolean }>;
  getExperimentForOwner(id: number, userId: number): Promise<ExperimentWithDetails | undefined>;
  listExperimentsForOwner(
    userId: number,
    limit?: number,
    filters?: { status?: ExperimentStatus; experimentType?: string },
  ): Promise<Experiment[]>;
  updateExperiment(
    id: number,
    userId: number,
    updates: Partial<Omit<Experiment, "id" | "userId" | "createdAt">>,
  ): Promise<Experiment | undefined>;
  createVariant(row: InsertExperimentVariant): Promise<{ row: ExperimentVariant; created: boolean }>;
  listVariantsForExperiment(experimentId: number, userId: number): Promise<ExperimentVariant[]>;
  getVariantForOwner(variantId: number, userId: number): Promise<ExperimentVariant | undefined>;
  createAssignment(row: InsertExperimentAssignment): Promise<{ row: ExperimentAssignment; created: boolean }>;
  listAssignmentsForExperiment(experimentId: number, userId: number): Promise<ExperimentAssignment[]>;
  getAssignmentForOpportunity(opportunityId: number, userId?: number): Promise<ExperimentAssignment | undefined>;
  updateAssignmentEntities(
    id: number,
    userId: number,
    entities: { artifactId?: number | null; publicationId?: number | null },
  ): Promise<ExperimentAssignment | undefined>;
  createEvaluation(row: InsertExperimentEvaluation): Promise<{ row: ExperimentEvaluation; created: boolean }>;
  getLatestEvaluationForExperiment(experimentId: number, userId: number): Promise<ExperimentEvaluation | undefined>;
  createPolicyCandidate(row: InsertPolicyCandidate): Promise<{ row: PolicyCandidate; created: boolean }>;
  listPolicyCandidatesForOwner(
    userId: number,
    limit?: number,
    filters?: { status?: PolicyCandidateStatus; experimentId?: number },
  ): Promise<PolicyCandidate[]>;
  getPolicyCandidateForOwner(id: number, userId: number): Promise<PolicyCandidate | undefined>;
  updatePolicyCandidateReview(
    id: number,
    userId: number,
    status: PolicyCandidateStatus,
    reviewedBy: number,
    notes?: string,
  ): Promise<PolicyCandidate | undefined>;
}

export class DatabaseExperimentStorage implements ExperimentStoragePort {
  constructor(private readonly database: ContentDatabase) {}

  async createExperiment(row: InsertExperiment): Promise<{ row: Experiment; created: boolean }> {
    const inserted = await this.database
      .insert(experiments)
      .values(row)
      .onConflictDoNothing({ target: experiments.identityKey })
      .returning();

    if (inserted.length > 0) {
      return { row: inserted[0], created: true };
    }

    const [existing] = await this.database
      .select()
      .from(experiments)
      .where(eq(experiments.identityKey, row.identityKey));

    if (!existing) {
      throw new Error(`Failed to create or load experiment for key ${row.identityKey}`);
    }
    return { row: existing, created: false };
  }

  async getExperimentForOwner(id: number, userId: number): Promise<ExperimentWithDetails | undefined> {
    const [exp] = await this.database
      .select()
      .from(experiments)
      .where(and(eq(experiments.id, id), eq(experiments.userId, userId)));

    if (!exp) return undefined;

    const variants = await this.database
      .select()
      .from(experimentVariants)
      .where(and(eq(experimentVariants.experimentId, id), eq(experimentVariants.userId, userId)))
      .orderBy(experimentVariants.id);

    const [latestEval] = await this.database
      .select()
      .from(experimentEvaluations)
      .where(and(eq(experimentEvaluations.experimentId, id), eq(experimentEvaluations.userId, userId)))
      .orderBy(desc(experimentEvaluations.evaluatedAt))
      .limit(1);

    return {
      ...exp,
      variants,
      latestEvaluation: latestEval ?? null,
    };
  }

  async listExperimentsForOwner(
    userId: number,
    limit: number = 50,
    filters?: { status?: ExperimentStatus; experimentType?: string },
  ): Promise<Experiment[]> {
    const conditions = [eq(experiments.userId, userId)];
    if (filters?.status) {
      conditions.push(eq(experiments.status, filters.status));
    }
    if (filters?.experimentType) {
      conditions.push(eq(experiments.experimentType, filters.experimentType));
    }

    return this.database
      .select()
      .from(experiments)
      .where(and(...conditions))
      .orderBy(desc(experiments.createdAt))
      .limit(limit);
  }

  async updateExperiment(
    id: number,
    userId: number,
    updates: Partial<Omit<Experiment, "id" | "userId" | "createdAt">>,
  ): Promise<Experiment | undefined> {
    const [updated] = await this.database
      .update(experiments)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(experiments.id, id), eq(experiments.userId, userId)))
      .returning();

    return updated;
  }

  async createVariant(row: InsertExperimentVariant): Promise<{ row: ExperimentVariant; created: boolean }> {
    const inserted = await this.database
      .insert(experimentVariants)
      .values(row)
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      return { row: inserted[0], created: true };
    }

    const [existing] = await this.database
      .select()
      .from(experimentVariants)
      .where(
        and(
          eq(experimentVariants.experimentId, row.experimentId),
          eq(experimentVariants.variantKey, row.variantKey),
        ),
      );

    if (!existing) {
      throw new Error(`Failed to load existing variant ${row.variantKey} for experiment ${row.experimentId}`);
    }
    return { row: existing, created: false };
  }

  async listVariantsForExperiment(experimentId: number, userId: number): Promise<ExperimentVariant[]> {
    return this.database
      .select()
      .from(experimentVariants)
      .where(and(eq(experimentVariants.experimentId, experimentId), eq(experimentVariants.userId, userId)))
      .orderBy(experimentVariants.id);
  }

  async getVariantForOwner(variantId: number, userId: number): Promise<ExperimentVariant | undefined> {
    const [variant] = await this.database
      .select()
      .from(experimentVariants)
      .where(and(eq(experimentVariants.id, variantId), eq(experimentVariants.userId, userId)));
    return variant;
  }

  async createAssignment(row: InsertExperimentAssignment): Promise<{ row: ExperimentAssignment; created: boolean }> {
    const inserted = await this.database
      .insert(experimentAssignments)
      .values(row)
      .onConflictDoNothing({ target: experimentAssignments.idempotencyKey })
      .returning();

    if (inserted.length > 0) {
      return { row: inserted[0], created: true };
    }

    const [existing] = await this.database
      .select()
      .from(experimentAssignments)
      .where(eq(experimentAssignments.idempotencyKey, row.idempotencyKey));

    if (!existing) {
      throw new Error(`Failed to load existing assignment for key ${row.idempotencyKey}`);
    }
    return { row: existing, created: false };
  }

  async listAssignmentsForExperiment(experimentId: number, userId: number): Promise<ExperimentAssignment[]> {
    return this.database
      .select()
      .from(experimentAssignments)
      .where(and(eq(experimentAssignments.experimentId, experimentId), eq(experimentAssignments.userId, userId)))
      .orderBy(desc(experimentAssignments.assignedAt));
  }

  async getAssignmentForOpportunity(opportunityId: number, userId?: number): Promise<ExperimentAssignment | undefined> {
    const conditions = [eq(experimentAssignments.opportunityId, opportunityId)];
    if (userId !== undefined) {
      conditions.push(eq(experimentAssignments.userId, userId));
    }
    const [assignment] = await this.database
      .select()
      .from(experimentAssignments)
      .where(and(...conditions));
    return assignment;
  }

  async updateAssignmentEntities(
    id: number,
    userId: number,
    entities: { artifactId?: number | null; publicationId?: number | null },
  ): Promise<ExperimentAssignment | undefined> {
    const [updated] = await this.database
      .update(experimentAssignments)
      .set(entities)
      .where(and(eq(experimentAssignments.id, id), eq(experimentAssignments.userId, userId)))
      .returning();
    return updated;
  }

  async createEvaluation(row: InsertExperimentEvaluation): Promise<{ row: ExperimentEvaluation; created: boolean }> {
    const inserted = await this.database
      .insert(experimentEvaluations)
      .values(row)
      .onConflictDoNothing({ target: experimentEvaluations.identityKey })
      .returning();

    if (inserted.length > 0) {
      return { row: inserted[0], created: true };
    }

    const [existing] = await this.database
      .select()
      .from(experimentEvaluations)
      .where(eq(experimentEvaluations.identityKey, row.identityKey));

    if (!existing) {
      throw new Error(`Failed to load evaluation for key ${row.identityKey}`);
    }
    return { row: existing, created: false };
  }

  async getLatestEvaluationForExperiment(experimentId: number, userId: number): Promise<ExperimentEvaluation | undefined> {
    const [latest] = await this.database
      .select()
      .from(experimentEvaluations)
      .where(and(eq(experimentEvaluations.experimentId, experimentId), eq(experimentEvaluations.userId, userId)))
      .orderBy(desc(experimentEvaluations.evaluatedAt))
      .limit(1);
    return latest;
  }

  async createPolicyCandidate(row: InsertPolicyCandidate): Promise<{ row: PolicyCandidate; created: boolean }> {
    const inserted = await this.database
      .insert(policyCandidates)
      .values(row)
      .onConflictDoNothing({ target: policyCandidates.identityKey })
      .returning();

    if (inserted.length > 0) {
      return { row: inserted[0], created: true };
    }

    const [existing] = await this.database
      .select()
      .from(policyCandidates)
      .where(eq(policyCandidates.identityKey, row.identityKey));

    if (!existing) {
      throw new Error(`Failed to load policy candidate for key ${row.identityKey}`);
    }
    return { row: existing, created: false };
  }

  async listPolicyCandidatesForOwner(
    userId: number,
    limit: number = 50,
    filters?: { status?: PolicyCandidateStatus; experimentId?: number },
  ): Promise<PolicyCandidate[]> {
    const conditions = [eq(policyCandidates.userId, userId)];
    if (filters?.status) {
      conditions.push(eq(policyCandidates.status, filters.status));
    }
    if (filters?.experimentId) {
      conditions.push(eq(policyCandidates.experimentId, filters.experimentId));
    }

    return this.database
      .select()
      .from(policyCandidates)
      .where(and(...conditions))
      .orderBy(desc(policyCandidates.createdAt))
      .limit(limit);
  }

  async getPolicyCandidateForOwner(id: number, userId: number): Promise<PolicyCandidate | undefined> {
    const [candidate] = await this.database
      .select()
      .from(policyCandidates)
      .where(and(eq(policyCandidates.id, id), eq(policyCandidates.userId, userId)));
    return candidate;
  }

  async updatePolicyCandidateReview(
    id: number,
    userId: number,
    status: PolicyCandidateStatus,
    reviewedBy: number,
    notes?: string,
  ): Promise<PolicyCandidate | undefined> {
    const [updated] = await this.database
      .update(policyCandidates)
      .set({
        status,
        reviewedBy,
        reviewedAt: new Date(),
        reviewNotes: notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(policyCandidates.id, id), eq(policyCandidates.userId, userId)))
      .returning();
    return updated;
  }
}
