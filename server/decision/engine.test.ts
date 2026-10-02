/**
 * Decision engine: the failure matrix and the declared-fallback invariants.
 *
 * Everything is injected — no network, no database, no env — so the whole matrix
 * runs in-process. The point of these tests is not "does Jev work" but "what
 * happens when it doesn't", which is the property the system actually depends on.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, type EngineDeps } from "./engine";
import { getDecisionDefinition } from "./registry";
import type { JevAnswer, JevResponse } from "./jev";
import type { DecisionLedgerEntry, DecisionLedgerPort } from "./ledger";
import type {
  ContentStrategyDecision,
  OpportunityScoreDecision,
  QualityGateDecision,
  ResearchDepthDecision,
  TriageDecision,
} from "./schemas";
import { normalizeState } from "./state";

// ── doubles ──────────────────────────────────────────────────────────────────
function noul(value: number): JevAnswer {
  return { type: "noul", noul: value };
}

function choice(value: string, confidence = 0.9): JevAnswer {
  return { type: "choice", choice: value, probabilities: { [value]: confidence }, confidence };
}

function response(answers: Record<string, JevAnswer>): JevResponse {
  return { model: "jev-1.13.0", answers, usage: { input_tokens: 1, output_tokens: 1 } };
}

function fakeLedger() {
  const entries: DecisionLedgerEntry[] = [];
  const port: DecisionLedgerPort = {
    async insert(entry) {
      entries.push(entry);
      return { id: entries.length, decisionId: entry.decisionId };
    },
    async get() {
      return undefined;
    },
    async list() {
      return [];
    },
    async attachOutcome() {
      return undefined;
    },
  };
  return { port, entries };
}

const SIGNALS = [
  "relevance_to_expertise",
  "reach_potential",
  "novelty",
  "timeliness",
  "contentworthiness",
  "needs_deep_research",
] as const;

const HIGH: Record<string, number> = {
  relevance_to_expertise: 1,
  reach_potential: 0.95,
  novelty: 0.9,
  timeliness: 0.9,
  contentworthiness: 1,
  needs_deep_research: 0.2,
};

const LOW: Record<string, number> = {
  relevance_to_expertise: 0,
  reach_potential: 0.1,
  novelty: 0.1,
  timeliness: 0.2,
  contentworthiness: 0.1,
  needs_deep_research: 0,
};

function triageResponse(perCandidate: Array<Record<string, number>>): JevResponse {
  const answers: Record<string, JevAnswer> = {};
  perCandidate.forEach((signals, index) => {
    for (const key of SIGNALS) answers[`c${index}__${key}`] = noul(signals[key] ?? 0);
  });
  return response(answers);
}

const CANDIDATES = [
  { id: "c0", title: "Karpenter consolidation cut idle nodes 40%", source: "hn" },
  { id: "c1", title: "Song lyrics", source: "youtube" },
];

const TRIAGE_STATE = { candidates: CANDIDATES };

function deps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    enabled: () => true,
    configured: () => true,
    ledger: null,
    ...overrides,
  };
}

// ── the happy path ───────────────────────────────────────────────────────────
describe("decide — research_triage", () => {
  it("keeps pursue/watch and drops the rest, composing the score in code", async () => {
    const { port, entries } = fakeLedger();
    const result = await decide<TriageDecision>(
      { type: "research_triage", state: TRIAGE_STATE, refs: { researchJobId: 7 }, userId: 1 },
      deps({ ledger: port, jevDecide: async () => triageResponse([HIGH, LOW]) }),
    );

    assert.equal(result.fallback, false);
    assert.equal(result.decision.action, "proceed");
    assert.deepEqual(result.decision.keep, [0]);
    assert.deepEqual(result.decision.drop, [1]);
    assert.equal(result.decision.perCandidate[0].decision, "pursue");
    assert.equal(result.decision.perCandidate[1].decision, "drop");
    assert.equal(result.policyId, "research-triage");
    assert.equal(result.policyVersion, "v1");
    assert.equal(result.level, "soft");

    // The ledger is the audit trail: policy identity + a reproducible state hash.
    assert.equal(entries.length, 1);
    assert.equal(entries[0].policyId, "research-triage");
    assert.match(entries[0].inputStateHash, /^[0-9a-f]{64}$/);
    assert.equal(entries[0].fallback, false);
    assert.deepEqual(entries[0].refs, { researchJobId: 7 });
  });

  it("keeps watch candidates as well as pursue (the previous gate discarded them)", async () => {
    const watchish = {
      relevance_to_expertise: 0.5,
      reach_potential: 0.4,
      novelty: 0.5,
      timeliness: 0.5,
      contentworthiness: 0.5,
      needs_deep_research: 0.1,
    };
    const result = await decide<TriageDecision>(
      { type: "research_triage", state: TRIAGE_STATE },
      deps({ jevDecide: async () => triageResponse([HIGH, watchish]) }),
    );
    assert.equal(result.decision.perCandidate[1].decision, "watch");
    assert.deepEqual(result.decision.keep, [0, 1]);
  });
});

describe("decide — research_depth", () => {
  it("uses a choice question with an object criteria set (Jev's verified contract)", async () => {
    const result = await decide<ResearchDepthDecision>(
      { type: "research_depth", state: { requestedDepth: "standard" } },
      deps({ jevDecide: async () => response({ depth: choice("deep", 0.88) }) }),
    );
    assert.deepEqual(result.decision, { depth: "deep" });
    assert.equal(result.fallback, false);
  });

  it("falls back to the requested depth when the answer is unusable", async () => {
    const result = await decide<ResearchDepthDecision>(
      { type: "research_depth", state: { requestedDepth: "quick" } },
      deps({ jevDecide: async () => response({ depth: choice("medium-ish") }) }),
    );
    assert.equal(result.fallback, true);
    assert.deepEqual(result.decision, { depth: "quick" });
    assert.match(result.reasons[0], /unusable|medium-ish/i);
  });
});

describe("decide — opportunity_score", () => {
  const signals = (value: number): JevAnswer => noul(value);

  it("composes the weighted score and bands it", async () => {
    const values = [0.9, 0.8, 0.85, 0.9, 0.7, 0.8];
    const keys = [
      "audience_relevance",
      "novelty",
      "timeliness",
      "practitioner_value",
      "discussion_potential",
      "differentiation",
    ];
    const answers: Record<string, JevAnswer> = {};
    keys.forEach((key, i) => (answers[key] = signals(values[i])));

    const result = await decide<OpportunityScoreDecision>(
      { type: "opportunity_score", state: { topic: { title: "Karpenter" } } },
      deps({ jevDecide: async () => response(answers) }),
    );

    assert.equal(result.fallback, false);
    assert.equal(result.decision.band, "high");
    assert.ok(typeof result.decision.score === "number" && result.decision.score > 0.8);
    assert.ok((result.signals?.audience_relevance as number) === 0.9);
  });

  it("still records a modest band when confidence is low (conservative, not permissive)", async () => {
    const keys = [
      "audience_relevance",
      "novelty",
      "timeliness",
      "practitioner_value",
      "discussion_potential",
      "differentiation",
    ];
    const answers: Record<string, JevAnswer> = {};
    for (const key of keys) answers[key] = noul(0.4);

    const result = await decide<OpportunityScoreDecision>(
      { type: "opportunity_score", state: {} },
      deps({ jevDecide: async () => response(answers) }),
    );

    assert.equal(result.fallback, false, "a conservative band is worth recording even when unsure");
    assert.equal(result.decision.band, "medium");
    assert.equal(result.decision.score, 0.4);
  });

  it("only a HIGH band is treated as the permissive claim", async () => {
    const definition = getDecisionDefinition("opportunity_score");
    assert.equal(definition.isPermissive?.({ band: "high", score: 0.9 }), true);
    assert.equal(definition.isPermissive?.({ band: "medium", score: 0.5 }), false);
    assert.equal(definition.isPermissive?.({ band: "low", score: 0.2 }), false);
    assert.equal(definition.isPermissive?.({ band: "unknown", score: null }), false);
  });

  it("never fabricates a score when Jev is unavailable", async () => {
    const result = await decide<OpportunityScoreDecision>(
      { type: "opportunity_score", state: {} },
      deps({ jevDecide: async () => { throw new Error("ECONNREFUSED"); } }),
    );
    assert.deepEqual(result.decision, { score: null, band: "unknown" });
    assert.equal(result.fallback, true);
  });
});

// ── quality gate ─────────────────────────────────────────────────────────────
describe("decide — quality_gate", () => {
  const quality = (dimensions: number[], publishWorthy: number): JevResponse =>
    response({
      specific: noul(dimensions[0]),
      original: noul(dimensions[1]),
      clear: noul(dimensions[2]),
      audience_fit: noul(dimensions[3]),
      publish_worthy: noul(publishWorthy),
    });

  const QUALITY_STATE = {
    platform: { channel: "x", format: "x_post", maxCharacters: 280 },
    quality: { signals: { boilerplate: 0.1 }, flags: [] },
  };

  it("approves strong content", async () => {
    const result = await decide<QualityGateDecision>(
      { type: "quality_gate", state: QUALITY_STATE, refs: { artifactId: 9 } },
      deps({ jevDecide: async () => quality([0.9, 0.9, 0.9, 0.9], 0.85) }),
    );
    assert.equal(result.decision.outcome, "approve");
    assert.equal(result.fallback, false);
    assert.equal(result.policyId, "quality-gate");
  });

  it("revises middling content", async () => {
    const result = await decide<QualityGateDecision>(
      { type: "quality_gate", state: QUALITY_STATE },
      deps({ jevDecide: async () => quality([0.5, 0.5, 0.6, 0.5], 0.5) }),
    );
    assert.equal(result.decision.outcome, "revise");
  });

  it("rejects weak content — and a conservative rejection is not downgraded by low confidence", async () => {
    const result = await decide<QualityGateDecision>(
      { type: "quality_gate", state: QUALITY_STATE },
      deps({ jevDecide: async () => quality([0.1, 0.05, 0.2, 0.1], 0.05) }),
    );
    assert.equal(result.decision.outcome, "reject");
    assert.equal(result.fallback, false, "a rejection needs no confidence to be honoured");
  });

  it("holds when the judgment is unreadable (fail-closed, never a rejection)", async () => {
    const result = await decide<QualityGateDecision>(
      { type: "quality_gate", state: QUALITY_STATE },
      deps({ jevDecide: async () => response({}) }),
    );
    assert.deepEqual(result.decision, { outcome: "hold", score: null });
    assert.equal(result.fallback, true);
  });

  it("holds when Jev is unavailable", async () => {
    const result = await decide<QualityGateDecision>(
      { type: "quality_gate", state: QUALITY_STATE },
      deps({ jevDecide: async () => { throw new Error("timeout"); } }),
    );
    assert.equal(result.decision.outcome, "hold");
    assert.equal(result.fallback, true);
  });
});

// ── content strategy ─────────────────────────────────────────────────────────
describe("decide — content_strategy", () => {
  const STRATEGY_STATE = {
    topic: { title: "Kubernetes cost", angles: ["cost", "developer experience", "platform ownership"] },
    audience: { options: ["platform engineers", "SREs"] },
    expertise: { domains: ["Kubernetes cost"], goals: ["authority", "recruiting"] },
  };

  it("asks only choices that actually exist, with the options as criteria keys", () => {
    const questions = getDecisionDefinition("content_strategy").buildQuestions({
      state: normalizeState(STRATEGY_STATE),
    });
    assert.deepEqual(Object.keys(questions).sort(), ["angle", "audience", "expertise", "goal"]);
    assert.deepEqual(Object.keys(questions.angle.criteria as object), [
      "cost",
      "developer experience",
      "platform ownership",
    ]);
    assert.equal(typeof questions.angle.instructions, "string");
  });

  it("does not ask a one-option question", () => {
    const questions = getDecisionDefinition("content_strategy").buildQuestions({
      state: normalizeState({
        topic: { title: "t", angles: ["only one"] },
        audience: { options: [] },
        expertise: { goals: [] },
      }),
    });
    assert.deepEqual(Object.keys(questions), ["expertise"], "only the always-answerable question remains");
  });

  it("maps a full set of answers and averages their confidence", async () => {
    const result = await decide<ContentStrategyDecision>(
      { type: "content_strategy", state: STRATEGY_STATE, refs: { storyId: 4 } },
      deps({
        jevDecide: async () =>
          response({
            angle: choice("cost", 0.8),
            audience: choice("platform engineers", 0.7),
            goal: choice("authority", 0.6),
            expertise: choice("core", 0.9),
          }),
      }),
    );
    assert.equal(result.fallback, false);
    assert.deepEqual(result.decision, {
      angle: "cost",
      audience: "platform engineers",
      goal: "authority",
      expertise: "core",
    });
    assert.ok((result.confidence ?? 0) > 0.7 && (result.confidence ?? 0) <= 0.9);
  });

  it("leaves an unanswered field null rather than inventing one", async () => {
    const result = await decide<ContentStrategyDecision>(
      { type: "content_strategy", state: STRATEGY_STATE },
      deps({ jevDecide: async () => response({ expertise: choice("adjacent", 0.6) }) }),
    );
    assert.deepEqual(result.decision, {
      angle: null,
      audience: null,
      goal: null,
      expertise: "adjacent",
    });
  });

  it("falls back to choosing nothing when no answer is usable", async () => {
    const result = await decide<ContentStrategyDecision>(
      { type: "content_strategy", state: STRATEGY_STATE },
      deps({ jevDecide: async () => response({ angle: choice("not one of them", 0.9) }) }),
    );
    assert.equal(result.fallback, true);
    assert.deepEqual(result.decision, { angle: null, audience: null, goal: null, expertise: null });
  });
});

// ── the failure matrix ───────────────────────────────────────────────────────
describe("decide — failure matrix", () => {
  it("engine disabled ⇒ declared fallback, still recorded", async () => {
    const { port, entries } = fakeLedger();
    const result = await decide<TriageDecision>(
      { type: "research_triage", state: TRIAGE_STATE },
      deps({ enabled: () => false, ledger: port }),
    );
    assert.equal(result.fallback, true);
    assert.deepEqual(result.decision.keep, [0, 1], "fail-open keeps every candidate");
    assert.match(result.reasons[0], /disabled/);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].fallback, true);
  });

  it("jev unconfigured ⇒ declared fallback", async () => {
    const result = await decide<TriageDecision>(
      { type: "research_triage", state: TRIAGE_STATE },
      deps({ configured: () => false }),
    );
    assert.equal(result.fallback, true);
    assert.deepEqual(result.decision.keep, [0, 1]);
  });

  it("jev throws ⇒ declared fallback, never an error to the caller", async () => {
    const result = await decide<TriageDecision>(
      { type: "research_triage", state: TRIAGE_STATE },
      deps({ jevDecide: async () => { throw new Error("JEV_RATE_LIMITED:429"); } }),
    );
    assert.equal(result.fallback, true);
    assert.deepEqual(result.decision.keep, [0, 1]);
    assert.match(result.reasons[0], /JEV_RATE_LIMITED/);
  });

  it("malformed answers ⇒ declared fallback", async () => {
    const result = await decide<TriageDecision>(
      { type: "research_triage", state: TRIAGE_STATE },
      deps({ jevDecide: async () => ({ model: "x", answers: { nope: noul(1) }, usage: { input_tokens: 0, output_tokens: 0 } }) }),
    );
    assert.equal(result.fallback, true);
    assert.deepEqual(result.decision.keep, [0, 1], "an unparseable answer keeps everything");
  });

  it("no candidates ⇒ nothing to decide, no Jev call", async () => {
    let called = 0;
    const result = await decide<TriageDecision>(
      { type: "research_triage", state: { candidates: [] } },
      deps({ jevDecide: async () => { called += 1; return triageResponse([]); } }),
    );
    assert.equal(called, 0);
    assert.equal(result.fallback, true);
    assert.equal(result.decision.action, "skip");
  });

  it("a failing ledger never changes the decision", async () => {
    const exploding: DecisionLedgerPort = {
      async insert() { throw new Error("db down"); },
      async get() { return undefined; },
      async list() { return []; },
      async attachOutcome() { return undefined; },
    };
    const result = await decide<TriageDecision>(
      { type: "research_triage", state: TRIAGE_STATE },
      deps({ ledger: exploding, jevDecide: async () => triageResponse([HIGH, LOW]) }),
    );
    assert.equal(result.fallback, false);
    assert.deepEqual(result.decision.keep, [0]);
  });

  it("a non-finite signal never leaks into a score, and an unanswered candidate is kept", async () => {
    const result = await decide<TriageDecision>(
      { type: "research_triage", state: TRIAGE_STATE },
      deps({
        jevDecide: async () =>
          response({
            "c0__relevance_to_expertise": noul(Number.NaN),
            "c0__contentworthiness": noul(1),
          }),
      }),
    );

    assert.equal(result.fallback, false);
    // Only the answered candidate is judged, and its score stays finite.
    assert.equal(result.decision.perCandidate.length, 1);
    assert.ok(result.decision.perCandidate.every((c) => Number.isFinite(c.score)));
    assert.deepEqual(result.decision.drop, [0]);
    // c1 was never answered for — fail-open keeps it rather than dropping it.
    assert.deepEqual(result.decision.keep, [1]);
  });
});
