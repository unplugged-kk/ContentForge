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
  resolveProviderModel,
  validateVisualOutput,
  visualGenerationIdempotencyKey,
  InvalidVisualInputError,
  VisualCapabilityUnsupportedError,
  type AssetStoragePort,
  type VisualCapability,
  type VisualGenerationOutput,
  type VisualProviderPort,
  type VisualSourceImage,
} from "./visual";
import {
  MAX_VARIATION_COUNT,
  MAX_VISUAL_PROMPT_CHARS,
  resolveVisualSpec,
  validateCarouselSlideCount,
  validateVariationCount,
} from "./visualSpecs";
import { assembleContext, EMPTY_CONTEXT_ASSEMBLY, type ContextStorageReader } from "./context";
import { getFormatProfile } from "./formatProfiles";

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
  contextReader?: ContextStorageReader;
}

export const createVisualGenerationSchema = z.object({
  opportunityId: z.number().int().positive().optional(),
  generationJobId: z.number().int().positive().optional(),
  kind: z.enum(["image", "carousel_slide", "thumbnail", "carousel"]),
  providerId: z.string().trim().min(1).max(80).default("local-fixture"),
  capability: z
    .enum(["generate_image", "generate_image_variations", "refine_image", "edit_image", "generate_slide"])
    .optional(),
  intent: z.record(z.unknown()),
  model: z.string().trim().min(1).max(120).optional(),
  role: z.string().trim().max(60).optional(),
  altText: z.string().trim().max(500).optional(),
  regenerate: z.boolean().optional(),
  regenerationNonce: z.string().trim().min(1).max(100).optional(),
  variationCount: z.number().int().min(1).max(MAX_VARIATION_COUNT).optional(),
  slideCount: z.number().int().min(2).max(10).optional(),
  specId: z.string().trim().min(1).max(60).optional(),
  sourceVisualAssetId: z.number().int().positive().optional(),
  instruction: z.string().trim().min(1).max(MAX_VISUAL_PROMPT_CHARS).optional(),
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

  const isCarousel = body.kind === "carousel";
  const slideCount =
    body.slideCount ??
    (typeof body.intent.slideCount === "number" ? body.intent.slideCount : isCarousel ? 3 : undefined);
  const variationCount =
    body.variationCount ??
    (isCarousel ? slideCount! : typeof body.intent.variationCount === "number" ? body.intent.variationCount : 1);

  if (isCarousel) {
    const slideIssue = validateCarouselSlideCount(variationCount);
    if (slideIssue) throw new VisualServiceInputError([slideIssue]);
  } else {
    const variationIssue = validateVariationCount(variationCount);
    if (variationIssue) throw new VisualServiceInputError([variationIssue]);
  }

  if (body.sourceVisualAssetId) {
    const source = await deps.content.getVisualAsset(body.sourceVisualAssetId);
    if (!source || (source.userId !== null && source.userId !== userId)) {
      throw new VisualServiceInputError(["source visual asset not found"]);
    }
    if (source.status !== "ready") {
      throw new VisualServiceInputError([`source visual asset is "${source.status}", not ready`]);
    }
  } else if (body.capability === "refine_image") {
    throw new VisualServiceInputError(["refine_image requires sourceVisualAssetId"]);
  }

  const capability: VisualCapability =
    body.capability ??
    (body.sourceVisualAssetId
      ? "refine_image"
      : isCarousel
        ? "generate_slide"
        : variationCount > 1
          ? "generate_image_variations"
          : "generate_image");

  let provider: VisualProviderPort;
  try {
    provider = getVisualProvider(body.providerId);
  } catch {
    throw new VisualServiceInputError([`unknown visual provider "${body.providerId}"`]);
  }
  if (!provider.capabilities.includes(capability)) {
    throw new VisualCapabilityUnsupportedError(body.providerId, capability);
  }
  resolveProviderModel(provider, body.model);

  let format: string | null = body.kind === "carousel" ? "carousel" : body.kind;
  let channel: string | null = null;
  if (body.opportunityId) {
    const opportunity = await deps.content.getOpportunity(body.opportunityId);
    if (opportunity) {
      format = opportunity.format;
      channel = opportunity.channel;
    }
  }
  const profile = format && channel ? getFormatProfile(format, channel) : undefined;
  let spec;
  try {
    spec = resolveVisualSpec({
      specId: body.specId ?? (typeof body.intent.specId === "string" ? body.intent.specId : profile?.constraints.visualSpecId),
      format,
      channel,
      aspectRatio: body.intent.aspectRatio,
    });
  } catch (error) {
    throw new VisualServiceInputError([describeError(error)]);
  }

  const instruction =
    body.instruction ?? (typeof body.intent.instruction === "string" ? body.intent.instruction : null);
  if (instruction && instruction.length > MAX_VISUAL_PROMPT_CHARS) {
    throw new VisualServiceInputError([`instruction exceeds ${MAX_VISUAL_PROMPT_CHARS} characters`]);
  }

  const intent: JsonRecord = {
    ...body.intent,
    aspectRatio: spec.aspectRatio,
    specId: spec.id,
    variationCount,
    ...(isCarousel ? { slideCount: variationCount } : {}),
    ...(body.role ? { role: body.role } : {}),
    ...(body.altText ? { altText: body.altText } : {}),
    ...(body.model ? { modelPreference: body.model } : {}),
    ...(instruction ? { instruction } : {}),
    ...(body.sourceVisualAssetId ? { sourceVisualAssetId: body.sourceVisualAssetId } : {}),
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

  let contextSnapshot: JsonRecord = {
    sourceRefs: EMPTY_CONTEXT_ASSEMBLY.sourceRefs,
    contextHash: EMPTY_CONTEXT_ASSEMBLY.contextHash,
    renderedBlock: EMPTY_CONTEXT_ASSEMBLY.renderedBlock,
  };
  if (deps.contextReader) {
    try {
      const assembly = await assembleContext(userId, deps.contextReader);
      contextSnapshot = {
        sourceRefs: assembly.sourceRefs,
        contextHash: assembly.contextHash,
        renderedBlock: assembly.renderedBlock,
      };
    } catch {
      contextSnapshot = { ...contextSnapshot, note: "context unavailable" };
    }
  }

  return deps.content.claimVisualGeneration({
    userId,
    intent,
    kind: body.kind,
    providerId: provider.providerId,
    capability,
    providerVersion: provider.providerVersion,
    requestSnapshot: {
      intent,
      kind: body.kind,
      capability,
      spec,
      context: contextSnapshot,
      instruction: instruction ? { kind: "data", text: instruction } : null,
    },
    idempotencyKey,
    generationJobId: body.generationJobId ?? null,
    opportunityId: body.opportunityId ?? null,
    correlationId: `${hashIntent({ k: idempotencyKey })}-${Date.now().toString(36)}`.slice(0, 100),
    variationCount,
    sourceVisualAssetId: body.sourceVisualAssetId ?? null,
    specId: spec.id,
  });
}

export interface VisualRunResult {
  visualGenerationId: number;
  status: "ready" | "failed" | "partial";
  reused: boolean;
  visualAssetId?: number;
  visualAssetIds?: number[];
  failureClass?: string;
  failureMessage?: string;
}

function providerKind(kind: string): "image" | "carousel_slide" | "thumbnail" {
  if (kind === "carousel" || kind === "carousel_slide") return "carousel_slide";
  if (kind === "thumbnail") return "thumbnail";
  return "image";
}

function assetKind(kind: string): string {
  if (kind === "carousel") return "carousel_slide";
  return kind;
}

/**
 * Execute a persisted visual generation (called by the `visual.run` worker).
 * One generation may produce N ordered assets. Duplicate delivery of a ready
 * row is a no-op. Retry fills missing positions; it never invents extra variations.
 */
export async function runVisualGeneration(
  visualGenerationId: number,
  deps: VisualServiceDeps,
): Promise<VisualRunResult> {
  const generation = await deps.content.getVisualGeneration(visualGenerationId);
  if (!generation) {
    throw JobFailure.permanent(`VisualGeneration ${visualGenerationId} not found`);
  }
  const wanted = Math.max(1, generation.variationCount ?? 1);
  const existing = await deps.content.listVisualAssetsForGeneration(generation.id);
  const readyExisting = existing.filter((a) => a.status === "ready" && a.supersedesId == null);
  if (generation.status === "ready" && readyExisting.length >= wanted) {
    return {
      visualGenerationId: generation.id,
      status: "ready",
      reused: true,
      visualAssetId: readyExisting[0]?.id,
      visualAssetIds: readyExisting.map((a) => a.id),
    };
  }

  await deps.content.markVisualGenerationRunning(generation.id);

  const occupied = new Set(readyExisting.map((a) => a.position));
  let lastModel: string | null = generation.model;
  let lastCost: string | null = generation.cost;
  let lastTransient: string | null = null;
  let lastPermanent: string | null = null;

  try {
    const provider = getVisualProvider(generation.providerId ?? "");
    if (!provider.capabilities.includes((generation.capability ?? "") as never)) {
      throw new VisualCapabilityUnsupportedError(generation.providerId ?? "?", generation.capability ?? "?");
    }
    const modelPreference =
      ((generation.intent ?? {}) as JsonRecord).modelPreference as string | undefined ?? null;
    resolveProviderModel(provider, modelPreference);

    let source: VisualSourceImage | undefined;
    if (generation.sourceVisualAssetId) {
      const sourceAsset = await deps.content.getVisualAsset(generation.sourceVisualAssetId);
      if (!sourceAsset) throw JobFailure.permanent("refinement source asset is missing");
      const bytes = await deps.storage.get(sourceAsset.storageKey);
      source = {
        mime: sourceAsset.mime,
        width: sourceAsset.width,
        height: sourceAsset.height,
        bytes,
      };
    }

    const snapshot = (generation.requestSnapshot ?? {}) as JsonRecord;
    const instruction =
      typeof (generation.intent as JsonRecord).instruction === "string"
        ? String((generation.intent as JsonRecord).instruction)
        : null;

    for (let position = 0; position < wanted; position++) {
      if (occupied.has(position)) continue;
      try {
        const output: VisualGenerationOutput = await provider.generate({
          kind: providerKind(generation.kind),
          capability: generation.capability as never,
          snapshot,
          correlationId: generation.correlationId,
          model: modelPreference,
          variationIndex: position,
          variationCount: wanted,
          source,
          instruction,
        });
        validateVisualOutput(output);
        const stored = await deps.storage.put(output.bytes, output.mime);
        const asset = await deps.content.insertVisualAsset({
          userId: generation.userId ?? null,
          visualGenerationId: generation.id,
          kind: assetKind(generation.kind),
          storageKey: stored.storageKey,
          mime: output.mime,
          width: output.width,
          height: output.height,
          byteSize: stored.byteSize,
          contentHash: stored.contentHash,
          altText: output.altText,
          caption: null,
          role: ((generation.intent ?? {}) as JsonRecord).role as string | undefined ?? null,
          metadata: {
            provider: output.provider,
            providerVersion: output.providerVersion,
            model: output.model,
            variationIndex: position,
          },
          supersedesId: null,
          provenance: "generated",
          position,
        });
        occupied.add(position);
        lastModel = output.model;
        lastCost = output.cost;
        void asset;
      } catch (error) {
        if (error instanceof InvalidVisualInputError) {
          lastPermanent = error.message;
          continue;
        }
        const failureClass = classifyVisualError(error);
        const message = describeError(error);
        if (failureClass === "transient") lastTransient = message;
        else lastPermanent = message;
      }
    }

    const produced = await deps.content.listVisualAssetsForGeneration(generation.id);
    const ready = produced.filter((a) => a.status === "ready" && a.supersedesId == null);
    const ids = ready.sort((a, b) => a.position - b.position).map((a) => a.id);

    if (ready.length >= wanted) {
      await deps.content.markVisualGenerationReady(generation.id, {
        model: lastModel,
        cost: lastCost,
        attempt: generation.attempt,
      });
      return {
        visualGenerationId: generation.id,
        status: "ready",
        reused: false,
        visualAssetId: ids[0],
        visualAssetIds: ids,
      };
    }

    if (ready.length > 0) {
      await deps.content.markVisualGenerationPartial(generation.id, {
        model: lastModel,
        cost: lastCost,
        attempt: generation.attempt,
        message: lastTransient ?? lastPermanent ?? "partial visual generation",
      });
      if (lastTransient) {
        return {
          visualGenerationId: generation.id,
          status: "partial",
          reused: false,
          visualAssetId: ids[0],
          visualAssetIds: ids,
          failureClass: "transient",
          failureMessage: lastTransient,
        };
      }
      return {
        visualGenerationId: generation.id,
        status: "partial",
        reused: false,
        visualAssetId: ids[0],
        visualAssetIds: ids,
        failureClass: "permanent",
        failureMessage: lastPermanent ?? "partial visual generation",
      };
    }

    const failureClass = lastTransient ? "transient" : "permanent";
    const message = lastTransient ?? lastPermanent ?? "visual generation failed";
    await deps.content.markVisualGenerationFailed(generation.id, failureClass, message, generation.attempt);
    return {
      visualGenerationId: generation.id,
      status: "failed",
      reused: false,
      failureClass,
      failureMessage: message,
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
    position: prior.position,
  });
}

export type { VisualAsset, VisualGeneration };
