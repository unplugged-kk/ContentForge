/**
 * Co-primary StoryInput discriminated union (INC-06).
 *
 * Encodes the three first-class ways a Story starts — first-hand practitioner
 * experience, researched evidence, or a hybrid combining both — and normalizes
 * each into `StorySynthesis` without requiring database schema changes.
 */

import { z } from "zod";
import type { StorySynthesis } from "./service";

export const CREATOR_NOTES_HEADER = "First-hand notes & proof points:";
export const RESEARCH_THESIS_HEADER = "Research thesis:";

const titleSchema = z.string().trim().min(1).max(500);
const angleListSchema = z.array(z.string().trim().min(1).max(500)).max(50).optional();
const proofPointsSchema = z.array(z.string().trim().min(1).max(500)).max(20);
const evidenceRefsSchema = z.array(z.number().int().positive()).min(1).max(1000);

export const firstHandStoryInputSchema = z.object({
  mode: z.literal("first_hand"),
  title: titleSchema,
  observation: z.string().trim().min(1),
  proofPoints: proofPointsSchema,
  angles: angleListSchema,
});

export const researchedStoryInputSchema = z.object({
  mode: z.literal("researched"),
  researchJobId: z.number().int().positive(),
  evidenceRefs: evidenceRefsSchema,
  title: titleSchema,
  thesis: z.string().trim().min(1),
  angles: angleListSchema,
});

export const hybridStoryInputSchema = z.object({
  mode: z.literal("hybrid"),
  researchJobId: z.number().int().positive(),
  evidenceRefs: evidenceRefsSchema,
  title: titleSchema,
  observation: z.string().trim().min(1),
  proofPoints: proofPointsSchema,
  thesis: z.string().trim().min(1).optional(),
  angles: angleListSchema,
});

export const storyInputSchema = z.discriminatedUnion("mode", [
  firstHandStoryInputSchema,
  researchedStoryInputSchema,
  hybridStoryInputSchema,
]);

export type FirstHandStoryInput = z.infer<typeof firstHandStoryInputSchema>;
export type ResearchedStoryInput = z.infer<typeof researchedStoryInputSchema>;
export type HybridStoryInput = z.infer<typeof hybridStoryInputSchema>;
export type StoryInput = z.infer<typeof storyInputSchema>;

function formatFirstHandSection(observation: string, proofPoints: string[]): string {
  const lines = [CREATOR_NOTES_HEADER, observation.trim()];
  if (proofPoints.length > 0) {
    lines.push(...proofPoints.map((point) => `- ${point.trim()}`));
  }
  return lines.join("\n");
}

/**
 * Convert a validated co-primary `StoryInput` into a `StorySynthesis` payload
 * that persists directly into existing `stories` columns.
 */
export function toStorySynthesis(input: StoryInput): StorySynthesis {
  const parsed = storyInputSchema.parse(input);

  if (parsed.mode === "first_hand") {
    return {
      title: parsed.title,
      insightBody: formatFirstHandSection(parsed.observation, parsed.proofPoints),
      angles: parsed.angles ?? [],
      provenance: "human",
      status: "ready",
    };
  }

  if (parsed.mode === "researched") {
    return {
      title: parsed.title,
      insightBody: `${RESEARCH_THESIS_HEADER}\n${parsed.thesis}`,
      angles: parsed.angles ?? [],
      evidenceRefs: Array.from(new Set(parsed.evidenceRefs)),
      provenance: "researched",
      status: "ready",
    };
  }

  const sections: string[] = [];
  if (parsed.thesis) {
    sections.push(`${RESEARCH_THESIS_HEADER}\n${parsed.thesis}`);
  }
  sections.push(formatFirstHandSection(parsed.observation, parsed.proofPoints));

  return {
    title: parsed.title,
    insightBody: sections.join("\n\n"),
    angles: parsed.angles ?? [],
    evidenceRefs: Array.from(new Set(parsed.evidenceRefs)),
    provenance: "researched",
    status: "ready",
  };
}

/**
 * Extract creator-supplied first-hand notes / proof points from a persisted
 * `story.insightBody` (or return the full insight body when `provenance === "human"`).
 */
export function extractCreatorNotesFromStory(story: {
  provenance?: string | null;
  insightBody?: string | null;
}): string | null {
  const body = story.insightBody?.trim() ?? "";
  if (!body) return null;
  const idx = body.indexOf(CREATOR_NOTES_HEADER);
  if (idx >= 0) {
    const after = body.slice(idx + CREATOR_NOTES_HEADER.length).trim();
    return after.length > 0 ? after : null;
  }
  if (story.provenance === "human") {
    return body;
  }
  return null;
}
