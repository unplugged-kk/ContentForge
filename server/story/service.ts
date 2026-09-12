/**
 * Story domain service.
 *
 * The single transition implemented here is `ResearchJob → Story` (locked chain,
 * Ticket 03 §1): a Story synthesizes reusable editorial meaning **from** a
 * completed research run. It never triggers research — no SourceProvider is
 * reachable from this module, and no ResearchJob is ever created here. Research
 * is the durable asset; deriving a Story is a cheap, repeatable read of it
 * (Tickets 03 §3, 04 §8, 05 §9).
 *
 * Provenance is explicit: the Story keeps `researchJobId` and references the
 * job's evidence **by ID only** (Ticket 03 §2 — "IDs, never copies"). Raw source
 * content is never read into the Story.
 */

import { z } from "zod";
import type { ResearchJob, Story } from "@shared/schema";
import { db } from "../db";
import { DatabaseStoryStorage, type InsertStoryRow, type StoryProvenance, type StoryStoragePort } from "./storage";

/** Shared storage instance for the application (HTTP routes + content pipeline). */
export const storyStorage = new DatabaseStoryStorage(db);

/**
 * What a caller may supply when creating a Story.
 *
 * `status` is limited to the two non-derived states: `used` is informational and
 * set by Opportunity selection, and `archived` is a deliberate end state — neither
 * is a creation-time choice. `interpretationMarked` is not caller-settable: the
 * insight body is generated interpretation by construction (Ticket 04 §6).
 */
export const storySynthesisSchema = z.object({
  title: z.string().trim().min(1).max(500),
  insightBody: z.string().trim().min(1),
  angles: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  evidenceRefs: z.array(z.number().int().positive()).max(1000).optional(),
  provenance: z.enum(["researched", "human", "imported"]).default("researched"),
  status: z.enum(["draft", "ready"]).default("draft"),
});

export type StorySynthesis = z.input<typeof storySynthesisSchema>;

/** Read-only research surface the service needs. No executor, no queue. */
export interface StoryResearchPort {
  getJob(jobId: number): Promise<ResearchJob | undefined>;
  /** Evidence identities only — the Story stores references, never content. */
  listEvidenceIds(jobId: number): Promise<number[]>;
}

export interface CreateStoryDeps {
  stories: StoryStoragePort;
  research: StoryResearchPort;
}

export class InvalidStoryInputError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid story input: ${issues.join("; ")}`);
    this.name = "InvalidStoryInputError";
    this.issues = issues;
  }
}

export class ResearchJobNotFoundError extends Error {
  constructor(readonly researchJobId: number) {
    super(`ResearchJob ${researchJobId} not found`);
    this.name = "ResearchJobNotFoundError";
  }
}

/** Covers every non-`complete` status: queued, running, failed, cancelled. */
export class ResearchJobNotCompleteError extends Error {
  constructor(
    readonly researchJobId: number,
    readonly status: string,
  ) {
    super(`ResearchJob ${researchJobId} is "${status}", not "complete"`);
    this.name = "ResearchJobNotCompleteError";
  }
}

/** A completed job with no evidence is not usable research output. */
export class ResearchJobHasNoEvidenceError extends Error {
  constructor(readonly researchJobId: number) {
    super(`ResearchJob ${researchJobId} has no usable research output (no evidence)`);
    this.name = "ResearchJobHasNoEvidenceError";
  }
}

/**
 * Create a Story from a completed ResearchJob.
 *
 * Rejects, in order: invalid input, a missing job, a job that is not `complete`
 * (including failed/cancelled), and a completed job with no evidence. Multiple
 * Stories from one ResearchJob are legitimate (Ticket 03 §3) — there is no
 * one-story-per-job constraint and no idempotency key at this layer.
 */
export async function createStoryFromResearch(
  researchJobId: number,
  synthesis: StorySynthesis,
  deps: CreateStoryDeps,
): Promise<Story> {
  if (!Number.isInteger(researchJobId) || researchJobId <= 0) {
    throw new InvalidStoryInputError(["researchJobId must be a positive integer"]);
  }

  const parsed = storySynthesisSchema.safeParse(synthesis ?? {});
  if (!parsed.success) {
    throw new InvalidStoryInputError(
      parsed.error.issues.map((issue) => {
        const path = issue.path.join(".") || "(root)";
        return `${path}: ${issue.message}`;
      }),
    );
  }
  const input = parsed.data;

  const job = await deps.research.getJob(researchJobId);
  if (!job) throw new ResearchJobNotFoundError(researchJobId);
  if (job.status !== "complete") {
    throw new ResearchJobNotCompleteError(researchJobId, job.status);
  }

  const evidenceIds = await deps.research.listEvidenceIds(researchJobId);
  if (evidenceIds.length === 0) {
    throw new ResearchJobHasNoEvidenceError(researchJobId);
  }

  // The Story cites research it actually rests on. An omitted list defaults to
  // the job's full evidence set; a supplied list must be a subset of it.
  const available = new Set(evidenceIds);
  let evidenceRefs: number[];
  if (input.evidenceRefs === undefined) {
    evidenceRefs = [...evidenceIds];
  } else {
    const refs = Array.from(new Set(input.evidenceRefs));
    if (refs.length === 0) {
      throw new InvalidStoryInputError(["evidenceRefs must not be empty when supplied"]);
    }
    const foreign = refs.filter((id) => !available.has(id));
    if (foreign.length > 0) {
      throw new InvalidStoryInputError([
        `evidenceRefs do not belong to ResearchJob ${researchJobId}: ${foreign.join(", ")}`,
      ]);
    }
    evidenceRefs = refs;
  }

  const row: InsertStoryRow = {
    // A Story belongs to the same operator as the research it derives from.
    userId: job.userId ?? null,
    researchJobId,
    provenance: input.provenance as StoryProvenance,
    title: input.title,
    insightBody: input.insightBody,
    interpretationMarked: true,
    angles: input.angles ?? [],
    evidenceRefs,
    status: input.status,
  };

  return deps.stories.insertStory(row);
}
