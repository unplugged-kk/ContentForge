/**
 * Research intelligence (analysis-v1).
 *
 * Pure, versioned, deterministic: clustering, ranking, credibility class,
 * conflict detection, freshness, query expansion, and quality state. The
 * ResearchEngine remains the only orchestrator — this module never talks to
 * providers or the database.
 */

import { createHash } from "node:crypto";
import type { NormalizedSource, ProviderCallDiagnostics, TimeWindow } from "./contracts";
import { normalizeText } from "./normalize";
import type { CollectionSummary } from "./engine-core";

export const RESEARCH_ANALYSIS_VERSION = "research-analysis-v1";
export const QUERY_EXPANSION_VERSION = "expansion-v1";
export const CLUSTER_VERSION = "cluster-v1";

export const RESEARCH_LIMITS = {
  maxProviders: 8,
  maxSources: 50,
  maxExpandedQueries: 5,
  maxEvidence: 50,
  maxConcurrentProviders: 4,
  maxSynthesisChars: 8_000,
} as const;

export type WindowPreset = "today" | "last_24h" | "last_7d" | "last_30d" | "custom";
export type ResearchDepth = "quick" | "standard" | "deep";
export type QualityState = "high" | "adequate" | "degraded" | "insufficient" | "conflicted";
export type SourceClass =
  | "official"
  | "first_party"
  | "reputable_news"
  | "community"
  | "anonymous_social"
  | "unknown";
export type NoveltyState = "new" | "mixed" | "already-researched" | "unknown";

export interface ResolvedWindow extends TimeWindow {
  preset: WindowPreset;
  asOf?: string;
}

export interface QueryExpansion {
  original: string;
  expanded: string[];
  version: typeof QUERY_EXPANSION_VERSION;
}

export interface DepthBudget {
  depth: ResearchDepth;
  maxSources: number;
  maxExpandedQueries: number;
  timeoutMs: number;
  extraSearchProviders: number;
}

export interface RankComponents {
  relevance: number;
  freshness: number;
  authority: number;
  convergence: number;
  engagement: number;
}

export interface RankedSource {
  canonicalUrl: string;
  provider: string;
  score: number;
  components: RankComponents;
  sourceClass: SourceClass;
  clusterId: string;
}

export interface SourceCluster {
  clusterId: string;
  version: typeof CLUSTER_VERSION;
  title: string;
  memberUrls: string[];
  providers: string[];
}

export interface ResearchConflict {
  topic: string;
  claims: Array<{ text: string; canonicalUrl: string; provider: string }>;
}

export interface CredibilitySignal {
  canonicalUrl: string;
  sourceClass: SourceClass;
  authorKnown: boolean;
  publishedAt: string | null;
  retrievedAt: string;
  corroborationCount: number;
}

export interface ResearchAnalysis {
  version: typeof RESEARCH_ANALYSIS_VERSION;
  window: ResolvedWindow | null;
  expansion: QueryExpansion | null;
  depth: ResearchDepth;
  quality: QualityState;
  novelty: NoveltyState;
  clusters: SourceCluster[];
  ranking: RankedSource[];
  conflicts: ResearchConflict[];
  credibility: CredibilitySignal[];
  relatedJobIds: number[];
  summary: {
    sources: number;
    providers: number;
    clusters: number;
    conflicts: number;
    freshness: "recent" | "mixed" | "stale" | "unknown";
    quality: QualityState;
  };
  synthesis: {
    title: string;
    facts: string[];
    interpretation: string;
    angles: string[];
    conflictsNoted: string[];
  };
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "and", "or", "vs", "is", "are",
  "this", "that", "with", "from", "by", "at", "as", "it", "be", "was", "were",
]);

const NEWS_HOSTS = new Set([
  "reuters.com", "bbc.com", "bbc.co.uk", "nytimes.com", "washingtonpost.com",
  "theguardian.com", "apnews.com", "bloomberg.com", "ft.com", "wsj.com",
  "techcrunch.com", "theverge.com", "arstechnica.com", "wired.com",
]);

const COMMUNITY_PROVIDERS = new Set(["reddit", "hn", "hackernews"]);

export function depthBudget(depth: ResearchDepth = "standard", maxSources?: number): DepthBudget {
  const caps = {
    quick: { maxSources: 10, maxExpandedQueries: 1, timeoutMs: 30_000, extraSearchProviders: 0 },
    standard: { maxSources: 20, maxExpandedQueries: 3, timeoutMs: 60_000, extraSearchProviders: 2 },
    deep: { maxSources: 50, maxExpandedQueries: 5, timeoutMs: 120_000, extraSearchProviders: 3 },
  }[depth];
  return {
    depth,
    maxSources: Math.min(maxSources ?? caps.maxSources, RESEARCH_LIMITS.maxSources),
    maxExpandedQueries: Math.min(caps.maxExpandedQueries, RESEARCH_LIMITS.maxExpandedQueries),
    timeoutMs: caps.timeoutMs,
    extraSearchProviders: caps.extraSearchProviders,
  };
}

export function resolveTimeWindow(
  input: {
    window?: TimeWindow;
    preset?: WindowPreset;
    asOf?: string;
  } | undefined,
  now = new Date(),
): ResolvedWindow | null {
  const preset = input?.preset ?? inferPreset(input?.window);
  const asOf = input?.asOf ?? input?.window?.asOf;
  const anchor = asOf ? new Date(asOf) : now;
  if (Number.isNaN(anchor.getTime())) {
    return input?.window ? { ...input.window, preset: preset ?? "custom", asOf } : null;
  }

  if (preset === "today") {
    const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
    return { preset, from: from.toISOString(), to: anchor.toISOString(), asOf };
  }
  if (preset === "last_24h") {
    return { preset, from: new Date(anchor.getTime() - 24 * 3600_000).toISOString(), to: anchor.toISOString(), asOf };
  }
  if (preset === "last_7d") {
    return { preset, from: new Date(anchor.getTime() - 7 * 24 * 3600_000).toISOString(), to: anchor.toISOString(), asOf };
  }
  if (preset === "last_30d") {
    return { preset, from: new Date(anchor.getTime() - 30 * 24 * 3600_000).toISOString(), to: anchor.toISOString(), asOf };
  }
  if (input?.window?.from || input?.window?.to) {
    return { preset: "custom", from: input.window.from, to: input.window.to, asOf };
  }
  return asOf ? { preset: "custom", asOf } : null;
}

function inferPreset(window?: TimeWindow): WindowPreset | undefined {
  if (window?.preset) return window.preset;
  if (window?.from || window?.to) return "custom";
  return undefined;
}

export function expandQueries(original: string, max = 3): QueryExpansion {
  const base = normalizeText(original);
  const candidates = [
    base,
    `${base} latest`,
    `${base} announcement`,
    `${base} last 30 days`,
  ];
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    expanded.push(item);
    if (expanded.length >= Math.max(1, Math.min(max, RESEARCH_LIMITS.maxExpandedQueries))) break;
  }
  return { original: base, expanded, version: QUERY_EXPANSION_VERSION };
}

export function titleTokens(title: string | null | undefined): Set<string> {
  const tokens = normalizeText(title ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const token of Array.from(a)) if (b.has(token)) inter += 1;
  return inter / new Set([...Array.from(a), ...Array.from(b)]).size;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function classifySource(source: NormalizedSource): SourceClass {
  const host = hostOf(source.canonicalUrl);
  if (host.endsWith(".gov") || host.endsWith(".mil") || host.startsWith("docs.") || host.includes("wikipedia.org")) {
    return "official";
  }
  if (NEWS_HOSTS.has(host) || NEWS_HOSTS.has(host.split(".").slice(-2).join("."))) return "reputable_news";
  if (COMMUNITY_PROVIDERS.has(source.provider)) {
    return source.author?.name || source.author?.handle ? "community" : "anonymous_social";
  }
  if (source.provider === "youtube" || source.provider === "web") {
    return source.author?.name ? "community" : "unknown";
  }
  return "unknown";
}

function authorityScore(sourceClass: SourceClass): number {
  switch (sourceClass) {
    case "official":
      return 1;
    case "first_party":
      return 0.9;
    case "reputable_news":
      return 0.75;
    case "community":
      return 0.45;
    case "anonymous_social":
      return 0.25;
    default:
      return 0.4;
  }
}

function queryRelevance(source: NormalizedSource, query: string): number {
  const tokens = titleTokens(query);
  const haystack = titleTokens(`${source.title ?? ""} ${source.excerpt ?? ""}`);
  return jaccard(tokens, haystack);
}

function freshnessScore(source: NormalizedSource, window: ResolvedWindow | null, now: Date): number {
  if (!source.publishedAt) return 0.4;
  const published = new Date(source.publishedAt);
  if (Number.isNaN(published.getTime())) return 0.4;
  const ageMs = now.getTime() - published.getTime();
  if (ageMs < 0) return 0.5;
  if (ageMs <= 24 * 3600_000) return 1;
  if (ageMs <= 7 * 24 * 3600_000) return 0.8;
  if (ageMs <= 30 * 24 * 3600_000) return 0.6;
  if (window?.from && published < new Date(window.from)) return 0.1;
  return 0.25;
}

function engagementScore(source: NormalizedSource): number {
  const raw = source.engagement?.raw ?? {};
  const values = Object.values(raw).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return 0.3;
  const max = Math.max(...values);
  return Math.min(1, Math.log10(max + 1) / 5);
}

export function clusterSources(sources: readonly NormalizedSource[]): SourceCluster[] {
  const parent = sources.map((_, index) => index);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };

  const tokens = sources.map((source) => titleTokens(source.title));
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      const sameHost = hostOf(sources[i].canonicalUrl) === hostOf(sources[j].canonicalUrl)
        && hostOf(sources[i].canonicalUrl) !== "";
      const similar = jaccard(tokens[i], tokens[j]) >= 0.45;
      if (similar || (sameHost && jaccard(tokens[i], tokens[j]) >= 0.25)) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  sources.forEach((_, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(index);
    groups.set(root, list);
  });

  return Array.from(groups.values()).map((indexes) => {
    const members = indexes.map((index) => sources[index]);
    const urls = members.map((source) => source.canonicalUrl).sort();
    const representative = members.slice().sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl))[0];
    const digest = createHash("sha256")
      .update(`${CLUSTER_VERSION}:${normalizeText(representative.title ?? "")}:${hostOf(representative.canonicalUrl)}`)
      .digest("hex")
      .slice(0, 16);
    return {
      clusterId: `${CLUSTER_VERSION}:${digest}`,
      version: CLUSTER_VERSION,
      title: representative.title ?? representative.canonicalUrl,
      memberUrls: urls,
      providers: Array.from(new Set(members.map((source) => source.provider))).sort(),
    };
  });
}

export function detectConflicts(sources: readonly NormalizedSource[]): ResearchConflict[] {
  const dateish = /\b(today|yesterday|this week|last week|last month|\d{4}-\d{2}-\d{2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2})\b/i;
  const polarity = /\b(released|launched|announced|cancelled|delayed|not released|didn't ship|did not ship)\b/i;
  const claims: Array<{ text: string; canonicalUrl: string; provider: string; tokens: Set<string> }> = [];

  for (const source of sources) {
    const text = `${source.title ?? ""} ${source.excerpt ?? ""}`;
    if (!polarity.test(text) && !dateish.test(text)) continue;
    const snippet = normalizeText(text).slice(0, 180);
    claims.push({
      text: snippet,
      canonicalUrl: source.canonicalUrl,
      provider: source.provider,
      tokens: titleTokens(source.title),
    });
  }

  const conflicts: ResearchConflict[] = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      if (jaccard(claims[i].tokens, claims[j].tokens) < 0.3) continue;
      const a = claims[i].text.toLowerCase();
      const b = claims[j].text.toLowerCase();
      const disagreeDate = dateish.test(a) && dateish.test(b) && a.match(dateish)?.[0]?.toLowerCase() !== b.match(dateish)?.[0]?.toLowerCase();
      const disagreePolarity =
        (/\b(cancelled|delayed|not released|didn't ship|did not ship)\b/.test(a) && /\b(released|launched|announced)\b/.test(b))
        || (/\b(cancelled|delayed|not released|didn't ship|did not ship)\b/.test(b) && /\b(released|launched|announced)\b/.test(a));
      if (!disagreeDate && !disagreePolarity) continue;
      const topic = Array.from(claims[i].tokens).slice(0, 6).join(" ") || "timing";
      if (conflicts.some((row) => row.topic === topic)) continue;
      conflicts.push({
        topic,
        claims: [
          { text: claims[i].text, canonicalUrl: claims[i].canonicalUrl, provider: claims[i].provider },
          { text: claims[j].text, canonicalUrl: claims[j].canonicalUrl, provider: claims[j].provider },
        ],
      });
    }
  }
  return conflicts;
}

export function filterByWindow(
  sources: readonly NormalizedSource[],
  window: ResolvedWindow | null,
): NormalizedSource[] {
  if (!window?.from && !window?.to) return [...sources];
  const from = window.from ? new Date(window.from).getTime() : null;
  const to = window.to ? new Date(window.to).getTime() : null;
  return sources.filter((source) => {
    if (!source.publishedAt) return true;
    const published = new Date(source.publishedAt).getTime();
    if (Number.isNaN(published)) return true;
    if (from !== null && published < from) return false;
    if (to !== null && published > to) return false;
    return true;
  });
}

export function noveltyAgainst(
  sources: readonly NormalizedSource[],
  priorUrls: readonly string[],
): NoveltyState {
  if (sources.length === 0) return "unknown";
  if (priorUrls.length === 0) return "new";
  const prior = new Set(priorUrls);
  const known = sources.filter((source) => prior.has(source.canonicalUrl)).length;
  if (known === 0) return "new";
  if (known === sources.length) return "already-researched";
  return "mixed";
}

export function qualityState(input: {
  sourceCount: number;
  providerCount: number;
  conflicts: number;
  summary: CollectionSummary;
  freshness: ResearchAnalysis["summary"]["freshness"];
}): QualityState {
  if (input.sourceCount === 0) return "insufficient";
  if (input.conflicts > 0) return "conflicted";
  if (input.summary.failed > 0 && input.summary.ok > 0) return "degraded";
  if (input.sourceCount >= 3 && input.providerCount >= 2 && input.freshness === "recent") return "high";
  return "adequate";
}

function freshnessLabel(
  sources: readonly NormalizedSource[],
  window: ResolvedWindow | null,
  now: Date,
): ResearchAnalysis["summary"]["freshness"] {
  const dated = sources.filter((source) => source.publishedAt);
  if (dated.length === 0) return "unknown";
  const scores = dated.map((source) => freshnessScore(source, window, now));
  const recent = scores.filter((score) => score >= 0.6).length;
  if (recent === dated.length) return "recent";
  if (recent === 0) return "stale";
  return "mixed";
}

export function analyzeResearch(input: {
  query: string;
  sources: readonly NormalizedSource[];
  diagnostics: readonly ProviderCallDiagnostics[];
  summary: CollectionSummary;
  window?: ResolvedWindow | null;
  expansion?: QueryExpansion | null;
  depth?: ResearchDepth;
  priorUrls?: readonly string[];
  relatedJobIds?: readonly number[];
  now?: Date;
}): ResearchAnalysis {
  const now = input.now ?? new Date();
  const window = input.window ?? null;
  const clusters = clusterSources(input.sources);
  const clusterByUrl = new Map<string, SourceCluster>();
  for (const cluster of clusters) {
    for (const url of cluster.memberUrls) clusterByUrl.set(url, cluster);
  }

  const ranking: RankedSource[] = input.sources.map((source) => {
    const sourceClass = classifySource(source);
    const cluster = clusterByUrl.get(source.canonicalUrl);
    const components: RankComponents = {
      relevance: queryRelevance(source, input.query),
      freshness: freshnessScore(source, window, now),
      authority: authorityScore(sourceClass),
      convergence: Math.min(1, ((cluster?.memberUrls.length ?? 1) - 1) / 3),
      engagement: engagementScore(source),
    };
    const score =
      0.35 * components.relevance
      + 0.25 * components.freshness
      + 0.15 * components.authority
      + 0.2 * components.convergence
      + 0.05 * components.engagement;
    return {
      canonicalUrl: source.canonicalUrl,
      provider: source.provider,
      score: Number(score.toFixed(4)),
      components,
      sourceClass,
      clusterId: cluster?.clusterId ?? `${CLUSTER_VERSION}:singleton`,
    };
  }).sort((a, b) => b.score - a.score);

  const conflicts = detectConflicts(input.sources);
  const providers = new Set(input.sources.map((source) => source.provider));
  const freshness = freshnessLabel(input.sources, window, now);
  const quality = qualityState({
    sourceCount: input.sources.length,
    providerCount: providers.size,
    conflicts: conflicts.length,
    summary: input.summary,
    freshness,
  });

  const credibility: CredibilitySignal[] = input.sources.map((source) => ({
    canonicalUrl: source.canonicalUrl,
    sourceClass: classifySource(source),
    authorKnown: Boolean(source.author?.name || source.author?.handle),
    publishedAt: source.publishedAt,
    retrievedAt: source.retrievedAt,
    corroborationCount: clusterByUrl.get(source.canonicalUrl)?.memberUrls.length ?? 1,
  }));

  const analysis: Omit<ResearchAnalysis, "synthesis"> = {
    version: RESEARCH_ANALYSIS_VERSION,
    window,
    expansion: input.expansion ?? null,
    depth: input.depth ?? "standard",
    quality,
    novelty: noveltyAgainst(input.sources, input.priorUrls ?? []),
    clusters,
    ranking,
    conflicts,
    credibility,
    relatedJobIds: [...(input.relatedJobIds ?? [])],
    summary: {
      sources: input.sources.length,
      providers: providers.size,
      clusters: clusters.length,
      conflicts: conflicts.length,
      freshness,
      quality,
    },
  };
  return { ...analysis, synthesis: draftSynthesis(analysis as ResearchAnalysis) };
}

export function draftSynthesis(analysis: ResearchAnalysis): {
  title: string;
  facts: string[];
  interpretation: string;
  angles: string[];
  conflictsNoted: string[];
} {
  const top = analysis.ranking.slice(0, 5);
  const facts = top.map((row) => `${row.provider}: ${row.canonicalUrl}`);
  const conflictsNoted = analysis.conflicts.map(
    (conflict) => `Sources disagree on ${conflict.topic}: ${conflict.claims.map((claim) => claim.provider).join(" vs ")}`,
  );
  const interpretation = conflictsNoted.length > 0
    ? `Sources disagree on ${analysis.conflicts.length} claim(s); do not treat any single provider as settled fact.`
    : `Cross-source ranking under ${analysis.version} surfaces ${analysis.summary.clusters} cluster(s) from ${analysis.summary.providers} provider(s).`;
  return {
    title: analysis.clusters[0]?.title ?? "Research findings",
    facts,
    interpretation,
    angles: analysis.clusters.slice(0, 5).map((cluster) => cluster.title),
    conflictsNoted,
  };
}

export function normalizedQueryKey(query: string): string {
  return normalizeText(query).toLowerCase();
}
