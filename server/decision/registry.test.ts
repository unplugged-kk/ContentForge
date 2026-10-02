/**
 * Registry, policy and schema invariants.
 *
 * These are the structural guarantees the rest of the system leans on: a
 * decision type cannot exist without a definition, every decision is validated
 * before it leaves the engine, and every fallback is non-destructive.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DECISION_TYPES, decisionPolicy } from "./policies";
import { DECISION_REGISTRY, getDecisionDefinition } from "./registry";
import { validateDecision, type TriageDecision } from "./schemas";

describe("decision registry", () => {
  it("covers every declared decision type", () => {
    assert.deepEqual(Object.keys(DECISION_REGISTRY).sort(), [...DECISION_TYPES].sort());
  });

  it("every definition is self-consistent and carries policy identity", () => {
    for (const type of DECISION_TYPES) {
      const definition = getDecisionDefinition(type);
      const policy = decisionPolicy(type);
      assert.equal(definition.type, type);
      assert.ok(policy.id.length > 0, `${type} needs a policy id`);
      assert.ok(policy.version.length > 0, `${type} needs a policy version`);
      assert.ok(policy.fallback.length > 0, `${type} needs a declared fallback class`);
    }
  });

  it("research_depth asks a choice with STRING instructions and an OBJECT criteria set", () => {
    // Jev's verified contract: the criteria object's KEYS are the option set.
    const questions = getDecisionDefinition("research_depth").buildQuestions({ state: {} });
    const question = questions.depth;
    assert.equal(question.type, "choice");
    assert.equal(typeof question.instructions, "string");
    assert.deepEqual(Object.keys(question.criteria as object), ["quick", "standard", "deep"]);
  });
});

describe("declared fallbacks are non-destructive", () => {
  it("research_triage keeps every candidate (fail-open on an outage)", () => {
    const fallback = getDecisionDefinition("research_triage").fallback(
      { state: { candidates: [{ title: "a" }, { title: "b" }] } },
      "test",
    ) as TriageDecision;
    assert.deepEqual(fallback.keep, [0, 1]);
    assert.deepEqual(fallback.drop, []);
    assert.equal(fallback.action, "proceed");
  });

  it("opportunity_score never fabricates a score", () => {
    assert.deepEqual(
      getDecisionDefinition("opportunity_score").fallback({ state: {} }, "test"),
      { score: null, band: "unknown" },
    );
  });

  it("research_depth honours the caller's request", () => {
    assert.deepEqual(
      getDecisionDefinition("research_depth").fallback({ state: { requestedDepth: "quick" } }, "test"),
      { depth: "quick" },
    );
    assert.deepEqual(getDecisionDefinition("research_depth").fallback({ state: {} }, "test"), {
      depth: "standard",
    });
  });
});

describe("decision schemas", () => {
  it("accepts well-formed decisions", () => {
    assert.deepEqual(validateDecision("research_depth", { depth: "deep" }), { depth: "deep" });
  });

  it("rejects malformed decisions so they never reach a caller", () => {
    assert.throws(() =>
      validateDecision("research_triage", { action: "proceed", keep: [-1], drop: [], perCandidate: [] }),
    );
    assert.throws(() => validateDecision("research_depth", { depth: "medium" }));
    assert.throws(() => validateDecision("opportunity_score", { score: 2, band: "high" }));
    assert.throws(() => validateDecision("opportunity_score", { score: 0.5, band: "extreme" }));
  });
});
