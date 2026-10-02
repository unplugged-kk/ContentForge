/**
 * Extraction parsing (pure): bounds a model's claim JSON.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseClaimExtraction } from "./videoExtract";

describe("parseClaimExtraction", () => {
  it("parses claims, clamps confidence, normalizes risk", () => {
    const out = parseClaimExtraction(
      JSON.stringify({
        relevant: true,
        claims: [
          { claim: "Karpenter cuts node cost", confidence: 1.4, risk: "HIGH" },
          { claim: "Pods over-request CPU", confidence: 0.72, risk: "nonsense" },
        ],
      }),
    );
    assert.equal(out.relevant, true);
    assert.equal(out.claims.length, 2);
    assert.equal(out.claims[0].confidence, 1);
    assert.equal(out.claims[0].risk, "high");
    assert.equal(out.claims[1].risk, null);
  });

  it("treats irrelevant or empty extraction as no claims", () => {
    assert.deepEqual(parseClaimExtraction(JSON.stringify({ relevant: false, claims: [{ claim: "x" }] })), {
      relevant: false,
      claims: [],
    });
    assert.deepEqual(parseClaimExtraction("not json at all"), { relevant: false, claims: [] });
    assert.deepEqual(parseClaimExtraction(JSON.stringify({ relevant: true, claims: [] })), {
      relevant: false,
      claims: [],
    });
  });

  it("caps at 5 claims and drops blanks", () => {
    const claims = Array.from({ length: 9 }, (_, i) => ({ claim: `c${i}`, confidence: 0.5 }));
    claims.push({ claim: "   ", confidence: 0.9 } as any);
    const out = parseClaimExtraction(JSON.stringify({ relevant: true, claims }));
    assert.equal(out.claims.length, 5);
    assert.ok(out.claims.every((c) => c.claim.trim().length > 0));
  });

  it("recovers JSON wrapped in prose", () => {
    const out = parseClaimExtraction('Here you go:\n{"relevant":true,"claims":[{"claim":"a fact","confidence":0.5}]}\nDone.');
    assert.equal(out.claims.length, 1);
    assert.equal(out.claims[0].claim, "a fact");
  });
});
