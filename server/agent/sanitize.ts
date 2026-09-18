import { createHash } from "node:crypto";

const FORBIDDEN_KEYS = new Set([
  "ownerid",
  "userid",
  "tenantid",
  "systemuserid",
  "databaseurl",
  "databasecredentials",
  "credentials",
  "apikey",
  "accesstoken",
  "oauthtoken",
  "bearertoken",
  "password",
  "secret",
  "authorization",
]);

const MAX_STORED_CHARS = 8_192;

export function isForbiddenKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return FORBIDDEN_KEYS.has(normalized);
}

export function stripOverrideKeys(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isForbiddenKey(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = stripOverrideKeys(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function boundRecord(value: unknown): Record<string, unknown> {
  const json = JSON.stringify(value ?? {});
  if (json.length <= MAX_STORED_CHARS) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  }
  return { truncated: true, preview: json.slice(0, 500), bytes: json.length };
}

export function hashInput(value: unknown): string {
  const json = JSON.stringify(value ?? {});
  return createHash("sha256").update(json).digest("hex");
}

export function toolIdempotencyKey(agentRunId: number, toolName: string, inputHash: string): string {
  return `agent:${agentRunId}:${toolName}:${inputHash.slice(0, 40)}`;
}
