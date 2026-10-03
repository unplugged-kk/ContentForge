/**
 * The framing adapter: policy targets in, a narrowed subset out, nothing invented.
 *
 * The decision's own logic (and Jev's verified `choice` contract) moved to
 * `decision/decisions/format.ts` and is covered in `decision/engine.test.ts`.
 * These tests pin this boundary: what the adapter sends, what it does with the
 * answer, and that it can never widen a policy's allowed set.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJevFraming } from "./framing";
import { matchFormat } from "../decision/decisions/format";
import type { DecisionResult, FormatSelectDecision } from "../decision/schemas";

const TARGETS = [
  { channel: "x", format: "x_post" },
  { channel: "x", format: "x_thread" },
  { channel: "linkedin", format: "linkedin_post" },
];

function engineReturning(kept: Array<{ channel: string; format: string }>, fallback = false) {
  const calls: Array<Record<string, any>> = [];
  const run = (async (input: Record<string, any>) => {
    calls.push(input);
    return {
      decision: { kept },
      reasons: ["test"],
      policyId: "format-select",
      policyVersion: "v1",
      decisionType: "format_select",
      fallback,
      level: "soft",
    } satisfies DecisionResult<FormatSelectDecision>;
  }) as never;
  return { run, calls };
}

describe("matchFormat (choice → allowed format)", () => {
  it("matches exactly, case-insensitively, and by containment", () => {
    assert.equal(matchFormat("x_post", ["x_post", "x_thread"]), "x_post");
    assert.equal(matchFormat("X_THREAD", ["x_post", "x_thread"]), "x_thread");
    assert.equal(matchFormat("I would pick x_thread here.", ["x_post", "x_thread"]), "x_thread");
    assert.equal(matchFormat("linkedin_post", ["x_post", "x_thread"]), null);
    assert.equal(matchFormat("", ["x_post"]), null);
  });
});

describe("createJevFraming", () => {
  it("sends the allowed pairs and the story, and returns the narrowed subset", async () => {
    const { run, calls } = engineReturning([
      { channel: "x", format: "x_thread" },
      { channel: "linkedin", format: "linkedin_post" },
    ]);
    const framing = createJevFraming({ decide: run });

    const kept = await framing.selectTargets({
      storyTitle: "Cost story",
      insightBody: "Idle nodes trace to pod requests.",
      targets: TARGETS,
      runId: 9,
      userId: 4,
    });

    assert.deepEqual(kept, [
      { channel: "x", format: "x_thread" },
      { channel: "linkedin", format: "linkedin_post" },
    ]);
    assert.equal(calls[0].type, "format_select");
    assert.deepEqual(calls[0].refs, { automationRunId: 9 });
    assert.equal(calls[0].userId, 4, "the decision is owner-attributable");
    assert.deepEqual(calls[0].state.targets, TARGETS);
    assert.equal(calls[0].state.topic.title, "Cost story");
  });

  it("cannot keep a pair the policy never allowed", async () => {
    // A decision claiming an unpermitted pair is filtered out by the adapter.
    const { run } = engineReturning([{ channel: "x", format: "x_article" }]);
    const framing = createJevFraming({ decide: run });
    const kept = await framing.selectTargets({
      storyTitle: "t",
      insightBody: "b",
      targets: TARGETS,
    });
    assert.equal(kept, null, "nothing allowed survived ⇒ the caller keeps its own set");
  });

  it("does not spend a call when no channel offers a choice", async () => {
    const { run, calls } = engineReturning(TARGETS);
    const framing = createJevFraming({ decide: run });
    const kept = await framing.selectTargets({
      storyTitle: "t",
      insightBody: "b",
      targets: [{ channel: "x", format: "x_post" }],
    });
    assert.equal(kept, null);
    assert.equal(calls.length, 0);
  });

  it("returns the policy's targets untouched when the engine falls back", async () => {
    const { run } = engineReturning(TARGETS, true);
    const framing = createJevFraming({ decide: run });
    const kept = await framing.selectTargets({
      storyTitle: "t",
      insightBody: "b",
      targets: TARGETS,
    });
    assert.deepEqual(kept, TARGETS);
  });

  it("deduplicates the policy's pairs before deciding", async () => {
    const { run, calls } = engineReturning(TARGETS);
    const framing = createJevFraming({ decide: run });
    await framing.selectTargets({
      storyTitle: "t",
      insightBody: "b",
      targets: [...TARGETS, { channel: "x", format: "x_post" }, { channel: "x", format: "x_thread" }],
    });
    assert.equal(calls[0].state.targets.length, 3);
  });
});
