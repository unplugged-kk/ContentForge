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
  INSTAGRAM_OAUTH_SCOPES,
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
    ...extra,
  };
}

function startInstagramDouble() {
  const containers = new Map<string, { caption: string; status: string; children?: string }>();
  const media = new Map<string, { caption: string; permalink: string }>();
  const listed: Array<{ id: string; caption: string; timestamp: string; permalink: string }> = [];
  const staged: string[] = [];
  let mode: "ok" | "drop-publish" | "500-publish" | "personal" | "in-progress" = "ok";
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
        seq += 1;
        const id = `c${seq}`;
        containers.set(id, {
          caption: body.get("caption") ?? "",
          status: mode === "in-progress" ? "IN_PROGRESS" : "FINISHED",
          children: body.get("children") ?? undefined,
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

  it("registers image and carousel only", () => {
    const adapter = createInstagramChannelAdapter();
    assert.equal(adapter.supports("image"), true);
    assert.equal(adapter.supports("carousel"), true);
    assert.equal(adapter.supports("x_post"), false);
    assert.equal(adapter.supports("x_thread"), false);
    assert.equal(channelSupportsFormat("instagram", "image"), true);
    assert.equal(channelSupportsFormat("instagram", "carousel"), true);
    assert.equal(channelSupportsFormat("instagram", "x_post"), false);
    assert.equal(channelSupportsFormat("instagram", "thumbnail"), false);
    assert.equal(formatChannelError("image", "instagram"), null);
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
      INSTAGRAM_MEDIA_STAGE_URL: process.env.INSTAGRAM_MEDIA_STAGE_URL,
    };
    process.env.INSTAGRAM_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.INSTAGRAM_API_VERSION = "v25.0";
    process.env.INSTAGRAM_ACCESS_TOKEN = "fixture-token";
    process.env.INSTAGRAM_USER_ID = "me";
    process.env.INSTAGRAM_TIMEOUT_MS = "2000";
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
});
