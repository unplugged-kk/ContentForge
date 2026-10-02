/**
 * Task-aware AI router: default (configured provider) vs Gemini (video only),
 * with graceful fallback when a provider has no credential.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AI_TASKS, describeRoutes, resolveRoute } from "./router";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("ai router", () => {
  it("routes the default task to the configured provider", () => {
    withEnv(
      { AI_BASE_URL: "https://api.commandcode.ai/provider/v1", AI_API_KEY: "k", AI_TEXT_MODEL: "gpt-6-luna" },
      () => {
        const r = resolveRoute("default");
        assert.equal(r.providerId, "default");
        assert.equal(r.model, "gpt-6-luna");
        assert.equal(r.baseUrl, "https://api.commandcode.ai/provider/v1");
        assert.equal(r.available, true);
      },
    );
  });

  it("routes video tasks to Gemini when GEMINI_API_KEY is set", () => {
    withEnv(
      {
        GEMINI_API_KEY: "g",
        GEMINI_BASE_URL: undefined,
        VIDEO_TEXT_MODEL: undefined,
        VIDEO_MAIN_MODEL: undefined,
        VIDEO_PREMIUM_MODEL: undefined,
      },
      () => {
        assert.equal(resolveRoute("video.classify").providerId, "gemini");
        assert.equal(resolveRoute("video.classify").model, "gemini-3.1-flash-lite");
        assert.equal(resolveRoute("video.extract").model, "gemini-3.8-flash");
        assert.equal(resolveRoute("video.premium").model, "gemini-3.1-pro-preview");
        assert.match(resolveRoute("video.extract").baseUrl ?? "", /generativelanguage/);
      },
    );
  });

  it("honours the VIDEO_* env overrides", () => {
    withEnv({ GEMINI_API_KEY: "g", VIDEO_MAIN_MODEL: "gemini-custom" }, () => {
      assert.equal(resolveRoute("video.extract").model, "gemini-custom");
    });
  });

  it("falls back to the default provider when Gemini has no key", () => {
    withEnv(
      { GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined, AI_API_KEY: "k", AI_TEXT_MODEL: "gpt-6-luna" },
      () => {
        const r = resolveRoute("video.extract");
        assert.equal(r.providerId, "default");
        assert.equal(r.fallback, true);
        assert.equal(r.model, "gpt-6-luna");
      },
    );
  });

  it("describeRoutes covers every task and never leaks a key", () => {
    const rows = describeRoutes();
    assert.equal(rows.length, AI_TASKS.length);
    for (const row of rows) assert.ok(!JSON.stringify(row).includes("key"));
  });
});
