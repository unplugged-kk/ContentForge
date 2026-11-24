import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { determineContentType } from "./autopilot";

/**
 * Run 46 — the calendar declared three shapes and the system shipped one.
 *
 * Measured on the live pool before this fix:
 *   269 / 452 ideas carried `timeliness = "trending_now"`, and the old first
 *   branch (`suggestion === "hot_take" || timeliness === "trending_now"`) turned
 *   every one of them into `hot_take` before any other branch was consulted.
 *   75 / 84 published posts were hot_take (89.3%) while DAILY_SLOTS declares
 *   thread / tweet / long_thread for its three slots. The top 9 ranked ideas —
 *   exactly three days of calendar — were hot_take 9 of 9.
 *
 * These cases pin the two properties that were false:
 *   A. a declared slot shape is produced (it was unreachable)
 *   B. recency no longer overrules the declared slot
 * and hold the line on what must NOT change:
 *   C. the discoverer's own per-idea label still wins over the calendar
 *   D. the legacy behaviour survives when no slot is supplied
 */

const idea = (over: Record<string, unknown> = {}) =>
  ({
    id: 1,
    title: "A production story",
    description: "kubernetes incident",
    category: "sre",
    contentTypeSuggestion: "thread",
    timeliness: "evergreen",
    ...over,
  }) as any;

describe("determineContentType — the declared slot shape is reachable (run 46)", () => {
  it("A1 produces the shape the slot declares instead of hot_take", () => {
    // 269 live ideas look like this: trending_now, suggestion thread.
    const trending = idea({ timeliness: "trending_now", contentTypeSuggestion: "thread" });
    assert.equal(determineContentType(trending, { preferredType: "thread" }), "thread");
    assert.equal(determineContentType(trending, { preferredType: "tweet" }), "tweet");
    assert.equal(determineContentType(trending, { preferredType: "long_thread" }), "long_thread");
  });

  it("A2 all three declared shapes are producible from one trending idea", () => {
    const trending = idea({ timeliness: "trending_now", contentTypeSuggestion: "thread" });
    const produced = new Set(
      ["thread", "tweet", "long_thread"].map((p) =>
        determineContentType(trending, { preferredType: p }),
      ),
    );
    assert.equal(produced.size, 3, "the calendar's three shapes must all be reachable");
  });

  it("B1 recency no longer overrules the declared slot", () => {
    const trending = idea({ timeliness: "trending_now" });
    assert.equal(
      determineContentType(trending, { preferredType: "long_thread" }),
      "long_thread",
      "trending_now must not force hot_take when a slot shape is declared",
    );
  });
});

describe("determineContentType — what must NOT change (run 46)", () => {
  it("C1 the discoverer's own hot_take label still beats the calendar", () => {
    // A per-idea label about the content outranks the calendar's shape.
    assert.equal(
      determineContentType(idea({ contentTypeSuggestion: "hot_take" }), {
        preferredType: "long_thread",
      }),
      "hot_take",
    );
  });

  it("C2 an explicit article suggestion still wins", () => {
    assert.equal(
      determineContentType(idea({ contentTypeSuggestion: "article" }), {
        preferredType: "tweet",
      }),
      "article",
    );
  });

  it("C3 strong engagement signals still override the calendar", () => {
    // 150 comments with 3 angles is a real long-thread signal.
    assert.equal(
      determineContentType(idea({ contentTypeSuggestion: "thread" }), {
        commentCount: 150,
        contentAngles: ["a", "b", "c"],
        preferredType: "tweet",
      }),
      "long_thread",
    );
  });

  it("D1 with no slot supplied, trending_now still yields hot_take (legacy path)", () => {
    assert.equal(determineContentType(idea({ timeliness: "trending_now" })), "hot_take");
  });

  it("D2 with no slot and no signals, the default is thread", () => {
    assert.equal(determineContentType(idea()), "thread");
  });
});
