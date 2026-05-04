import OpenAI from "openai";

/**
 * Resolve API key for the OpenAI client constructor.
 * The SDK throws at construct time if no key is passed — that breaks CI/E2E
 * where we boot the real server without calling AI. Use a non-billing placeholder
 * only when explicitly allowed (GitHub `CI=true`, or Playwright sets
 * `CONTENTFORGE_E2E_SERVER=1` on the webServer process).
 */
function resolveOpenAiApiKey(): string {
  const fromEnv =
    process.env.AI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (fromEnv) return fromEnv;

  const allowPlaceholder =
    process.env.CI === "true" || process.env.CONTENTFORGE_E2E_SERVER === "1";
  if (allowPlaceholder) {
    return "sk-cf-e2e-placeholder-not-for-production";
  }

  throw new Error(
    "Missing OpenAI credentials: set OPENAI_API_KEY (or AI_API_KEY / AI_INTEGRATIONS_OPENAI_API_KEY).",
  );
}

/**
 * Single OpenAI-compatible client for all AI calls.
 *
 * Provider switching is env-driven — no code changes required:
 *   • OpenAI (default):    leave AI_BASE_URL unset
 *   • OpenRouter:          AI_BASE_URL=https://openrouter.ai/api/v1
 *   • Ollama (local):      AI_BASE_URL=http://localhost:11434/v1
 */
export const ai = new OpenAI({
  apiKey: resolveOpenAiApiKey(),
  baseURL:
    process.env.AI_BASE_URL ??
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??
    undefined,
});

/**
 * Model registry — centralized so switching providers only requires
 * changing env vars, not hunting through hardcoded strings.
 *
 * CURRENT (cheapest for testing):
 *   TEXT:       gpt-4o-mini        ($0.15/$0.60 per 1M tokens)
 *   VISION:     gpt-4o-mini        (supports images at same cheap rate)
 *   IMAGE:      gpt-image-1        (cheaper than dall-e-3)
 *   AUDIO:      gpt-audio          (voice in/out)
 *   AUDIO_TRANSCRIBE: gpt-4o-mini-transcribe  (speech-to-text)
 *
 * FUTURE (higher quality):
 *   TEXT_PREMIUM: gpt-4o           ($2.50/$10.00 per 1M tokens)
 *   VISION:       gpt-4o           (better for complex diagrams)
 */
export const MODELS = {
  /** Default text model — used by aiCall() and most generation routes */
  TEXT: process.env.AI_TEXT_MODEL ?? "gpt-4o-mini",

  /** Premium text — for final polish, articles, carousels */
  TEXT_PREMIUM: process.env.AI_TEXT_PREMIUM_MODEL ?? "gpt-4o-mini",

  /** Vision — for image analysis, reference style extraction */
  VISION: process.env.AI_VISION_MODEL ?? "gpt-4o-mini",

  /** Image generation */
  IMAGE: process.env.AI_IMAGE_MODEL ?? "gpt-image-1",

  /** Audio model — voice chat, text-to-speech */
  AUDIO: process.env.AI_AUDIO_MODEL ?? "gpt-audio",

  /** Audio transcription — speech-to-text */
  AUDIO_TRANSCRIBE: process.env.AI_AUDIO_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
} as const;
