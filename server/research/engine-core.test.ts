import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedSource, ProviderCallDiagnostics } from "./contracts";
import {
  authorStatementEvidence,
  classifyEmptyCollection,
  dedupeSources,
  deriveEvidence,
  hashExcerpt,
  summarizeCollection,
  validateResearch,
} from "./engine-core";

function src(overrides: Partial<NormalizedSource> & { nativeId?: string } = {}): NormalizedSource {
  const nativeId = overrides.nativeId ?? "n1";
  const canonicalUrl = overrides.canonicalUrl ?? `https://example.com/${nativeId}`;
  const text = overrides.content?.text ?? overrides.excerpt ?? `body ${nativeId}`;
  return {
    ref: {
      provider: overrides.provider ?? "rss",
      kind: "article",
      nativeId,
      canonicalUrl,
    },
    provider: overrides.provider ?? "rss",
    backend: "b1",
    providerVersion: "1",
    retrievalMethod: "feed",
    accessClass: "open",
    canonicalUrl,
    title: `title ${nativeId}`,
    author: null,
    publishedAt: null,
    retrievedAt: new Date("2026-09-10T00:00:00Z").toISOString(),
    excerpt: overrides.excerpt ?? text,
    content: overrides.content,
    contentHash: overrides.contentHash ?? `hash-${nativeId}`,
    metadata: {},
    ...overrides,
  } as NormalizedSource;
}

describe("dedupeSources", () => {
  it("keeps distinct sources", () => {
    const { kept, dropped } = dedupeSources([src({ nativeId: "a" }), src({ nativeId: "b" })]);
    assert.equal(kept.length, 2);
    assert.equal(dropped.length, 0);
  });

  it("drops a repeat of the same provider ref", () => {
    const { kept, dropped } = dedupeSources([src({ nativeId: "a" }), src({ nativeId: "a" })]);
    assert.equal(kept.length, 1);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].reason, "duplicate_ref");
  });

  it("drops the same canonical URL arriving from two providers", () => {
    const { kept, dropped } = dedupeSources([
      src({ nativeId: "a", provider: "rss", canonicalUrl: "https://example.com/x" }),
      src({ nativeId: "b", provider: "hn", canonicalUrl: "https://example.com/x" }),
    ]);
    assert.equal(kept.length, 1);
    assert.equal(dropped[0].reason, "duplicate_url");
    assert.equal(dropped[0].keptRef.provider, "rss");
  });

  it("drops identical bodies with different URLs", () => {
    const { kept, dropped } = dedupeSources([
      src({ nativeId: "a", canonicalUrl: "https://a.test/1", contentHash: "same" }),
      src({ nativeId: "b", canonicalUrl: "https://b.test/2", contentHash: "same" }),
    ]);
    assert.equal(kept.length, 1);
    assert.equal(dropped[0].reason, "duplicate_content");
  });

  it("prefers the richer record when a Stage-2 fetch collides with a candidate", () => {
    const stage1 = src({ nativeId: "a", excerpt: "short", contentHash: "h1" });
    const stage2 = src({
      nativeId: "a",
      excerpt: "a much longer excerpt of the article body",
      content: { text: "a much longer excerpt of the article body", mime: "text/plain", length: 43, truncated: false },
      contentHash: "h1",
    });

    const { kept } = dedupeSources([stage1, stage2]);
    assert.equal(kept.length, 1);
    assert.ok(kept[0].content, "the fetched version wins");
  });

  it("does not treat a URL-fallback hash as content identity", () => {
    // Both have no body, so hashes fall back to the URL and must not collide.
    const { kept } = dedupeSources([
      src({ nativeId: "a", canonicalUrl: "https://a.test/1", contentHash: "urlhash1", excerpt: "", title: "" }),
      src({ nativeId: "b", canonicalUrl: "https://b.test/2", contentHash: "urlhash2", excerpt: "", title: "" }),
    ]);
    assert.equal(kept.length, 2);
  });
});

describe("deriveEvidence", () => {
  it("derives sourced evidence with a content-addressed hash", () => {
    const evidence = deriveEvidence([src({ nativeId: "a" })]);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].kind, "excerpt");
    assert.equal(evidence[0].origin, "sourced");
    assert.equal(evidence[0].excerptHash, hashExcerpt(evidence[0].excerpt));
    assert.equal(evidence[0].sourceIndex, 0);
  });

  it("prefers full content over the Stage-1 excerpt", () => {
    const evidence = deriveEvidence([
      src({
        nativeId: "a",
        excerpt: "short",
        content: { text: "the full article body", mime: "text/plain", length: 21, truncated: false },
      }),
    ]);
    assert.equal(evidence[0].excerpt, "the full article body");
  });

  it("dedupes identical passages within a job", () => {
    const evidence = deriveEvidence([
      src({ nativeId: "a", excerpt: "identical passage" }),
      src({ nativeId: "b", excerpt: "identical passage" }),
    ]);
    assert.equal(evidence.length, 1);
  });

  it("bounds the excerpt length", () => {
    const evidence = deriveEvidence([src({ nativeId: "a", excerpt: "x".repeat(5000) })]);
    assert.ok(evidence[0].excerpt.length <= 401);
  });

  it("skips sources with no usable text", () => {
    const evidence = deriveEvidence([
      src({ nativeId: "a", excerpt: "", title: "", content: undefined }),
    ]);
    assert.equal(evidence.length, 0);
  });
});

describe("authorStatementEvidence", () => {
  it("produces sourced evidence without a source", () => {
    const evidence = authorStatementEvidence("we cut p99 by 40%");
    assert.equal(evidence.kind, "author_statement");
    assert.equal(evidence.origin, "sourced");
    assert.equal(evidence.sourceIndex, null);
  });
});

describe("validateResearch", () => {
  it("is valid with at least one sourced evidence item", () => {
    const sources = [src({ nativeId: "a" })];
    const result = validateResearch({ sources, evidence: deriveEvidence(sources) });
    assert.equal(result.valid, true);
    assert.deepEqual(result.reasons, []);
  });

  it("is invalid with no evidence at all", () => {
    const result = validateResearch({ sources: [], evidence: [] });
    assert.equal(result.valid, false);
    assert.deepEqual(result.reasons, ["no_sourced_evidence"]);
  });

  it("is invalid when no sourced evidence survives", () => {
    const result = validateResearch({ sources: [src({ nativeId: "a" })], evidence: [] });
    assert.equal(result.valid, false);
    assert.deepEqual(result.reasons, ["no_sourced_evidence"]);
  });

  it("accepts a human input statement on its own, with no carve-out", () => {
    const result = validateResearch({
      sources: [],
      evidence: [authorStatementEvidence("a war story")],
    });
    assert.equal(result.valid, true, "author_statement satisfies the uniform sourcing rule");
  });
});

function diag(
  outcome: ProviderCallDiagnostics["outcome"],
  failureClass?: string,
): ProviderCallDiagnostics {
  return {
    provider: `p-${outcome}-${failureClass ?? "none"}`,
    backend: "b1",
    capability: "search",
    outcome,
    ...(failureClass ? { failureClass } : {}),
    message: outcome,
    fallbackOccurred: false,
    backendsAttempted: ["b1"],
    latencyMs: 1,
    resultCount: 0,
  };
}

describe("provider failure semantics (locked 04 §2)", () => {
  it("summarizes outcomes, treating skipped providers as not attempted", () => {
    const summary = summarizeCollection([
      diag("ok"),
      diag("empty"),
      diag("failed", "transient"),
      diag("skipped"),
    ]);
    assert.deepEqual(summary, {
      attempted: 3,
      failed: 1,
      ok: 1,
      empty: 1,
      skipped: 1,
      failureClasses: ["transient"],
    });
  });

  it("Case A: every attempted provider failed transiently → job is transient", () => {
    const classified = classifyEmptyCollection(
      summarizeCollection([diag("failed", "transient"), diag("failed", "transient")]),
    );
    assert.equal(classified?.failureClass, "transient");
  });

  it("Case A: all rate limited → job is rate_limited so the queue reschedules", () => {
    const classified = classifyEmptyCollection(
      summarizeCollection([diag("failed", "rate_limited")]),
    );
    assert.equal(classified?.failureClass, "rate_limited");
  });

  it("Case A: transient + rate_limited → transient (both recoverable)", () => {
    const classified = classifyEmptyCollection(
      summarizeCollection([diag("failed", "transient"), diag("failed", "rate_limited")]),
    );
    assert.equal(classified?.failureClass, "transient");
  });

  it("Case A: any permanent failure → permanent (do not retry a dead provider)", () => {
    const classified = classifyEmptyCollection(
      summarizeCollection([diag("failed", "transient"), diag("failed", "permanent")]),
    );
    assert.equal(classified?.failureClass, "permanent");
  });

  it("Case B/C: a successful provider that returned nothing is NOT 'all failed'", () => {
    assert.equal(
      classifyEmptyCollection(summarizeCollection([diag("empty"), diag("failed", "transient")])),
      null,
      "the pipeline ran; this falls through to normal validity handling",
    );
    assert.equal(
      classifyEmptyCollection(summarizeCollection([diag("ok")])),
      null,
      "a provider that succeeded but yielded no sources is not a provider failure",
    );
  });

  it("returns null when no provider was actually attempted", () => {
    assert.equal(classifyEmptyCollection(summarizeCollection([])), null);
    assert.equal(classifyEmptyCollection(summarizeCollection([diag("skipped")])), null);
  });
});
