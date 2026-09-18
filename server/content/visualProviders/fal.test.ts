import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  createFalProvider,
  FAL_DEFAULT_MODEL_ID,
  FAL_PROVIDER_ID,
} from "./fal";

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function falEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "cf-fal-"));
  scratchDirs.push(dir);
  return {
    FAL_KEY: "test-fal-key",
    CONTENTFORGE_REAL_MEDIA_E2E: "1",
    CONTENTFORGE_MEDIA_CERTIFICATION: "1",
    MEDIA_CERT_BUDGET_PATH: join(dir, "budget.json"),
    FAL_REQUEST_ID_DIR: join(dir, "request-ids"),
    ...extra,
  };
}

/** Minimal ISO BMFF `ftyp` so looksLikeMp4 accepts the buffer. */
function fakeMp4(): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(20, 0);
  return Buffer.concat([
    size,
    Buffer.from("ftyp"),
    Buffer.from("isom"),
    Buffer.alloc(8, 0),
    Buffer.alloc(2_000, 0x01),
  ]);
}

describe("fal.ai provider contract", () => {
  it("declares provider/model separation for video", async () => {
    const provider = createFalProvider({
      env: { FAL_KEY: "k" },
      fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    });
    assert.equal(provider.providerId, FAL_PROVIDER_ID);
    assert.ok(!provider.providerId.includes("wan"));
    assert.ok(provider.models?.includes(FAL_DEFAULT_MODEL_ID));
    assert.deepEqual(provider.capabilities, ["generate_video"]);
    assert.equal(provider.synchronous, false);
    assert.equal(provider.capabilityDeclaration?.textToVideo, true);
    assert.equal(provider.capabilityDeclaration?.imageToVideo, false);
    const health = await provider.health?.();
    assert.equal(health?.transportConfigured, true);
  });

  it("reports unconfigured without FAL_KEY", async () => {
    const provider = createFalProvider({ env: {} });
    const health = await provider.health?.();
    assert.equal(health?.transportConfigured, false);
    assert.equal(health?.processingReady, false);
    assert.match(String(health?.reason), /FAL_KEY/);
  });

  it("blocks generate without certification flags", async () => {
    const provider = createFalProvider({ env: { FAL_KEY: "k" } });
    await assert.rejects(
      () => provider.generate({
        kind: "video",
        capability: "generate_video",
        snapshot: { intent: { prompt: "a cat" } },
        correlationId: "t",
        model: FAL_DEFAULT_MODEL_ID,
        generationId: 1,
      }),
      /blocked without/,
    );
  });

  it("rejects certification requests above 480p / >2s before submit", async () => {
    let called = false;
    const provider = createFalProvider({
      env: falEnv(),
      fetchImpl: (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await assert.rejects(
      () => provider.generate({
        kind: "video",
        capability: "generate_video",
        snapshot: { intent: { prompt: "a cat", resolution: "720p", numFrames: 17 } },
        correlationId: "fal-res",
        model: FAL_DEFAULT_MODEL_ID,
        generationId: 2,
      }),
      /480p/,
    );
    await assert.rejects(
      () => provider.generate({
        kind: "video",
        capability: "generate_video",
        snapshot: { intent: { prompt: "a cat", resolution: "480p", numFrames: 48 } },
        correlationId: "fal-dur",
        model: FAL_DEFAULT_MODEL_ID,
        generationId: 3,
      }),
      /exceeds 2000ms/,
    );
    assert.equal(called, false);
  });

  it("submits once, persists request id, polls, downloads owned bytes", async () => {
    const env = falEnv();
    const calls: string[] = [];
    const provider = createFalProvider({
      env,
      pollIntervalMs: 1,
      pollBudgetMs: 5_000,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("api.fal.ai")) {
          return new Response("{}", { status: 200 });
        }
        if (init?.method === "POST" && url.includes("queue.fal.run") && !url.includes("/requests/")) {
          return new Response(JSON.stringify({
            request_id: "req-cert-1",
            status_url: "https://queue.fal.run/fal-ai/wan/requests/req-cert-1/status",
            response_url: "https://queue.fal.run/fal-ai/wan/requests/req-cert-1",
          }), { status: 200 });
        }
        if (url.endsWith("/status")) {
          return new Response(JSON.stringify({
            status: "COMPLETED",
            response_url: "https://queue.fal.run/fal-ai/wan/requests/req-cert-1",
          }), { status: 202 });
        }
        if (url.includes("/requests/req-cert-1") && !url.endsWith("/status")) {
          return new Response(JSON.stringify({
            video: { url: "https://cdn.example.test/out.mp4" },
          }), { status: 200 });
        }
        if (url === "https://cdn.example.test/out.mp4") {
          return new Response(fakeMp4(), { status: 200 });
        }
        return new Response("unexpected", { status: 500 });
      }) as typeof fetch,
    });

    const output = await provider.generate({
      kind: "video",
      capability: "generate_video",
      snapshot: {
        intent: {
          prompt: "ContentForge fal certification — short clip",
          resolution: "480p",
          numFrames: 17,
          framesPerSecond: 16,
          certificationKey: "phase27.3-fal-certification-v1",
        },
      },
      correlationId: "fal-ok",
      model: FAL_DEFAULT_MODEL_ID,
      generationId: 42,
    });

    assert.equal(output.provider, FAL_PROVIDER_ID);
    assert.equal(output.model, FAL_DEFAULT_MODEL_ID);
    assert.equal(output.mime, "video/mp4");
    assert.ok(output.bytes.length > 100);
    assert.equal((output.usage as { requestId?: string })?.requestId, "req-cert-1");
    const persisted = JSON.parse(
      readFileSync(join(env.FAL_REQUEST_ID_DIR!, "cfvg-42.json"), "utf8"),
    ) as { requestId: string };
    assert.equal(persisted.requestId, "req-cert-1");
    assert.ok(calls.some((c) => c.startsWith("POST ")));
  });

  it("reconciles an existing requestId without a second submit", async () => {
    const env = falEnv();
    let posts = 0;
    const provider = createFalProvider({
      env,
      pollIntervalMs: 1,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST" && url.includes("queue.fal.run") && !url.includes("/requests/")) {
          posts += 1;
          return new Response(JSON.stringify({ request_id: "should-not" }), { status: 200 });
        }
        if (url.endsWith("/status")) {
          return new Response(JSON.stringify({
            status: "COMPLETED",
            response_url: "https://queue.fal.run/fal-ai/wan/requests/existing-req",
          }), { status: 200 });
        }
        if (url.includes("/requests/existing-req")) {
          return new Response(JSON.stringify({
            video: { url: "https://cdn.example.test/out.mp4" },
          }), { status: 200 });
        }
        if (url === "https://cdn.example.test/out.mp4") {
          return new Response(fakeMp4(), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });

    const output = await provider.generate({
      kind: "video",
      capability: "generate_video",
      snapshot: {
        intent: {
          prompt: "reconcile",
          resolution: "480p",
          numFrames: 17,
          externalJobId: "existing-req",
        },
      },
      correlationId: "fal-reconcile",
      model: FAL_DEFAULT_MODEL_ID,
      generationId: 99,
    });
    assert.equal(posts, 0);
    assert.equal((output.usage as { requestId?: string })?.requestId, "existing-req");
  });

  it("maps rate limit without leaking Authorization material", async () => {
    const env = falEnv();
    const provider = createFalProvider({
      env,
      fetchImpl: (async () => new Response(
        JSON.stringify({ detail: "Key test-fal-key rate limited" }),
        { status: 429 },
      )) as typeof fetch,
    });
    await assert.rejects(
      () => provider.generate({
        kind: "video",
        capability: "generate_video",
        snapshot: {
          intent: {
            prompt: "rate",
            resolution: "480p",
            numFrames: 17,
            certificationKey: "phase27.3-fal-rate",
          },
        },
        correlationId: "fal-429",
        model: FAL_DEFAULT_MODEL_ID,
        generationId: 7,
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /rate limited/);
        assert.ok(!message.includes("test-fal-key"));
        return true;
      },
    );
  });
});
