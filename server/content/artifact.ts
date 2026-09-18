/**
 * Artifact boundary: GenerationJob → Artifact, plus the readiness lifecycle.
 *
 * An Artifact is the immutable, reviewable content revision (Ticket 05 §6).
 * Content is frozen at insert — the database enforces this with a trigger
 * (migration 0007) — so any content change is a NEW row linked by
 * `supersedes_id`. Readiness is the only mutable axis:
 *
 *   draft → in_review → approved
 *                     ↘ rejected
 *
 * Approval belongs to the exact revision: approving revision N never approves
 * N+1. Rejected content is not schedulable (the scheduler only ever sees
 * `approved` artifacts).
 */

import { z } from "zod";
import type { Artifact, ArtifactReadiness, GenerationJob } from "@shared/schema";
import {
  PayloadValidationError,
  payloadSchemaRegistry,
} from "../artifacts/payloadSchemas";
import type { ContentStoragePort, JsonRecord } from "./storage";
import type { LearningRecorder } from "./learning/record";
import { ALLOWED_VIDEO_MIMES, ALLOWED_VISUAL_MIMES, MAX_VISUAL_DIMENSION } from "./visual";

export interface ArtifactDeps {
  artifacts: ContentStoragePort;
  /** Optional so existing tests that only persist artifacts stay unchanged. */
  learning?: LearningRecorder;
}

export class ArtifactNotFoundError extends Error {
  constructor(readonly artifactId: number) {
    super(`Artifact ${artifactId} not found`);
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactStateError extends Error {
  constructor(
    readonly artifactId: number,
    readonly readiness: string,
    action: string,
  ) {
    super(`Artifact ${artifactId} is "${readiness}" and cannot be ${action}`);
    this.name = "ArtifactStateError";
  }
}

export class InvalidArtifactPayloadError extends Error {
  readonly issues: string[];
  constructor(
    readonly format: string,
    issues: string[],
  ) {
    super(`Invalid ${format} artifact payload: ${issues.join("; ")}`);
    this.name = "InvalidArtifactPayloadError";
    this.issues = issues;
  }
}

/** A visual media reference named by the payload does not resolve to a usable asset. */
export class ArtifactMediaReferenceError extends Error {
  constructor(
    readonly format: string,
    readonly visualAssetId: number,
    message: string,
  ) {
    super(message);
    this.name = "ArtifactMediaReferenceError";
  }
}

/** Provenance pointer for the research this content rests on (IDs, not copies). */
export const attributionSchema = z.object({
  kind: z.literal("research_evidence"),
  researchJobId: z.number().int().positive().nullable(),
  evidenceIds: z.array(z.number().int().positive()),
});

export interface CreateArtifactInput {
  userId?: number | null;
  generationJobId: number | null;
  opportunityId: number;
  format: string;
  channel: string;
  payload: JsonRecord;
  supersedesId?: number | null;
  provenance?: "generated" | "human_edit";
  attribution?: unknown[];
  attributionReason?: string | null;
}

/**
 * Validate a payload against the format's registered schema and persist a new
 * Artifact revision. Validation is the registry's job — the Artifact domain has
 * no per-format branches.
 */
export async function createArtifact(
  input: CreateArtifactInput,
  deps: ArtifactDeps,
): Promise<Artifact> {
  if (!payloadSchemaRegistry.has(input.format)) {
    throw new InvalidArtifactPayloadError(input.format, [
      `no payload schema registered for format "${input.format}"`,
    ]);
  }

  let validated: JsonRecord;
  try {
    validated = payloadSchemaRegistry.validate<JsonRecord>(input.format, input.payload);
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      throw new InvalidArtifactPayloadError(input.format, error.issues);
    }
    throw error;
  }

  const attribution = input.attribution ?? [];
  if (attribution.length === 0 && !input.attributionReason) {
    throw new InvalidArtifactPayloadError(input.format, [
      "attribution is mandatory: supply snippets or an explicit attributionReason",
    ]);
  }

  // A payload naming a visual asset must resolve to a real, owned, ready
  // asset BEFORE any Artifact row exists — never a partially-created row
  // pointing at an invalid reference (Ticket 07 §media contract).
  const mediaRefs = payloadSchemaRegistry.mediaRefs(input.format, validated);
  const ownerId = input.userId ?? null;
  for (const ref of mediaRefs) {
    const asset = await deps.artifacts.getVisualAsset(ref.visualAssetId);
    if (!asset) {
      throw new ArtifactMediaReferenceError(
        input.format,
        ref.visualAssetId,
        `visual asset ${ref.visualAssetId} not found`,
      );
    }
    if (asset.userId !== null && asset.userId !== ownerId) {
      throw new ArtifactMediaReferenceError(
        input.format,
        ref.visualAssetId,
        `visual asset ${ref.visualAssetId} not found`,
      );
    }
    if (asset.status !== "ready") {
      throw new ArtifactMediaReferenceError(
        input.format,
        ref.visualAssetId,
        `visual asset ${ref.visualAssetId} is "${asset.status}", not ready`,
      );
    }
    const allowedMimes =
      input.format === "video" ? ALLOWED_VIDEO_MIMES : ALLOWED_VISUAL_MIMES;
    if (!(allowedMimes as readonly string[]).includes(asset.mime)) {
      throw new ArtifactMediaReferenceError(
        input.format,
        ref.visualAssetId,
        `visual asset ${ref.visualAssetId} has disallowed mime "${asset.mime}"`,
      );
    }
    if (input.format === "video" && asset.kind !== "video") {
      throw new ArtifactMediaReferenceError(
        input.format,
        ref.visualAssetId,
        `visual asset ${ref.visualAssetId} is not a video revision`,
      );
    }
    for (const [label, value] of [
      ["width", asset.width],
      ["height", asset.height],
    ] as const) {
      if (typeof value === "number" && (!Number.isInteger(value) || value <= 0 || value > MAX_VISUAL_DIMENSION)) {
        throw new ArtifactMediaReferenceError(
          input.format,
          ref.visualAssetId,
          `visual asset ${ref.visualAssetId} ${label} is out of range`,
        );
      }
    }
  }
  if (input.format === "carousel") {
    const positions = mediaRefs.map((r) => r.position);
    const expected = mediaRefs.map((_, i) => i);
    if (mediaRefs.length < 2 || JSON.stringify(positions) !== JSON.stringify(expected)) {
      throw new InvalidArtifactPayloadError(input.format, [
        "carousel must contain a contiguous ordered sequence of at least 2 ready slides",
      ]);
    }
  }

  const artifact = await deps.artifacts.insertArtifact({
    userId: input.userId ?? null,
    generationJobId: input.generationJobId,
    opportunityId: input.opportunityId,
    format: input.format,
    channel: input.channel,
    payload: validated,
    readiness: "draft",
    supersedesId: input.supersedesId ?? null,
    provenance: input.provenance ?? "generated",
    attribution,
    attributionReason: input.attributionReason ?? null,
  });

  // The ref row is the durable audit trail (Phase 3); the payload above is
  // what publication resolves. Both name the exact same pinned revision.
  for (const ref of mediaRefs) {
    await deps.artifacts.insertVisualAssetRef({
      userId: ownerId,
      artifactId: artifact.id,
      visualAssetId: ref.visualAssetId,
      role: ref.role ?? null,
      position: ref.position,
    });
  }

  return artifact;
}

/**
 * Create a new revision of an existing Artifact from a successful GenerationJob.
 * The prior revision is never mutated — the chain is the audit trail.
 */
export async function createArtifactRevision(
  priorArtifactId: number,
  input: Omit<CreateArtifactInput, "supersedesId">,
  deps: ArtifactDeps,
): Promise<Artifact> {
  const prior = await deps.artifacts.getArtifact(priorArtifactId);
  if (!prior) throw new ArtifactNotFoundError(priorArtifactId);
  return createArtifact({ ...input, supersedesId: prior.id }, deps);
}

/** draft → in_review. */
export async function submitArtifactForReview(
  artifactId: number,
  deps: ArtifactDeps,
): Promise<Artifact> {
  const artifact = await deps.artifacts.getArtifact(artifactId);
  if (!artifact) throw new ArtifactNotFoundError(artifactId);
  if (artifact.readiness !== "draft") {
    throw new ArtifactStateError(artifactId, artifact.readiness, "submitted for review");
  }
  const updated = await deps.artifacts.setArtifactReadiness(artifactId, "in_review", null);
  if (!updated) throw new ArtifactNotFoundError(artifactId);
  return updated;
}

/** in_review → approved. Approval is pinned to this exact revision. */
export async function approveArtifact(
  artifactId: number,
  deps: ArtifactDeps,
): Promise<Artifact> {
  const artifact = await deps.artifacts.getArtifact(artifactId);
  if (!artifact) throw new ArtifactNotFoundError(artifactId);
  if (artifact.readiness !== "in_review") {
    throw new ArtifactStateError(artifactId, artifact.readiness, "approved");
  }
  const updated = await deps.artifacts.setArtifactReadiness(artifactId, "approved", new Date());
  if (!updated) throw new ArtifactNotFoundError(artifactId);
  if (deps.learning) {
    const chain = await getArtifactHistory(artifactId, deps);
    await deps.learning.recordApproval(updated, chain);
  }
  return updated;
}

/** in_review → rejected. Rejected content is never schedulable. */
export async function rejectArtifact(
  artifactId: number,
  deps: ArtifactDeps,
): Promise<Artifact> {
  const artifact = await deps.artifacts.getArtifact(artifactId);
  if (!artifact) throw new ArtifactNotFoundError(artifactId);
  if (artifact.readiness !== "in_review") {
    throw new ArtifactStateError(artifactId, artifact.readiness, "rejected");
  }
  const updated = await deps.artifacts.setArtifactReadiness(artifactId, "rejected", null);
  if (!updated) throw new ArtifactNotFoundError(artifactId);
  if (deps.learning) {
    const chain = await getArtifactHistory(artifactId, deps);
    await deps.learning.recordApproval(updated, chain);
  }
  return updated;
}

/**
 * The full revision chain this artifact belongs to, oldest first, walking
 * `supersedes_id`. Bounded by the Opportunity's revisions (never a table scan).
 */
export async function getArtifactHistory(
  artifactId: number,
  deps: ArtifactDeps,
): Promise<Artifact[]> {
  const artifact = await deps.artifacts.getArtifact(artifactId);
  if (!artifact) throw new ArtifactNotFoundError(artifactId);

  const all = await deps.artifacts.listArtifactsByOpportunity(artifact.opportunityId);
  const byId = new Map(all.map((a) => [a.id, a]));

  // Walk back to the root revision of this chain.
  let root = artifact;
  const guard = new Set<number>();
  while (root.supersedesId !== null && byId.has(root.supersedesId) && !guard.has(root.id)) {
    guard.add(root.id);
    root = byId.get(root.supersedesId)!;
  }

  // Then forward from the root, following supersedes pointers.
  const chain: Artifact[] = [];
  const seen = new Set<number>();
  let cursor: Artifact | undefined = root;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = all.find((a) => a.supersedesId === cursor!.id);
  }
  return chain;
}

/** The only readiness the scheduler will ever consider. */
export function schedulableReadiness(): ArtifactReadiness {
  return "approved";
}

/**
 * Human editing produces a NEW revision (Ticket 05 §8/§18): the AI-generated
 * row is never overwritten, provenance records the human edit, and the new
 * revision re-enters the readiness machine at `draft` (human edits never
 * self-approve).
 */
export async function createHumanEditRevision(
  priorArtifactId: number,
  payload: JsonRecord,
  deps: ArtifactDeps,
  options: { actorNote?: string | null; attributionReason?: string | null } = {},
): Promise<Artifact> {
  const prior = await deps.artifacts.getArtifact(priorArtifactId);
  if (!prior) throw new ArtifactNotFoundError(priorArtifactId);

  const created = await createArtifact(
    {
      userId: prior.userId ?? null,
      generationJobId: null,
      opportunityId: prior.opportunityId,
      format: prior.format,
      channel: prior.channel,
      payload,
      supersedesId: prior.id,
      provenance: "human_edit",
      attribution: prior.attribution,
      attributionReason:
        options.attributionReason ?? prior.attributionReason ?? options.actorNote ?? "human edit",
    },
    deps,
  );
  if (deps.learning) await deps.learning.recordEdit(prior, created);
  return created;
}

export type { ArtifactReadiness, GenerationJob };
