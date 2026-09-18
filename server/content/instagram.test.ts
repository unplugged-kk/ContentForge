/**
 * Instagram transport + adapter unit tests. Network is a local HTTP double of
 * graph.instagram.com/v25.0 only.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  buildCarouselParentBody,
  buildImageContainerBody,
  buildReelContainerBody,
  INSTAGRAM_OAUTH_SCOPES,
  INSTAGRAM_REEL_MAX_BYTES,
  instagramAuthorizationUrl,
  isJpegMime,
  isProfessionalAccountType,
  parseInstagramInsights,
  parseGraphId,
  postMediaToInstagram,
  redactInstagramSecrets,
  unmappedInstagramMetrics,
  validateInstagramCaption,
  validateInstagramPublishMedia,
  InstagramPublishAmbiguousError,
} from "../social/instagram";
import { fixtureMp4Bytes } from "./visualFixture";
import {
  classifyInstagramFailure,
  createInstagramChannelAdapter,
  channelSupportsFormat,
  registerBuiltinChannelAdapters,
} from "./adapters";
import { formatChannelError } from "./opportunity";
import type { PublishMedia } from "./adapters";

registerBuiltinChannelAdapters();

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpA/9k=",
  "base64",
);

function jpegMedia(position = 0, extra: Partial<PublishMedia> = {}): PublishMedia {
  return {
    visualAssetId: position + 1,
    mime: "image/jpeg",
    role: null,
    position,
    altText: null,
    bytes: JPEG,
    width: 1080,
    height: 1080,
    kind: "image",
    ...extra,
  };
}

function videoMedia(extra: Partial<PublishMedia> = {}): PublishMedia {
  return {
    visualAssetId: 99,
    mime: "video/mp4",
    role: null,
    position: 0,
    altText: null,
    bytes: fixtureMp4Bytes(),
    width: 1080,
    height: 1920,
    durationMs: 5_000,
    kind: "video",
    ...extra,
  };
}

type DoubleMode =
  | "ok"
  | "drop-publish"
  | "500-publish"
  | "personal"
  | "in-progress"
  | "error-container"
  | "expired-container"
  | "400-create"
  | "401-create"
  | "403-create"
  | "429-create";

function startInstagramDouble() {
  const containers = new Map<string, { caption: string; status: string; children?: string; mediaType?: string }>();
  const media = new Map<string, { caption: string; permalink: string }>();
  const listed: Array<{ id: string; caption: string; timestamp: string; permalink: string }> = [];
  const staged: string[] = [];
  const creates: URLSearchParams[] = [];
  let mode: DoubleMode = "ok";
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

    if (req.method === "POST" && url.pathname === "/stage") {
      let raw = Buffer.alloc(0);
      req.on("data", (c) => {
        raw = Buffer.concat([raw, c]);
      });
      req.on("end", () => {
        seq += 1;
        const id = `blob${seq}`;
        staged.push(id);
        send(200, { url: `http://127.0.0.1/ig-media/${id}`, bytes: raw.length });
      });
      return;
    }

    if (req.method === "GET" && url.pathname.endsWith("/me")) {
      if (mode === "personal") {
        return send(200, { id: "u1", username: "hobby", account_type: "PERSONAL" });
      }
      if (url.searchParams.get("access_token")?.includes("secret-token")) {
        return send(200, { id: "u1", username: "pro", account_type: "BUSINESS" });
      }
      return send(200, { id: "u1", username: "pro", account_type: "BUSINESS" });
    }

    if (req.method === "POST" && url.pathname.endsWith("/media") && !url.pathname.endsWith("/media_publish")) {
      collect((body) => {
        creates.push(body);
        if (mode === "400-create") {
          mode = "ok";
          return send(400, { error: { message: "invalid video" } });
        }
        if (mode === "401-create") {
          mode = "ok";
          return send(401, { error: { message: "invalid token" } });
        }
        if (mode === "403-create") {
          mode = "ok";
          return send(403, { error: { message: "ACCESS_DENIED" } });
        }
        if (mode === "429-create") {
          mode = "ok";
          return send(429, { error: { message: "rate limit" } });
        }
        seq += 1;
        const id = `c${seq}`;
        const status =
          mode === "in-progress"
            ? "IN_PROGRESS"
            : mode === "error-container"
              ? "ERROR"
              : mode === "expired-container"
                ? "EXPIRED"
                : "FINISHED";
        containers.set(id, {
          caption: body.get("caption") ?? "",
          status,
          children: body.get("children") ?? undefined,
          mediaType: body.get("media_type") ?? undefined,
        });
        send(200, { id });
      });
      return;
    }

    if (req.method === "POST" && url.pathname.endsWith("/media_publish")) {
      if (mode === "drop-publish") {
        mode = "ok";
        req.destroy();
        return;
      }
      collect((body) => {
        if (mode === "500-publish") {
          mode = "ok";
          return send(500, { error: { message: "temporary" } });
        }
        const creationId = body.get("creation_id") ?? "";
        seq += 1;
        const mediaId = `m${seq}`;
        const caption = containers.get(creationId)?.caption ?? "";
        media.set(mediaId, { caption, permalink: `https://www.instagram.com/p/${mediaId}/` });
        listed.push({
          id: mediaId,
          caption,
          timestamp: new Date().toISOString(),
          permalink: `https://www.instagram.com/p/${mediaId}/`,
        });
        if (containers.has(creationId)) containers.get(creationId)!.status = "PUBLISHED";
        send(200, { id: mediaId });
      });
      return;
    }

    if (req.method === "GET" && url.pathname.endsWith("/insights")) {
      return send(200, {
        data: [
          { name: "views", values: [{ value: 40 }] },
          { name: "likes", values: [{ value: 5 }] },
          { name: "comments", values: [{ value: 2 }] },
          { name: "saved", values: [{ value: 3 }] },
          { name: "shares", values: [{ value: 1 }] },
          { name: "reach", values: [{ value: 30 }] },
          { name: "total_interactions", values: [{ value: 11 }] },
        ],
      });
    }

    if (req.method === "GET" && /\/media$/.test(url.pathname)) {
      return send(200, { data: listed });
    }

    if (req.method === "GET") {
      const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
      if (containers.has(id)) {
        return send(200, { id, status_code: containers.get(id)!.status });
      }
      if (media.has(id)) {
        const m = media.get(id)!;
        return send(200, { id, caption: m.caption, permalink: m.permalink });
      }
    }

    send(404, { error: { message: "not found" } });
  });

  return {
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setMode: (next: typeof mode) => {
      mode = next;
    },
    listed,
    staged,
    creates,
  };
}

describe("instagram contract helpers", () => {
  it("rejects non-JPEG, incomplete carousels, and personal accounts", () => {
    assert.equal(isJpegMime("image/png"), false);
    assert.equal(isProfessionalAccountType("PERSONAL"), false);
    assert.equal(isProfessionalAccountType("BUSINESS"), true);
    assert.match(String(validateInstagramPublishMedia("image", [])), /exactly one/);
    assert.match(
      String(
        validateInstagramPublishMedia("carousel", [
          jpegMedia(0),
          { ...jpegMedia(2), position: 2 },
        ]),
      ),
      /contiguous/,
    );
    assert.match(String(validateInstagramPublishMedia("image", [jpegMedia(0, { mime: "image/png" })])), /JPEG/);
    assert.equal(validateInstagramCaption("ok"), null);
    assert.match(String(validateInstagramCaption("x".repeat(2201))), /2200/);
  });

  it("rejects invalid Reel MIME, dimensions, duration, and size without calling a provider", () => {
    assert.match(String(validateInstagramPublishMedia("video", [])), /exactly one/);
    assert.match(String(validateInstagramPublishMedia("video", [videoMedia({ mime: "video/webm" })])), /video\/mp4/);
    assert.match(String(validateInstagramPublishMedia("video", [videoMedia({ mime: "image/jpeg" })])), /video\/mp4/);
    assert.match(
      String(validateInstagramPublishMedia("video", [videoMedia({ width: 1920, height: 1080 })])),
      /9:16/,
    );
    assert.match(String(validateInstagramPublishMedia("video", [videoMedia({ durationMs: 1000 })])), /minimum/);
    assert.match(
      String(validateInstagramPublishMedia("video", [videoMedia({ durationMs: 16 * 60 * 1000 })])),
      /maximum/,
    );
    assert.match(
      String(validateInstagramPublishMedia("video", [videoMedia({ byteSize: INSTAGRAM_REEL_MAX_BYTES + 1 })])),
      /bytes/,
    );
    assert.match(String(validateInstagramPublishMedia("video", [videoMedia({ durationMs: null })])), /duration/);
    assert.equal(validateInstagramPublishMedia("video", [videoMedia()]), null);
  });

  it("builds image and carousel Graph bodies without tokens", () => {
    const image = buildImageContainerBody({ imageUrl: "https://example.com/a.jpg", caption: "hi", altText: "alt" });
    assert.equal(image.get("image_url"), "https://example.com/a.jpg");
    assert.equal(image.get("caption"), "hi");
    assert.equal(image.has("access_token"), false);
    const parent = buildCarouselParentBody(["c1", "c2"], "cap");
    assert.equal(parent.get("media_type"), "CAROUSEL");
    assert.equal(parent.get("children"), "c1,c2");
    assert.equal(parseGraphId({ id: "1788" }), "1788");
  });

  it("builds a Reel container with video_url and no cover", () => {
    const reel = buildReelContainerBody({ videoUrl: "https://example.com/v.mp4", caption: "reel" });
    assert.equal(reel.get("media_type"), "REELS");
    assert.equal(reel.get("video_url"), "https://example.com/v.mp4");
    assert.equal(reel.get("caption"), "reel");
    assert.equal(reel.has("cover_url"), false);
    assert.equal(reel.has("thumb_offset"), false);
    assert.equal(reel.has("access_token"), false);
  });

  it("maps insights without treating reach as impressions", () => {
    const parsed = parseInstagramInsights({
      data: [
        { name: "views", values: [{ value: 40 }] },
        { name: "reach", values: [{ value: 30 }] },
        { name: "saved", values: [{ value: 3 }] },
      ],
    });
    assert.equal(parsed.views, 40);
    assert.equal(parsed.reach, 30);
    const extra = unmappedInstagramMetrics(parsed);
    assert.equal(extra.reach, 30);
    assert.equal(extra.total_interactions, undefined);
  });

  it("redacts tokens and classifies failures", () => {
    assert.match(redactInstagramSecrets("access_token=IGQVJsecret&x=1"), /\[redacted\]/);
    assert.equal(classifyInstagramFailure("INSTAGRAM_CONFIG_MISSING"), "policy_human");
    assert.equal(classifyInstagramFailure("INSTAGRAM_ACCOUNT_UNSUPPORTED"), "policy_human");
    assert.equal(classifyInstagramFailure("429"), "transient");
    assert.equal(classifyInstagramFailure("bad jpeg"), "permanent");
  });

  it("registers image, carousel, and video (Reels) through the same adapter", () => {
    const adapter = createInstagramChannelAdapter();
    assert.equal(adapter.supports("image"), true);
    assert.equal(adapter.supports("carousel"), true);
    assert.equal(adapter.supports("video"), true);
    assert.equal(adapter.supports("x_post"), false);
    assert.equal(adapter.supports("x_thread"), false);
    assert.equal(channelSupportsFormat("instagram", "image"), true);
    assert.equal(channelSupportsFormat("instagram", "carousel"), true);
    assert.equal(channelSupportsFormat("instagram", "video"), true);
    assert.equal(channelSupportsFormat("instagram", "x_post"), false);
    assert.equal(channelSupportsFormat("instagram", "thumbnail"), false);
    assert.equal(formatChannelError("image", "instagram"), null);
    assert.equal(formatChannelError("video", "instagram"), null);
    assert.match(String(formatChannelError("x_post", "instagram")), /cannot target channel/);
  });

  it("builds an Instagram Login authorize URL from env", () => {
    const prevId = process.env.INSTAGRAM_APP_ID;
    const prevCb = process.env.INSTAGRAM_CALLBACK_URL;
    process.env.INSTAGRAM_APP_ID = "111";
    process.env.INSTAGRAM_CALLBACK_URL = "http://localhost/cb";
    const url = instagramAuthorizationUrl("st");
    assert.ok(url?.includes("instagram_business_content_publish"));
    assert.deepEqual([...INSTAGRAM_OAUTH_SCOPES], [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
    ]);
    if (prevId === undefined) delete process.env.INSTAGRAM_APP_ID;
    else process.env.INSTAGRAM_APP_ID = prevId;
    if (prevCb === undefined) delete process.env.INSTAGRAM_CALLBACK_URL;
    else process.env.INSTAGRAM_CALLBACK_URL = prevCb;
  });
});

describe("instagram HTTP double", () => {
  const fixture = startInstagramDouble();
  let saved: Record<string, string | undefined> = {};

  before(async () => {
    const port = await fixture.start();
    saved = {
      INSTAGRAM_API_BASE_URL: process.env.INSTAGRAM_API_BASE_URL,
      INSTAGRAM_API_VERSION: process.env.INSTAGRAM_API_VERSION,
      INSTAGRAM_ACCESS_TOKEN: process.env.INSTAGRAM_ACCESS_TOKEN,
      INSTAGRAM_USER_ID: process.env.INSTAGRAM_USER_ID,
      INSTAGRAM_TIMEOUT_MS: process.env.INSTAGRAM_TIMEOUT_MS,
      INSTAGRAM_CONTAINER_POLL_ATTEMPTS: process.env.INSTAGRAM_CONTAINER_POLL_ATTEMPTS,
      INSTAGRAM_CONTAINER_POLL_GAP_MS: process.env.INSTAGRAM_CONTAINER_POLL_GAP_MS,
      INSTAGRAM_MEDIA_STAGE_URL: process.env.INSTAGRAM_MEDIA_STAGE_URL,
    };
    process.env.INSTAGRAM_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.INSTAGRAM_API_VERSION = "v25.0";
    process.env.INSTAGRAM_ACCESS_TOKEN = "fixture-token";
    process.env.INSTAGRAM_USER_ID = "me";
    process.env.INSTAGRAM_TIMEOUT_MS = "2000";
    process.env.INSTAGRAM_CONTAINER_POLL_ATTEMPTS = "3";
    process.env.INSTAGRAM_CONTAINER_POLL_GAP_MS = "10";
    process.env.INSTAGRAM_MEDIA_STAGE_URL = `http://127.0.0.1:${port}/stage`;
  });

  after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fixture.stop();
  });

  it("publishes a single image through container then media_publish", async () => {
    const result = await postMediaToInstagram({
      format: "image",
      caption: "hello ig",
      media: [jpegMedia()],
    });
    assert.ok(result.mediaId.startsWith("m"));
    assert.ok(result.creationId.startsWith("c"));
    assert.equal(fixture.staged.length > 0, true);
  });

  it("publishes a carousel as children then parent", async () => {
    const result = await postMediaToInstagram({
      format: "carousel",
      caption: "slides",
      media: [jpegMedia(0), jpegMedia(1), jpegMedia(2)],
    });
    assert.ok(result.mediaId.startsWith("m"));
  });

  it("treats a dropped media_publish as unknown", async () => {
    fixture.setMode("drop-publish");
    await assert.rejects(
      () =>
        postMediaToInstagram({
          format: "image",
          caption: "drop-me",
          media: [jpegMedia()],
        }),
      InstagramPublishAmbiguousError,
    );
  });

  it("adapter fetchMetrics maps views to impressions and leaves reach unmapped", async () => {
    const adapter = createInstagramChannelAdapter();
    const published = await postMediaToInstagram({
      format: "image",
      caption: "metrics",
      media: [jpegMedia()],
    });
    const outcome = await adapter.fetchMetrics!({
      channel: "instagram",
      externalId: published.mediaId,
      publicationId: 1,
      correlationId: "c",
    });
    assert.equal(outcome.ok, true);
    const impressions = outcome.metrics.find((m) => m.metric === "impressions");
    assert.equal(impressions?.availability, "observed");
    assert.equal(impressions?.value, 40);
    const saves = outcome.metrics.find((m) => m.metric === "saves");
    assert.equal(saves?.value, 3);
    assert.equal(outcome.unmapped?.reach, 30);
  });

  it("rejects a personal account before publishing", async () => {
    fixture.setMode("personal");
    await assert.rejects(
      () =>
        postMediaToInstagram({
          format: "image",
          caption: "nope",
          media: [jpegMedia()],
        }),
      /INSTAGRAM_ACCOUNT_UNSUPPORTED/,
    );
    fixture.setMode("ok");
  });

  it("fails when no provider-fetchable URL can be issued", async () => {
    const prev = process.env.INSTAGRAM_MEDIA_STAGE_URL;
    delete process.env.INSTAGRAM_MEDIA_STAGE_URL;
    try {
      await assert.rejects(
        () => postMediaToInstagram({ format: "video", caption: "nourl", media: [videoMedia()] }),
        /INSTAGRAM_MEDIA_URL_MISSING/,
      );
    } finally {
      if (prev === undefined) delete process.env.INSTAGRAM_MEDIA_STAGE_URL;
      else process.env.INSTAGRAM_MEDIA_STAGE_URL = prev;
    }
  });

  it("publishes a Reel through REELS container then media_publish", async () => {
    const result = await postMediaToInstagram({
      format: "video",
      caption: "hello reel",
      media: [videoMedia()],
    });
    assert.ok(result.mediaId.startsWith("m"));
    assert.ok(result.creationId.startsWith("c"));
    const created = fixture.creates.find((b) => b.get("media_type") === "REELS");
    assert.ok(created);
    assert.ok(String(created?.get("video_url") ?? "").startsWith("http://127.0.0.1/ig-media/"));
    assert.equal(created?.has("cover_url"), false);
    assert.equal(created?.has("image_url"), false);
  });

  it("treats persistent IN_PROGRESS as unknown with a creationId hint", async () => {
    fixture.setMode("in-progress");
    try {
      await assert.rejects(
        () =>
          postMediaToInstagram({
            format: "video",
            caption: "still-processing",
            media: [videoMedia()],
          }),
        (error: unknown) => {
          assert.equal(error instanceof InstagramPublishAmbiguousError, true);
          const amb = error as InstagramPublishAmbiguousError;
          assert.ok(amb.hint.creationId);
          assert.match(amb.message, /IN_PROGRESS/);
          return true;
        },
      );
    } finally {
      fixture.setMode("ok");
    }
  });

  it("treats container ERROR and EXPIRED as confirmed failures", async () => {
    fixture.setMode("error-container");
    await assert.rejects(
      () => postMediaToInstagram({ format: "video", caption: "err", media: [videoMedia()] }),
      /status_code=ERROR/,
    );
    fixture.setMode("expired-container");
    await assert.rejects(
      () => postMediaToInstagram({ format: "video", caption: "exp", media: [videoMedia()] }),
      /status_code=EXPIRED/,
    );
    fixture.setMode("ok");
  });

  it("maps provider 400/401/403/429/5xx without assuming publication", async () => {
    fixture.setMode("400-create");
    await assert.rejects(
      () => postMediaToInstagram({ format: "video", caption: "bad", media: [videoMedia()] }),
      /400|invalid video/,
    );
    fixture.setMode("401-create");
    await assert.rejects(
      () => postMediaToInstagram({ format: "video", caption: "auth", media: [videoMedia()] }),
      /401|invalid token/,
    );
    fixture.setMode("403-create");
    await assert.rejects(
      () => postMediaToInstagram({ format: "video", caption: "deny", media: [videoMedia()] }),
      /ACCESS_DENIED|403/,
    );
    fixture.setMode("429-create");
    await assert.rejects(
      () => postMediaToInstagram({ format: "video", caption: "slow", media: [videoMedia()] }),
      /429|rate limit/,
    );
    fixture.setMode("500-publish");
    await assert.rejects(
      () => postMediaToInstagram({ format: "video", caption: "boom", media: [videoMedia()] }),
      InstagramPublishAmbiguousError,
    );
    fixture.setMode("ok");
  });

  it("adapter refuses invalid Reel media without invoking the provider", async () => {
    const adapter = createInstagramChannelAdapter();
    const outcome = await adapter.publish({
      format: "video",
      channel: "instagram",
      payload: { caption: "nope" },
      correlationId: "c",
      media: [videoMedia({ mime: "video/webm" })],
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.equal(outcome.errorClass, "permanent");
    assert.match(String(outcome.errorMessage), /video\/mp4/);
  });

  it("adapter refuses an over-long caption without truncating", async () => {
    const adapter = createInstagramChannelAdapter();
    const outcome = await adapter.publish({
      format: "video",
      channel: "instagram",
      payload: { caption: "x".repeat(2201) },
      correlationId: "c",
      media: [videoMedia()],
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.match(String(outcome.errorMessage), /2200/);
  });
});
