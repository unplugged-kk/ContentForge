/**
 * Jev decision layer — pure functions + one HTTP round-trip against a local
 * double. No database, no network, no key required.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  buildTriageQuestions,
  composeOpportunityScore,
  decideTriage,
  DEFAULT_OPPORTUNITY_WEIGHTS,
  parseJevResponse,
  TRIAGE_SIGNAL_KEYS,
  triageCandidates,
  triageScore,
  type TriageSignals,
} from "./jev";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const signals = (over: Partial<TriageSignals> = {}): TriageSignals => ({
  relevance_to_expertise: 0.9,
  reach_potential: 0.9,
  novelty: 0.9,
  timeliness: 0.9,
  contentworthiness: 0.9,
  needs_deep_research: 0.6,
  ...over,
});

describe("jev parsing", () => {
  it("accepts noul/choice/score answers", () => {
    const r = parseJevResponse({
      model: "jev-1.13.0",
      answers: {
        a: { type: "noul", noul: 0.95 },
        b: { type: "choice", choice: "billing", probabilities: { billing: 0.9, x: 0.1 }, confidence: 0.8 },
        c: { type: "score", score: 1.05, legend: { "0": "Calm", "1": "Frustrated" }, probabilities: { "1": 0.95 }, confidence: 0.9 },
      },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    assert.equal(r.answers.a.type, "noul");
    assert.equal(r.usage.input_tokens, 10);
  });

  it("rejects a malformed answer", () => {
    assert.throws(() => parseJevResponse({ answers: { a: { type: "noul" } } }), /JEV_BAD_ANSWER/);
    assert.throws(() => parseJevResponse({ answers: { a: { type: "bogus", x: 1 } } }), /JEV_BAD_ANSWER/);
    assert.throws(() => parseJevResponse(null), /JEV_INVALID_RESPONSE/);
    assert.equal(Object.keys(parseJevResponse({ answers: {} }).answers).length, 0);
  });
});

describe("jev triage questions", () => {
  it("builds one noul question per signal", () => {
    const q = buildTriageQuestions();
    for (const key of TRIAGE_SIGNAL_KEYS) assert.equal(q[key].type, "noul");
  });
});

describe("triage decisions (pure)", () => {
  it("composes a weighted score and decides", () => {
    const strong = signals();
    assert.equal(decideTriage(strong), "pursue");
    assert.equal(decideTriage(signals({ relevance_to_expertise: 0.4, reach_potential: 0.4, novelty: 0.4, timeliness: 0.4, contentworthiness: 0.4 })), "drop");
    const mid = signals({ relevance_to_expertise: 0.6, reach_potential: 0.6, novelty: 0.5, timeliness: 0.5, contentworthiness: 0.6 });
    assert.equal(decideTriage(mid), "watch");
    assert.ok(triageScore(strong) > triageScore(mid));
  });

  it("honours env thresholds", () => {
    withEnv({ JEV_TRIAGE_PURSUE: "0.99", JEV_TRIAGE_WATCH: "0.98" }, () => {
      assert.notEqual(decideTriage(signals()), "pursue");
    });
  });
});

describe("opportunity score composition (pure)", () => {
  it("weights signals and normalizes over present ones", () => {
    const full = composeOpportunityScore({
      audience_relevance: 1,
      novelty: 1,
      timeliness: 1,
      practitioner_value: 1,
      discussion_potential: 1,
      differentiation: 1,
    });
    assert.equal(full, 1);
    // missing signals are ignored, not treated as zero
    const partial = composeOpportunityScore({ audience_relevance: 1 });
    assert.equal(partial, 1);
    assert.equal(composeOpportunityScore({}), 0);
    assert.equal(Object.values(DEFAULT_OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0), 1);
  });
});

function startJevDouble() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const answers: Record<string, unknown> = {};
      for (const key of Object.keys(body.questions ?? {})) {
        const signal = String(key).split("__")[1] ?? "";
        const value = signal === "needs_deep_research" ? 0.55 : signal === "timeliness" ? 0.4 : 0.9;
        answers[key] = { type: "noul", noul: value };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "jev-double", answers, usage: { input_tokens: 12, output_tokens: 8 } }));
    });
  });
  return {
    start: () => new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port))),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("triageCandidates (HTTP double)", () => {
  const dbl = startJevDouble();
  let saved: Record<string, string | undefined> = {};

  before(async () => {
    const port = await dbl.start();
    saved = {
      TYPESAFE_TRANSPORT: process.env.TYPESAFE_TRANSPORT,
      TYPESAFE_BASE_URL: process.env.TYPESAFE_BASE_URL,
      TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
    };
    process.env.TYPESAFE_TRANSPORT = "api";
    process.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.TYPESAFE_API_KEY = "test-key";
  });

  after(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await dbl.stop();
  });

  it("returns signals and decisions for each candidate in one request", async () => {
    const out = await triageCandidates(
      [
        { id: "1", title: "Kubernetes 1.34 release", summary: "new K8s version" },
        { id: "2", title: "Random AI funding news" },
      ],
      { expertise: "platform engineering", audience: "SREs" },
    );
    assert.equal(out.length, 2);
    for (const c of out) {
      for (const key of TRIAGE_SIGNAL_KEYS) assert.equal(typeof c.signals[key], "number");
    }
    assert.equal(out[0].decision, "pursue");
    assert.ok(out[0].score > 0);
  });

  it("returns [] for no candidates without calling Jev", async () => {
    assert.deepEqual(await triageCandidates([]), []);
  });

  it("throws a clear error when no transport is configured", async () => {
    await withEnvAsync({ TYPESAFE_TRANSPORT: "api", TYPESAFE_API_KEY: undefined }, async () => {
      await assert.rejects(() => triageCandidates([{ id: "x", title: "t" }]), /TYPESAFE_CONFIG_MISSING/);
    });
  });
});

async function withEnvAsync<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
