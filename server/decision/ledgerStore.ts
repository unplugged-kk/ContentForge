/**
 * Drizzle persistence for the decision ledger. Storage only — the policy
 * decisions (what to record, when to record it, what counts as an outcome) live
 * in `engine.ts` / `ledger.ts`, and the port keeps the engine testable without a
 * database (the same shape `automationStorage.ts` uses).
 */

import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { jevDecisions } from "@shared/schema";
import { db as defaultDb } from "../db";
import type { DecisionLedgerEntry, DecisionLedgerPort, DecisionLedgerRow } from "./ledger";

export type DecisionDatabase = NodePgDatabase<typeof schema>;

/** Postgres returns `numeric` as a string; the port speaks numbers. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRow(row: typeof jevDecisions.$inferSelect): DecisionLedgerRow {
  return {
    id: row.id,
    decisionId: row.decisionId,
    userId: row.userId,
    decisionType: row.decisionType,
    policyId: row.policyId,
    policyVersion: row.policyVersion,
    inputStateHash: row.inputStateHash,
    decision: row.decision,
    confidence: toNumber(row.confidence),
    reasons: row.reasons,
    signals: row.signals,
    fallback: row.fallback,
    latencyMs: row.latencyMs,
    model: row.model,
    transport: row.transport,
    refs: row.refs as DecisionLedgerRow["refs"],
    correlationId: row.correlationId,
    predicted: row.predicted,
    actual: row.actual,
    actualAt: row.actualAt,
    createdAt: row.createdAt,
  };
}

export class DatabaseDecisionLedger implements DecisionLedgerPort {
  constructor(private readonly database: DecisionDatabase = defaultDb) {}

  async insert(entry: DecisionLedgerEntry): Promise<{ id: number; decisionId: string }> {
    const [inserted] = await this.database
      .insert(jevDecisions)
      .values({
        decisionId: entry.decisionId,
        userId: entry.userId ?? null,
        decisionType: entry.decisionType,
        policyId: entry.policyId,
        policyVersion: entry.policyVersion,
        inputStateHash: entry.inputStateHash,
        decision: entry.decision,
        confidence: entry.confidence === null || entry.confidence === undefined
          ? null
          : String(entry.confidence),
        reasons: entry.reasons,
        signals: entry.signals ?? {},
        fallback: entry.fallback,
        latencyMs: entry.latencyMs ?? null,
        model: entry.model ?? null,
        transport: entry.transport ?? null,
        refs: (entry.refs ?? {}) as Record<string, unknown>,
        correlationId: entry.correlationId ?? null,
      })
      .returning({ id: jevDecisions.id, decisionId: jevDecisions.decisionId });
    return inserted;
  }

  async get(decisionId: string): Promise<DecisionLedgerRow | undefined> {
    const [row] = await this.database
      .select()
      .from(jevDecisions)
      .where(eq(jevDecisions.decisionId, decisionId))
      .limit(1);
    return row ? toRow(row) : undefined;
  }

  async list(options: {
    limit: number;
    decisionType?: string;
    userId?: number | null;
  }): Promise<DecisionLedgerRow[]> {
    const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 200);
    const filters = [];
    if (options.decisionType) filters.push(eq(jevDecisions.decisionType, options.decisionType));
    if (options.userId !== undefined && options.userId !== null) {
      filters.push(eq(jevDecisions.userId, options.userId));
    }
    const rows = await this.database
      .select()
      .from(jevDecisions)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(jevDecisions.id))
      .limit(limit);
    return rows.map(toRow);
  }

  async attachOutcome(
    decisionId: string,
    actual: Record<string, unknown>,
    at: Date = new Date(),
  ): Promise<DecisionLedgerRow | undefined> {
    const [row] = await this.database
      .update(jevDecisions)
      .set({ actual, actualAt: at })
      .where(eq(jevDecisions.decisionId, decisionId))
      .returning();
    return row ? toRow(row) : undefined;
  }
}
