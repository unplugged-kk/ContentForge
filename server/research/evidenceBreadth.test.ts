/**
 * F6 — a long source must be represented by more than its opening.
 *
 * A 38,513-character talk reached the post as a single 400-character excerpt
 * (~1% of it), so every later fact was structurally unable to appear. These
 * tests pin the bounded, spread sample and the rolling-caption merge that was
 * duplicating phrases inside transcripts (F7).
 *
 * Pure: no I/O, no database.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedSource } from "./contracts";
import {
  MAX_EVIDENCE_EXCERPT_LENGTH,
  MAX_EVIDENCE_EXCERPTS_PER_SOURCE,
  deriveEvidence,
  excerptWindows,
} from "./engine-core";
import { cuesToText, parseVtt, rollingOverlapWords } from "./transcript/vtt";

function src(overrides: Partial<NormalizedSource> & { nativeId?: string } = {}): NormalizedSource {
  const nativeId = overrides.nativeId ?? "n1";
  const canonicalUrl = overrides.canonicalUrl ?? `https://example.com/${nativeId}`;
  const text = overrides.content?.text ?? overrides.excerpt ?? `body ${nativeId}`;
  return {
    ref: { provider: overrides.provider ?? "rss", kind: "article", nativeId, canonicalUrl },
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

/** A body of distinct, sentence-terminated facts — like a conference talk. */
function longTalk(sentences: number): string {
  return Array.from(
    { length: sentences },
    (_, n) => `Fact number ${n} explains a distinct point about platform engineering.`,
  ).join(" ");
}

describe("excerptWindows", () => {
  it("returns the whole body unchanged when it fits (previous behaviour)", () => {
    const short = "A short body.";
    assert.deepEqual(excerptWindows(short), [short]);
  });

  it("bounds each window and the number of windows", () => {
    const windows = excerptWindows(longTalk(200));
    assert.ok(windows.length > 1, "a long body must yield more than one window");
    assert.ok(windows.length <= MAX_EVIDENCE_EXCERPTS_PER_SOURCE, `got ${windows.length} windows`);
    for (const window of windows) {
      assert.ok(window.length <= MAX_EVIDENCE_EXCERPT_LENGTH, `window too long: ${window.length}`);
      assert.ok(window.length > 0);
    }
  });

  it("spreads across the WHOLE body, not just the opening", () => {
    const talk = longTalk(400);
    const windows = excerptWindows(talk);
    // The last fact cannot appear in the opening window, so a sample that never
    // reaches the end would miss every late fact (the F6 failure).
    const lastFactIndex = talk.lastIndexOf("Fact number 399");
    const coversLateMaterial = windows.some((w) => w.includes("Fact number 399"));
    assert.ok(lastFactIndex > 0, "fixture sanity");
    assert.ok(coversLateMaterial, `windows never reach the end of the body: ${windows.join(" | ")}`);
  });

  it("is deterministic — the same body yields the same windows in order", () => {
    const talk = longTalk(300);
    assert.deepEqual(excerptWindows(talk), excerptWindows(talk));
  });

  it("hard-splits a single sentence longer than a window rather than dropping it", () => {
    const monster = "x".repeat(MAX_EVIDENCE_EXCERPT_LENGTH * 3 + 7);
    const windows = excerptWindows(monster);
    assert.equal(windows.length, 4);
    assert.equal(windows.join("").length, monster.length);
  });
});

describe("deriveEvidence — breadth (F6)", () => {
  it("derives one excerpt for a short source, as before", () => {
    const evidence = deriveEvidence([src({ nativeId: "short", excerpt: "A short body." })]);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].sourceIndex, 0);
  });

  it("derives several pinned excerpts for a long source", () => {
    const evidence = deriveEvidence([src({ nativeId: "talk", excerpt: longTalk(400) })]);
    assert.ok(evidence.length > 1, "a long source must contribute more than one excerpt");
    assert.ok(evidence.length <= MAX_EVIDENCE_EXCERPTS_PER_SOURCE);
    for (const item of evidence) {
      assert.equal(item.sourceIndex, 0, "every excerpt points back at the same source");
      assert.equal(item.kind, "excerpt");
      assert.equal(item.origin, "sourced");
      assert.ok(item.excerpt.length > 0);
    }
    // Each excerpt is pinned by its own hash, and they differ.
    assert.equal(new Set(evidence.map((e) => e.excerptHash)).size, evidence.length);
  });

  it("materially increases coverage of a large transcript", () => {
    const talk = longTalk(400);
    const evidence = deriveEvidence([src({ nativeId: "talk", excerpt: talk })]);
    const covered = evidence.reduce((total, item) => total + item.excerpt.length, 0);
    assert.ok(
      covered > MAX_EVIDENCE_EXCERPT_LENGTH,
      `coverage did not exceed a single excerpt: ${covered} chars`,
    );
  });

  it("is deterministic across runs", () => {
    const sources = [src({ nativeId: "talk", excerpt: longTalk(250) })];
    assert.deepEqual(
      deriveEvidence(sources).map((e) => e.excerptHash),
      deriveEvidence(sources).map((e) => e.excerptHash),
    );
  });

  it("does not duplicate an identical excerpt across sources", () => {
    const same = longTalk(50);
    const evidence = deriveEvidence([
      src({ nativeId: "a", excerpt: same }),
      src({ nativeId: "b", excerpt: same }),
    ]);
    assert.equal(new Set(evidence.map((e) => e.excerptHash)).size, evidence.length);
  });
});

describe("rolling-caption merge (F7)", () => {
  /** A rolling window whose next cue repeats an INTERIOR span. */
  const VTT = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:03.000",
    "which I have seen coming over and over",
    "",
    "00:00:03.000 --> 00:00:05.000",
    "over and over again. again",
    "",
    "00:00:05.000 --> 00:00:07.000",
    "and it keeps happening",
    "",
  ].join("\n");

  it("measures the longest shared word run", () => {
    assert.equal(rollingOverlapWords("a b c", "b c d"), 2);
    assert.equal(rollingOverlapWords("a b c", "a b c"), 3);
    assert.equal(rollingOverlapWords("a b c", "x y z"), 0);
    assert.equal(rollingOverlapWords("The end", "end of story"), 1);
  });

  it("collapses the repeated span instead of duplicating it", () => {
    const text = cuesToText(parseVtt(VTT));
    assert.equal(text, "which I have seen coming over and over again. again and it keeps happening");
    // The phrase appeared twice in the old output (the interior-span repeat).
    assert.equal(text.match(/over and over/g)?.length, 1, text);
    assert.equal(text.match(/which I have seen coming/g)?.length, 1, text);
  });

  it("still collapses an exact repeat and a straight extension", () => {
    const exact = ["WEBVTT", "", "00:00:01.000 --> 00:00:02.000", "same line here", "", "00:00:02.000 --> 00:00:03.000", "same line here", ""].join("\n");
    assert.equal(cuesToText(parseVtt(exact)), "same line here");

    const extend = ["WEBVTT", "", "00:00:01.000 --> 00:00:02.000", "the quick brown", "", "00:00:02.000 --> 00:00:03.000", "the quick brown fox", ""].join("\n");
    assert.equal(cuesToText(parseVtt(extend)), "the quick brown fox");
  });

  it("does NOT merge ordinary consecutive sentences that share one word", () => {
    const prose = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "The end",
      "",
      "00:00:02.000 --> 00:00:03.000",
      "end of story",
      "",
    ].join("\n");
    // One shared word is not a rolling window; the cues stay separate (they are
    // joined by cuesToText with a space, but neither cue was merged away).
    assert.equal(parseVtt(prose).length, 2);
  });
});
