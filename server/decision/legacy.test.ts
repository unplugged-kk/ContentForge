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

function fakeShadow(decision: ViralScoreDecision, fallback = false) {
  const calls: Array<Record<string, any>> = [];
  const run = (async (input: Record<string, any>) => {
    calls.push(input);
    return {
      decision,
      reasons: ["shadow"],
      policyId: "viral-score",
      policyVersion: "v1",
      decisionType: "viral_score",
      fallback,
      level: "soft",
    } satisfies DecisionResult<ViralScoreDecision>;
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
