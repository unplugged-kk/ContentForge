/**
 * Shadow mode: computing a decision never changes behaviour, and agreement is
 * measurable against a golden set (the prerequisite for the legacy migrations).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agreementRate, shadowDecide } from "./shadow";
import type { DecisionLedgerEntry, DecisionLedgerPort } from "./ledger";
import type { TriageDecision } from "./schemas";

function fakeLedger() {
  const entries: DecisionLedgerEntry[] = [];
  const port: DecisionLedgerPort = {
    async insert(entry) {
      entries.push(entry);
      return { id: entries.length, decisionId: entry.decisionId };
    },
    async get() {
      return undefined;
    },
    async list() {
      return [];
    },
    async attachOutcome() {
      return undefined;
    },
    async attachOutcomeByRef() {
      return 0;
    },
  };
  return { port, entries };
}

const CANDIDATES = [{ id: "s0", title: "one" }, { id: "s1", title: "two" }];

describe("shadowDecide", () => {
  it("records the decision without the caller acting on it", async () => {
    const { port, entries } = fakeLedger();
    const result = await shadowDecide<TriageDecision>(
      { type: "research_triage", state: { candidates: CANDIDATES } },
      {
        enabled: () => false, // shadow runs even when the boundary is off
        configured: () => true,
        ledger: port,
      },
    );

    assert.equal(result.fallback, true, "engine disabled ⇒ the declared fallback");
    assert.deepEqual(result.decision.keep, [0, 1]);
    assert.equal(entries.length, 1, "the shadow run is still recorded");
    assert.equal(entries[0].decisionType, "research_triage");
    assert.equal(entries[0].fallback, true);
  });
});

describe("agreementRate", () => {
  it("is 1 for identical sets, 0 for disjoint, and Jaccard in between", () => {
    assert.equal(agreementRate([0, 1], [0, 1]), 1);
    assert.equal(agreementRate([0, 1], [2, 3]), 0);
    assert.equal(agreementRate([0, 1], [1, 2]), 0.3333);
    assert.equal(agreementRate([], []), 1);
    assert.equal(agreementRate([0], []), 0);
  });
});
