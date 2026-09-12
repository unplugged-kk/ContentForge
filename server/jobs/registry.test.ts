import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { z } from "zod";
import {
  DEFAULT_QUEUE_CONFIG,
  JobNotRegisteredError,
  getJob,
  hasJob,
  listJobs,
  registerJob,
  resetJobRegistry,
  resolveQueueConfig,
} from "./registry";

function define(jobType: string) {
  return {
    jobType,
    payloadSchema: z.object({ value: z.string() }),
    handler: async () => {},
  };
}

describe("job registry", () => {
  beforeEach(() => resetJobRegistry());

  it("registers and resolves a job type", () => {
    registerJob(define("research.run"));
    assert.equal(hasJob("research.run"), true);
    assert.equal(getJob("research.run").jobType, "research.run");
  });

  it("rejects duplicate registration", () => {
    registerJob(define("publish.x"));
    assert.throws(() => registerJob(define("publish.x")), /already registered/);
  });

  it("rejects an empty job type", () => {
    assert.throws(() => registerJob(define("")), /jobType is required/);
  });

  it("throws a typed error for an unknown job type", () => {
    assert.throws(() => getJob("nope"), JobNotRegisteredError);
    assert.equal(hasJob("nope"), false);
  });

  it("lists every registered job type", () => {
    registerJob(define("a"));
    registerJob(define("b"));
    assert.deepEqual(
      listJobs()
        .map((j) => j.jobType)
        .sort(),
      ["a", "b"],
    );
  });

  it("defaults queue configuration and derives a dead-letter queue", () => {
    const definition = define("generation.run");
    const config = resolveQueueConfig(definition);
    assert.equal(config.retryLimit, DEFAULT_QUEUE_CONFIG.retryLimit);
    assert.equal(config.deadLetter, "generation.run.dlq");
  });

  it("honours per-job queue overrides", () => {
    const definition = {
      ...define("publish.x"),
      queue: { retryLimit: 5, deadLetter: "custom.dlq" },
    };
    const config = resolveQueueConfig(definition);
    assert.equal(config.retryLimit, 5);
    assert.equal(config.deadLetter, "custom.dlq");
    assert.equal(config.retryBackoff, true, "unset fields fall back to defaults");
  });
});
