/**
 * Automation API (Phase 13) — the minimum HTTP surface for the automation
 * foundation. No UI is built this phase (§26); these endpoints are enough to
 * create a policy, inspect it, trigger it, and watch the run.
 *
 * The HTTP layer only persists intent and enqueues: `POST /policies/:id/run`
 * writes the AutomationRun and hands the `automation.run` worker a durable id.
 * It never runs research, generation or publication inline — exactly the same
 * contract `POST /api/research/jobs` already has.
 *
 * Ownership: every read and write is owner-scoped IN SQL through
 * `AutomationStoragePort`'s `*ForOwner` methods, and a foreign policy or run is
 * reported as 404 (never 403), so the endpoints do not leak existence — the same
 * non-leaking convention the rest of the API follows (§21).
 */

import { Router } from "express";
import { z } from "zod";
import type { AutomationPolicy, AutomationRun } from "@shared/schema";
import { requireOwnerId } from "../middleware/userContext";
import {
  createAutomationPolicy,
  dispatchAutomationDueRuns,
  summarizeAutomationRun,
  triggerAutomationPolicy,
  updateAutomationPolicy,
  AutomationLimitError,
  AutomationPolicyInactiveError,
  AutomationPolicyInputError,
  AutomationPolicyNotFoundError,
  type AutomationDeps,
} from "./automation";

const createPolicyBody = z.object({
  name: z.string().trim().min(1).max(200),
  status: z.enum(["active", "paused", "archived"]).optional(),
  triggerType: z.enum(["manual", "scheduled"]),
  triggerConfig: z.record(z.unknown()).optional(),
  researchConfig: z.record(z.unknown()),
  /** Bounded: Phase 12's target shape, validated semantically by `repurposeStory`. */
  targets: z.array(z.record(z.unknown())).min(1).max(20),
  generationConfig: z.record(z.unknown()).optional(),
  approvalMode: z.enum(["approval_required", "trusted"]).optional(),
  publicationConfig: z.record(z.unknown()).optional(),
  limits: z.record(z.unknown()).optional(),
});

/** A patch is a partial policy: the service merges it and re-validates as a whole. */
const updatePolicyBody = createPolicyBody.partial();

const triggerBody = z.object({
  /**
   * Logical trigger identity. Supplied → duplicate deliveries of the same
   * request collapse onto ONE run; omitted → each request is a new run
   * (mirrors chat-to-post's optional idempotency key).
   */
  requestKey: z.string().trim().min(1).max(200).optional(),
  /** Explicit intentional rerun: a new run even under the same requestKey. */
  rerun: z.boolean().optional(),
});

// ── serializers ───────────────────────────────────────────────────────────────
const serializePolicy = (policy: AutomationPolicy) => ({
  id: policy.id,
  name: policy.name,
  status: policy.status,
  version: policy.version,
  specHash: policy.specHash,
  triggerType: policy.triggerType,
  triggerConfig: policy.triggerConfig,
  researchConfig: policy.researchConfig,
  targets: policy.targets,
  generationConfig: policy.generationConfig,
  approvalMode: policy.approvalMode,
  publicationConfig: policy.publicationConfig,
  limits: policy.limits,
  createdAt: policy.createdAt,
  updatedAt: policy.updatedAt,
});

const serializeRun = (run: AutomationRun) => ({
  id: run.id,
  policyId: run.policyId,
  /** The FROZEN policy revision this run executes — never the current one. */
  policyVersion: run.policyVersion,
  policySpecHash: run.policySpecHash,
  triggerType: run.triggerType,
  triggerIdentity: run.idempotencyKey,
  status: run.status,
  researchJobId: run.researchJobId,
  outcomes: run.outcomes,
  errorClass: run.errorClass,
  errorMessage: run.errorMessage,
  attempt: run.attempt,
  correlationId: run.correlationId,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
});

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function writeError(error: unknown, res: import("express").Response): boolean {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      message: error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join(", "),
    });
    return true;
  }
  if (error instanceof AutomationPolicyInputError) {
    res.status(400).json({ message: error.message, issues: error.issues });
    return true;
  }
  if (error instanceof AutomationPolicyNotFoundError) {
    res.status(404).json({ message: error.message });
    return true;
  }
  if (error instanceof AutomationPolicyInactiveError) {
    res.status(409).json({ message: error.message });
    return true;
  }
  if (error instanceof AutomationLimitError) {
    res.status(429).json({ message: error.message });
    return true;
  }
  return false;
}

export function createAutomationRouter(deps: AutomationDeps): Router {
  const router = Router();

  // ── Policies ────────────────────────────────────────────────────────────────
  router.post("/policies", async (req, res, next) => {
    try {
      const body = createPolicyBody.parse(req.body ?? {});
      const policy = await createAutomationPolicy(requireOwnerId(req), body, deps);
      return res.status(201).json(serializePolicy(policy));
    } catch (error) {
      if (writeError(error, res)) return;
      return next(error);
    }
  });

  router.get("/policies", async (req, res, next) => {
    const requested = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 50;
    try {
      const policies = await deps.automation.listAutomationPoliciesForOwner(requireOwnerId(req), limit);
      return res.json(policies.map(serializePolicy));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/policies/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid automation policy id" });
    try {
      const policy = await deps.automation.getAutomationPolicyForOwner(id, requireOwnerId(req));
      if (!policy) return res.status(404).json({ message: "Automation policy not found" });
      const runs = await deps.automation.listAutomationRunsForPolicy(policy.id, 10);
      return res.json({
        ...serializePolicy(policy),
        recentRuns: runs.map((run) => ({ id: run.id, status: run.status, policyVersion: run.policyVersion })),
      });
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Mutate a policy. This produces a NEW revision (`version` advances) and never
   * touches an existing AutomationRun — each run already holds its own frozen
   * `policySnapshot`, so v1's behaviour is preserved (§20).
   */
  router.patch("/policies/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid automation policy id" });
    try {
      const body = updatePolicyBody.parse(req.body ?? {});
      const policy = await updateAutomationPolicy(id, requireOwnerId(req), body, deps);
      return res.json(serializePolicy(policy));
    } catch (error) {
      if (writeError(error, res)) return;
      return next(error);
    }
  });

  /**
   * Manual trigger — the path that proves the whole orchestration without any
   * background clock. Duplicate deliveries carrying the same `requestKey`
   * collapse onto ONE run; `rerun: true` is a deliberate new execution.
   */
  router.post("/policies/:id/run", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid automation policy id" });
    try {
      const body = triggerBody.parse(req.body ?? {});
      const result = await triggerAutomationPolicy(id, requireOwnerId(req), body, deps);
      return res.status(result.created ? 202 : 200).json({
        runId: result.run.id,
        policyId: result.run.policyId,
        policyVersion: result.run.policyVersion,
        status: result.run.status,
        triggerType: result.run.triggerType,
        correlationId: result.run.correlationId,
        created: result.created,
        enqueued: result.enqueued,
      });
    } catch (error) {
      if (writeError(error, res)) return;
      return next(error);
    }
  });

  // ── Runs ────────────────────────────────────────────────────────────────────
  router.get("/runs", async (req, res, next) => {
    const requested = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 50;
    try {
      const runs = await deps.automation.listAutomationRunsForOwner(requireOwnerId(req), limit);
      return res.json(runs.map(serializeRun));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Inspect a run. Beyond the run's own durable fields this derives the
   * downstream picture (artifact readiness, schedule, publication, result)
   * straight from the entities that own it — so a future notification layer can
   * answer "awaiting approval / completed / publication unknown" without logs
   * becoming the source of truth (§25/§33).
   */
  router.get("/runs/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid automation run id" });
    try {
      const run = await deps.automation.getAutomationRunForOwner(id, requireOwnerId(req));
      if (!run) return res.status(404).json({ message: "Automation run not found" });
      const summary = await summarizeAutomationRun(run, deps);
      return res.json({ ...serializeRun(run), summary });
    } catch (error) {
      return next(error);
    }
  });

  // ── Deterministic tick ──────────────────────────────────────────────────────
  /**
   * One automation tick, identical to the periodic content-scheduler tick: create
   * runs for due scheduled policies, then enqueue the advance worker for every
   * unfinished run. Exposed so operators and tests can drive automation
   * deterministically — the same reason `/api/publications/dispatch` exists.
   */
  router.post("/tick", async (_req, res, next) => {
    try {
      const result = await dispatchAutomationDueRuns(new Date(), deps, 100);
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

/** Router wired to the application's automation composition root. */
export async function createDefaultAutomationRouter(): Promise<Router> {
  const { automationDeps, registerContentJobs } = await import("./service");
  registerContentJobs();
  return createAutomationRouter(automationDeps);
}
