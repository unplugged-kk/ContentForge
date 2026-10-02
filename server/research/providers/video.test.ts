/**
 * Video research provider (pure): transcript → NormalizedSource, with injected
 * transcript deps so no yt-dlp or network is needed here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JobFailure } from "../../jobs/failures";
import type { Transcript } from "../transcript";
import { buildVideoSource, createVideoProvider } from "./video";

const transcript: Transcript = {
  videoId: "abc123XYZ_-",
  lang: "en",
  source: "subs",
  cues: [
    { startMs: 0, endMs: 1000, text: "Karpenter provisions nodes quickly." },
    { startMs: 1000, endMs: 2000, text: "Pod requests are usually over-provisioned." },
  ],
  text: "Karpenter provisions nodes quickly. Pod requests are usually over-provisioned.",
  charCount: 78,
  hash: "deadbeef",
};

function ctx(config: Record<string, unknown> = {}) {
  return { correlationId: "c", deadline: new Date(Date.now() + 60_000), budget: {}, config, signal: new AbortController().signal } as any;
}

describe("buildVideoSource", () => {
  it("maps a transcript to a normalized source with the text in content", () => {
    const s = buildVideoSource("https://youtu.be/abc123XYZ_-", transcript);
    assert.equal(s.provider, "video");
    assert.equal(s.ref.kind, "youtube-transcript");
    assert.equal(s.ref.nativeId, "abc123XYZ_-");
    assert.equal(s.canonicalUrl, "https://youtube.com/watch?v=abc123XYZ_-");
    assert.equal(s.content?.mime, "text/plain");
    assert.match(s.content?.text ?? "", /Karpenter/);
    assert.equal(s.metadata?.transcriptHash, "deadbeef");
    assert.match(s.contentHash, /^[0-9a-f]{64}$/);
    assert.ok((s.excerpt ?? "").length > 0);
  });
});

describe("createVideoProvider.search", () => {
  it("ingests a URL-shaped query", async () => {
    const provider = createVideoProvider({
      available: async () => true,
      fetchTranscript: async () => transcript,
    });
    const backend = provider.backends[0];
    const sources = await backend.search!(ctx({ urls: ["https://youtu.be/abc123XYZ_-"] }), { text: "https://youtu.be/abc123XYZ_-" });
    assert.equal(sources.length, 1);
    // configured urls win over the query text
    const byQuery = await backend.search!(ctx(), { text: "https://www.youtube.com/watch?v=abc123XYZ_-" });
    assert.equal(byQuery.length, 1);
  });

  it("returns nothing for a non-URL query", async () => {
    const provider = createVideoProvider({ available: async () => true, fetchTranscript: async () => transcript });
    assert.deepEqual(await provider.backends[0].search!(ctx(), { text: "kubernetes cost" }), []);
  });

  it("fails permanently when no captions are available", async () => {
    const provider = createVideoProvider({ available: async () => true, fetchTranscript: async () => null });
    await assert.rejects(
      () => provider.backends[0].search!(ctx(), { text: "https://youtu.be/abc123XYZ_-" }),
      (e: unknown) => e instanceof JobFailure && /no caption track/.test((e as Error).message),
    );
  });

  it("fails permanently when yt-dlp is unavailable", async () => {
    const provider = createVideoProvider({ available: async () => false, fetchTranscript: async () => transcript });
    await assert.rejects(
      () => provider.backends[0].search!(ctx(), { text: "https://youtu.be/abc123XYZ_-" }),
      /yt-dlp is not available/,
    );
  });
});
