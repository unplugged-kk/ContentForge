/**
 * Unit tests for the deterministic autonomy controller's pure gates
 * (Phase 29.4). DB-dependent gates (budget queries, ownership, config
 * persistence) are covered by autonomy.dbtest.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { meetsMinimumEvidence, cooldownElapsed, detectOscillation, countConsecutiveAutonomous } from "./controller";
import { assertAllowedPolicyFields, ForbiddenPolicyFieldError } from "./policyFieldAllowlist";

describe("meetsMinimumEvidence (Phase 29.4 §24)", () => {
  it("never allows insufficient_data or observed or directional, regardless of config", () => {
    assert.equal(meetsMinimumEvidence("insufficient_data", "insufficient_data"), false);
    assert.equal(meetsMinimumEvidence("observed", "observed"), false);
    assert.equal(meetsMinimumEvidence("directional", "directional"), false);
  });
  it("allows repeatable when the hard floor is repeatable", () => {
    assert.equal(meetsMinimumEvidence("repeatable", "repeatable"), true);
  });
  it("respects a stricter configured minimum than the hard floor", () => {
    assert.equal(meetsMinimumEvidence("repeatable", "confirmed"), false);
    assert.equal(meetsMinimumEvidence("confirmed", "confirmed"), true);
  });
  it("a looser configured minimum than the hard floor still enforces the hard floor", () => {
    assert.equal(meetsMinimumEvidence("directional", "observed"), false);
  });
});

describe("cooldownElapsed (Phase 29.4 §23)", () => {
  const now = 1_000_000_000;
  it("denies immediately after activation", () => {
    assert.equal(cooldownElapsed(new Date(now - 1000), 60, now), false);
  });
  it("allows once the exact window has elapsed", () => {
    assert.equal(cooldownElapsed(new Date(now - 60 * 60 * 1000), 60, now), true);
  });
  it("allows well after the window", () => {
    assert.equal(cooldownElapsed(new Date(now - 2 * 60 * 60 * 1000), 60, now), true);
  });
});

describe("detectOscillation (Phase 29.4 §28)", () => {
  it("detects a strict A/B/A/B pattern (newest first)", () => {
    const events = [{ activatedPolicyId: 1 }, { activatedPolicyId: 2 }, { activatedPolicyId: 1 }, { activatedPolicyId: 2 }];
    assert.equal(detectOscillation(events), true);
  });
  it("does not flag steady forward progress A->B->C->D", () => {
    const events = [{ activatedPolicyId: 4 }, { activatedPolicyId: 3 }, { activatedPolicyId: 2 }, { activatedPolicyId: 1 }];
    assert.equal(detectOscillation(events), false);
  });
  it("does not flag fewer than 4 events", () => {
    assert.equal(detectOscillation([{ activatedPolicyId: 1 }, { activatedPolicyId: 2 }]), false);
  });
  it("does not flag a single repeated policy id (not oscillation, just idle)", () => {
    const events = [{ activatedPolicyId: 1 }, { activatedPolicyId: 1 }, { activatedPolicyId: 1 }, { activatedPolicyId: 1 }];
    assert.equal(detectOscillation(events), false);
  });
});

describe("countConsecutiveAutonomous (Phase 29.4 §28/§31)", () => {
  it("counts a run of autonomous actor events until a human event breaks it", () => {
    const events = [
      { actor: "autonomous_controller" },
      { actor: "autonomous_controller" },
      { actor: "human" },
      { actor: "autonomous_controller" },
    ];
    assert.equal(countConsecutiveAutonomous(events), 2);
  });
  it("is zero when the most recent event is human", () => {
    assert.equal(countConsecutiveAutonomous([{ actor: "human" }, { actor: "autonomous_controller" }]), 0);
  });
  it("is the full length when every event is autonomous", () => {
    assert.equal(countConsecutiveAutonomous([{ actor: "autonomous_controller" }, { actor: "autonomous_controller" }]), 2);
  });
});

describe("assertAllowedPolicyFields (Phase 29.4 §12)", () => {
  it("passes for the real allowlisted fields consumed by GenerationDeps", () => {
    assert.doesNotThrow(() =>
      assertAllowedPolicyFields({ voiceId: "v1", templateId: "t1", objective: "o", audience: "a", constraints: {}, model: "m" }),
    );
  });
  it("passes for an empty configuration", () => {
    assert.doesNotThrow(() => assertAllowedPolicyFields({}));
  });
  it("rejects a credential-shaped field", () => {
    assert.throws(() => assertAllowedPolicyFields({ apiKey: "secret" }), (err) => {
      assert.ok(err instanceof ForbiddenPolicyFieldError);
      assert.deepEqual(err.fields, ["apiKey"]);
      return true;
    });
  });
  it("rejects an attempt to smuggle autonomy config or ownership changes through a policy field", () => {
    assert.throws(() => assertAllowedPolicyFields({ userId: 999, autonomyConfig: { enabled: true } }), ForbiddenPolicyFieldError);
  });
  it("rejects when only ONE of several fields is forbidden, and lists it precisely", () => {
    assert.throws(() => assertAllowedPolicyFields({ voiceId: "v1", refreshToken: "x" }), (err) => {
      assert.ok(err instanceof ForbiddenPolicyFieldError);
      assert.deepEqual(err.fields, ["refreshToken"]);
      return true;
    });
  });
});
