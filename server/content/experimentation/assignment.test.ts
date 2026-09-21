/**
 * Unit tests for deterministic assignment & eligibility engine (Phase 29.2).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  selectDeterministicVariant,
  checkOpportunityEligibility,
  ExperimentEligibilityError,
} from "./assignment";
import type { Experiment, Opportunity } from "@shared/schema";

describe("deterministic variant selection (Phase 29.2)", () => {
  const variants = [
    { id: 10, trafficWeight: 50 },
    { id: 20, trafficWeight: 50 },
  ];

  it("produces strictly reproducible variant assignment for the same (experiment, opportunity)", () => {
    const run1 = selectDeterministicVariant(1, 101, variants);
    const run2 = selectDeterministicVariant(1, 101, variants);
    const run3 = selectDeterministicVariant(1, 101, variants);

    assert.equal(run1.id, run2.id);
    assert.equal(run2.id, run3.id);
  });

  it("distributes assignments across both variants over distinct opportunities", () => {
    const counts = { 10: 0, 20: 0 };
    for (let oppId = 1; oppId <= 100; oppId++) {
      const selected = selectDeterministicVariant(1, oppId, variants);
      counts[selected.id as 10 | 20] += 1;
    }

    assert.ok(counts[10] > 30, `expected balanced distribution, variant 10 got ${counts[10]}`);
    assert.ok(counts[20] > 30, `expected balanced distribution, variant 20 got ${counts[20]}`);
  });

  it("handles single variant configurations", () => {
    const single = [{ id: 99, trafficWeight: 100 }];
    const res = selectDeterministicVariant(1, 42, single);
    assert.equal(res.id, 99);
  });

  it("throws when variant array is empty", () => {
    assert.throws(
      () => selectDeterministicVariant(1, 42, []),
      /has no variants/,
    );
  });
});

describe("opportunity eligibility checking (Phase 29.2)", () => {
  const baseExperiment: Experiment = {
    id: 1,
    userId: 5,
    sourceProposalId: null,
    name: "Test Experiment",
    hypothesis: "Hypothesis",
    objective: "Objective",
    targetScope: "channel:linkedin;format:carousel",
    experimentType: "format_distribution",
    primaryMetric: "engagements_per_post",
    guardrailMetrics: ["publication_failure_rate"],
    eligibilityRules: { channel: "linkedin", format: "carousel" },
    allocationMethod: "deterministic_hash",
    status: "running",
    decision: "pending",
    decisionNotes: null,
    decidedAt: null,
    decidedBy: null,
    minSampleSize: 3,
    startedAt: new Date(),
    completedAt: null,
    identityKey: "exp:5:test",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseOpportunity: Opportunity = {
    id: 50,
    userId: 5,
    storyId: 1,
    concept: "Concept",
    objective: "Objective",
    audience: "Audience",
    angle: "Angle",
    channel: "linkedin",
    format: "carousel",
    status: "approved",
    score: null,
    scoreBreakdown: {},
    proposer: "human",
    chatKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("passes when all eligibility criteria match", () => {
    const res = checkOpportunityEligibility(baseOpportunity, baseExperiment);
    assert.equal(res.eligible, true);
  });

  it("rejects opportunity belonging to a different owner", () => {
    const foreignOpp = { ...baseOpportunity, userId: 99 };
    const res = checkOpportunityEligibility(foreignOpp, baseExperiment);
    assert.equal(res.eligible, false);
    assert.match(res.reason!, /owner/);
  });

  it("rejects opportunity when experiment is draft or completed", () => {
    const draftExp = { ...baseExperiment, status: "draft" as const };
    const res = checkOpportunityEligibility(baseOpportunity, draftExp);
    assert.equal(res.eligible, false);
    assert.match(res.reason!, /not running or ready/);
  });

  it("rejects killed opportunities", () => {
    const killedOpp = { ...baseOpportunity, status: "killed" };
    const res = checkOpportunityEligibility(killedOpp, baseExperiment);
    assert.equal(res.eligible, false);
    assert.match(res.reason!, /Killed opportunities/);
  });

  it("rejects opportunity with mismatched channel", () => {
    const xOpp = { ...baseOpportunity, channel: "x" };
    const res = checkOpportunityEligibility(xOpp, baseExperiment);
    assert.equal(res.eligible, false);
    assert.match(res.reason!, /Channel mismatch/);
  });

  it("rejects opportunity with mismatched format", () => {
    const postOpp = { ...baseOpportunity, format: "post" };
    const res = checkOpportunityEligibility(postOpp, baseExperiment);
    assert.equal(res.eligible, false);
    assert.match(res.reason!, /Format mismatch/);
  });
});
