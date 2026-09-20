/**
 * Human-Gated Policy Activation HTTP API (Phase 29.3).
 *
 * Mounted alongside the Phase 29.2 policy-candidate router at
 * `/api/policy-candidates` (activate/rollback) and at `/api/policies`
 * (active/history reads). Every write is owner-scoped via the candidate;
 * every read requires authentication.
 */

import { Router } from "express";
import { z } from "zod";
import { getUserId } from "../../middleware/userContext";
import type { ContentDatabase } from "../storage";
import {
  activatePolicyCandidate,
  rollbackPolicyForCandidate,
  getActivePolicyForKey,
  listPolicyHistoryForOwner,
  getActivatedCandidateIds,
  getActivatedCandidateActors,
  policyKeyForScope,
  PolicyActivationError,
} from "./activation";

export interface PolicyActivationApiDeps {
  database: ContentDatabase;
}

const activateBodySchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function errorStatus(code: string): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    case "CONCURRENT_ACTIVATION":
      return 409;
    default:
      return 422;
  }
}

export function createPolicyActivationRouter(deps: PolicyActivationApiDeps): Router {
  const router = Router();

  // GET /api/policy-candidates/activated-ids
  // Server-derived truth: returns candidate IDs whose latest activation event
  // is 'activate' (not subsequently rolled back). Replaces ephemeral client-
  // side useState so that browser reload / second tab sees correct state.
  router.get("/activated-ids", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const ids = await getActivatedCandidateIds(deps.database, ownerId);
      const actors = await getActivatedCandidateActors(deps.database, ownerId);
      return res.json({ activatedCandidateIds: ids, activatedCandidateActors: actors });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/policy-candidates/:id/activate
  router.post("/:id/activate", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid policy candidate id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const body = activateBodySchema.parse(req.body ?? {});
      const result = await activatePolicyCandidate(deps.database, id, ownerId, body.reason);
      return res.status(result.alreadyActivated ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues.map((i) => i.message).join(", ") });
      }
      if (error instanceof PolicyActivationError) {
        return res.status(errorStatus(error.code)).json({ message: error.message, code: error.code });
      }
      return next(error);
    }
  });

  // POST /api/policy-candidates/:id/rollback
  router.post("/:id/rollback", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid policy candidate id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const body = activateBodySchema.parse(req.body ?? {});
      const result = await rollbackPolicyForCandidate(deps.database, id, ownerId, body.reason);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues.map((i) => i.message).join(", ") });
      }
      if (error instanceof PolicyActivationError) {
        return res.status(errorStatus(error.code)).json({ message: error.message, code: error.code });
      }
      return next(error);
    }
  });

  return router;
}

export function createPolicyHistoryRouter(deps: PolicyActivationApiDeps): Router {
  const router = Router();

  // GET /api/policies/active?policyKey=pol:x_post:x  OR  ?format=x_post&channel=x
  router.get("/active", async (req, res, next) => {
    try {
      const policyKey = resolveQueryPolicyKey(req.query);
      if (!policyKey) {
        return res.status(400).json({ message: "policyKey (or format + channel) is required" });
      }
      const policy = await getActivePolicyForKey(deps.database, policyKey);
      if (!policy) return res.status(404).json({ message: `No active policy for scope "${policyKey}"` });
      return res.json(policy);
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/policies/history?policyKey=pol:x_post:x
  router.get("/history", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const policyKey = resolveQueryPolicyKey(req.query);
      if (!policyKey) {
        return res.status(400).json({ message: "policyKey (or format + channel) is required" });
      }
      const history = await listPolicyHistoryForOwner(deps.database, ownerId, policyKey);
      return res.json(history);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function resolveQueryPolicyKey(query: Record<string, unknown>): string | null {
  if (typeof query.policyKey === "string" && query.policyKey.trim()) return query.policyKey.trim();
  if (typeof query.format === "string" && typeof query.channel === "string" && query.format.trim() && query.channel.trim()) {
    try {
      return policyKeyForScope(`channel:${query.channel.trim()};format:${query.format.trim()}`);
    } catch {
      return null;
    }
  }
  return null;
}
