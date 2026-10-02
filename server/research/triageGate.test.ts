/**
 * Jev triage gate — policy + source mapping, with an injected triage fn
 * (no Jev call, no network, no DB).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedSource } from "./contracts";
import type { TriagedCandidate } from "../decision/jev";
import { candidatesFromSources, createJevTriageGate, selectForResearch } from "./triageGate";

const src = (n: number): NormalizedSource =>
  ({
    ref: { provider: "last30days", kind: "reddit", nativeId: `n${n}`, canonicalUrl: `https://ex/${n}` },
    provider: "last30days",
    canonicalUrl: `https://ex/${n}`,
    title: `item ${n}`,
    excerpt: `excerpt ${n}`,
  }) as unknown as NormalizedSource;

const triaged = (id: string, decision: TriagedCandidate["decision"]): TriagedCandidate => ({
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

describe("candidatesFromSources", () => {
  it("maps 1:1 with index ids and source metadata", () => {
    const c = candidatesFromSources([src(0), src(1)]);
    assert.equal(c.length, 2);
    assert.equal(c[0].id, "s0");
    assert.equal(c[1].id, "s1");
    assert.equal(c[0].source, "reddit");
    assert.equal(c[0].url, "https://ex/0");
  });
});

describe("selectForResearch (policy)", () => {
  it("prefers pursue, falls back to watch, else nothing", () => {
    assert.deepEqual(selectForResearch([triaged("s0", "drop"), triaged("s1", "pursue")]).map((c) => c.id), ["s1"]);
    assert.deepEqual(selectForResearch([triaged("s0", "watch"), triaged("s1", "drop")]).map((c) => c.id), ["s0"]);
    assert.deepEqual(selectForResearch([triaged("s0", "drop")]), []);
  });
});

describe("createJevTriageGate", () => {
  it("keeps pursue sources and drops the rest", async () => {
    const saved = { k: process.env.TYPESAFE_API_KEY, t: process.env.TYPESAFE_TRANSPORT };
    process.env.TYPESAFE_TRANSPORT = "api";
    process.env.TYPESAFE_API_KEY = "test-key";
    try {
      const gate = createJevTriageGate({
        triage: async () => [triaged("s0", "pursue"), triaged("s1", "drop"), triaged("s2", "pursue")],
      });
      const out = await gate.gate([src(0), src(1), src(2)], { query: "k8s" });
      assert.ok(out);
      assert.deepEqual(out!.kept.map((s) => s.canonicalUrl), ["https://ex/0", "https://ex/2"]);
      assert.deepEqual(out!.dropped.map((s) => s.canonicalUrl), ["https://ex/1"]);
    } finally {
      if (saved.k === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = saved.k;
      if (saved.t === undefined) delete process.env.TYPESAFE_TRANSPORT; else process.env.TYPESAFE_TRANSPORT = saved.t;
    }
  });

  it("returns null (fail-open) when Jev is not configured", async () => {
    const saved = { k: process.env.TYPESAFE_API_KEY, t: process.env.TYPESAFE_TRANSPORT, e: process.env.JEV_CLI_ENABLED };
    delete process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_TRANSPORT = "api";
    delete process.env.JEV_CLI_ENABLED;
    try {
      const gate = createJevTriageGate({ triage: async () => [triaged("s0", "pursue")] });
      assert.equal(await gate.gate([src(0)], {}), null);
    } finally {
      if (saved.k === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = saved.k;
      if (saved.t === undefined) delete process.env.TYPESAFE_TRANSPORT; else process.env.TYPESAFE_TRANSPORT = saved.t;
      if (saved.e === undefined) delete process.env.JEV_CLI_ENABLED; else process.env.JEV_CLI_ENABLED = saved.e;
    }
  });
});
