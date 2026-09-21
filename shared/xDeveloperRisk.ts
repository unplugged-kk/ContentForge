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
};

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
