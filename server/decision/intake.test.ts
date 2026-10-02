/**
 * Intake → triage mapping (pure). No Jev call, no network, no DB.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intakeSummary, pursued, toCandidates } from "./intake";
import type { TriagedCandidate } from "./jev";

describe("toCandidates", () => {
  it("maps heterogeneous item shapes and skips untitled items", () => {
    const out = toCandidates([
      { title: "Kubernetes 1.34", url: "https://example.com/a", source: "reddit", summary: "release" },
      { canonicalUrl: "https://example.com/b", excerpt: "an excerpt", ref: { kind: "hackernews" } },
      { text: "some long body text without a title" },
      { nothing: true },
    ]);
    assert.equal(out.length, 3);
    assert.equal(out[0].id, "https://example.com/a");
    assert.equal(out[0].title, "Kubernetes 1.34");
    assert.equal(out[1].source, "hackernews");
    assert.equal(out[1].summary, "an excerpt");
    assert.ok(out[2].title.startsWith("some long body"));
  });

  it("falls back to item-N for an id", () => {
    const out = toCandidates([{ title: "t" }]);
    assert.equal(out[0].id, "item-0");
  });
});

describe("intakeSummary / pursued", () => {
  const mk = (id: string, decision: TriagedCandidate["decision"]): TriagedCandidate => ({
    id,
    title: id,
    signals: {
      relevance_to_expertise: 0,
      reach_potential: 0,
      novelty: 0,
      timeliness: 0,
      contentworthiness: 0,
      needs_deep_research: 0,
    },
    score: 0,
    decision,
  });

  it("groups by decision", () => {
    const rows = [mk("a", "pursue"), mk("b", "drop"), mk("c", "watch"), mk("d", "pursue")];
    const s = intakeSummary(rows);
    assert.deepEqual(s, {
      considered: 4,
      pursued: 2,
      watched: 1,
      dropped: 1,
      pursue: ["a", "d"],
      watch: ["c"],
      drop: ["b"],
    });
    assert.deepEqual(pursued(rows).map((c) => c.id), ["a", "d"]);
  });
});
