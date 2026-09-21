/**
 * Autonomy configuration (Phase 29.4 §10-11).
 *
 * One row per owner. Safe-by-construction: a missing row is treated as fully
 * disabled (never as "no restriction"), and every default is the most
 * conservative option -- no deployment silently enables autonomy.
 *
 * This module is the ONLY human-facing surface for changing these settings.
 * The autonomy controller (`controller.ts`) reads this config but never
 * writes to it, except via `setCircuitBreaker`, which the controller calls
 * only to OPEN the breaker as a safety response -- closing it is
 * human-only (`resetCircuitBreaker`), matching §29 ("Only a human may clear
 * it").
 */
import { eq } from "drizzle-orm";
import type { ContentDatabase } from "../storage";
import { autonomyConfigs, type AutonomyConfig, type AutonomyMode } from "@shared/schema";

export async function getAutonomyConfig(db: ContentDatabase, userId: number): Promise<AutonomyConfig | undefined> {
  const [row] = await db.select().from(autonomyConfigs).where(eq(autonomyConfigs.userId, userId));
  return row;
}

/** Creates the safe-default row on first access. Never called by the controller for writes. */
export async function getOrCreateAutonomyConfig(db: ContentDatabase, userId: number): Promise<AutonomyConfig> {
  const existing = await getAutonomyConfig(db, userId);
  if (existing) return existing;
  const [created] = await db
    .insert(autonomyConfigs)
    .values({ userId })
    .onConflictDoNothing({ target: autonomyConfigs.userId })
    .returning();
  if (created) return created;
  const [row] = await db.select().from(autonomyConfigs).where(eq(autonomyConfigs.userId, userId));
  return row;
}

/** Human-settable fields only. Never includes circuitBreakerState -- see `resetCircuitBreaker`. */
export interface AutonomyConfigPatch {
  enabled?: boolean;
  mode?: AutonomyMode;
  experimentAutomationEnabled?: boolean;
  activationAutomationEnabled?: boolean;
  rollbackEnabled?: boolean;
  minimumEvidenceQuality?: string;
  maxActiveExperiments?: number;
  maxExperimentsPerDay?: number;
  maxActivationsPerDay?: number;
  maxActivationsPerWeek?: number;
  maxConsecutiveActivations?: number;
  cooldownMinutes?: number;
  allowedScopes?: string[] | null;
}

export async function updateAutonomyConfig(
  db: ContentDatabase,
  userId: number,
  patch: AutonomyConfigPatch,
  actorUserId: number,
): Promise<AutonomyConfig> {
  await getOrCreateAutonomyConfig(db, userId);
  const [updated] = await db
    .update(autonomyConfigs)
    .set({ ...patch, updatedBy: actorUserId, updatedAt: new Date() })
    .where(eq(autonomyConfigs.userId, userId))
    .returning();
  return updated;
}

/** Human-only: disables autonomy entirely (the kill switch). */
export async function disableAutonomy(db: ContentDatabase, userId: number, actorUserId: number): Promise<AutonomyConfig> {
  return updateAutonomyConfig(db, userId, { enabled: false, mode: "disabled" }, actorUserId);
}

/** Human-only: pauses autonomy (distinct from disable -- config/limits are preserved for a quick resume). */
export async function pauseAutonomy(db: ContentDatabase, userId: number, actorUserId: number): Promise<AutonomyConfig> {
  await getOrCreateAutonomyConfig(db, userId);
  const [updated] = await db
    .update(autonomyConfigs)
    .set({ enabled: false, pausedAt: new Date(), updatedBy: actorUserId, updatedAt: new Date() })
    .where(eq(autonomyConfigs.userId, userId))
    .returning();
  return updated;
}

/** Human-only: clears the circuit breaker. The controller may only OPEN it, never close it. */
export async function resetCircuitBreaker(db: ContentDatabase, userId: number, actorUserId: number): Promise<AutonomyConfig> {
  await getOrCreateAutonomyConfig(db, userId);
  const [updated] = await db
    .update(autonomyConfigs)
    .set({
      circuitBreakerState: "closed",
      circuitBreakerReason: null,
      circuitBreakerOpenedAt: null,
      updatedBy: actorUserId,
      updatedAt: new Date(),
    })
    .where(eq(autonomyConfigs.userId, userId))
    .returning();
  return updated;
}

/** Controller-only: opens the circuit breaker as a deterministic safety response. Never closes it. */
export async function openCircuitBreaker(db: ContentDatabase, userId: number, reason: string): Promise<void> {
  await getOrCreateAutonomyConfig(db, userId);
  await db
    .update(autonomyConfigs)
    .set({ circuitBreakerState: "open", circuitBreakerReason: reason, circuitBreakerOpenedAt: new Date(), updatedAt: new Date() })
    .where(eq(autonomyConfigs.userId, userId));
}
