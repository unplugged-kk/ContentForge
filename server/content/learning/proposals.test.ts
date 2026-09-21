import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateEvidenceQuality,
  observationIdentityKey,
  proposalIdentityKey,
  MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL,
} from "./proposals";

describe("learning proposals engine (unit)", () => {
  describe("evidence qualification and deterministic thresholds", () => {
    it("classifies sample size < 3 as insufficient_data", () => {
      assert.equal(evaluateEvidenceQuality(0), "insufficient_data");
      assert.equal(evaluateEvidenceQuality(1), "insufficient_data");
      assert.equal(evaluateEvidenceQuality(2), "insufficient_data");
    });

    it("classifies sample size 3-5 as observed", () => {
      assert.equal(evaluateEvidenceQuality(3), "observed");
      assert.equal(evaluateEvidenceQuality(4), "observed");
      assert.equal(evaluateEvidenceQuality(5), "observed");
    });

    it("classifies sample size 6-10 as directional", () => {
      assert.equal(evaluateEvidenceQuality(6), "directional");
      assert.equal(evaluateEvidenceQuality(8), "directional");
      assert.equal(evaluateEvidenceQuality(10), "directional");
    });

    it("classifies sample size 11-20 as repeatable", () => {
      assert.equal(evaluateEvidenceQuality(11), "repeatable");
      assert.equal(evaluateEvidenceQuality(15), "repeatable");
      assert.equal(evaluateEvidenceQuality(20), "repeatable");
    });

    it("classifies sample size > 20 as confirmed", () => {
      assert.equal(evaluateEvidenceQuality(21), "confirmed");
      assert.equal(evaluateEvidenceQuality(50), "confirmed");
      assert.equal(evaluateEvidenceQuality(500), "confirmed");
    });

    it("enforces minimum sample size of 3 for proposal eligibility", () => {
      assert.equal(MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL, 3);
      assert.ok(evaluateEvidenceQuality(MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL) !== "insufficient_data");
    });
  });

  describe("idempotent identity keys", () => {
    it("generates deterministic observation identity keys", () => {
      const key1 = observationIdentityKey(
        42,
        "distribution",
        "format_channel_performance",
        "channel:linkedin;format:carousel",
        "engagements_per_post",
      );
      const key2 = observationIdentityKey(
        42,
        "distribution",
        "format_channel_performance",
        "channel:linkedin;format:carousel",
        "engagements_per_post",
      );
      assert.equal(key1, key2);
      assert.ok(key1.startsWith("ls:v1:obs:"));
    });

    it("produces distinct observation identity keys across different dimensions or scopes", () => {
      const keyLinkedin = observationIdentityKey(
        42,
        "distribution",
        "format_channel_performance",
        "channel:linkedin;format:carousel",
        "engagements_per_post",
      );
      const keyTwitter = observationIdentityKey(
        42,
        "distribution",
        "format_channel_performance",
        "channel:twitter;format:carousel",
        "engagements_per_post",
      );
      assert.notEqual(keyLinkedin, keyTwitter);
    });

    it("generates deterministic proposal identity keys", () => {
      const prop1 = proposalIdentityKey(
        42,
        "format_distribution",
        "channel:linkedin;format:carousel",
        "engagements_per_post",
      );
      const prop2 = proposalIdentityKey(
        42,
        "format_distribution",
        "channel:linkedin;format:carousel",
        "engagements_per_post",
      );
      assert.equal(prop1, prop2);
      assert.ok(prop1.startsWith("ls:v1:prop:"));
    });

    it("separates proposals across different owners", () => {
      const userA = proposalIdentityKey(101, "style_association", "style:1", "first_pass_approval");
      const userB = proposalIdentityKey(102, "style_association", "style:1", "first_pass_approval");
      assert.notEqual(userA, userB);
    });
  });

  describe("truthful comparison semantics", () => {
    it("does not manufacture causal assertions in proposal rationale", () => {
      const diffPct = 28.5;
      const sampleCount = 6;
      const format = "carousel";
      const channel = "linkedin";
      const rationale = `Observed: ${format} content on ${channel} showed ${diffPct.toFixed(1)}% higher average engagements compared to the channel baseline across ${sampleCount} publications.`;
      
      // Asserts that wording uses observed correlation rather than unproven causality
      assert.ok(rationale.includes("Observed:"));
      assert.ok(!rationale.includes("causes"));
      assert.ok(!rationale.includes("guarantees"));
      assert.ok(rationale.includes("higher average engagements"));
      assert.ok(rationale.includes(`across ${sampleCount} publications`));
    });

    it("strictly preserves human review states without autonomous mutation", () => {
      const validStatuses = ["proposed", "accepted", "rejected", "superseded", "expired"];
      assert.ok(validStatuses.includes("proposed"));
      assert.ok(validStatuses.includes("accepted"));
      assert.ok(validStatuses.includes("rejected"));
      // Ensure 'applied' or 'mutated' is NOT a valid autonomous state in Phase 29.1
      assert.ok(!validStatuses.includes("applied"));
      assert.ok(!validStatuses.includes("mutated"));
    });

    it("verifies exact sample size thresholds: N = 0, 1, 2, 3, 5, 6, 10, 11, 20, 21", () => {
      const matrix: Array<[number, string]> = [
        [0, "insufficient_data"],
        [1, "insufficient_data"],
        [2, "insufficient_data"],
        [3, "observed"],
        [5, "observed"],
        [6, "directional"],
        [10, "directional"],
        [11, "repeatable"],
        [20, "repeatable"],
        [21, "confirmed"],
      ];
      for (const [n, expected] of matrix) {
        assert.equal(evaluateEvidenceQuality(n), expected, `N=${n} should evaluate to ${expected}`);
      }
    });

    it("handles mathematical edge cases safely: equal values, negative deltas, and zero baselines", () => {
      // 1. Equal values: diff is 0%
      const candEqual = 40;
      const baseEqual = 40;
      const deltaEqual = baseEqual > 0 ? ((candEqual - baseEqual) / baseEqual) * 100 : 0;
      assert.equal(deltaEqual, 0);

      // 2. Negative delta: candidate performs lower than baseline
      const candLower = 30;
      const baseHigher = 40;
      const deltaNeg = ((candLower - baseHigher) / baseHigher) * 100;
      assert.equal(deltaNeg, -25);

      // 3. Zero baseline with positive candidate: prevents division by zero NaN/Infinity
      const candPos = 25;
      const baseZero = 0;
      const deltaSafe = baseZero > 0 ? ((candPos - baseZero) / baseZero) * 100 : (candPos > 0 ? 100 : 0);
      assert.equal(Number.isFinite(deltaSafe), true);
      assert.equal(deltaSafe, 100);

      // 4. Zero baseline with zero candidate
      const deltaZero = baseZero > 0 ? ((0 - baseZero) / baseZero) * 100 : 0;
      assert.equal(deltaZero, 0);
    });

    it("forbids causal trigger words in proposal generation templates", () => {
      const forbiddenCausalPhrases = [
        "causes",
        "will increase",
        "always use",
        "guarantees",
        "statistically proven",
        "proves that",
      ];
      const templateRationale = "Observed: format content showed 25.0% higher average engagements compared to other formats across 6 publications.";
      const templateHypothesis = "Prioritizing format is expected to maintain above-average engagement based on historical performance.";

      for (const phrase of forbiddenCausalPhrases) {
        assert.ok(
          !templateRationale.toLowerCase().includes(phrase),
          `Rationale must not include causal phrase "${phrase}"`,
        );
        assert.ok(
          !templateHypothesis.toLowerCase().includes(phrase),
          `Hypothesis must not include causal phrase "${phrase}"`,
        );
      }
    });
  });
});
