/**
 * Web provider — generic URL reading through the centralized SSRF boundary.
 *
 * Access class `open`. There is no search engine here: the provider reads URLs it
 * is *given* (durably, via configuration or a request-scoped provider config) or
 * that a directed query itself supplies. Every fetch goes through
 * `createSafeFetchDeps()` → `safeFetch`, so:
 *
 *   • scheme/port/credential syntax gate
 *   • connect-time DNS validation (blocks loopback, RFC1918, link-local,
 *     metadata, IPv6 private ranges — and therefore DNS rebinding)
 *   • per-hop redirect revalidation
 *   • byte and time ceilings, `accept-encoding: identity` (no decompression bomb)
 *
 * On top of that this provider enforces a content-type allowlist (text only —
 * never binaries) and a URL-length ceiling. HTML is extracted to text; no browser
 * runtime and no JS execution exist anywhere on this path.
 */

import { z } from "zod";
import { JobFailure, describeError } from "../../jobs/failures";
import type {
  FetchContext,
  NormalizedSource,
  ProviderBackend,
  ProviderDefinition,
  ResearchQuery,
  SearchContext,
  SourceRef,
} from "../contracts";
import { extractReadableText } from "../extract";
import { buildExcerpt, canonicalizeUrl, computeSourceHash, normalizeText } from "../normalize";
import {
  assertUrlLength,
  createSafeFetchDeps,
  DEFAULT_URL_MAX_LENGTH,
  type ProviderHttpDeps,
} from "./http";
import { envList } from "./providerUrls";

export const WEB_PROVIDER_ID = "web";
export const WEB_PROVIDER_VERSION = "1.0.0";

export const webProviderConfigSchema = z.object({
  urls: z.array(z.string().trim().min(1).max(DEFAULT_URL_MAX_LENGTH)).max(25).default([]),
  defaultLimit: z.number().int().positive().max(25).default(10),
  maxBytes: z.number().int().positive().max(5 * 1024 * 1024).default(512 * 1024),
});

export type WebProviderConfig = z.infer<typeof webProviderConfigSchema>;

const TEXT_CONTENT_TYPES = [
  "text/html",
  "text/plain",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
  "application/rss+xml",
  "application/atom+xml",
] as const;

export interface WebProviderDeps {
  http: ProviderHttpDeps;
  loadConfig?: (ctx: { userId?: number | null }) => Promise<WebProviderConfig>;
}

export function createWebDeps(): WebProviderDeps {
  return { http: createSafeFetchDeps() };
}

function readConfig(ctx: { config: Readonly<Record<string, unknown>> }): WebProviderConfig {
  return webProviderConfigSchema.parse(ctx.config ?? {});
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function createWebProvider(overrides: Partial<WebProviderDeps> = {}): ProviderDefinition {
  const deps: WebProviderDeps = { ...createWebDeps(), ...overrides };

  async function readUrl(
    rawUrl: string,
    ctx: { deadline: Date; budget?: { maxBytes?: number } },
    limitBytes: number,
  ): Promise<NormalizedSource> {
    assertUrlLength(rawUrl);
    const remainingMs = Math.max(1, ctx.deadline.getTime() - Date.now());

    let response;
    try {
      response = await deps.http.fetchText({
        url: rawUrl,
        timeoutMs: remainingMs,
        maxBytes: ctx.budget?.maxBytes ?? limitBytes,
        allowedContentTypes: [...TEXT_CONTENT_TYPES],
        headers: { "user-agent": "ContentForge-Research/1.0" },
      });
    } catch (error) {
      const message = describeError(error);
      if (/content-type|URL length|Blocked|unsafe|blocked_address|credentials_in_url|unsupported_protocol/i.test(message)) {
        // Policy refusals are terminal — retrying the same URL cannot help.
        throw JobFailure.permanent(`blocked by policy: ${message}`);
      }
      throw JobFailure.transient(`could not read ${rawUrl}: ${message}`);
    }

    if (response.status === 429) throw JobFailure.rateLimited(`web returned 429 for ${rawUrl}`);
    if (response.status >= 500) throw JobFailure.transient(`web returned ${response.status}`);
    if (response.status >= 400) throw JobFailure.permanent(`web returned ${response.status}`);

    const extracted = extractReadableText(response.body);
    const text = normalizeText(extracted.text);
    if (text.length === 0) throw JobFailure.permanent(`no readable text at ${rawUrl}`);

    const canonicalUrl = canonicalizeUrl(response.finalUrl || rawUrl);
    const title = extracted.title?.trim() || canonicalUrl;

    return {
      ref: {
        provider: WEB_PROVIDER_ID,
        kind: "page",
        nativeId: computeSourceHash(canonicalUrl).slice(0, 32),
        canonicalUrl,
      },
      provider: WEB_PROVIDER_ID,
      backend: "web-fetch",
      providerVersion: WEB_PROVIDER_VERSION,
      retrievalMethod: "http",
      accessClass: "open",
      canonicalUrl,
      title,
      author: extracted.author ? { name: extracted.author } : null,
      publishedAt: null,
      retrievedAt: new Date().toISOString(),
      excerpt: buildExcerpt(extracted.description ?? text),
      content: { text, mime: "text/plain", length: text.length, truncated: response.truncated },
      contentHash: computeSourceHash(canonicalUrl, text),
      metadata: { finalUrl: response.finalUrl, contentType: response.contentType },
      ...(response.truncated ? { warnings: ["response truncated at byte ceiling"] } : {}),
    };
  }

  const backend: ProviderBackend = {
    id: "web-fetch",
    capabilities: ["search", "fetch"],
    sourceCapabilities: ["structured-metadata"],

    /** Directed URL reading: configured URLs, or the query itself when it is a URL. */
    async search(ctx: SearchContext, query: ResearchQuery): Promise<NormalizedSource[]> {
      const config = readConfig(ctx);
      const limit = ctx.limit ?? config.defaultLimit;
      const targets =
        config.urls.length > 0 ? config.urls : looksLikeUrl(query.text ?? "") ? [query.text!.trim()] : [];
      if (targets.length === 0) return [];

      const collected: NormalizedSource[] = [];
      const failures: string[] = [];
      for (const url of targets.slice(0, limit)) {
        try {
          collected.push(await readUrl(url, ctx, config.maxBytes));
        } catch (error) {
          // A permanent policy refusal on one URL must not silently vanish.
          failures.push(`${url}: ${describeError(error)}`);
          if (error instanceof JobFailure && error.failureClass === "permanent" && collected.length === 0 && targets.length === 1) {
            throw error;
          }
        }
      }
      if (collected.length === 0 && failures.length > 0) {
        throw JobFailure.permanent(`all ${failures.length} web URL(s) failed. First: ${failures[0]}`);
      }
      return collected;
    },

    async fetch(ctx: FetchContext, ref: SourceRef): Promise<NormalizedSource> {
      const config = readConfig(ctx);
      const source = await readUrl(ref.canonicalUrl, ctx, config.maxBytes);
      return { ...source, ref };
    },

    async probe() {
      return {
        state: "healthy" as const,
        capabilities: {
          search: { state: "healthy" as const },
          fetch: { state: "healthy" as const },
        },
      };
    },
  };

  return {
    id: WEB_PROVIDER_ID,
    contractVersion: "1",
    version: WEB_PROVIDER_VERSION,
    accessClass: "open",
    description: "Generic URL reading through the SSRF-guarded safe fetch (text only)",
    backends: [backend],
    configSchema: webProviderConfigSchema,
    ...(deps.loadConfig
      ? { resolveConfig: (ctx: { userId?: number | null }) => deps.loadConfig!(ctx) }
      : {}),
  };
}

/** Durable web targets from env; empty by default so nothing is fetched silently. */
export async function loadWebProviderConfig(): Promise<WebProviderConfig> {
  return webProviderConfigSchema.parse({
    urls: envList(process.env.WEB_RESEARCH_URLS),
    defaultLimit: Number(process.env.WEB_DEFAULT_LIMIT ?? 10),
  });
}

export const webProvider = createWebProvider();
