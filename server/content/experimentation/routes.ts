/**
 * Experimentation HTTP API surface (Phase 29.2).
 *
 * Implements endpoints for:
 * - Experiment definition & lifecycle (start, pause, complete)
 * - Deterministic variant assignment
 * - Empirical evaluation & guardrails
 * - Human decision recording
 * - Policy candidate management (separate from live production policy)
 *
 * All endpoints are strictly owner-scoped at the SQL level.
 */

import { Router } from "express";
import { z } from "zod";
import { getUserId } from "../../middleware/userContext";
import type { ContentDatabase } from "../storage";
import type { ExperimentStoragePort } from "./store";
import { experimentIdentityKey } from "./identity";
import {
  assignOpportunityToExperiment,
  ExperimentEligibilityError,
} from "./assignment";
import {
  evaluateExperiment,
  createPolicyCandidateFromExperiment,
} from "./evaluation";
import {
  type ExperimentStatus,
  type ExperimentDecision,
  type PolicyCandidateStatus,
  opportunities,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface ExperimentApiDeps {
  store: ExperimentStoragePort;
  database: ContentDatabase;
}

const createExperimentBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  hypothesis: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  targetScope: z.string().trim().min(1).max(100),
  experimentType: z.string().trim().min(1).max(50),
  primaryMetric: z.string().trim().min(1).max(60),
  guardrailMetrics: z.array(z.string().trim()).default([]),
  eligibilityRules: z.record(z.unknown()).default({}),
  sourceProposalId: z.number().int().positive().optional(),
  minSampleSize: z.number().int().min(1).max(100).default(3),
  status: z.enum(["draft", "ready", "running", "paused", "completed", "cancelled"]).optional(),
  variants: z
    .array(
      z.object({
        variantKey: z.string().trim().min(1).max(50),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().optional(),
        isControl: z.boolean().default(false),
        policySnapshot: z.record(z.unknown()).default({}),
        trafficWeight: z.number().int().min(1).max(100).default(50),
      }),
    )
    .min(2),
});

const assignBodySchema = z.object({
  opportunityId: z.number().int().positive(),
});

const decideBodySchema = z.object({
  decision: z.enum([
    "pending",
    "inconclusive",
    "control_preferred",
    "variant_promising",
    "variant_preferred",
    "guardrail_failed",
    "invalidated",
  ]),
  notes: z.string().trim().optional(),
});

const createPolicyCandidateBodySchema = z.object({
  variantId: z.number().int().positive(),
  title: z.string().trim().min(1).max(255).optional(),
  reviewNotes: z.string().trim().optional(),
});

const reviewPolicyCandidateBodySchema = z.object({
  status: z.enum(["candidate", "under_review", "approved_for_future", "rejected", "archived"]),
  notes: z.string().trim().optional(),
});

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function createExperimentRouter(deps: ExperimentApiDeps): Router {
  const router = Router();

  // 1. List experiments for owner
  router.get("/", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const status =
        typeof req.query.status === "string" && req.query.status.trim()
          ? (req.query.status.trim() as ExperimentStatus)
          : undefined;
      const experimentType =
        typeof req.query.type === "string" && req.query.type.trim()
          ? req.query.type.trim()
          : undefined;

      const rows = await deps.store.listExperimentsForOwner(ownerId, limit, {
        status,
        experimentType,
      });

      // Enrich with variants and latest evaluation
      const enriched = await Promise.all(
        rows.map((exp) => deps.store.getExperimentForOwner(exp.id, ownerId)),
      );

      return res.json(enriched.filter(Boolean));
    } catch (error) {
      return next(error);
    }
  });

  // 2. Create experiment with control and variants
  router.post("/", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const body = createExperimentBodySchema.parse(req.body);

      // Verify at least one control variant
      const hasControl = body.variants.some((v) => v.isControl);
      if (!hasControl) {
        body.variants[0].isControl = true;
      }

      const idKey = experimentIdentityKey(ownerId, body.targetScope, body.experimentType, body.name);

      const { row: experiment } = await deps.store.createExperiment({
        userId: ownerId,
        sourceProposalId: body.sourceProposalId ?? null,
        name: body.name,
        hypothesis: body.hypothesis,
        objective: body.objective,
        targetScope: body.targetScope,
        experimentType: body.experimentType,
        primaryMetric: body.primaryMetric,
        guardrailMetrics: body.guardrailMetrics,
        eligibilityRules: body.eligibilityRules,
        allocationMethod: "deterministic_hash",
        status: body.status ?? "ready",
        decision: "pending",
        decisionNotes: null,
        decidedAt: null,
        decidedBy: null,
        minSampleSize: body.minSampleSize,
        startedAt: body.status === "running" ? new Date() : null,
        completedAt: null,
        identityKey: idKey,
      });

      // Create variants
      for (const v of body.variants) {
        await deps.store.createVariant({
          userId: ownerId,
          experimentId: experiment.id,
          variantKey: v.variantKey,
          name: v.name,
          description: v.description ?? null,
          isControl: v.isControl,
          policySnapshot: v.policySnapshot,
          generationPolicyId: null,
          trafficWeight: v.trafficWeight,
        });
      }

      const created = await deps.store.getExperimentForOwner(experiment.id, ownerId);
      return res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues.map((i) => i.message).join(", ") });
      }
      return next(error);
    }
  });

  // 3. Get single experiment detail
  router.get("/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const experiment = await deps.store.getExperimentForOwner(id, ownerId);
      if (!experiment) return res.status(404).json({ message: "Experiment not found" });
      return res.json(experiment);
    } catch (error) {
      return next(error);
    }
  });

  // 4. Start experiment
  router.post("/:id/start", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const experiment = await deps.store.getExperimentForOwner(id, ownerId);
      if (!experiment) return res.status(404).json({ message: "Experiment not found" });

      const updated = await deps.store.updateExperiment(id, ownerId, {
        status: "running",
        startedAt: experiment.startedAt ?? new Date(),
      });
      return res.json(updated);
    } catch (error) {
      return next(error);
    }
  });

  // 5. Pause experiment
  router.post("/:id/pause", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const experiment = await deps.store.getExperimentForOwner(id, ownerId);
      if (!experiment) return res.status(404).json({ message: "Experiment not found" });

      const updated = await deps.store.updateExperiment(id, ownerId, {
        status: "paused",
      });
      return res.json(updated);
    } catch (error) {
      return next(error);
    }
  });

  // 6. Complete experiment
  router.post("/:id/complete", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const experiment = await deps.store.getExperimentForOwner(id, ownerId);
      if (!experiment) return res.status(404).json({ message: "Experiment not found" });

      const updated = await deps.store.updateExperiment(id, ownerId, {
        status: "completed",
        completedAt: new Date(),
      });
      return res.json(updated);
    } catch (error) {
      return next(error);
    }
  });

  // 7. List variants for experiment
  router.get("/:id/variants", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const experiment = await deps.store.getExperimentForOwner(id, ownerId);
      if (!experiment) return res.status(404).json({ message: "Experiment not found" });

      const variants = await deps.store.listVariantsForExperiment(id, ownerId);
      return res.json(variants);
    } catch (error) {
      return next(error);
    }
  });

  // 8. List assignments for experiment
  router.get("/:id/assignments", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const experiment = await deps.store.getExperimentForOwner(id, ownerId);
      if (!experiment) return res.status(404).json({ message: "Experiment not found" });

      const assignments = await deps.store.listAssignmentsForExperiment(id, ownerId);
      return res.json(assignments);
    } catch (error) {
      return next(error);
    }
  });

  // 9. Assign opportunity to experiment
  router.post("/:id/assign", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const body = assignBodySchema.parse(req.body);

      // Load opportunity
      const [opp] = await deps.database
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.id, body.opportunityId), eq(opportunities.userId, ownerId)));

      if (!opp) {
        return res.status(404).json({ message: "Opportunity not found" });
      }

      const result = await assignOpportunityToExperiment(deps.store, id, opp, ownerId);
      return res.status(result.alreadyAssigned ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues.map((i) => i.message).join(", ") });
      }
      if (error instanceof ExperimentEligibilityError) {
        return res.status(422).json({ message: error.message, code: error.code });
      }
      return next(error);
    }
  });

  // 10. Run evaluation on experiment
  router.post("/:id/evaluate", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const experiment = await deps.store.getExperimentForOwner(id, ownerId);
      if (!experiment) return res.status(404).json({ message: "Experiment not found" });

      const evaluation = await evaluateExperiment(deps.database, deps.store, id, ownerId);
      return res.status(201).json(evaluation);
    } catch (error) {
      return next(error);
    }
  });

  // 11. Get latest evaluation
  router.get("/:id/evaluation", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const experiment = await deps.store.getExperimentForOwner(id, ownerId);
      if (!experiment) return res.status(404).json({ message: "Experiment not found" });

      const evaluation = await deps.store.getLatestEvaluationForExperiment(id, ownerId);
      if (!evaluation) {
        return res.status(404).json({ message: "No evaluation recorded yet" });
      }
      return res.json(evaluation);
    } catch (error) {
      return next(error);
    }
  });

  // 12. Record human decision
  router.post("/:id/decide", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const body = decideBodySchema.parse(req.body);

      const experiment = await deps.store.getExperimentForOwner(id, ownerId);
      if (!experiment) return res.status(404).json({ message: "Experiment not found" });

      const updated = await deps.store.updateExperiment(id, ownerId, {
        decision: body.decision as ExperimentDecision,
        decisionNotes: body.notes ?? null,
        decidedAt: new Date(),
        decidedBy: ownerId,
      });

      return res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues.map((i) => i.message).join(", ") });
      }
      return next(error);
    }
  });

  // 13. Create PolicyCandidate from accepted variant
  router.post("/:id/policy-candidate", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const body = createPolicyCandidateBodySchema.parse(req.body);

      const candidate = await createPolicyCandidateFromExperiment(
        deps.store,
        id,
        body.variantId,
        ownerId,
        body.title,
        body.reviewNotes,
      );

      return res.status(201).json(candidate);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues.map((i) => i.message).join(", ") });
      }
      return next(error);
    }
  });

  // 14. List policy candidates for an experiment
  router.get("/:id/policy-candidates", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid experiment id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const candidates = await deps.store.listPolicyCandidatesForOwner(ownerId, 50, {
        experimentId: id,
      });
      return res.json(candidates);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export function createPolicyCandidateRouter(deps: ExperimentApiDeps): Router {
  const router = Router();

  // List all policy candidates for owner
  router.get("/", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const status =
        typeof req.query.status === "string" && req.query.status.trim()
          ? (req.query.status.trim() as PolicyCandidateStatus)
          : undefined;

      const candidates = await deps.store.listPolicyCandidatesForOwner(ownerId, limit, { status });
      return res.json(candidates);
    } catch (error) {
      return next(error);
    }
  });

  // Get single policy candidate
  router.get("/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid candidate id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const candidate = await deps.store.getPolicyCandidateForOwner(id, ownerId);
      if (!candidate) return res.status(404).json({ message: "Policy candidate not found" });
      return res.json(candidate);
    } catch (error) {
      return next(error);
    }
  });

  // Human review policy candidate
  router.post("/:id/review", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid candidate id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const body = reviewPolicyCandidateBodySchema.parse(req.body);

      const candidate = await deps.store.getPolicyCandidateForOwner(id, ownerId);
      if (!candidate) return res.status(404).json({ message: "Policy candidate not found" });

      const updated = await deps.store.updatePolicyCandidateReview(
        id,
        ownerId,
        body.status,
        ownerId,
        body.notes,
      );

      return res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues.map((i) => i.message).join(", ") });
      }
      return next(error);
    }
  });

  return router;
}
