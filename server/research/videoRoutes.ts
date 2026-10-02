import { Router } from "express";
import { z } from "zod";
import { triageIntake } from "../decision/intake";
import { intakeVideo } from "./videoIntake";
import { extractVideoClaims } from "./videoExtract";
import { getVideoSourceById, listVideoChunks, listVideoClaims } from "./videoStorage";

/**
 * Video intake API — Tier 0 only (transcript → chunks). No model is called
 * here; extraction/classification is a separate, gated step. Auth is applied by
 * the global gate (mounted under `/api`).
 */
export function createVideoRouter(): Router {
  const router = Router();

  router.post("/intake", async (req, res) => {
    const parsed = z.object({ url: z.string().trim().min(3), targetChars: z.number().int().min(200).max(8000).optional() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(", ") });
    }
    try {
      const result = await intakeVideo(parsed.data.url, { targetChars: parsed.data.targetChars });
      const code = result.status === "ingested" ? 200 : result.status === "no_transcript" ? 404 : 503;
      res.status(code).json(result);
    } catch (error: any) {
      res.status(502).json({ message: error?.message || "video intake failed" });
    }
  });

  router.get("/sources/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "invalid id" });
    const source = await getVideoSourceById(id);
    if (!source) return res.status(404).json({ message: "video source not found" });
    res.json(source);
  });

  router.get("/sources/:id/chunks", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "invalid id" });
    res.json({ chunks: await listVideoChunks(id) });
  });

  router.get("/sources/:id/claims", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "invalid id" });
    res.json({ claims: await listVideoClaims(id) });
  });

  /** Extract claims from a source's chunks (model-routed; `video.extract`). */
  router.post("/sources/:id/extract", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "invalid id" });
    const parsed = z.object({ maxChunks: z.number().int().min(1).max(100).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors.map((e) => e.message).join(", ") });
    try {
      const source = await getVideoSourceById(id);
      if (!source) return res.status(404).json({ message: "video source not found" });
      const summary = await extractVideoClaims(id, { maxChunks: parsed.data.maxChunks });
      res.json(summary);
    } catch (error: any) {
      res.status(502).json({ message: error?.message || "extraction failed" });
    }
  });

  /**
   * Decide whether this video is worth pursuing — Jev triage over the source's
   * extracted claims (falling back to chunk text when there are none yet).
   */
  router.post("/sources/:id/triage", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "invalid id" });
    try {
      const source = await getVideoSourceById(id);
      if (!source) return res.status(404).json({ message: "video source not found" });
      const [claims, chunks] = await Promise.all([listVideoClaims(id), listVideoChunks(id)]);

      const signals = claims.length
        ? claims.map((c) => c.claim)
        : chunks.map((c) => c.text.slice(0, 240));
      if (signals.length === 0) return res.status(400).json({ message: "source has no claims or chunks" });

      const items = [
        {
          id: `video-${source.id}`,
          title: signals[0].slice(0, 200),
          summary: signals.slice(0, 10).join(" | ").slice(0, 2000),
          url: source.url,
          source: "youtube",
        },
      ];
      const { candidates, summary } = await triageIntake(items, {});
      res.json({ summary, candidates });
    } catch (error: any) {
      res.status(502).json({ message: error?.message || "triage failed" });
    }
  });

  return router;
}
