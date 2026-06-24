import { test, expect } from "@playwright/test";

// Inline copy for unit testing — source of truth is server/utils/threadUtils.ts
function addThreadNumbering(tweets: string[]): string[] {
  if (tweets.length <= 1) return tweets;
  const total = tweets.length;
  return tweets.map((text, i) => {
    const trimmed = text.trim();
    if (/\n\n\d+\/\d+\s*$/.test(trimmed)) return trimmed;
    const num = `${i + 1}/${total}`;
    const withNum = `${trimmed}\n\n${num}`;
    if (withNum.length <= 280) return withNum;
    const maxBody = 280 - num.length - 2;
    return `${trimmed.slice(0, maxBody)}\n\n${num}`;
  });
}

test.describe("HTTP API (no session)", () => {
  test("GET /api/auth/me without cookie returns 401", async ({ request }) => {
    const res = await request.get("/api/auth/me");
    expect(res.status()).toBe(401);
  });

  test("GET /api/pillars returns pillars array", async ({ request }) => {
    const res = await request.get("/api/pillars");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    expect(body.length).toBeGreaterThan(0);
  });

  test("GET /api/posts returns posts array", async ({ request }) => {
    const res = await request.get("/api/posts");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test("GET /api/autopilot/market-pulse returns pulse shape", async ({ request }) => {
    test.setTimeout(90_000);
    const res = await request.get("/api/autopilot/market-pulse");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("breakingTopics");
    expect(body).toHaveProperty("trendingKeywords");
    expect(body).toHaveProperty("boostTopics");
    expect(body).toHaveProperty("xAlgorithmContext");
    expect(body).toHaveProperty("fetchedAt");
    expect(Array.isArray(body.breakingTopics)).toBeTruthy();
  });
});

// ── addThreadNumbering unit tests ─────────────────────────────────────────────
test.describe("addThreadNumbering utility", () => {
  test("single tweet is returned unchanged", () => {
    const result = addThreadNumbering(["Hello world"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Hello world");
  });

  test("multi-tweet thread gets N/total suffixes", () => {
    const tweets = ["Tweet one", "Tweet two", "Tweet three"];
    const result = addThreadNumbering(tweets);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatch(/\n\n1\/3$/);
    expect(result[1]).toMatch(/\n\n2\/3$/);
    expect(result[2]).toMatch(/\n\n3\/3$/);
  });

  test("already-numbered tweet is not double-numbered", () => {
    const tweets = ["First tweet\n\n1/2", "Second tweet\n\n2/2"];
    const result = addThreadNumbering(tweets);
    expect(result[0]).toBe("First tweet\n\n1/2");
    expect(result[1]).toBe("Second tweet\n\n2/2");
  });

  test("tweet body is trimmed if numbering would exceed 280 chars", () => {
    const longTweet = "A".repeat(278);
    const result = addThreadNumbering([longTweet, "Second tweet"]);
    expect(result[0].length).toBeLessThanOrEqual(280);
    expect(result[0]).toMatch(/\n\n1\/2$/);
  });

  test("empty array returns empty array", () => {
    expect(addThreadNumbering([])).toEqual([]);
  });
});

// ── Thread finisher + draft creation ─────────────────────────────────────────
test.describe("Thread draft creation", () => {
  test("POST /api/posts creates a multi-tweet thread draft", async ({ request }) => {
    const createRes = await request.post("/api/posts", {
      data: {
        postType: "thread",
        tone: "educational",
        targetPlatform: "x",
        status: "draft",
        tweets: [
          { content: "Tweet 1 content about DevOps", position: 0, charCount: 27 },
          { content: "Tweet 2 content about Kubernetes", position: 1, charCount: 31 },
          { content: "Tweet 3 content about MLOps", position: 2, charCount: 26 },
        ],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const post = await createRes.json();
    expect(post.id).toBeDefined();
    expect(post.tweets).toHaveLength(3);
    await request.delete(`/api/posts/${post.id}`);
  });

  test("POST /api/posts creates a single tweet draft", async ({ request }) => {
    const createRes = await request.post("/api/posts", {
      data: {
        postType: "tweet",
        targetPlatform: "x",
        status: "draft",
        tweets: [{ content: "Single tweet test", position: 0, charCount: 17 }],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const post = await createRes.json();
    expect(post.tweets).toHaveLength(1);
    await request.delete(`/api/posts/${post.id}`);
  });
});

test.describe("YouTube to Post API", () => {
  test("POST /api/youtube/extract with valid URL returns video info", async ({ request }) => {
    const res = await request.post("/api/youtube/extract", {
      data: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.videoId).toBe("dQw4w9WgXcQ");
    expect(body.title).toBeDefined();
    expect(body.thumbnailUrl).toContain("dQw4w9WgXcQ");
  });

  test("POST /api/youtube/extract with missing URL returns 400", async ({ request }) => {
    const res = await request.post("/api/youtube/extract", { data: {} });
    expect(res.status()).toBe(400);
  });

  test("POST /api/youtube/extract with invalid URL returns 400", async ({ request }) => {
    const res = await request.post("/api/youtube/extract", {
      data: { url: "https://example.com/not-a-youtube-url" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/youtube/generate-post returns tweets array", async ({ request }) => {
    test.setTimeout(90_000);
    const res = await request.post("/api/youtube/generate-post", {
      data: {
        videoId: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        author: "Rick Astley",
        platform: "x",
        tone: "educational",
        postType: "tweet",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.tweets)).toBeTruthy();
    expect(body.tweets.length).toBeGreaterThan(0);
    expect(body.tweets[0].content).toBeDefined();
  });
});

test.describe("X Article publish safeguards", () => {
  test("GET /api/social/x/status exposes xQuick provider config shape", async ({ request }) => {
    const res = await request.get("/api/social/x/status");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.provider).toBe("xquick");
    expect(body.postEndpoint).toBe("/x/tweets");
    expect(body).toHaveProperty("hasXQuickApiKey");
    expect(body).toHaveProperty("hasXQuickAccount");
    expect(body).toHaveProperty("canAttemptPost");
  });

  test("GET /api/articles-publish-capability returns explicit capability shape", async ({ request }) => {
    const res = await request.get("/api/articles-publish-capability");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("canPublish");
    expect(body).toHaveProperty("reason");
    expect(body).toHaveProperty("docsUrl");
    expect(typeof body.canPublish).toBe("boolean");
  });

  test("POST /api/articles/:id/publish returns explicit fallback when unavailable", async ({ request }) => {
    const createRes = await request.post("/api/articles", {
      data: {
        title: "Article publish safeguard test",
        contentMarkdown: "This is a draft article body.",
        status: "draft",
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const article = await createRes.json();

    const publishRes = await request.post(`/api/articles/${article.id}/publish`);
    expect([200, 501]).toContain(publishRes.status());
    const body = await publishRes.json();
    if (publishRes.status() === 501) {
      expect(body).toHaveProperty("docsUrl");
      expect(body).toHaveProperty("fallback");
    }

    await request.delete(`/api/articles/${article.id}`);
  });
});

// ── Feature 2: Brand profile / Second Brain ───────────────────────────────────
test.describe("Brand profile / Second Brain", () => {
  test("GET /api/profile/memory returns profile shape", async ({ request }) => {
    const res = await request.get("/api/profile/memory");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("brandVoice");
    expect(body).toHaveProperty("niche");
    expect(body).toHaveProperty("audienceDescription");
    expect(body).toHaveProperty("messagingPillars");
    expect(Array.isArray(body.messagingPillars)).toBeTruthy();
  });

  test("PUT /api/profile/memory saves and returns updated profile", async ({ request }) => {
    const res = await request.put("/api/profile/memory", {
      data: {
        niche: "DevOps & AI Infrastructure",
        brandVoice: "Technical, direct, no fluff",
        messagingPillars: ["Kubernetes cost", "AI for SRE"],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.niche).toBe("DevOps & AI Infrastructure");
    expect(Array.isArray(body.messagingPillars)).toBeTruthy();
    expect(body.messagingPillars).toContain("Kubernetes cost");
  });

  test("GET /api/profile/memory/preview-prompt returns non-empty string", async ({ request }) => {
    const res = await request.get("/api/profile/memory/preview-prompt");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.prompt).toBe("string");
    expect(body.prompt.length).toBeGreaterThan(100);
  });
});

// ── Feature 4: RSS Autoposting ────────────────────────────────────────────────
test.describe.serial("RSS Autoposting", () => {
  let sourceId: number;

  test("POST /api/discover/sources/rss creates a source", async ({ request }) => {
    const res = await request.post("/api/discover/sources/rss", {
      data: { name: "Test RSS Autopost", feedUrl: "https://hnrss.org/newest", category: "tech" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    sourceId = body.id;
    expect(body.id).toBeDefined();
  });

  test("PATCH /api/discover/rss-sources/:id/autopost enables autopost", async ({ request }) => {
    const res = await request.patch(`/api/discover/rss-sources/${sourceId}/autopost`, {
      data: { autopost: true, autopostPlatform: "x", autopostTone: "educational", autopostPostType: "thread" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.autopost).toBe(true);
  });

  test("PATCH /api/discover/rss-sources/:id/autopost disables autopost and cleans up", async ({ request }) => {
    const res = await request.patch(`/api/discover/rss-sources/${sourceId}/autopost`, {
      data: { autopost: false },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.autopost).toBe(false);
    await request.delete(`/api/discover/sources/${sourceId}`);
  });
});

// ── Feature 5: Canned Responses CRUD ─────────────────────────────────────────
test.describe.serial("Canned Responses CRUD", () => {
  let responseId: number;

  test("POST /api/canned-responses creates a response", async ({ request }) => {
    const res = await request.post("/api/canned-responses", {
      data: { title: "Thank you reply", content: "Thanks for the kind words!", category: "gratitude" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    responseId = body.id;
    expect(body.title).toBe("Thank you reply");
    expect(body.usageCount).toBe(0);
  });

  test("GET /api/canned-responses returns array including created", async ({ request }) => {
    const res = await request.get("/api/canned-responses");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    expect(body.find((r: any) => r.id === responseId)).toBeDefined();
  });

  test("POST /api/canned-responses/:id/use increments usage count", async ({ request }) => {
    const res = await request.post(`/api/canned-responses/${responseId}/use`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.usageCount).toBe(1);
  });

  test("DELETE /api/canned-responses/:id removes the response", async ({ request }) => {
    const delRes = await request.delete(`/api/canned-responses/${responseId}`);
    expect(delRes.ok()).toBeTruthy();
    const check = await request.get("/api/canned-responses");
    const body = await check.json();
    expect(body.find((r: any) => r.id === responseId)).toBeUndefined();
  });
});

// ── Feature 7: YouTube Channel Connector ─────────────────────────────────────
test.describe("YouTube Channel Connector", () => {
  test("GET /api/youtube/channels returns array", async ({ request }) => {
    const res = await request.get("/api/youtube/channels");
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray(await res.json())).toBeTruthy();
  });

  test("POST /api/youtube/channels with invalid URL returns 400", async ({ request }) => {
    const res = await request.post("/api/youtube/channels", {
      data: { channelUrl: "not-a-youtube-url" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/youtube/channels with valid channel URL creates or 400s gracefully", async ({ request }) => {
    const res = await request.post("/api/youtube/channels", {
      data: { channelUrl: "https://www.youtube.com/@MrBeast" },
    });
    if (res.ok()) {
      const body = await res.json();
      expect(body.channelId).toBeDefined();
      expect(body.channelName).toBeDefined();
      await request.delete(`/api/youtube/channels/${body.id}`);
    }
    expect([200, 201, 400, 500]).toContain(res.status());
  });
});

// ── Feature 8: Analytics Insights ────────────────────────────────────────────
test.describe("Analytics Insights", () => {
  test("GET /api/analytics/insights returns expected shape", async ({ request }) => {
    const res = await request.get("/api/analytics/insights");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("topPosts");
    expect(body).toHaveProperty("bestHours");
    expect(body).toHaveProperty("pillarStats");
    expect(Array.isArray(body.topPosts)).toBeTruthy();
    expect(Array.isArray(body.bestHours)).toBeTruthy();
    expect(Array.isArray(body.pillarStats)).toBeTruthy();
  });
});

// ── X API cost optimisation ───────────────────────────────────────────────────
test.describe("X API cost optimisation", () => {
  test("POST /api/analytics/sync/x accepts days param and defaults to 7", async ({ request }) => {
    const res = await request.post("/api/analytics/sync/x", { data: {} });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.days).toBe(7);
  });

  test("POST /api/analytics/sync/x respects custom days param (capped at 30)", async ({ request }) => {
    const res = await request.post("/api/analytics/sync/x", { data: { days: 14 } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.days).toBe(14);
  });

  test("POST /api/analytics/sync/x caps days at 30", async ({ request }) => {
    const res = await request.post("/api/analytics/sync/x", { data: { days: 999 } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.days).toBe(30);
  });

  test("GET /api/analytics/x-usage returns budget shape", async ({ request }) => {
    const res = await request.get("/api/analytics/x-usage");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("readsThisMonth");
    expect(body).toHaveProperty("readsToday");
    expect(body).toHaveProperty("monthlyLimit");
    expect(body).toHaveProperty("warnThreshold");
    expect(body).toHaveProperty("percentUsed");
    expect(body).toHaveProperty("nearLimit");
    expect(body).toHaveProperty("period");
    expect(typeof body.readsThisMonth).toBe("number");
    expect(typeof body.nearLimit).toBe("boolean");
    expect(body.monthlyLimit).toBe(10_000);
  });
});
