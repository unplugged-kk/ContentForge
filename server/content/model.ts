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
