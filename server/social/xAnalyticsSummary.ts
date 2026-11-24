/**
 * run47 / B59 — honest reporting for the X analytics refresh.
 *
 * Why this module exists rather than an inline console.log:
 *
 * `refreshXAnalytics` is a fire-and-forget cron. Its only output is one line in
 * the container log, and that line used to report `targets.length` — the number
 * of posts SELECTED, not synced. When the analytics endpoint is unset (the state
 * on this host) every call returns before its first `fetch`, nothing is written,
 * and the log still reads "refreshed 64 posts". A reader — human or agent —
 * concludes the feedback loop is running when it has never once run.
 *
 * So the summary is a value, not a formatted string at the call site: it can be
 * asserted on, and it refuses to reconcile.
 */

export type AnalyticsRefreshOutcome = {
  /** posts that matched (status=posted, x ids present, inside the window) */
  eligible: number;
  /** posts whose analytics were fetched AND written */
  synced: number;
  /** posts the code explicitly declined to sync, with a reason */
  skipped: number;
  /** posts where the sync was attempted and threw */
  failed: number;
  /** why the skipped ones were skipped — carried so the cause survives */
  skipReason?: string;
};

export type AnalyticsRefreshSummary = {
  /** true only when every eligible post was synced and none failed */
  clean: boolean;
  message: string;
};

/**
 * Build the one-line summary for a refresh pass.
 *
 * Throws when the counters do not reconcile: `eligible` must equal
 * synced + skipped + failed. A summary whose parts do not add up is the same
 * defect class as the original line — it reports a number that is not the
 * number that matters.
 */
export function summariseAnalyticsRefresh(outcome: AnalyticsRefreshOutcome): AnalyticsRefreshSummary {
  const { eligible, synced, skipped, failed, skipReason } = outcome;
  const accounted = synced + skipped + failed;
  if (eligible !== accounted) {
    throw new Error(
      `analytics refresh counters do not reconcile: eligible=${eligible} but synced+skipped+failed=${accounted}`,
    );
  }

  if (eligible === 0) {
    return { clean: true, message: "[x analytics] no posts in window — nothing to refresh" };
  }

  const parts = [`${eligible} eligible`, `${synced} synced`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);
  const reason = skipReason ? ` — ${skipReason}` : "";
  const clean = synced === eligible && failed === 0;

  // Deliberately does not read "refreshed N posts" when N is not synced.
  const verb = clean ? "refreshed" : "incomplete";
  return {
    clean,
    message: `[x analytics] ${verb}: ${parts.join(", ")}${reason}`,
  };
}
