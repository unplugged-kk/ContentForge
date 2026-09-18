import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedSource } from "./contracts";
import {
  analyzeResearch,
  classifySource,
  clusterSources,
  detectConflicts,
  depthBudget,
  expandQueries,
  filterByWindow,
  noveltyAgainst,
  RESEARCH_LIMITS,
  resolveTimeWindow,
} from "./intelligence";
import { summarizeCollection } from "./engine-core";

function src(overrides: Partial<NormalizedSource> & { nativeId?: string } = {}): NormalizedSource {
  const nativeId = overrides.nativeId ?? "n1";
  const canonicalUrl = overrides.canonicalUrl ?? `https://example.com/${nativeId}`;
  return {
    ref: { provider: overrides.provider ?? "rss", kind: "article", nativeId, canonicalUrl },
    provider: overrides.provider ?? "rss",
    backend: "b1",
    providerVersion: "1",
    retrievalMethod: "feed",
    accessClass: "open",
    canonicalUrl,
    title: overrides.title ?? `OpenAI launches widget ${nativeId}`,
    author: overrides.author ?? { name: "Ada" },
    publishedAt: overrides.publishedAt ?? "2026-09-17T00:00:00.000Z",
    retrievedAt: "2026-09-18T00:00:00.000Z",
    excerpt: overrides.excerpt ?? `OpenAI launches widget ${nativeId}`,
    contentHash: overrides.contentHash ?? `hash-${nativeId}`,
    metadata: {},
    ...overrides,
  };
}

describe("research intelligence", () => {
  it("resolves last_30d against an asOf anchor rather than inventing history", () => {
    const window = resolveTimeWindow(
      { preset: "last_30d", asOf: "2026-04-01T00:00:00.000Z" },
      new Date("2026-09-18T00:00:00.000Z"),
    );
    assert.equal(window?.preset, "last_30d");
    assert.equal(window?.to, "2026-04-01T00:00:00.000Z");
    assert.ok(window?.from && window.from < window.to!);
  });

  it("bounds query expansion and freezes the original", () => {
    const expansion = expandQueries("AI agents", 3);
    assert.equal(expansion.original, "AI agents");
    assert.equal(expansion.version, "expansion-v1");
    assert.ok(expansion.expanded.length <= 3);
    assert.equal(expansion.expanded[0], "AI agents");
  });

  it("rejects unbounded depth: deep still caps at maxSources 50", () => {
    const budget = depthBudget("deep", 1000);
    assert.equal(budget.maxSources, RESEARCH_LIMITS.maxSources);
    assert.ok(budget.maxExpandedQueries <= RESEARCH_LIMITS.maxExpandedQueries);
  });

  it("clusters the same event across providers without inventing a second story identity", () => {
    const clusters = clusterSources([
      src({ nativeId: "r", provider: "reddit", canonicalUrl: "https://reddit.com/a", title: "OpenAI launches widget X" }),
      src({ nativeId: "h", provider: "hn", canonicalUrl: "https://news.ycombinator.com/a", title: "OpenAI launches widget X" }),
      src({ nativeId: "w", provider: "web", canonicalUrl: "https://example.com/other", title: "Unrelated gardening tips" }),
    ]);
    const widget = clusters.find((cluster) => cluster.memberUrls.length === 2);
    assert.ok(widget);
    assert.equal(widget!.version, "cluster-v1");
    assert.ok(widget!.clusterId.startsWith("cluster-v1:"));
    assert.deepEqual(widget!.providers, ["hn", "reddit"]);
  });

  it("keeps conflicting release dates instead of picking a winner", () => {
    const conflicts = detectConflicts([
      src({
        nativeId: "a",
        provider: "web",
        canonicalUrl: "https://a.test/1",
        title: "Widget X released today",
        excerpt: "OpenAI released widget X today",
      }),
      src({
        nativeId: "b",
        provider: "hn",
        canonicalUrl: "https://b.test/2",
        title: "Widget X released last week",
        excerpt: "OpenAI released widget X last week",
      }),
    ]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].claims.length, 2);
  });

  it("does not classify a community post as official truth", () => {
    assert.equal(
      classifySource(src({ provider: "reddit", canonicalUrl: "https://reddit.com/r/x/1", author: { name: "bob" } })),
      "community",
    );
    assert.equal(
      classifySource(src({ provider: "web", canonicalUrl: "https://reuters.com/world/1" })),
      "reputable_news",
    );
  });

  it("drops dated sources outside the requested window and keeps undated ones", () => {
    const window = resolveTimeWindow({ preset: "last_7d" }, new Date("2026-09-18T00:00:00.000Z"));
    const kept = filterByWindow(
      [
        src({ nativeId: "old", publishedAt: "2026-01-01T00:00:00.000Z" }),
        src({ nativeId: "new", publishedAt: "2026-09-16T00:00:00.000Z" }),
        src({ nativeId: "undated", publishedAt: null }),
      ],
      window,
    );
    assert.deepEqual(
      kept.map((row) => row.ref.nativeId).sort(),
      ["new", "undated"],
    );
  });

  it("computes novelty from prior URLs without embeddings", () => {
    const sources = [src({ canonicalUrl: "https://a.test/1" }), src({ nativeId: "b", canonicalUrl: "https://b.test/2" })];
    assert.equal(noveltyAgainst(sources, []), "new");
    assert.equal(noveltyAgainst(sources, ["https://a.test/1", "https://b.test/2"]), "already-researched");
    assert.equal(noveltyAgainst(sources, ["https://a.test/1"]), "mixed");
  });

  it("marks quality conflicted when sources disagree, degraded when a sibling provider failed", () => {
    const sources = [
      src({ nativeId: "a", provider: "rss", title: "Widget X released today", excerpt: "released today" }),
      src({ nativeId: "b", provider: "hn", canonicalUrl: "https://hn.test/b", title: "Widget X released last week", excerpt: "released last week" }),
    ];
    const analysis = analyzeResearch({
      query: "Widget X",
      sources,
      diagnostics: [
        { provider: "rss", backend: "b", capability: "search", outcome: "ok", fallbackOccurred: false, backendsAttempted: ["b"], latencyMs: 1, resultCount: 1 },
        { provider: "reddit", backend: null, capability: "search", outcome: "failed", failureClass: "transient", fallbackOccurred: false, backendsAttempted: [], latencyMs: 1, resultCount: 0 },
      ],
      summary: summarizeCollection([
        { provider: "rss", backend: "b", capability: "search", outcome: "ok", fallbackOccurred: false, backendsAttempted: ["b"], latencyMs: 1, resultCount: 1 },
        { provider: "reddit", backend: null, capability: "search", outcome: "failed", failureClass: "transient", fallbackOccurred: false, backendsAttempted: [], latencyMs: 1, resultCount: 0 },
      ]),
      now: new Date("2026-09-18T00:00:00.000Z"),
    });
    assert.equal(analysis.quality, "conflicted");
    assert.equal(analysis.version, "research-analysis-v1");
    assert.ok(analysis.ranking[0].score >= analysis.ranking[1].score);
  });
});
