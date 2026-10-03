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
import { decisionTypeEnabled, type DecisionType } from "./policies";
import type { DecisionRefs } from "./registry";
import { LLM_OVERALL_KEY } from "./decisions/viral";
import { MAX_RANK_ITEMS } from "./decisions/discover";
import type { AgentRouteDecision, DiscoverRankDecision, ViralScoreDecision } from "./schemas";

export interface ViralScoreShadowInput {
  /** The draft being scored. */
  content: string;
  platform?: string;
  /** The legacy model's own overall_score (0-10), kept for comparison. */
  llmOverall?: number | null;
  userId?: number | null;
  refs?: DecisionRefs;
}

export interface DiscoverRankShadowInput {
  items: Array<{ title: string; summary?: string; url?: string; source?: string }>;
  /** How many ideas the legacy call produced, for the comparison. */
  llmIdeaCount?: number | null;
  userId?: number | null;
}

export interface AgentRouteShadowInput {
  objective: string;
  /** The regex compiler's own choice, for the comparison. */
  legacyTool?: string | null;
  legacyPreset?: string | null;
  userId?: number | null;
}

export interface LegacyShadowDeps {
  /** Injected for tests; defaults to the real shadow entry point. */
  shadow?: typeof shadowDecide;
  enabled?: (type: DecisionType) => boolean;
}

export function createLegacyShadows(deps: LegacyShadowDeps = {}) {
  const run = deps.shadow ?? shadowDecide;
  const enabled = deps.enabled ?? ((type: DecisionType) => decisionTypeEnabled(type));

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

    /**
     * JC-02 `/api/discover/refresh`. Records which raw items the decision layer
     * would promote; the ranking the model produced is untouched.
     */
    async discoverRank(input: DiscoverRankShadowInput): Promise<DiscoverRankDecision | null> {
      if (!enabled("discover_rank")) return null;

      const flags =
        typeof input.llmIdeaCount === "number" && Number.isFinite(input.llmIdeaCount)
          ? [`legacy:ideas=${input.llmIdeaCount}`]
          : [];

      const result = await run<DiscoverRankDecision>({
        type: "discover_rank",
        state: {
          candidates: input.items.slice(0, MAX_RANK_ITEMS),
          quality: { flags },
        },
        userId: input.userId ?? null,
      });

      return result.decision;
    },

    /**
     * JC-03 agent intent routing. Records which tool the decision layer would
     * start with; the regex compiler's plan is untouched.
     */
    async agentRoute(input: AgentRouteShadowInput): Promise<AgentRouteDecision | null> {
      if (!enabled("agent_route")) return null;

      const flags: string[] = [];
      if (input.legacyTool) flags.push(`legacy:tool=${input.legacyTool}`);
      if (input.legacyPreset) flags.push(`legacy:preset=${input.legacyPreset}`);

      const result = await run<AgentRouteDecision>({
        type: "agent_route",
        state: {
          topic: { title: input.objective.slice(0, 200) },
          quality: { flags },
        },
        userId: input.userId ?? null,
      });

      return result.decision;
    },
  };
}

/** The application's shadows. Safe to import anywhere: everything inside is gated. */
export const legacyShadows = createLegacyShadows();
