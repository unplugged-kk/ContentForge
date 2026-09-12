import { JobFailure } from "../jobs/failures";
import type { VisualProviderPort } from "./visual";

// ── Visual provider contract ──────────────────────────────────────────────────
export type VisualCapability = "generate_image" | "edit_image" | "generate_slide";

/**
 * Deterministic fixture visual provider — the test/E2E double for visual
 * production. Emits a minimal valid PNG (1×1 pixel), so the full pipeline
 * (validate → store → persist → reference → publish) runs against real bytes
 * with no network and no vendor dependency.
 */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export function createFixtureVisualProvider(
  options: {
    providerId?: string;
    failMode?: "none" | "transient" | "permanent" | "invalid";
  } = {},
): VisualProviderPort & { calls(): number } {
  const providerId = options.providerId ?? "local-fixture";
  let calls = 0;

  return {
    providerId,
    providerVersion: "fixture-1",
    capabilities: ["generate_image", "generate_slide"],
    calls: () => calls,
    async generate(request) {
      calls += 1;
      const mode = options.failMode ?? "none";
      if (mode === "transient") {
        throw JobFailure.transient("fixture visual provider unavailable");
      }
      if (mode === "permanent") {
        throw JobFailure.permanent("fixture visual provider rejected the request");
      }
      if (mode === "invalid") {
        // Bytes that no validator accepts.
        return {
          bytes: Buffer.from("not-an-image", "utf8"),
          mime: "application/octet-stream",
          width: null,
          height: null,
          altText: null,
          provider: providerId,
          providerVersion: "fixture-1",
          model: null,
          cost: null,
          usage: {},
        };
      }
      void request;
      return {
        bytes: Buffer.from(PNG_1x1),
        mime: "image/png",
        width: 1,
        height: 1,
        altText: "Deterministic 1×1 fixture visual",
        provider: providerId,
        providerVersion: "fixture-1",
        model: "fixture-model",
        cost: null,
        usage: {},
      };
    },
  };
}
