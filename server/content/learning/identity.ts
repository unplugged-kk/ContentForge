import type { JsonRecord } from "../storage";
import { MAX_SIGNAL_PAYLOAD_BYTES } from "./constants";

/** Truncate a payload so learning rows never become unbounded event blobs. */
export function boundPayload(payload: JsonRecord): JsonRecord {
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, "utf8") <= MAX_SIGNAL_PAYLOAD_BYTES) return payload;
  return {
    truncated: true,
    originalBytes: Buffer.byteLength(encoded, "utf8"),
    preview: encoded.slice(0, 400),
  };
}

export function performanceIdentityKey(input: {
  publicationId: number;
  metric: string;
  observedAt: Date;
  provider: string;
  normalizationVersion: string;
}): string {
  return [
    "ps",
    input.normalizationVersion,
    String(input.publicationId),
    input.metric,
    String(input.observedAt.getTime()),
    input.provider,
  ].join(":");
}

export function learningIdentityKey(parts: Array<string | number | null | undefined>): string {
  return ["ls", ...parts.map((p) => (p == null || p === "" ? "_" : String(p)))].join(":");
}

/** UTC hour bucket used when a provider does not supply an observation timestamp. */
export function hourWindow(at: Date): { window: string; observedAt: Date } {
  const observedAt = new Date(Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    at.getUTCHours(),
    0,
    0,
    0,
  ));
  return { window: observedAt.toISOString(), observedAt };
}
