/**
 * PostgreSQL proofs for YouTube OAuth → connected_accounts (Phase 28.1B).
 * Google HTTP boundary is a local double — never real OAuth in CI.
 *
 * Requires TEST_DATABASE_URL and DATABASE_URL (same pool as storage).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { connectedAccounts } from "@shared/schema";
import { storage } from "../storage";
import { db } from "../db";
import { isEncrypted } from "../middleware/crypto";
import {
  YOUTUBE_OAUTH_SCOPES,
  completeYouTubeOAuthConnection,
  getYouTubeConfig,
  getYouTubeConfigSummary,
} from "./youtube";

const CONNECTION = process.env.TEST_DATABASE_URL;
const SAME_DB = Boolean(
  CONNECTION
  && process.env.DATABASE_URL
  && CONNECTION === process.env.DATABASE_URL,
);
const describeDb = SAME_DB ? describe : describe.skip;
const OWNER = 9_028_101;
const RUN = `ytoauth${Date.now().toString(36)}`;

describeDb("YouTube OAuth connected_accounts (db)", () => {
  let server: http.Server;
  let base = "";
  let exchangeCount = 0;
  let channelCount = 0;
  let omitRefreshOnExchange = false;
  const saved: Record<string, string | undefined> = {};

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "POST" && url.pathname === "/token") {
        exchangeCount += 1;
        let raw = "";
        req.on("data", (c) => { raw += c; });
        req.on("end", () => {
          assert.ok(raw.includes("grant_type=authorization_code") || raw.includes("grant_type=refresh_token"));
          assert.ok(!raw.includes("1//secret"), "must not echo prior refresh into logs body unexpectedly");
          const body: Record<string, unknown> = {
            access_token: `ya29.${RUN}-access`,
            expires_in: 3600,
            scope: YOUTUBE_OAUTH_SCOPES.join(" "),
            token_type: "Bearer",
          };
          if (!omitRefreshOnExchange && raw.includes("authorization_code")) {
            body.refresh_token = `1//${RUN}-refresh`;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/youtube/v3/channels") {
        channelCount += 1;
        assert.equal(url.searchParams.get("mine"), "true");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          items: [{
            id: `UC${RUN}`,
            snippet: { title: `Channel ${RUN}`, customUrl: `@${RUN}` },
          }],
        }));
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    for (const key of [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "YOUTUBE_CLIENT_ID",
      "YOUTUBE_CLIENT_SECRET",
      "YOUTUBE_CALLBACK_URL",
      "YOUTUBE_TOKEN_URI",
      "YOUTUBE_API_BASE_URL",
      "YOUTUBE_ACCESS_TOKEN",
      "YOUTUBE_REFRESH_TOKEN",
    ]) {
      saved[key] = process.env[key];
    }
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.YOUTUBE_CALLBACK_URL = "http://localhost:5000/api/social/youtube/callback";
    process.env.YOUTUBE_TOKEN_URI = `${base}/token`;
    process.env.YOUTUBE_API_BASE_URL = `${base}/youtube/v3`;
    delete process.env.YOUTUBE_ACCESS_TOKEN;
    delete process.env.YOUTUBE_REFRESH_TOKEN;
  });

  after(async () => {
    await db.delete(connectedAccounts).where(and(
      eq(connectedAccounts.platform, "youtube"),
      eq(connectedAccounts.userId, OWNER),
    ));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("persists encrypted refresh token, channel identity, and scopes", async () => {
    exchangeCount = 0;
    channelCount = 0;
    omitRefreshOnExchange = false;

    const result = await completeYouTubeOAuthConnection(
      { code: "auth-code-1", ownerUserId: OWNER },
      { fetchImpl: fetch },
    );
    assert.equal(result.channelId, `UC${RUN}`);
    assert.equal(result.channelTitle, `Channel ${RUN}`);
    assert.equal(result.refreshTokenPersisted, true);
    assert.equal(exchangeCount, 1);
    assert.equal(channelCount, 1);

    const raw = await db.select().from(connectedAccounts).where(and(
      eq(connectedAccounts.platform, "youtube"),
      eq(connectedAccounts.userId, OWNER),
    ));
    assert.equal(raw.length, 1);
    assert.ok(raw[0]!.refreshToken && isEncrypted(raw[0]!.refreshToken), "refresh encrypted at rest");
    assert.ok(raw[0]!.accessToken && isEncrypted(raw[0]!.accessToken), "access encrypted at rest");
    assert.ok(!String(raw[0]!.refreshToken).includes("1//"), "ciphertext must not contain plaintext prefix");

    const decrypted = await storage.getConnectedAccountForOwner("youtube", OWNER);
    assert.ok(decrypted?.refreshToken?.startsWith("1//"));
    assert.equal(decrypted?.username, `UC${RUN}`);
    const profile = decrypted?.profileData as Record<string, unknown>;
    assert.equal(profile.channelId, `UC${RUN}`);
    assert.deepEqual(profile.scopes, [...YOUTUBE_OAUTH_SCOPES]);

    const config = await getYouTubeConfig(OWNER);
    assert.ok(config?.refreshToken?.startsWith("1//"));
    assert.equal(config?.accessToken, `ya29.${RUN}-access`);

    const summary = await getYouTubeConfigSummary(OWNER);
    assert.equal(summary.clientConfigured, true);
    assert.equal(summary.accountConnected, true);
    assert.equal(summary.refreshCredentialPresent, true);
    assert.equal(summary.channelDiscovered, true);
    assert.equal(summary.requiredScopesPresent, true);
    assert.equal(summary.publicationReady, true);
    assert.equal(summary.ready, true);
    assert.equal(summary.channelTitle, `Channel ${RUN}`);
  });

  it("preserves existing refresh token when Google omits a new one", async () => {
    omitRefreshOnExchange = true;
    const before = await storage.getConnectedAccountForOwner("youtube", OWNER);
    assert.ok(before?.refreshToken);

    const result = await completeYouTubeOAuthConnection(
      { code: "auth-code-2", ownerUserId: OWNER },
      { fetchImpl: fetch },
    );
    assert.equal(result.refreshTokenPersisted, true);
    const after = await storage.getConnectedAccountForOwner("youtube", OWNER);
    assert.equal(after?.refreshToken, before?.refreshToken);
  });

  it("isolates foreign owners", async () => {
    const foreign = await storage.getConnectedAccountForOwner("youtube", OWNER + 1);
    assert.equal(foreign, undefined);
    const summary = await getYouTubeConfigSummary(OWNER + 1);
    assert.equal(summary.accountConnected, false);
    assert.equal(summary.publicationReady, false);
    assert.equal(summary.ready, false);
  });
});
