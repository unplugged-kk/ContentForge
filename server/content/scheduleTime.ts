/**
 * Future-schedule validation for route boundaries writing `status = "scheduled"` (run60 / B82).
 *
 * Kept at the HTTP route boundary rather than in storage so the scheduler's own
 * retry loop can still re-mark a failed post `scheduled` with its original
 * timestamp via `storage.updatePost`.
 *
 * Pure module: no db, no network, no clock except the `now` parameter.
 */

/** Slack for clock skew between browser and server, in milliseconds. */
export const SCHEDULE_SKEW_MS = 60_000;

export type ScheduleTimeCheck =
  | { ok: true; at: Date }
  | { ok: false; reason: string };

/**
 * Validate a client-supplied `scheduledAt` when setting status to `scheduled`.
 * A missing value is allowed ("keep the existing time").
 */
export function checkScheduledAt(
  raw: string | Date | null | undefined,
  now: Date = new Date(),
): ScheduleTimeCheck {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, at: now };
  }
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      return { ok: false, reason: "scheduledAt must be a valid ISO date string" };
    }
    if (raw.getTime() <= now.getTime() - SCHEDULE_SKEW_MS) {
      const behind = Math.round((now.getTime() - raw.getTime()) / 60_000);
      return {
        ok: false,
        reason:
          `scheduledAt is ${behind} minute(s) in the past. A post scheduled in the past ` +
          `publishes on the next 60-second tick. Pick a time in the future.`,
      };
    }
    return { ok: true, at: raw };
  }
  if (typeof raw !== "string") {
    return { ok: false, reason: "scheduledAt must be an ISO date string" };
  }
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, reason: "scheduledAt must be a valid ISO date string" };
  }
  if (at.getTime() <= now.getTime() - SCHEDULE_SKEW_MS) {
    const behind = Math.round((now.getTime() - at.getTime()) / 60_000);
    return {
      ok: false,
      reason:
        `scheduledAt is ${behind} minute(s) in the past. A post scheduled in the past ` +
        `publishes on the next 60-second tick. Pick a time in the future.`,
    };
  }
  return { ok: true, at };
}

/**
 * Only `status === "scheduled"` requires a future time; editing a draft/ready/
 * posted/failed row must not be blocked by a stale timestamp.
 */
export function needsFutureSchedule(status: string | null | undefined): boolean {
  return status === "scheduled";
}

/**
 * Combined guard for route handlers writing post status and/or `scheduledAt`.
 */
export function checkScheduleWrite(
  status: string | null | undefined,
  scheduledAt: string | Date | null | undefined,
  now: Date = new Date(),
): ScheduleTimeCheck {
  if (!needsFutureSchedule(status)) return { ok: true, at: now };
  return checkScheduledAt(scheduledAt, now);
}
