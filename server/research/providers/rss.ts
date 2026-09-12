/**
 * RSS provider — the first real SourceProvider.
 *
 * Chosen because it is the simplest existing ContentForge source that needs no
 * browser session and no special network reach: it validates the whole provider
 * seam (capabilities, normalization, provenance, SSRF-safe Stage-2 fetch)
 * without carrying cookie or SSRF risk of its own.
 *
 * Network access is injected so tests exercise the full provider without
 * relaxing the SSRF guard in production.
 */

import Parser from "rss-parser";
import { z } from "zod";
import { JobFailure } from "../../jobs/failures";
import type {
  DiscoverContext,
  FetchContext,
  NormalizedSource,
  ProviderBackend,
  ProviderDefinition,
  ResearchQuery,
  SearchContext,
  SourceRef,
} from "../contracts";
import { extractReadableText } from "../extract";
import {
  buildExcerpt,
  canonicalizeUrl,
  computeSourceHash,
  normalizeText,
  toIsoOrNull,
} from "../normalize";
import { UnsafeUrlError, safeFetch, validateUrlSyntax } from "../../security/ssrf";

export const RSS_PROVIDER_ID = "rss";
export const RSS_PROVIDER_VERSION = "1.0.0";

export const rssProviderConfigSchema = z.object({
  feeds: z
    .array(
      z.object({
        name: z.string().optional(),
        url: z.string().url(),
        category: z.string().optional(),
      }),
    )
    .default([]),
  defaultLimit: z.number().int().positive().max(100).default(20),
});

export type RssProviderConfig = z.infer<typeof rssProviderConfigSchema>;

interface ParsedFeedItem {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  creator?: string;
  author?: string;
}

interface ParsedFeed {
  title?: string;
  items?: ParsedFeedItem[];
}

export interface RssProviderDeps {
  parseFeed: (url: string) => Promise<ParsedFeed>;
  fetchArticle: (url: string, options: { timeoutMs: number }) => Promise<{
    status: number;
    body: string;
    headers: Record<string, string | string[] | undefined>;
    finalUrl: string;
    truncated: boolean;
  }>;
  /** Resolve feeds from the existing rss_sources configuration. */
  loadConfig?: (ctx: { userId?: number | null }) => Promise<RssProviderConfig>;
}

export function createRssDeps(): RssProviderDeps {
  const parser = new Parser({
    timeout: 10_000,
    headers: { "user-agent": "ContentForge-Research/1.0" },
  });
  return {
    parseFeed: (url) => parser.parseURL(url) as Promise<ParsedFeed>,
    fetchArticle: (url, options) => safeFetch(url, { timeoutMs: options.timeoutMs }),
  };
}

function readConfig(ctx: { config: Readonly<Record<string, unknown>> }): RssProviderConfig {
  return rssProviderConfigSchema.parse(ctx.config ?? {});
}

function itemNativeId(guid: string | undefined, link: string | undefined, title?: string): string {
  if (guid) return guid;
  if (link) return canonicalizeUrl(link);
  return computeSourceHash(title ?? "untitled");
}

/** Match a query against feed item text. RSS has no server-side search, so
 *  `search` is `discover` + a local relevance filter. */
function filterByQuery(sources: NormalizedSource[], query: string): NormalizedSource[] {
  const tokens = normalizeText(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 2);
  if (tokens.length === 0) return sources;

  return sources.filter((source) => {
    const haystack = `${source.title ?? ""} ${source.excerpt ?? ""} ${source.content?.text ?? ""}`.toLowerCase();
    return tokens.some((token) => haystack.includes(token));
  });
}

export function createRssProvider(overrides: Partial<RssProviderDeps> = {}): ProviderDefinition {
  const deps: RssProviderDeps = { ...createRssDeps(), ...overrides };
  const backend: ProviderBackend = {
    id: "rss-parser",
    capabilities: ["discover", "search", "fetch"],
    sourceCapabilities: ["time-window", "structured-metadata"],

    async discover(ctx: DiscoverContext): Promise<NormalizedSource[]> {
      const config = readConfig(ctx);
      const limit = ctx.limit ?? config.defaultLimit;
      if (config.feeds.length === 0) return [];

      const retrievedAt = new Date().toISOString();
      const collected: NormalizedSource[] = [];
      const failures: string[] = [];

      // Per-feed failures are non-fatal: a partial result is valid research
      // (Ticket 04 §2). Failures surface as a thrown error only when nothing
      // succeeded — never as synthetic sources, which would fabricate candidates.
      for (const feed of config.feeds) {
        if (collected.length >= limit) break;

        try {
          // Feed URLs are operator-configured, but they are still outbound
          // requests: refuse anything pointing at non-routable space.
          validateUrlSyntax(feed.url);

          const parsed = await deps.parseFeed(feed.url);
          const remaining = Math.max(1, limit - collected.length);

          for (const item of (parsed.items ?? []).slice(0, remaining)) {
            const link = item.link;
            if (!link) continue;
            const canonicalUrl = canonicalizeUrl(link);
            const snippet = item.contentSnippet ?? item.content ?? "";
            const body = normalizeText(snippet);

            if (ctx.window?.from) {
              const published = toIsoOrNull(item.isoDate ?? item.pubDate);
              if (published && new Date(published).getTime() < new Date(ctx.window.from).getTime()) {
                continue;
              }
            }

            const title = item.title?.trim() ?? null;
            const creator = item.creator ?? item.author;

            collected.push({
              ref: {
                provider: RSS_PROVIDER_ID,
                kind: "article",
                nativeId: itemNativeId(item.guid, link, title ?? undefined),
                canonicalUrl,
              },
              provider: RSS_PROVIDER_ID,
              backend: backend.id,
              providerVersion: RSS_PROVIDER_VERSION,
              retrievalMethod: "feed",
              accessClass: "open",
              canonicalUrl,
              title,
              author: creator ? { name: creator } : null,
              publishedAt: toIsoOrNull(item.isoDate ?? item.pubDate),
              retrievedAt,
              excerpt: body ? buildExcerpt(body) : undefined,
              contentHash: computeSourceHash(canonicalUrl, body),
              metadata: {
                feedName: feed.name ?? parsed.title ?? null,
                feedUrl: feed.url,
                category: feed.category ?? null,
              },
            });
          }
        } catch (error) {
          failures.push(`${feed.url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (collected.length === 0 && failures.length > 0) {
        throw JobFailure.transient(
          `All ${failures.length} RSS feed(s) failed. First: ${failures[0]}`,
        );
      }

      return collected.slice(0, limit);
    },

    async search(ctx: SearchContext, query: ResearchQuery): Promise<NormalizedSource[]> {
      const discovered = await this.discover!(ctx);
      return filterByQuery(discovered, query.text);
    },

    async fetch(ctx: FetchContext, ref: SourceRef): Promise<NormalizedSource> {
      const retrievedAt = new Date().toISOString();
      const remainingMs = Math.max(1, ctx.deadline.getTime() - Date.now());

      let response;
      try {
        response = await deps.fetchArticle(ref.canonicalUrl, { timeoutMs: remainingMs });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof UnsafeUrlError) {
          throw JobFailure.permanent(`Blocked by SSRF policy: ${message}`);
        }
        throw JobFailure.transient(`Could not fetch article: ${message}`);
      }

      if (response.status >= 400 && response.status < 500) {
        throw JobFailure.permanent(`Article returned HTTP ${response.status}`);
      }
      if (response.status >= 500) {
        throw JobFailure.transient(`Article returned HTTP ${response.status}`);
      }

      const extracted = extractReadableText(response.body);
      if (extracted.text.length === 0) {
        throw JobFailure.permanent("Article contained no readable text");
      }

      return {
        ref,
        provider: RSS_PROVIDER_ID,
        backend: backend.id,
        providerVersion: RSS_PROVIDER_VERSION,
        retrievalMethod: "http",
        accessClass: "open",
        canonicalUrl: ref.canonicalUrl,
        title: extracted.title ?? ref.nativeId,
        author: extracted.author ? { name: extracted.author } : null,
        publishedAt: null,
        retrievedAt,
        excerpt: buildExcerpt(extracted.description ?? extracted.text),
        content: {
          text: extracted.text,
          mime: "text/plain",
          length: extracted.text.length,
          truncated: response.truncated,
        },
        contentHash: computeSourceHash(ref.canonicalUrl, extracted.text),
        metadata: {
          finalUrl: response.finalUrl,
          contentType: response.headers["content-type"] ?? null,
        },
        ...(response.truncated ? { warnings: ["response truncated at byte ceiling"] } : {}),
      };
    },

    async probe() {
      return {
        state: "healthy" as const,
        capabilities: {
          discover: { state: "healthy" as const },
          fetch: { state: "healthy" as const },
        },
      };
    },
  };

  return {
    id: RSS_PROVIDER_ID,
    contractVersion: "1",
    version: RSS_PROVIDER_VERSION,
    accessClass: "open",
    description: "RSS/Atom feed discovery plus SSRF-guarded article fetch",
    backends: [backend],
    configSchema: rssProviderConfigSchema,
    ...(deps.loadConfig
      ? { resolveConfig: (ctx: { userId?: number | null }) => deps.loadConfig!(ctx) }
      : {}),
  };
}

/** Default instance used by the application. */
export const rssProvider = createRssProvider();
