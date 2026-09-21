/**
 * Hacker News provider — the trend / current-events research input.
 *
 * Access class `open`: the public Algolia HN Search API, no key. A "trend" is not
 * a new domain entity here: it is simply a normalized source (kind `story`) that
 * the existing ResearchEngine turns into durable research like any other input.
 *
 * `discover` reads the current front page (what is hot right now); `search`
 * answers a directed query. Both are the same provider.
 */

import { z } from "zod";
import { JobFailure, describeError } from "../../jobs/failures";
import type {
  DiscoverContext,
  NormalizedSource,
  ProviderBackend,
  ProviderDefinition,
  ResearchQuery,
  SearchContext,
} from "../contracts";
import { buildExcerpt, canonicalizeUrl, computeSourceHash, normalizeText, toIsoOrNull } from "../normalize";
import { createSafeFetchDeps, type ProviderHttpDeps } from "./http";
import { providerUrls } from "./providerUrls";

export const HN_PROVIDER_ID = "hn";
export const HN_PROVIDER_VERSION = "1.0.0";

export const hnProviderConfigSchema = z.object({
  /** discover seeds; empty → the front page. */
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default(["front_page"]),
  defaultLimit: z.number().int().positive().max(100).default(20),
  minPoints: z.number().int().min(0).max(100_000).default(0),
});

export type HnProviderConfig = z.infer<typeof hnProviderConfigSchema>;

export interface HnHit {
  objectID?: string;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  author?: string | null;
  created_at?: string | null;
  points?: number | null;
  num_comments?: number | null;
  story_text?: string | null;
}

interface HnResponse {
  hits?: HnHit[];
}

export interface HnProviderDeps {
  http: ProviderHttpDeps;
  baseUrl: string;
  loadConfig?: (ctx: { userId?: number | null }) => Promise<HnProviderConfig>;
}

export function createHnDeps(): HnProviderDeps {
  return { http: createSafeFetchDeps(), baseUrl: providerUrls().hackerNews };
}

function readConfig(ctx: { config: Readonly<Record<string, unknown>> }): HnProviderConfig {
  return hnProviderConfigSchema.parse(ctx.config ?? {});
}

/** Pure normalization: an HN hit → NormalizedSource (no network). */
export function normalizeHnHit(hit: HnHit, baseUrl: string): NormalizedSource | null {
  const objectId = hit.objectID?.trim();
  const title = (hit.title ?? hit.story_title ?? "").trim();
  if (!objectId || !title) return null;

  const externalUrl = (hit.url ?? hit.story_url ?? "").trim();
  const hnUrl = canonicalizeUrl(`${baseUrl.replace(/\/api\/v1.*$/, "")}/item?id=${objectId}`);
  const canonicalUrl = externalUrl ? canonicalizeUrl(externalUrl) : hnUrl;
  const body = normalizeText(hit.story_text && hit.story_text.length > 0 ? hit.story_text : title);

  return {
    ref: { provider: HN_PROVIDER_ID, kind: "story", nativeId: objectId, canonicalUrl },
    provider: HN_PROVIDER_ID,
    backend: "hn-algolia",
    providerVersion: HN_PROVIDER_VERSION,
    retrievalMethod: "api",
    accessClass: "open",
    canonicalUrl,
    title,
    author: hit.author ? { name: hit.author } : null,
    publishedAt: toIsoOrNull(hit.created_at),
    retrievedAt: new Date().toISOString(),
    excerpt: buildExcerpt(body),
    contentHash: computeSourceHash(canonicalUrl, body),
    metadata: {
      points: hit.points ?? null,
      comments: hit.num_comments ?? null,
      discussionUrl: hnUrl,
      externalUrl: externalUrl || null,
    },
  };
}

function classifyHnError(error: unknown): JobFailure {
  const message = describeError(error);
  if (/429|rate.?limit/i.test(message)) return JobFailure.rateLimited(`hn rate limited: ${message}`);
  return JobFailure.transient(`hn request failed: ${message}`);
}

export function createHnProvider(overrides: Partial<HnProviderDeps> = {}): ProviderDefinition {
  const deps: HnProviderDeps = { ...createHnDeps(), ...overrides };

  async function query(params: string, limit: number, deadlineMs: number): Promise<NormalizedSource[]> {
    const url = `${deps.baseUrl}/api/v1/search?${params}&hitsPerPage=${limit}`;
    let response: { status: number; body: string };
    try {
      response = await deps.http.fetchText({ url, timeoutMs: deadlineMs, maxBytes: 2 * 1024 * 1024 });
    } catch (error) {
      throw classifyHnError(error);
    }
    if (response.status === 429) throw JobFailure.rateLimited("hn returned 429");
    if (response.status >= 500) throw JobFailure.transient(`hn returned ${response.status}`);
    if (response.status >= 400) throw JobFailure.permanent(`hn returned ${response.status}`);

    let parsed: HnResponse;
    try {
      parsed = JSON.parse(response.body) as HnResponse;
    } catch {
      throw JobFailure.transient("hn returned unparseable JSON");
    }

    const out: NormalizedSource[] = [];
    for (const hit of parsed.hits ?? []) {
      const source = normalizeHnHit(hit, deps.baseUrl);
      if (source) out.push(source);
      if (out.length >= limit) break;
    }
    return out;
  }

  const backend: ProviderBackend = {
    id: "hn-algolia",
    capabilities: ["discover", "search"],
    sourceCapabilities: ["time-window", "structured-metadata"],

    async discover(ctx: DiscoverContext): Promise<NormalizedSource[]> {
      const config = readConfig(ctx);
      const limit = ctx.limit ?? config.defaultLimit;
      const tag = config.tags[0] ?? "front_page";
      const remainingMs = Math.max(1, ctx.deadline.getTime() - Date.now());
      const found = await query(`tags=${encodeURIComponent(tag)}`, limit, remainingMs);
      return found.filter((s) => (s.metadata.points as number | null ?? 0) >= config.minPoints);
    },

    async search(ctx: SearchContext, research: ResearchQuery): Promise<NormalizedSource[]> {
      const config = readConfig(ctx);
      const text = research.text?.trim();
      if (!text) return [];
      const limit = ctx.limit ?? config.defaultLimit;
      const remainingMs = Math.max(1, ctx.deadline.getTime() - Date.now());
      const found = await query(`query=${encodeURIComponent(text)}&tags=story`, limit, remainingMs);
      return found.filter((s) => (s.metadata.points as number | null ?? 0) >= config.minPoints);
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
    id: HN_PROVIDER_ID,
    contractVersion: "1",
    version: HN_PROVIDER_VERSION,
    accessClass: "open",
    description: "Hacker News front page + search (open trend/current-events input)",
    backends: [backend],
    configSchema: hnProviderConfigSchema,
    ...(deps.loadConfig
      ? { resolveConfig: (ctx: { userId?: number | null }) => deps.loadConfig!(ctx) }
      : {}),
  };
}

export async function loadHnProviderConfig(): Promise<HnProviderConfig> {
  return hnProviderConfigSchema.parse({
    tags: process.env.HN_TAGS ? process.env.HN_TAGS.split(",").map((t) => t.trim()).filter(Boolean) : ["front_page"],
    defaultLimit: Number(process.env.HN_DEFAULT_LIMIT ?? 20),
  });
}

export const hnProvider = createHnProvider();
