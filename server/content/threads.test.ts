/**
 * Threads transport + adapter unit tests. Network is a local HTTP double of
 * graph.threads.net/v1.0 only.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  buildCreateTextContainerBody,
  parseGraphId,
  parseThreadsInsights,
  postTextToThreads,
  redactThreadsSecrets,
  THREADS_OAUTH_SCOPES,
  THREADS_TEXT_LIMIT,
  threadsAuthorizationUrl,
  threadsTextWeight,
  ThreadsPublishAmbiguousError,
  unmappedThreadsMetrics,
  validateThreadsText,
} from "../social/threads";
import {
  classifyThreadsFailure,
  createThreadsChannelAdapter,
  channelSupportsFormat,
  registerBuiltinChannelAdapters,
} from "./adapters";
import { formatChannelError } from "./opportunity";

registerBuiltinChannelAdapters();

function startThreadsDouble() {
  const containers = new Map<string, { text: string; status: string }>();
  const media = new Map<string, { text: string; permalink: string }>();
  const listed: Array<{ id: string; text: string; timestamp: string; permalink: string }> = [];
  let mode: "ok" | "drop-create" | "drop-publish" | "500-publish" | "no-publish-id" = "ok";
  let seq = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const collect = (cb: (body: URLSearchParams) => void) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => cb(new URLSearchParams(raw)));
    };

    if (req.method === "GET" && url.pathname.endsWith("/me")) {
      if (url.searchParams.get("access_token")?.includes("secret-token")) {
        return send(200, { id: "user-1", username: "cf_test", name: "CF" });
      }
      return send(200, { id: "user-1", username: "cf_test" });
    }

    if (req.method === "POST" && url.pathname.endsWith("/threads") && !url.pathname.endsWith("/threads_publish")) {
      if (mode === "drop-create") {
        mode = "ok";
        req.destroy();
        return;
      }
      collect((body) => {
        seq += 1;
        const id = `c${seq}`;
        containers.set(id, { text: body.get("text") ?? "", status: "FINISHED" });
        send(200, { id });
      });
      return;
    }

    if (req.method === "POST" && url.pathname.endsWith("/threads_publish")) {
      if (mode === "drop-publish") {
        mode = "ok";
        req.destroy();
        return;
      }
      collect((body) => {
        const creationId = body.get("creation_id") ?? "";
        if (mode === "500-publish") {
          mode = "ok";
          return send(500, { error: { message: "upstream" } });
        }
        if (mode === "no-publish-id") {
          mode = "ok";
          return send(200, {});
        }
        seq += 1;
        const mediaId = `m${seq}`;
        const text = containers.get(creationId)?.text ?? "";
        media.set(mediaId, { text, permalink: `https://www.threads.net/post/${mediaId}` });
        listed.push({
          id: mediaId,
          text,
          timestamp: new Date().toISOString(),
          permalink: `https://www.threads.net/post/${mediaId}`,
        });
        if (containers.has(creationId)) containers.get(creationId)!.status = "PUBLISHED";
        send(200, { id: mediaId });
      });
      return;
    }

    if (req.method === "GET" && url.pathname.endsWith("/insights")) {
      const id = url.pathname.split("/")[2];
      if (!media.has(id) && !id.startsWith("m")) return send(404, { error: { message: "not found" } });
      return send(200, {
        data: [
          { name: "views", period: "lifetime", values: [{ value: 40 }] },
          { name: "likes", period: "lifetime", values: [{ value: 5 }] },
          { name: "replies", period: "lifetime", values: [{ value: 2 }] },
          { name: "reposts", period: "lifetime", values: [{ value: 1 }] },
          { name: "quotes", period: "lifetime", values: [{ value: 3 }] },
          { name: "shares", period: "lifetime", values: [{ value: 4 }] },
        ],
      });
    }

    if (req.method === "GET" && /\/v1\.0\/[^/]+\/threads$/.test(url.pathname)) {
      return send(200, { data: listed });
    }

    if (req.method === "GET") {
      const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
      if (containers.has(id)) {
        const c = containers.get(id)!;
        return send(200, { id, status: c.status });
      }
      if (media.has(id)) {
        const m = media.get(id)!;
        return send(200, { id, text: m.text, permalink: m.permalink });
      }
      return send(404, { error: { message: "not found" } });
    }

    send(404, { error: { message: "not found" } });
  });

  return {
    arm: (next: typeof mode) => {
      mode = next;
    },
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("threads text constraints", () => {
  it("weights ASCII 1:1 and emojis as UTF-8 bytes, never truncates", () => {
    assert.equal(threadsTextWeight("abc"), 3);
    assert.equal(threadsTextWeight("😀"), Buffer.byteLength("😀", "utf8"));
    assert.equal(validateThreadsText(""), "threads text is empty");
    assert.equal(validateThreadsText("ok"), null);
    const over = "x".repeat(THREADS_TEXT_LIMIT + 1);
    assert.match(String(validateThreadsText(over)), /exceeds 500/);
    assert.equal(over.length, THREADS_TEXT_LIMIT + 1);
  });

  it("builds a TEXT container body without media fields", () => {
    const body = buildCreateTextContainerBody("hello");
    assert.equal(body.get("media_type"), "TEXT");
    assert.equal(body.get("text"), "hello");
    assert.equal(body.get("image_url"), null);
  });

  it("parses Graph ids and insights, keeping quotes unmapped", () => {
    assert.equal(parseGraphId({ id: "1788" }), "1788");
    assert.equal(parseGraphId({}), null);
    const insights = parseThreadsInsights({
      data: [
        { name: "views", values: [{ value: 10 }] },
        { name: "quotes", values: [{ value: 2 }] },
        { name: "likes", values: [{ value: 1 }] },
      ],
    });
    assert.equal(insights.views, 10);
    assert.equal(insights.quotes, 2);
    assert.deepEqual(unmappedThreadsMetrics(insights), { quotes: 2 });
  });

  it("redacts access tokens and centralizes OAuth scopes", () => {
    assert.match(redactThreadsSecrets("access_token=abc.secret"), /\[redacted\]/);
    assert.doesNotMatch(redactThreadsSecrets("access_token=abc.secret"), /abc\.secret/);
    assert.deepEqual([...THREADS_OAUTH_SCOPES], [
      "threads_basic",
      "threads_content_publish",
      "threads_manage_insights",
    ]);
    process.env.THREADS_APP_ID = "111";
    process.env.THREADS_CALLBACK_URL = "http://localhost/cb";
    const url = threadsAuthorizationUrl("st");
    assert.match(String(url), /threads_basic/);
    assert.match(String(url), /threads_content_publish/);
    assert.match(String(url), /threads_manage_insights/);
    assert.doesNotMatch(String(url), /threads_read_replies/);
  });
});

describe("threads channel adapter registration", () => {
  it("registers text capability only", () => {
    const adapter = createThreadsChannelAdapter();
    assert.equal(adapter.channel, "threads");
    assert.equal(adapter.supports("x_post"), true);
    assert.equal(adapter.supports("linkedin_post"), true);
    assert.equal(adapter.supports("x_thread"), false);
    assert.equal(adapter.supports("image"), false);
    assert.equal(adapter.supports("carousel"), false);
    assert.equal(channelSupportsFormat("threads", "x_post"), true);
    assert.equal(channelSupportsFormat("threads", "image"), false);
    assert.equal(formatChannelError("x_post", "threads"), null);
    assert.match(String(formatChannelError("linkedin_post", "threads")), /cannot target channel/);
    assert.match(String(formatChannelError("x_thread", "threads")), /cannot target channel/);
  });

  it("classifies failures and refuses over-limit text without calling the provider", async () => {
    assert.equal(classifyThreadsFailure("THREADS_CONFIG_MISSING"), "policy_human");
    assert.equal(classifyThreadsFailure("429 rate limit"), "transient");
    assert.equal(classifyThreadsFailure("upstream 503"), "transient");
    assert.equal(classifyThreadsFailure("invalid media_type"), "permanent");
    const adapter = createThreadsChannelAdapter();
    const outcome = await adapter.publish({
      format: "x_post",
      channel: "threads",
      payload: { text: "z".repeat(501) },
      correlationId: "c",
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.equal(outcome.errorClass, "permanent");
  });

  it("refuses unsupported formats without invoking the transport", async () => {
    const adapter = createThreadsChannelAdapter();
    const outcome = await adapter.publish({
      format: "x_thread",
      channel: "threads",
      payload: { units: ["a", "b"] },
      correlationId: "c",
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
  });
});

describe("threads HTTP contract (local Graph double)", () => {
  const fixture = startThreadsDouble();
  let saved: Record<string, string | undefined> = {};

  before(async () => {
    const port = await fixture.start();
    saved = {
      THREADS_API_BASE_URL: process.env.THREADS_API_BASE_URL,
      THREADS_API_VERSION: process.env.THREADS_API_VERSION,
      THREADS_ACCESS_TOKEN: process.env.THREADS_ACCESS_TOKEN,
      THREADS_USER_ID: process.env.THREADS_USER_ID,
      THREADS_TIMEOUT_MS: process.env.THREADS_TIMEOUT_MS,
    };
    process.env.THREADS_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.THREADS_API_VERSION = "v1.0";
    process.env.THREADS_ACCESS_TOKEN = "fixture-token";
    process.env.THREADS_USER_ID = "me";
    process.env.THREADS_TIMEOUT_MS = "2000";
  });

  after(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fixture.stop();
  });

  it("creates a TEXT container then publishes and returns the media id", async () => {
    const result = await postTextToThreads("hello threads");
    assert.match(result.mediaId, /^m/);
    assert.match(result.creationId, /^c/);
  });

  it("classifies a dropped publish after container create as unknown (not a retryable clean fail)", async () => {
    fixture.arm("drop-publish");
    await assert.rejects(() => postTextToThreads("ambiguous after create"), ThreadsPublishAmbiguousError);
  });

  it("adapter publish + fetchMetrics normalize views→impressions and keep quotes unmapped", async () => {
    const adapter = createThreadsChannelAdapter();
    const published = await adapter.publish({
      format: "x_post",
      channel: "threads",
      payload: { text: "metrics probe" },
      correlationId: "c",
    });
    assert.equal(published.ok, true);
    assert.ok(published.externalId);
    const metrics = await adapter.fetchMetrics!({
      channel: "threads",
      externalId: published.externalId!,
      publicationId: 1,
      correlationId: "c",
    });
    assert.equal(metrics.ok, true);
    const by = Object.fromEntries(metrics.metrics.map((m) => [m.metric, m]));
    assert.equal(by.impressions.value, 40);
    assert.equal(by.likes.value, 5);
    assert.equal(by.replies.value, 2);
    assert.equal(by.shares.value, 4);
    assert.equal(metrics.unmapped?.quotes, 3);
    assert.equal(metrics.unmapped?.reposts, 1);
  });
});
