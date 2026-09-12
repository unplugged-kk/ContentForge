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
  /**
   * Durable idempotency: repeating a request with the same key reuses the
   * Opportunity (and its GenerationJob) instead of creating a parallel one.
   */
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  /** Intentional regeneration: a new job/Artifact revision for the same request. */
  regenerate: z.boolean().optional(),
});

export type ChatRequest = z.input<typeof chatRequestSchema>;

export interface ChatResult {
  storyId: number;
  storyCreated: boolean;
  /** True when a duplicate request was collapsed onto an existing Opportunity. */
  reused: boolean;
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

  const keyedOpportunity = body.idempotencyKey
    ? await deps.content.getOpportunityByChatKey(body.idempotencyKey)
    : undefined;

  // Duplicate delivery (and not an explicit regeneration) → reuse the existing
  // Opportunity and its GenerationJob. No duplicate work.
  if (keyedOpportunity && body.regenerate !== true) {
    const job = await deps.content.getLatestGenerationJobForOpportunity(keyedOpportunity.id);
    return {
      storyId: keyedOpportunity.storyId,
      storyCreated: false,
      reused: true,
      opportunity: keyedOpportunity,
      generationJobId: job?.id ?? null,
      correlationId: job?.correlationId ?? null,
    };
  }

  const intent = await deps.intent.extract(body.message);

  let storyId: number;
  let storyCreated = false;
  let opportunity: Opportunity;

  if (keyedOpportunity) {
    // Explicit regeneration against an existing chat Opportunity: reuse it.
    storyId = keyedOpportunity.storyId;
    opportunity = keyedOpportunity;
  } else {
    const format = body.format ?? intent.format;
    const channel = body.channel ?? intent.channel;

    let story: Story;
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
    storyId = story.id;

    try {
      opportunity = await createOpportunityFromStory(
        story.id,
        {
          concept: intent.concept,
          objective: intent.objective,
          format,
          channel,
          ...(intent.audience ? { audience: intent.audience } : {}),
          proposer: "human",
          ...(body.idempotencyKey ? { chatKey: body.idempotencyKey } : {}),
        },
        deps.opportunities,
      );
    } catch (error) {
      // Two concurrent identical requests: the UNIQUE chat_key index rejects the
      // loser, which then reuses the winner's Opportunity instead of failing.
      if (body.idempotencyKey) {
        const winner = await deps.content.getOpportunityByChatKey(body.idempotencyKey);
        if (winner) {
          const job = await deps.content.getLatestGenerationJobForOpportunity(winner.id);
          return {
            storyId: winner.storyId,
            storyCreated: false,
            reused: true,
            opportunity: winner,
            generationJobId: job?.id ?? null,
            correlationId: job?.correlationId ?? null,
          };
        }
      }
      throw error;
    }
  }

  let generationJobId: number | null = null;
  let correlationId: string | null = null;
  if (body.generate !== false) {
    const options: CreateGenerationJobInput = {
      ...(body.voiceId !== undefined ? { voiceId: body.voiceId } : {}),
      ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
      objective: intent.objective,
      ...(intent.audience ? { audience: intent.audience } : {}),
      ...(body.regenerate ? { regenerate: true } : {}),
    };
    const { job } = await createGenerationJob(opportunity.id, options, deps.generation);
    generationJobId = job.id;
    correlationId = job.correlationId;
  }

  return { storyId, storyCreated, reused: false, opportunity, generationJobId, correlationId };
}
