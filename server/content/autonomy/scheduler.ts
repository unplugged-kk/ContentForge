import cron from "node-cron";
import { and as andOp, eq, isNull } from "drizzle-orm";
import { autonomyConfigs, policyCandidates } from "@shared/schema";
import type { ContentDatabase } from "../storage";
import type { JobRuntime } from "../../jobs/runtime";
import { enqueueAutonomyEvaluation } from "./job";

/**
 * Phase 31 — durable scheduler producer.
 *
 * The producer is intentionally boring: it finds (owner, scope) pairs that
 * currently have approved work AND automation enabled, then enqueues one
 * durable `autonomy.evaluate` job per pair. It never decides eligibility,
 * never reads evaluations, never touches policies. Missed or duplicate
 * producer runs are harmless: enqueue dedupes within the hour window, and
 * the controller re-evaluates everything at execution time.
 *
 * Two triggers feed the same enqueue path:
 *  - event-driven: `notifyCandidateApproved` called (best-effort) from the
 *    human review endpoint when a candidate becomes `approved_for_future`;
 *  - reconcile: `reconcileAutonomySchedule` scans for due pairs, driven by a
 *    6h cron (`startAutonomyScheduler`). The cron is trigger-only; all
 *    correctness state lives in Postgres.
 */

export const AUTONOMY_SCHEDULER_CRON = "0 */6 * * *";

export interface ReconcileResult {
  pairs: number;
  enqueued: number;
  deduplicated: number;
  failed: number;
}

/** Owners with automation on × scopes holding approved candidates. */
export async function findDueAutonomyPairs(
  db: ContentDatabase,
): Promise<Array<{ ownerId: number; targetScope: string }>> {
  const rows = await db
    .selectDistinct({ ownerId: policyCandidates.userId, targetScope: policyCandidates.targetScope })
    .from(policyCandidates)
    .innerJoin(autonomyConfigs, eq(autonomyConfigs.userId, policyCandidates.userId))
    .where(
      andOp(
        eq(policyCandidates.status, "approved_for_future"),
        eq(autonomyConfigs.enabled, true),
        eq(autonomyConfigs.mode, "bounded_activation"),
        eq(autonomyConfigs.activationAutomationEnabled, true),
        eq(autonomyConfigs.circuitBreakerState, "closed"),
        isNull(autonomyConfigs.pausedAt),
      ),
    );
  return rows;
}

export async function reconcileAutonomySchedule(
  db: ContentDatabase,
  runtime: JobRuntime,
  at: Date = new Date(),
): Promise<ReconcileResult> {
  const pairs = await findDueAutonomyPairs(db);
  const result: ReconcileResult = { pairs: pairs.length, enqueued: 0, deduplicated: 0, failed: 0 };
  for (const pair of pairs) {
    try {
      const outcome = await enqueueAutonomyEvaluation(runtime, {
        ownerId: pair.ownerId,
        targetScope: pair.targetScope,
        correlationId: `autonomy-reconcile-${pair.ownerId}-${at.getTime()}`,
        at,
      });
      if (outcome.deduplicated) result.deduplicated += 1;
      else result.enqueued += 1;
    } catch {
      // One bad pair must not stop the sweep; the next tick retries.
      // The throw is swallowed here AND logged by the caller.
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Best-effort hook for the human review endpoint: when a candidate becomes
 * `approved_for_future`, ask the controller soon rather than waiting for the
 * next 6h tick. Never throws (must not fail the review request); never
 * trusts its arguments (the worker rereads everything).
 */
export async function notifyCandidateApproved(
  runtime: JobRuntime | null,
  input: { ownerId: number; targetScope: string; candidateId: number },
): Promise<void> {
  if (!runtime) return;
  try {
    await enqueueAutonomyEvaluation(runtime, {
      ownerId: input.ownerId,
      targetScope: input.targetScope,
      candidateId: input.candidateId,
      correlationId: `autonomy-approval-${input.candidateId}`,
    });
  } catch {
    // Reconcile covers the miss.
  }
}

let task: import("node-cron").ScheduledTask | null = null;

/** Start the 6h reconcile tick. Trigger-only; safe to call twice. */
export function startAutonomyScheduler(
  db: ContentDatabase,
  getRuntime: () => JobRuntime | null,
): void {
  if (task) return;
  if (process.env.DISABLE_CRON === "1" || process.env.DISABLE_AUTONOMY_SCHEDULER === "1") {
    return;
  }
  task = cron.schedule(AUTONOMY_SCHEDULER_CRON, async () => {
    const runtime = getRuntime();
    if (!runtime) return;
    try {
      const result = await reconcileAutonomySchedule(db, runtime);
      console.log(
        `[autonomy-scheduler] reconcile: pairs=${result.pairs} enqueued=${result.enqueued} deduplicated=${result.deduplicated} failed=${result.failed}`,
      );
    } catch (error) {
      console.error("[autonomy-scheduler] reconcile failed:", error);
    }
  });
}

export function stopAutonomyScheduler(): void {
  task?.stop();
  task = null;
}

/** Test hook: is the cron tick currently scheduled? */
export function isAutonomySchedulerRunning(): boolean {
  return task !== null;
}
