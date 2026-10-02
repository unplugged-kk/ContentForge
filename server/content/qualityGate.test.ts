/**
 * The quality gate at the ContentForge boundary.
 *
 * Two properties matter and are pinned here: the gate turns an Artifact payload
 * into signals and asks the decision layer (it decides nothing itself), and on
 * the submission path only a `revise`/`reject` blocks — an outage (`hold`) never
 * stops a human, and nothing here can make content publishable.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QualityGateBlockedError, submitArtifactForReview } from "./artifact";
import { createJevQualityGate, type QualityGateOutcome, type QualityGatePort } from "./qualityGate";
import type { ContentStoragePort } from "./storage";

function makeArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    userId: 1,
    format: "x_post",
    channel: "x",
    payload: { text: "We cut idle Kubernetes nodes 40% with Karpenter consolidation." },
    readiness: "draft",
    ...overrides,
  };
}

function storeFor(artifact: Record<string, unknown>) {
  const transitions: string[] = [];
  const store = {
    getArtifact: async () => artifact,
    setArtifactReadiness: async (_id: number, readiness: string) => {
      transitions.push(readiness);
      return { ...artifact, readiness };
    },
  };
  return { store: store as unknown as ContentStoragePort, transitions };
}

function gateReturning(outcome: QualityGateOutcome["outcome"], extra: Partial<QualityGateOutcome> = {}) {
  const calls: Array<{ artifactId: number; format: string; channel: string; payload: unknown }> = [];
  const port: QualityGatePort = {
    async review(input) {
      calls.push(input as never);
      return {
        outcome,
        score: 0.5,
        reasons: ["test"],
        fallback: false,
        policyId: "quality-gate",
        policyVersion: "v1",
        signals: {},
        flags: [],
        ...extra,
      };
    },
  };
  return { port, calls };
}

describe("submitArtifactForReview + quality gate", () => {
  it("submits unchanged when no gate is wired", async () => {
    const { store, transitions } = storeFor(makeArtifact());
    const artifact = await submitArtifactForReview(5, { artifacts: store });
    assert.equal(artifact.readiness, "in_review");
    assert.deepEqual(transitions, ["in_review"]);
  });

  it("submits on approve, passing the artifact's identity to the gate", async () => {
    const { store, transitions } = storeFor(makeArtifact());
    const { port, calls } = gateReturning("approve");
    const artifact = await submitArtifactForReview(5, { artifacts: store, qualityGate: port });
    assert.equal(artifact.readiness, "in_review");
    assert.deepEqual(transitions, ["in_review"]);
    assert.equal(calls[0].artifactId, 5);
    assert.equal(calls[0].format, "x_post");
    assert.equal(calls[0].channel, "x");
  });

  it("submits on hold — an outage defers to the human instead of blocking them", async () => {
    const { store, transitions } = storeFor(makeArtifact());
    const { port } = gateReturning("hold", { fallback: true });
    const artifact = await submitArtifactForReview(5, { artifacts: store, qualityGate: port });
    assert.equal(artifact.readiness, "in_review");
    assert.deepEqual(transitions, ["in_review"]);
  });

  it("blocks on revise and leaves the draft untouched", async () => {
    const { store, transitions } = storeFor(makeArtifact());
    const { port } = gateReturning("revise", { reasons: ["boilerplate_heavy"] });
    await assert.rejects(
      () => submitArtifactForReview(5, { artifacts: store, qualityGate: port }),
      (error: unknown) => {
        assert.ok(error instanceof QualityGateBlockedError);
        assert.equal((error as QualityGateBlockedError).outcome, "revise");
        assert.deepEqual((error as QualityGateBlockedError).reasons, ["boilerplate_heavy"]);
        return true;
      },
    );
    assert.deepEqual(transitions, [], "a blocked draft is never moved to in_review");
  });

  it("blocks on reject", async () => {
    const { store, transitions } = storeFor(makeArtifact());
    const { port } = gateReturning("reject");
    await assert.rejects(
      () => submitArtifactForReview(5, { artifacts: store, qualityGate: port }),
      QualityGateBlockedError,
    );
    assert.deepEqual(transitions, []);
  });

  it("does not block when the gate itself throws", async () => {
    const { store, transitions } = storeFor(makeArtifact());
    const exploding: QualityGatePort = {
      async review() {
        throw new Error("gate exploded");
      },
    };
    const artifact = await submitArtifactForReview(5, { artifacts: store, qualityGate: exploding });
    assert.equal(artifact.readiness, "in_review");
    assert.deepEqual(transitions, ["in_review"]);
  });

  it("still refuses a non-draft artifact before consulting the gate", async () => {
    const { store } = storeFor(makeArtifact({ readiness: "approved" }));
    const { port, calls } = gateReturning("approve");
    await assert.rejects(() => submitArtifactForReview(5, { artifacts: store, qualityGate: port }));
    assert.equal(calls.length, 0, "the hard state check runs first");
  });
});

describe("createJevQualityGate", () => {
  const engineResult = (outcome: string, score: number | null, fallback = false) => ({
    decision: { outcome, score },
    reasons: [`${outcome}`],
    policyId: "quality-gate",
    policyVersion: "v1",
    decisionType: "quality_gate",
    fallback,
    level: "soft" as const,
  });

  it("computes the deterministic signals and asks the decision layer", async () => {
    let seen: Record<string, any> | null = null;
    const port = createJevQualityGate({
      decide: (async (input: Record<string, any>) => {
        seen = input;
        return engineResult("approve", 0.8);
      }) as never,
    });

    const outcome = await port.review({
      artifactId: 11,
      userId: 1,
      format: "x_post",
      channel: "x",
      payload: { text: "Karpenter bin-packing cut idle EKS nodes 40% at 2 vCPU requests." },
    });

    assert.equal(outcome.outcome, "approve");
    assert.equal(seen?.type, "quality_gate");
    assert.deepEqual(seen?.refs, { artifactId: 11 });
    assert.equal(seen?.userId, 1);
    // Signals are real evidence, not a placeholder.
    assert.ok(seen!.state.quality.signals.specificity > 0);
    assert.ok(seen!.state.quality.signals.word_count > 0);
    // The platform's cap comes from the format profile.
    assert.equal(seen!.state.platform.maxCharacters, 280);
    assert.equal(seen!.state.platform.format, "x_post");
    assert.equal(outcome.policyVersion, "v1");
  });

  it("flags boilerplate content through the signals", async () => {
    let seen: Record<string, any> | null = null;
    const port = createJevQualityGate({
      decide: (async (input: Record<string, any>) => {
        seen = input;
        return engineResult("revise", 0.4);
      }) as never,
    });

    const outcome = await port.review({
      artifactId: 12,
      format: "x_post",
      channel: "x",
      payload: {
        text: "In today's fast-paced world, let's dive in — this game-changing approach unlocks the power of the cloud. Moreover, in the realm of tech, we delve into the tapestry.",
      },
    });

    assert.equal(outcome.outcome, "revise");
    assert.ok(seen!.state.quality.flags.includes("boilerplate_heavy"));
    assert.ok(outcome.flags.includes("boilerplate_heavy"));
  });

  it("carries a hold through unchanged", async () => {
    const port = createJevQualityGate({
      decide: (async () => engineResult("hold", null, true)) as never,
    });
    const outcome = await port.review({ artifactId: 1, format: "x_post", channel: "x", payload: { text: "hi" } });
    assert.equal(outcome.outcome, "hold");
    assert.equal(outcome.fallback, true);
    assert.equal(outcome.score, null);
  });
});
