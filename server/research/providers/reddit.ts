/**
 * Reddit provider — public JSON endpoints only.
 *
 * Access class `open`: no OAuth, no browser cookies, no authenticated or private
 * content. Reddit's rate limits surface as *transient* failures so the engine's
 * existing retry policy applies; nothing Reddit-specific leaks past this file.
 */

import { z } from "zod";
import { JobFailure, describeError } from "../../jobs/failures";
import type {
  AccessClass,
  DiscoverContext,
  NormalizedSource,
  ProviderBackend,
  ProviderDefinition,
  ResearchQuery,
  SearchContext,
} from "../contracts";
import { buildExcerpt, canonicalizeUrl, computeSourceHash, normalizeText } from "../normalize";
import { createSafeFetchDeps, type ProviderHttpDeps } from "./http";
import { envList, providerUrls } from "./providerUrls";

export const REDDIT_PROVIDER_ID = "reddit";
export const REDDIT_PROVIDER_VERSION = "1.0.0";

export const redditProviderConfigSchema = z.object({
  subreddits: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  defaultLimit: z.number().int().positive().max(100).default(20),
  /** hot | new | top */
  listing: z.enum(["hot", "new", "top"]).default("hot"),
});

export type RedditProviderConfig = z.infer<typeof redditProviderConfigSchema>;

interface RedditPost {
  name?: string;
  id?: string;
  title?: string;
  permalink?: string;
  url?: string;
  selftext?: string;
  author?: string;
  created_utc?: number;
  subreddit?: string;
  score?: number;
  num_comments?: number;
  over_18?: boolean;
}

interface RedditListing {
  data?: { children?: Array<{ data?: RedditPost }> };
}

/**
 * Credentialed seam.
 *
 * When the deployment supplies an access token, the provider reads the OAuth host
 * with a bearer header and reports itself as `credentialed`. It deliberately does
 * NOT perform the OAuth dance: no client secret is handled, stored or rotated by
 * the app, and there is no second credential store. Obtaining and rotating the
 * token is the deployment's job — the provider only consumes it.
 */
export interface RedditCredentials {
  accessToken: string;
  oauthBaseUrl: string;
}

export interface RedditProviderDeps {
  http: ProviderHttpDeps;
  baseUrl: string;
  credentials?: RedditCredentials | null;
  loadConfig?: (ctx: { userId?: number | null }) => Promise<RedditProviderConfig>;
}

export function resolveRedditCredentials(env: NodeJS.ProcessEnv = process.env): RedditCredentials | null {
  const accessToken = env.REDDIT_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;
  const oauthBaseUrl = (env.REDDIT_OAUTH_BASE_URL?.trim() || "https://oauth.reddit.com").replace(/\/+$/, "");
  return { accessToken, oauthBaseUrl };
}

export function createRedditDeps(): RedditProviderDeps {
  return {
    http: createSafeFetchDeps(),
    baseUrl: providerUrls().reddit,
    credentials: resolveRedditCredentials(),
  };
}

function readConfig(ctx: { config: Readonly<Record<string, unknown>> }): RedditProviderConfig {
  return redditProviderConfigSchema.parse(ctx.config ?? {});
}

/** Pure normalization: a Reddit post → NormalizedSource (no network). */
export function normalizeRedditPost(
  post: RedditPost,
  baseUrl: string,
  accessClass: AccessClass = "open",
): NormalizedSource | null {
  const title = post.title?.trim();
  if (!title) return null;
  if (post.over_18) return null; // never ingest adult content

  const permalink = post.permalink ? canonicalizeUrl(`${baseUrl}${post.permalink}`) : null;
  const canonicalUrl = permalink ?? (post.url ? canonicalizeUrl(post.url) : null);
  if (!canonicalUrl) return null;

  const nativeId = post.name ?? (post.id ? `t3_${post.id}` : computeSourceHash(canonicalUrl).slice(0, 24));
  const body = normalizeText(post.selftext && post.selftext.length > 0 ? post.selftext : title);

  return {
    ref: { provider: REDDIT_PROVIDER_ID, kind: "post", nativeId, canonicalUrl },
    provider: REDDIT_PROVIDER_ID,
    backend: "reddit-json",
    providerVersion: REDDIT_PROVIDER_VERSION,
    retrievalMethod: "api",
    accessClass,
    canonicalUrl,
    title,
    author: post.author ? { name: post.author } : null,
    publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
    retrievedAt: new Date().toISOString(),
    excerpt: buildExcerpt(body),
    contentHash: computeSourceHash(canonicalUrl, body),
    metadata: {
      subreddit: post.subreddit ?? null,
      score: post.score ?? null,
      comments: post.num_comments ?? null,
      externalUrl: post.url ?? null,
    },
  };
}

function classifyRedditError(error: unknown): JobFailure {
  const message = describeError(error);
  // Reddit throttles aggressively; a 429 is a reschedule, never a job failure.
  if (/429|rate.?limit|too many requests/i.test(message)) {
    return JobFailure.rateLimited(`reddit rate limited: ${message}`);
  }
  if (/timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b/i.test(message)) {
    return JobFailure.transient(`reddit request failed: ${message}`);
  }
  return JobFailure.transient(`reddit request failed: ${message}`);
}

export function createRedditProvider(overrides: Partial<RedditProviderDeps> = {}): ProviderDefinition {
  const deps: RedditProviderDeps = { ...createRedditDeps(), ...overrides };

  async function listing(
    path: string,
    limit: number,
    deadlineMs: number,
  ): Promise<NormalizedSource[]> {
    const credentials = deps.credentials ?? null;
    const origin = credentials ? credentials.oauthBaseUrl : deps.baseUrl;
    const url = `${origin}${path}${path.includes("?") ? "&" : "?"}limit=${limit}&raw_json=1`;
    let response: { status: number; body: string };
    try {
      response = await deps.http.fetchText({
        url,
        timeoutMs: deadlineMs,
        maxBytes: 2 * 1024 * 1024,
        headers: {
          "user-agent": "ContentForge-Research/1.0",
          ...(credentials ? { authorization: `Bearer ${credentials.accessToken}` } : {}),
        },
      });
    } catch (error) {
      throw classifyRedditError(error);
    }
    if (response.status === 429) throw JobFailure.rateLimited("reddit returned 429");
    if (response.status >= 500) throw JobFailure.transient(`reddit returned ${response.status}`);
    if (response.status >= 400) throw JobFailure.permanent(`reddit returned ${response.status}`);

    let parsed: RedditListing;
    try {
      parsed = JSON.parse(response.body) as RedditListing;
    } catch {
      throw JobFailure.transient("reddit returned unparseable JSON");
    }

    const children = parsed.data?.children ?? [];
    const out: NormalizedSource[] = [];
    for (const child of children) {
      const source = child.data ? normalizeRedditPost(child.data, deps.baseUrl, accessClass) : null;
      if (source) out.push(source);
      if (out.length >= limit) break;
    }
    return out;
  }

  const credentials = deps.credentials ?? null;
  const accessClass: AccessClass = credentials ? "credentialed" : "open";

  const backend: ProviderBackend = {
    id: credentials ? "reddit-oauth" : "reddit-json",
    capabilities: ["discover", "search"],
    sourceCapabilities: ["time-window", "structured-metadata"],

    async discover(ctx: DiscoverContext): Promise<NormalizedSource[]> {
      const config = readConfig(ctx);
      const limit = ctx.limit ?? config.defaultLimit;
      if (config.subreddits.length === 0) return [];

      const remainingMs = Math.max(1, ctx.deadline.getTime() - Date.now());
      const collected: NormalizedSource[] = [];
      const failures: string[] = [];

      for (const subreddit of config.subreddits) {
        if (collected.length >= limit) break;
        try {
          // Per-subreddit failures are non-fatal: a partial result is valid research.
          const found = await listing(
            `/r/${encodeURIComponent(subreddit)}/${config.listing}.json`,
            limit - collected.length,
            remainingMs,
          );
          collected.push(...found);
        } catch (error) {
          failures.push(`${subreddit}: ${describeError(error)}`);
        }
      }

      if (collected.length === 0 && failures.length > 0) {
        throw classifyRedditError(new Error(failures[0]));
      }
      return collected.slice(0, limit);
    },

    async search(ctx: SearchContext, query: ResearchQuery): Promise<NormalizedSource[]> {
      const config = readConfig(ctx);
      const limit = ctx.limit ?? config.defaultLimit;
      const text = query.text?.trim();
      if (!text) return [];

      const remainingMs = Math.max(1, ctx.deadline.getTime() - Date.now());
      const scope = config.subreddits.length > 0 ? `&restrict_sr=1` : "";
      const path =
        config.subreddits.length === 1
          ? `/r/${encodeURIComponent(config.subreddits[0])}/search.json?q=${encodeURIComponent(text)}&sort=relevance${scope}`
          : `/search.json?q=${encodeURIComponent(text)}&sort=relevance`;
      return listing(path, limit, remainingMs);
    },

    async probe() {
      return {
        state: "healthy" as const,
        capabilities: {
          discover: { state: "healthy" as const },
          search: { state: "healthy" as const },
        },
      };
    },
  };

  return {
    id: REDDIT_PROVIDER_ID,
    contractVersion: "1",
    version: REDDIT_PROVIDER_VERSION,
    accessClass,
    description: credentials
      ? "Reddit OAuth listings/search via an operator-supplied bearer token (no cookies)"
      : "Reddit public JSON listings and search (no auth, no cookies)",
    backends: [backend],
    configSchema: redditProviderConfigSchema,
    ...(deps.loadConfig
      ? { resolveConfig: (ctx: { userId?: number | null }) => deps.loadConfig!(ctx) }
      : {}),
  };
}

/** Config from environment (durable, explicit). Empty by default: no silent fetches. */
export async function loadRedditProviderConfig(): Promise<RedditProviderConfig> {
  return redditProviderConfigSchema.parse({
    subreddits: envList(process.env.REDDIT_SUBREDDITS),
    defaultLimit: Number(process.env.REDDIT_DEFAULT_LIMIT ?? 20),
  });
}

export const redditProvider = createRedditProvider();
