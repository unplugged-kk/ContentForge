/**
 * Learning / analytics HTTP surface (Phase 14). No UI.
 *
 * Enough to prove metric ingestion, normalized results, descriptive summaries,
 * and learning-signal inspection. Every read is owner-scoped in SQL.
 */

import { Router } from "express";
import { z } from "zod";
import { getUserId } from "../../middleware/userContext";
import { JobFailure } from "../../jobs/failures";
import type { ContentStoragePort, ContentDatabase } from "../storage";
import { CANONICAL_METRICS } from "./constants";
import type { LearningStoragePort } from "./store";
import { computeAnalyticsSummary } from "./summary";
import { ingestExplicitMetrics, refreshPublicationMetrics } from "./refresh";
import type { NormalizedMetric } from "./metrics";
import { lineageToExplain, resolveLineage } from "./lineage";

const observationBody = z.object({
  observedAt: z.string().datetime().optional(),
  provider: z.string().trim().min(1).max(60).optional(),
  metrics: z
    .array(
      z.object({
        metric: z.enum(CANONICAL_METRICS),
        value: z.number().nonnegative().nullable(),
        availability: z.enum(["observed", "not_available"]),
      }),
    )
    .min(1)
    .max(20),
});

export interface LearningApiDeps {
  content: ContentStoragePort;
  learning: LearningStoragePort;
  database: ContentDatabase;
  enqueueRefresh: (publicationId: number, correlationId: string) => Promise<boolean>;
}

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function createLearningRouter(deps: LearningApiDeps): Router {
  const router = Router();

  router.get("/signals", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const publicationId = parseId(req.query.publicationId);
      const artifactId = parseId(req.query.artifactId);
      const signalType =
        typeof req.query.signalType === "string" && req.query.signalType.trim()
          ? req.query.signalType.trim()
          : undefined;
      const rows = await deps.learning.listLearningSignalsForOwner(ownerId, limit, {
        publicationId: publicationId ?? undefined,
        artifactId: artifactId ?? undefined,
        signalType,
      });
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/signals/:id", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid signal id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const row = await deps.learning.getLearningSignalForOwner(id, ownerId);
      if (!row) return res.status(404).json({ message: "Learning signal not found" });
      const lineage = await resolveLineage(deps.database, {
        artifactId: row.artifactId,
        priorArtifactId: row.priorArtifactId,
        publicationId: row.publicationId,
      });
      return res.json({ ...row, lineage: lineageToExplain(lineage) });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/publications/:id/performance", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid publication id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const publication = await deps.content.getPublication(id);
      if (!publication || (publication.userId !== null && publication.userId !== ownerId)) {
        return res.status(404).json({ message: "Publication not found" });
      }
      const rows = await deps.learning.listPerformanceForPublicationOwner(id, ownerId);
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/publications/:id/refresh", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid publication id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const publication = await deps.content.getPublication(id);
      if (!publication || (publication.userId !== null && publication.userId !== ownerId)) {
        return res.status(404).json({ message: "Publication not found" });
      }
      const sync = String(req.query.sync ?? "") === "1";
      if (sync) {
        const result = await refreshPublicationMetrics(id, {
          content: deps.content,
          learning: deps.learning,
          database: deps.database,
        });
        return res.json(result);
      }
      const enqueued = await deps.enqueueRefresh(id, publication.correlationId);
      return res.status(202).json({ publicationId: id, enqueued });
    } catch (error) {
      if (error instanceof JobFailure) {
        const status = error.failureClass === "transient" || error.failureClass === "rate_limited" ? 503 : 422;
        return res.status(status).json({ message: error.message, failureClass: error.failureClass });
      }
      return next(error);
    }
  });

  router.post("/publications/:id/observations", async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid publication id" });
    try {
      const ownerId = getUserId(req) ?? 1;
      const publication = await deps.content.getPublication(id);
      if (!publication || (publication.userId !== null && publication.userId !== ownerId)) {
        return res.status(404).json({ message: "Publication not found" });
      }
      const body = observationBody.parse(req.body ?? {});
      const metrics = body.metrics as NormalizedMetric[];
      const result = await ingestExplicitMetrics(id, metrics, {
        content: deps.content,
        learning: deps.learning,
        database: deps.database,
      }, {
        observedAt: body.observedAt ? new Date(body.observedAt) : undefined,
        provider: body.provider,
      });
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues.map((i) => i.message).join(", ") });
      }
      if (error instanceof JobFailure) {
        return res.status(422).json({ message: error.message, failureClass: error.failureClass });
      }
      return next(error);
    }
  });

  router.get("/summary", async (req, res, next) => {
    try {
      const ownerId = getUserId(req) ?? 1;
      const summary = await computeAnalyticsSummary(deps.database, ownerId);
      return res.json(summary);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
