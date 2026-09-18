import type { AgentEvent } from "./types";
import { formatSse, toAguiProtocolEvents } from "@shared/agent-ui";

export function aguiSseFromEvents(events: AgentEvent[]): string {
  return formatSse(toAguiProtocolEvents(events));
}

export function writeSse(res: { write: (chunk: string) => unknown }, event: Record<string, unknown>): void {
  res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function extractAguiObjective(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const rec = body as Record<string, unknown>;
  if (typeof rec.objective === "string" && rec.objective.trim()) return rec.objective.trim();
  const messages = rec.messages;
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i] as Record<string, unknown>;
      if (message?.role === "user") {
        if (typeof message.content === "string" && message.content.trim()) return message.content.trim();
        if (Array.isArray(message.content)) {
          const text = message.content
            .map((part) => (typeof part === "string" ? part : typeof (part as { text?: string }).text === "string" ? (part as { text: string }).text : ""))
            .join(" ")
            .trim();
          if (text) return text;
        }
      }
    }
  }
  return "";
}
