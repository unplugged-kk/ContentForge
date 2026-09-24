import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { authGate } from "./middleware/authGate";
import { registerRoutes } from "./routes";
import { db, pool } from "./db";
import {
  aiUsageLog,
  articles,
  analytics,
  ideas,
  posts,
  references,
  tweets,
  users,
} from "@shared/schema";
import { storage } from "./storage";
import { checkYoutubeChannels } from "./youtubeConnector";
import { runRssAutopostForBatch } from "./rssAutopost";
import { and, eq } from "drizzle-orm";

let baseUrl = "";
let server: ReturnType<express.Application["listen"]>;
let ownerA: number;
let ownerB: number;
let ownerBAccountId: number | null = null;

async function requestFor(ownerId: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (ownerId != null) headers["x-test-user-id"] = String(ownerId);
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

describe("legacy route owner isolation (real HTTP + PostgreSQL)", () => {
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const testUser = req.header("x-test-user-id");
      if (testUser) req.session = { userId: Number(testUser) } as never;
      next();
    });
    app.use(authGate);

    const httpServer = createServer(app);
    await registerRoutes(httpServer, app);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    server = httpServer;
    const address = httpServer.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;

    const stamp = `${Date.now()}-${Math.random()}`;
    const [a, b] = await db.insert(users).values([
      { email: `phase331-a-${stamp}@example.test`, name: "Phase 33.1 A" },
      { email: `phase331-b-${stamp}@example.test`, name: "Phase 33.1 B" },
    ]).returning({ id: users.id });
    ownerA = a.id;
    ownerB = b.id;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(tweets).where(eq(tweets.userId, ownerB));
    await db.delete(posts).where(eq(posts.userId, ownerB));
    await db.delete(articles).where(eq(articles.userId, ownerB));
    await db.delete(ideas).where(eq(ideas.userId, ownerB));
    await db.delete(analytics).where(eq(analytics.userId, ownerB));
    await db.delete(references).where(eq(references.userId, ownerB));
    if (ownerBAccountId != null) {
      await storage.deleteConnectedAccount(ownerB, ownerBAccountId);
    }
    await db.delete(aiUsageLog).where(eq(aiUsageLog.feature, "x_analytics_sync"));
    await db.delete(users).where(eq(users.id, ownerA));
    await db.delete(users).where(eq(users.id, ownerB));
    await pool.end();
  });

  it("keeps Owner A, Owner B, and anonymous requests isolated across representative legacy models", async () => {
    const bPost = await requestFor(ownerB, "POST", "/api/posts", {
      postType: "tweet",
      targetPlatform: "x",
      status: "draft",
      tweets: [{ content: "Owner B private legacy post", position: 0 }],
    });
    assert.equal(bPost.status, 201);
    assert.equal(bPost.body.userId, ownerB);

    const bArticle = await requestFor(ownerB, "POST", "/api/articles", {
      title: "Owner B private article",
      contentJson: {},
      status: "draft",
    });
    assert.equal(bArticle.status, 201);
    assert.equal(bArticle.body.userId, ownerB);

    const bIdea = await requestFor(ownerB, "POST", "/api/ideas", { title: "Owner B private idea" });
    assert.equal(bIdea.status, 201);
    assert.equal(bIdea.body.userId, ownerB);

    const [bReference] = await db.insert(references).values({
      userId: ownerB,
      title: "Owner B private reference",
      sourceUrl: "https://example.test/b",
      analysisJson: {},
    }).returning({ id: references.id });

    const aPosts = await requestFor(ownerA, "GET", "/api/posts");
    assert.equal(aPosts.status, 200);
    assert.ok(!aPosts.body.some((post: any) => post.id === bPost.body.id));

    const aArticles = await requestFor(ownerA, "GET", "/api/articles");
    assert.equal(aArticles.status, 200);
    assert.ok(!aArticles.body.some((article: any) => article.id === bArticle.body.id));

    const aIdeas = await requestFor(ownerA, "GET", "/api/ideas");
    assert.equal(aIdeas.status, 200);
    assert.ok(!aIdeas.body.some((idea: any) => idea.id === bIdea.body.id));

    const aReferences = await requestFor(ownerA, "GET", "/api/references");
    assert.equal(aReferences.status, 200);
    assert.ok(!aReferences.body.some((reference: any) => reference.id === bReference.id));

    const aPostById = await requestFor(ownerA, "GET", `/api/posts/${bPost.body.id}`);
    assert.equal(aPostById.status, 404);

    const aPutForeign = await requestFor(ownerA, "PUT", `/api/posts/${bPost.body.id}`, { status: "ready" });
    assert.equal(aPutForeign.status, 404);

    const aDeleteForeign = await requestFor(ownerA, "DELETE", `/api/posts/${bPost.body.id}`);
    assert.equal(aDeleteForeign.status, 404);

    let providerRequests = 0;
    const providerServer = createServer((_req, res) => {
      providerRequests += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ public_metrics: { impression_count: 1 } }] }));
    });
    await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
    const providerAddress = providerServer.address();
    assert.ok(providerAddress && typeof providerAddress === "object");
    const previousBaseUrl = process.env.XQUIK_API_BASE_URL;
    const previousEndpoint = process.env.XQUIK_ANALYTICS_ENDPOINT;
    process.env.XQUIK_API_BASE_URL = `http://127.0.0.1:${(providerAddress as { port: number }).port}`;
    process.env.XQUIK_ANALYTICS_ENDPOINT = "/metrics";

    try {
      await db.update(posts)
        .set({
          status: "posted",
          postedAt: new Date(),
          externalIds: { x: ["owner-b-private-tweet"] },
        })
        .where(and(eq(posts.id, bPost.body.id), eq(posts.userId, ownerB)));
      const account = await storage.upsertConnectedAccount({
        platform: "x",
        userId: ownerB,
        username: "owner-b-x-account",
        displayName: "Owner B X account",
        accessToken: "owner-b-x-token",
        isActive: true,
      });
      ownerBAccountId = account.id;

      const aSyncForeign = await requestFor(ownerA, "POST", `/api/analytics/sync/x/${bPost.body.id}`);
      assert.deepEqual(
        { status: aSyncForeign.status, providerRequests },
        { status: 404, providerRequests: 0 },
      );

      const providerRequestsBeforeIngest = providerRequests;
      const aIngestWithForeignCredential = await requestFor(ownerA, "POST", "/api/ingest", {
        url: "https://x.com/i/status/123456789",
      });
      assert.deepEqual(
        {
          status: aIngestWithForeignCredential.status,
          providerRequests: providerRequests - providerRequestsBeforeIngest,
        },
        { status: 400, providerRequests: 0 },
      );
    } finally {
      await new Promise<void>((resolve, reject) => providerServer.close((error) => error ? reject(error) : resolve()));
      if (previousBaseUrl == null) delete process.env.XQUIK_API_BASE_URL;
      else process.env.XQUIK_API_BASE_URL = previousBaseUrl;
      if (previousEndpoint == null) delete process.env.XQUIK_ANALYTICS_ENDPOINT;
      else process.env.XQUIK_ANALYTICS_ENDPOINT = previousEndpoint;
    }

    const originalGetActiveYoutubeChannels = storage.getActiveYoutubeChannels;
    const observedYoutubeOwners: Array<number | undefined> = [];
    storage.getActiveYoutubeChannels = async (ownerUserId?: number) => {
      observedYoutubeOwners.push(ownerUserId);
      return [];
    };
    try {
      await (checkYoutubeChannels as (ownerUserId?: number) => Promise<void>)(ownerA);
      assert.deepEqual(observedYoutubeOwners, [ownerA]);
    } finally {
      storage.getActiveYoutubeChannels = originalGetActiveYoutubeChannels;
    }

    const originalGetRssSourcesWithAutopost = storage.getRssSourcesWithAutopost;
    const observedRssOwners: Array<number | undefined> = [];
    storage.getRssSourcesWithAutopost = async (ownerUserId?: number) => {
      observedRssOwners.push(ownerUserId);
      return [];
    };
    try {
      await runRssAutopostForBatch([], ownerA);
      assert.deepEqual(observedRssOwners, [ownerA]);
    } finally {
      storage.getRssSourcesWithAutopost = originalGetRssSourcesWithAutopost;
    }

    const bDeleteOwn = await requestFor(ownerB, "DELETE", `/api/ideas/${bIdea.body.id}`);
    assert.equal(bDeleteOwn.status, 204);

    const anonymous = await requestFor(null, "GET", "/api/posts");
    assert.equal(anonymous.status, 401);

    const aOwn = await requestFor(ownerA, "POST", "/api/posts", {
      ownerId: ownerB,
      postType: "tweet",
      targetPlatform: "x",
      status: "draft",
      tweets: [{ content: "Owner A own post", position: 0 }],
    });
    assert.equal(aOwn.status, 201);
    assert.equal(aOwn.body.userId, ownerA);

    const bReadA = await requestFor(ownerB, "GET", `/api/posts/${aOwn.body.id}`);
    assert.equal(bReadA.status, 404);
  });
});
