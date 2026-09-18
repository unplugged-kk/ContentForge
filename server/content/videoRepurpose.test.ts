import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFixtureVideoRepurposeProvider,
  createOpenShortsProvider,
  LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
  VIDEO_REPURPOSE_LIMITS,
  uniquifyMp4,
  videoRepurposingIdempotencyKey,
  resolveOpenShortsUploadPath,
} from "./videoRepurpose";
import { fixtureMp4Bytes } from "./visualFixture";
import {
  HYPERFRAMES_CLOUD_PROVIDER_ID,
  LOCAL_VIDEO_FIXTURE_ID,
  createHyperframesCloudProvider,
  selectVideoProductionProvider,
  videoProductionProviderMatrix,
  VideoProviderUnavailableError,
} from "./videoProviders";
import { registerVisualProvider, resetVisualProviders } from "./visual";
import { createFixtureVideoProvider } from "./visualFixture";

describe("video repurpose primitives", () => {
  it("uniquifies fixture MP4s so clip hashes do not collapse", () => {
    const base = fixtureMp4Bytes();
    const a = uniquifyMp4(base, 1);
    const b = uniquifyMp4(base, 2);
    assert.notEqual(a.equals(b), true);
    assert.equal(a.subarray(0, 12).equals(base.subarray(0, 12)), true);
  });

  it("fixture returns three independent clips", async () => {
    const provider = createFixtureVideoRepurposeProvider();
    const submitted = await provider.submit({
      semanticId: "cfvr-1",
      source: {
        assetId: 1,
        storageKey: "local:abc",
        mime: "video/mp4",
        durationMs: 5000,
        bytes: fixtureMp4Bytes(),
      },
      clipCount: 3,
      snapshot: {},
    });
    assert.equal(submitted.status, "accepted");
    const status = await provider.getStatus(submitted.providerJobId);
    assert.equal(status.status, "ready");
    assert.equal(status.clips.length, 3);
    assert.notEqual(status.clips[0].bytes.equals(status.clips[1].bytes), true);
  });

  it("partial fixture preserves successful clips", async () => {
    const provider = createFixtureVideoRepurposeProvider({ failMode: "partial", failAtIndex: 1 });
    await provider.submit({
      semanticId: "cfvr-partial",
      source: {
        assetId: 1,
        storageKey: "local:abc",
        mime: "video/mp4",
        durationMs: 5000,
        bytes: fixtureMp4Bytes(),
      },
      clipCount: 3,
      snapshot: {},
    });
    const status = await provider.getStatus("cfvr-partial");
    assert.equal(status.status, "partial");
    assert.equal(status.clips.filter((c) => !c.failed).length, 2);
    assert.equal(status.clips[1].failed, true);
  });

  it("idempotency key changes only when regenerate nonce changes", () => {
    const a = videoRepurposingIdempotencyKey({
      userId: 1,
      sourceVisualAssetId: 9,
      providerId: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
      clipCount: 3,
    });
    const b = videoRepurposingIdempotencyKey({
      userId: 1,
      sourceVisualAssetId: 9,
      providerId: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
      clipCount: 3,
    });
    const c = videoRepurposingIdempotencyKey({
      userId: 1,
      sourceVisualAssetId: 9,
      providerId: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
      clipCount: 3,
      regenerationNonce: "n2",
    });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("caps clips per source", () => {
    assert.equal(VIDEO_REPURPOSE_LIMITS.maxClipsPerSource, 10);
  });
});

describe("openshorts adapter", () => {
  it("uses REST /api/uploads + /api/process and never calls publish paths", async () => {
    const paths: string[] = [];
    const provider = createOpenShortsProvider({
      baseUrl: "http://openshorts.test",
      fetchImpl: async (input, init) => {
        const url = String(input);
        paths.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/api/uploads") && init?.method === "POST") {
          return new Response(JSON.stringify({
            upload_id: "up-1",
            upload_url: "http://openshorts.test/api/uploads/up-1",
          }), { status: 200 });
        }
        if (url.includes("/api/uploads/up-1") && init?.method === "PUT") {
          return new Response(JSON.stringify({ upload_id: "up-1", bytes: 32, duration_seconds: 12 }), { status: 200 });
        }
        if (url.endsWith("/api/process") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          assert.equal(body.upload_id, "up-1");
          assert.equal(body.acknowledged, true);
          assert.equal("url" in body, false);
          return new Response(JSON.stringify({ job_id: "os-1", status: "queued" }), { status: 200 });
        }
        if (url.endsWith("/api/status/os-1")) {
          return new Response(
            JSON.stringify({
              status: "completed",
              result: { clips: [{ title: "Hook", start: 1, end: 4, video_url: "/videos/os-1/clip0.mp4" }] },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/videos/os-1/clip0.mp4")) {
          return new Response(fixtureMp4Bytes(), { status: 200 });
        }
        return new Response("no", { status: 500 });
      },
    });
    const submitted = await provider.submit({
      semanticId: "cfvr-9",
      source: {
        assetId: 1,
        storageKey: "local:abc",
        mime: "video/mp4",
        durationMs: 12000,
        bytes: fixtureMp4Bytes(),
      },
      clipCount: 3,
      snapshot: {},
    });
    assert.equal(submitted.providerJobId, "os-1");
    const status = await provider.getStatus("os-1");
    assert.equal(status.clips[0]?.bytes.length, fixtureMp4Bytes().length);
    assert.equal(paths.some((p) => p.includes("publish")), false);
    assert.equal(paths.some((p) => p.includes("process_video")), false);
    assert.equal(paths.some((p) => p.includes("get_job_status")), false);
    assert.equal(paths.some((p) => p.includes("/api/process")), true);
    assert.equal(paths.some((p) => p.includes("/api/status/os-1")), true);
  });

  it("does not follow an upload_url on a different origin", () => {
    assert.equal(
      resolveOpenShortsUploadPath("http://openshorts.test", "up-1", "http://evil.test/api/uploads/up-1"),
      "/api/uploads/up-1",
    );
    assert.equal(
      resolveOpenShortsUploadPath("http://openshorts.test", "up-1", "http://openshorts.test/api/uploads/up-1"),
      "/api/uploads/up-1",
    );
  });

  it("maps process timeout after upload to unknown without minting a job id", async () => {
    const provider = createOpenShortsProvider({
      baseUrl: "http://openshorts.test",
      processTimeoutMs: 20,
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/uploads") && init?.method === "POST") {
          return new Response(JSON.stringify({ upload_id: "up-to" }), { status: 200 });
        }
        if (url.includes("/api/uploads/up-to") && init?.method === "PUT") {
          return new Response("{}", { status: 200 });
        }
        if (url.endsWith("/api/process")) {
          await new Promise((_, reject) => {
            const fail = () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            };
            if (init?.signal?.aborted) fail();
            else init?.signal?.addEventListener("abort", fail);
          });
        }
        return new Response("no", { status: 500 });
      },
    });
    const submitted = await provider.submit({
      semanticId: "cfvr-timeout",
      source: {
        assetId: 1,
        storageKey: "local:abc",
        mime: "video/mp4",
        durationMs: 60000,
        bytes: fixtureMp4Bytes(),
      },
      clipCount: 3,
      snapshot: {},
    });
    assert.equal(submitted.status, "unknown");
    assert.equal(submitted.providerJobId, "upload:up-to");
    const status = await provider.getStatus(submitted.providerJobId);
    assert.equal(status.status, "unknown");
    assert.equal(status.clips.length, 0);
  });

  it("maps an invalid process request to a permanent rejection", async () => {
    const provider = createOpenShortsProvider({
      baseUrl: "http://openshorts.test",
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/uploads") && init?.method === "POST") {
          return new Response(JSON.stringify({ upload_id: "up-bad" }), { status: 200 });
        }
        if (url.includes("/api/uploads/up-bad") && init?.method === "PUT") {
          return new Response("{}", { status: 200 });
        }
        if (url.endsWith("/api/process")) {
          return new Response(JSON.stringify({ detail: "Upload not received yet: PUT the video to upload_url first" }), { status: 400 });
        }
        return new Response("no", { status: 500 });
      },
    });
    await assert.rejects(
      () =>
        provider.submit({
          semanticId: "cfvr-bad",
          source: {
            assetId: 1,
            storageKey: "local:abc",
            mime: "video/mp4",
            durationMs: 60000,
            bytes: fixtureMp4Bytes(),
          },
          clipCount: 3,
          snapshot: {},
        }),
      /openshorts rejected \/api\/process|Upload not received/,
    );
  });

  it("does not treat GET /health 200 as processing-ready when quota is missing", async () => {
    const provider = createOpenShortsProvider({
      baseUrl: "http://openshorts.test",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        if (url.endsWith("/health/ready")) return new Response(JSON.stringify({ status: "ready" }), { status: 200 });
        if (url.endsWith("/api/config")) return new Response(JSON.stringify({ billingEnabled: true }), { status: 200 });
        if (url.endsWith("/api/process")) {
          return new Response(JSON.stringify({ detail: { error: "no_plan", message: "provider quota unavailable" } }), { status: 402 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const health = await provider.health!();
    assert.equal(health.reachable, true);
    assert.equal(health.processingReady, false);
    assert.match(String(health.reason), /quota/i);
  });

  it("does not claim processing-ready when the local LLM is down", async () => {
    const provider = createOpenShortsProvider({
      baseUrl: "http://openshorts.test",
      llmProbeUrl: "http://llm.test/v1/models",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        if (url.endsWith("/health/ready")) return new Response(JSON.stringify({ status: "ready" }), { status: 200 });
        if (url.endsWith("/api/config")) {
          return new Response(JSON.stringify({ localLlm: { provider: "openai", model: "llama3.1:8b" } }), { status: 200 });
        }
        if (url.endsWith("/v1/models")) return new Response("down", { status: 503 });
        if (url.endsWith("/api/process")) {
          return new Response(JSON.stringify({ detail: "Must provide URL, File or upload_id" }), { status: 400 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const health = await provider.health!();
    assert.equal(health.reachable, true);
    assert.equal(health.llmReady, false);
    assert.equal(health.processingReady, false);
    assert.match(String(health.reason), /local LLM unavailable/i);
  });

  it("is processing-ready when local LLM and process route are both real", async () => {
    const provider = createOpenShortsProvider({
      baseUrl: "http://openshorts.test",
      llmProbeUrl: "http://llm.test/v1/models",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        if (url.endsWith("/health/ready")) return new Response(JSON.stringify({ status: "ready" }), { status: 200 });
        if (url.endsWith("/api/config")) {
          return new Response(JSON.stringify({ localLlm: { provider: "openai", model: "llama3.1:8b" } }), { status: 200 });
        }
        if (url.endsWith("/v1/models")) return new Response(JSON.stringify({ data: [{ id: "llama3.1:8b" }] }), { status: 200 });
        if (url.endsWith("/api/process")) {
          return new Response(JSON.stringify({ detail: "Must provide URL, File or upload_id" }), { status: 400 });
        }
        return new Response("no", { status: 404 });
      },
    });
    const health = await provider.health!();
    assert.equal(health.reachable, true);
    assert.equal(health.llmReady, true);
    assert.equal(health.processingReady, true);
    assert.equal(health.reason, null);
  });
});

describe("video production provider selection", () => {
  it("defaults omitted preference to the video fixture", () => {
    resetVisualProviders();
    registerVisualProvider(createFixtureVideoProvider());
    const provider = selectVideoProductionProvider({});
    assert.equal(provider.providerId, LOCAL_VIDEO_FIXTURE_ID);
  });

  it("does not invent a hyperframes-cloud provider when unregistered", () => {
    resetVisualProviders();
    registerVisualProvider(createFixtureVideoProvider());
    assert.throws(
      () => selectVideoProductionProvider({ preferredProvider: HYPERFRAMES_CLOUD_PROVIDER_ID }),
      VideoProviderUnavailableError,
    );
  });

  it("matrix reports hyperframes-cloud unconfigured without claiming verification", () => {
    const row = videoProductionProviderMatrix({}).find((r) => r.provider === HYPERFRAMES_CLOUD_PROVIDER_ID);
    assert.ok(row);
    assert.equal(row?.configured, false);
    assert.equal(row?.verified, false);
  });

  it("hyperframes adapter maps only safe variables and imports bytes from a signed URL", async () => {
    const provider = createHyperframesCloudProvider({
      baseUrl: "http://hyperframes.test",
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/renders/cfvg-7") && (!init || init.method === "GET")) {
          return new Response("", { status: 404 });
        }
        if (url.endsWith("/renders") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { variables?: Record<string, string> };
          assert.equal(body.variables?.title, "Hello");
          assert.equal("ffmpegArgs" in (body.variables ?? {}), false);
          return new Response(JSON.stringify({ status: "ready", videoUrl: "http://hyperframes.test/signed.mp4", width: 1080, height: 1920, durationMs: 1000 }), { status: 200 });
        }
        if (url.endsWith("/signed.mp4")) {
          return new Response(fixtureMp4Bytes(), { status: 200 });
        }
        return new Response("no", { status: 500 });
      },
    });
    const output = await provider.generate({
      kind: "video",
      capability: "generate_video",
      snapshot: { intent: { title: "Hello<script>", ffmpegArgs: "-y" }, renderIntent: { title: "Hello" } },
      correlationId: "c",
      generationId: 7,
    });
    assert.equal(output.provider, HYPERFRAMES_CLOUD_PROVIDER_ID);
    assert.equal(output.usage.signedUrlEphemeral, true);
    assert.ok(output.bytes.length > 0);
  });
});
