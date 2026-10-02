/**
 * Opportunity scoring — the ContentForge-side half of the `opportunity_score`
 * decision, and the missing consumer for the `opportunities.score` /
 * `scoreBreakdown` columns (they existed but nothing ever computed them).
 *
 * The decision layer supplies the judgment; this seam supplies the EVIDENCE:
 * the deterministic expertise alignment (is this topic inside the creator's
 * standing?) plus the topic and platform context. A conversation about
 * expertise that never reaches the decision is worthless, so the alignment goes
 * into the state Jev judges and into the stored breakdown.
 *
 * Advisory by construction: it returns a score, and the caller decides whether
 * to store it. It never blocks creating an Opportunity.
 */

import { decide } from "../decision/engine";
import type { OpportunityScoreDecision } from "../decision/schemas";
import {
  buildExpertiseProfile,
  expertiseAlignment,
  expertiseBand,
  type ExpertiseProfile,
} from "../intelligence/expertise";
import type { JsonRecord } from "./storage";

export interface OpportunityScoringInput {
  storyId: number;
  userId?: number | null;
  concept: string;
  objective: string;
  format: string;
  channel: string;
  /** Story context — widens the expertise comparison beyond the concept line. */
  title?: string;
  angles?: string[];
}

export interface OpportunityScoreOutcome {
  /** null ⇒ no score could be computed. Never fabricated. */
  score: number | null;
  breakdown: JsonRecord;
}

export interface OpportunityScoringPort {
  score(input: OpportunityScoringInput): Promise<OpportunityScoreOutcome>;
}

export interface OpportunityScoringDeps {
  /** Injected for tests; defaults to the real engine entry point. */
  decide?: typeof decide;
  /** Supplies the creator's expertise profile; defaults to an empty one. */
  loadProfile?: (userId: number | null | undefined) => Promise<ExpertiseProfile>;
}

export function createJevOpportunityScoring(
  deps: OpportunityScoringDeps = {},
): OpportunityScoringPort {
  const run = deps.decide ?? decide;
  const loadProfile = deps.loadProfile ?? (async () => buildExpertiseProfile());

  return {
    async score(input: OpportunityScoringInput): Promise<OpportunityScoreOutcome> {
      const profile = await loadProfile(input.userId);
      const alignment = expertiseAlignment(profile, {
        title: input.concept,
        query: input.objective,
        angles: input.angles,
      });

      const result = await run<OpportunityScoreDecision>({
        type: "opportunity_score",
        state: {
          topic: { title: input.concept, query: input.objective, angles: input.angles },
          expertise: {
            domains: profile.domains,
            alignment: alignment.alignment,
            confidence: profile.confidence,
          },
          platform: { channel: input.channel, format: input.format },
        },
        refs: { storyId: input.storyId },
        userId: input.userId ?? null,
      });

      const decision = result.decision as OpportunityScoreDecision;
      return {
        score: decision.score,
        breakdown: {
          band: decision.band,
          expertise: {
            alignment: alignment.alignment,
            band: expertiseBand(alignment.alignment),
            matched: alignment.matched.slice(0, 5),
            confidence: profile.confidence,
          },
          policy: `${result.policyId}@${result.policyVersion}`,
          fallback: result.fallback,
        },
      };
    },
  };
}
