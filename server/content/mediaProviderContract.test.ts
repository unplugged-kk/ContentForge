import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoverMediaProviders,
  normalizeProviderError,
  registerVisualProvider,
  resetVisualProviders,
  resolveProviderModel,
  validateAudioOutput,
  VisualModelUnsupportedError,
  type VisualProviderPort,
} from "./visual";
import {
  createMacosSayProvider,
  MACOS_SAY_MODEL_ID,
  MACOS_SAY_PROVIDER_ID,
} from "./visualProviders/macosSay";

/**
 * Reusable adapter certification checks. New providers call this suite with a
 * deterministic adapter instance; live output checks remain provider-specific.
 */
function certifyProviderContract(provider: VisualProviderPort): void {
  assert.ok(provider.providerId);
  assert.ok(provider.providerVersion);
  assert.ok(provider.capabilities.length > 0);
  assert.ok(provider.modalities?.length);
  assert.equal(typeof provider.generate, "function");
  for (const model of provider.modelCatalog ?? []) {
    assert.ok(model.id);
    assert.ok(model.capabilities.length > 0);
    assert.ok(model.modalities.length > 0);
  }
}

describe("media provider contract certification", () => {
  it("declares model-aware capabilities independently from health", async () => {
    const provider = createMacosSayProvider({ MACOS_SAY_ENABLED: "false" });
    certifyProviderContract(provider);
    assert.deepEqual(provider.capabilities, ["generate_audio"]);
    assert.deepEqual(provider.models, [MACOS_SAY_MODEL_ID]);
    assert.equal(provider.capabilityDeclaration?.supportsVoiceCloning, false);
    const health = await provider.health?.();
    assert.equal(health?.transportConfigured, false);
    assert.equal(health?.processingReady, false);
  });

  it("discovers only requested modalities and never exposes configuration secrets", async () => {
    resetVisualProviders();
    registerVisualProvider(createMacosSayProvider({
      MACOS_SAY_ENABLED: "true",
      MACOS_SAY_VOICES: "Samantha",
      ELEVENLABS_API_KEY: "must-not-leak",
    }));
    const discovered = await discoverMediaProviders("audio");
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0]?.id, MACOS_SAY_PROVIDER_ID);
    assert.equal(discovered[0]?.voices[0]?.providerVoiceId, "Samantha");
    assert.ok(!JSON.stringify(discovered).includes("must-not-leak"));
    resetVisualProviders();
  });

  it("rejects unsupported models before calling the provider", () => {
    const provider = createMacosSayProvider({ MACOS_SAY_ENABLED: "true" });
    assert.doesNotThrow(() => resolveProviderModel(provider, MACOS_SAY_MODEL_ID));
    assert.throws(() => resolveProviderModel(provider, "other/model"), VisualModelUnsupportedError);
  });

  it("normalizes provider errors without leaking vendor payloads into orchestration", () => {
    assert.equal(normalizeProviderError(Object.assign(new Error("request timed out"), { status: 504 })), "transient");
    assert.equal(normalizeProviderError(Object.assign(new Error("too many requests"), { status: 429 })), "rate_limited");
    assert.equal(normalizeProviderError(new Error("missing API key")), "configuration");
    assert.equal(normalizeProviderError(new Error("quota exhausted")), "quota");
    assert.equal(normalizeProviderError(Object.assign(new Error("bad request"), { status: 400 })), "permanent");
    assert.equal(normalizeProviderError(new Error("unclassified")), "unknown");
  });

  it("maps invalid voice selection to a permanent provider error", async () => {
    const provider = createMacosSayProvider({
      MACOS_SAY_ENABLED: "true",
      MACOS_SAY_VOICES: "Samantha",
    });
    await assert.rejects(
      () => provider.generate({
        kind: "audio",
        capability: "generate_audio",
        snapshot: { intent: { text: "hello", providerVoiceId: "Celebrity" } },
        correlationId: "media-contract",
        model: MACOS_SAY_MODEL_ID,
        generationId: 1,
      }),
      /not configured/,
    );
  });

  it("produces and validates real local speech", { skip: process.platform !== "darwin" }, async () => {
    const provider = createMacosSayProvider({
      MACOS_SAY_ENABLED: "true",
      MACOS_SAY_VOICES: "Samantha",
    });
    const output = await provider.generate({
      kind: "audio",
      capability: "generate_audio",
      snapshot: {
        intent: {
          text: "ContentForge verifies a real local speech provider.",
          providerVoiceId: "Samantha",
          speakingRate: 190,
        },
      },
      correlationId: "media-live-contract",
      model: MACOS_SAY_MODEL_ID,
      generationId: 27,
    });
    validateAudioOutput(output);
    assert.equal(output.provider, MACOS_SAY_PROVIDER_ID);
    assert.equal(output.model, MACOS_SAY_MODEL_ID);
    assert.equal(output.mime, "audio/wav");
    assert.ok(output.bytes.length > 1_000);
    assert.ok((output.durationMs ?? 0) > 0);
    assert.equal(output.sampleRate, 24_000);
    assert.equal(output.channels, 1);
  });
});
