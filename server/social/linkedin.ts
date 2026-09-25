/**
 * LinkedIn transport — LinkedIn Posts (UGC) API, real contract.
 *
 * Unlike xQuick, LinkedIn's Posts API is synchronous: a request either
 * receives an HTTP response (decisive) or the transport itself fails before
 * a response arrives (network timeout/reset — genuinely ambiguous, since
 * LinkedIn may or may not have received the write). There is no
 * provider-native async write-action/poll protocol here, so ambiguity is
 * modeled at the network layer instead, and reconciliation works by
 * re-listing the author's recent posts and matching on the exact pinned
 * commentary text.
 */

import { storage } from "../storage";

const LINKEDIN_VERSION = "202401";
const RESTLI_PROTOCOL_VERSION = "2.0.0";

type LinkedInConfig = { baseUrl: string; token: string; authorUrn: string };

function getLinkedInBaseUrl(): string {
  return (process.env.LINKEDIN_API_BASE_URL?.trim() || "https://api.linkedin.com").replace(/\/+$/, "");
}

async function getLinkedInConfig(ownerUserId?: number | null): Promise<LinkedInConfig | null> {
  const account = ownerUserId == null
    ? await storage.getConnectedAccount("linkedin")
    : await storage.getConnectedAccountForOwner("linkedin", ownerUserId);
  // The owner's own connected account wins. The deployment-level env pair is
  // an operator-wide default (not another tenant's row), so it stays a valid
  // fallback — owner scoping forbids borrowing a *different owner's* account,
  // not the deployment's own configured credentials.
  const token = account?.accessToken?.trim() || process.env.LINKEDIN_ACCESS_TOKEN?.trim() || null;
  const authorUrn = account?.username?.trim() || process.env.LINKEDIN_AUTHOR_URN?.trim() || null;
  if (!token || !authorUrn) return null;
  return { baseUrl: getLinkedInBaseUrl(), token, authorUrn };
}

function buildHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": RESTLI_PROTOCOL_VERSION,
  };
}

function timeoutMs(): number {
  return Number(process.env.LINKEDIN_TIMEOUT_MS ?? 30_000);
}

/**
 * Translate raw LinkedIn API error text into a human-readable message.
 */
export function translateLinkedInError(body: string): string {
  if (body.includes("LINKEDIN_CONFIG_MISSING"))
    return "LinkedIn credentials missing: set LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN, or connect a LinkedIn account in Settings.";
  if (/ACCESS_DENIED|invalid.*token|401/i.test(body))
    return "LinkedIn credentials expired or invalid. Reconnect LinkedIn in Settings.";
  if (/throttl|429|rate limit/i.test(body)) return "LinkedIn API rate limit reached. Try again later.";
  return body;
}

/**
 * The write was sent but the transport failed before a response arrived
 * (timeout / connection reset). LinkedIn's Posts API is otherwise
 * synchronous, so this is the only ambiguous case: the post may or may not
 * exist. `hint` is the durable handle reconciliation later re-checks against
 * — the exact commentary text and the moment the attempt was made, since
 * LinkedIn issues no request/write-action id of its own.
 */
export class LinkedInPublishAmbiguousError extends Error {
  constructor(
    readonly hint: { commentary: string; attemptedAt: string },
    message: string,
  ) {
    super(message);
    this.name = "LinkedInPublishAmbiguousError";
  }
}

export type LinkedInPostResult = { postUrn: string; url: string | null };

/** Post a single text update via LinkedIn's Posts API. Real REST contract, no thread-splitting needed. */
export async function postTextToLinkedIn(text: string, ownerUserId?: number | null): Promise<LinkedInPostResult> {
  const config = await getLinkedInConfig(ownerUserId);
  if (!config) throw new Error("LINKEDIN_CONFIG_MISSING");

  const body = {
    author: config.authorUrn,
    commentary: text,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  const attemptedAt = new Date().toISOString();
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/rest/posts`, {
      method: "POST",
      headers: buildHeaders(config.token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (error) {
    // The transport itself failed before any response — LinkedIn may or may
    // not have received the write. Never assume either outcome.
    const message = error instanceof Error ? error.message : String(error);
    throw new LinkedInPublishAmbiguousError(
      { commentary: text, attemptedAt },
      `LinkedIn post transport failed before a response arrived: ${message}`,
    );
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(bodyText || `LinkedIn API returned HTTP ${res.status}`);
  }

  const postUrn = res.headers.get("x-restli-id");
  if (!postUrn) throw new Error("LINKEDIN_POST_ID_MISSING");
  return { postUrn, url: `https://www.linkedin.com/feed/update/${postUrn}/` };
}

export type LinkedInReconcileStatus =
  | { status: "success"; postUrn: string; url: string | null }
  | { status: "pending" };

/**
 * Reconciliation: re-list the author's recent posts and look for one whose
 * commentary exactly matches the pinned text and whose creation time is at
 * or after the original attempt. A miss is `pending` (still unknown) —
 * LinkedIn's listing has no documented consistency guarantee, so absence is
 * never treated as proof the post does not exist.
 */
export async function reconcileLinkedInPost(hint: {
  commentary: string;
  attemptedAt: string;
}, ownerUserId?: number | null): Promise<LinkedInReconcileStatus | null> {
  const config = await getLinkedInConfig(ownerUserId);
  if (!config) return null;

  const params = new URLSearchParams({ q: "author", author: config.authorUrn, count: "10" });
  const res = await fetch(`${config.baseUrl}/rest/posts?${params}`, {
    headers: buildHeaders(config.token),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as { elements?: Array<Record<string, unknown>> } | null;
  const elements = Array.isArray(data?.elements) ? data!.elements! : [];
  const attemptedAtMs = Date.parse(hint.attemptedAt);

  for (const element of elements) {
    if (element.commentary !== hint.commentary) continue;
    const createdAt = typeof element.createdAt === "number" ? element.createdAt : null;
    if (createdAt !== null && createdAt < attemptedAtMs) continue;
    const postUrn = typeof element.id === "string" ? element.id : null;
    if (!postUrn) continue;
    return { status: "success", postUrn, url: `https://www.linkedin.com/feed/update/${postUrn}/` };
  }
  return { status: "pending" };
}
