import type { ToolEnvelope, ToolEnvelopeStatus } from "./types";

export function envelope(partial: {
  tool: string;
  status: ToolEnvelopeStatus;
  summary: string;
  refs?: Record<string, unknown>;
  data?: Record<string, unknown>;
  failureClass?: string;
  error?: string;
  capability?: string;
}): ToolEnvelope {
  return {
    status: partial.status,
    tool: partial.tool,
    summary: partial.summary,
    refs: partial.refs ?? {},
    ...(partial.data ? { data: partial.data } : {}),
    ...(partial.failureClass ? { failureClass: partial.failureClass } : {}),
    ...(partial.error ? { error: partial.error } : {}),
    ...(partial.capability ? { capability: partial.capability } : {}),
  };
}

export function notFound(tool: string, kind: string): ToolEnvelope {
  return envelope({ tool, status: "not_found", summary: `${kind} not found` });
}

export function denied(tool: string, reason: string): ToolEnvelope {
  return envelope({
    tool,
    status: "denied",
    summary: reason,
    failureClass: "policy_human",
    error: reason,
  });
}

export function invalid(tool: string, message: string): ToolEnvelope {
  return envelope({
    tool,
    status: "invalid",
    summary: message,
    failureClass: "permanent",
    error: message,
  });
}
