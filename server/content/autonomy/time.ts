/**
 * Phase 33.7 — authoritative time semantics for the bounded-autonomy controller.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Every model timestamp in `shared/schema.ts` is a PostgreSQL
 * `timestamp WITHOUT time zone` whose default is `CURRENT_TIMESTAMP`. Such a
 * column stores a bare wall-clock reading taken in the *database session's*
 * time zone, and the Node `pg` driver materialises it as a JS `Date` by
 * appending `Z` (see `pg-types` `parseTimestamp`) — i.e. it reinterprets the
 * stored wall clock as UTC.
 *
 * Under a UTC session (the documented production expectation) those two steps
 * agree. Under ANY other session time zone they do not: a row written at
 * `14:07` IST (Asia/Kolkata) is stored as `2026-09-26 14:07` and read back as
 * `2026-09-26T14:07Z`, i.e. ~5.5 h *in the future* relative to `Date.now()`.
 * Measured: `Date.now() - createdAt.getTime() = -19 799 997 ms`. That single
 * skew inverted the cooldown gate (`elapsed >= cooldown*60000` became `false`
 * even for `cooldownMinutes = 0`) and cascaded into the churn / oscillation /
 * rollback assertions (the Phase 33.7 defect).
 *
 * AUTHORITATIVE TIME ZONE — DECISION
 * ----------------------------------
 * The authoritative time zone for autonomy date/window/budget/cooldown
 * semantics is **UTC** (`AUTONOMY_TIMEZONE`). Rationale:
 *   1. The autonomy windows were specified as absolute, rolling
 *      epoch-millisecond windows ("last 24 h", "last 7 d") with no calendar or
 *      time-zone arithmetic (Phase 29.4 deep audit: "rolling 24h/7d windows via
 *      epoch-millisecond comparisons"). UTC is their natural frame.
 *   2. The rest of the server expresses "since N" cut-offs as absolute instants
 *      (`new Date(Date.now() - N)`), and `toISOString()` / UTC is the app-wide
 *      convention.
 *   3. In a UTC session every `timestamp` column holds UTC wall clock, which is
 *      the documented production configuration (Railway default UTC; Phase 33.6
 *      audit).
 *
 * Crucially the controller no longer *depends* on the session being UTC. It
 * resolves every time comparison against the **database clock in the
 * database's own frame** (`now() - created_at`), which is exact for any session
 * time zone as long as writes and reads share it — which they do, because a
 * deployment uses a single pool. Choosing UTC is the documented contract;
 * being time-zone independent is the fix. We deliberately do NOT force the DB
 * to UTC: `server/db.ts` pins no session time zone (evidence), so a
 * pool-level `SET timezone` would be an unenforced deployment convention, not
 * an invariant the code can rely on.
 *
 * All helpers are pure and take an explicit/injectable `now`, so boundary
 * behaviour is unit-testable without a database.
 */

/** Authoritative IANA time zone for autonomy window/budget/cooldown semantics. */
export const AUTONOMY_TIMEZONE = "UTC";

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Daily/weekly autonomous-activation budgets are trailing, rolling windows. */
export const DAILY_WINDOW_MINUTES = 24 * 60;
export const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
export const ROLLBACK_WINDOW_MINUTES = 24 * 60;

export type TimeLike = number | Date | string;

/** Normalise a `number | Date | string` to absolute epoch milliseconds. */
export function toEpochMs(value: TimeLike): number {
  if (typeof value === "number") return value;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Start of the trailing, duration-based window ending at `now` (epoch ms).
 * Duration windows are absolute, so they are identical in every time zone and
 * are unaffected by DST transitions ("a day" is always 24 h).
 */
export function windowStartMs(now: TimeLike, windowMs: number): number {
  return toEpochMs(now) - windowMs;
}

/**
 * Pure: has `cooldownMinutes` elapsed since the absolute instant
 * `lastActivatedAt`? `now` is injectable for tests.
 *
 * NOTE: prefer {@link cooldownElapsedMs} with an elapsed value the database
 * computed, so no naive timestamp ever crosses the DB→JS boundary.
 */
export function cooldownElapsed(lastActivatedAt: TimeLike, cooldownMinutes: number, now: number = Date.now()): boolean {
  return cooldownElapsedMs(now - toEpochMs(lastActivatedAt), cooldownMinutes);
}

/** Pure: has the cooldown elapsed, given an already-computed `elapsedMs`? */
export function cooldownElapsedMs(elapsedMs: number, cooldownMinutes: number): boolean {
  return elapsedMs >= cooldownMinutes * MS_PER_MINUTE;
}

/** Pure: is the absolute instant `epochMs` inside the trailing `windowMs` before `now`? */
export function withinWindow(epochMs: number, now: TimeLike, windowMs: number): boolean {
  return epochMs >= windowStartMs(now, windowMs);
}

/**
 * Offset (ms) of `timeZone` from UTC at the given instant. Derived from
 * `Intl.DateTimeFormat` so it is DST-correct for the specific instant.
 */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts: Record<string, string> = {};
  for (const { type, value } of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(epochMs)) {
    parts[type] = value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * Start of the calendar day containing `epochMs`, in `timeZone` (default: the
 * authoritative zone). DST-correct: the returned instant is the local midnight,
 * which may be 23 h or 25 h away from the neighbouring day's midnight.
 */
export function startOfDay(now: TimeLike, timeZone: string = AUTONOMY_TIMEZONE): number {
  const epochMs = toEpochMs(now);
  const offset = zoneOffsetMs(epochMs, timeZone);
  const wallClock = epochMs + offset; // "wall clock" ms, read as if UTC
  const dayStartWall = Math.floor(wallClock / MS_PER_DAY) * MS_PER_DAY;
  // Re-resolve the offset at the resulting instant: the day may begin on the
  // other side of a DST transition.
  const startOffset = zoneOffsetMs(dayStartWall - offset, timeZone);
  return dayStartWall - startOffset;
}

/** Start of the ISO week (Monday 00:00) containing `epochMs`, in `timeZone`. */
export function startOfWeek(now: TimeLike, timeZone: string = AUTONOMY_TIMEZONE): number {
  const dayStart = startOfDay(now, timeZone);
  const offset = zoneOffsetMs(dayStart, timeZone);
  const dayOfWeek = new Date(dayStart + offset).getUTCDay(); // 0=Sun … 6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return dayStart - daysSinceMonday * MS_PER_DAY;
}

export interface AutonomyWindowBoundaries {
  timeZone: string;
  dayStartMs: number;
  weekStartMs: number;
  dailyWindowMinutes: number;
  weeklyWindowMinutes: number;
}

/**
 * The explicit, deterministic day/week boundaries for `now`, recorded on budget
 * decisions so "which day/week did this fall in" is always auditable in the
 * authoritative zone.
 */
export function autonomyWindowBoundaries(
  now: TimeLike,
  timeZone: string = AUTONOMY_TIMEZONE,
): AutonomyWindowBoundaries {
  const epochMs = toEpochMs(now);
  return {
    timeZone,
    dayStartMs: startOfDay(epochMs, timeZone),
    weekStartMs: startOfWeek(epochMs, timeZone),
    dailyWindowMinutes: DAILY_WINDOW_MINUTES,
    weeklyWindowMinutes: WEEKLY_WINDOW_MINUTES,
  };
}
