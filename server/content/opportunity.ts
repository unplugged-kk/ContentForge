/**
 * Opportunity boundary: Story → Opportunity.
 *
 * An Opportunity is a candidate content direction — the answer to "what can we
 * create from this Story?" (Ticket 05 §4). It is a lean selector: no content, no
 * prompt, no model config. Many Opportunities per Story are legitimate, and
 * `format` × `channel` are the only content dimensions recorded here.
 *
 * Nothing in this module can reach a provider, the queue, or research: the deps
 * are a Story reader/writer and Opportunity persistence only.
 */

import { z } from "zod";
import type { Opportunity, Story } from "@shared/schema";
import type { OpportunityStatus } from "@shared/schema";
import type { ContentStoragePort } from "./storage";

/** Read/write surface this boundary needs from the Story domain. */
export interface StoryPort {
  getStory(id: number): Promise<Story | undefined>;
  /** `used` is informational (≥1 Opportunity selected) and never terminal. */
  updateStoryStatus(id: number, status: string): Promise<Story | undefined>;
}

export interface OpportunityDeps {
  opportunities: ContentStoragePort;
  stories: StoryPort;
}

/**
 * Validity matrix for known format × channel pairs (Ticket 05 §7). Unknown
 * formats are allowed so new formats never require core changes — they are
 * registered, not hardcoded here.
 */
const KNOWN_FORMAT_CHANNELS: Readonly<Record<string, readonly string[]>> = {
  x_post: ["x"],
  x_thread: ["x"],
  image: ["x"],
  thumbnail: ["x"],
  carousel: ["x"],
};

export function formatChannelError(format: string, channel: string): string | null {
  const allowed = KNOWN_FORMAT_CHANNELS[format];
  if (allowed && !allowed.includes(channel)) {
    return `format "${format}" cannot target channel "${channel}" (expected: ${allowed.join(", ")})`;
  }
  return null;
}

export const opportunityStatusSchema = z.enum(["proposed", "selected", "killed"]);

export const createOpportunitySchema = z.object({
  concept: z.string().trim().min(1).max(2000),
  objective: z.string().trim().min(1).max(2000),
  format: z.string().trim().min(1).max(50),
  channel: z.string().trim().min(1).max(50),
  audience: z.string().trim().min(1).max(2000).optional(),
  angle: z.string().trim().min(1).max(2000).optional(),
  proposer: z.enum(["human", "autonomous"]).default("human"),
  score: z.number().min(-999).max(999).optional(),
  scoreBreakdown: z.record(z.unknown()).optional(),
  /** Durable idempotency for chat-originated Opportunities. */
  chatKey: z.string().trim().min(1).max(200).optional(),
});

export type CreateOpportunityInput = z.input<typeof createOpportunitySchema>;

export class InvalidOpportunityInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid opportunity input: ${issues.join("; ")}`);
    this.name = "InvalidOpportunityInputError";
    this.issues = issues;
  }
}

export class StoryNotFoundError extends Error {
  constructor(readonly storyId: number) {
    super(`Story ${storyId} not found`);
    this.name = "StoryNotFoundError";
  }
}

/** Archived Stories are a deliberate end state and are not a source of new work. */
export class StoryNotUsableError extends Error {
  constructor(
    readonly storyId: number,
    readonly status: string,
  ) {
    super(`Story ${storyId} is "${status}" and cannot produce new Opportunities`);
    this.name = "StoryNotUsableError";
  }
}

export class OpportunityNotFoundError extends Error {
  constructor(readonly opportunityId: number) {
    super(`Opportunity ${opportunityId} not found`);
    this.name = "OpportunityNotFoundError";
  }
}

/** Illegal lifecycle transition (e.g. selecting an already-killed Opportunity). */
export class OpportunityStateError extends Error {
  constructor(
    readonly opportunityId: number,
    readonly status: string,
    action: string,
  ) {
    super(`Opportunity ${opportunityId} is "${status}" and cannot be ${action}`);
    this.name = "OpportunityStateError";
  }
}

/**
 * Create an Opportunity from a Story. Rejects a missing Story and an archived
 * Story. The Story is deliberately left unchanged (it stays reusable): `used` is
 * only set when an Opportunity is *selected*.
 */
export async function createOpportunityFromStory(
  storyId: number,
  input: CreateOpportunityInput,
  deps: OpportunityDeps,
): Promise<Opportunity> {
  if (!Number.isInteger(storyId) || storyId <= 0) {
    throw new InvalidOpportunityInputError(["storyId must be a positive integer"]);
  }

  const parsed = createOpportunitySchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new InvalidOpportunityInputError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const body = parsed.data;

  const pairError = formatChannelError(body.format, body.channel);
  if (pairError) throw new InvalidOpportunityInputError([pairError]);

  const story = await deps.stories.getStory(storyId);
  if (!story) throw new StoryNotFoundError(storyId);
  if (story.status === "archived") throw new StoryNotUsableError(storyId, story.status);

  return deps.opportunities.insertOpportunity({
    userId: story.userId ?? null,
    storyId,
    concept: body.concept,
    objective: body.objective,
    audience: body.audience ?? null,
    angle: body.angle ?? null,
    format: body.format,
    channel: body.channel,
    status: "proposed",
    score: body.score === undefined ? null : String(body.score),
    scoreBreakdown: body.scoreBreakdown ?? {},
    proposer: body.proposer,
    chatKey: body.chatKey ?? null,
  });
}

/**
 * Select an Opportunity (proposed → selected). Selecting marks the Story `used`
 * (informational only — a used Story keeps spawning formats).
 */
export async function selectOpportunity(
  opportunityId: number,
  deps: OpportunityDeps,
): Promise<Opportunity> {
  const opportunity = await deps.opportunities.getOpportunity(opportunityId);
  if (!opportunity) throw new OpportunityNotFoundError(opportunityId);
  if (opportunity.status !== "proposed") {
    throw new OpportunityStateError(opportunityId, opportunity.status, "selected");
  }

  const updated = await deps.opportunities.updateOpportunityStatus(
    opportunityId,
    "selected",
    null,
  );
  if (!updated) throw new OpportunityNotFoundError(opportunityId);

  const story = await deps.stories.getStory(opportunity.storyId);
  if (story && story.status !== "used" && story.status !== "archived") {
    await deps.stories.updateStoryStatus(story.id, "used");
  }

  return updated;
}

/** Kill an Opportunity (proposed|selected → killed). Terminal; `killReason` is required. */
export async function killOpportunity(
  opportunityId: number,
  killReason: string,
  deps: OpportunityDeps,
): Promise<Opportunity> {
  const reason = (killReason ?? "").trim();
  if (reason.length === 0) {
    throw new InvalidOpportunityInputError(["killReason is required to kill an Opportunity"]);
  }

  const opportunity = await deps.opportunities.getOpportunity(opportunityId);
  if (!opportunity) throw new OpportunityNotFoundError(opportunityId);
  if (opportunity.status === "killed") {
    throw new OpportunityStateError(opportunityId, opportunity.status, "killed");
  }

  const updated = await deps.opportunities.updateOpportunityStatus(opportunityId, "killed", reason);
  if (!updated) throw new OpportunityNotFoundError(opportunityId);
  return updated;
}

export type { OpportunityStatus };
