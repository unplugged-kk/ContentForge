/**
 * ContentForge — X Developer Platform risk & compliance pointers.
 * Human-readable policy lives in docs/X_API_COMPLIANCE_AND_RISK.md.
 * Use these URLs + rule ids in PRs, Cursor context, or tests (not as legal advice).
 */

/** Official doc URLs (stable paths on docs.x.com). */
export const X_OFFICIAL_DOCS = {
  developerGuidelines: "https://docs.x.com/developer-guidelines",
  developerTerms: "https://docs.x.com/developer-terms",
  authenticationOverview: "https://docs.x.com/fundamentals/authentication/overview",
  v2AuthMapping: "https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping",
  oauth1ApiKey: "https://docs.x.com/fundamentals/authentication/oauth-1-0a/api-key-and-secret",
  rateLimitsFundamentals: "https://docs.x.com/fundamentals/rate-limits",
  rateLimitsV2: "https://docs.x.com/x-api/fundamentals/rate-limits",
  usagePostCap: "https://docs.x.com/x-api/fundamentals/post-cap",
  responseCodes: "https://docs.x.com/x-api/fundamentals/response-codes-and-errors",
  security: "https://docs.x.com/fundamentals/security",
  managePosts: "https://docs.x.com/x-api/posts/manage-tweets/introduction",
  createPost: "https://docs.x.com/x-api/posts/create-post",
  countingCharacters: "https://docs.x.com/fundamentals/counting-characters",
  openapiJson: "https://docs.x.com/openapi.json",
  llmsFullTxt: "https://docs.x.com/llms-full.txt",
  llmsTxt: "https://docs.x.com/llms.txt",
} as const;

export type XComplianceRuleSeverity = "must" | "should" | "product_review";

/** Machine-readable checklist aligned with ContentForge scope (draft → approve → publish). */
export const X_COMPLIANCE_RULES: ReadonlyArray<{
  id: string;
  severity: XComplianceRuleSeverity;
  summary: string;
}> = [
  {
    id: "user-initiated-publish",
    severity: "must",
    summary:
      "Only publish content the user explicitly created or approved for that post; no unsolicited @mentions, auto-replies, or bulk DMs.",
  },
  {
    id: "official-api-only",
    severity: "must",
    summary:
      "Use the official X API only for X data and actions — no HTML scraping of x.com/twitter.com, no browser automation.",
  },
  {
    id: "research-no-x-scrape",
    severity: "must",
    summary:
      "Web-wide research is fine; for x.com/twitter.com only: no HTML scraping — X post IDs via official tweet lookup when configured, or paste text / username analysis for profiles.",
  },
  {
    id: "research-no-ml-training-export",
    severity: "must",
    summary:
      "Do not use X API content to train external ML models or ship bulk redistribution; follow Developer Agreement limits on storage and redistribution.",
  },
  {
    id: "no-engagement-manipulation",
    severity: "must",
    summary:
      "Do not implement auto-like, scheduled likes, bulk follow/unfollow, engagement selling, or identical cross-account amplification.",
  },
  {
    id: "secrets-server-side",
    severity: "must",
    summary: "Keep OAuth consumer keys and user tokens server-side; never ship to the browser or log in clear text.",
  },
  {
    id: "rate-limit-backoff",
    severity: "must",
    summary: "Honor 429 and x-rate-limit-* headers; use exponential backoff on throttles.",
  },
  {
    id: "billing-aware-reads",
    severity: "should",
    summary:
      "For read-heavy features (search, timelines), cache aggressively; remember daily dedupe rules for billing.",
  },
  {
    id: "data-retention-deletion",
    severity: "must",
    summary:
      "Support deletion / export expectations for stored X payloads when users disconnect or policies require removal.",
  },
  {
    id: "ai-replies-enterprise-policy",
    severity: "product_review",
    summary:
      "If adding public auto-replies or AI-driven reply bots, review X policy on AI-generated replies and approvals — distinct from private drafting in ContentForge.",
  },
] as const;

/** Who triggered publish — drives stricter checks for the scheduler. */
export type XPublishInvoker = "user" | "scheduler";

export type XPostPublishGateInput = {
  status: string | null | undefined;
  scheduledAt: Date | string | null | undefined;
  /**
   * run 51 / B66 — the recorded provider ids, when the caller has them.
   *
   * This field is why the gate can answer the retry question at all. A retry is
   * a LATER request: the error from the failed attempt lived in that request's
   * stack and was never persisted, so an error-shaped predicate cannot be asked
   * at retry time. The row is the only survivor, and this is the part of the row
   * that says "something already reached the provider".
   */
  externalIds?: unknown;
};

/**
 * Does this row record units that actually reached the provider?
 *
 * run 51 / B66 — a partially published thread is written as `status="failed"`
 * with the ids that DID publish (run 50's fix). Treating that row as an ordinary
 * failure is what lets a retry republish live units as duplicates.
 *
 * Deliberately tolerant: a row read back from JSONB is not guaranteed to be
 * well-formed, and throwing here would turn a guard into a 500 on the retry
 * path — hiding the very reason the retry must not proceed.
 */
export function rowHasLiveUnits(row: { externalIds?: unknown } | null | undefined): boolean {
  if (!row) return false;
  const ids = (row as { externalIds?: unknown }).externalIds;
  if (!ids || typeof ids !== "object") return false;
  const x = (ids as Record<string, unknown>).x;
  return Array.isArray(x) && x.length > 0;
}

/**
 * Enforces X-aligned workflow: no publishing from draft; no duplicate publish;
 * scheduler only publishes due `scheduled` posts; manual API only from ready/scheduled/failed.
 */
export function assertEligibleForXPublish(
  post: XPostPublishGateInput,
  ctx: { invokedBy: XPublishInvoker },
): void {
  const status = post.status ?? "draft";
  if (status === "posted") {
    throw new Error("This post was already published to X.");
  }
  if (status === "draft") {
    throw new Error(
      "Mark this post as Ready or Scheduled before publishing. X expects user-initiated posting — drafts cannot be sent to the API.",
    );
  }
  // run 51 / B66 — a post that already reached the provider in part is not a
  // failure to retry. It is a live thread with a missing tail, and re-sending it
  // republishes the live units as duplicates, orphaning the originals with no way
  // to tell they were the same thread.
  //
  // The check is on the ROW, not an error object: a retry arrives in a later
  // request where the error no longer exists. `posted` is handled above and is
  // refused for its own reason, so this only speaks for non-posted rows.
  if (rowHasLiveUnits(post)) {
    const live = ((post as { externalIds?: { x?: unknown[] } }).externalIds?.x ?? []) as unknown[];
    // `status: 409` so the shared error handler (server/middleware/errorHandler.ts)
    // echoes this message to the operator instead of a generic "Internal server
    // error". A refusal the operator cannot read is a refusal they will work
    // around — and here, working around it means republishing live units.
    const blocked = new Error(
      `This post is ALREADY PARTIALLY PUBLISHED to X: ${live.length} unit(s) are live and cannot be un-sent. ` +
        `Do not retry it — a retry would republish those units as duplicates. ` +
        `Review the live posts before doing anything else.`,
    ) as Error & { status?: number };
    blocked.status = 409;
    throw blocked;
  }
  if (ctx.invokedBy === "scheduler") {
    if (status !== "scheduled") {
      throw new Error("[scheduler] Refused: only scheduled posts may be auto-published.");
    }
    const at =
      post.scheduledAt != null && post.scheduledAt !== ""
        ? new Date(post.scheduledAt as string | Date)
        : null;
    if (!at || Number.isNaN(at.getTime()) || at.getTime() > Date.now()) {
      throw new Error("[scheduler] Refused: post is not due yet.");
    }
    return;
  }
  const manual = new Set(["ready", "scheduled", "failed"]);
  if (!manual.has(status)) {
    throw new Error(
      `Cannot publish from status "${status}". Use Ready, Scheduled, or retry from Failed after reviewing the content.`,
    );
  }
}
