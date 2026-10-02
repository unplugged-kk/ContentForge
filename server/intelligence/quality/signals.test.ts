/**
 * Quality signals: direction, not exact values.
 *
 * These tests pin the property each signal is supposed to capture — slop raises
 * the bad signals, concrete technical copy raises specificity, and format caps
 * are enforced — because the numbers themselves are heuristics.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeQualitySignals, qualitySignalRecord } from "./signals";

const GOOD = [
  "We cut idle Kubernetes nodes 40% by switching to Karpenter consolidation.",
  "The pod request defaults were the real problem: 2 vCPU requests on 200m workloads.",
  "Karpenter bin-packs on spot, so the autoscaler stops over-provisioning.",
].join("\n");

const SLOP = [
  "In today's fast-paced world, it's not just about technology, it's about transformation.",
  "Let's dive in — this game-changing approach unlocks the power of the cloud.",
  "Moreover, in the realm of modern infrastructure, we must delve into the tapestry.",
  "That being said, the future of platform engineering is bright.",
].join("\n");

const REPETITIVE = Array.from(
  { length: 6 },
  () => "Observability matters because observability matters for reliability.",
).join(" ");

describe("computeQualitySignals", () => {
  it("separates concrete technical copy from LLM boilerplate", () => {
    const good = computeQualitySignals({ text: GOOD, units: [GOOD], hook: GOOD.split("\n")[0], cta: "" });
    const slop = computeQualitySignals({ text: SLOP, units: [SLOP], hook: SLOP.split("\n")[0], cta: "" });

    assert.ok(good.specificity > slop.specificity, "technical copy must be more specific");
    assert.ok(slop.boilerplateDensity > good.boilerplateDensity, "filler must register as boilerplate");
    assert.ok(slop.flags.includes("boilerplate_heavy"));
  });

  it("registers repetition and duplicate units", () => {
    const repetitive = computeQualitySignals({
      text: REPETITIVE,
      units: [REPETITIVE],
      hook: "Observability matters",
      cta: "",
    });
    assert.ok(repetitive.repetition > 0.3);
    assert.ok(repetitive.flags.includes("repetitive"));

    const duplicated = computeQualitySignals({
      text: "one idea\ntwo idea",
      units: ["same unit", "same unit"],
      hook: "same unit",
      cta: "same unit",
    });
    assert.ok(duplicated.flags.includes("repetitive"));
  });

  it("registers hedging", () => {
    const hedgy = computeQualitySignals({
      text: "It might be that this could perhaps be somewhat risky, but it seems fine.",
      units: ["It might be that this could perhaps be somewhat risky, but it seems fine."],
      hook: "It might be",
      cta: "",
    });
    assert.ok(hedgy.hedgingDensity > 0.2);
  });

  it("enforces the format's character cap and unit bounds", () => {
    const over = computeQualitySignals(
      { text: "x".repeat(400), units: ["x".repeat(400)], hook: "x", cta: "" },
      { maxCharacters: 280, maxUnits: 1, minUnits: 1 },
    );
    assert.equal(over.overLimit, true);
    assert.ok(over.flags.includes("over_limit"));
    assert.ok(over.lengthFit <= 1 || over.overLimit);

    const thread = computeQualitySignals(
      { text: "a\nb", units: ["a", "b"], hook: "a", cta: "follow for more" },
      { maxCharacters: 280, minUnits: 3, maxUnits: 8, hookFirst: true, cta: true },
    );
    assert.ok(thread.flags.includes("too_few_units"));
    assert.equal(thread.hookPresent, true);
    assert.equal(thread.ctaPresent, true);
  });

  it("flags a missing hook and a missing CTA only when the profile asks for them", () => {
    const noHook = computeQualitySignals(
      { text: "body", units: ["body"], hook: "", cta: "" },
      { hookFirst: true, cta: true },
    );
    assert.equal(noHook.hookPresent, false);
    assert.equal(noHook.ctaPresent, false);
    assert.ok(noHook.flags.includes("no_hook"));
    assert.ok(noHook.flags.includes("missing_cta"));

    const relaxed = computeQualitySignals({ text: "body", units: ["body"], hook: "", cta: "" }, {});
    assert.equal(relaxed.hookPresent, false, "hook is reported honestly");
    assert.deepEqual(relaxed.flags, [], "but nothing is flagged when the profile is silent");
  });

  it("never returns a non-finite or out-of-range number", () => {
    const signals = computeQualitySignals({ text: "", units: [], hook: "", cta: "" });
    const record = qualitySignalRecord(signals);
    for (const [key, value] of Object.entries(record)) {
      assert.ok(Number.isFinite(value), `${key} must be finite`);
    }
    for (const key of ["repetition", "boilerplate", "hedging", "specificity", "length_fit"]) {
      assert.ok(record[key] >= 0 && record[key] <= 1, `${key} must be 0..1`);
    }
  });

  it("counts links and emoji", () => {
    const signals = computeQualitySignals({
      text: "Read https://example.com/a and https://example.com/b 🚀🚀 now.",
      units: ["Read https://example.com/a and https://example.com/b 🚀🚀 now."],
      hook: "Read this",
      cta: "",
    });
    assert.ok(signals.linkDensity > 0);
    assert.ok(signals.emojiDensity > 0);
  });
});
