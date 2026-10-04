import OpenAI from "openai";
import { MODELS } from "./config";

/**
 * Task-aware model router.
 *
 * ContentForge has several AI jobs with different economics. Rather than one
 * global provider, a *task* selects the provider + model:
 *
 *   - `default`        → the configured provider (Command Code provider / OpenAI-compatible)
 *   - `video.*`        → Gemini (video/transcript work only)
 *
 * Routing is env-driven so no call site hardcodes a provider. If the routed
 * provider has no credential, it degrades to the default provider (never throws
 * for a missing optional key) and reports `fallback: true`.
 */
export type AiTask = "default" | "video.extract";

export const AI_TASKS: readonly AiTask[] = [
  "default",
  "video.extract",
] as const;

export type AiProviderId = "default" | "gemini";

export type AiRoute = {
  providerId: AiProviderId;
  label: string;
  baseUrl: string | undefined;
  model: string;
  available: boolean;
  fallback?: boolean;
};

type ProviderConfig = { id: AiProviderId; label: string; baseUrl: string | undefined; apiKey: string | undefined };

function defaultProvider(): ProviderConfig {
  return {
    id: "default",
    label: "default",
    baseUrl: process.env.AI_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? undefined,
    apiKey:
      process.env.AI_API_KEY ??
      process.env.OPENAI_API_KEY ??
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??
      undefined,
  };
}

function geminiProvider(): ProviderConfig {
  return {
    id: "gemini",
    label: "gemini",
    baseUrl:
      process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || undefined,
  };
}

/** Default model — read live so a redeploy/env change takes effect without a rebuild. */
function defaultModel(): string {
  return process.env.AI_TEXT_MODEL?.trim() || MODELS.TEXT;
}

/**
 * The Gemini model for a video task.
 *
 * Exported because the native `generateContent` lane (server/research/transcript/
 * geminiVideo.ts) cannot go through the OpenAI-compatible client — it needs
 * `file_data.file_uri` for a YouTube URL — so it must still make the SAME model
 * decision as every other video call rather than repeating the default.
 */
export function geminiModelFor(task: Exclude<AiTask, "default">): string {
  return process.env.VIDEO_MAIN_MODEL?.trim() || "gemini-3.8-flash";
}

/** Resolve a task to a provider + model. Never throws. */
export function resolveRoute(task: AiTask = "default"): AiRoute {
  const fallback = defaultProvider();
  if (task === "default") {
    return {
      providerId: "default",
      label: fallback.label,
      baseUrl: fallback.baseUrl,
      model: defaultModel(),
      available: Boolean(fallback.apiKey),
    };
  }

  const gemini = geminiProvider();
  if (!gemini.apiKey) {
    // No Gemini credential: fall back to the default provider so a video task
    // still runs (on the text model) instead of failing.
    return {
      providerId: "default",
      label: fallback.label,
      baseUrl: fallback.baseUrl,
      model: defaultModel(),
      available: Boolean(fallback.apiKey),
      fallback: true,
    };
  }

  return {
    providerId: "gemini",
    label: gemini.label,
    baseUrl: gemini.baseUrl,
    model: geminiModelFor(task),
    available: true,
  };
}

const clients = new Map<string, OpenAI>();

/** One cached OpenAI client per provider route. */
export function clientForRoute(route: AiRoute): OpenAI {
  const provider = route.providerId === "gemini" ? geminiProvider() : defaultProvider();
  if (!provider.apiKey) {
    throw new Error(
      `No API key for provider "${route.providerId}". Set ${
        route.providerId === "gemini" ? "GEMINI_API_KEY" : "AI_API_KEY"
      }.`,
    );
  }
  const cacheKey = `${route.providerId}:${provider.baseUrl ?? ""}:${provider.apiKey.slice(-6)}`;
  let client = clients.get(cacheKey);
  if (!client) {
    client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl });
    clients.set(cacheKey, client);
  }
  return client;
}

/** Routing table for status/debug surfaces — never includes keys. */
export function describeRoutes(): Array<{
  task: AiTask;
  providerId: AiProviderId;
  model: string;
  available: boolean;
  fallback?: boolean;
}> {
  return AI_TASKS.map((task) => {
    const r = resolveRoute(task);
    return {
      task,
      providerId: r.providerId,
      model: r.model,
      available: r.available,
      ...(r.fallback ? { fallback: true } : {}),
    };
  });
}
