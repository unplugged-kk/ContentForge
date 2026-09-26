import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MASKED_SECRET_VISIBLE_SUFFIX,
  SECRET_NOT_SET,
  maskSecret,
} from "./secret-display";

const LONG_SECRET = "cfcanary_S3CRETVALUE_9f3b7a21deadbeefcafe";

describe("maskSecret", () => {
  it("renders a fixed mask plus the last 4 characters", () => {
    assert.equal(maskSecret(LONG_SECRET), "••••••cafe");
  });

  it("never exposes any other run of the secret", () => {
    const rendered = maskSecret(LONG_SECRET);
    const body = LONG_SECRET.slice(0, LONG_SECRET.length - MASKED_SECRET_VISIBLE_SUFFIX);
    // No window of the secret body may survive into the rendered string.
    for (let i = 0; i + MASKED_SECRET_VISIBLE_SUFFIX <= body.length; i++) {
      const window = body.slice(i, i + MASKED_SECRET_VISIBLE_SUFFIX);
      assert.ok(!rendered.includes(window), `leaked "${window}" from offset ${i}`);
    }
  });

  it("reveals nothing at all when the value is short enough to be fully exposed by a suffix", () => {
    for (const short of ["a", "ab", "abc", "abcd"]) {
      assert.equal(maskSecret(short), "••••••", `leaked a ${short.length}-character secret`);
    }
  });

  it("treats missing, empty and whitespace-only values as not set", () => {
    for (const empty of [null, undefined, "", "   "]) {
      assert.equal(maskSecret(empty), SECRET_NOT_SET);
    }
  });

  it("is idempotent, so a value the server already masked is unchanged", () => {
    assert.equal(maskSecret("••••••cafe"), "••••••cafe");
  });

  it("collapses a long value to the same length as a short one", () => {
    const short = maskSecret("12345");
    const long = maskSecret("x".repeat(5000));
    assert.equal(short.length, long.length);
  });
});
