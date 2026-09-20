/**
 * Bounded Autonomous Optimization HTTP API (Phase 29.4).
 *
 * Mounted at `/api/autonomy`. Every endpoint is owner-scoped and every
 * mutation is human-only (enable/disable/pause/circuit-breaker reset,
 * §32/§36) -- the deterministic controller itself never calls these routes,
 * only the `controller.ts` functions directly. `/run` is the one
 * execution endpoint (§37): it accepts only a `candidateId` and re-derives
 * every eligibility fact itself; it never accepts a policy, prompt, or
 * scope to blindly apply.
 */
import { Router } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getUserId } from "../../middleware/userContext";
import type { ContentDatabase } from "../storage";
import { autonomyDecisions, type AutonomyMode } from "@shared/schema";
import {
  getOrCreateAutonomyConfig,
  updateAutonomyConfig,
  disableAutonomy,
  pauseAutonomy,
  resetCircuitBreaker,
  type AutonomyConfigPatch,
} from "./config";
import { executeAutonomousActivation, executeAutonomousRollback } from "./controller";

export interface AutonomyApiDeps {
  database: ContentDatabase;
}

const MODES: AutonomyMode[] = ["disabled", "observe_only", "recommend", "experiment_only", "bounded_activation"];

const configPatchSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(MODES as [AutonomyMode, ...AutonomyMode[]]).optional(),
  experimentAutomationEnabled: z.boolean().optional(),
  activationAutomationEnabled: z.boolean().optional(),
  rollbackEnabled: z.boolean().optional(),
  minimumEvidenceQuality: z.enum(["insufficient_data", "observed", "directional", "repeatable", "confirmed"]).optional(),
  maxActiveExperiments: z.number().int().min(0).max(10).optional(),
  maxExperimentsPerDay: z.number().int().min(0).max(10).optional(),
  maxActivationsPerDay: z.number().int().min(0).max(10).optional(),
  maxActivationsPerWeek: z.number().int().min(0).max(30).optional(),
  maxConsecutiveActivations: z.number().int().min(1).max(10).optional(),
  cooldownMinutes: z.number().int().min(0).max(43200).optional(),
  allowedScopes: z.array(z.string().trim().min(1)).max(50).nullable().optional(),
});

const runSchema = z.object({
  candidateId: z.number().int().positive(),
  action: z.enum(["activate", "rollback"]).default("activate"),
  rollbackTrigger: z
    .object({
      code: z.enum(["GUARDRAIL_BREACH", "RELIABILITY_REGRESSION", "PUBLICATION_FAILURE_RATE", "MANUAL_SIGNAL"]),
      reason: z.string().trim().min(1).max(2000),
      metric: z.string().trim().max(100).optional(),
      value: z.number().optional(),
    })
    .optional(),
});

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function createAutonomyRouter(deps: AutonomyApiDeps): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const config = await getOrCreateAutonomyConfig(deps.database, ownerId);
      res.json(config);
    } catch (error) {
      next(error);
    }
  });

  router.get("/status", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const config = await getOrCreateAutonomyConfig(deps.database, ownerId);
      res.json({
        enabled: config.enabled,
        mode: config.mode,
        experimentAutomationEnabled: config.experimentAutomationEnabled,
        activationAutomationEnabled: config.activationAutomationEnabled,
        rollbackEnabled: config.rollbackEnabled,
        circuitBreakerState: config.circuitBreakerState,
        circuitBreakerReason: config.circuitBreakerReason,
        maxActivationsPerDay: config.maxActivationsPerDay,
        maxActivationsPerWeek: config.maxActivationsPerWeek,
        cooldownMinutes: config.cooldownMinutes,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/enable", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const body = configPatchSchema.parse(req.body ?? {});
      const patch: AutonomyConfigPatch = { ...body, enabled: true };
      if (!patch.mode) patch.mode = "observe_only";
      const config = await updateAutonomyConfig(deps.database, ownerId, patch, ownerId);
      res.json(config);
    } catch (error) {
      next(error);
    }
  });

  router.post("/disable", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const config = await disableAutonomy(deps.database, ownerId, ownerId);
      res.json(config);
    } catch (error) {
      next(error);
    }
  });

  router.post("/pause", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const config = await pauseAutonomy(deps.database, ownerId, ownerId);
      res.json(config);
    } catch (error) {
      next(error);
    }
  });

  router.post("/circuit-breaker/reset", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const config = await resetCircuitBreaker(deps.database, ownerId, ownerId);
      res.json(config);
    } catch (error) {
      next(error);
    }
  });

  router.get("/decisions", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const rows = await deps.database
        .select()
        .from(autonomyDecisions)
        .where(eq(autonomyDecisions.userId, ownerId))
        .orderBy(desc(autonomyDecisions.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  router.get("/decisions/:id", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid decision id" });
      const [row] = await deps.database.select().from(autonomyDecisions).where(eq(autonomyDecisions.id, id));
      if (!row || row.userId !== ownerId) return res.status(404).json({ error: "Decision not found" });
      res.json(row);
    } catch (error) {
      next(error);
    }
  });

  // Internal execution endpoint (§37): resolves eligibility itself. The
  // client cannot supply a policy, prompt, or scope to blindly apply --
  // only a candidateId, which the controller re-derives everything from.
  router.post("/run", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const body = runSchema.parse(req.body ?? {});
      if (body.action === "rollback") {
        if (!body.rollbackTrigger) {
          return res.status(400).json({ error: "rollbackTrigger is required for action=rollback" });
        }
        const result = await executeAutonomousRollback(deps.database, ownerId, body.candidateId, body.rollbackTrigger);
        return res.status(result.gate.allowed ? 200 : 422).json(result);
      }
      const result = await executeAutonomousActivation(deps.database, ownerId, body.candidateId);
      return res.status(result.gate.allowed ? 200 : 422).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
