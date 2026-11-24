/**
 * run 50 — a thread that published PARTIALLY must leave a record.
 *
 * The risk this closes: `postContentToX` posts a thread one unit at a time, in a
 * loop. When unit K fails, units 1..K-1 are ALREADY LIVE on X. The loop simply
 * threw, and the thrown error carried nothing — no ids, no count, no hint that
 * anything had published. `publishPostToX` therefore wrote `externalIds: null`
 * and status `failed`, so the row described a post that "failed" while part of
 * it was publicly visible.
 *
 * Measured on this host before the fix (evidence/run50/probe_partial_thread.ts):
 * 4-unit thread, unit 3 times out — the provider received 3 create calls, 2 of
 * them returned tweet ids, and the caller held `ids: 0`. The 9 most recent
 * thread posts in the live database are all `failed` with `external_ids = NULL`.
 *
 * Why it matters beyond bookkeeping: a failed row is retryable in the UI
 * (`assertEligibleForXPublish` admits `failed` for a manual publish), so the
 * natural operator action — retry — republishes units 1..K-1 as NEW tweets and
 * leaves the originals orphaned. The record is the thing that prevents that.
 *
 * This module is deliberately pure: no database, no network, no imports from
 * `x.ts`. The record shape is asserted without a live Postgres, which is what
 * makes the behaviour testable rather than merely present.
 */

export type PartialPublishInput = {
  /** Tweet ids the provider ACTUALLY returned, in order. Never inferred. */
  tweetIds: readonly string[];
  /** Deep links built from those ids. */
  urls: readonly string[];
  /** 1-based index of the unit whose outcome was lost. */
  failedUnit: number;
  /** Total units the thread intended to publish. */
  totalUnits: number;
  /** The raw error from the transport. */
  cause: unknown;
};

/**
 * A thread partially reached the provider.
 *
 * `unitOutcomeUnknown` is true because the failing request may itself have been
 * accepted before the timeout: a timeout is not proof of non-publication. The
 * message must therefore say "at least N are live", never "exactly N".
 */
export class XPartialPublishError extends Error {
  readonly tweetIds: readonly string[];
  readonly urls: readonly string[];
  readonly publishedCount: number;
  readonly failedUnit: number;
  readonly totalUnits: number;
  /** The failing unit's own outcome could not be established. */
  readonly unitOutcomeUnknown: boolean;

  constructor(input: PartialPublishInput) {
    super(describePartialPublish(input));
    this.name = "XPartialPublishError";
    this.tweetIds = [...input.tweetIds];
    this.urls = [...input.urls];
    this.publishedCount = input.tweetIds.length;
    this.failedUnit = input.failedUnit;
    this.totalUnits = input.totalUnits;
    this.unitOutcomeUnknown = true;
    (this as { cause?: unknown }).cause = input.cause;
  }
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

/**
 * The operator-facing sentence. It names the count, the range that is live, the
 * unit whose state is unknown, and the one action that must NOT be taken.
 */
export function describePartialPublish(input: {
  tweetIds: readonly string[];
  urls: readonly string[];
  failedUnit: number;
  totalUnits: number;
  cause: unknown;
  unitOutcomeUnknown?: boolean;
}): string {
  const live = input.tweetIds.length;
  const range = live === 1 ? "unit 1 is" : `units 1-${live} are`;
  const unknown = input.unitOutcomeUnknown ?? true;
  const firstUrl = input.urls[0];
  const where = firstUrl ? ` First published unit: ${firstUrl}` : "";
  return (
    `Thread published PARTIALLY: ${live} of ${input.totalUnits} units reached X before ` +
    `unit ${input.failedUnit}'s outcome was lost (${causeMessage(input.cause)}). ` +
    `${range} LIVE and cannot be un-sent` +
    (unknown ? `; unit ${input.failedUnit}'s own outcome is UNKNOWN — it may have been accepted.` : ".") +
    ` Do NOT retry this post as-is — a retry republishes the live units as duplicates.` +
    where
  );
}

/**
 * The failed-row UPDATE for the legacy `posts` path.
 *
 * The ids are the whole point: a `failed` row that also carries `external_ids`
 * is a truthful description of a partial publish, and a later reconciliation
 * pass (or Kishore, reading the row) can see what is actually on X.
 */
export function partialPublishRecord(
  post: { externalIds?: unknown; externalUrls?: unknown } | null | undefined,
  error: XPartialPublishError,
): { status: "failed"; errorMessage: string; externalIds: Record<string, unknown>; externalUrls: Record<string, unknown> } {
  const priorIds = (post?.externalIds ?? {}) as Record<string, unknown>;
  const priorUrls = (post?.externalUrls ?? {}) as Record<string, unknown>;
  return {
    status: "failed",
    errorMessage: error.message,
    // Union, not replacement: if anything was already recorded, losing it here
    // would recreate the defect one layer up.
    externalIds: { ...priorIds, x: [...error.tweetIds] },
    externalUrls: { ...priorUrls, x: [...error.urls] },
  };
}

/**
 * A failed row may only be retried when NOTHING published. This is the predicate
 * the retry paths ask, so "partial" can never be treated as "failed".
 */
export function isSafeToRetry(err: unknown): boolean {
  if (err instanceof XPartialPublishError) return err.publishedCount === 0;
  return true;
}
