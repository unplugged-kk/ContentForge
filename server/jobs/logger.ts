/**
 * Structured job logging with secret redaction.
 *
 * Log lines are single-line JSON so they can be grepped and shipped. Anything
 * whose key looks like a credential is redacted before it reaches the sink.
 */

import type { JobLogger } from "./registry";

const REDACTED = "[redacted]";

/** Key-name fragments that must never be logged, matched case-insensitively. */
const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|cookie|authorization|auth|api[_-]?key|access[_-]?key|session|credential|private[_-]?key)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
  }
  return out;
}

export type LogSink = (line: string) => void;

const defaultSink: LogSink = (line) => {
  // eslint-disable-next-line no-console
  console.log(line);
};

export function createJobLogger(
  base: Record<string, unknown>,
  level: "info" | "warn" | "error",
  sink: LogSink = defaultSink,
): JobLogger {
  const emit = (fields: Record<string, unknown>, message: string) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...(redact({ ...base, ...fields }) as Record<string, unknown>),
    });
    sink(line);
  };
  return {
    info: (fields, message) => emit(fields, message),
    warn: (fields, message) => emit(fields, message),
    error: (fields, message) => emit(fields, message),
  };
}

/** Build a logger that prefixes every line with the job's identity. */
export function createJobScopedLogger(
  fields: {
    jobType: string;
    jobId: string;
    correlationId: string;
    attempt: number;
  },
  sink?: LogSink,
): JobLogger {
  return createJobLogger(fields, "info", sink);
}
