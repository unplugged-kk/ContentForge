import { TwitterApi, type TwitterApiReadWrite } from "twitter-api-v2";
import type { Post, Tweet } from "@shared/schema";
import { assertEligibleForXPublish, type XPublishInvoker } from "@shared/xDeveloperRisk";
import { storage } from "../storage";

/** Non-secret wiring status for Settings / debugging */
export async function getXPostingConfigSummary(): Promise<{
  hasOAuth1UserContext: boolean;
  hasOAuth2UserToken: boolean;
  hasConnectedAccountToken: boolean;
  hasOAuth2AppKeysOnly: boolean;
  canAttemptPost: boolean;
}> {
  const ak =
    process.env.X_API_KEY ||
    process.env.TWITTER_API_KEY ||
    process.env.X_CONSUMER_KEY;
  const as =
    process.env.X_API_SECRET ||
    process.env.TWITTER_API_SECRET ||
    process.env.TWITTER_API_KEY_SECRET ||
    process.env.X_CONSUMER_SECRET;
  const at = process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN;
  const asec = process.env.X_ACCESS_TOKEN_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET;
  const oauth2User =
    process.env.X_OAUTH2_ACCESS_TOKEN ||
    process.env.X_USER_ACCESS_TOKEN ||
    process.env.TWITTER_ACCESS_TOKEN_OAUTH2;
  const hasOAuth1UserContext = !!(ak && as && at && asec);
  const hasOAuth2UserToken = !!oauth2User;
  const hasOAuth2AppKeysOnly = !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET && !hasOAuth1UserContext && !hasOAuth2UserToken);
  const acc = await storage.getConnectedAccount("x");

  return {
    hasOAuth1UserContext,
    hasOAuth2UserToken,
    hasConnectedAccountToken: !!acc?.accessToken,
    hasOAuth2AppKeysOnly,
    canAttemptPost: hasOAuth1UserContext || hasOAuth2UserToken || !!acc?.accessToken,
  };
}

export type XPublishResult = {
  tweetIds: string[];
  urls: string[];
  username: string | null;
};

function createRwClient(): TwitterApiReadWrite | null {
  const appKey =
    process.env.X_API_KEY ||
    process.env.TWITTER_API_KEY ||
    process.env.X_CONSUMER_KEY;
  const appSecret =
    process.env.X_API_SECRET ||
    process.env.TWITTER_API_SECRET ||
    process.env.TWITTER_API_KEY_SECRET ||
    process.env.X_CONSUMER_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret =
    process.env.X_ACCESS_TOKEN_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET;
  if (appKey && appSecret && accessToken && accessSecret) {
    return new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    }).readWrite;
  }
  const oauth2User =
    process.env.X_OAUTH2_ACCESS_TOKEN ||
    process.env.X_USER_ACCESS_TOKEN ||
    process.env.TWITTER_ACCESS_TOKEN_OAUTH2;
  if (oauth2User) {
    return new TwitterApi(oauth2User).readWrite;
  }
  return null;
}

async function createRwClientFromDb(): Promise<TwitterApiReadWrite | null> {
  const fromEnv = createRwClient();
  if (fromEnv) return fromEnv;
  const account = await storage.getConnectedAccount("x");
  if (account?.accessToken) {
    return new TwitterApi(account.accessToken).readWrite;
  }
  return null;
}

/**
 * Load one post by ID via X API v2 (tweet lookup) — never use HTML scraping of x.com.
 * Returns null if no client configured or the post is unavailable / private.
 */
export async function fetchTweetTextByIdViaOfficialApi(tweetId: string): Promise<string | null> {
  const rw = await createRwClientFromDb();
  if (!rw) return null;
  try {
    const res = await rw.v2.singleTweet(tweetId, {
      "tweet.fields": ["note_tweet", "text"],
    });
    const t = res.data;
    if (!t) return null;
    const note = (t as { note_tweet?: { text?: string } }).note_tweet?.text;
    return (note && note.trim()) || t.text || null;
  } catch {
    return null;
  }
}

/** Post a thread or single tweet to X. Tweet texts must be non-empty, ≤280 chars each. */
export async function postContentToX(texts: string[]): Promise<XPublishResult> {
  const rw = await createRwClientFromDb();
  if (!rw) {
    throw new Error(
      "X credentials missing: set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (OAuth 1.0a) or X_OAUTH2_ACCESS_TOKEN / X_USER_ACCESS_TOKEN, or connect X in Settings.",
    );
  }
  const trimmed = texts.map((t) => t.trim()).filter(Boolean);
  if (trimmed.length === 0) throw new Error("No tweet text to post.");

  let username: string | null = process.env.X_USERNAME || null;
  try {
    const me = await rw.v2.me();
    username = me.data.username ?? username;
  } catch {
    /* optional */
  }

  const tweetIds: string[] = [];
  let lastId: string | undefined;

  for (const text of trimmed) {
    const body: { text: string; reply?: { in_reply_to_tweet_id: string } } = {
      text: text.slice(0, 280),
    };
    if (lastId) body.reply = { in_reply_to_tweet_id: lastId };
    const sent = await rw.v2.tweet(body);
    const id = sent.data?.id;
    if (!id) throw new Error("X API returned no tweet id.");
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
    return result;
  } catch (e: any) {
    await storage.updatePost(postId, {
      status: "failed",
      errorMessage: e?.message || String(e),
    });
    throw e;
  }
}
