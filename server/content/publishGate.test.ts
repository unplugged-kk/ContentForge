/**
 * The publish gate boundary: real content evidence in, a bounded outcome back.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJevPublishGate } from "./publishGate";
import { registerBuiltinChannelAdapters } from "./adapters";

registerBuiltinChannelAdapters();

const engineResult = (outcome: string, score: number | null, fallback = false) => ({
  decision: { outcome, score },
  reasons: [`${outcome}`],
  policyId: "publish-gate",
  policyVersion: "v1",
  decisionType: "publish_gate",
  fallback,
  level: "soft" as const,
});

const SLOP = {
  text:
    "In today's fast-paced world, let's dive in. This game-changing approach unlocks " +
    "the power of the cloud. Moreover, in the realm of modern infrastructure, we must " +
    "delve into the tapestry.",
};

describe("createJevPublishGate", () => {
  it("passes the content evidence to the decision and carries the outcome back", async () => {
    let seen: Record<string, any> | null = null;
    const port = createJevPublishGate({
      decide: (async (input: Record<string, any>) => {
        seen = input;
        return engineResult("publish", 0.8);
      }) as never,
    });

    const outcome = await port.review({
      artifactId: 7,
      userId: 1,
      format: "x_post",
      channel: "x",
      payload: SLOP,
    });

    assert.equal(outcome.outcome, "publish");
    assert.equal(outcome.policyId, "publish-gate");
    assert.equal(seen?.type, "publish_gate");
    assert.deepEqual(seen?.refs, { artifactId: 7 });
    assert.equal(seen?.userId, 1);
    assert.equal(seen!.state.platform.maxCharacters, 280);
    assert.ok(seen!.state.quality.signals.word_count > 0);
    // The deterministic evidence travels with the outcome so an operator can see
    // WHY content was held, not just that it was.
    assert.ok(outcome.flags.includes("boilerplate_heavy"));
  });

  it("carries a hold through unchanged", async () => {
    const port = createJevPublishGate({
      decide: (async () => engineResult("hold", null, true)) as never,
    });
    const outcome = await port.review({
      artifactId: 1,
      format: "x_post",
      channel: "x",
      payload: SLOP,
    });
    assert.equal(outcome.outcome, "hold");
    assert.equal(outcome.fallback, true);
    assert.equal(outcome.score, null);
  });
});
