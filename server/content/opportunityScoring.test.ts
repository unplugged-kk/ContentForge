/**
 * Opportunity scoring: the decision gets the expertise evidence, and an advisory
 * score can never block creating an Opportunity or override a caller's own.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJevOpportunityScoring, type OpportunityScoringPort } from "./opportunityScoring";
import { createOpportunityFromStory, type OpportunityDeps, type StoryPort } from "./opportunity";
import { registerBuiltinChannelAdapters } from "./adapters";
import { buildExpertiseProfile } from "../intelligence/expertise";
import type { ContentStoragePort } from "./storage";

// The Opportunity boundary validates format × channel against the adapter
// registry, so the built-ins must be registered before the integration cases.
registerBuiltinChannelAdapters();

// ── the port ─────────────────────────────────────────────────────────────────
const engineResult = (score: number | null, band: string, fallback = false) => ({
  decision: { score, band },
  reasons: [`band ${band}`],
  signals: {},
  policyId: "opportunity-score",
  policyVersion: "v1",
  decisionType: "opportunity_score",
  fallback,
  level: "soft" as const,
});

const PROFILE = buildExpertiseProfile({
  niche: "Platform Engineering",
  pillars: ["Kubernetes cost", "Developer experience"],
});

describe("createJevOpportunityScoring", () => {
  it("passes the expertise evidence into the decision state and the breakdown", async () => {
    let seen: Record<string, any> | null = null;
    const port = createJevOpportunityScoring({
      loadProfile: async () => PROFILE,
      decide: (async (input: Record<string, any>) => {
        seen = input;
        return engineResult(0.72, "high");
      }) as never,
    });

    const outcome = await port.score({
      storyId: 3,
      userId: 1,
      concept: "Kubernetes cost: idle nodes and pod request defaults",
      objective: "practitioner insight",
      format: "x_post",
      channel: "x",
      title: "Cost story",
      angles: ["consolidation"],
    });

    assert.equal(outcome.score, 0.72);
    assert.equal(outcome.breakdown.band, "high");
    // The decision actually received the evidence — otherwise the expertise
    // conversation would be decorative.
    assert.ok(seen!.state.expertise.alignment > 0);
    assert.deepEqual(seen!.state.expertise.domains, PROFILE.domains);
    assert.equal(seen!.state.platform.format, "x_post");
    assert.equal(seen!.refs.storyId, 3);
    assert.equal(seen!.userId, 1);
    // …and it is recorded on the row for later policy evaluation.
    const expertise = outcome.breakdown.expertise as Record<string, unknown>;
    assert.ok((expertise.alignment as number) > 0);
    assert.equal(expertise.confidence, "weak");
    assert.equal(outcome.breakdown.policy, "opportunity-score@v1");
  });

  it("carries an unknown score through rather than inventing one", async () => {
    const port = createJevOpportunityScoring({
      loadProfile: async () => PROFILE,
      decide: (async () => engineResult(null, "unknown", true)) as never,
    });
    const outcome = await port.score({
      storyId: 1,
      concept: "anything",
      objective: "o",
      format: "x_post",
      channel: "x",
    });
    assert.equal(outcome.score, null);
    assert.equal(outcome.breakdown.band, "unknown");
    assert.equal(outcome.breakdown.fallback, true);
  });
});

// ── the Opportunity integration ──────────────────────────────────────────────
function harness(scoring?: OpportunityScoringPort) {
  const inserted: Array<Record<string, unknown>> = [];
  const story = {
    id: 3,
    userId: 1,
    title: "Cost story",
    insightBody: "body",
    angles: ["consolidation"],
    status: "draft",
  };
  const deps: OpportunityDeps = {
    opportunities: {
      insertOpportunity: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { id: 11, ...row };
      },
    } as unknown as ContentStoragePort,
    stories: {
      getStory: async () => story,
      updateStoryStatus: async () => story,
    } as unknown as StoryPort,
    ...(scoring ? { scoring } : {}),
  };
  return { deps, inserted };
}

const BASE = { concept: "Kubernetes cost", objective: "practitioner insight", format: "x_post", channel: "x" };

function fixedScoring(outcome: {
  score: number | null;
  breakdown: Record<string, unknown>;
  audience?: string | null;
  angle?: string | null;
}): OpportunityScoringPort {
  return { score: async () => outcome };
}

describe("createJevOpportunityScoring + content strategy", () => {
  const strategyResult = {
    decision: { angle: "consolidation", audience: "platform engineers", goal: "authority", expertise: "core" },
    reasons: ["strategy"],
    policyId: "content-strategy",
    policyVersion: "v1",
    decisionType: "content_strategy",
    fallback: false,
    level: "soft" as const,
  };

  it("carries the strategy outcome into audience/angle and the breakdown", async () => {
    const port = createJevOpportunityScoring({
      loadProfile: async () => PROFILE,
      strategyEnabled: () => true,
      decide: (async (input: Record<string, any>) =>
        input.type === "content_strategy" ? strategyResult : engineResult(0.5, "medium")) as never,
    });

    const outcome = await port.score({
      storyId: 1,
      concept: "Kubernetes cost",
      objective: "o",
      format: "x_post",
      channel: "x",
      angles: ["consolidation", "cost"],
    });

    assert.equal(outcome.audience, "platform engineers");
    assert.equal(outcome.angle, "consolidation");
    const strategy = outcome.breakdown.strategy as Record<string, unknown>;
    assert.equal(strategy.goal, "authority");
    assert.equal(strategy.expertise, "core");
    assert.equal(strategy.policy, "content-strategy@v1");
  });

  it("does not ask the strategy question when its flag is off", async () => {
    const calls: string[] = [];
    const port = createJevOpportunityScoring({
      loadProfile: async () => PROFILE,
      strategyEnabled: () => false,
      decide: (async (input: Record<string, any>) => {
        calls.push(input.type);
        return engineResult(0.5, "medium");
      }) as never,
    });

    const outcome = await port.score({
      storyId: 1,
      concept: "c",
      objective: "o",
      format: "x_post",
      channel: "x",
    });

    assert.deepEqual(calls, ["opportunity_score"], "one decision call, not two");
    assert.equal(outcome.audience, null);
    assert.equal(outcome.breakdown.strategy, undefined);
  });

  it("still returns the score when the strategy call fails", async () => {
    const port = createJevOpportunityScoring({
      loadProfile: async () => PROFILE,
      strategyEnabled: () => true,
      decide: (async (input: Record<string, any>) => {
        if (input.type === "content_strategy") throw new Error("strategy unavailable");
        return engineResult(0.5, "medium");
      }) as never,
    });

    const outcome = await port.score({
      storyId: 1,
      concept: "c",
      objective: "o",
      format: "x_post",
      channel: "x",
    });

    assert.equal(outcome.score, 0.5);
    assert.equal(outcome.audience, null);
  });
});

describe("createOpportunityFromStory + scoring", () => {
  it("leaves the score null when no scoring port is wired (unchanged behaviour)", async () => {
    const { deps, inserted } = harness();
    await createOpportunityFromStory(3, BASE, deps);
    assert.equal(inserted[0].score, null);
    assert.deepEqual(inserted[0].scoreBreakdown, {});
  });

  it("persists the computed score and breakdown", async () => {
    const { deps, inserted } = harness(
      fixedScoring({ score: 0.72, breakdown: { band: "high", expertise: { alignment: 0.4 } } }),
    );
    await createOpportunityFromStory(3, BASE, deps);
    assert.equal(inserted[0].score, "0.72");
    assert.equal((inserted[0].scoreBreakdown as Record<string, unknown>).band, "high");
  });

  it("lets a caller-supplied score win over the computed one", async () => {
    const { deps, inserted } = harness(fixedScoring({ score: 0.1, breakdown: { band: "low" } }));
    await createOpportunityFromStory(3, { ...BASE, score: 0.9, scoreBreakdown: { band: "manual" } }, deps);
    assert.equal(inserted[0].score, "0.9");
    assert.equal((inserted[0].scoreBreakdown as Record<string, unknown>).band, "manual");
  });

  it("still creates the Opportunity when scoring throws", async () => {
    const exploding: OpportunityScoringPort = {
      async score() {
        throw new Error("decision layer unavailable");
      },
    };
    const { deps, inserted } = harness(exploding);
    const opportunity = await createOpportunityFromStory(3, BASE, deps);
    assert.ok(opportunity);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].score, null, "an advisory score never blocks or invents a value");
  });

  it("fills audience and angle from the strategy when the caller omits them", async () => {
    const { deps, inserted } = harness(
      fixedScoring({
        score: 0.4,
        breakdown: { band: "medium" },
        audience: "platform engineers",
        angle: "consolidation",
      }),
    );
    await createOpportunityFromStory(3, BASE, deps);
    assert.equal(inserted[0].audience, "platform engineers");
    assert.equal(inserted[0].angle, "consolidation");
  });

  it("lets a caller-supplied audience and angle win", async () => {
    const { deps, inserted } = harness(
      fixedScoring({ score: 0.4, breakdown: {}, audience: "SREs", angle: "cost" }),
    );
    await createOpportunityFromStory(3, { ...BASE, audience: "founders", angle: "hiring" }, deps);
    assert.equal(inserted[0].audience, "founders");
    assert.equal(inserted[0].angle, "hiring");
  });
});
