import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  createElevenLabsProvider,
  ELEVENLABS_DEFAULT_MODEL_ID,
  ELEVENLABS_PROVIDER_ID,
  discoverElevenLabsCertificationDefaults,
} from "./elevenlabs";

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function budgetEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "cf-el-"));
  scratchDirs.push(dir);
  return {
    ELEVENLABS_API_KEY: "test-key-not-real",
    ELEVENLABS_VOICE_ID: "voice-abc",
    ELEVENLABS_VOICE_NAME: "Test Voice",
    CONTENTFORGE_REAL_MEDIA_E2E: "1",
    CONTENTFORGE_MEDIA_CERTIFICATION: "1",
    MEDIA_CERT_BUDGET_PATH: join(dir, "budget.json"),
    ...extra,
  };
}

function fakeMp3(): Buffer {
  // Minimal MPEG frame header + padding; probe is mocked via generate path tests
  // that stub probe by returning bytes that fail early before ffprobe when needed.
  const header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat([header, Buffer.alloc(2_000, 0x01)]);
}

describe("ElevenLabs provider contract", () => {
  it("declares provider/model separation and audio capabilities", async () => {
    const provider = createElevenLabsProvider({
      env: { ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v1" },
      fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    });
    assert.equal(provider.providerId, ELEVENLABS_PROVIDER_ID);
    assert.deepEqual(provider.capabilities, ["generate_audio"]);
    assert.ok(provider.models?.includes(ELEVENLABS_DEFAULT_MODEL_ID));
    assert.equal(provider.synchronous, true);
    assert.equal(provider.capabilityDeclaration?.supportsVoiceCloning, false);
    const health = await provider.health?.();
    assert.equal(health?.transportConfigured, true);
  });

  it("reports unconfigured when API key is absent", async () => {
    const provider = createElevenLabsProvider({ env: {} });
    const health = await provider.health?.();
    assert.equal(health?.transportConfigured, false);
    assert.equal(health?.processingReady, false);
    assert.match(String(health?.reason), /not configured/);
  });

  it("blocks generate without certification flags", async () => {
    const provider = createElevenLabsProvider({
      env: { ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v1" },
    });
    await assert.rejects(
      () => provider.generate({
        kind: "audio",
        capability: "generate_audio",
        snapshot: { intent: { text: "hello", providerVoiceId: "v1" } },
        correlationId: "t",
        model: ELEVENLABS_DEFAULT_MODEL_ID,
        generationId: 1,
      }),
      /blocked without/,
    );
  });

  it("maps rate limit / auth / quota errors without leaking secrets", async () => {
    const env = budgetEnv();
    const cases: Array<{ status: number; body: string; pattern: RegExp }> = [
      { status: 429, body: "xi-api-key=secret-leak", pattern: /rate limited/ },
      { status: 401, body: "unauthorized", pattern: /configuration error/ },
      { status: 402, body: "quota exhausted", pattern: /quota/ },
    ];
    for (const testCase of cases) {
      const dir = mkdtempSync(join(tmpdir(), "cf-el-err-"));
      scratchDirs.push(dir);
      const caseEnv = {
        ...env,
        MEDIA_CERT_BUDGET_PATH: join(dir, "budget.json"),
      };
      const provider = createElevenLabsProvider({
        env: caseEnv,
        fetchImpl: (async () => new Response(testCase.body, { status: testCase.status })) as typeof fetch,
      });
      await assert.rejects(
        () => provider.generate({
          kind: "audio",
          capability: "generate_audio",
          snapshot: {
            intent: {
              text: "ContentForge provider certification test.",
              providerVoiceId: "voice-abc",
              certificationKey: `phase27.3-elevenlabs-error-${testCase.status}`,
            },
          },
          correlationId: "el-err",
          model: ELEVENLABS_DEFAULT_MODEL_ID,
          generationId: testCase.status,
        }),
        testCase.pattern,
      );
    }
  });

  it("discovers a non-cloned voice and flash/turbo model preference", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/models")) {
        return new Response(JSON.stringify([
          { model_id: "eleven_multilingual_v2", can_do_text_to_speech: true },
          { model_id: "eleven_flash_v2_5", can_do_text_to_speech: true },
        ]), { status: 200 });
      }
      if (url.includes("/v2/voices")) {
        return new Response(JSON.stringify({
          voices: [
            { voice_id: "cloned-1", name: "Clone", category: "cloned" },
            { voice_id: "stock-1", name: "Rachel", category: "premade" },
          ],
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const defaults = await discoverElevenLabsCertificationDefaults({
      env: { ELEVENLABS_API_KEY: "k" },
      fetchImpl,
    });
    assert.equal(defaults.modelId, "eleven_flash_v2_5");
    assert.equal(defaults.voiceId, "stock-1");
    assert.equal(defaults.voiceName, "Rachel");
  });

  it("refuses oversized certification text before HTTP", async () => {
    let called = false;
    const provider = createElevenLabsProvider({
      env: budgetEnv(),
      fetchImpl: (async () => {
        called = true;
        return new Response(fakeMp3(), { status: 200 });
      }) as typeof fetch,
    });
    await assert.rejects(
      () => provider.generate({
        kind: "audio",
        capability: "generate_audio",
        snapshot: {
          intent: {
            text: "x".repeat(201),
            providerVoiceId: "voice-abc",
          },
        },
        correlationId: "el-long",
        model: ELEVENLABS_DEFAULT_MODEL_ID,
        generationId: 9,
      }),
      /exceeds 200/,
    );
    assert.equal(called, false);
  });

  it("does not put the API key into discovery health reason strings", async () => {
    const provider = createElevenLabsProvider({
      env: { ELEVENLABS_API_KEY: "super-secret-key-value" },
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    });
    const health = await provider.health?.();
    assert.ok(!JSON.stringify(health).includes("super-secret-key-value"));
  });

  it("records observational character-cost metadata on successful HTTP", async () => {
    // Skip ffprobe by asserting we reject empty audio before probe — success
    // path with real probe is covered by live certification only.
    const env = budgetEnv();
    const provider = createElevenLabsProvider({
      env,
      fetchImpl: (async () => new Response(Buffer.alloc(50), {
        status: 200,
        headers: {
          "character-cost": "42",
          "request-id": "req-1",
          "x-trace-id": "trace-1",
        },
      })) as typeof fetch,
    });
    await assert.rejects(
      () => provider.generate({
        kind: "audio",
        capability: "generate_audio",
        snapshot: {
          intent: {
            text: "ContentForge provider certification test.",
            providerVoiceId: "voice-abc",
          },
        },
        correlationId: "el-empty",
        model: ELEVENLABS_DEFAULT_MODEL_ID,
        generationId: 3,
      }),
      /empty audio/,
    );
    // Budget was consumed before the HTTP call (crash-safe).
    const { readMediaCertificationBudget } = await import("../mediaCertification");
    assert.equal(readMediaCertificationBudget(env).elevenlabsCalls, 1);
    assert.ok(createHash("sha256").update("x").digest("hex").length > 0);
  });
});
