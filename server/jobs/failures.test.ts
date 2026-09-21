import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JobFailure,
  classifyError,
  describeError,
  dispositionFor,
} from "./failures";

describe("job failures", () => {
  it("maps each failure class to a retry disposition", () => {
    assert.equal(dispositionFor("transient"), "retry");
    assert.equal(dispositionFor("rate_limited"), "reschedule");
    assert.equal(dispositionFor("permanent"), "terminal");
    assert.equal(dispositionFor("policy_human"), "terminal");
  });

  it("constructs typed failures", () => {
    assert.equal(JobFailure.transient("net").failureClass, "transient");
    assert.equal(JobFailure.rateLimited("429", 30_000).retryAfterMs, 30_000);
    assert.equal(JobFailure.permanent("bad input").failureClass, "permanent");
    assert.equal(JobFailure.policyHuman("rejected").failureClass, "policy_human");
  });

  it("treats unknown errors as transient", () => {
    assert.equal(classifyError(new Error("boom")), "transient");
    assert.equal(classifyError("string"), "transient");
    assert.equal(classifyError(undefined), "transient");
  });

  it("preserves the declared class", () => {
    assert.equal(classifyError(JobFailure.permanent("x")), "permanent");
    assert.equal(classifyError(JobFailure.policyHuman("x")), "policy_human");
  });

  it("describes errors without throwing on odd payloads", () => {
    assert.equal(describeError(new Error("boom")), "boom");
    assert.equal(describeError("plain"), "plain");
    assert.equal(describeError({ a: 1 }), '{"a":1}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.equal(describeError(circular), "unknown error");
  });

  it("keeps the cause chain", () => {
    const cause = new Error("root");
    const failure = new JobFailure("transient", "wrapper", { cause });
    assert.equal(failure.cause, cause);
  });
});
