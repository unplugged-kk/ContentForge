import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExcerpt,
  canonicalizeUrl,
  computeContentHash,
  computeSourceHash,
  normalizeText,
  toIsoOrNull,
} from "./normalize";

describe("canonicalizeUrl", () => {
  it("lowercases scheme and host and drops www", () => {
    assert.equal(canonicalizeUrl("HTTPS://WWW.Example.COM/Path"), "https://example.com/Path");
  });

  it("strips fragments", () => {
    assert.equal(canonicalizeUrl("https://example.com/a#section"), "https://example.com/a");
  });

  it("strips tracking parameters", () => {
    assert.equal(
      canonicalizeUrl("https://example.com/a?utm_source=x&utm_medium=y&id=7"),
      "https://example.com/a?id=7",
    );
    assert.equal(canonicalizeUrl("https://example.com/a?fbclid=z"), "https://example.com/a");
  });

  it("sorts query parameters so ordering does not fork identity", () => {
    assert.equal(
      canonicalizeUrl("https://example.com/a?b=2&a=1"),
      canonicalizeUrl("https://example.com/a?a=1&b=2"),
    );
  });

  it("removes a trailing slash but keeps the root slash", () => {
    assert.equal(canonicalizeUrl("https://example.com/a/"), "https://example.com/a");
    assert.equal(canonicalizeUrl("https://example.com/"), "https://example.com/");
  });

  it("resolves relative URLs against a base", () => {
    assert.equal(
      canonicalizeUrl("/post/1", "https://example.com/blog/x"),
      "https://example.com/post/1",
    );
  });

  it("returns the input unchanged when unparseable", () => {
    assert.equal(canonicalizeUrl("not a url"), "not a url");
  });
});

describe("hashing and text helpers", () => {
  it("collapses all whitespace runs, including newlines", () => {
    assert.equal(normalizeText("  a \t b\n\n c "), "a b c");
  });

  it("hashes equivalent text identically", () => {
    assert.equal(computeContentHash("hello   world"), computeContentHash("hello world"));
    assert.equal(computeContentHash("hello\n\nworld"), computeContentHash("hello world"));
    assert.notEqual(computeContentHash("hello"), computeContentHash("hello!"));
  });

  it("falls back to the URL when there is no body", () => {
    assert.equal(
      computeSourceHash("https://example.com/a"),
      computeSourceHash("https://example.com/a", "   "),
    );
    assert.notEqual(
      computeSourceHash("https://example.com/a", "body"),
      computeSourceHash("https://example.com/a"),
    );
  });

  it("builds a bounded excerpt on a word boundary", () => {
    const excerpt = buildExcerpt("word ".repeat(100), 40);
    assert.ok(excerpt.length <= 41);
    assert.ok(excerpt.endsWith("…"));
  });

  it("returns short text unchanged", () => {
    assert.equal(buildExcerpt("short text", 100), "short text");
  });

  it("normalizes dates and rejects junk", () => {
    assert.equal(toIsoOrNull("2026-09-10T00:00:00Z"), "2026-09-10T00:00:00.000Z");
    assert.equal(toIsoOrNull(new Date("2026-01-02T03:04:05Z")), "2026-01-02T03:04:05.000Z");
    assert.equal(toIsoOrNull("not a date"), null);
    assert.equal(toIsoOrNull(""), null);
    assert.equal(toIsoOrNull(undefined), null);
  });
});
