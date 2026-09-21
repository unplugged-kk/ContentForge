/**
 * Unit tests for the research.run job type: payload validation, registration,
 * and the mapping from engine outcome to queue failure class. No database.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { ResearchJob } from "@shared/schema";
import { JobFailure } from "../jobs/failures";
import {
  getJob,
  hasJob,
  resetJobRegistry,
  type JobContext,
} from "../jobs/registry";
import type { ResearchRunResult } from "./engine";
import {
  RESEARCH_RUN_JOB_TYPE,
  createResearchRunHandler,
  registerResearchRunJob,
  researchInputForJob,
  researchRunPayloadSchema,
  type ResearchRunEngine,
  type ResearchRunDeps,
} from "./job";

function fakeJob(overrides: Partial<ResearchJob> = {}): ResearchJob {
  return {
    id: 7,
    userId: 1,
    correlationId: "corr-7",
    idempotencyKey: "idem-7",
    kind: "directed",
    query: "kubernetes",
    status: "queued",
    initiation: {},
    diagnostics: [],
    providerIds: ["rss"],
    errorClass: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as ResearchJob;
}

function fakeCtx(): JobContext {
  return {
    jobId: "queue-1",
    jobType: RESEARCH_RUN_JOB_TYPE,
    correlationId: "corr-7",
    attempt: 1,
    maxAttempts: 4,
    idempotencyKey: "idem-7",
    signal: AbortSignal.timeout(5_000),
    logger: { info() {}, warn() {}, error() {} },
  };
}

function engineReturning(result: Partial<ResearchRunResult>): ResearchRunEngine {
  return {
    async executeJob(job) {
      return {
        jobId: job.id,
        correlationId: job.correlationId,
        status: "complete",
        reused: false,
        sourceCount: 1,
        evidenceCount: 1,
        droppedCount: 0,
        dropped: [],
        diagnostics: [],
        ...result,
      } as ResearchRunResult;
    },
  };
}

function depsWith(
  job: ResearchJob | undefined,
  engine: ResearchRunEngine,
): ResearchRunDeps {
  return { engine, storage: { async getJob() { return job; } } };
}

afterEach(() => resetJobRegistry());

describe("research.run payload", () => {
  it("accepts a positive jobId", () => {
    assert.deepEqual(researchRunPayloadSchema.parse({ jobId: 12 }), { jobId: 12 });
  });

  it("rejects a missing or non-positive jobId", () => {
    assert.equal(researchRunPayloadSchema.safeParse({}).success, false);
    assert.equal(researchRunPayloadSchema.safeParse({ jobId: 0 }).success, false);
    assert.equal(researchRunPayloadSchema.safeParse({ jobId: "x" }).success, false);
  });
});

describe("research.run registration", () => {
  it("registers the job type with its payload schema", () => {
    registerResearchRunJob(depsWith(fakeJob(), engineReturning({})));
    assert.equal(hasJob(RESEARCH_RUN_JOB_TYPE), true);
    assert.equal(getJob(RESEARCH_RUN_JOB_TYPE).jobType, RESEARCH_RUN_JOB_TYPE);
  });

  it("is idempotent", () => {
    registerResearchRunJob(depsWith(fakeJob(), engineReturning({})));
    registerResearchRunJob(depsWith(fakeJob(), engineReturning({})));
    assert.equal(hasJob(RESEARCH_RUN_JOB_TYPE), true);
  });
});

describe("research.run handler", () => {
  it("resolves cleanly when research completes", async () => {
    const handler = createResearchRunHandler(
      depsWith(fakeJob(), engineReturning({ status: "complete" })),
    );
    await handler({ jobId: 7 }, fakeCtx());
  });

  it("fails permanently when the job does not exist", async () => {
    const handler = createResearchRunHandler(
      depsWith(undefined, engineReturning({})),
    );
    await assert.rejects(
      () => handler({ jobId: 7 }, fakeCtx()),
      (error: unknown) =>
        error instanceof JobFailure && error.failureClass === "permanent",
    );
  });

  it("is a no-op when the job is already complete (duplicate delivery)", async () => {
    let called = false;
    const engine: ResearchRunEngine = {
      async executeJob(job) {
        called = true;
        return { jobId: job.id, correlationId: job.correlationId, status: "complete", reused: true, sourceCount: 0, evidenceCount: 0, droppedCount: 0, dropped: [], diagnostics: [] };
      },
    };
    const handler = createResearchRunHandler(
      depsWith(fakeJob({ status: "complete" }), engine),
    );
    await handler({ jobId: 7 }, fakeCtx());
    assert.equal(called, false);
  });

  it("maps a transient failure to a retryable JobFailure", async () => {
    const handler = createResearchRunHandler(
      depsWith(
        fakeJob(),
        engineReturning({ status: "failed", failureClass: "transient", failureMessage: "feed down" }),
      ),
    );
    await assert.rejects(
      () => handler({ jobId: 7 }, fakeCtx()),
      (error: unknown) =>
        error instanceof JobFailure &&
        error.failureClass === "transient" &&
        error.message === "feed down",
    );
  });

  it("maps a rate_limited failure to a reschedulable JobFailure", async () => {
    const handler = createResearchRunHandler(
      depsWith(
        fakeJob(),
        engineReturning({ status: "failed", failureClass: "rate_limited", failureMessage: "slow down" }),
      ),
    );
    await assert.rejects(
      () => handler({ jobId: 7 }, fakeCtx()),
      (error: unknown) =>
        error instanceof JobFailure && error.failureClass === "rate_limited",
    );
  });

  it("maps a permanent failure to a terminal JobFailure", async () => {
    const handler = createResearchRunHandler(
      depsWith(
        fakeJob(),
        engineReturning({ status: "failed", failureClass: "permanent", failureMessage: "no evidence" }),
      ),
    );
    await assert.rejects(
      () => handler({ jobId: 7 }, fakeCtx()),
      (error: unknown) =>
        error instanceof JobFailure && error.failureClass === "permanent",
    );
  });

  it("maps policy_human to a terminal JobFailure", async () => {
    const handler = createResearchRunHandler(
      depsWith(
        fakeJob(),
        engineReturning({ status: "failed", failureClass: "policy_human", failureMessage: "needs a human" }),
      ),
    );
    await assert.rejects(
      () => handler({ jobId: 7 }, fakeCtx()),
      (error: unknown) =>
        error instanceof JobFailure && error.failureClass === "policy_human",
    );
  });
});

describe("researchInputForJob", () => {
  it("reconstructs the engine input from the persisted job", () => {
    const job = fakeJob({
      kind: "human_input",
      query: null,
      initiation: { authorStatement: "we did it", limit: 5 },
    });
    const input = researchInputForJob(job);
    assert.ok(input);
    assert.equal(input!.kind, "human_input");
    assert.equal(input!.authorStatement, "we did it");
    assert.equal(input!.limit, 5);
    assert.equal(input!.correlationId, "corr-7");
    assert.deepEqual(input!.providerIds, ["rss"]);
  });

  it("returns null for a missing job", () => {
    assert.equal(researchInputForJob(undefined), null);
  });
});
