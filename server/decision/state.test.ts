/**
 * State normalization and the hard/soft boundary.
 *
 * The state is what a decision sees, so these tests cover the two properties
 * that matter: it is BOUNDED and WHITELISTED (nothing large or secret slips
 * through), and its hash is stable (a decision stays reproducible).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashState, normalizeState } from "./state";
import { assertHardConstraints, hardConstraintViolations, HARD_GATE_INVARIANTS } from "./validator";

describe("normalizeState", () => {
  it("drops unknown keys, so a secret can never reach a decision", () => {
    const state = normalizeState({
      topic: { title: "k8s" },
      apiKey: "sk-secret",
      session: { token: "xyz" },
      headers: { authorization: "Bearer abc" },
    });
    assert.deepEqual(Object.keys(state), ["topic"]);
    assert.equal(JSON.stringify(state).includes("sk-secret"), false);
    assert.equal(JSON.stringify(state).includes("Bearer abc"), false);
  });

  it("clips long strings and caps arrays", () => {
    const state = normalizeState({
      topic: { title: "x".repeat(5000) },
      candidates: Array.from({ length: 300 }, (_value, index) => ({ title: `t${index}` })),
    });
    assert.ok((state.topic?.title ?? "").length <= 2000);
    assert.equal(state.candidates?.length, 200);
  });

  it("drops candidates with no usable title", () => {
    const state = normalizeState({
      candidates: [{ title: "  " }, { title: "ok" }, { summary: "no title" }],
    });
    assert.equal(state.candidates?.length, 1);
    assert.equal(state.candidates?.[0].title, "ok");
  });

  it("bounds evidence and keeps its identifiers", () => {
    const state = normalizeState({
      research: {
        jobId: 5,
        evidence: Array.from({ length: 20 }, (_value, index) => ({ id: index, excerpt: `e${index}` })),
      },
    });
    assert.equal(state.research?.evidence?.length, 5);
    assert.equal(state.research?.jobId, 5);
  });

  it("accepts only known depths", () => {
    assert.equal(normalizeState({ requestedDepth: "deep" }).requestedDepth, "deep");
    assert.equal(normalizeState({ requestedDepth: "galaxy" }).requestedDepth, undefined);
  });

  it("keeps platform limits and hard-constraint booleans it is given", () => {
    const state = normalizeState({
      platform: { channel: "x", format: "x_post", maxCharacters: 280, hookFirst: true },
      constraints: { artifactApproved: false, rateBudgetRemaining: 0 },
    });
    assert.equal(state.platform?.maxCharacters, 280);
    assert.equal(state.platform?.hookFirst, true);
    assert.equal(state.constraints?.artifactApproved, false);
    assert.equal(state.constraints?.rateBudgetRemaining, 0);
  });

  it("returns an empty state for junk input rather than throwing", () => {
    assert.deepEqual(normalizeState(undefined), {});
    assert.deepEqual(normalizeState("nope"), {});
    assert.deepEqual(normalizeState([1, 2, 3]), {});
  });
});

describe("hashState", () => {
  it("is stable across key order and changes with content", () => {
    const a = normalizeState({ topic: { title: "k8s" }, platform: { channel: "x" } });
    const b = normalizeState({ platform: { channel: "x" }, topic: { title: "k8s" } });
    assert.equal(hashState(a), hashState(b));
    assert.notEqual(
      hashState(a),
      hashState(normalizeState({ topic: { title: "eks" }, platform: { channel: "x" } })),
    );
    assert.match(hashState(a), /^[0-9a-f]{64}$/);
  });
});

describe("hard constraints", () => {
  it("reports every violation present in the slice", () => {
    const violations = hardConstraintViolations({
      artifactApproved: false,
      providerCalled: true,
      retryRequested: true,
      rateBudgetRemaining: 0,
    });
    assert.deepEqual(
      [...violations].sort(),
      ["artifact_not_approved", "provider_already_called", "rate_budget_exhausted"].sort(),
    );
  });

  it("is ok when nothing is violated, and vacuous when nothing is asserted", () => {
    assert.deepEqual(assertHardConstraints({ artifactApproved: true }), { ok: true, violations: [] });
    assert.deepEqual(assertHardConstraints(undefined), { ok: true, violations: [] });
    assert.deepEqual(assertHardConstraints({}), { ok: true, violations: [] });
  });

  it("an unapproved artifact fails the gate regardless of any decision", () => {
    assert.equal(assertHardConstraints({ artifactApproved: false }).ok, false);
    assert.ok(HARD_GATE_INVARIANTS.length >= 10, "the invariant list must stay documented");
  });

  it("never lets a retry follow a provider call", () => {
    assert.deepEqual(
      hardConstraintViolations({ providerCalled: true, retryRequested: true }),
      ["provider_already_called"],
    );
    assert.deepEqual(hardConstraintViolations({ providerCalled: true, retryRequested: false }), []);
  });
});
