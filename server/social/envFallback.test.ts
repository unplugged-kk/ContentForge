import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isEnvCredentialFallbackAllowed } from "./envFallback";
import { postContentToX } from "./x";
import { postTextToThreads } from "./threads";
import { postMediaToInstagram } from "./instagram";
import { postTextToLinkedIn } from "./linkedin";
import { getYouTubeConfig } from "./youtube";
import { stubConnectedAccountLookup, type CredentialStubHandle } from "../testing/unitCredentialStub";

function saveEnv(keys: readonly string[]): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("isEnvCredentialFallbackAllowed", () => {
  it("allows unowned calls for legacy single-transport compatibility", () => {
    assert.equal(isEnvCredentialFallbackAllowed(null, { env: {} }), true);
    assert.equal(isEnvCredentialFallbackAllowed(undefined, { env: {} }), true);
  });

  it("denies owned calls by default when no opt-in flag is set", () => {
    assert.equal(isEnvCredentialFallbackAllowed(42, { env: {} }), false);
    assert.equal(isEnvCredentialFallbackAllowed(1, { env: { ALLOW_ENV_CHANNEL_FALLBACK: "0" } }), false);
  });

  it("admits owned calls when ALLOW_ENV_CHANNEL_FALLBACK=1 and SINGLE_OPERATOR_OWNER_ID is unset or matches", () => {
    assert.equal(
      isEnvCredentialFallbackAllowed(42, { env: { ALLOW_ENV_CHANNEL_FALLBACK: "1" } }),
      true,
    );
    assert.equal(
      isEnvCredentialFallbackAllowed(1, {
        env: { ALLOW_ENV_CHANNEL_FALLBACK: "1", SINGLE_OPERATOR_OWNER_ID: "1" },
      }),
      true,
    );
    assert.equal(
      isEnvCredentialFallbackAllowed(42, {
        env: { ALLOW_ENV_CHANNEL_FALLBACK: "1", SINGLE_OPERATOR_OWNER_ID: "1" },
      }),
      false,
    );
    assert.equal(
      isEnvCredentialFallbackAllowed(1, {
        env: { ALLOW_ENV_CHANNEL_FALLBACK: "1", SINGLE_OPERATOR_OWNER_ID: "not-a-number" },
      }),
      false,
    );
  });

  it("honors ALLOW_ENV_XQUICK_FALLBACK only when the X alias option is enabled", () => {
    const env = { ALLOW_ENV_XQUICK_FALLBACK: "1", SINGLE_OPERATOR_OWNER_ID: "1" };
    assert.equal(isEnvCredentialFallbackAllowed(1, { env }), false);
    assert.equal(isEnvCredentialFallbackAllowed(1, { env, allowLegacyXQuickAlias: true }), true);
    assert.equal(isEnvCredentialFallbackAllowed(42, { env, allowLegacyXQuickAlias: true }), false);
  });
});

describe("social transports fail closed for authenticated owners without connected accounts", () => {
  let credentials: CredentialStubHandle;
  let server: ReturnType<typeof createServer>;
  let baseUrl = "";
  let requests = 0;

  const ENV_KEYS = [
    "ALLOW_ENV_CHANNEL_FALLBACK",
    "ALLOW_ENV_XQUICK_FALLBACK",
    "SINGLE_OPERATOR_OWNER_ID",
    "XQUIK_API_BASE_URL",
    "XQUIK_API_KEY",
    "XQUIK_ACCOUNT",
    "THREADS_API_BASE_URL",
    "THREADS_ACCESS_TOKEN",
    "THREADS_USER_ID",
    "INSTAGRAM_API_BASE_URL",
    "INSTAGRAM_ACCESS_TOKEN",
    "INSTAGRAM_USER_ID",
    "INSTAGRAM_MEDIA_STAGE_URL",
    "LINKEDIN_API_BASE_URL",
    "LINKEDIN_ACCESS_TOKEN",
    "LINKEDIN_AUTHOR_URN",
    "YOUTUBE_ACCESS_TOKEN",
    "YOUTUBE_REFRESH_TOKEN",
  ] as const;

  let saved: Record<string, string | undefined> = {};

  before(async () => {
    credentials = stubConnectedAccountLookup();
    server = createServer((req, res) => {
      requests += 1;
      const url = req.url ?? "";
      if (url.startsWith("/x/tweets")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ tweetId: `tw-${requests}`, username: "env_x" }));
        return;
      }
      if (url.includes("/threads_publish")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `th-pub-${requests}` }));
        return;
      }
      if (url.includes("/threads")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `th-cont-${requests}` }));
        return;
      }
      if (url.includes("/me?")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "ig-1", username: "env_ig", account_type: "BUSINESS" }));
        return;
      }
      if (url.includes("/media_publish")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `ig-pub-${requests}` }));
        return;
      }
      if (url.includes("/media")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `ig-cont-${requests}` }));
        return;
      }
      if (url.startsWith("/rest/posts")) {
        res.writeHead(201, { "x-restli-id": `urn:li:share:${requests}` });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `ok-${requests}` }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    saved = saveEnv(ENV_KEYS);
    delete process.env.ALLOW_ENV_CHANNEL_FALLBACK;
    delete process.env.ALLOW_ENV_XQUICK_FALLBACK;
    delete process.env.SINGLE_OPERATOR_OWNER_ID;
    process.env.XQUIK_API_BASE_URL = baseUrl;
    process.env.XQUIK_API_KEY = "env-x-key";
    process.env.XQUIK_ACCOUNT = "env_x";
    process.env.THREADS_API_BASE_URL = baseUrl;
    process.env.THREADS_ACCESS_TOKEN = "env-threads-token";
    process.env.THREADS_USER_ID = "me";
    process.env.INSTAGRAM_API_BASE_URL = baseUrl;
    process.env.INSTAGRAM_ACCESS_TOKEN = "env-ig-token";
    process.env.INSTAGRAM_USER_ID = "me";
    process.env.LINKEDIN_API_BASE_URL = baseUrl;
    process.env.LINKEDIN_ACCESS_TOKEN = "env-li-token";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:env";
    process.env.YOUTUBE_ACCESS_TOKEN = "env-yt-token";
  });

  after(async () => {
    restoreEnv(saved);
    credentials.restore();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("refuses deployment env credentials for owner 42 across all 5 transports by default", async () => {
    const beforeRequests = requests;

    await assert.rejects(() => postContentToX(["hello"], { ownerUserId: 42 }), /XQUICK_CONFIG_MISSING/);
    await assert.rejects(() => postTextToThreads("hello", 42), /THREADS_CONFIG_MISSING/);
    await assert.rejects(
      () =>
        postMediaToInstagram(
          {
            format: "image",
            caption: "hi",
            media: [
              {
                assetId: 1,
                bytes: jpegBytes,
                mime: "image/jpeg",
                position: 0,
                width: 800,
                height: 800,
                providerFetchUrl: "https://cdn.example/a.jpg",
              },
            ],
          },
          42,
        ),
      /INSTAGRAM_CONFIG_MISSING/,
    );
    await assert.rejects(() => postTextToLinkedIn("hello", 42), /LINKEDIN_CONFIG_MISSING/);
    assert.equal(await getYouTubeConfig(42), null);

    assert.equal(requests, beforeRequests, "fail-closed transports make zero outbound provider requests");
  });

  it("admits SINGLE_OPERATOR_OWNER_ID=1 when ALLOW_ENV_CHANNEL_FALLBACK=1 and still rejects owner 42", async () => {
    process.env.ALLOW_ENV_CHANNEL_FALLBACK = "1";
    process.env.SINGLE_OPERATOR_OWNER_ID = "1";
    try {
      const xRes = await postContentToX(["operator post"], { ownerUserId: 1 });
      assert.equal(xRes.tweetIds.length, 1);
      await assert.rejects(() => postContentToX(["foreign post"], { ownerUserId: 42 }), /XQUICK_CONFIG_MISSING/);

      const thRes = await postTextToThreads("operator threads", 1);
      assert.match(thRes.mediaId, /^th-pub-/);
      await assert.rejects(() => postTextToThreads("foreign threads", 42), /THREADS_CONFIG_MISSING/);

      const liRes = await postTextToLinkedIn("operator li", 1);
      assert.match(liRes.postUrn, /^urn:li:share:/);
      await assert.rejects(() => postTextToLinkedIn("foreign li", 42), /LINKEDIN_CONFIG_MISSING/);

      const igRes = await postMediaToInstagram(
        {
          format: "image",
          caption: "operator ig",
          media: [
            {
              assetId: 1,
              bytes: jpegBytes,
              mime: "image/jpeg",
              position: 0,
              width: 800,
              height: 800,
              providerFetchUrl: "https://cdn.example/a.jpg",
            },
          ],
        },
        1,
      );
      assert.match(igRes.mediaId, /^ig-pub-/);
      await assert.rejects(
        () =>
          postMediaToInstagram(
            {
              format: "image",
              caption: "foreign ig",
              media: [
                {
                  assetId: 1,
                  bytes: jpegBytes,
                  mime: "image/jpeg",
                  position: 0,
                  width: 800,
                  height: 800,
                  providerFetchUrl: "https://cdn.example/a.jpg",
                },
              ],
            },
            42,
          ),
        /INSTAGRAM_CONFIG_MISSING/,
      );

      const ytOwner1 = await getYouTubeConfig(1);
      assert.equal(ytOwner1?.accessToken, "env-yt-token");
      assert.equal(await getYouTubeConfig(42), null);
    } finally {
      delete process.env.ALLOW_ENV_CHANNEL_FALLBACK;
      delete process.env.SINGLE_OPERATOR_OWNER_ID;
    }
  });

  it("honors ALLOW_ENV_XQUICK_FALLBACK=1 only for X and still blocks other transports", async () => {
    process.env.ALLOW_ENV_XQUICK_FALLBACK = "1";
    process.env.SINGLE_OPERATOR_OWNER_ID = "1";
    try {
      const xRes = await postContentToX(["legacy x fallback"], { ownerUserId: 1 });
      assert.equal(xRes.tweetIds.length, 1);
      await assert.rejects(() => postContentToX(["foreign x"], { ownerUserId: 42 }), /XQUICK_CONFIG_MISSING/);
      await assert.rejects(() => postTextToLinkedIn("blocked li", 1), /LINKEDIN_CONFIG_MISSING/);
    } finally {
      delete process.env.ALLOW_ENV_XQUICK_FALLBACK;
      delete process.env.SINGLE_OPERATOR_OWNER_ID;
    }
  });

  it("keeps unowned ownerUserId: null working for single-transport tests", async () => {
    const xRes = await postContentToX(["unowned x"], { ownerUserId: null });
    assert.equal(xRes.tweetIds.length, 1);

    const thRes = await postTextToThreads("unowned threads", null);
    assert.match(thRes.mediaId, /^th-pub-/);

    const liRes = await postTextToLinkedIn("unowned li", null);
    assert.match(liRes.postUrn, /^urn:li:share:/);

    const ytRes = await getYouTubeConfig(null);
    assert.equal(ytRes?.accessToken, "env-yt-token");
  });
});
