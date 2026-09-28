/**
 * Threads long-lived-token lifecycle: exchange, refresh, and expiry handling.
 * The token endpoints are a local HTTP double of graph.threads.com only.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  exchangeThreadsLongLivedToken,
  isThreadsTokenExpiring,
  parseThreadsTokenResponse,
  refreshThreadsLongLivedToken,
  THREADS_LONG_LIVED_TOKEN_TTL_SECONDS,
  THREADS_TOKEN_REFRESH_THRESHOLD_MS,
  threadsTokenExpiryFromNow,
} from "./threads";

describe("threads token lifecycle (pure)", () => {
  it("parses a token response and defaults a missing expires_in to 60 days", () => {
    assert.deepEqual(parseThreadsTokenResponse({ access_token: "abc", expires_in: 3600 }), {
      accessToken: "abc",
      expiresInSeconds: 3600,
    });
    assert.deepEqual(parseThreadsTokenResponse({ access_token: "abc" }), {
      accessToken: "abc",
      expiresInSeconds: THREADS_LONG_LIVED_TOKEN_TTL_SECONDS,
    });
    assert.equal(parseThreadsTokenResponse({}), null);
    assert.equal(parseThreadsTokenResponse(null), null);
  });

  it("flags only known, near expiries for refresh", () => {
    const now = Date.now();
    assert.equal(isThreadsTokenExpiring(null, now), false);
    assert.equal(isThreadsTokenExpiring(undefined, now), false);
    assert.equal(isThreadsTokenExpiring(new Date(now + THREADS_TOKEN_REFRESH_THRESHOLD_MS + 60_000), now), false);
    assert.equal(isThreadsTokenExpiring(new Date(now + THREADS_TOKEN_REFRESH_THRESHOLD_MS - 60_000), now), true);
    assert.equal(isThreadsTokenExpiring(new Date(now - 1_000), now), true);
    assert.equal(isThreadsTokenExpiring("not-a-date", now), false);
  });

  it("computes an expiry about 60 days out", () => {
    const days = (threadsTokenExpiryFromNow().getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 59.9 && days < 60.1, `got ${days} days`);
  });
});

function startTokenDouble() {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    seen.push(`${url.pathname}?${url.searchParams.toString()}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/access_token") {
      return send(200, { access_token: "long-lived", token_type: "bearer", expires_in: 5_184_000 });
    }
    if (url.pathname === "/refresh_access_token") {
      return send(200, { access_token: "refreshed", token_type: "bearer", expires_in: 5_184_000 });
    }
    return send(404, { error: { message: "not found" } });
  });
  return {
    seen,
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("threads token endpoints (local double)", () => {
  const dbl = startTokenDouble();
  let saved: Record<string, string | undefined> = {};

  before(async () => {
    const port = await dbl.start();
    saved = {
      THREADS_OAUTH_HOST: process.env.THREADS_OAUTH_HOST,
      THREADS_APP_SECRET: process.env.THREADS_APP_SECRET,
    };
    process.env.THREADS_OAUTH_HOST = `http://127.0.0.1:${port}`;
    process.env.THREADS_APP_SECRET = "secret";
  });

  after(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await dbl.stop();
  });

  it("exchanges a short-lived token with grant_type=th_exchange_token", async () => {
    const token = await exchangeThreadsLongLivedToken("short");
    assert.equal(token.accessToken, "long-lived");
    const url = dbl.seen.at(-1) ?? "";
    assert.match(url, /grant_type=th_exchange_token/);
    assert.match(url, /client_secret=secret/);
    assert.match(url, /access_token=short/);
  });

  it("refreshes a long-lived token with grant_type=th_refresh_token", async () => {
    const token = await refreshThreadsLongLivedToken("old");
    assert.equal(token.accessToken, "refreshed");
    assert.match(dbl.seen.at(-1) ?? "", /grant_type=th_refresh_token/);
  });

  it("requires THREADS_APP_SECRET to exchange", async () => {
    const prev = process.env.THREADS_APP_SECRET;
    delete process.env.THREADS_APP_SECRET;
    await assert.rejects(() => exchangeThreadsLongLivedToken("short"), /THREADS_APP_SECRET_MISSING/);
    if (prev !== undefined) process.env.THREADS_APP_SECRET = prev;
  });
});
