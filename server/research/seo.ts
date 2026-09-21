/**
 * Optional SEO intelligence seam.
 *
 * OpenSEO (or any compatible HTTP provider) is not ContentForge's system of
 * record. Keyword/SERP/competitor payloads are normalized here, provenance is
 * retained, missing metrics are never fabricated, and API keys never leave
 * server-side config.
 */

import { z } from "zod";

export const SEO_PROVIDER_ID = "openseo";

export type SeoCapability = "keyword_research" | "serp" | "competitor" | "domain";
export type SeoHealthState = "healthy" | "degraded" | "unavailable" | "unconfigured";

export interface SeoKeyword {
  keyword: string;
  searchIntent: string | null;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  trend: string | null;
}

export interface SeoSerpResult {
  rank: number | null;
  title: string | null;
  url: string;
  snippet: string | null;
}

export interface SeoCompetitor {
  domain: string;
  overlap: number | null;
  notes: string | null;
}

export interface SeoContext {
  providerId: string;
  retrievedAt: string;
  topic: string;
  keywords: SeoKeyword[];
  serp: SeoSerpResult[];
  competitors: SeoCompetitor[];
  capabilities: SeoCapability[];
  interpretation: string | null;
}

export interface SeoProviderHealth {
  providerId: string;
  state: SeoHealthState;
  configured: boolean;
  available: boolean;
  reason: string;
  capabilities: SeoCapability[];
  checkedAt: string;
}

export interface SeoProviderPort {
  health(): Promise<SeoProviderHealth>;
  research(topic: string, capabilities?: readonly SeoCapability[]): Promise<SeoContext>;
}

const keywordSchema = z.object({
  keyword: z.string().trim().min(1).max(200),
  searchIntent: z.string().trim().max(80).nullable().optional(),
  volume: z.number().nonnegative().nullable().optional(),
  difficulty: z.number().min(0).max(100).nullable().optional(),
  cpc: z.number().nonnegative().nullable().optional(),
  trend: z.string().trim().max(40).nullable().optional(),
});

const serpSchema = z.object({
  rank: z.number().int().positive().nullable().optional(),
  title: z.string().trim().max(500).nullable().optional(),
  url: z.string().trim().url(),
  snippet: z.string().trim().max(1000).nullable().optional(),
});

const competitorSchema = z.object({
  domain: z.string().trim().min(1).max(200),
  overlap: z.number().min(0).max(1).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export function normalizeSeoContext(input: {
  topic: string;
  providerId?: string;
  retrievedAt?: string;
  payload: unknown;
  capabilities?: readonly SeoCapability[];
}): SeoContext {
  const record = input.payload && typeof input.payload === "object" ? (input.payload as Record<string, unknown>) : {};
  const keywordsRaw = Array.isArray(record.keywords) ? record.keywords : [];
  const serpRaw = Array.isArray(record.serp) ? record.serp : Array.isArray(record.results) ? record.results : [];
  const competitorsRaw = Array.isArray(record.competitors) ? record.competitors : [];
  const keywords: SeoKeyword[] = [];
  for (const row of keywordsRaw) {
    const parsed = keywordSchema.safeParse(row);
    if (!parsed.success) continue;
    keywords.push({
      keyword: parsed.data.keyword,
      searchIntent: parsed.data.searchIntent ?? null,
      volume: parsed.data.volume ?? null,
      difficulty: parsed.data.difficulty ?? null,
      cpc: parsed.data.cpc ?? null,
      trend: parsed.data.trend ?? null,
    });
  }
  const serp: SeoSerpResult[] = [];
  for (const row of serpRaw) {
    const parsed = serpSchema.safeParse(row);
    if (!parsed.success) continue;
    serp.push({
      rank: parsed.data.rank ?? null,
      title: parsed.data.title ?? null,
      url: parsed.data.url,
      snippet: parsed.data.snippet ?? null,
    });
  }
  const competitors: SeoCompetitor[] = [];
  for (const row of competitorsRaw) {
    const parsed = competitorSchema.safeParse(row);
    if (!parsed.success) continue;
    competitors.push({
      domain: parsed.data.domain,
      overlap: parsed.data.overlap ?? null,
      notes: parsed.data.notes ?? null,
    });
  }
  return {
    providerId: input.providerId ?? SEO_PROVIDER_ID,
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    topic: input.topic,
    keywords,
    serp,
    competitors,
    capabilities: [...(input.capabilities ?? ["keyword_research"])],
    interpretation: null,
  };
}

export function seoConfigured(): boolean {
  return Boolean(process.env.OPENSEO_API_URL?.trim() || process.env.OPENSEO_MCP_URL?.trim());
}

export function unconfiguredSeoHealth(now = new Date()): SeoProviderHealth {
  return {
    providerId: SEO_PROVIDER_ID,
    state: "unconfigured",
    configured: false,
    available: false,
    reason: "OPENSEO_API_URL / OPENSEO_MCP_URL unset",
    capabilities: [],
    checkedAt: now.toISOString(),
  };
}

export function createUnconfiguredSeoProvider(): SeoProviderPort {
  return {
    async health() {
      return unconfiguredSeoHealth();
    },
    async research(topic: string) {
      return normalizeSeoContext({ topic, payload: {}, capabilities: [] });
    },
  };
}

export async function createSeoProvider(): Promise<SeoProviderPort> {
  if (!seoConfigured()) return createUnconfiguredSeoProvider();
  const base = (process.env.OPENSEO_API_URL ?? process.env.OPENSEO_MCP_URL ?? "").replace(/\/$/, "");
  const apiKey = process.env.OPENSEO_API_KEY?.trim() ?? "";
  return {
    async health() {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4_000);
        const response = await fetch(`${base}/health`, {
          signal: controller.signal,
          headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
        });
        clearTimeout(timer);
        const ok = response.ok;
        return {
          providerId: SEO_PROVIDER_ID,
          state: ok ? "healthy" : "degraded",
          configured: true,
          available: ok,
          reason: ok ? "openseo health ok" : `openseo health HTTP ${response.status}`,
          capabilities: ok ? ["keyword_research", "serp", "competitor"] : [],
          checkedAt: new Date().toISOString(),
        };
      } catch (error) {
        return {
          providerId: SEO_PROVIDER_ID,
          state: "unavailable",
          configured: true,
          available: false,
          reason: error instanceof Error ? error.message : String(error),
          capabilities: [],
          checkedAt: new Date().toISOString(),
        };
      }
    },
    async research(topic: string, capabilities: readonly SeoCapability[] = ["keyword_research"]) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(`${base}/research`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ topic, capabilities }),
        });
        const payload = await response.json().catch(() => ({}));
        return normalizeSeoContext({
          topic,
          payload,
          capabilities,
          providerId: SEO_PROVIDER_ID,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
