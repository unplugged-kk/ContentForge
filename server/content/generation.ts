/**
 * GenerationJob boundary: Opportunity → GenerationJob → Artifact.
 *
 * A GenerationJob is one reproducible generation *attempt* (Ticket 05 §5). It is
 * deliberately distinct from the Artifact it produces: this records how content
 * was made (the exact policy revision + the frozen effective request, model,
 * cost, attempts); the Artifact is the content. Regenerations are siblings,
 * never edits.
 *
 * The domain never names a provider: it calls a `GenerationModelPort`. The
 * default adapter wraps the existing model gateway (`server/ai`), so no second
 * AI abstraction exists.
 *
 * Idempotency deliberately distinguishes two cases (§21):
 *   • duplicate delivery — same (opportunity, policy spec) → the SAME job;
 *   • intentional regeneration — an explicit nonce → a NEW job, and therefore a
 *     new Artifact revision, while the original revision stays immutable.
 */

import { randomUUID } from "node:crypto";
import type { GenerationJob, Opportunity, Story } from "@shared/schema";
import { JobFailure, describeError } from "../jobs/failures";
import { payloadSchemaRegistry } from "../artifacts/payloadSchemas";
import { createArtifact, attributionSchema } from "./artifact";
import {
  assembleEffectiveRequest,
  resolveGenerationPolicy,
  TemplateFormatMismatchError,
  TemplateNotFoundError,
  VoiceNotFoundError,
  type EffectiveGenerationRequest,
} from "./policy";
import type { ContentStoragePort, JsonRecord } from "./storage";

// ── Model gateway port ────────────────────────────────────────────────────────
export interface GenerationRequest {
  format: string;
  channel: string;
  /** The frozen effective request (policy + voice + template + format + context). */
  policy: EffectiveGenerationRequest;
  correlationId: string;
  /** Bounded context — IDs and excerpts, never bulk content. */
  context: GenerationContext;
}

export interface GenerationContext {
  story: { id: number; title: string; insightBody: string; angles: string[] };
  opportunity: {
    id: number;
    concept: string;
    objective: string;
    audience: string | null;
    angle: string | null;
  };
  evidence: Array<{ id: number; excerpt: string; kind: string }>;
}

export interface GenerationOutput {
  /** Raw payload; validated against the format's registered schema downstream. */
  payload: JsonRecord;
  model: string;
  provider: string;
  cost: string | null;
  usage: Record<string, unknown>;
}

export interface GenerationModelPort {
  readonly provider: string;
  generate(request: GenerationRequest): Promise<GenerationOutput>;
}

// ── Deps ──────────────────────────────────────────────────────────────────────
export interface GenerationEvidenceReader {
  listEvidence(researchJobId: number): Promise<Array<{ id: number; excerpt: string; kind: string }>>;
}

export interface GenerationStoryReader {
  getStory(id: number): Promise<Story | undefined>;
}

export interface GenerationDeps {
  content: ContentStoragePort;
  stories: GenerationStoryReader;
  evidence: GenerationEvidenceReader;
  model: GenerationModelPort;
  /** Model id used when a request does not pin one (e.g. MODELS.TEXT). */
  defaultModel: string;
}

export interface CreateGenerationJobInput {
  /** Voice / template selections that feed the resolved policy. */
  voiceId?: number | null;
  templateId?: number | null;
  objective?: string | null;
  audience?: string | null;
  constraints?: JsonRecord;
  model?: string;
  /** Set when regenerating after a rejection (stays on the same Opportunity). */
  priorArtifactId?: number;
  rejectionReason?: string;
  /**
   * Intentional regeneration: bypasses idempotent reuse and creates a new job
   * (and therefore a new Artifact revision). Omit for normal idempotent creation.
   */
  regenerate?: boolean;
}

export class OpportunityNotFoundError extends Error {
  constructor(readonly opportunityId: number) {
    super(`Opportunity ${opportunityId} not found`);
    this.name = "OpportunityNotFoundError";
  }
}

export class OpportunityKilledError extends Error {
  constructor(readonly opportunityId: number) {
    super(`Opportunity ${opportunityId} is killed and cannot produce content`);
    this.name = "OpportunityKilledError";
  }
}

export class StoryMissingForOpportunityError extends Error {
  constructor(readonly opportunityId: number) {
    super(`Opportunity ${opportunityId} references a Story that no longer exists`);
    this.name = "StoryMissingForOpportunityError";
  }
}

export class GenerationInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid generation input: ${issues.join("; ")}`);
    this.name = "GenerationInputError";
    this.issues = issues;
  }
}

/** Load the bounded context a generation needs (IDs + excerpts, never bulk). */
export async function loadGenerationContext(
  opportunity: Opportunity,
  deps: GenerationDeps,
): Promise<{ story: Story; context: GenerationContext }> {
  const story = await deps.stories.getStory(opportunity.storyId);
  if (!story) throw new StoryMissingForOpportunityError(opportunity.id);

  const evidence =
    story.researchJobId === null ? [] : await deps.evidence.listEvidence(story.researchJobId);

  return {
    story,
    context: {
      story: {
        id: story.id,
        title: story.title,
        insightBody: story.insightBody,
        angles: story.angles ?? [],
      },
      opportunity: {
        id: opportunity.id,
        concept: opportunity.concept,
        objective: opportunity.objective,
        audience: opportunity.audience,
        angle: opportunity.angle,
      },
      evidence,
    },
  };
}

/**
 * Deterministic generation identity.
 *
 * `regenerationNonce` is the documented escape hatch: absent → a duplicate
 * delivery of the same logical request collapses to one job; present → a
 * deliberate regeneration produces a distinct job/revision.
 */
export function generationIdempotencyKey(
  opportunityId: number,
  specHash: string,
  regenerationNonce?: string | null,
): string {
  const base = `generation:${opportunityId}:${specHash.slice(0, 40)}`;
  return regenerationNonce ? `${base}:regen:${regenerationNonce}` : base;
}

/**
 * Create (or idempotently reuse) a GenerationJob for an Opportunity. The policy
 * is resolved to an immutable revision and the effective request is frozen onto
 * the job, so the attempt is reproducible from the database alone.
 */
export async function createGenerationJob(
  opportunityId: number,
  input: CreateGenerationJobInput,
  deps: GenerationDeps,
): Promise<{
  job: GenerationJob;
  created: boolean;
  effective: EffectiveGenerationRequest;
  policyCreated: boolean;
}> {
  const opportunity = await deps.content.getOpportunity(opportunityId);
  if (!opportunity) throw new OpportunityNotFoundError(opportunityId);
  if (opportunity.status === "killed") throw new OpportunityKilledError(opportunityId);

  const { story, context } = await loadGenerationContext(opportunity, deps);

  const resolved = await resolveGenerationPolicy(
    {
      userId: opportunity.userId ?? null,
      format: opportunity.format,
      channel: opportunity.channel,
      voiceId: input.voiceId ?? null,
      templateId: input.templateId ?? null,
      objective: input.objective ?? opportunity.objective,
      audience: input.audience ?? opportunity.audience,
      constraints: input.constraints ?? {},
      model: input.model ?? deps.defaultModel,
    },
    { content: deps.content },
  );

  const modelId =
    (resolved.policy.modelPreferences?.model as string | undefined) ??
    input.model ??
    deps.defaultModel;
  const effective = assembleEffectiveRequest(resolved, context, modelId);

  // Intentional regeneration: a nonce makes the key distinct (new job/revision).
  const regenerationNonce = input.regenerate ? randomUUID() : null;
  let priorArtifactId = input.priorArtifactId ?? null;
  if (input.regenerate && priorArtifactId === null) {
    const existing = await deps.content.listArtifactsByOpportunity(opportunityId);
    const last = existing[existing.length - 1];
    priorArtifactId = last?.id ?? null;
  }

  const { job, created } = await deps.content.claimGenerationJob({
    userId: opportunity.userId ?? null,
    opportunityId,
    format: opportunity.format,
    channel: opportunity.channel,
    policySnapshot: effective as unknown as JsonRecord,
    policyId: resolved.policy.id,
    idempotencyKey: generationIdempotencyKey(opportunityId, resolved.specHash, regenerationNonce),
    correlationId: randomUUID(),
    priorArtifactId,
    rejectionReason: input.rejectionReason ?? null,
  });

  return { job, created, effective, policyCreated: resolved.created };
}

// ── Execution ─────────────────────────────────────────────────────────────────
export interface GenerationRunResult {
  generationJobId: number;
  status: "succeeded" | "failed";
  reused: boolean;
  artifactId?: number;
  failureClass?: string;
  failureMessage?: string;
  model?: string;
  provider?: string;
}

/**
 * Execute a persisted GenerationJob. Called by the `generation.run` worker; on
 * success it creates the Artifact through the Artifact boundary (payload
 * validated by the registry) and freezes nothing else.
 */
export async function runGenerationJob(
  generationJobId: number,
  deps: GenerationDeps,
): Promise<GenerationRunResult> {
  const job = await deps.content.getGenerationJob(generationJobId);
  if (!job) {
    throw JobFailure.permanent(`GenerationJob ${generationJobId} not found`);
  }
  if (job.status === "succeeded") {
    const existing = await deps.content.getArtifactByGenerationJob(job.id);
    return {
      generationJobId: job.id,
      status: "succeeded",
      reused: true,
      artifactId: existing?.id,
      model: job.model ?? undefined,
      provider: job.provider ?? undefined,
    };
  }

  await deps.content.markGenerationRunning(job.id);

  try {
    const opportunity = await deps.content.getOpportunity(job.opportunityId);
    if (!opportunity) {
      throw JobFailure.permanent(`Opportunity ${job.opportunityId} not found`);
    }
    const { story, context } = await loadGenerationContext(opportunity, deps);

    const policy = (job.policySnapshot ?? {}) as unknown as EffectiveGenerationRequest;
    if (!policy.systemPrompt) {
      throw JobFailure.permanent(`GenerationJob ${job.id} has no frozen policy snapshot`);
    }
    // Guard: the frozen snapshot must target a format we can validate.
    if (!payloadSchemaRegistry.has(job.format)) {
      throw JobFailure.permanent(`no payload schema registered for format "${job.format}"`);
    }

    const request: GenerationRequest = {
      format: job.format,
      channel: job.channel,
      policy,
      correlationId: job.correlationId,
      context,
    };

    const output = await deps.model.generate(request);

    const evidenceIds = context.evidence.map((e) => e.id);
    const attribution =
      evidenceIds.length > 0
        ? [
            attributionSchema.parse({
              kind: "research_evidence",
              researchJobId: story.researchJobId,
              evidenceIds,
            }),
          ]
        : [];

    const artifact = await createArtifact(
      {
        userId: job.userId ?? null,
        generationJobId: job.id,
        opportunityId: job.opportunityId,
        format: job.format,
        channel: job.channel,
        payload: output.payload,
        supersedesId: job.priorArtifactId ?? null,
        provenance: "generated",
        attribution,
        attributionReason:
          evidenceIds.length > 0 ? null : "no research evidence available for attribution",
      },
      { artifacts: deps.content },
    );

    await deps.content.markGenerationSucceeded(job.id, {
      model: output.model,
      provider: output.provider,
      cost: output.cost,
      attempt: job.attempt,
    });

    return {
      generationJobId: job.id,
      status: "succeeded",
      reused: false,
      artifactId: artifact.id,
      model: output.model,
      provider: output.provider,
    };
  } catch (error) {
    const failureClass = error instanceof JobFailure ? error.failureClass : "permanent";
    const message = describeError(error);
    await deps.content.markGenerationFailed(job.id, failureClass, message, job.attempt);
    return {
      generationJobId: job.id,
      status: "failed",
      reused: false,
      failureClass,
      failureMessage: message,
    };
  }
}

export {
  TemplateFormatMismatchError,
  TemplateNotFoundError,
  VoiceNotFoundError,
  type EffectiveGenerationRequest,
};
