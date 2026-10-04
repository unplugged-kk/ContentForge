/**
 * F5 — a dead generation must not leave its run looking alive.
 *
 * The run settled only on a later scheduler tick: the generation was marked
 * failed, the job dead-lettered, and the owning run stayed `running` for
 * minutes. The fix nudges the run from the failure path, but ONLY when the
 * failure is terminal — a retryable failure must leave the run waiting, since
 * its job is about to be retried and may still succeed.
 *
 * These are the pure decision helpers; the end-to-end behaviour (dead-letter →
 * run settled in the same tick) is exercised against the real app and database.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTerminalGenerationFailure, shouldNudgeRun } from "./generationFailure";

describe("isTerminalGenerationFailure", () => {
  it("treats retryable failures as non-terminal — the run must keep waiting", () => {
    assert.equal(isTerminalGenerationFailure("transient"), false);
    assert.equal(isTerminalGenerationFailure("rate_limited"), false);
  });

  it("treats dead-lettering failures as terminal", () => {
    assert.equal(isTerminalGenerationFailure("permanent"), true);
    assert.equal(isTerminalGenerationFailure("policy_human"), true);
    assert.equal(isTerminalGenerationFailure("configuration"), true);
    assert.equal(isTerminalGenerationFailure("quota"), true);
    assert.equal(isTerminalGenerationFailure("unknown"), true);
  });

  it("is exhaustive over the declared failure classes", () => {
    // The default in the handler is "transient", and every other class the
    // provider layer can produce must dead-letter — so only the two retryable
    // names may return false.
    const retryable = ["transient", "rate_limited"];
    for (const name of ["permanent", "policy_human", "configuration", "quota", "unknown"]) {
      assert.ok(!retryable.includes(name), `${name} must not be retryable`);
      assert.equal(isTerminalGenerationFailure(name), true);
    }
  });
});

describe("shouldNudgeRun", () => {
  it("nudges only an unfinished run", () => {
    assert.equal(shouldNudgeRun("pending"), true);
    assert.equal(shouldNudgeRun("running"), true);
  });

  it("leaves a settled run exactly as it is", () => {
    for (const status of ["succeeded", "failed", "partial", "cancelled"]) {
      assert.equal(shouldNudgeRun(status), false, `${status} must not be re-advanced`);
    }
  });
});
