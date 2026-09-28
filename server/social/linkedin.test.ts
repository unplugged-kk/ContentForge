/**
 * Regression: the `LinkedIn-Version` header must never be a retired version.
 * `202401` is LinkedIn's own example of a deprecated version that returns an
 * error — it was hard-coded here and broke every LinkedIn publish.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLinkedInHeaders, getLinkedInApiVersion } from "./linkedin";

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

describe("linkedin api version", () => {
  it("defaults to a current YYYYMM version, never the deprecated 202401", () => {
    withEnv("LINKEDIN_API_VERSION", undefined, () => {
      const version = getLinkedInApiVersion();
      assert.match(version, /^\d{6}$/);
      assert.notEqual(version, "202401");
      assert.ok(Number(version) >= 202501, `version ${version} looks stale`);
    });
  });

  it("sends the version on the request headers", () => {
    withEnv("LINKEDIN_API_VERSION", undefined, () => {
      const headers = buildLinkedInHeaders("tok");
      assert.equal(headers["LinkedIn-Version"], getLinkedInApiVersion());
      assert.notEqual(headers["LinkedIn-Version"], "202401");
      assert.equal(headers["X-Restli-Protocol-Version"], "2.0.0");
      assert.equal(headers.Authorization, "Bearer tok");
    });
  });

  it("honours the LINKEDIN_API_VERSION override", () => {
    withEnv("LINKEDIN_API_VERSION", "202609", () => {
      assert.equal(getLinkedInApiVersion(), "202609");
      assert.equal(buildLinkedInHeaders("tok")["LinkedIn-Version"], "202609");
    });
  });
});
