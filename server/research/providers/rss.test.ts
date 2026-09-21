import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoverContext, FetchContext, SourceRef } from "../contracts";
import { JobFailure } from "../../jobs/failures";
import { UnsafeUrlError } from "../../security/ssrf";
import { createRssProvider, type RssProviderDeps } from "./rss";

function ctx(config: Record<string, unknown> = {}, overrides: Partial<DiscoverContext> = {}) {
  return {
    correlationId: "corr",
    deadline: new Date(Date.now() + 5_000),
    budget: {},
    config,
    ...overrides,
  } satisfies DiscoverContext;
}

function deps(overrides: Partial<RssProviderDeps> = {}): RssProviderDeps {
  return {
    parseFeed: async () => ({ title: "Test Feed", items: [] }),
    fetchArticle: async () => ({
      status: 200,
      body: "<html><title>T</title><body><article>article body text</article></body></html>",
      headers: { "content-type": "text/html" },
      finalUrl: "https://example.com/a",
      truncated: false,
    }),
    ...overrides,
  };
}

const feed = (url: string, name?: string) => ({ url, name });

describe("rss provider: discover", () => {
  it("returns normalized sources for feed items", async () => {
    const provider = createRssProvider(
      deps({
        parseFeed: async () => ({
          title: "Feed",
          items: [
            {
              title: "  First post  ",
              link: "https://example.com/posts/1?utm_source=x",
              guid: "guid-1",
              isoDate: "2026-09-01T10:00:00Z",
              contentSnippet: "Some snippet about kubernetes",
              creator: "Ada",
            },
          ],
        }),
      }),
    );

    const [item] = await provider.backends[0].discover!(
      ctx({ feeds: [feed("https://example.com/rss", "Example")] }),
    );

    assert.equal(item.provider, "rss");
    assert.equal(item.backend, "rss-parser");
    assert.equal(item.accessClass, "open");
    assert.equal(item.retrievalMethod, "feed");
    assert.equal(item.ref.nativeId, "guid-1");
    assert.equal(item.canonicalUrl, "https://example.com/posts/1", "tracking param stripped");
    assert.equal(item.title, "First post");
    assert.equal(item.author?.name, "Ada");
    assert.equal(item.publishedAt, "2026-09-01T10:00:00.000Z");
    assert.ok(item.excerpt?.includes("kubernetes"));
    assert.ok(item.contentHash.length === 64);
    assert.equal(item.metadata.feedName, "Example");
    assert.equal(item.content, undefined, "Stage 1 does not fetch full content");
  });

  it("returns nothing when no feeds are configured", async () => {
    const provider = createRssProvider(deps());
    const out = await provider.backends[0].discover!(ctx({ feeds: [] }));
    assert.deepEqual(out, []);
  });

  it("honours the result limit", async () => {
    const provider = createRssProvider(
      deps({
        parseFeed: async () => ({
          items: Array.from({ length: 10 }, (_, i) => ({
            title: `t${i}`,
            link: `https://example.com/${i}`,
          })),
        }),
      }),
    );
    const out = await provider.backends[0].discover!(
      ctx({ feeds: [feed("https://example.com/rss")] }, { limit: 3 }),
    );
    assert.equal(out.length, 3);
  });

  it("filters items older than the requested window", async () => {
    const provider = createRssProvider(
      deps({
        parseFeed: async () => ({
          items: [
            { title: "old", link: "https://example.com/old", isoDate: "2020-01-01T00:00:00Z" },
            { title: "new", link: "https://example.com/new", isoDate: "2026-09-01T00:00:00Z" },
          ],
        }),
      }),
    );
    const out = await provider.backends[0].discover!(
      ctx({ feeds: [feed("https://example.com/rss")] }, { window: { from: "2026-01-01T00:00:00Z" } }),
    );
    assert.deepEqual(
      out.map((s) => s.title),
      ["new"],
    );
  });

  it("keeps partial results when only some feeds fail", async () => {
    const provider = createRssProvider(
      deps({
        parseFeed: async (url) => {
          if (url.includes("broken")) throw new Error("boom");
          return { items: [{ title: "ok", link: "https://example.com/ok" }] };
        },
      }),
    );

    const out = await provider.backends[0].discover!(
      ctx({ feeds: [feed("https://broken.test/rss"), feed("https://example.com/rss")] }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "ok");
  });

  it("fails when every feed fails, without fabricating sources", async () => {
    const provider = createRssProvider(
      deps({
        parseFeed: async () => {
          throw new Error("network down");
        },
      }),
    );

    await assert.rejects(
      () => provider.backends[0].discover!(ctx({ feeds: [feed("https://example.com/rss")] })),
      (error: unknown) => {
        assert.ok(error instanceof JobFailure);
        assert.equal(error.failureClass, "transient");
        return true;
      },
    );
  });

  it("rejects a feed URL pointing at non-routable space", async () => {
    let parsed = false;
    const provider = createRssProvider(
      deps({
        parseFeed: async () => {
          parsed = true;
          return { items: [] };
        },
      }),
    );

    await assert.rejects(() =>
      provider.backends[0].discover!(
        ctx({ feeds: [feed("http://169.254.169.254/latest/meta-data/")] }),
      ),
    );
    assert.equal(parsed, false, "never reaches the network layer");
  });
});

describe("rss provider: fetch", () => {
  const ref: SourceRef = {
    provider: "rss",
    kind: "article",
    nativeId: "guid-1",
    canonicalUrl: "https://example.com/posts/1",
  };

  const fetchCtx = (): FetchContext => ({
    correlationId: "corr",
    deadline: new Date(Date.now() + 5_000),
    budget: {},
    config: {},
  });

  it("extracts readable text from the article", async () => {
    const provider = createRssProvider(deps());
    const out = await provider.backends[0].fetch!(fetchCtx(), ref);

    assert.equal(out.retrievalMethod, "http");
    assert.equal(out.content?.text, "article body text");
    assert.equal(out.ref.nativeId, "guid-1", "ref is preserved for evidence identity");
    assert.ok(out.contentHash.length === 64);
  });

  it("never leaks raw HTML into the normalized content", async () => {
    const provider = createRssProvider(
      deps({
        fetchArticle: async () => ({
          status: 200,
          body: "<html><body><script>alert(1)</script><article>clean text</article></body></html>",
          headers: {},
          finalUrl: "https://example.com/a",
          truncated: false,
        }),
      }),
    );
    const out = await provider.backends[0].fetch!(fetchCtx(), ref);
    assert.ok(out.content?.text.includes("clean text"));
    assert.ok(!out.content?.text.includes("alert(1)"));
    assert.ok(!out.content?.text.includes("<script>"));
  });

  it("flags truncation", async () => {
    const provider = createRssProvider(
      deps({
        fetchArticle: async () => ({
          status: 200,
          body: "<article>partial body</article>",
          headers: {},
          finalUrl: "https://example.com/a",
          truncated: true,
        }),
      }),
    );
    const out = await provider.backends[0].fetch!(fetchCtx(), ref);
    assert.equal(out.content?.truncated, true);
    assert.ok(out.warnings?.length);
  });

  it("treats a 404 as permanent", async () => {
    const provider = createRssProvider(
      deps({
        fetchArticle: async () => ({
          status: 404,
          body: "gone",
          headers: {},
          finalUrl: "https://example.com/a",
          truncated: false,
        }),
      }),
    );
    await assert.rejects(
      () => provider.backends[0].fetch!(fetchCtx(), ref),
      (e: unknown) => {
        assert.ok(e instanceof JobFailure);
        assert.equal(e.failureClass, "permanent");
        return true;
      },
    );
  });

  it("treats a 503 as transient", async () => {
    const provider = createRssProvider(
      deps({
        fetchArticle: async () => ({
          status: 503,
          body: "later",
          headers: {},
          finalUrl: "https://example.com/a",
          truncated: false,
        }),
      }),
    );
    await assert.rejects(
      () => provider.backends[0].fetch!(fetchCtx(), ref),
      (e: unknown) => {
        assert.ok(e instanceof JobFailure);
        assert.equal(e.failureClass, "transient");
        return true;
      },
    );
  });

  it("classifies an SSRF block as permanent, not retryable", async () => {
    const provider = createRssProvider(
      deps({
        fetchArticle: async () => {
          throw new UnsafeUrlError("blocked_address", "nope");
        },
      }),
    );
    await assert.rejects(
      () => provider.backends[0].fetch!(fetchCtx(), ref),
      (e: unknown) => {
        assert.ok(e instanceof JobFailure);
        assert.equal(e.failureClass, "permanent");
        return true;
      },
    );
  });

  it("classifies a network error as transient", async () => {
    const provider = createRssProvider(
      deps({
        fetchArticle: async () => {
          throw new Error("ECONNRESET");
        },
      }),
    );
    await assert.rejects(
      () => provider.backends[0].fetch!(fetchCtx(), ref),
      (e: unknown) => {
        assert.ok(e instanceof JobFailure);
        assert.equal(e.failureClass, "transient");
        return true;
      },
    );
  });

  it("fails permanently when the page has no readable text", async () => {
    const provider = createRssProvider(
      deps({
        fetchArticle: async () => ({
          status: 200,
          body: "<html><body><script>x</script></body></html>",
          headers: {},
          finalUrl: "https://example.com/a",
          truncated: false,
        }),
      }),
    );
    await assert.rejects(
      () => provider.backends[0].fetch!(fetchCtx(), ref),
      (e: unknown) => {
        assert.ok(e instanceof JobFailure);
        assert.equal(e.failureClass, "permanent");
        return true;
      },
    );
  });
});

describe("rss provider: search", () => {
  const searchProvider = () =>
    createRssProvider(
      deps({
        parseFeed: async () => ({
          items: [
            {
              title: "Kubernetes scheduling deep dive",
              link: "https://example.com/k8s",
              guid: "k8s",
              contentSnippet: "how the scheduler places pods",
            },
            {
              title: "SRE notes",
              link: "https://example.com/sre",
              guid: "sre",
              contentSnippet: "running systems in production",
            },
          ],
        }),
      }),
    );

  it("declares the search capability", () => {
    assert.ok(searchProvider().backends[0].capabilities.includes("search"));
  });

  it("filters discovered items by query text", async () => {
    const provider = searchProvider();
    const out = await provider.backends[0].search!(
      ctx({ feeds: [feed("https://example.com/rss")] }),
      { text: "kubernetes" },
    );
    assert.deepEqual(out.map((s) => s.ref.nativeId), ["k8s"]);
  });

  it("returns every discovered item for an empty query", async () => {
    const provider = searchProvider();
    const out = await provider.backends[0].search!(
      ctx({ feeds: [feed("https://example.com/rss")] }),
      { text: "" },
    );
    assert.equal(out.length, 2);
  });
});

describe("rss provider: config resolution", () => {
  it("exposes resolveConfig when a loader is injected", async () => {
    const provider = createRssProvider(
      deps({
        loadConfig: async () => ({
          feeds: [{ url: "https://example.com/feed.xml" }],
          defaultLimit: 7,
        }),
      }),
    );
    assert.ok(provider.resolveConfig);
    const resolved = await provider.resolveConfig!({ userId: 1 });
    assert.equal((resolved as { defaultLimit: number }).defaultLimit, 7);
  });

  it("omits resolveConfig when no loader is injected", () => {
    assert.equal(createRssProvider(deps()).resolveConfig, undefined);
  });
});
