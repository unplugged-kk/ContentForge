/**
 * Run 60 / B82 — "scheduled" must mean "in the future", and only one of the
 * three routes that can write it enforced that.
 *
 * `server/scheduler.ts` publishes anything with `status = 'scheduled'` whose
 * `scheduledAt` is <= now, on a 60-second tick. `isDue()` is
 * `scheduledAt <= new Date()` — deliberately, because it must also fire a slot
 * whose time arrived while the process was down.
 *
 * So the ONLY thing between an operator's click and an immediate publish is the
 * value they write into `scheduledAt`. Two routes accepted that value unguarded:
 *
 *   PATCH /api/posts/:id/status   -> updatePostStatus(userId, id, status, scheduledAt)
 *   PUT   /api/posts/:id          -> updatePost(userId, id, req.body)   // whole row
 *
 * while a THIRD route in the same file already knew the rule:
 *
 *   POST /api/posts/schedule      -> "scheduledAt must be a valid future datetime"
 *
 * The two client UIs also check `> Date.now()` (queue.tsx:271, calendar.tsx:390),
 * which is exactly why nobody noticed: the constraint existed in the browser and
 * in one API route, and was missing from the route the UI actually calls to
 * approve a draft.
 *
 * Why the check belongs at the ROUTE and not in storage: the scheduler's own
 * retry path re-marks a FAILED post as `scheduled` with its ORIGINAL, already-past
 * `scheduledAt` (scheduler.ts:73, no new time passed). A storage-level guard would
 * make every retry impossible. The distinction is not "is this time in the past"
 * but "did a CLIENT supply this time on this request".
 *
 * Pure module: no db, no net, no clock of its own except the `now` argument.
 */

/** Slack for clock skew between browser and server, in milliseconds. */
export const SCHEDULE_SKEW_MS = 60_000;

export type ScheduleTimeCheck =
  | { ok: true; at: Date }
  | { ok: false; reason: string };

/**
 * Validate a client-supplied `scheduledAt` for a request that sets status to
 * `scheduled`.
 *
 * Returns `ok: true` with the parsed date, or `ok: false` with a message written
 * for an operator to read (it is returned in the 400 body).
 *
 * A missing value is NOT rejected here: scheduling without a time means "leave
 * the existing time", which the storage layer already handles (`if (scheduledAt)`).
 * Rejecting it would break the legitimate "promote this draft to scheduled at the
 * time it already carries" flow.
 */
export function checkScheduledAt(
  raw: string | Date | null | undefined,
  now: Date = new Date(),
): ScheduleTimeCheck {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, at: now };
  }
  // A route that has already normalised its body (server/content/postBody.ts)
  // hands us a Date; one that has not hands us the raw string.
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
 * The predicate a route should ask before writing `status = "scheduled"`.
 *
 * Kept separate from `checkScheduledAt` so a route that sets some OTHER status
 * (draft, ready, posted, failed) is never blocked by a stale `scheduledAt` in the
 * same payload — editing a draft's text must not require a future date.
 */
export function needsFutureSchedule(status: string | null | undefined): boolean {
  return status === "scheduled";
}

/**
 * One call a route makes, covering both the status and the time.
 *
 * `ok: true` means the write may proceed. `ok: false` carries the message to put
 * in a 400.
 */
export function checkScheduleWrite(
  status: string | null | undefined,
  scheduledAt: string | Date | null | undefined,
  now: Date = new Date(),
): ScheduleTimeCheck {
  if (!needsFutureSchedule(status)) return { ok: true, at: now };
  return checkScheduledAt(scheduledAt, now);
}
