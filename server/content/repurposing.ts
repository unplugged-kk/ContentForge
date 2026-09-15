/**
 * Repurposing boundary: Story → Opportunity[N].
 *
 * `repurposeStory` turns one durable Story into several independently
 * addressable Opportunities (and, unless a target opts out, their
 * GenerationJobs) without re-researching. It is a batch composition over the
 * EXISTING primitives (`createOpportunityFromStory`, `createGenerationJob`) —
 * no parallel lineage model, no second generation abstraction, no second
 * queue, no `RepurposingPolicy`. Target-specific behavior (X post vs X
 * thread vs LinkedIn) falls out of `format`/`channel` differing per target,
 * exactly as it already does for any two ordinary Opportunities on the same
 * Story — nothing here branches on a platform name.
 *
 * The central invariant: this module never reaches research, a
 * SourceProvider, or the queue. `createGenerationJob` reads the Story's
 * EXISTING evidence (via `loadGenerationContext`); it never creates one.
 */

import { randomUUID } from "node:crypto";
import type { GenerationJob, Opportunity } from "@shared/schema";
import {
  createOpportunityFromStory,
  formatChannelError,
  StoryNotFoundError,
  StoryNotUsableError,
  type OpportunityDeps,
} from "./opportunity";
import { createGenerationJob, type CreateGenerationJobInput, type GenerationDeps } from "./generation";

export interface RepurposeDeps {
  opportunities: OpportunityDeps;
  generation: GenerationDeps;
}

export interface RepurposeTargetInput {
  format: string;
  channel: string;
  concept?: string;
  objective?: string;
  audience?: string;
  angle?: string;
  /** Opportunity only, no GenerationJob for this target. Default: generate. */
  generate?: boolean;
  voiceId?: number | null;
  templateId?: number | null;
  model?: string;
  constraints?: Record<string, unknown>;
  /**
   * Bypass idempotent reuse for THIS target — a deliberate new derivation
   * even though the batch's `requestKey` (and this target's format/channel)
   * matches an earlier repurpose call. Mirrors `CreateGenerationJobInput.regenerate`.
   */
  regenerate?: boolean;
}

export interface RepurposeInput {
  /**
   * Durable idempotency for the WHOLE batch. Omit for no dedup guarantee —
   * mirrors chat-to-post's optional `idempotencyKey`. Present, a duplicate
   * delivery of the same (storyId, requestKey, format, channel) reuses the
   * existing Opportunity instead of creating a sibling.
   */
  requestKey?: string;
  targets: RepurposeTargetInput[];
}

export type RepurposeOutcomeStatus = "created" | "reused" | "invalid";

export interface RepurposeTargetOutcome {
  format: string;
  channel: string;
  status: RepurposeOutcomeStatus;
  opportunity?: Opportunity;
  job?: GenerationJob;
  error?: string;
}

export interface RepurposeResult {
  storyId: number;
  outcomes: RepurposeTargetOutcome[];
}

export class RepurposeInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid repurpose input: ${issues.join("; ")}`);
    this.name = "RepurposeInputError";
    this.issues = issues;
  }
}

function repurposeKeyFor(storyId: number, requestKey: string, format: string, channel: string): string {
  return `repurpose:${storyId}:${requestKey}:${format}:${channel}`;
}

/**
 * Story → N Opportunities (and, unless a target sets `generate: false`,
 * their GenerationJobs). Every target is validated independently — an
 * invalid target is reported as such but never rolls back its valid
 * siblings (partial success by design; §18). `callerUserId`, when supplied,
 * enforces ownership: a foreign Story is refused with the exact same
 * `StoryNotFoundError` a missing one produces (non-leaking).
 */
export async function repurposeStory(
  storyId: number,
  input: RepurposeInput,
  deps: RepurposeDeps,
  callerUserId?: number | null,
): Promise<RepurposeResult> {
  if (!Number.isInteger(storyId) || storyId <= 0) {
    throw new RepurposeInputError(["storyId must be a positive integer"]);
  }
  if (!input || !Array.isArray(input.targets) || input.targets.length === 0) {
    throw new RepurposeInputError(["at least one target is required"]);
  }

  const story = await deps.opportunities.stories.getStory(storyId);
  if (!story) throw new StoryNotFoundError(storyId);
  if (callerUserId != null && story.userId !== null && story.userId !== callerUserId) {
    // A foreign Story looks exactly like a missing one — no ownership leak.
    throw new StoryNotFoundError(storyId);
  }
  if (story.status === "archived") throw new StoryNotUsableError(storyId, story.status);

  const content = deps.opportunities.opportunities;
  const outcomes: RepurposeTargetOutcome[] = [];

  for (const target of input.targets) {
    const format = String(target?.format ?? "").trim();
    const channel = String(target?.channel ?? "").trim();
    if (!format || !channel) {
      outcomes.push({ format, channel, status: "invalid", error: "format and channel are required" });
      continue;
    }

    const pairError = formatChannelError(format, channel);
    if (pairError) {
      outcomes.push({ format, channel, status: "invalid", error: pairError });
      continue;
    }

    let repurposeKey: string | null = null;
    if (input.requestKey && !target.regenerate) {
      repurposeKey = repurposeKeyFor(storyId, input.requestKey, format, channel);
      const existing = await content.getOpportunityByRepurposeKey?.(repurposeKey);
      if (existing) {
        const job = await content.getLatestGenerationJobForOpportunity(existing.id);
        outcomes.push({ format, channel, status: "reused", opportunity: existing, job });
        continue;
      }
    } else if (input.requestKey && target.regenerate) {
      // Intentional new derivation: a fresh nonce keeps it unique without
      // ever colliding with (or being reusable via) the base logical key.
      repurposeKey = `${repurposeKeyFor(storyId, input.requestKey, format, channel)}:regen:${randomUUID()}`;
    }

    let opportunity: Opportunity;
    try {
      opportunity = await createOpportunityFromStory(
        storyId,
        {
          concept: target.concept ?? `${story.title} → ${format} (${channel})`,
          objective: target.objective ?? story.title,
          format,
          channel,
          ...(target.audience ? { audience: target.audience } : {}),
          ...(target.angle ? { angle: target.angle } : {}),
          proposer: "human",
          ...(repurposeKey ? { repurposeKey } : {}),
        },
        deps.opportunities,
      );
    } catch (error) {
      // Two concurrent identical requests: the UNIQUE repurpose_key index
      // rejects the loser, which reuses the winner instead of failing.
      if (repurposeKey) {
        const winner = await content.getOpportunityByRepurposeKey?.(repurposeKey);
        if (winner) {
          const job = await content.getLatestGenerationJobForOpportunity(winner.id);
          outcomes.push({ format, channel, status: "reused", opportunity: winner, job });
          continue;
        }
      }
      outcomes.push({
        format,
        channel,
        status: "invalid",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    let job: GenerationJob | undefined;
    let jobError: string | undefined;
    if (target.generate !== false) {
      try {
        const jobInput: CreateGenerationJobInput = {
          ...(target.voiceId !== undefined ? { voiceId: target.voiceId } : {}),
          ...(target.templateId !== undefined ? { templateId: target.templateId } : {}),
          ...(target.objective ? { objective: target.objective } : {}),
          ...(target.audience ? { audience: target.audience } : {}),
          ...(target.constraints ? { constraints: target.constraints } : {}),
          ...(target.model ? { model: target.model } : {}),
        };
        const created = await createGenerationJob(opportunity.id, jobInput, deps.generation);
        job = created.job;
      } catch (error) {
        jobError = error instanceof Error ? error.message : String(error);
      }
    }

    outcomes.push({
      format,
      channel,
      status: "created",
      opportunity,
      ...(job ? { job } : {}),
      ...(jobError ? { error: jobError } : {}),
    });
  }

  return { storyId, outcomes };
}
