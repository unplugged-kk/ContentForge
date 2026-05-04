import { test, expect } from "@playwright/test";

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
