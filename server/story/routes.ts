/**
 * Story API — the minimum surface for the Phase-B `ResearchJob → Story` slice.
 *
 * The route is deliberately thin: it validates the request and delegates to the
 * Story service. It never runs research and never touches the queue — creating a
 * Story is a cheap, synchronous read of already-durable research.
 */

import { Router } from "express";
import { z } from "zod";
import type { Story } from "@shared/schema";
import {
  createStoryFromResearch,
  InvalidStoryInputError,
  ResearchJobHasNoEvidenceError,
  ResearchJobNotCompleteError,
  ResearchJobNotFoundError,
  type CreateStoryDeps,
} from "./service";

export const createStoryBodySchema = z.object({
  researchJobId: z.number().int().positive(),
  title: z.string().trim().min(1).max(500),
  insightBody: z.string().trim().min(1),
  angles: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  evidenceRefs: z.array(z.number().int().positive()).max(1000).optional(),
  provenance: z.enum(["researched", "human", "imported"]).default("researched"),
  status: z.enum(["draft", "ready"]).default("draft"),
});

export type CreateStoryBody = z.infer<typeof createStoryBodySchema>;

function serializeStory(story: Story) {
  return {
    id: story.id,
    researchJobId: story.researchJobId,
    provenance: story.provenance,
    title: story.title,
    insightBody: story.insightBody,
    interpretationMarked: story.interpretationMarked,
    angles: story.angles ?? [],
    evidenceRefs: story.evidenceRefs ?? [],
    status: story.status,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
}

/** Domain errors → HTTP status. Returns null for anything unclassified. */
function httpStatusFor(error: unknown): { status: number; message: string } | null {
  if (error instanceof InvalidStoryInputError) return { status: 400, message: error.message };
  if (error instanceof ResearchJobNotFoundError) return { status: 404, message: error.message };
  if (error instanceof ResearchJobNotCompleteError) return { status: 409, message: error.message };
  if (error instanceof ResearchJobHasNoEvidenceError) return { status: 422, message: error.message };
  return null;
}

export function createStoryRouter(deps: CreateStoryDeps): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    const parsed = createStoryBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join(", "),
      });
    }

    const { researchJobId, ...synthesis } = parsed.data;
    try {
      const story = await createStoryFromResearch(researchJobId, synthesis, deps);
      return res.status(201).json(serializeStory(story));
    } catch (error) {
      const mapped = httpStatusFor(error);
      if (mapped) return res.status(mapped.status).json({ message: mapped.message });
      return next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid story id" });
    }
    try {
      const story = await deps.stories.getStory(id);
      if (!story) return res.status(404).json({ message: "Story not found" });
      return res.json(serializeStory(story));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

/** Router wired to the application's Story storage and read-only research access. */
export async function createDefaultStoryRouter(): Promise<Router> {
  const [{ DatabaseStoryStorage }, { db }, { researchStorage }] = await Promise.all([
    import("./storage"),
    import("../db"),
    import("../research/service"),
  ]);

  return createStoryRouter({
    stories: new DatabaseStoryStorage(db),
    research: {
      getJob: (jobId) => researchStorage.getJob(jobId),
      listEvidenceIds: (jobId) => researchStorage.listEvidenceIds(jobId),
    },
  });
}
