/**
 * Legacy decision sites (Phase 6), in SHADOW MODE.
 *
 * The plan's rule for the legacy candidates is shadow-run first: compute what the
 * decision layer would have chosen, record it beside the existing behaviour, and
 * cut over only once the two have been compared. This module is that seam — it
 * returns the decision and nothing else acts on it.
 *
 * Every entry is individually flag-gated, and a disabled entry makes NO call at
 * all, so shadow mode costs nothing until it is switched on.
 */

import { shadowDecide } from "./shadow";
import { decisionTypeEnabled } from "./policies";
import type { DecisionRefs } from "./registry";
import { LLM_OVERALL_KEY } from "./decisions/viral";
import type { ViralScoreDecision } from "./schemas";

export interface ViralScoreShadowInput {
  /** The draft being scored. */
  content: string;
  platform?: string;
  /** The legacy model's own overall_score (0-10), kept for comparison. */
  llmOverall?: number | null;
  userId?: number | null;
  refs?: DecisionRefs;
}

export interface LegacyShadowDeps {
  /** Injected for tests; defaults to the real shadow entry point. */
  shadow?: typeof shadowDecide;
  enabled?: (type: "viral_score") => boolean;
}

export function createLegacyShadows(deps: LegacyShadowDeps = {}) {
  const run = deps.shadow ?? shadowDecide;
  const enabled = deps.enabled ?? ((type: "viral_score") => decisionTypeEnabled(type));

  return {
    /**
     * JC-01 `/api/viral/score`. Records what the decision layer would score and
     * changes nothing: the caller has already produced its own answer.
     */
    async viralScore(input: ViralScoreShadowInput): Promise<ViralScoreDecision | null> {
      if (!enabled("viral_score")) return null;

      const normalized =
        typeof input.llmOverall === "number" && Number.isFinite(input.llmOverall)
          ? Number(Math.min(1, Math.max(0, input.llmOverall / 10)).toFixed(4))
          : null;

      const result = await run<ViralScoreDecision>({
        type: "viral_score",
        state: {
          topic: { title: input.content.slice(0, 200) },
          quality: {
            signals: normalized === null ? {} : { [LLM_OVERALL_KEY]: normalized },
            flags: [],
          },
          platform: { channel: input.platform ?? "x" },
        },
        userId: input.userId ?? null,
        ...(input.refs ? { refs: input.refs } : {}),
      });

      return result.decision;
    },
  };
}

/** The application's shadows. Safe to import anywhere: everything inside is gated. */
export const legacyShadows = createLegacyShadows();
