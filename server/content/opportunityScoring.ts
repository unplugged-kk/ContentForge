/**
 * Opportunity advisory — the ContentForge-side half of the `opportunity_score`
 * and `content_strategy` decisions, and the missing writer for three columns
 * that existed but that nothing ever computed: `opportunities.score`,
 * `score_breakdown`, and (via strategy) `audience` / `angle`.
 *
 * The decision layer supplies judgment; this seam supplies the EVIDENCE — the
 * deterministic expertise alignment (is this topic inside the creator's
 * standing?) plus the bounded candidate sets Jev may choose from. A conversation
 * about expertise that never reaches the decision is worthless, so the alignment
 * goes into the state Jev judges and into the stored breakdown.
 *
 * Advisory by construction: it returns values and the caller decides whether to
 * store them. It never blocks creating an Opportunity.
 */

import { decide } from "../decision/engine";
import { decisionTypeEnabled } from "../decision/policies";
import type { ContentStrategyDecision, OpportunityScoreDecision } from "../decision/schemas";
import {
  buildExpertiseProfile,
  expertiseAlignment,
  expertiseBand,
  type ExpertiseProfile,
} from "../intelligence/expertise";
import { reachSignalRecord, type ReachSignals } from "../intelligence/reach";
import type { JsonRecord } from "./storage";

export interface OpportunityScoringInput {
  storyId: number;
  userId?: number | null;
  concept: string;
  objective: string;
  format: string;
  channel: string;
  /** Story context — widens the expertise comparison and supplies angle candidates. */
  title?: string;
  angles?: string[];
}

export interface OpportunityScoreOutcome {
  /** null ⇒ no score could be computed. Never fabricated. */
  score: number | null;
  breakdown: JsonRecord;
  /** From `content_strategy`, when that decision is enabled and answered. */
  audience?: string | null;
  angle?: string | null;
}

export interface OpportunityScoringPort {
  score(input: OpportunityScoringInput): Promise<OpportunityScoreOutcome>;
}

export interface OpportunityScoringDeps {
  /** Injected for tests; defaults to the real engine entry point. */
  decide?: typeof decide;
  /** Supplies the creator's expertise profile; defaults to an empty one. */
  loadProfile?: (userId: number | null | undefined) => Promise<ExpertiseProfile>;
  /** Supplies reach evidence from our own history; omitted ⇒ no reach evidence. */
  loadReach?: (userId: number | null | undefined) => Promise<ReachSignals | null>;
  /** Whether to also ask the strategy decision. Defaults to its own flag. */
  strategyEnabled?: () => boolean;
}

export function createJevOpportunityScoring(
  deps: OpportunityScoringDeps = {},
): OpportunityScoringPort {
  const run = deps.decide ?? decide;
  const loadProfile = deps.loadProfile ?? (async () => buildExpertiseProfile());
  const loadReach = deps.loadReach ?? (async () => null);
  const strategyEnabled = deps.strategyEnabled ?? (() => decisionTypeEnabled("content_strategy"));

  return {
    async score(input: OpportunityScoringInput): Promise<OpportunityScoreOutcome> {
      const profile = await loadProfile(input.userId);
      const alignment = expertiseAlignment(profile, {
        title: input.concept,
        query: input.objective,
        angles: input.angles,
      });

      // Reach evidence is optional: without history there is nothing honest to
      // report, and the decision must not be handed a fabricated zero.
      let reach: ReachSignals | null = null;
      try {
        reach = (await loadReach(input.userId)) ?? null;
      } catch {
        reach = null;
      }

      const state = {
        topic: { title: input.concept, query: input.objective, angles: input.angles },
        expertise: {
          domains: profile.domains,
          goals: profile.goals,
          alignment: alignment.alignment,
          confidence: profile.confidence,
        },
        audience: { options: profile.audiences },
        platform: { channel: input.channel, format: input.format },
        ...(reach ? { reach: reachSignalRecord(reach) } : {}),
      };

      const scored = await run<OpportunityScoreDecision>({
        type: "opportunity_score",
        state,
        refs: { storyId: input.storyId },
        userId: input.userId ?? null,
      });
      const score = scored.decision as OpportunityScoreDecision;

      const breakdown: JsonRecord = {
        band: score.band,
        expertise: {
          alignment: alignment.alignment,
          // The deterministic band, kept beside Jev's judgment below so the two
          // can be compared when a policy is evaluated.
          band: expertiseBand(alignment.alignment),
          matched: alignment.matched.slice(0, 5),
          confidence: profile.confidence,
        },
        policy: `${scored.policyId}@${scored.policyVersion}`,
        fallback: scored.fallback,
        ...(reach
          ? {
              reach: {
                historical_performance: reach.historical_performance,
                reach_potential: reach.reach_potential,
                sampleSize: reach.sampleSize,
                confidence: reach.confidence,
              },
            }
          : {}),
      };

      let audience: string | null = null;
      let angle: string | null = null;
      if (strategyEnabled()) {
        try {
          const strategyResult = await run<ContentStrategyDecision>({
            type: "content_strategy",
            state,
            refs: { storyId: input.storyId },
            userId: input.userId ?? null,
          });
          const strategy = strategyResult.decision as ContentStrategyDecision;
          audience = strategy.audience;
          angle = strategy.angle;
          breakdown.strategy = {
            angle: strategy.angle,
            audience: strategy.audience,
            goal: strategy.goal,
            expertise: strategy.expertise,
            policy: `${strategyResult.policyId}@${strategyResult.policyVersion}`,
            fallback: strategyResult.fallback,
          };
        } catch {
          /* advisory only: the Opportunity is still created */
        }
      }

      return { score: score.score, breakdown, audience, angle };
    },
  };
}
