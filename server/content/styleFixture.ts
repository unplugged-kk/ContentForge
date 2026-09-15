import { JobFailure } from "../jobs/failures";
import type { StyleAnalyzerPort, StyleObservation } from "./style";

/**
 * Deterministic fixture style analyzer — the test/E2E double for the AI
 * gateway boundary. Emits a real, structured, schema-valid observation (no
 * network), so the full pipeline (validate -> persist -> version -> context
 * -> policy) runs against real data with no vendor dependency.
 */
export function createFixtureStyleAnalyzer(
  options: { providerId?: string; failMode?: "none" | "transient" | "permanent" | "invalid" } = {},
): StyleAnalyzerPort & { calls(): number } {
  const providerId = options.providerId ?? "fixture-style";
  let calls = 0;

  const observation: StyleObservation = {
    confidence: "strong",
    confidenceReason: "fixture: deterministic sample",
    dimensions: {
      tone: "direct, practitioner-grade",
      sentenceRhythm: "short declarative sentences",
      verbosity: "terse",
      formattingTendencies: "line breaks between ideas",
      punctuationTendencies: "minimal",
      vocabularyRegister: "technical",
      hookPatterns: ["opens with a specific number"],
      paragraphStructure: "one idea per line",
      questionUsage: "rare",
      listUsage: "occasional numbered list",
      emojiTendencies: "none",
      ctaPatterns: ["ends with a direct question"],
      rhetoricalPatterns: ["contrarian framing"],
      recurringTraits: ["specific metrics", "real scenarios"],
    },
  };

  return {
    providerId,
    providerVersion: "fixture-style-1",
    calls: () => calls,
    async analyze(content) {
      calls += 1;
      const mode = options.failMode ?? "none";
      if (mode === "transient") throw JobFailure.transient("fixture style analyzer unavailable");
      if (mode === "permanent") throw JobFailure.permanent("fixture style analyzer rejected the request");
      if (mode === "invalid") {
        return { observation: { confidence: "strong" } as unknown as StyleObservation, model: "fixture-model", provider: providerId, usage: {} };
      }
      void content;
      return { observation, model: "fixture-model", provider: providerId, usage: {} };
    },
  };
}
