/**
 * Jev framing (pure): question construction and answer mapping. No network.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFramingQuestions, matchFormat, selectFramedTargets } from "./framing";

const story = {
  storyTitle: "Cost: Karpenter consolidation",
  insightBody: "Evidence: bin-packing cut idle nodes 40%.",
  targets: [
    { format: "x_post", channel: "x" },
    { format: "x_thread", channel: "x" },
    { format: "linkedin_post", channel: "linkedin" },
  ],
};

describe("buildFramingQuestions", () => {
  it("asks only channels that actually have a choice", () => {
    const q = buildFramingQuestions(story);
    assert.deepEqual(Object.keys(q), ["ch0"]);
    // Jev's contract: instructions is a STRING, criteria is an OBJECT whose keys
    // are the candidate answers (verified against the live API).
    assert.equal(typeof q.ch0.instructions, "string");
    assert.deepEqual(Object.keys(q.ch0.criteria as object), ["x_post", "x_thread"]);
    assert.match(q.ch0.instructions as string, /x_thread|exactly one/);
  });

  it("asks nothing when every channel has a single format", () => {
    const q = buildFramingQuestions({
      ...story,
      targets: [{ format: "x_post", channel: "x" }],
    });
    assert.deepEqual(Object.keys(q), []);
  });
});

describe("matchFormat", () => {
  it("matches exactly, case-insensitively, and by containment", () => {
    assert.equal(matchFormat("x_post", ["x_post", "x_thread"]), "x_post");
    assert.equal(matchFormat("X_THREAD", ["x_post", "x_thread"]), "x_thread");
    assert.equal(matchFormat("I would pick x_thread here.", ["x_post", "x_thread"]), "x_thread");
    assert.equal(matchFormat("linkedin_post", ["x_post", "x_thread"]), null);
    assert.equal(matchFormat("", ["x_post"]), null);
  });
});

describe("selectFramedTargets", () => {
  it("narrows only the channels Jev spoke about", () => {
    const kept = selectFramedTargets(story, { ch0: { type: "choice", choice: "x_thread" } });
    assert.deepEqual(kept, [
      { format: "x_thread", channel: "x" },
      { format: "linkedin_post", channel: "linkedin" },
    ]);
  });

  it("returns null when nothing usable came back, so the policy set stands", () => {
    assert.equal(selectFramedTargets(story, {}), null);
    assert.equal(selectFramedTargets(story, { ch0: { type: "choice", choice: "nonsense" } }), null);
    assert.equal(selectFramedTargets(story, { ch0: { type: "noul", choice: "x_post" } }), null);
  });

  it("never invents a pair that is not in the policy", () => {
    const kept = selectFramedTargets(story, { ch0: { type: "choice", choice: "x_post" } });
    assert.deepEqual(kept, [
      { format: "x_post", channel: "x" },
      { format: "linkedin_post", channel: "linkedin" },
    ]);
  });
});
