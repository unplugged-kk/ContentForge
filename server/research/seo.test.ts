import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUnconfiguredSeoProvider, normalizeSeoContext, seoConfigured } from "./seo";

describe("seo intelligence", () => {
  it("normalizes provider data without fabricating missing metrics", () => {
    const context = normalizeSeoContext({
      topic: "AI agents",
      payload: {
        keywords: [{ keyword: "ai agents", searchIntent: "informational" }, { keyword: "" }],
        serp: [{ url: "https://example.com/a", title: "Guide", rank: 1 }],
        competitors: [{ domain: "example.com" }],
      },
    });
    assert.equal(context.keywords.length, 1);
    assert.equal(context.keywords[0].volume, null);
    assert.equal(context.serp[0].url, "https://example.com/a");
    assert.equal(context.interpretation, null);
  });

  it("stays unconfigured when OpenSEO env is absent", async () => {
    const provider = createUnconfiguredSeoProvider();
    const health = await provider.health();
    assert.equal(health.state, "unconfigured");
    assert.equal(health.available, false);
    assert.equal(seoConfigured(), Boolean(process.env.OPENSEO_API_URL || process.env.OPENSEO_MCP_URL));
  });
});
