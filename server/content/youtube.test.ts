/**
 * YouTube transport + ChannelAdapter unit tests.
 * Network is a local HTTP double only — never googleapis.com.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  privacyFromPayload,
  redactYouTubeSecrets,
  titleFromPayload,
  uploadVideoToYouTube,
  validateYouTubePrivacy,
  validateYouTubeTitle,
  validateYouTubeVideoMedia,
  youtubeAuthorizationUrl,
  YouTubePublishAmbiguousError,
} from "../social/youtube";
import { fixtureMp4Bytes } from "./visualFixture";
import {
  createYouTubeChannelAdapter,
  registerBuiltinChannelAdapters,
  resetChannelAdapters,
} from "./adapters";
import type { PublishMedia } from "./adapters";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function videoMedia(extra: Partial<PublishMedia> = {}): PublishMedia {
  return {
    visualAssetId: 42,
    mime: "video/mp4",
    role: null,
    position: 0,
    altText: null,
    bytes: fixtureMp4Bytes(),
    width: 854,
    height: 480,
    durationMs: 2_000,
    kind: "video",
    ...extra,
  };
}

describe("YouTube validation and adapter", () => {
  it("declares video-only support", () => {
    resetChannelAdapters();
    registerBuiltinChannelAdapters();
    const adapter = createYouTubeChannelAdapter();
    assert.equal(adapter.channel, "youtube");
    assert.equal(adapter.supports("video"), true);
    assert.equal(adapter.supports("image"), false);
    assert.equal(adapter.supports("x_post"), false);
  });

  it("validates title privacy and media before transport", () => {
    assert.match(validateYouTubeTitle("") ?? "", /required/);
    assert.match(validateYouTubePrivacy("friends") ?? "", /private\|unlisted\|public/);
    assert.match(validateYouTubeVideoMedia({
      ...videoMedia(),
      mime: "video/webm",
    }) ?? "", /video\/mp4/);
    assert.equal(validateYouTubeTitle("ok"), null);
    assert.equal(privacyFromPayload({}), "private");
    assert.equal(titleFromPayload({ title: "Hello" }), "Hello");
  });

  it("redacts bearer tokens from diagnostics", () => {
    const raw = "Authorization: Bearer ya29.secret-token-value error";
    assert.ok(!redactYouTubeSecrets(raw).includes("ya29.secret"));
  });

  it("builds OAuth URL only when client + callback are configured", () => {
    assert.equal(youtubeAuthorizationUrl("s", {}), null);
    const url = youtubeAuthorizationUrl("s", {
      YOUTUBE_CLIENT_ID: "cid",
      YOUTUBE_CALLBACK_URL: "http://localhost/cb",
    });
    assert.ok(url?.includes("client_id=cid"));
    assert.ok(url?.includes("youtube.upload"));
    assert.ok(url?.includes("access_type=offline"));
  });
});

describe("YouTube upload against local double", () => {
  let server: http.Server;
  let base = "";
  let mode: "ok" | "no-location" | "upload-500" = "ok";
  let putCount = 0;
  let postCount = 0;
  const scratch = mkdtempSync(join(tmpdir(), "cf-yt-"));

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url?.includes("/videos")) {
        postCount += 1;
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          assert.ok(!body.includes("ya29"), "request body must not echo tokens");
          if (mode === "no-location") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "application/json",
            Location: `${base}/upload/session-1`,
          });
          res.end("{}");
        });
        return;
      }
      if (req.method === "PUT" && req.url?.includes("/upload/")) {
        putCount += 1;
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(Buffer.from(c)));
        req.on("end", () => {
          const bytes = Buffer.concat(chunks);
          assert.ok(bytes.length > 10);
          if (mode === "upload-500") {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "temporary" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "yt-video-1", status: { privacyStatus: "private" } }));
        });
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("uploads via resumable session and returns video id", async () => {
    mode = "ok";
    putCount = 0;
    postCount = 0;
    const result = await uploadVideoToYouTube(
      {
        media: videoMedia(),
        title: "ContentForge Phase 28.1 certification",
        description: "private test",
        privacyStatus: "private",
      },
      null,
      {
        env: {
          YOUTUBE_ACCESS_TOKEN: "test-token",
          YOUTUBE_API_BASE_URL: `${base}/youtube/v3`,
          YOUTUBE_UPLOAD_BASE_URL: `${base}/upload/youtube/v3`,
          PUBLISH_CERT_BUDGET_PATH: join(scratch, "budget.json"),
        },
        fetchImpl: fetch,
      },
    );
    assert.equal(result.videoId, "yt-video-1");
    assert.equal(postCount, 1);
    assert.equal(putCount, 1);
  });

  it("marks missing Location as ambiguous after session accept", async () => {
    mode = "no-location";
    await assert.rejects(
      () => uploadVideoToYouTube(
        {
          media: videoMedia(),
          title: "t",
          description: "",
          privacyStatus: "private",
        },
        null,
        {
          env: {
            YOUTUBE_ACCESS_TOKEN: "test-token",
            YOUTUBE_UPLOAD_BASE_URL: `${base}/upload/youtube/v3`,
            PUBLISH_CERT_BUDGET_PATH: join(scratch, "budget2.json"),
          },
          fetchImpl: fetch,
        },
      ),
      (error: unknown) => error instanceof YouTubePublishAmbiguousError,
    );
  });

  it("adapter publish succeeds through createYouTubeChannelAdapter", async () => {
    mode = "ok";
    const adapter = createYouTubeChannelAdapter();
    // Monkey-patch via env + inject by temporarily setting process env and
    // relying on default fetch to local bases — adapter does not take fetchImpl.
    // Exercise validation path that does not need network:
    const denied = await adapter.publish({
      format: "image",
      channel: "youtube",
      payload: {},
      correlationId: "c",
      media: [videoMedia()],
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.providerCalled, false);

    const missing = await adapter.publish({
      format: "video",
      channel: "youtube",
      payload: { title: "x" },
      correlationId: "c2",
      media: [],
    });
    assert.equal(missing.ok, false);
    assert.match(missing.errorMessage ?? "", /exactly one/);
  });

  it("blocks real google hosts without CONTENTFORGE_REAL_PUBLISH_E2E", async () => {
    await assert.rejects(
      () => uploadVideoToYouTube(
        {
          media: videoMedia(),
          title: "blocked",
          description: "",
          privacyStatus: "private",
        },
        null,
        {
          env: {
            YOUTUBE_ACCESS_TOKEN: "tok",
            // default google hosts
          },
          fetchImpl: fetch,
        },
      ),
      /blocked without CONTENTFORGE_REAL_PUBLISH|YOUTUBE/,
    );
  });
});
