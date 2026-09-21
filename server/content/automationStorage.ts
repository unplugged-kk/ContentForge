/**
 * Persistence for the automation foundation (Phase 13).
 *
 * Two durable entities, and nothing else:
 *
 *   automation_policies  — the owner-controlled intent (mutable, versioned)
 *   automation_runs      — one execution record per logical trigger (immutable identity)
 *
 * The domain *decisions* (validation, versioning, idempotency identity, step
 * orchestration, failure classification) live in `automation.ts`; this file is
 * persistence only, behind a port so the orchestrator is testable without a
 * database — the same shape `storage.ts` and `styleService.ts` already use.
 *
 * Every read an HTTP caller can reach is owner-filtered **in SQL**
 * (`eq(table.userId, ownerId)`), not by a post-fetch comparison, so ownership is
 * enforced by the query itself (§21). Automation rows are always created with an
 * owner; there is no legacy unowned-automation population to accommodate.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import {
  automationPolicies,
  automationRuns,
  type AutomationApprovalMode,
  type AutomationPolicy,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationTriggerType,
} from "@shared/schema";
import { db as defaultDb } from "../db";

export type AutomationDatabase = NodePgDatabase<typeof schema>;
export type JsonRecord = Record<string, unknown>;

// ── rows ──────────────────────────────────────────────────────────────────────
export interface InsertAutomationPolicyRow {
  userId: number;
  name: string;
  status?: string;
  version?: number;
  specHash: string;
  triggerType: AutomationTriggerType;
  triggerConfig?: JsonRecord;
  researchConfig?: JsonRecord;
  targets?: unknown[];
  generationConfig?: JsonRecord;
  approvalMode?: AutomationApprovalMode;
  publicationConfig?: JsonRecord;
  limits?: JsonRecord;
}

/**
 * Mutation of a policy. `version` is REQUIRED and must be the caller's computed
 * next revision: the service reads the current version, computes the new spec
 * hash and passes the incremented revision, so "version" is never bumped
 * silently by persistence.
 */
export interface UpdateAutomationPolicyRow {
  name?: string;
  status?: string;
  version: number;
  specHash: string;
  triggerType?: AutomationTriggerType;
  triggerConfig?: JsonRecord;
  researchConfig?: JsonRecord;
  targets?: unknown[];
  generationConfig?: JsonRecord;
  approvalMode?: AutomationApprovalMode;
  publicationConfig?: JsonRecord;
  limits?: JsonRecord;
}

export interface InsertAutomationRunRow {
  userId: number;
  policyId: number;
  policyVersion: number;
  policySpecHash: string;
  policySnapshot: JsonRecord;
  triggerType: AutomationTriggerType;
  idempotencyKey: string;
  correlationId: string;
}

export interface ClaimAutomationRunResult {
  run: AutomationRun;
  created: boolean;
}

export interface PatchAutomationRunRow {
  status?: AutomationRunStatus;
  researchJobId?: number | null;
  outcomes?: unknown[];
  errorClass?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

/**
 * `undefined` means "leave unchanged"; an explicit `null` clears the column.
 * Persistence must not conflate the two, so callers are explicit.
 */
function assignDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

// ── port ──────────────────────────────────────────────────────────────────────
export interface AutomationStoragePort {
  // Policies
  insertAutomationPolicy(row: InsertAutomationPolicyRow): Promise<AutomationPolicy>;
  getAutomationPolicy(id: number): Promise<AutomationPolicy | undefined>;
  /** SQL-level owner scoping (§21). */
  getAutomationPolicyForOwner(id: number, ownerId: number): Promise<AutomationPolicy | undefined>;
  listAutomationPoliciesForOwner(ownerId: number, limit: number): Promise<AutomationPolicy[]>;
  updateAutomationPolicy(
    id: number,
    row: UpdateAutomationPolicyRow,
  ): Promise<AutomationPolicy | undefined>;
  /** Active, `scheduled`-trigger policies — the tick's trigger work list. */
  listActiveScheduledPolicies(limit: number): Promise<AutomationPolicy[]>;

  // Runs
  claimAutomationRun(row: InsertAutomationRunRow): Promise<ClaimAutomationRunResult>;
  getAutomationRun(id: number): Promise<AutomationRun | undefined>;
  /** SQL-level owner scoping (§21). */
  getAutomationRunForOwner(id: number, ownerId: number): Promise<AutomationRun | undefined>;
  listAutomationRunsForOwner(ownerId: number, limit: number): Promise<AutomationRun[]>;
  listAutomationRunsForPolicy(policyId: number, limit: number): Promise<AutomationRun[]>;
  /** Durable `maxRunsPerDay` accounting (§14). */
  countAutomationRunsSince(policyId: number, since: Date): Promise<number>;
  /** Runs whose orchestration is unfinished — the scheduler tick's work list. */
  listAdvanceableAutomationRuns(limit: number): Promise<AutomationRun[]>;
  /**
   * Single-flight advance lease (the orchestrator's concurrency arbiter). Only
   * one caller can hold a run's lease; a crashed holder is reclaimed once the
   * lease expires, so recovery needs no in-memory state.
   */
  acquireAutomationRunLease(id: number, leaseMs: number): Promise<AutomationRun | undefined>;
  releaseAutomationRunLease(id: number): Promise<void>;
  patchAutomationRun(id: number, patch: PatchAutomationRunRow): Promise<AutomationRun | undefined>;
}

// ── Drizzle implementation ────────────────────────────────────────────────────
export class DatabaseAutomationStorage implements AutomationStoragePort {
  constructor(private readonly database: AutomationDatabase = defaultDb) {}

  // ── Policies ────────────────────────────────────────────────────────────────
  async insertAutomationPolicy(row: InsertAutomationPolicyRow): Promise<AutomationPolicy> {
    const [inserted] = await this.database
      .insert(automationPolicies)
      .values({
        userId: row.userId,
        name: row.name,
        status: row.status ?? "active",
        version: row.version ?? 1,
        specHash: row.specHash,
        triggerType: row.triggerType,
        triggerConfig: row.triggerConfig ?? {},
        researchConfig: row.researchConfig ?? {},
        targets: row.targets ?? [],
        generationConfig: row.generationConfig ?? {},
        approvalMode: row.approvalMode ?? "approval_required",
        publicationConfig: row.publicationConfig ?? {},
        limits: row.limits ?? {},
      })
      .returning();
    return inserted;
  }

  async getAutomationPolicy(id: number): Promise<AutomationPolicy | undefined> {
    const [row] = await this.database
      .select()
      .from(automationPolicies)
      .where(eq(automationPolicies.id, id))
      .limit(1);
    return row;
  }

  async getAutomationPolicyForOwner(
    id: number,
    ownerId: number,
  ): Promise<AutomationPolicy | undefined> {
    const [row] = await this.database
      .select()
      .from(automationPolicies)
      .where(and(eq(automationPolicies.id, id), eq(automationPolicies.userId, ownerId)))
      .limit(1);
    return row;
  }

  async listAutomationPoliciesForOwner(ownerId: number, limit: number): Promise<AutomationPolicy[]> {
    return this.database
      .select()
      .from(automationPolicies)
      .where(eq(automationPolicies.userId, ownerId))
      .orderBy(desc(automationPolicies.id))
      .limit(limit);
  }

  async updateAutomationPolicy(
    id: number,
    row: UpdateAutomationPolicyRow,
  ): Promise<AutomationPolicy | undefined> {
    const set: Record<string, unknown> = {
      version: row.version,
      specHash: row.specHash,
      updatedAt: new Date(),
    };
    assignDefined(set, "name", row.name);
    assignDefined(set, "status", row.status);
    assignDefined(set, "triggerType", row.triggerType);
    assignDefined(set, "triggerConfig", row.triggerConfig);
    assignDefined(set, "researchConfig", row.researchConfig);
    assignDefined(set, "targets", row.targets);
    assignDefined(set, "generationConfig", row.generationConfig);
    assignDefined(set, "approvalMode", row.approvalMode);
    assignDefined(set, "publicationConfig", row.publicationConfig);
    assignDefined(set, "limits", row.limits);

    const [updated] = await this.database
      .update(automationPolicies)
      .set(set)
      .where(eq(automationPolicies.id, id))
      .returning();
    return updated;
  }

  async listActiveScheduledPolicies(limit: number): Promise<AutomationPolicy[]> {
    return this.database
      .select()
      .from(automationPolicies)
      .where(
        and(
          eq(automationPolicies.status, "active"),
          eq(automationPolicies.triggerType, "scheduled"),
        ),
      )
      .orderBy(asc(automationPolicies.id))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  // ── Runs ────────────────────────────────────────────────────────────────────
  /**
   * Claim a run for a logical trigger slot. `automation_runs_idempotency_key_
   * unique` is the arbiter: a duplicate delivery of the same slot (two ticks,
   * a retried HTTP request, a re-delivered job) yields the SAME run with
   * `created: false` — the database, not an in-memory lock (§8/§17).
   */
  async claimAutomationRun(row: InsertAutomationRunRow): Promise<ClaimAutomationRunResult> {
    const inserted = await this.database
      .insert(automationRuns)
      .values({
        userId: row.userId,
        policyId: row.policyId,
        policyVersion: row.policyVersion,
        policySpecHash: row.policySpecHash,
        policySnapshot: row.policySnapshot,
        triggerType: row.triggerType,
        idempotencyKey: row.idempotencyKey,
        correlationId: row.correlationId,
        status: "pending",
      })
      .onConflictDoNothing({ target: automationRuns.idempotencyKey })
      .returning();

    if (inserted.length > 0) return { run: inserted[0], created: true };

    const [existing] = await this.database
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.idempotencyKey, row.idempotencyKey))
      .limit(1);
    return { run: existing, created: false };
  }

  async getAutomationRun(id: number): Promise<AutomationRun | undefined> {
    const [row] = await this.database
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, id))
      .limit(1);
    return row;
  }

  async getAutomationRunForOwner(id: number, ownerId: number): Promise<AutomationRun | undefined> {
    const [row] = await this.database
      .select()
      .from(automationRuns)
      .where(and(eq(automationRuns.id, id), eq(automationRuns.userId, ownerId)))
      .limit(1);
    return row;
  }

  async listAutomationRunsForOwner(ownerId: number, limit: number): Promise<AutomationRun[]> {
    return this.database
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.userId, ownerId))
      .orderBy(desc(automationRuns.id))
      .limit(limit);
  }

  async listAutomationRunsForPolicy(policyId: number, limit: number): Promise<AutomationRun[]> {
    return this.database
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.policyId, policyId))
      .orderBy(desc(automationRuns.id))
      .limit(limit);
  }

  async countAutomationRunsSince(policyId: number, since: Date): Promise<number> {
    const [row] = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(automationRuns)
      .where(and(eq(automationRuns.policyId, policyId), gte(automationRuns.createdAt, since)));
    return row?.count ?? 0;
  }

  async listAdvanceableAutomationRuns(limit: number): Promise<AutomationRun[]> {
    return this.database
      .select()
      .from(automationRuns)
      .where(inArray(automationRuns.status, ["pending", "running"]))
      .orderBy(asc(automationRuns.id))
      .limit(limit);
  }

  /**
   * Conditional UPDATE — the lease is acquired atomically, so of two overlapping
   * ticks exactly one advances the run. `started_at` is set once, on the first
   * successful acquisition.
   */
  async acquireAutomationRunLease(id: number, leaseMs: number): Promise<AutomationRun | undefined> {
    const now = new Date();
    const expires = new Date(now.getTime() + leaseMs);
    const rows = await this.database
      .update(automationRuns)
      .set({
        status: "running",
        advanceLeaseExpiresAt: expires,
        attempt: sql`${automationRuns.attempt} + 1`,
        startedAt: sql`coalesce(${automationRuns.startedAt}, ${now})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(automationRuns.id, id),
          inArray(automationRuns.status, ["pending", "running"]),
          or(
            isNull(automationRuns.advanceLeaseExpiresAt),
            lt(automationRuns.advanceLeaseExpiresAt, now),
          ),
        ),
      )
      .returning();
    return rows[0];
  }

  async releaseAutomationRunLease(id: number): Promise<void> {
    await this.database
      .update(automationRuns)
      .set({ advanceLeaseExpiresAt: null, updatedAt: new Date() })
      .where(eq(automationRuns.id, id));
  }

  async patchAutomationRun(
    id: number,
    patch: PatchAutomationRunRow,
  ): Promise<AutomationRun | undefined> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    assignDefined(set, "status", patch.status);
    assignDefined(set, "researchJobId", patch.researchJobId);
    assignDefined(set, "outcomes", patch.outcomes);
    assignDefined(set, "errorClass", patch.errorClass);
    assignDefined(set, "errorMessage", patch.errorMessage);
    assignDefined(set, "startedAt", patch.startedAt);
    assignDefined(set, "finishedAt", patch.finishedAt);

    const [updated] = await this.database
      .update(automationRuns)
      .set(set)
      .where(eq(automationRuns.id, id))
      .returning();
    return updated;
  }
}
