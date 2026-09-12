/**
 * YouTube provider — public channel feeds only (metadata).
 *
 * Access class `open`: no API key, no quota account, no browser cookies. It reads
 * the public Atom feed each channel exposes, so it is **metadata-only** — there is
 * deliberately no transcript capability here (`fetch` is not declared), because
 * transcripts are not available on this path without a credentialed integration.
 *
 * A future credentialed YouTube Data API backend can be added as another backend
 * on this provider; nothing else has to change.
 */

import Parser from "rss-parser";
import { z } from "zod";
import { JobFailure, describeError } from "../../jobs/failures";
import type {
  DiscoverContext,
  NormalizedSource,
  ProviderBackend,
  ProviderDefinition,
} from "../contracts";
import { buildExcerpt, canonicalizeUrl, computeSourceHash, normalizeText, toIsoOrNull } from "../normalize";
import { createSafeFetchDeps, type ProviderHttpDeps } from "./http";
import { envList, providerUrls } from "./providerUrls";

export const YOUTUBE_PROVIDER_ID = "youtube";
export const YOUTUBE_PROVIDER_VERSION = "1.0.0";

export const youtubeProviderConfigSchema = z.object({
  channelIds: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  defaultLimit: z.number().int().positive().max(100).default(20),
});

export type YoutubeProviderConfig = z.infer<typeof youtubeProviderConfigSchema>;

interface FeedItem {
  title?: string;
  link?: string;
  id?: string;
  isoDate?: string;
  pubDate?: string;
  author?: string;
  creator?: string;
}
interface ParsedFeed {
  title?: string;
  items?: FeedItem[];
}

export interface YoutubeProviderDeps {
  parseFeed: (url: string) => Promise<ParsedFeed>;
  http: ProviderHttpDeps;
  baseUrl: string;
  loadConfig?: (ctx: { userId?: number | null }) => Promise<YoutubeProviderConfig>;
}

export function createYoutubeDeps(): YoutubeProviderDeps {
  const parser = new Parser({
    timeout: 10_000,
    headers: { "user-agent": "ContentForge-Research/1.0" },
  });
  return {
    parseFeed: (url) => parser.parseURL(url) as Promise<ParsedFeed>,
    http: createSafeFetchDeps(),
    baseUrl: providerUrls().youtube,
  };
}

function readConfig(ctx: { config: Readonly<Record<string, unknown>> }): YoutubeProviderConfig {
  return youtubeProviderConfigSchema.parse(ctx.config ?? {});
}

/** youtube video id from an Atom entry id (`yt:video:<id>`) or its link. */
export function youtubeVideoId(item: FeedItem): string | null {
  const fromId = item.id?.match(/yt:video:([\w-]+)/)?.[1];
  if (fromId) return fromId;
  const fromLink = item.link?.match(/[?&]v=([\w-]+)/)?.[1];
  return fromLink ?? null;
}

export function normalizeYoutubeItem(item: FeedItem, channelId: string): NormalizedSource | null {
  const title = item.title?.trim();
  const videoId = youtubeVideoId(item);
  if (!title || !videoId) return null;

  const canonicalUrl = canonicalizeUrl(`https://www.youtube.com/watch?v=${videoId}`);
  const body = normalizeText(title);

  return {
    ref: { provider: YOUTUBE_PROVIDER_ID, kind: "video", nativeId: videoId, canonicalUrl },
    provider: YOUTUBE_PROVIDER_ID,
    backend: "youtube-feed",
    providerVersion: YOUTUBE_PROVIDER_VERSION,
    retrievalMethod: "feed",
    accessClass: "open",
    canonicalUrl,
    title,
    author: item.author || item.creator ? { name: (item.author ?? item.creator) as string } : null,
    publishedAt: toIsoOrNull(item.isoDate ?? item.pubDate),
    retrievedAt: new Date().toISOString(),
    excerpt: buildExcerpt(body),
    contentHash: computeSourceHash(canonicalUrl, body),
    // Metadata-only: no transcript is fetched on this path (see the file header).
    metadata: { channelId, transcriptAvailable: false, videoId },
  };
}

export function createYoutubeProvider(overrides: Partial<YoutubeProviderDeps> = {}): ProviderDefinition {
  const deps: YoutubeProviderDeps = { ...createYoutubeDeps(), ...overrides };

  const backend: ProviderBackend = {
    id: "youtube-feed",
    capabilities: ["discover"],
    sourceCapabilities: ["time-window", "structured-metadata"],

    async discover(ctx: DiscoverContext): Promise<NormalizedSource[]> {
      const config = readConfig(ctx);
      const limit = ctx.limit ?? config.defaultLimit;
      if (config.channelIds.length === 0) return [];

      const collected: NormalizedSource[] = [];
      const failures: string[] = [];

      for (const channelId of config.channelIds) {
        if (collected.length >= limit) break;
        try {
          const parsed = await deps.parseFeed(
            `${deps.baseUrl}/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
          );
          for (const item of parsed.items ?? []) {
            if (collected.length >= limit) break;
            const source = normalizeYoutubeItem(item, channelId);
            if (source) collected.push(source);
          }
        } catch (error) {
          failures.push(`${channelId}: ${describeError(error)}`);
        }
      }

      // Per-channel failures are non-fatal; only a total miss fails the call.
      if (collected.length === 0 && failures.length > 0) {
        throw JobFailure.transient(`All ${failures.length} YouTube channel feed(s) failed. First: ${failures[0]}`);
      }
      return collected;
    },

    async probe() {
      return {
        state: "healthy" as const,
        capabilities: { discover: { state: "healthy" as const } },
      };
    },
  };

  return {
    id: YOUTUBE_PROVIDER_ID,
    contractVersion: "1",
    version: YOUTUBE_PROVIDER_VERSION,
    accessClass: "open",
    description: "YouTube public channel feeds (video metadata only; no transcript path)",
    backends: [backend],
    configSchema: youtubeProviderConfigSchema,
    ...(deps.loadConfig
      ? { resolveConfig: (ctx: { userId?: number | null }) => deps.loadConfig!(ctx) }
      : {}),
  };
}

export async function loadYoutubeProviderConfig(): Promise<YoutubeProviderConfig> {
  return youtubeProviderConfigSchema.parse({
    channelIds: envList(process.env.YOUTUBE_CHANNEL_IDS),
    defaultLimit: Number(process.env.YOUTUBE_DEFAULT_LIMIT ?? 20),
  });
}

export const youtubeProvider = createYoutubeProvider();
