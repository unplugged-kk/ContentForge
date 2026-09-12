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

export interface ArtifactDeps {
  artifacts: ContentStoragePort;
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

  return deps.artifacts.insertArtifact({
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
  return updated;
}

/** The only readiness the scheduler will ever consider. */
export function schedulableReadiness(): ArtifactReadiness {
  return "approved";
}

export type { ArtifactReadiness, GenerationJob };
