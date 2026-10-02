import { Router } from "express";
import { z } from "zod";
import {
  jevConfigured,
  jevTransport,
  triageCandidates,
  triageThresholds,
  type ResearchCandidate,
  type TriageContext,
} from "./jev";
import { intakeSummary, toCandidates } from "./intake";

/**
 * Decision API — Jev triage over discovered candidates.
 *
 * Mounted under `/api`, so the global auth gate applies (session required).
 * This route only *decides*: it never creates research, opportunities or posts.
 */

const candidateSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  summary: z.string().optional(),
  url: z.string().optional(),
  source: z.string().optional(),
});

const contextSchema = z
  .object({
    expertise: z.string().optional(),
    audience: z.string().optional(),
    recentContent: z.array(z.string()).max(50).optional(),
  })
  .optional();

export function createDecisionRouter(): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    res.json({
      jev: {
        configured: jevConfigured(),
        transport: jevTransport(),
        thresholds: triageThresholds(),
      },
    });
  });

  router.post("/triage", async (req, res) => {
    const parsed = z
      .object({
        candidates: z.array(candidateSchema).min(1).max(200),
        context: contextSchema,
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(", ") });
    }
    if (!jevConfigured()) {
      return res.status(503).json({
        message: "Jev is not configured. Set TYPESAFE_API_KEY (api transport) or enable the cli transport.",
      });
    }
    try {
      const candidates = await triageCandidates(
        parsed.data.candidates as ResearchCandidate[],
        (parsed.data.context ?? {}) as TriageContext,
      );
      res.json({ candidates, summary: intakeSummary(candidates) });
    } catch (error: any) {
      res.status(502).json({ message: error?.message || "Jev request failed" });
    }
  });

  router.post("/intake", async (req, res) => {
    const parsed = z
      .object({
        items: z.array(z.record(z.unknown())).min(1).max(500),
        context: contextSchema,
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(", ") });
    }
    if (!jevConfigured()) {
      return res.status(503).json({
        message: "Jev is not configured. Set TYPESAFE_API_KEY (api transport) or enable the cli transport.",
      });
    }
    try {
      const candidates = toCandidates(parsed.data.items);
      if (candidates.length === 0) {
        return res.status(400).json({ message: "No items carry a usable title" });
      }
      const triaged = await triageCandidates(candidates, (parsed.data.context ?? {}) as TriageContext);
      res.json({ candidates: triaged, summary: intakeSummary(triaged) });
    } catch (error: any) {
      res.status(502).json({ message: error?.message || "Jev request failed" });
    }
  });

  return router;
}
