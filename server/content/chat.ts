/**
 * Chat-to-post seam (CannerAI parity phase 1).
 *
 * Conversational input becomes a *normal* ContentForge Opportunity and then
 * follows the ordinary generation pipeline. There is deliberately no
 * chat-only content object and no second conversation system:
 *
 *   chat message → intent extraction → Story (provenance=human)
 *                → Opportunity → GenerationPolicy → GenerationJob → Artifact
 *
 * The intent extractor is a port; the default adapter uses the existing model
 * gateway, so the domain never names a provider.
 */

import { z } from "zod";
import type { Opportunity, Story } from "@shared/schema";
import { createOpportunityFromStory, type OpportunityDeps } from "./opportunity";
import type { ContentStoragePort } from "./storage";
import type { CreateGenerationJobInput, GenerationDeps } from "./generation";
import { createGenerationJob } from "./generation";

export class ChatInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid chat request: ${issues.join("; ")}`);
    this.name = "ChatInputError";
    this.issues = issues;
  }
}

export class ChatStoryNotFoundError extends Error {
  constructor(readonly storyId: number) {
    super(`Story ${storyId} not found`);
    this.name = "ChatStoryNotFoundError";
  }
}

/** Structured intent extracted from a conversational content request. */
export interface ChatIntent {
  /** Story title. */
  title: string;
  /** Story thesis / narrative. */
  insightBody: string;
  angles: string[];
  /** Opportunity framing. */
  concept: string;
  objective: string;
  audience: string | null;
  format: string;
  channel: string;
}

export interface ChatIntentPort {
  readonly provider: string;
  extract(message: string): Promise<ChatIntent>;
}

/** The Story surface chat needs (create a human-provenance Story). */
export interface ChatStoryPort {
  insertStory(row: {
    userId?: number | null;
    researchJobId: number | null;
    provenance: string;
    title: string;
    insightBody: string;
    interpretationMarked: boolean;
    angles: string[];
    evidenceRefs: number[];
    status: string;
  }): Promise<Story>;
  getStory(id: number): Promise<Story | undefined>;
  updateStoryStatus(id: number, status: string): Promise<Story | undefined>;
}

export interface ChatDeps {
  content: ContentStoragePort;
  stories: ChatStoryPort;
  opportunities: OpportunityDeps;
  intent: ChatIntentPort;
  generation: GenerationDeps;
}

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  /** Attach to an existing Story instead of creating a new one. */
  storyId: z.number().int().positive().optional(),
  format: z.string().trim().min(1).max(50).optional(),
  channel: z.string().trim().min(1).max(50).optional(),
  voiceId: z.number().int().positive().nullable().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  /** Enqueue generation immediately (default true). */
  generate: z.boolean().optional(),
});

export type ChatRequest = z.input<typeof chatRequestSchema>;

export interface ChatResult {
  storyId: number;
  storyCreated: boolean;
  opportunity: Opportunity;
  generationJobId: number | null;
  correlationId: string | null;
}

/**
 * Turn a conversational content request into the normal chain. When `storyId`
 * is supplied the existing Story is reused (repurposing); otherwise a new
 * human-provenance Story is created — chat is a *source of meaning*, not a
 * parallel content model.
 */
export async function handleChatRequest(
  userId: number,
  request: ChatRequest,
  deps: ChatDeps,
): Promise<ChatResult> {
  const parsed = chatRequestSchema.safeParse(request ?? {});
  if (!parsed.success) {
    throw new ChatInputError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const body = parsed.data;

  const intent = await deps.intent.extract(body.message);
  const format = body.format ?? intent.format;
  const channel = body.channel ?? intent.channel;

  let story: Story;
  let storyCreated = false;
  if (body.storyId != null) {
    const existing = await deps.stories.getStory(body.storyId);
    if (!existing) throw new ChatStoryNotFoundError(body.storyId);
    story = existing;
  } else {
    story = await deps.stories.insertStory({
      userId,
      researchJobId: null,
      provenance: "human",
      title: intent.title,
      insightBody: intent.insightBody,
      interpretationMarked: true,
      angles: intent.angles,
      evidenceRefs: [],
      status: "ready",
    });
    storyCreated = true;
  }

  const opportunity = await createOpportunityFromStory(
    story.id,
    {
      concept: intent.concept,
      objective: intent.objective,
      format,
      channel,
      ...(intent.audience ? { audience: intent.audience } : {}),
      proposer: "human",
    },
    deps.opportunities,
  );

  let generationJobId: number | null = null;
  let correlationId: string | null = null;
  if (body.generate !== false) {
    const options: CreateGenerationJobInput = {
      ...(body.voiceId !== undefined ? { voiceId: body.voiceId } : {}),
      ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
      objective: intent.objective,
      ...(intent.audience ? { audience: intent.audience } : {}),
    };
    const { job } = await createGenerationJob(opportunity.id, options, deps.generation);
    generationJobId = job.id;
    correlationId = job.correlationId;
  }

  return { storyId: story.id, storyCreated, opportunity, generationJobId, correlationId };
}
