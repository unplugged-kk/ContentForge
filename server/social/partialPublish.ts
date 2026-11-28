/**
 * Partial thread publish error, durable record builder, and retry predicates (run50 + run51).
 *
 * Pure module: no database, no network, no imports from `x.ts`. Re-exports
 * `rowHasLiveUnits` from `@shared/xDeveloperRisk` so the publish gate and server
 * helpers share one predicate.
 */

import { rowHasLiveUnits } from "@shared/xDeveloperRisk";

export { rowHasLiveUnits };

export type PartialPublishInput = {
  /** Tweet ids the provider actually returned, in order. */
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
 * Raised when one or more units of an X thread reached the provider before a
 * later unit failed or timed out.
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
 * Build the `posts` row update for a partially published thread, preserving any
 * prior platform ids while recording the live X ids and urls.
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
    externalIds: { ...priorIds, x: [...error.tweetIds] },
    externalUrls: { ...priorUrls, x: [...error.urls] },
  };
}

/**
 * A failed row or error may only be retried when nothing reached X.
 */
export function isSafeToRetry(errOrRow: unknown): boolean {
  if (errOrRow instanceof XPartialPublishError) return errOrRow.publishedCount === 0;
  if (isRowLike(errOrRow)) {
    if (errOrRow.status === "posted") return false;
    return !rowHasLiveUnits(errOrRow);
  }
  return true;
}

function isRowLike(value: unknown): value is { status?: string | null; externalIds?: unknown } {
  return (
    !!value &&
    typeof value === "object" &&
    !(value instanceof Error) &&
    ("status" in (value as Record<string, unknown>) || "externalIds" in (value as Record<string, unknown>))
  );
}

/**
 * Operator-facing explanation of why a retry is blocked, or null when allowed.
 */
export function retryBlockedReason(errOrRow: unknown): string | null {
  if (errOrRow instanceof XPartialPublishError) {
    if (errOrRow.publishedCount === 0) return null;
    return errOrRow.message;
  }
  if (isRowLike(errOrRow)) {
    if (errOrRow.status === "posted") return "This post was already published to X.";
    if (rowHasLiveUnits(errOrRow)) {
      const live = ((errOrRow.externalIds as { x?: unknown[] }).x ?? []) as unknown[];
      const total = (errOrRow as { totalUnits?: number }).totalUnits;
      const ofTotal = typeof total === "number" ? ` of ${total}` : "";
      return (
        `Thread published PARTIALLY: ${live.length}${ofTotal} unit(s) are LIVE on X and cannot be ` +
        `un-sent. Do NOT retry this post as-is — a retry republishes them as duplicates.`
      );
    }
    return null;
  }
  return null;
}
