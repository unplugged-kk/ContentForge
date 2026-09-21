import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { agentRuns, agentToolCalls, type AgentRun, type AgentToolCall } from "@shared/schema";
import { db as defaultDb } from "../db";
import { boundRecord } from "./sanitize";

export type AgentDatabase = NodePgDatabase<typeof schema>;

export interface ClaimAgentRunInput {
  userId: number;
  backendId: string;
  providerSnapshot: Record<string, unknown>;
  objective: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface ClaimToolCallInput {
  userId: number;
  agentRunId: number;
  toolName: string;
  idempotencyKey: string;
  inputHash: string;
  input: Record<string, unknown>;
}

export class DatabaseAgentStorage {
  constructor(private readonly database: AgentDatabase = defaultDb) {}

  async claimRun(input: ClaimAgentRunInput): Promise<{ run: AgentRun; created: boolean }> {
    const existing = await this.database
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing.length > 0) return { run: existing[0], created: false };

    const inserted = await this.database
      .insert(agentRuns)
      .values({
        userId: input.userId,
        backendId: input.backendId,
        providerSnapshot: input.providerSnapshot,
        objective: input.objective,
        status: "requested",
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
      })
      .onConflictDoNothing({ target: agentRuns.idempotencyKey })
      .returning();
    if (inserted.length > 0) return { run: inserted[0], created: true };

    const raced = await this.database
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return { run: raced[0], created: false };
  }

  async getRun(id: number): Promise<AgentRun | undefined> {
    const rows = await this.database.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
    return rows[0];
  }

  async getRunForOwner(id: number, ownerId: number): Promise<AgentRun | undefined> {
    const rows = await this.database
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, id), eq(agentRuns.userId, ownerId)))
      .limit(1);
    return rows[0];
  }

  async listIncompleteRuns(limit = 50): Promise<AgentRun[]> {
    return this.database
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.status, "running"))
      .orderBy(desc(agentRuns.id))
      .limit(limit);
  }

  async markRunRunning(id: number, attempt: number): Promise<AgentRun | undefined> {
    const rows = await this.database
      .update(agentRuns)
      .set({
        status: "running",
        attempt,
        startedAt: new Date(),
        errorClass: null,
        errorMessage: null,
      })
      .where(eq(agentRuns.id, id))
      .returning();
    return rows[0];
  }

  async markRunStatus(
    id: number,
    status: string,
    extra: Partial<Pick<AgentRun, "currentStep" | "errorClass" | "errorMessage" | "finishedAt">> = {},
  ): Promise<AgentRun | undefined> {
    const rows = await this.database
      .update(agentRuns)
      .set({
        status,
        ...extra,
      })
      .where(eq(agentRuns.id, id))
      .returning();
    return rows[0];
  }

  async bumpStep(id: number, currentStep: number): Promise<void> {
    await this.database.update(agentRuns).set({ currentStep }).where(eq(agentRuns.id, id));
  }

  async claimToolCall(input: ClaimToolCallInput): Promise<{ call: AgentToolCall; created: boolean }> {
    const existing = await this.database
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing.length > 0) return { call: existing[0], created: false };

    const inserted = await this.database
      .insert(agentToolCalls)
      .values({
        userId: input.userId,
        agentRunId: input.agentRunId,
        toolName: input.toolName,
        idempotencyKey: input.idempotencyKey,
        inputHash: input.inputHash,
        input: boundRecord(input.input),
        status: "requested",
      })
      .onConflictDoNothing({ target: agentToolCalls.idempotencyKey })
      .returning();
    if (inserted.length > 0) return { call: inserted[0], created: true };

    const raced = await this.database
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return { call: raced[0], created: false };
  }

  async markToolRunning(id: number): Promise<void> {
    await this.database
      .update(agentToolCalls)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(agentToolCalls.id, id));
  }

  async completeToolCall(
    id: number,
    status: string,
    result: Record<string, unknown>,
    resourceRefs: Record<string, unknown>,
    errorClass?: string | null,
    errorMessage?: string | null,
  ): Promise<AgentToolCall | undefined> {
    const rows = await this.database
      .update(agentToolCalls)
      .set({
        status,
        result: boundRecord(result),
        resourceRefs,
        errorClass: errorClass ?? null,
        errorMessage: errorMessage ?? null,
        finishedAt: new Date(),
      })
      .where(eq(agentToolCalls.id, id))
      .returning();
    return rows[0];
  }

  async listRunsForOwner(ownerId: number, limit = 30): Promise<AgentRun[]> {
    const take = Math.min(Math.max(limit, 1), 100);
    return this.database
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.userId, ownerId))
      .orderBy(desc(agentRuns.id))
      .limit(take);
  }

  async listToolCalls(agentRunId: number): Promise<AgentToolCall[]> {
    return this.database
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.agentRunId, agentRunId))
      .orderBy(agentToolCalls.id);
  }

  /**
   * Run ids among `runIds` that currently have a denied approve_artifact/
   * publish_now tool call — the cheap, list-safe signal for "needs approval"
   * (no per-run event-stream fetch required). Phase 28.2F Today attention.
   */
  async listDeniedApprovalRunIds(runIds: number[]): Promise<Set<number>> {
    if (runIds.length === 0) return new Set();
    const rows = await this.database
      .select({ agentRunId: agentToolCalls.agentRunId })
      .from(agentToolCalls)
      .where(
        and(
          inArray(agentToolCalls.agentRunId, runIds),
          inArray(agentToolCalls.toolName, ["approve_artifact", "publish_now"]),
          eq(agentToolCalls.status, "denied"),
        ),
      );
    return new Set(rows.map((r) => r.agentRunId));
  }

  async listToolCallsById(id: number): Promise<AgentToolCall[]> {
    return this.database.select().from(agentToolCalls).where(eq(agentToolCalls.id, id)).limit(1);
  }

  async listRecentToolCalls(ownerId: number, limit = 50): Promise<AgentToolCall[]> {
    return this.database
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.userId, ownerId))
      .orderBy(desc(agentToolCalls.id))
      .limit(limit);
  }
}
