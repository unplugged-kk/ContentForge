/**
 * Default generation model adapter.
 *
 * Wraps the project's existing model gateway (`server/ai` → `aiCall`, `MODELS`).
 * This is the only file that names a provider; the generation domain depends on
 * `GenerationModelPort` only, so swapping models/providers is configuration.
 */

import { MODELS } from "../ai/config";
import { aiCall, logAiUsage, safeJsonParse } from "../ai/chat";
import { JobFailure, describeError } from "../jobs/failures";
import type {
  GenerationModelPort,
  GenerationOutput,
  GenerationRequest,
} from "./generation";
import type { ChatIntent, ChatIntentPort } from "./chat";

/** Marker the deterministic E2E transport responds to (see e2e/fixture). */
export const CHAT_INTENT_MARKER = "CONTENT_REQUEST_INTENT";

/** Advisory payload shapes, so the model returns something the registry accepts. */
function payloadShapeHint(format: string): string {
  if (format === "x_post") return '{ "text": "<single post body, <=280 chars>" }';
  if (format === "x_thread") return '{ "units": ["<first tweet>", "<second tweet>"] }';
  return "a JSON object matching the registered payload schema";
}

export interface GatewayGenerationModelOptions {
  /** Record usage through the existing AI-usage log (default true). */
  logUsage?: boolean;
  /** Feature name used for usage accounting. */
  feature?: string;
}

export function createGatewayGenerationModel(
  options: GatewayGenerationModelOptions = {},
): GenerationModelPort {
  const logUsage = options.logUsage ?? true;
  const feature = options.feature ?? "generation.run";

  return {
    provider: "gateway",
    async generate(request: GenerationRequest): Promise<GenerationOutput> {
      const model =
        request.policy.model && request.policy.model !== "gateway"
          ? request.policy.model
          : MODELS.TEXT;

      const messages = [
        { role: "system", content: request.policy.systemPrompt },
        {
          role: "user",
          content: `${request.policy.userPrompt}\n\nRespond with exactly one JSON object of this shape: ${payloadShapeHint(request.format)}`,
        },
      ];

      try {
        const response = await aiCall(messages, true, model);
        const parsed = safeJsonParse(response.content);
        if (!parsed || typeof parsed !== "object") {
          throw JobFailure.permanent("generation model returned a non-JSON payload");
        }
        if (logUsage) {
          await logAiUsage(response.usage, response.latency, feature, model).catch(() => {});
        }
        return {
          payload: parsed as Record<string, unknown>,
          model,
          provider: "gateway",
          cost: null,
          usage: (response.usage ?? {}) as Record<string, unknown>,
        };
      } catch (error) {
        if (error instanceof JobFailure) throw error;
        // Network/5xx/timeout from the gateway is retryable; anything else is not.
        const message = describeError(error);
        if (/rate|429|timeout|ECONN|fetch failed|5\d\d/i.test(message)) {
          throw JobFailure.transient(`generation model call failed: ${message}`);
        }
        throw JobFailure.permanent(`generation model call failed: ${message}`);
      }
    },
  };
}

/** Normalize whatever the model returned into a usable intent. */
function normalizeIntent(raw: Record<string, unknown>, message: string): ChatIntent {
  const text = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  const anglesRaw = Array.isArray(raw.angles) ? raw.angles : [];
  return {
    title: text(raw.title) ?? message.slice(0, 120),
    insightBody: text(raw.insightBody) ?? message,
    angles: anglesRaw.filter((a): a is string => typeof a === "string").slice(0, 10),
    concept: text(raw.concept) ?? "content request",
    objective: text(raw.objective) ?? "create content from the request",
    audience: text(raw.audience),
    format: text(raw.format) ?? "x_post",
    channel: text(raw.channel) ?? "x",
  };
}

/**
 * Default chat-intent extractor. Wraps the existing model gateway; the domain
 * only sees `ChatIntentPort`, so no provider is named outside this file.
 */
export function createGatewayChatIntent(
  options: GatewayGenerationModelOptions = {},
): ChatIntentPort {
  const feature = options.feature ?? "generation.chat";
  return {
    provider: "gateway",
    async extract(message: string): Promise<ChatIntent> {
      const system =
        `${CHAT_INTENT_MARKER}: extract the user's content request into a single JSON object. ` +
        'Keys: title, insightBody, angles (array of framings), concept, objective, audience, format, channel. ' +
        'Default format "x_post" and channel "x"; only use registered formats.';
      try {
        const response = await aiCall(
          [
            { role: "system", content: system },
            { role: "user", content: message },
          ],
          true,
          MODELS.TEXT,
        );
        const parsed = safeJsonParse(response.content);
        if (!parsed || typeof parsed !== "object") {
          throw JobFailure.permanent("chat intent extraction returned a non-JSON payload");
        }
        if (options.logUsage !== false) {
          await logAiUsage(response.usage, response.latency, feature, MODELS.TEXT).catch(() => {});
        }
        return normalizeIntent(parsed as Record<string, unknown>, message);
      } catch (error) {
        if (error instanceof JobFailure) throw error;
        throw JobFailure.permanent(`chat intent extraction failed: ${describeError(error)}`);
      }
    },
  };
}
