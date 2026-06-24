import type { Post, Tweet } from "@shared/schema";
import { assertEligibleForXPublish, type XPublishInvoker } from "@shared/xDeveloperRisk";
import { storage } from "../storage";
import { addThreadNumbering } from "../utils/threadUtils";

/** X API monthly read budget (Basic tier). Warn at 70% (7000 reads). */
export const X_MONTHLY_READ_LIMIT = 10_000;
export const X_MONTHLY_WARN_THRESHOLD = 7_000;

/**
 * Translate raw X API error text into a human-readable message.
 * Copied and adapted from postiz-app/x.provider.ts handleErrors().
 */
export function translateXError(body: string): string {
  if (body.includes("XQUICK_CONFIG_MISSING"))
    return "xQuick credentials missing: set XQUIK_API_KEY and XQUIK_ACCOUNT, or connect an xQuick token in Settings.";
  if (body.includes("XQUICK_POST_ID_MISSING"))
    return "xQuick accepted the request but did not return a post id. Check XQUICK_POST_ID_PATH / response mapping.";
  if (body.includes("usage-capped"))
    return "X API usage cap reached. Try again later.";
  if (body.includes("duplicate-rules") || body.includes("duplicate content"))
    return "Duplicate post — X requires unique content. Edit your tweet and try again.";
  if (body.includes("Unsupported Authentication"))
    return "X credentials expired or invalid. Reconnect X in Settings.";
  if (body.includes("You are not permitted to perform this action"))
    return "X rejected this post — check character count and media attachments.";
  if (body.includes("maximum of one cashtag"))
    return "Maximum one cashtag ($SYMBOL) allowed per post.";
  if (body.includes("The Tweet contains an invalid URL"))
    return "Post contains a URL that X does not allow.";
  if (body.includes("not allowed to post a video longer than 2 minutes"))
    return "Video exceeds the 2-minute limit for this account type.";
  if (body.includes("maximum of 4 items"))
    return "Maximum 4 media attachments per post.";
  if (body.includes("Authorization"))
    return "X authorization failed. Check your API credentials in Settings.";
  return body;
}

/** Non-secret wiring status for Settings / debugging */
export async function getXPostingConfigSummary(): Promise<{
  provider: "xquick";
  hasXQuickBaseUrl: boolean;
  hasXQuickApiKey: boolean;
  hasXQuickAccount: boolean;
  hasConnectedAccountToken: boolean;
  canAttemptPost: boolean;
  postEndpoint: string;
}> {
  const acc = await storage.getConnectedAccount("x");
  const hasXQuickBaseUrl = !!getXQuickBaseUrl();
  const hasXQuickApiKey = !!getXQuickToken(acc?.accessToken ?? null);
  const hasXQuickAccount = !!getXQuickAccount(acc?.username ?? null);

  return {
    provider: "xquick",
    hasXQuickBaseUrl,
    hasXQuickApiKey,
    hasXQuickAccount,
    hasConnectedAccountToken: !!acc?.accessToken,
    canAttemptPost: hasXQuickBaseUrl && hasXQuickApiKey && hasXQuickAccount,
    postEndpoint: getXQuickPostEndpoint(),
  };
}

export type XPublishResult = {
  tweetIds: string[];
  urls: string[];
  username: string | null;
};

export type XArticlePublishCapability = {
  canPublish: boolean;
  reason: string;
  docsUrl: string;
};

type XQuickPostResponse = {
  id?: string;
  tweetId?: string;
  postId?: string;
  writeActionId?: string;
  status?: string;
  error?: string;
  message?: string;
  url?: string;
  username?: string;
  data?: XQuickPostResponse;
  result?: XQuickPostResponse;
  user?: { username?: string };
};

function getXQuickBaseUrl(): string | null {
  return (
    process.env.XQUIK_API_BASE_URL?.trim() ||
    process.env.XQUICK_API_BASE_URL?.trim() ||
    "https://xquik.com/api/v1"
  ).replace(/\/+$/, "");
}

function getXQuickPostEndpoint(): string {
  return process.env.XQUIK_POST_ENDPOINT?.trim() || process.env.XQUICK_POST_ENDPOINT?.trim() || "/x/tweets";
}

function getXQuickWriteActionEndpoint(): string {
  return (
    process.env.XQUIK_WRITE_ACTION_ENDPOINT?.trim() ||
    process.env.XQUICK_WRITE_ACTION_ENDPOINT?.trim() ||
    "/x/write-actions/{id}"
  );
}

function getXQuickReadEndpoint(): string | null {
  return (
    process.env.XQUIK_TWEET_LOOKUP_ENDPOINT?.trim() ||
    process.env.XQUICK_TWEET_LOOKUP_ENDPOINT?.trim() ||
    "/x/tweets/{id}"
  );
}

function getXQuickAnalyticsEndpoint(): string | null {
  return process.env.XQUIK_ANALYTICS_ENDPOINT?.trim() || process.env.XQUICK_ANALYTICS_ENDPOINT?.trim() || null;
}

function getXQuickToken(fallbackToken: string | null): string | null {
  return process.env.XQUIK_API_KEY?.trim() || process.env.XQUICK_API_KEY?.trim() || fallbackToken || null;
}

function getXQuickAccount(fallbackUsername: string | null): string | null {
  const account =
    process.env.XQUIK_ACCOUNT?.trim() ||
    process.env.XQUIK_ACCOUNT_ID?.trim() ||
    process.env.XQUIK_USERNAME?.trim() ||
    process.env.XQUICK_ACCOUNT?.trim() ||
    process.env.XQUICK_ACCOUNT_ID?.trim() ||
    process.env.XQUICK_USERNAME?.trim() ||
    process.env.X_USERNAME?.trim() ||
    fallbackUsername;
  return account ? account.replace(/^@/, "") : null;
}

function joinUrl(base: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${base}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

function getPathValue(input: any, path: string | undefined): any {
  if (!path) return undefined;
  return path.split(".").reduce((current, key) => current?.[key], input);
}

function buildXQuickHeaders(token: string): Record<string, string> {
  const headerName = process.env.XQUIK_AUTH_HEADER?.trim() || process.env.XQUICK_AUTH_HEADER?.trim() || "x-api-key";
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    [headerName]: token,
  };
}

async function getXQuickApiConfig(): Promise<{ baseUrl: string; token: string } | null> {
  const account = await storage.getConnectedAccount("x");
  const baseUrl = getXQuickBaseUrl();
  const token = getXQuickToken(account?.accessToken ?? null);
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

async function getXQuickClientConfig(): Promise<{ baseUrl: string; token: string; account: string } | null> {
  const account = await storage.getConnectedAccount("x");
  const apiConfig = await getXQuickApiConfig();
  const xAccount = getXQuickAccount(account?.username ?? null);
  if (!apiConfig || !xAccount) return null;
  return { ...apiConfig, account: xAccount };
}

function extractXQuickPostId(data: XQuickPostResponse): string | null {
  const configured = getPathValue(data, process.env.XQUIK_POST_ID_PATH || process.env.XQUICK_POST_ID_PATH);
  const id =
    configured ??
    data.id ??
    data.tweetId ??
    data.postId ??
    data.data?.id ??
    data.data?.tweetId ??
    data.data?.postId ??
    data.result?.id ??
    data.result?.tweetId ??
    data.result?.postId;
  return id ? String(id) : null;
}

function extractXQuickUsername(data: XQuickPostResponse): string | null {
  const configured = getPathValue(data, process.env.XQUIK_USERNAME_PATH || process.env.XQUICK_USERNAME_PATH);
  const username =
    configured ??
    data.username ??
    data.data?.username ??
    data.result?.username ??
    data.user?.username ??
    data.data?.user?.username ??
    data.result?.user?.username;
  return username ? String(username).replace(/^@/, "") : null;
}

function buildXQuickPostPayload(
  account: string,
  text: string,
  lastId: string | undefined,
): Record<string, unknown> {
  const body: { account: string; text: string; reply_to_tweet_id?: string } = { account, text };
  if (lastId) body.reply_to_tweet_id = lastId;
  return body;
}

async function postViaXQuick(
  config: { baseUrl: string; token: string; account: string },
  payload: Record<string, unknown>,
): Promise<XQuickPostResponse> {
  const res = await fetch(joinUrl(config.baseUrl, getXQuickPostEndpoint()), {
    method: "POST",
    headers: buildXQuickHeaders(config.token),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(process.env.XQUIK_TIMEOUT_MS ?? process.env.XQUICK_TIMEOUT_MS ?? 30_000)),
  });
  const bodyText = await res.text();
  let body: any = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { message: bodyText };
    }
  }
  if (!res.ok) {
    throw new Error(body?.message || body?.error || bodyText || `xQuick API returned HTTP ${res.status}`);
  }
  if (res.status === 202 && body?.writeActionId && !body?.tweetId) {
    return pollXQuickWriteAction(config, String(body.writeActionId));
  }
  return body;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollXQuickWriteAction(
  config: { baseUrl: string; token: string },
  writeActionId: string,
): Promise<XQuickPostResponse> {
  const maxAttempts = Number(process.env.XQUIK_WRITE_POLL_ATTEMPTS ?? process.env.XQUICK_WRITE_POLL_ATTEMPTS ?? 6);
  const delayMs = Number(process.env.XQUIK_WRITE_POLL_DELAY_MS ?? process.env.XQUICK_WRITE_POLL_DELAY_MS ?? 2_000);
  const endpoint = getXQuickWriteActionEndpoint().replace("{id}", encodeURIComponent(writeActionId));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    const res = await fetch(joinUrl(config.baseUrl, endpoint), {
      headers: buildXQuickHeaders(config.token),
      signal: AbortSignal.timeout(Number(process.env.XQUIK_TIMEOUT_MS ?? process.env.XQUICK_TIMEOUT_MS ?? 30_000)),
    });
    const body = await res.json().catch(() => ({})) as XQuickPostResponse;
    if (!res.ok) {
      throw new Error(body?.message || body?.error || `xQuick write-action status returned HTTP ${res.status}`);
    }
    if (body.status === "success" && body.tweetId) return body;
    if (body.status === "failed") throw new Error(body.message || "xQuick write action failed.");
  }

  throw new Error(`xQuick write action ${writeActionId} is still pending. Check /x/write-actions/${writeActionId}.`);
}

/**
 * Load one post by ID via X API v2 (tweet lookup) — never use HTML scraping of x.com.
 * Returns null if no client configured or the post is unavailable / private.
 */
export async function fetchTweetTextByIdViaOfficialApi(tweetId: string): Promise<string | null> {
  const config = await getXQuickApiConfig();
  const endpoint = getXQuickReadEndpoint();
  if (!config || !endpoint) return null;
  try {
    const url = joinUrl(config.baseUrl, endpoint).replace("{id}", encodeURIComponent(tweetId));
    const res = await fetch(url, {
      headers: buildXQuickHeaders(config.token),
      signal: AbortSignal.timeout(Number(process.env.XQUIK_TIMEOUT_MS ?? process.env.XQUICK_TIMEOUT_MS ?? 30_000)),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return (
      getPathValue(data, process.env.XQUIK_TWEET_TEXT_PATH) ??
      getPathValue(data, process.env.XQUICK_TWEET_TEXT_PATH) ??
      data.text ??
      data.data?.text ??
      data.tweet?.text ??
      data.fullText ??
      null
    );
  } catch {
    return null;
  }
}

/** Post a thread or single tweet to X through xQuick. Tweet texts must be non-empty, ≤280 chars each. */
export async function postContentToX(texts: string[]): Promise<XPublishResult> {
  const config = await getXQuickClientConfig();
  if (!config) {
    throw new Error(
      "XQUICK_CONFIG_MISSING",
    );
  }

  // Step 1: clean input
  let tweets = texts.map((t) => t.trim()).filter(Boolean);
  if (tweets.length === 0) throw new Error("No tweet text to post.");

  // Step 2: apply thread numbering to content tweets (before finisher)
  tweets = addThreadNumbering(tweets);

  // Step 3: append finisher AFTER numbering so it has no number
  const finisher = process.env.X_THREAD_FINISHER?.trim();
  if (finisher && tweets.length > 1) {
    const safeFinisher = finisher.slice(0, 275);
    const lastTweet = tweets[tweets.length - 1].toLowerCase();
    const ctaPatterns = ["follow", "subscribe", "rt this", "retweet", "share this", "like and", "🔔", "hit follow"];
    const isAlreadyCTA = ctaPatterns.some((p) => lastTweet.includes(p));
    if (!isAlreadyCTA) {
      tweets.push(safeFinisher);
    }
  }

  // Step 4: resolve username from env/response to avoid extra API calls.
  let username: string | null = config.account;

  // Step 5: post each tweet in reply chain
  const tweetIds: string[] = [];
  let lastId: string | undefined;

  for (let index = 0; index < tweets.length; index++) {
    const payload = buildXQuickPostPayload(config.account, tweets[index].slice(0, 280), lastId);
    const sent = await postViaXQuick(config, payload);
    const id = extractXQuickPostId(sent);
    if (!id) throw new Error("XQUICK_POST_ID_MISSING");
    username = username || extractXQuickUsername(sent);
    tweetIds.push(id);
    lastId = id;
  }

  const handle = username || "i";
  const urls = tweetIds.map((id) => `https://x.com/${handle}/status/${id}`);
  return { tweetIds, urls, username };
}

export async function publishPostToX(post: Post & { tweets: Tweet[] }): Promise<XPublishResult> {
  const sorted = [...post.tweets].sort((a, b) => a.position - b.position);
  const texts = sorted.map((t) => t.content);
  const platform = post.targetPlatform || "both";
  if (platform === "threads") {
    throw new Error("This post is Threads-only; X publishing skipped.");
  }
  return postContentToX(texts);
}

/** Publish post to X and persist ids / posted status, or set failed + errorMessage. */
export async function tryPublishPostById(
  postId: number,
  options: { invokedBy?: XPublishInvoker } = {},
): Promise<XPublishResult> {
  const invokedBy = options.invokedBy ?? "user";
  const post = await storage.getPost(postId);
  if (!post) throw new Error("Post not found");

  assertEligibleForXPublish(
    { status: post.status, scheduledAt: post.scheduledAt },
    { invokedBy },
  );

  try {
    const result = await publishPostToX(post);
    await storage.updatePost(postId, {
      status: "posted",
      postedAt: new Date(),
      externalIds: { ...(post.externalIds ?? {}), x: result.tweetIds },
      externalUrls: { ...(post.externalUrls ?? {}), x: result.urls },
      errorMessage: null,
    });
    // Fire-and-forget analytics sync — don't block publish on it
    syncPostAnalyticsFromX(postId).catch((e) =>
      console.error(`[x analytics] sync failed post=${postId}:`, e)
    );
    return result;
  } catch (e: any) {
    const friendly = translateXError(e?.message || String(e));
    await storage.updatePost(postId, {
      status: "failed",
      errorMessage: friendly,
    });
    const err = new Error(friendly);
    throw err;
  }
}

/**
 * Fetch public metrics from xQuick if an analytics endpoint is configured.
 */
export async function syncPostAnalyticsFromX(postId: number): Promise<void> {
  const post = await storage.getPost(postId);
  if (!post) return;

  const tweetIds = (post.externalIds as any)?.x as string[] | undefined;
  if (!tweetIds || tweetIds.length === 0) return;

  const config = await getXQuickApiConfig();
  const endpoint = getXQuickAnalyticsEndpoint();
  if (!config || !endpoint) return;

  try {
    const start = Date.now();
    const res = await fetch(joinUrl(config.baseUrl, endpoint), {
      method: "POST",
      headers: buildXQuickHeaders(config.token),
      body: JSON.stringify({ ids: tweetIds }),
      signal: AbortSignal.timeout(Number(process.env.XQUIK_TIMEOUT_MS ?? process.env.XQUICK_TIMEOUT_MS ?? 30_000)),
    });
    if (!res.ok) throw new Error(`xQuick analytics returned HTTP ${res.status}`);
    const data = await res.json() as any;

    // Log provider read call for budget tracking (1 read per post ID fetched)
    await storage.createAiUsageLog({
      model: "xquick-api",
      feature: "x_analytics_sync",
      inputTokens: tweetIds.length,
      outputTokens: 0,
      totalTokens: tweetIds.length,
      latencyMs: Date.now() - start,
    }).catch(() => null); // non-critical

    // Aggregate metrics across all tweets in the thread
    const rows = data.data ?? data.posts ?? data.tweets ?? [];
    const totals = rows.reduce(
      (acc: { impressions: number; likes: number; retweets: number; replies: number; quotes: number; bookmarks: number; views: number }, t: any) => {
        const m = t.public_metrics ?? t.metrics ?? t;
        if (!m) return acc;
        acc.impressions += m.impression_count ?? 0;
        acc.likes += m.like_count ?? 0;
        acc.retweets += m.retweet_count ?? 0;
        acc.replies += m.reply_count ?? 0;
        acc.quotes += m.quote_count ?? 0;
        acc.bookmarks += m.bookmark_count ?? 0;
        acc.views += m.impression_count ?? 0;
        return acc;
      },
      { impressions: 0, likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0, views: 0 },
    );

    await storage.upsertAnalytics(postId, "x", totals);
  } catch (e) {
    console.error(`[x analytics] fetch failed post=${postId}:`, e);
  }
}

/**
 * Refresh analytics for all X-posted posts in the last N days.
 * Called by the daily analytics cron. Adapted from postiz-app analytics() flow.
 */
export async function refreshXAnalytics(days = 30): Promise<void> {
  const all = await storage.getPosts();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const targets = all.filter(
    (p) =>
      p.status === "posted" &&
      (p.externalIds as any)?.x?.length > 0 &&
      p.postedAt &&
      new Date(p.postedAt).getTime() > cutoff,
  );

  for (const p of targets) {
    await syncPostAnalyticsFromX(p.id).catch(() => null);
  }
  console.log(`[x analytics] refreshed ${targets.length} posts`);
}

/**
 * Current public X API docs expose post/thread publishing via /2/tweets.
 * Keep article publishing gated until a stable public API contract is available.
 */
export async function getXArticlePublishCapability(): Promise<XArticlePublishCapability> {
  const status = await getXPostingConfigSummary();
  if (!status.canAttemptPost) {
    return {
      canPublish: false,
      reason: "xQuick account/token not connected for publishing.",
      docsUrl: "https://docs.x.com/x-api/posts/create-post",
    };
  }
  return {
    canPublish: false,
    reason: "Article publishing is not configured in the xQuick adapter yet.",
    docsUrl: "https://docs.x.com/x-api/posts/create-post",
  };
}
