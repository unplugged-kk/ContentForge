import { ai, MODELS } from "./config";
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

export async function aiCall(messages: any[], jsonMode = false, model = MODELS.TEXT) {
  const msgs = jsonMode
    ? messages.map((m: any, i: number) =>
        i === 0 && m.role === "system"
          ? { ...m, content: m.content + "\nRespond in JSON format." }
          : m
      )
    : messages;
  const opts: any = { model, messages: msgs, max_completion_tokens: 8192 };
  if (jsonMode) opts.response_format = { type: "json_object" };
  const startTime = Date.now();
  const response = await ai.chat.completions.create(opts);
  return {
    content: response.choices[0]?.message?.content || "",
    usage: response.usage,
    latency: Date.now() - startTime,
    model,
  };
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
