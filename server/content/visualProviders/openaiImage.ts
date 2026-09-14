/**
 * Real image-generation provider (Phase 9 §12) behind the generalized
 * `VisualProviderPort` seam — no separate "media" abstraction, no separate
 * `ImageProviderPort`. Uses the project's EXISTING OpenAI-compatible client
 * (`server/ai/config.ts`), which is already env-driven for deployment mode:
 *
 *   • OpenAI (default):  leave AI_BASE_URL unset
 *   • Local/self-hosted: AI_BASE_URL=http://127.0.0.1:PORT/v1 (Ollama, etc.)
 *   • Any compatible API: AI_BASE_URL=<endpoint>
 *
 * This file never branches on vendor identity — it calls the official
 * `images.generate` contract and reads whichever shape the response carries
 * (`b64_json` or `url`). Credentials are read once at client construction
 * (`server/ai/config.ts`) and never appear in a business row, a queue
 * payload, or a log line here.
 */

import { ai, MODELS } from "../../ai/config";
import { JobFailure, describeError } from "../../jobs/failures";
import type { VisualCapability, VisualGenerationOutput, VisualGenerationRequest, VisualProviderPort } from "../visual";

/** Approximate size mapping — OpenAI's image sizes are fixed presets, not arbitrary ratios. */
export function sizeForAspectRatio(aspectRatio: unknown): "1024x1024" | "1024x1536" | "1536x1024" {
  if (aspectRatio === "16:9") return "1536x1024";
  if (aspectRatio === "9:16" || aspectRatio === "4:5") return "1024x1536";
  return "1024x1024";
}

export function buildPrompt(intent: Record<string, unknown>): string {
  const parts = [
    typeof intent.subject === "string" ? intent.subject : null,
    typeof intent.composition === "string" ? `Composition: ${intent.composition}` : null,
    typeof intent.style === "string" ? `Style: ${intent.style}` : null,
    typeof intent.brandNotes === "string" ? `Brand notes: ${intent.brandNotes}` : null,
    typeof intent.textOverlay === "string" ? `Include this text overlay: ${intent.textOverlay}` : null,
  ].filter((p): p is string => Boolean(p));
  return parts.join(". ") || "A clean, professional illustration.";
}

/** Classifies a provider failure into the existing job failure taxonomy (Phase 9 §29). */
export function classifyOpenAiImageError(error: unknown): "transient" | "permanent" {
  const status = (error as { status?: number } | null | undefined)?.status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return "transient";
  if (status === 401 || status === 403 || status === 400) return "permanent";
  const message = describeError(error);
  return /timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b|429|rate.?limit/i.test(message)
    ? "transient"
    : "permanent";
}

export interface OpenAiImageProviderOptions {
  providerId?: string;
  /** Models this deployment actually serves — resolution rejects anything else before calling out. */
  models?: readonly string[];
}

/**
 * Synchronous (Phase 9 §7): OpenAI's `images.generate` endpoint returns the
 * final result or an error in one HTTP round trip — there is no provider-side
 * job id to poll, so an ambiguous outcome (e.g. a timeout after the request
 * left the process but before a response arrived) cannot be reconciled the
 * way xQuick's write-actions or LinkedIn's provider lookups can. This is an
 * honest provider-capability ceiling, not a gap in this adapter: a timeout is
 * classified transient and retried as the SAME VisualGeneration (never a
 * blind second generation created), but "was an image actually produced
 * upstream before the timeout" can never be answered — no idempotency key is
 * claimed here beyond what retrying the same durable row already gives.
 */
export function createOpenAiImageProvider(
  options: OpenAiImageProviderOptions = {},
): VisualProviderPort {
  const providerId = options.providerId ?? "openai-image";
  const models = options.models ?? [MODELS.IMAGE];

  return {
    providerId,
    providerVersion: "openai-images-v1",
    capabilities: ["generate_image" as VisualCapability],
    modalities: ["image"],
    models,
    synchronous: true,
    async generate(request: VisualGenerationRequest): Promise<VisualGenerationOutput> {
      const intent = ((request.snapshot as { intent?: Record<string, unknown> } | undefined)?.intent ??
        {}) as Record<string, unknown>;
      const model = request.model ?? models[0];
      const size = sizeForAspectRatio(intent.aspectRatio);
      const prompt = buildPrompt(intent);

      let response;
      try {
        response = await ai.images.generate({
          model,
          prompt,
          size,
          n: 1,
          // gpt-image-1 always returns b64_json and rejects this field; only
          // dall-e-2/3 accept it explicitly.
          ...(model.startsWith("dall-e") ? { response_format: "b64_json" as const } : {}),
        });
      } catch (error) {
        const failureClass = classifyOpenAiImageError(error);
        const message = `openai image generation failed: ${describeError(error)}`;
        throw failureClass === "transient" ? JobFailure.transient(message) : JobFailure.permanent(message);
      }

      const item = response.data?.[0];
      if (!item) throw JobFailure.permanent("openai image generation returned no image data");

      let bytes: Buffer;
      if (item.b64_json) {
        bytes = Buffer.from(item.b64_json, "base64");
      } else if (item.url) {
        const fetched = await fetch(item.url);
        if (!fetched.ok) throw JobFailure.transient(`could not retrieve generated image: HTTP ${fetched.status}`);
        bytes = Buffer.from(await fetched.arrayBuffer());
      } else {
        throw JobFailure.permanent("openai image generation response carried neither b64_json nor url");
      }

      const [width, height] = size.split("x").map(Number);
      return {
        bytes,
        mime: "image/png",
        width,
        height,
        altText: typeof intent.subject === "string" ? intent.subject : null,
        provider: providerId,
        providerVersion: "openai-images-v1",
        model,
        cost: null,
        usage: {},
      };
    },
  };
}
