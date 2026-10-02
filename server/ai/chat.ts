import { MODELS } from "./config";
import { clientForRoute, resolveRoute, type AiTask } from "./router";
import { storage } from "../storage";

export function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    const match = str.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export type AiCallOptions = {
  /** Provider/model selection by job. Defaults to "default" (the configured provider). */
  task?: AiTask;
  /** Explicit model override — wins over the routed model. */
  model?: string;
  /** Append "Respond in JSON format." and request a JSON object. */
  jsonMode?: boolean;
  maxCompletionTokens?: number;
};

/**
 * Task-aware AI call. The router picks the provider + model for the task
 * (`default` → configured provider; `video.*` → Gemini).
 */
export async function aiCallRouted(messages: any[], options: AiCallOptions = {}) {
  const route = resolveRoute(options.task ?? "default");
  const model = options.model ?? route.model;
  const msgs = options.jsonMode
    ? messages.map((m: any, i: number) =>
        i === 0 && m.role === "system"
          ? { ...m, content: m.content + "\nRespond in JSON format." }
          : m
      )
    : messages;
  const opts: any = { model, messages: msgs, max_completion_tokens: options.maxCompletionTokens ?? 8192 };
  if (options.jsonMode) opts.response_format = { type: "json_object" };
  const startTime = Date.now();
  const response = await clientForRoute(route).chat.completions.create(opts);
  return {
    content: response.choices[0]?.message?.content || "",
    usage: response.usage,
    latency: Date.now() - startTime,
    model,
  };
}

/** Back-compatible signature: positional `(messages, jsonMode, model)`. */
export async function aiCall(messages: any[], jsonMode = false, model?: string) {
  return aiCallRouted(messages, { jsonMode, model });
}

export async function logAiUsage(usage: any, latency: number, feature: string, model = MODELS.TEXT) {
  await storage.createAiUsageLog({
    model,
    inputTokens: usage?.prompt_tokens || 0,
    outputTokens: usage?.completion_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
    latencyMs: latency,
    feature,
  });
}
