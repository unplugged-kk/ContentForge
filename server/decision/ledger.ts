/**
 * Decision ledger — the durable record of every decision the layer makes.
 *
 * This is what makes the Decision OS auditable and self-correcting: each row
 * carries the policy identity (`policyId` + `policyVersion`), the hash of the
 * input state, a numeric confidence, whether a fallback produced it, and a
 * predicted/actual pair that closes the loop once the content has performed.
 *
 * It is DISTINCT from `autonomy_decisions` (which journals the autonomy
 * controller alone) and it does not replace the `learning → experiments →
 * policyCandidates` pipeline — it feeds it.
 */

import { randomBytes } from "node:crypto";
import type { DecisionRefs } from "./registry";

export interface DecisionLedgerEntry {
  decisionId: string;
  userId?: number | null;
  decisionType: string;
  policyId: string;
  policyVersion: string;
  inputStateHash: string;
  decision: Record<string, unknown>;
  confidence?: number | null;
  reasons: string[];
  signals?: Record<string, unknown>;
  fallback: boolean;
  latencyMs?: number | null;
  model?: string | null;
  transport?: string | null;
  refs?: DecisionRefs;
  correlationId?: string | null;
}

export interface DecisionLedgerRow extends DecisionLedgerEntry {
  id: number;
  predicted?: Record<string, unknown> | null;
  actual?: Record<string, unknown> | null;
  actualAt?: Date | null;
  createdAt: Date;
}

export interface DecisionLedgerPort {
  insert(entry: DecisionLedgerEntry): Promise<{ id: number; decisionId: string }>;
  get(decisionId: string): Promise<DecisionLedgerRow | undefined>;
  list(options: {
    limit: number;
    decisionType?: string;
    userId?: number | null;
  }): Promise<DecisionLedgerRow[]>;
  /** Attach the observed outcome — the "actual" half of prediction vs actual. */
  attachOutcome(
    decisionId: string,
    actual: Record<string, unknown>,
    at?: Date,
  ): Promise<DecisionLedgerRow | undefined>;
  /**
   * Attach an observed outcome to EVERY decision that referenced this entity.
   * A publication is the outcome of several decisions (a publish gate, an
   * opportunity score, a strategy call), so the loop closes on all of them at
   * once. Returns how many rows were updated.
   */
  attachOutcomeByRef(
    ref: { publicationId?: number; artifactId?: number },
    actual: Record<string, unknown>,
    at?: Date,
  ): Promise<number>;
}

export function newDecisionId(): string {
  return `dec_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;
}

/**
 * Record a decision. Deliberately **best-effort**: observability must never be
 * able to change what the system decided, so a ledger failure is reported to the
 * caller (for logging) and never thrown.
 */
export async function recordDecision(
  port: DecisionLedgerPort | null | undefined,
  entry: DecisionLedgerEntry,
): Promise<boolean> {
  if (!port) return false;
  try {
    await port.insert(entry);
    return true;
  } catch {
    return false;
  }
}

export async function attachDecisionOutcome(
  port: DecisionLedgerPort | null | undefined,
  decisionId: string,
  actual: Record<string, unknown>,
  at?: Date,
): Promise<DecisionLedgerRow | undefined> {
  if (!port) return undefined;
  return port.attachOutcome(decisionId, actual, at);
}
