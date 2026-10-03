/**
 * Legacy shadow seam (Phase 6): it records, and nothing acts on it.
 *
 * The property that matters is that shadow mode is INERT until switched on — a
 * disabled entry makes no call at all — and that it can never change the answer
 * the caller already produced.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLegacyShadows } from "./legacy";
import { LLM_OVERALL_KEY } from "./decisions/viral";
import type { DecisionResult, ViralScoreDecision } from "./schemas";

function fakeShadow<T>(decision: T, fallback = false) {
  const calls: Array<Record<string, any>> = [];
  const run = (async (input: Record<string, any>) => {
    calls.push(input);
    return {
      decision,
      reasons: ["shadow"],
      policyId: "legacy",
      policyVersion: "v1",
      decisionType: "legacy",
      fallback,
      level: "soft",
    } satisfies DecisionResult<T>;
  }) as never;
  return { run, calls };
}

describe("legacy shadows — viral score (JC-01)", () => {
  it("makes no call at all when the decision is disabled", async () => {
    const { run, calls } = fakeShadow({ overall: 0.5, dimensions: {} });
    const shadows = createLegacyShadows({ shadow: run, enabled: () => false });

    const result = await shadows.viralScore({ content: "draft", llmOverall: 7.2 });

    assert.equal(result, null);
    assert.equal(calls.length, 0, "shadow mode costs nothing until it is switched on");
  });

  it("records the decision and carries the model's own score for comparison", async () => {
    const { run, calls } = fakeShadow({ overall: 0.62, dimensions: { hook_power: 0.8 } });
    const shadows = createLegacyShadows({ shadow: run, enabled: () => true });

    const decision = await shadows.viralScore({
      content: "We cut idle nodes 40%.",
      platform: "x",
      llmOverall: 7.2,
      userId: 3,
    });

    assert.equal(decision?.overall, 0.62);
    assert.equal(calls[0].type, "viral_score");
    assert.equal(calls[0].userId, 3);
    assert.equal(calls[0].state.platform.channel, "x");
    // 7.2/10 → 0.72, so a later comparison needs no translation.
    assert.equal(calls[0].state.quality.signals[LLM_OVERALL_KEY], 0.72);
  });

  it("omits the comparison signal when the model gave no numeric score", async () => {
    const { run, calls } = fakeShadow({ overall: null, dimensions: {} }, true);
    const shadows = createLegacyShadows({ shadow: run, enabled: () => true });

    const decision = await shadows.viralScore({ content: "draft", llmOverall: Number.NaN });

    assert.equal(decision?.overall, null, "an unusable run reports null, never a fabricated score");
    assert.deepEqual(calls[0].state.quality.signals, {});
  });

  it("attributes the shadow decision to the caller when refs are supplied", async () => {
    const { run, calls } = fakeShadow({ overall: 0.4, dimensions: {} });
    const shadows = createLegacyShadows({ shadow: run, enabled: () => true });

    await shadows.viralScore({ content: "draft", refs: { storyId: 5 } });

    assert.deepEqual(calls[0].refs, { storyId: 5 });
  });
});

describe("legacy shadows — discover rank (JC-02)", () => {
  it("makes no call at all when the decision is disabled", async () => {
    const { run, calls } = fakeShadow({ promoted: [], perItem: [] });
    const shadows = createLegacyShadows({ shadow: run, enabled: () => false });

    const result = await shadows.discoverRank({ items: [{ title: "one" }], llmIdeaCount: 20 });

    assert.equal(result, null);
    assert.equal(calls.length, 0);
  });

  it("bounds the batch and records the model's own count for comparison", async () => {
    const { run, calls } = fakeShadow({ promoted: [0], perItem: [{ index: 0, score: 0.8 }] });
    const shadows = createLegacyShadows({ shadow: run, enabled: () => true });

    const items = Array.from({ length: 30 }, (_v, i) => ({ title: `item ${i}` }));
    const decision = await shadows.discoverRank({ items, llmIdeaCount: 20, userId: 2 });

    assert.deepEqual(decision?.promoted, [0]);
    assert.equal(calls[0].type, "discover_rank");
    assert.equal(calls[0].userId, 2);
    assert.ok(calls[0].state.candidates.length <= 20, "the request stays bounded");
    assert.deepEqual(calls[0].state.quality.flags, ["legacy:ideas=20"]);
  });
});

describe("legacy shadows — agent route (JC-03)", () => {
  it("records the compiler's own choice beside the decision", async () => {
    const { run, calls } = fakeShadow({ firstTool: "research_topic", windowPreset: "last_7d" });
    const shadows = createLegacyShadows({ shadow: run, enabled: () => true });

    const decision = await shadows.agentRoute({
      objective: "research kubernetes cost this week",
      legacyTool: "research_topic",
      legacyPreset: "last_7d",
      userId: 5,
    });

    assert.equal(decision?.firstTool, "research_topic");
    assert.equal(calls[0].type, "agent_route");
    assert.equal(calls[0].userId, 5);
    assert.deepEqual(calls[0].state.quality.flags, [
      "legacy:tool=research_topic",
      "legacy:preset=last_7d",
    ]);
  });

  it("omits flags the compiler had nothing for", async () => {
    const { run, calls } = fakeShadow({ firstTool: null, windowPreset: null }, true);
    const shadows = createLegacyShadows({ shadow: run, enabled: () => true });

    await shadows.agentRoute({ objective: "do the thing" });

    assert.deepEqual(calls[0].state.quality.flags, []);
  });
});
