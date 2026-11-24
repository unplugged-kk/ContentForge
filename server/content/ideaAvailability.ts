/**
 * Run 57 — which discovered ideas may the autopilot actually draft from?
 *
 * Two defects live in the ideas→drafts link, and they compose:
 *
 * D-A  `storage.getDiscoveredIdeas(userId)` (no batchId) is
 *      `ORDER BY discovered_at DESC, rank LIMIT 50`. Three drafting sites call it,
 *      so the RANKING POOL is the newest 50 rows — not the idea pool. Measured on
 *      the live table: 301 `new` ideas pass the niche + viral filters, but only 29
 *      of them are inside the window. 272 usable ideas (74 with viral >= 9.0) are
 *      invisible to the selector. The pool did not shrink; the window did.
 *
 * D-B  `rankIdeas()` filters on niche and viral only — never on status — and the
 *      two callers disagree about which statuses mean "already used":
 *        autofillCalendar  : ideas.filter(i => i.status !== "used")
 *        weekend content   : ideas.filter(i => i.status !== "used")
 *      while runDailyAutoPost and scheduleManualPost MARK their idea `"scheduled"`.
 *      So an idea that already produced a post is still eligible for another one.
 *
 * Neither is visible today, because D-A keeps every `scheduled` row out of the
 * window by accident. That is masking, not safety: lifting the cap alone makes the
 * top pick on the live pool an idea that already has a post (measured — see
 * `probe_composition.ts`). A fix for one that ignores the other trades a starved
 * pool for duplicate drafts.
 *
 * So this module answers one question, once, for every drafting site:
 *   "may this idea be drafted from, and if not, why not?"
 *
 * Pure: no db, no network, no model. Callers pass the rows they already have.
 */

/**
 * Statuses a discovered idea can carry that mean it has NOT yet been consumed.
 *
 * Enumerated rather than expressed as `status !== "used"`, because the existing
 * writers use four different words for "consumed" — `used` (autopilot),
 * `scheduled` (autopilot daily + manual), `auto-drafted` (rssAutopost) — and a
 * deny-list of one leaves the other three eligible. There is no migration and no
 * enum on this column, so the safe shape is to name what IS available.
 */
export const AVAILABLE_IDEA_STATUSES = ["new", "briefing_drafted"] as const;

/** Statuses a writer sets when the idea has produced content. */
export const CONSUMED_IDEA_STATUSES = ["used", "scheduled", "auto-drafted", "saved"] as const;

export function isIdeaAvailable(status: string | null | undefined): boolean {
  if (!status) return false;
  return (AVAILABLE_IDEA_STATUSES as readonly string[]).includes(status);
}

/**
 * The one predicate every drafting site should filter on before ranking.
 *
 * Returns a reason rather than a bare boolean so a caller (or a test) can say
 * WHY an idea was skipped. A silent filter is what let this sit: the pool was
 * 90% invisible and nothing anywhere reported a shortfall.
 */
export function ideaSkipReason(status: string | null | undefined): string | null {
  if (isIdeaAvailable(status)) return null;
  if (!status) return "no status recorded";
  if ((CONSUMED_IDEA_STATUSES as readonly string[]).includes(status)) return `already consumed (status="${status}")`;
  return `unrecognised status "${status}"`;
}

/**
 * How many rows the idea query must be able to return.
 *
 * A fixed cap cannot be correct: it is a number chosen for the pool as it was,
 * and it silently truncates the pool as it grows. It truncates BEFORE the
 * status/niche/viral filters run, so the loss is not proportional — measured,
 * 50 rows yielded only 29 ranked candidates while the table held 329.
 *
 * The caller passes the filters' own reach; this returns a page size that covers
 * the whole eligible set with headroom, bounded so a runaway table cannot return
 * an unbounded array.
 */
export function ideaQueryLimit(eligibleEstimate: number, headroom = 4, hardCap = 2000): number {
  if (!Number.isFinite(eligibleEstimate) || eligibleEstimate <= 0) return 200;
  return Math.min(hardCap, Math.max(200, Math.ceil(eligibleEstimate * headroom)));
}

/**
 * Apply the availability filter and report what it removed.
 *
 * `kept` is what the ranker may see. `skipped` carries the reasons, so a caller
 * that wants to log starvation can do so instead of the pool silently shrinking.
 */
export function partitionByAvailability<T extends { status?: string | null }>(
  rows: T[],
): { kept: T[]; skipped: { row: T; reason: string }[] } {
  const kept: T[] = [];
  const skipped: { row: T; reason: string }[] = [];
  for (const row of rows) {
    const reason = ideaSkipReason(row.status);
    if (reason === null) kept.push(row);
    else skipped.push({ row, reason });
  }
  return { kept, skipped };
}
