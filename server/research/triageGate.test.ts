/**
 * Jev triage gate — now a thin adapter over the decision engine.
 *
 * These tests inject the engine entry point, so they need no env, network or DB,
 * and they pin the two behaviours that changed when the gate stopped carrying its
 * own policy: `watch` candidates now survive, and the decision is attributable to
 * a research job.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedSource } from "./contracts";
import type { DecisionResult, TriageDecision } from "../decision/schemas";
import { candidatesFromSources, createJevTriageGate } from "./triageGate";

const src = (n: number): NormalizedSource =>
  ({
    ref: { provider: "last30days", kind: "reddit", nativeId: `n${n}`, canonicalUrl: `https://ex/${n}` },
    provider: "last30days",
    canonicalUrl: `https://ex/${n}`,
    title: `item ${n}`,
    excerpt: `excerpt ${n}`,
  }) as unknown as NormalizedSource;

function engineReturning(decision: TriageDecision, fallback = false) {
  const calls: Array<Record<string, any>> = [];
  const run = (async (input: Record<string, any>) => {
    calls.push(input);
    return {
      decision,
      reasons: ["test"],
      policyId: "research-triage",
      policyVersion: "v1",
      decisionType: "research_triage",
      fallback,
      level: "soft",
    } satisfies DecisionResult<TriageDecision>;
  }) as never;
  return { run, calls };
}

const keep = (indices: number[], total: number): TriageDecision => ({
  action: indices.length > 0 ? "proceed" : "skip",
  keep: indices,
  drop: Array.from({ length: total }, (_v, i) => i).filter((i) => !indices.includes(i)),
  perCandidate: [],
});

function jenv() {
  const saved = { k: process.env.TYPESAFE_API_KEY, t: process.env.TYPESAFE_TRANSPORT };
  process.env.TYPESAFE_TRANSPORT = "api";
  process.env.TYPESAFE_API_KEY = "test-key";
  return () => {
    if (saved.k === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved.k;
    if (saved.t === undefined) delete process.env.TYPESAFE_TRANSPORT;
    else process.env.TYPESAFE_TRANSPORT = saved.t;
  };
}

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

describe("createJevTriageGate", () => {
  it("keeps exactly the indices the decision keeps, by position", async () => {
    const restore = jenv();
    try {
      const { run } = engineReturning(keep([0, 2], 3));
      const gate = createJevTriageGate({ decide: run });
      const out = await gate.gate([src(0), src(1), src(2)], { query: "k8s" });
      assert.ok(out);
      assert.deepEqual(out!.kept.map((s) => s.canonicalUrl), ["https://ex/0", "https://ex/2"]);
      assert.deepEqual(out!.dropped.map((s) => s.canonicalUrl), ["https://ex/1"]);
    } finally {
      restore();
    }
  });

  it("keeps watch candidates, not only pursue (the old gate discarded them)", async () => {
    const restore = jenv();
    try {
      // The engine's policy keeps pursue AND watch, so both indices survive.
      const { run } = engineReturning(keep([0, 1], 3));
      const gate = createJevTriageGate({ decide: run });
      const out = await gate.gate([src(0), src(1), src(2)], {});
      assert.ok(out);
      assert.deepEqual(out!.kept.map((s) => s.canonicalUrl), ["https://ex/0", "https://ex/1"]);
    } finally {
      restore();
    }
  });

  it("attributes the decision to the research job and its owner", async () => {
    const restore = jenv();
    try {
      const { run, calls } = engineReturning(keep([0], 1));
      const gate = createJevTriageGate({ decide: run });
      await gate.gate([src(0)], { query: "k8s", jobId: 42, userId: 7 });
      assert.equal(calls[0].type, "research_triage");
      assert.deepEqual(calls[0].refs, { researchJobId: 42 });
      assert.equal(calls[0].userId, 7, "the decision is owner-attributable");
      assert.equal(calls[0].state.candidates.length, 1);
    } finally {
      restore();
    }
  });

  it("keeps everything when the engine returns its fail-open fallback", async () => {
    const restore = jenv();
    try {
      const { run } = engineReturning(keep([0, 1], 2), true);
      const gate = createJevTriageGate({ decide: run });
      const out = await gate.gate([src(0), src(1)], {});
      assert.ok(out);
      assert.equal(out!.kept.length, 2);
      assert.equal(out!.dropped.length, 0);
    } finally {
      restore();
    }
  });

  it("returns null (fail-open, no call) when Jev is not configured", async () => {
    const saved = { k: process.env.TYPESAFE_API_KEY, t: process.env.TYPESAFE_TRANSPORT, e: process.env.JEV_CLI_ENABLED };
    delete process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_TRANSPORT = "api";
    delete process.env.JEV_CLI_ENABLED;
    try {
      const { run, calls } = engineReturning(keep([0], 1));
      const gate = createJevTriageGate({ decide: run });
      assert.equal(await gate.gate([src(0)], {}), null);
      assert.equal(calls.length, 0, "no decision is attempted without a configured model");
    } finally {
      if (saved.k === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = saved.k;
      if (saved.t === undefined) delete process.env.TYPESAFE_TRANSPORT;
      else process.env.TYPESAFE_TRANSPORT = saved.t;
      if (saved.e === undefined) delete process.env.JEV_CLI_ENABLED;
      else process.env.JEV_CLI_ENABLED = saved.e;
    }
  });
});
