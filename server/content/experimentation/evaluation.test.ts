/**
 * Unit tests for experiment evaluation engine (Phase 29.2).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  determineRecommendedDecision,
  generateEvaluationSummary,
  type GuardrailResult,
} from "./evaluation";

describe("experiment recommendation logic (Phase 29.2)", () => {
  const passedGuardrails: GuardrailResult[] = [
    {
      metric: "publication_failure_rate (variant_a)",
      controlValue: "0.0%",
      variantValue: "0.0%",
      differencePercentage: "0.0%",
      status: "passed",
    },
  ];

  const regressedGuardrails: GuardrailResult[] = [
    {
      metric: "publication_failure_rate (variant_a)",
      controlValue: "0.0%",
      variantValue: "25.0%",
      differencePercentage: "25.0%",
      status: "regressed",
    },
  ];

  it("recommends guardrail_failed whenever a guardrail metric regressed, even if primary metric improved", () => {
    // Primary metric improved 50%, but guardrail regressed
    const decision = determineRecommendedDecision(50.0, "repeatable", regressedGuardrails);
    assert.equal(decision, "guardrail_failed");
  });

  it("recommends inconclusive when sample size is insufficient", () => {
    const decision = determineRecommendedDecision(45.0, "insufficient_data", passedGuardrails);
    assert.equal(decision, "inconclusive");
  });

  it("recommends inconclusive when difference is null", () => {
    const decision = determineRecommendedDecision(null, "observed", passedGuardrails);
    assert.equal(decision, "inconclusive");
  });

  it("recommends variant_preferred when delta >= 10% and evidence is directional or better", () => {
    const decDirectional = determineRecommendedDecision(15.2, "directional", passedGuardrails);
    assert.equal(decDirectional, "variant_preferred");

    const decRepeatable = determineRecommendedDecision(12.0, "repeatable", passedGuardrails);
    assert.equal(decRepeatable, "variant_preferred");

    const decConfirmed = determineRecommendedDecision(10.5, "confirmed", passedGuardrails);
    assert.equal(decConfirmed, "variant_preferred");
  });

  it("recommends variant_promising when delta >= 10% but evidence is only observed (3-5 samples)", () => {
    const decObserved = determineRecommendedDecision(15.2, "observed", passedGuardrails);
    assert.equal(decObserved, "variant_promising");
  });

  it("recommends variant_promising when delta is between 5% and 10%", () => {
    const decision = determineRecommendedDecision(7.5, "observed", passedGuardrails);
    assert.equal(decision, "variant_promising");
  });

  it("recommends control_preferred when variant regressed by 5% or more", () => {
    const decision = determineRecommendedDecision(-12.0, "observed", passedGuardrails);
    assert.equal(decision, "control_preferred");
  });

  it("recommends inconclusive when difference is flat (-5% to +5%)", () => {
    const decision1 = determineRecommendedDecision(2.1, "observed", passedGuardrails);
    assert.equal(decision1, "inconclusive");

    const decision2 = determineRecommendedDecision(-1.5, "directional", passedGuardrails);
    assert.equal(decision2, "inconclusive");
  });
});

describe("non-causal evaluation summary generation (Phase 29.2)", () => {
  it("generates honest non-causal language without causal claims", () => {
    const summary = generateEvaluationSummary(
      "Format Engagement Test",
      "Control (post)",
      "variant_carousel",
      "engagements_per_post",
      { sampleCount: 4, measuredCount: 4, mean: "20.00", availability: "observed" },
      {
        variantId: 2,
        variantKey: "variant_carousel",
        sampleCount: 4,
        measuredCount: 4,
        mean: "35.00",
        difference: "15.00",
        differencePercentage: "75.0",
        availability: "observed",
      },
      "observed",
      "variant_promising",
    );

    assert.match(summary, /Under controlled assignment/);
    assert.match(summary, /observed higher \(\+75\.0%\) average engagements_per_post/);
    assert.match(summary, /variant_promising/);

    // Rule: Never claim causation
    assert.doesNotMatch(summary, /caused/i);
    assert.doesNotMatch(summary, /guaranteed/i);
    assert.doesNotMatch(summary, /optimized/i);
  });

  it("reports guardrail failure clearly in summary", () => {
    const summary = generateEvaluationSummary(
      "Format Engagement Test",
      "Control",
      "variant_b",
      "likes",
      { sampleCount: 3, measuredCount: 3, mean: "10.00", availability: "observed" },
      {
        variantId: 2,
        variantKey: "variant_b",
        sampleCount: 3,
        measuredCount: 3,
        mean: "20.00",
        difference: "10.00",
        differencePercentage: "100.0",
        availability: "observed",
      },
      "observed",
      "guardrail_failed",
    );

    assert.match(summary, /guardrail regressions/i);
    assert.match(summary, /guardrail_failed/i);
  });
});
