/**
 * Visual domain service: visual generations → assets → artifact references.
 *
 * Durability rules mirror the research/generation boundaries:
 *   • identical (opportunity, kind, intent) collapses to ONE generation
 *     (UNIQUE idempotency key is the arbiter);
 *   • `regenerate` (explicit nonce) creates a NEW generation → NEW asset revision;
 *   • a provider failure marks the row failed with a classified error; retries
 *     recover the same row;
 *   • assets are immutable once referenced; a change is a new revision via
 *     `supersedes_id`;
 *   • the provider never sees business tables — the service owns persistence.
 */

import { z } from "zod";
import type { VisualAsset, VisualGeneration } from "@shared/schema";
import { JobFailure, describeError } from "../jobs/failures";
import type { ContentStoragePort, JsonRecord } from "./storage";
import {
  getVisualProvider,
  hashIntent,
  validateVisualOutput,
  visualGenerationIdempotencyKey,
  InvalidVisualInputError,
  VisualCapabilityUnsupportedError,
  type AssetStoragePort,
  type VisualGenerationOutput,
  type VisualKind,
  type VisualProviderPort,
} from "./visual";

export class VisualServiceInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid visual request: ${issues.join("; ")}`);
    this.name = "VisualServiceInputError";
    this.issues = issues;
  }
}

export interface VisualServiceDeps {
  content: ContentStoragePort;
  storage: AssetStoragePort;
}

export const createVisualGenerationSchema = z.object({
  opportunityId: z.number().int().positive().optional(),
  generationJobId: z.number().int().positive().optional(),
  kind: z.enum(["image", "carousel_slide", "thumbnail"]),
  providerId: z.string().trim().min(1).max(80).default("local-fixture"),
  capability: z.enum(["generate_image", "edit_image", "generate_slide"]).default("generate_image"),
  intent: z.record(z.unknown()),
  role: z.string().trim().max(60).optional(),
  altText: z.string().trim().max(500).optional(),
  regenerate: z.boolean().optional(),
  regenerationNonce: z.string().trim().min(1).max(100).optional(),
});

export type CreateVisualGenerationInput = z.input<typeof createVisualGenerationSchema>;

function classifyVisualError(error: unknown): "transient" | "permanent" {
  if (error instanceof JobFailure) {
    return error.failureClass === "transient" || error.failureClass === "rate_limited"
      ? "transient"
      : "permanent";
  }
  const message = describeError(error);
  return /timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b|429|rate.?limit/i.test(message)
    ? "transient"
    : "permanent";
}

export async function createVisualGeneration(
  userId: number,
  input: CreateVisualGenerationInput,
  deps: VisualServiceDeps,
): Promise<{ generation: VisualGeneration; created: boolean }> {
  const parsed = createVisualGenerationSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new VisualServiceInputError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const body = parsed.data;

  let provider: VisualProviderPort;
  try {
    provider = getVisualProvider(body.providerId);
  } catch {
    throw new VisualServiceInputError([`unknown visual provider "${body.providerId}"`]);
  }
  if (!provider.capabilities.includes(body.capability)) {
    throw new VisualCapabilityUnsupportedError(body.providerId, body.capability);
  }

  const intent: JsonRecord = {
    ...body.intent,
    aspectRatio: body.intent.aspectRatio ?? "1:1",
    ...(body.role ? { role: body.role } : {}),
    ...(body.altText ? { altText: body.altText } : {}),
  };

  const regenerationNonce = body.regenerate
    ? (body.regenerationNonce ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
    : null;

  const idempotencyKey = visualGenerationIdempotencyKey({
    opportunityId: body.opportunityId ?? null,
    kind: body.kind,
    intent,
    regenerationNonce,
  });

  return deps.content.claimVisualGeneration({
    userId,
    intent,
    kind: body.kind,
    providerId: provider.providerId,
    capability: body.capability,
    providerVersion: provider.providerVersion,
    requestSnapshot: { intent, kind: body.kind, capability: body.capability },
    idempotencyKey,
    generationJobId: body.generationJobId ?? null,
    opportunityId: body.opportunityId ?? null,
    correlationId: `${hashIntent({ k: idempotencyKey })}-${Date.now().toString(36)}`.slice(0, 100),
  });
}

export interface VisualRunResult {
  visualGenerationId: number;
  status: "ready" | "failed";
  reused: boolean;
  visualAssetId?: number;
  failureClass?: string;
  failureMessage?: string;
}

/**
 * Execute a persisted visual generation (called by the `visual.run` worker).
 * Success persists the asset THEN marks the generation ready; failure is
 * classified and durable. Duplicate delivery of a ready row is a no-op.
 */
export async function runVisualGeneration(
  visualGenerationId: number,
  deps: VisualServiceDeps,
): Promise<VisualRunResult> {
  const generation = await deps.content.getVisualGeneration(visualGenerationId);
  if (!generation) {
    throw JobFailure.permanent(`VisualGeneration ${visualGenerationId} not found`);
  }
  if (generation.status === "ready") {
    const asset = await deps.content.getLatestVisualAssetForGeneration(generation.id);
    return {
      visualGenerationId: generation.id,
      status: "ready",
      reused: true,
      visualAssetId: asset?.id,
    };
  }

  await deps.content.markVisualGenerationRunning(generation.id);

  try {
    const provider = getVisualProvider(generation.providerId ?? "");
    if (!provider.capabilities.includes((generation.capability ?? "") as never)) {
      throw new VisualCapabilityUnsupportedError(generation.providerId ?? "?", generation.capability ?? "?");
    }

    const output: VisualGenerationOutput = await provider.generate({
      kind: generation.kind as VisualKind,
      capability: generation.capability as never,
      snapshot: (generation.requestSnapshot ?? {}) as JsonRecord,
      correlationId: generation.correlationId,
    });

    // Validate BEFORE anything durable (untrusted provider output).
    validateVisualOutput(output);

    const stored = await deps.storage.put(output.bytes, output.mime);

    const asset = await deps.content.insertVisualAsset({
      userId: generation.userId ?? null,
      visualGenerationId: generation.id,
      kind: generation.kind,
      storageKey: stored.storageKey,
      mime: output.mime,
      width: output.width,
      height: output.height,
      byteSize: stored.byteSize,
      contentHash: stored.contentHash,
      altText: output.altText,
      caption: null,
      role: ((generation.intent ?? {}) as JsonRecord).role as string | undefined ?? null,
      metadata: { provider: output.provider, providerVersion: output.providerVersion, model: output.model },
      supersedesId: null,
      provenance: "generated",
    });

    await deps.content.markVisualGenerationReady(generation.id, {
      model: output.model,
      cost: output.cost,
      attempt: generation.attempt,
    });

    return {
      visualGenerationId: generation.id,
      status: "ready",
      reused: false,
      visualAssetId: asset.id,
    };
  } catch (error) {
    if (error instanceof InvalidVisualInputError) {
      await deps.content.markVisualGenerationFailed(generation.id, "permanent", error.message, generation.attempt);
      return {
        visualGenerationId: generation.id,
        status: "failed",
        reused: false,
        failureClass: "permanent",
        failureMessage: error.message,
      };
    }
    const failureClass = classifyVisualError(error);
    const message = describeError(error);
    await deps.content.markVisualGenerationFailed(generation.id, failureClass, message, generation.attempt);
    return {
      visualGenerationId: generation.id,
      status: "failed",
      reused: false,
      failureClass,
      failureMessage: message,
    };
  }
}

/**
 * New asset revision (edit/regeneration of the visual): the prior row is never
 * mutated; the new row carries `supersedes_id`. The caller links it to the
 * Artifact as needed — historical references stay pinned.
 */
export async function createVisualAssetRevision(
  priorAssetId: number,
  output: { bytes: Buffer; mime: string; width: number | null; height: number | null; altText?: string | null },
  deps: VisualServiceDeps,
): Promise<ReturnType<VisualServiceDeps["content"]["insertVisualAsset"]>> {
  const prior = await deps.content.getVisualAsset(priorAssetId);
  if (!prior) throw new VisualServiceInputError([`visual asset ${priorAssetId} not found`]);

  validateVisualOutput(output);
  const stored = await deps.storage.put(output.bytes, output.mime);

  return deps.content.insertVisualAsset({
    userId: prior.userId ?? null,
    visualGenerationId: prior.visualGenerationId,
    kind: prior.kind,
    storageKey: stored.storageKey,
    mime: output.mime,
    width: output.width,
    height: output.height,
    byteSize: stored.byteSize,
    contentHash: stored.contentHash,
    altText: output.altText ?? prior.altText,
    caption: prior.caption,
    role: prior.role,
    metadata: { ...(prior.metadata ?? {}), revisedFrom: prior.id },
    supersedesId: prior.id,
    provenance: "generated",
  });
}

export type { VisualAsset, VisualGeneration };
