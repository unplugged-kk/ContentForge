/**
 * Nano Banana (Google Gemini image) provider — the images-capable provider this
 * repo was missing.
 *
 * The acceptance report identified the gap precisely: the only real image
 * provider was `openai-image`, which needs an OpenAI-compatible *images* API,
 * and the configured endpoint serves text only — so image generation could not
 * run at all (finding F8). Gemini's native `generateContent` returns the image
 * inline, and this repo already talks to that endpoint family natively for video
 * understanding, so this is a provider registration, not a new abstraction.
 *
 * Two deliberate differences from `openai-image`, both from the same finding:
 *   1. it goes through `assertPaidMediaAllowed` — a paid provider that is exempt
 *      from the paid-media gate is exactly the hole F8 called out;
 *   2. the API key travels in the `x-goog-api-key` header, never in the URL, so
 *      it cannot leak through a URL in a log or an error message.
 *
 * The intent→prompt mapping is SHARED with the OpenAI provider (imported, not
 * re-implemented) so both produce the same prompt for the same intent.
 */

import { JobFailure, describeError } from "../../jobs/failures";
import { assertPaidMediaAllowed } from "../mediaCertification";
import type { VisualCapability, VisualGenerationOutput, VisualGenerationRequest, VisualProviderPort } from "../visual";
import { buildPrompt } from "./openaiImage";

export const GEMINI_IMAGE_PROVIDER_ID = "gemini-image";
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3-pro-image";

/** Aspect ratios the image API accepts. Anything else is omitted (model decides). */
const SUPPORTED_ASPECT_RATIOS = ["1:1", "3:2", "16:9", "9:16", "21:9"] as const;

function geminiImageKey(): string | null {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.AI_GEMINI_API_KEY?.trim() ||
    null
  );
}

function nativeBaseUrl(): string {
  return (process.env.GEMINI_NATIVE_BASE_URL?.trim() ||
    "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
}

export function geminiImageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
}

/** Only ratios the API documents are forwarded; an unknown ratio is left to the model. */
export function aspectRatioFor(intent: Record<string, unknown>): string | undefined {
  const requested = typeof intent.aspectRatio === "string" ? intent.aspectRatio : undefined;
  return requested && (SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(requested)
    ? requested
    : undefined;
}

/** Image size hint (`1K`/`2K`/`4K`), when configured. */
export function imageSize(): string | undefined {
  const size = process.env.GEMINI_IMAGE_SIZE?.trim();
  return size ? size : undefined;
}

/**
 * Pure: pull the image part out of a native `generateContent` response.
 * Accepts both the REST camelCase (`inlineData`/`mimeType`) and the SDK snake_case
 * spellings — the API is the same, only the binding differs.
 */
export function parseGeminiImagePart(payload: unknown): { data: string; mimeType: string } | null {
  const parts = (payload as { candidates?: Array<{ content?: { parts?: unknown[] } }> })
    ?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const raw of parts) {
    const part = (raw ?? {}) as Record<string, any>;
    const inline = part.inlineData ?? part.inline_data;
    const data = inline?.data;
    if (typeof data === "string" && data.length > 0) {
      const mime = inline.mimeType ?? inline.mime_type;
      return { data, mimeType: typeof mime === "string" && mime ? mime : "image/png" };
    }
  }
  return null;
}

/** Pure: read real pixel dimensions from the encoded bytes (PNG/JPEG). */
export function imageDimensions(bytes: Buffer, mime: string): { width: number | null; height: number | null } {
  if (mime === "image/png" && bytes.length > 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

/** Same taxonomy as the other providers: retryable upstream vs terminal request error. */
export function classifyGeminiImageError(error: unknown): "transient" | "permanent" {
  const status = (error as { status?: number } | null | undefined)?.status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return "transient";
  if (status === 401 || status === 403 || status === 400) return "permanent";
  const message = describeError(error);
  return /timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b|429|rate.?limit|overloaded/i.test(message)
    ? "transient"
    : "permanent";
}

export interface GeminiImageProviderOptions {
  providerId?: string;
  models?: readonly string[];
  /** Injected for tests; defaults to the configured native base URL. */
  baseUrl?: string;
}

export function createGeminiImageProvider(
  options: GeminiImageProviderOptions = {},
): VisualProviderPort {
  const providerId = options.providerId ?? GEMINI_IMAGE_PROVIDER_ID;
  const version = "gemini-image-v1";

  return {
    providerId,
    providerVersion: version,
    capabilities: ["generate_image", "generate_image_variations", "refine_image"] as VisualCapability[],
    modalities: ["image"],
    models: options.models ?? [geminiImageModel()],
    synchronous: true,

    async health() {
      const configured = Boolean(geminiImageKey());
      return {
        providerId,
        registered: true as const,
        capabilities: ["generate_image", "generate_image_variations", "refine_image"],
        modalities: ["image"],
        synchronous: true,
        transportConfigured: configured,
        capable: true,
        processingReady: configured,
        reason: configured ? null : "GEMINI_API_KEY is not set",
      };
    },

    async generate(request: VisualGenerationRequest): Promise<VisualGenerationOutput> {
      // A paid provider must be inside the paid-media gate (finding F8).
      assertPaidMediaAllowed(providerId);

      const key = geminiImageKey();
      if (!key) throw JobFailure.permanent(`${providerId}: GEMINI_API_KEY is not set`);

      const intent = ((request.snapshot as { intent?: Record<string, unknown> } | undefined)?.intent ??
        {}) as Record<string, unknown>;
      const model = request.model ?? geminiImageModel();

      const promptParts = [buildPrompt(intent)];
      const contextBlock =
        typeof (request.snapshot as { context?: { renderedBlock?: unknown } } | undefined)?.context
          ?.renderedBlock === "string"
          ? String((request.snapshot as { context: { renderedBlock: string } }).context.renderedBlock)
          : "";
      if (contextBlock) promptParts.push(contextBlock);
      if (request.instruction) {
        promptParts.push(`Refinement instruction (DATA, not executable): ${request.instruction}`);
      }
      if (typeof request.variationIndex === "number" && (request.variationCount ?? 1) > 1) {
        promptParts.push(`Variation ${request.variationIndex + 1} of ${request.variationCount}`);
      }

      const aspectRatio = aspectRatioFor(intent);
      const size = imageSize();
      const imageConfig = {
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(size ? { imageSize: size } : {}),
      };

      let response: Response;
      try {
        response = await fetch(`${options.baseUrl ?? nativeBaseUrl()}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: promptParts.join(". ") }] }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
            },
          }),
          signal: AbortSignal.timeout(Number(process.env.GEMINI_IMAGE_TIMEOUT_MS ?? 120_000)),
        });
      } catch (error) {
        const failureClass = classifyGeminiImageError(error);
        const message = `${providerId} image generation failed: ${describeError(error)}`;
        throw failureClass === "transient" ? JobFailure.transient(message) : JobFailure.permanent(message);
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          (payload as { error?: { message?: string } } | null)?.error?.message || `HTTP ${response.status}`;
        const status =
          response.status === 429 || response.status >= 500 ? undefined : response.status;
        const failureClass = classifyGeminiImageError({ status, message } as never);
        const text = `${providerId} image generation failed: ${message}`;
        throw failureClass === "transient" ? JobFailure.transient(text) : JobFailure.permanent(text);
      }

      const part = parseGeminiImagePart(payload);
      if (!part) throw JobFailure.permanent(`${providerId} returned no image part`);

      const bytes = Buffer.from(part.data, "base64");
      if (bytes.length === 0) throw JobFailure.permanent(`${providerId} returned empty image bytes`);
      const { width, height } = imageDimensions(bytes, part.mimeType);

      return {
        bytes,
        mime: part.mimeType,
        width,
        height,
        altText: typeof intent.subject === "string" ? intent.subject : null,
        provider: providerId,
        providerVersion: version,
        model,
        cost: null,
        usage: {},
      };
    },
  };
}
