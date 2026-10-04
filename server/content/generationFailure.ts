/**
 * Pure failure-classification predicates for the generation → run bridge (F5).
 *
 * Deliberately dependency-free. These are decided by the failure class and the
 * run status alone, and a unit test for them must not have to import the whole
 * content service — and through it the AI client, the queue, and the database —
 * just to check a boolean.
 */

/**
 * Is this generation failure terminal for the owning run?
 *
 * `transient` and `rate_limited` are retryable: the queue re-runs the job, so
 * the run must keep waiting. Everything else dead-letters the job, and a run
 * whose only work has dead-lettered must not keep reporting `running`.
 */
export function isTerminalGenerationFailure(failureClass: string): boolean {
  return failureClass !== "transient" && failureClass !== "rate_limited";
}

/** A run is only nudged while it is still unfinished. */
export function shouldNudgeRun(status: string): boolean {
  return status === "pending" || status === "running";
}
