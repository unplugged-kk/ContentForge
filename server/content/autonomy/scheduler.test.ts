/**
 * Phase 31 §13/§26/§27 — scheduler unit + static boundary tests.
 *
 * - Idempotency keys are deterministic (same inputs → same key; hour-bucketed;
 *   never random).
 * - Cadence constant is the documented 6h reconcile (not high-frequency).
 * - INVARIANT 2/8 (static): the scheduler modules never import policy
 *   mutation, experiment selection/creation, or RL/bandit machinery — they
 *   may only read config/candidates and invoke the controller + job infra.
 * - INVARIANT 8 (static): the agent tier never references the scheduler job
 *   or its registration (no tool path to autonomous execution).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  AUTONOMY_EVALUATE_JOB_TYPE,
  AUTONOMY_EVALUATE_SINGLETON_SECONDS,
  AUTONOMY_EVALUATE_SWEEP_LIMIT,
  autonomyEvaluateIdempotencyKey,
  autonomyEvaluatePayloadSchema,
} from "./job";
import { AUTONOMY_SCHEDULER_CRON } from "./scheduler";

const AUTONOMY_DIR = dirname(fileURLToPath(import.meta.url));

describe("autonomy.evaluate job contract", () => {
  it("uses the documented job type", () => {
    assert.equal(AUTONOMY_EVALUATE_JOB_TYPE, "autonomy.evaluate");
  });

  it("singleton window matches the slow-moving evaluation cadence", () => {
    assert.equal(AUTONOMY_EVALUATE_SINGLETON_SECONDS, 3600);
  });

  it("sweep fan-out is bounded", () => {
    assert.ok(AUTONOMY_EVALUATE_SWEEP_LIMIT > 0 && AUTONOMY_EVALUATE_SWEEP_LIMIT <= 100);
  });

  it("payload accepts IDs only (no policy objects, blobs, or secrets)", () => {
    const ok = autonomyEvaluatePayloadSchema.safeParse({
      ownerId: 7,
      targetScope: "channel:x;format:post",
      correlationId: "c",
    });
    assert.equal(ok.success, true);
    const bad = autonomyEvaluatePayloadSchema.safeParse({
      ownerId: 7,
      targetScope: "channel:x;format:post",
      correlationId: "c",
      policy: { objective: "x" },
    });
    assert.equal(bad.success, false);
  });

  it("idempotency keys are deterministic and hour-bucketed", () => {
    const at = new Date("2026-09-21T10:15:00Z");
    const a = autonomyEvaluateIdempotencyKey(7, "channel:x;format:post", undefined, at);
    const b = autonomyEvaluateIdempotencyKey(7, "channel:x;format:post", undefined, at);
    assert.equal(a, b);
    assert.ok(a.includes(":sweep:20260921T10"), a);
    const c = autonomyEvaluateIdempotencyKey(7, "channel:x;format:post", 42, at);
    assert.ok(c.includes(":c42:"), c);
    assert.notEqual(a, c);
    const later = autonomyEvaluateIdempotencyKey(
      7,
      "channel:x;format:post",
      undefined,
      new Date("2026-09-21T11:05:00Z"),
    );
    assert.notEqual(a, later);
  });

  it("reconcile cadence is the documented 6h tick", () => {
    assert.equal(AUTONOMY_SCHEDULER_CRON, "0 */6 * * *");
  });
});

describe("scheduler static boundaries (Phase 31 invariants 2/8)", () => {
  const SCHEDULER_FILES = ["job.ts", "scheduler.ts"].map((f) =>
    readFileSync(join(AUTONOMY_DIR, f), "utf8"),
  );

  it("scheduler modules never mutate generation policies", () => {
    for (const [i, text] of SCHEDULER_FILES.entries()) {
      for (const forbidden of [
        "generationPolicies)",
        ".set(",
        "updateGenerationPolicy",
        "insertPolicy",
        "activatePolicyCandidate",
        "rollbackPolicyForCandidate",
      ]) {
        // activatePolicyCandidate/rollbackPolicyForCandidate belong to the
        // controller + 29.3 service only; the scheduler must not call them.
        if (forbidden === ".set(") continue; // too generic; covered by the rest
        assert.ok(
          !text.includes(forbidden),
          `scheduler file ${i} must not contain ${forbidden}`,
        );
      }
    }
  });

  it("scheduler modules never select/create experiments or do RL/bandits", () => {
    for (const [i, text] of SCHEDULER_FILES.entries()) {
      for (const forbidden of [
        "createExperiment",
        "selectExperiment",
        "assignExperiment",
        "chooseVariant",
        "bandit",
        "reinforcement",
        "train(",
        "updateModel",
      ]) {
        assert.ok(
          !text.includes(forbidden),
          `scheduler file ${i} must not contain ${forbidden}`,
        );
      }
    }
  });

  it("scheduler modules invoke only the canonical controller entry point", () => {
    const jobText = SCHEDULER_FILES[0];
    assert.ok(
      jobText.includes("executeAutonomousActivation"),
      "job handler must invoke executeAutonomousActivation",
    );
    for (const forbidden of [
      "evaluateScheduledEligibility",
      "evaluateBackgroundEligibility",
      "evaluateCronEligibility",
    ]) {
      assert.ok(!jobText.includes(forbidden), `no duplicate controller ${forbidden}`);
    }
  });

  it("agent tier never references the scheduler job", () => {
    const agentDir = join(dirname(AUTONOMY_DIR), "..", "agent");
    const offenders: string[] = [];
    for (const file of readdirSync(agentDir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".dbtest.ts"),
    )) {
      const text = readFileSync(join(agentDir, file), "utf8");
      if (/autonomy\.evaluate|autonomy\/(job|scheduler)|registerAutonomyEvaluateJob|enqueueAutonomyEvaluation|notifyCandidateApproved/.test(text)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], `agent files must never reach the scheduler: ${offenders.join(", ")}`);
  });
});
