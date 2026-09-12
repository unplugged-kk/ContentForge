import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidJobEnvelopeError,
  JOB_ENVELOPE_SCHEMA_VERSION,
  createJobEnvelope,
  isJobEnvelope,
  parseJobEnvelope,
  withAttempt,
} from "./envelope";

describe("job envelope", () => {
  it("creates a valid envelope with defaults", () => {
    const envelope = createJobEnvelope({
      jobType: "research.run",
      payload: { topic: "kubernetes" },
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
      jobId: "job-1",
    });

    assert.equal(envelope.jobId, "job-1");
    assert.equal(envelope.jobType, "research.run");
    assert.equal(envelope.schemaVersion, JOB_ENVELOPE_SCHEMA_VERSION);
    assert.equal(envelope.correlationId, "corr-1");
    assert.equal(envelope.idempotencyKey, "idem-1");
    assert.equal(envelope.createdAt, "2026-09-10T00:00:00.000Z");
    assert.equal(envelope.attempt, 1);
    assert.deepEqual(envelope.payload, { topic: "kubernetes" });
  });

  it("generates unique job ids", () => {
    const a = createJobEnvelope({
      jobType: "t",
      payload: {},
      correlationId: "c",
      idempotencyKey: "k",
    });
    const b = createJobEnvelope({
      jobType: "t",
      payload: {},
      correlationId: "c",
      idempotencyKey: "k",
    });
    assert.notEqual(a.jobId, b.jobId);
  });

  it("survives a JSON round-trip", () => {
    const envelope = createJobEnvelope({
      jobType: "publish.x",
      payload: { artifactId: 42 },
      correlationId: "corr",
      idempotencyKey: "idem",
    });
    const parsed = parseJobEnvelope(JSON.parse(JSON.stringify(envelope)));
    assert.deepEqual(parsed, envelope);
  });

  it("rejects a malformed envelope and reports every issue", () => {
    assert.throws(
      () => parseJobEnvelope({ jobType: "" }),
      (error: unknown) => {
        assert.ok(error instanceof InvalidJobEnvelopeError);
        assert.ok(error.issues.length >= 3);
        return true;
      },
    );
  });

  it("rejects a non-object payload", () => {
    assert.throws(() => parseJobEnvelope("nope"), InvalidJobEnvelopeError);
    assert.throws(() => parseJobEnvelope(null), InvalidJobEnvelopeError);
  });

  it("rejects a non-ISO createdAt", () => {
    const envelope = createJobEnvelope({
      jobType: "t",
      payload: {},
      correlationId: "c",
      idempotencyKey: "k",
    });
    assert.throws(
      () => parseJobEnvelope({ ...envelope, createdAt: "yesterday" }),
      InvalidJobEnvelopeError,
    );
  });

  it("guards with isJobEnvelope", () => {
    const envelope = createJobEnvelope({
      jobType: "t",
      payload: {},
      correlationId: "c",
      idempotencyKey: "k",
    });
    assert.equal(isJobEnvelope(envelope), true);
    assert.equal(isJobEnvelope({}), false);
  });

  it("stamps the executing attempt and clamps invalid values", () => {
    const envelope = createJobEnvelope({
      jobType: "t",
      payload: {},
      correlationId: "c",
      idempotencyKey: "k",
    });
    assert.equal(withAttempt(envelope, 3).attempt, 3);
    assert.equal(withAttempt(envelope, 0).attempt, 1);
    assert.equal(withAttempt(envelope, -5).attempt, 1);
    assert.equal(withAttempt(envelope, 2.7).attempt, 2);
    assert.equal(envelope.attempt, 1, "original envelope is not mutated");
  });
});
