import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GenerationRequest } from "./generation";
import {
  buildGenerationUserMessage,
  hasSuppliedResearchEvidence,
  payloadShapeHint,
  unwrapModelOutput,
} from "./model";

function makeRequest(overrides: {
  format?: string;
  systemPrompt?: string;
  userPrompt?: string;
  evidence?: Array<{ id: number; excerpt: string; kind: string }>;
}): GenerationRequest {
  const format = overrides.format ?? "x_post";
  return {
    format,
    channel: "x",
    correlationId: "corr-test",
    policy: {
      policyId: 1,
      policyKey: `pol:${format}:x`,
      policyVersion: 1,
      specHash: "abc123",
      formatPolicyRef: `${format}@1`,
      format,
      channel: "x",
      model: "gpt-4o-mini",
      constraints: {},
      systemPrompt:
        overrides.systemPrompt ??
        "You write practitioner-grade content for ContentForge.",
      userPrompt:
        overrides.userPrompt ??
        "Story: Test\nEvidence: (none)\nReturn JSON matching the x_post payload schema.",
      inputHashes: {
        story: "s",
        evidence: "e",
        voice: "v",
        template: "t",
        context: "c",
      },
      voiceId: null,
      templateId: null,
      contextSourceRefs: [],
    },
    context: {
      story: { id: 1, title: "Test", insightBody: "Body", angles: [] },
      opportunity: {
        id: 2,
        concept: "Concept",
        objective: "Objective",
        audience: null,
        angle: null,
      },
      evidence: overrides.evidence ?? [],
    },
  };
}

describe("generation model prompt shape and output unwrapping", () => {
  it("requests { payload, claims } with citation rules when research evidence is supplied", () => {
    const hint = payloadShapeHint("x_post", true);
    assert.match(hint, /"payload":\s*\{\s*"text":/);
    assert.match(hint, /"claims":\s*\[/);
    assert.match(hint, /"evidenceIds":\s*\[1\]/);
    assert.match(hint, /"status":\s*"supported"\s*\|\s*"opinion"/);
    assert.match(hint, /only cite numeric IDs/i);
    assert.match(hint, /"opinion"/);

    const requestWithContextEvidence = makeRequest({
      format: "x_thread",
      userPrompt: "Story: PG18\nEvidence:\n- [excerpt#42] Scans rose 28% on NVMe.",
      evidence: [{ id: 42, excerpt: "Scans rose 28% on NVMe.", kind: "excerpt" }],
    });
    assert.equal(hasSuppliedResearchEvidence(requestWithContextEvidence), true);
    const userMessage = buildGenerationUserMessage(requestWithContextEvidence);
    assert.match(userMessage, /"payload":\s*\{\s*"units":/);
    assert.match(userMessage, /"claims":\s*\[/);

    const requestWithPromptMarkerOnly = makeRequest({
      userPrompt: "Evidence items:\n[evidence#7] Latency dropped 15ms.",
      evidence: [],
    });
    assert.equal(hasSuppliedResearchEvidence(requestWithPromptMarkerOnly), true);
    assert.match(buildGenerationUserMessage(requestWithPromptMarkerOnly), /"claims":/);
  });

  it("keeps bare format payload shape when no research evidence is supplied", () => {
    const request = makeRequest({
      format: "linkedin_post",
      systemPrompt:
        "You write practitioner-grade content.\nPrior approved posts:\n- [artifact#99] Past post.",
      userPrompt: "Story: First-hand note\nEvidence: (none)\nReturn JSON matching the linkedin_post payload schema.",
      evidence: [],
    });

    assert.equal(hasSuppliedResearchEvidence(request), false);
    const userMessage = buildGenerationUserMessage(request);
    assert.match(userMessage, /\{ "text": "<single LinkedIn post body, <=3000 chars>" \}$/);
    assert.equal(userMessage.includes('"claims"'), false);
  });

  it("unwrapModelOutput round-trips { payload, claims } (text or claimText) and legacy bare payloads", () => {
    const wrappedWithText = unwrapModelOutput({
      payload: { text: "Async IO boosted scans by 28%." },
      claims: [
        { text: "Async IO boosted scans by 28%.", evidenceIds: [42], status: "supported" },
        { text: "Teams should benchmark before upgrading.", evidenceIds: [], status: "opinion" },
      ],
    });
    assert.deepEqual(wrappedWithText.payload, { text: "Async IO boosted scans by 28%." });
    assert.deepEqual(wrappedWithText.claims, [
      {
        unitIndex: 0,
        claimText: "Async IO boosted scans by 28%.",
        evidenceIds: [42],
        status: "supported",
      },
      {
        unitIndex: 0,
        claimText: "Teams should benchmark before upgrading.",
        evidenceIds: [],
        status: "opinion",
      },
    ]);

    const wrappedWithClaimText = unwrapModelOutput({
      payload: { units: ["Unit 1", "Unit 2"] },
      claims: [{ unitIndex: 1, claimText: "Unit 2", evidenceIds: [7], status: "supported" }],
    });
    assert.deepEqual(wrappedWithClaimText.payload, { units: ["Unit 1", "Unit 2"] });
    assert.deepEqual(wrappedWithClaimText.claims, [
      { unitIndex: 1, claimText: "Unit 2", evidenceIds: [7], status: "supported" },
    ]);

    const bareText = unwrapModelOutput({ text: "Plain bare output" });
    assert.deepEqual(bareText, { payload: { text: "Plain bare output" } });

    const bareUnits = unwrapModelOutput({ units: ["One", "Two"] });
    assert.deepEqual(bareUnits, { payload: { units: ["One", "Two"] } });
  });
});
