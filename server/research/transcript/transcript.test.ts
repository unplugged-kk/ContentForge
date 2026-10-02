/**
 * Tier-0 transcript primitives (pure): VTT parsing, hashing, chunking, dedupe.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cuesToText, parseVtt } from "./vtt";
import { buildTranscript, chunkTranscript, computeTranscriptHash, dedupeChunks } from "./index";
import { youTubeIdFromUrl } from "./fetch";

const ROLLING_VTT = `WEBVTT

NOTE auto-generated

00:00:01.000 --> 00:00:03.000
<c>Hello</c> world

00:00:03.000 --> 00:00:05.000
Hello world This is a test

00:00:05.000 --> 00:00:07.000
This is a test
`;

const PLAIN_VTT = `WEBVTT

00:00:01.000 --> 00:00:02.000
First line

00:00:02.000 --> 00:00:03.000
Second line
`;

describe("parseVtt", () => {
  it("strips tags and collapses rolling auto-captions", () => {
    const cues = parseVtt(ROLLING_VTT);
    assert.equal(cues.length, 1);
    assert.equal(cues[0].startMs, 1000);
    assert.equal(cues[0].endMs, 7000);
    assert.match(cues[0].text, /Hello world This is a test/);
    assert.doesNotMatch(cues[0].text, /<c>/);
  });

  it("keeps distinct cues and decodes entities", () => {
    const cues = parseVtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA &amp; B\n\n00:00:02.000 --> 00:00:03.000\nC\n");
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, "A & B");
  });

  it("ignores documents with no cues", () => {
    assert.deepEqual(parseVtt("WEBVTT\n\nNOTE nothing here\n"), []);
  });
});

describe("transcript hashing and text", () => {
  it("produces a stable hash that changes with content", () => {
    const a = computeTranscriptHash("vid", "en", "hello world");
    const b = computeTranscriptHash("vid", "en", "hello  world"); // whitespace-insensitive
    const c = computeTranscriptHash("vid", "en", "hello there");
    const d = computeTranscriptHash("other", "en", "hello world");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.notEqual(a, d);
  });

  it("builds a transcript with joined text", () => {
    const t = buildTranscript({ videoId: "v", lang: "en", source: "subs", cues: parseVtt(PLAIN_VTT) });
    assert.equal(t.text, "First line Second line");
    assert.equal(t.charCount, t.text.length);
    assert.match(t.hash, /^[0-9a-f]{64}$/);
    assert.equal(cuesToText(t.cues), t.text);
  });
});

describe("chunkTranscript", () => {
  it("groups cues under the target size with stable indices", () => {
    const cues = Array.from({ length: 10 }, (_, i) => ({
      startMs: i * 1000,
      endMs: i * 1000 + 900,
      text: "x".repeat(100),
    }));
    const chunks = chunkTranscript(cues, 250);
    assert.ok(chunks.length > 1);
    chunks.forEach((c, i) => {
      assert.equal(c.index, i);
      assert.ok(c.charCount <= 250 + 101);
      assert.match(c.hash, /^[0-9a-f]{64}$/);
      assert.ok(c.endMs >= c.startMs);
    });
    // every cue is represented
    assert.equal(chunks.reduce((n, c) => n + c.text.split(" ").length, 0), 10);
  });

  it("returns no chunks for empty input", () => {
    assert.deepEqual(chunkTranscript([]), []);
  });
});

describe("dedupeChunks", () => {
  it("drops repeats and shares the seen-set across calls", () => {
    const cues = Array.from({ length: 6 }, (_, i) => ({ startMs: i, endMs: i + 1, text: "same" }));
    const chunks = chunkTranscript(cues, 4); // several identical chunks
    const first = dedupeChunks(chunks);
    assert.equal(first.length, 1);
    const seen = new Set(first.map((c) => c.hash));
    assert.equal(dedupeChunks(chunks, seen).length, 0);
  });
});

describe("youTubeIdFromUrl", () => {
  it("accepts ids, watch URLs and short URLs", () => {
    assert.equal(youTubeIdFromUrl("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(youTubeIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1s"), "dQw4w9WgXcQ");
    assert.equal(youTubeIdFromUrl("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(youTubeIdFromUrl("https://example.com/not-youtube"), null);
  });
});
