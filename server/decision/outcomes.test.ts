/**
 * Outcome attachment: only what was observed, and never at the cost of the
 * pipeline it hangs off.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachPublicationOutcome, summarizeObservedOutcome } from "./outcomes";
import type { DecisionLedgerPort } from "./ledger";

function fakeLedger() {
  const calls: Array<{ ref: unknown; actual: Record<string, unknown> }> = [];
  const port: DecisionLedgerPort = {
    async insert() {
      return { id: 1, decisionId: "dec" };
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
    async attachOutcomeByRef(ref, actual) {
      calls.push({ ref, actual });
      return 2;
    },
  };
  return { port, calls };
}

describe("summarizeObservedOutcome", () => {
  it("records observed metrics and never coerces unobserved ones to zero", () => {
    const outcome = summarizeObservedOutcome([
      { metric: "impressions", value: 184_200, availability: "observed" },
      { metric: "engagement_rate", value: 0.068, availability: "observed" },
      { metric: "followers_gained", value: null, availability: "not_available" },
    ]);
    assert.deepEqual(outcome.metrics, { impressions: 184_200, engagement_rate: 0.068 });
    assert.deepEqual(outcome.unavailableMetrics, ["followers_gained"]);
    assert.equal(outcome.observedCount, 2);
  });

  it("ignores non-finite values", () => {
    const outcome = summarizeObservedOutcome([
      { metric: "likes", value: Number.NaN, availability: "observed" },
      { metric: "saves", value: 12, availability: "observed" },
    ]);
    assert.deepEqual(outcome.metrics, { saves: 12 });
  });
});

describe("attachPublicationOutcome", () => {
  it("attaches the observed outcome to the decisions behind a publication", async () => {
    const { port, calls } = fakeLedger();
    const updated = await attachPublicationOutcome(42, {
      ledger: port,
      loadMetrics: async () => [
        { metric: "impressions", value: 9_000, availability: "observed" },
        { metric: "replies", value: 3, availability: "observed" },
      ],
    });

    assert.equal(updated, 2);
    assert.deepEqual(calls[0].ref, { publicationId: 42 });
    assert.deepEqual(calls[0].actual.metrics, { impressions: 9_000, replies: 3 });
  });

  it("does nothing when there are no metrics yet", async () => {
    const { port, calls } = fakeLedger();
    const updated = await attachPublicationOutcome(7, { ledger: port, loadMetrics: async () => [] });
    assert.equal(updated, 0);
    assert.equal(calls.length, 0);
  });

  it("does nothing when no ledger is wired", async () => {
    const updated = await attachPublicationOutcome(7, {
      ledger: null,
      loadMetrics: async () => [{ metric: "likes", value: 1, availability: "observed" }],
    });
    assert.equal(updated, 0);
  });

  it("never throws when the metrics read or the ledger write fails", async () => {
    const explodingRead = await attachPublicationOutcome(7, {
      ledger: fakeLedger().port,
      loadMetrics: async () => {
        throw new Error("metrics unavailable");
      },
    });
    assert.equal(explodingRead, 0, "a failed outcome read must not disturb the metrics pipeline");

    const explodingWrite = await attachPublicationOutcome(7, {
      ledger: {
        ...fakeLedger().port,
        async attachOutcomeByRef() {
          throw new Error("ledger down");
        },
      } as DecisionLedgerPort,
      loadMetrics: async () => [{ metric: "likes", value: 1, availability: "observed" }],
    });
    assert.equal(explodingWrite, 0);
  });
});
