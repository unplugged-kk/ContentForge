/**
 * Unit tests for the Phase 2 research providers.
 *
 * Network is injected (the provider HTTP seam), so every provider is exercised
 * end to end without real egress. Pure normalization functions are tested
 * directly; the HTTP guards (URL length, content-type) are covered here too.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoverContext, SearchContext } from "../contracts";
import { dedupeSources } from "../engine-core";
import { ProviderExecutor, registerProvider, resetProviderRegistry } from "../registry";
import {
  createRedditProvider,
  normalizeRedditPost,
  REDDIT_PROVIDER_ID,
  redditProviderConfigSchema,
  resolveRedditCredentials,
} from "./reddit";
import {
  createYoutubeProvider,
  normalizeYoutubeItem,
  youtubeVideoId,
  YOUTUBE_PROVIDER_ID,
} from "./youtube";
import { createHnProvider, normalizeHnHit, HN_PROVIDER_ID } from "./hn";
import { createWebProvider, WEB_PROVIDER_ID } from "./web";
import {
  assertAllowedContentType,
  assertUrlLength,
  DisallowedContentTypeError,
  normalizeContentType,
  UrlTooLongError,
  type ProviderHttpDeps,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
} from "./http";

function ctx(config: Record<string, unknown>, deadlineMs = 30_000): DiscoverContext {
  return {
    correlationId: "c1",
    deadline: new Date(Date.now() + deadlineMs),
    budget: {},
    config,
    signal: AbortSignal.timeout(deadlineMs),
  };
}

function fakeHttp(
  handler: (request: ProviderHttpRequest) => Partial<ProviderHttpResponse>,
): ProviderHttpDeps {
  return {
    async fetchText(request) {
      const partial = handler(request);
      return {
        status: partial.status ?? 200,
        body: partial.body ?? "",
        contentType: partial.contentType ?? "application/json",
        finalUrl: partial.finalUrl ?? request.url,
        truncated: partial.truncated ?? false,
      };
    },
  };
}

// ── Reddit ────────────────────────────────────────────────────────────────────
const REDDIT_LISTING = {
  data: {
    children: [
      {
        data: {
          name: "t3_abc",
          id: "abc",
          title: "Kubernetes scheduling deep dive",
          permalink: "/r/kubernetes/comments/abc/kubernetes_scheduling/",
          url: "https://example.com/k8s",
          selftext: "A long post about pod scheduling.",
          author: "ada",
          created_utc: 1_760_000_000,
          subreddit: "kubernetes",
          score: 120,
          num_comments: 14,
        },
      },
      { data: { name: "t3_nsfw", title: "Nope", permalink: "/r/x/comments/nsfw/", over_18: true } },
      { data: { name: "t3_notitle" } },
    ],
  },
};

describe("reddit provider", () => {
  it("normalizes a post into a NormalizedSource with stable identity", () => {
    const source = normalizeRedditPost(
      REDDIT_LISTING.data.children[0].data,
      "https://www.reddit.com",
    )!;
    assert.equal(source.provider, "reddit");
    assert.equal(source.ref.provider, REDDIT_PROVIDER_ID);
    assert.equal(source.ref.kind, "post");
    assert.equal(source.ref.nativeId, "t3_abc");
    // canonicalizeUrl normalizes the host (lower-case, no `www.`).
    assert.match(source.canonicalUrl, /^https:\/\/reddit\.com\/r\/kubernetes\/comments\/abc\//);
    assert.ok(source.publishedAt && !Number.isNaN(Date.parse(source.publishedAt)), "publishedAt is an ISO timestamp");
    assert.equal(source.accessClass, "open");
    assert.equal(source.metadata.subreddit, "kubernetes");
    assert.equal(source.metadata.score, 120);
  });

  it("drops NSFW and title-less posts rather than inventing sources", () => {
    assert.equal(normalizeRedditPost({ name: "t3_x", title: "n", over_18: true }, "https://r.test"), null);
    assert.equal(normalizeRedditPost({ name: "t3_y" }, "https://r.test"), null);
  });

  it("discovers through the public listing endpoint and normalizes the response", async () => {
    const provider = createRedditProvider({
      baseUrl: "https://reddit.test",
      http: fakeHttp(() => ({ body: JSON.stringify(REDDIT_LISTING) })),
    });
    const backend = provider.backends[0];
    assert.deepEqual([...backend.capabilities].sort(), ["discover", "search"]);
    const found = await backend.discover!(ctx({ subreddits: ["kubernetes"], defaultLimit: 10 }));
    assert.equal(found.length, 1, "NSFW / title-less entries are filtered out");
    assert.equal(found[0].ref.nativeId, "t3_abc");
  });

  it("treats a 429 as a rate-limit failure (reschedule), not a job failure", async () => {
    const provider = createRedditProvider({
      baseUrl: "https://reddit.test",
      http: fakeHttp(() => ({ status: 429, body: "slow down" })),
    });
    await assert.rejects(
      () => provider.backends[0].discover!(ctx({ subreddits: ["kubernetes"] })),
      (error: { failureClass?: string }) => error.failureClass === "rate_limited",
    );
  });

  it("makes no request when it has no configuration", async () => {
    let called = 0;
    const provider = createRedditProvider({
      baseUrl: "https://reddit.test",
      http: fakeHttp(() => {
        called += 1;
        return { body: "{}" };
      }),
    });
    const found = await provider.backends[0].discover!(ctx({ subreddits: [] }));
    assert.deepEqual(found, []);
    assert.equal(called, 0, "empty config must not trigger a fetch");
    assert.deepEqual(redditProviderConfigSchema.parse({}).subreddits, []);
  });
});

// ── YouTube ───────────────────────────────────────────────────────────────────
describe("youtube provider", () => {
  it("derives the video id from the Atom id or link", () => {
    assert.equal(youtubeVideoId({ id: "yt:video:ABCDEF12345" }), "ABCDEF12345");
    assert.equal(youtubeVideoId({ link: "https://www.youtube.com/watch?v=ZZZ999" }), "ZZZ999");
    assert.equal(youtubeVideoId({}), null);
  });

  it("normalizes metadata-only entries (no transcript capability)", () => {
    const source = normalizeYoutubeItem(
      { title: "Scheduler internals", id: "yt:video:vid1", isoDate: "2026-01-02T00:00:00.000Z", author: "CF" },
      "chan1",
    )!;
    assert.equal(source.ref.nativeId, "vid1");
    assert.equal(source.ref.kind, "video");
    assert.equal(source.metadata.transcriptAvailable, false);
    assert.equal(source.accessClass, "open");
  });

  it("declares discover only — no fetch/transcript path", () => {
    const provider = createYoutubeProvider({ baseUrl: "https://yt.test", parseFeed: async () => ({ items: [] }) });
    assert.deepEqual(provider.backends[0].capabilities, ["discover"]);
  });

  it("discovers from channel feeds and degrades per-channel", async () => {
    const provider = createYoutubeProvider({
      baseUrl: "https://yt.test",
      parseFeed: async (url) => {
        if (url.includes("bad")) throw new Error("feed down");
        return { items: [{ title: "Good video", id: "yt:video:good1" }] };
      },
    });
    const found = await provider.backends[0].discover!(ctx({ channelIds: ["bad", "good"] }));
    assert.equal(found.length, 1, "one failing channel does not sink the rest");
    assert.equal(found[0].ref.nativeId, "good1");
  });
});

// ── Hacker News (trend input) ─────────────────────────────────────────────────
describe("hn (trends) provider", () => {
  const hit = {
    objectID: "42",
    title: "A new scheduler paper",
    url: "https://example.com/paper",
    author: "pg",
    created_at: "2026-02-01T12:00:00.000Z",
    points: 210,
    num_comments: 88,
  };

  it("normalizes a trend hit without inventing a new domain entity", () => {
    const source = normalizeHnHit(hit, "https://hn.algolia.com")!;
    assert.equal(source.provider, "hn");
    assert.equal(source.ref.kind, "story", "a trend is just a normalized source");
    assert.equal(source.ref.nativeId, "42");
    assert.equal(source.canonicalUrl, "https://example.com/paper");
    assert.equal(source.metadata.points, 210);
    assert.match(String(source.metadata.discussionUrl), /item\?id=42/);
  });

  it("searches with the query and honours minPoints", async () => {
    const provider = createHnProvider({
      baseUrl: "https://hn.test",
      http: fakeHttp((request) => {
        assert.match(request.url, /query=kubernetes/);
        assert.match(request.url, /tags=story/);
        return {
          body: JSON.stringify({ hits: [hit, { ...hit, objectID: "43", title: "low signal", points: 1 }] }),
        };
      }),
    });
    const found = await provider.backends[0].search!(
      ctx({ minPoints: 100 }) as SearchContext,
      { text: "kubernetes" },
    );
    assert.equal(found.length, 1, "below-threshold noise is filtered");
    assert.equal(found[0].ref.nativeId, "42");
  });
});

// ── Web (SSRF-guarded) ────────────────────────────────────────────────────────
describe("web provider", () => {
  it("declares search + fetch and reads configured URLs only", async () => {
    const provider = createWebProvider({
      http: fakeHttp(() => ({
        body: "<html><head><title>Doc</title></head><body><p>Hello world content.</p></body></html>",
        contentType: "text/html",
        finalUrl: "https://example.com/doc",
      })),
    });
    assert.deepEqual([...provider.backends[0].capabilities].sort(), ["fetch", "search"]);

    const found = await provider.backends[0].search!(ctx({ urls: ["https://example.com/doc"] }) as SearchContext, {
      text: "ignored",
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].provider, WEB_PROVIDER_ID);
    assert.equal(found[0].retrievalMethod, "http");
    assert.match(found[0].content!.text, /Hello world content/);
  });

  it("returns nothing (and makes no request) when no URL is configured or implied", async () => {
    let called = 0;
    const provider = createWebProvider({
      http: fakeHttp(() => {
        called += 1;
        return { body: "<html><body>hi</body></html>", contentType: "text/html" };
      }),
    });
    const found = await provider.backends[0].search!(ctx({ urls: [] }) as SearchContext, {
      text: "just a topic, not a url",
    });
    assert.deepEqual(found, []);
    assert.equal(called, 0);
  });

  it("accepts a URL supplied as the directed query", async () => {
    const provider = createWebProvider({
      http: fakeHttp(() => ({ body: "<html><body>Story body text.</body></html>", contentType: "text/html" })),
    });
    const found = await provider.backends[0].search!(ctx({ urls: [] }) as SearchContext, {
      text: "https://example.com/thing",
    });
    assert.equal(found.length, 1);
  });

  it("turns a policy refusal into a permanent failure, never a silent skip", async () => {
    const provider = createWebProvider({
      http: fakeHttp(() => {
        throw new (class extends Error {
          constructor() {
            super("Blocked outbound URL (blocked_address)");
          }
        })();
      }),
    });
    await assert.rejects(
      () => provider.backends[0].search!(ctx({ urls: ["http://169.254.169.254/latest/meta-data/"] }) as SearchContext, { text: "" }),
      (error: { failureClass?: string }) => error.failureClass === "permanent",
    );
  });
});

// ── HTTP guards ───────────────────────────────────────────────────────────────
describe("provider http guards", () => {
  it("rejects an over-long URL", () => {
    assert.throws(() => assertUrlLength(`https://x.test/${"a".repeat(3000)}`), UrlTooLongError);
    assertUrlLength("https://x.test/ok");
  });

  it("parses and enforces the content-type allowlist", () => {
    assert.equal(normalizeContentType("text/HTML; charset=utf-8"), "text/html");
    assert.equal(normalizeContentType(undefined), null);
    assertAllowedContentType("text/html", ["text/html"]);
    assertAllowedContentType(null, ["text/html"]);
    assert.throws(
      () => assertAllowedContentType("application/zip", ["text/html"]),
      DisallowedContentTypeError,
    );
  });
});

// ── Registry: capability availability is explicit ─────────────────────────────
describe("provider capability registry", () => {
  it("reports capabilities per provider and refuses unsupported ones", () => {
    resetProviderRegistry();
    registerProvider(createYoutubeProvider({ baseUrl: "https://yt.test", parseFeed: async () => ({ items: [] }) }));
    registerProvider(
      createHnProvider({ baseUrl: "https://hn.test", http: fakeHttp(() => ({ body: JSON.stringify({ hits: [] }) })) }),
    );
    const executor = new ProviderExecutor({ logSink: () => {} });

    assert.equal(executor.supportsCapability(YOUTUBE_PROVIDER_ID, "discover"), true);
    assert.equal(executor.supportsCapability(YOUTUBE_PROVIDER_ID, "fetch"), false, "metadata-only provider");
    assert.equal(executor.supportsCapability(HN_PROVIDER_ID, "search"), true);
    resetProviderRegistry();
  });

  it("deduplicates the same provider identity across a mixed-provider result set", () => {
    const base = {
      provider: REDDIT_PROVIDER_ID,
      backend: "reddit-json",
      providerVersion: "1.0.0",
      retrievalMethod: "api",
      accessClass: "open" as const,
      title: "t",
      author: null,
      publishedAt: null,
      retrievedAt: new Date().toISOString(),
      excerpt: "e",
      contentHash: "h",
      metadata: {},
    };
    const first = {
      ...base,
      ref: { provider: REDDIT_PROVIDER_ID, kind: "post", nativeId: "t3_same", canonicalUrl: "https://a.test/1" },
      canonicalUrl: "https://a.test/1",
      contentHash: "hash-first",
    };
    const again = {
      ...base,
      ref: { provider: REDDIT_PROVIDER_ID, kind: "post", nativeId: "t3_same", canonicalUrl: "https://a.test/2" },
      canonicalUrl: "https://a.test/2",
      contentHash: "hash-again",
    };
    const hn = {
      ...base,
      provider: HN_PROVIDER_ID,
      ref: { provider: HN_PROVIDER_ID, kind: "story", nativeId: "t3_same", canonicalUrl: "https://a.test/2" },
      canonicalUrl: "https://a.test/2",
      contentHash: "hash-hn",
    };

    // Same provider + native id collides even with a different URL; a different
    // provider with the same native id does not.
    const { kept, dropped } = dedupeSources([first, again, hn] as never);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].reason, "duplicate_ref");
    assert.equal(kept.length, 2);
  });
});

// ── Reddit credentialed seam (access class + bearer path) ─────────────────────
describe("reddit credentialed access class", () => {
  const listing = { data: { children: [{ data: { name: "t3_a", title: "T", permalink: "/r/x/comments/a/t/" } }] } };

  it("stays `open` with no authorization header when no token is configured", async () => {
    const seen: Record<string, string> = {};
    const provider = createRedditProvider({
      baseUrl: "https://reddit.test",
      credentials: null,
      http: fakeHttp((request) => {
        Object.assign(seen, request.headers ?? {});
        assert(request.url.startsWith("https://reddit.test/"), `url=${request.url}`);
        return { body: JSON.stringify(listing) };
      }),
    });
    assert.equal(provider.accessClass, "open");
    assert.equal(provider.backends[0].id, "reddit-json");
    const found = await provider.backends[0].discover!(ctx({ subreddits: ["x"] }));
    assert.equal(found[0].accessClass, "open");
    assert(seen.authorization === undefined, "no bearer header on the public path");
  });

  it("becomes `credentialed` and sends a bearer token to the oauth host", async () => {
    const requests: string[] = [];
    const seen: Record<string, string> = {};
    const provider = createRedditProvider({
      baseUrl: "https://reddit.test",
      credentials: { accessToken: "tok-123", oauthBaseUrl: "https://oauth.reddit.test" },
      http: fakeHttp((request) => {
        requests.push(request.url);
        Object.assign(seen, request.headers ?? {});
        return { body: JSON.stringify(listing) };
      }),
    });
    assert.equal(provider.accessClass, "credentialed");
    assert.equal(provider.backends[0].id, "reddit-oauth");
    const found = await provider.backends[0].discover!(ctx({ subreddits: ["x"] }));
    assert(requests.every((u) => u.startsWith("https://oauth.reddit.test/")), `urls=${requests.join()}`);
    assert.equal(seen.authorization, "Bearer tok-123");
    assert.equal(found[0].accessClass, "credentialed");
  });
});

describe("reddit credential resolution", () => {
  it("reads the token from the environment and defaults off", () => {
    assert.equal(resolveRedditCredentials({}), null);
    assert.equal(resolveRedditCredentials({ REDDIT_ACCESS_TOKEN: "   " }), null);
    const creds = resolveRedditCredentials({ REDDIT_ACCESS_TOKEN: "tok" })!;
    assert.equal(creds.accessToken, "tok");
    assert.equal(creds.oauthBaseUrl, "https://oauth.reddit.com");
  });
});
