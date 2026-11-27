import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditArtifactClaims, computeParaphraseOverlap } from "./claimCheck";

describe("claim & paraphrase checker (INC-07)", () => {
  it("supports grounded numeric claims tied to supplied evidence", () => {
    const result = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      researchJobId: 7,
      payload: {
        text: "Postgres 18 async IO boosted sequential scans by 28% on NVMe benchmarks in 2026.",
      },
      evidence: [
        {
          id: 11,
          text: "Postgres 18 beta benchmarks in 2026 recorded 28% higher sequential scan throughput on NVMe.",
        },
      ],
    });

    assert.equal(result.kind, "claim_evidence_v1");
    assert.equal(result.researchJobId, 7);
    assert.deepEqual(result.evidenceIds, [11]);
    assert.equal(result.unsupportedCount, 0);
    assert.ok(result.claims.some((c) => c.status === "supported" && c.evidenceIds.includes(11)));
    assert.equal(result.qualityFlags.includes("paraphrase_heavy"), false);
    assert.equal(result.qualityFlags.includes("ungrounded_first_person"), false);
  });

  it("flags uncited percentages, currency, and latency metrics as unsupported", () => {
    const result = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      payload: {
        text: "Switching to Iceberg v3 cut query latency to 42ms and saved $1.2M per year with a 47% cost drop.",
      },
      evidence: [
        {
          id: 21,
          text: "Apache Iceberg v3 introduces binary deletion vectors to reduce read amplification.",
        },
      ],
    });

    assert.ok(result.unsupportedCount >= 1);
    const unsupported = result.claims.find((c) => c.status === "unsupported");
    assert.ok(unsupported);
    assert.match(unsupported!.reason ?? "", /uncited metric\/number/i);
  });

  it("strips fabricated model evidenceIds and downgrades to unsupported", () => {
    const result = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      payload: { text: "Deletion vectors avoid rewriting full parquet files." },
      evidence: [{ id: 5, text: "Deletion vectors avoid rewriting data files." }],
      modelClaims: [
        {
          unitIndex: 0,
          claimText: "Deletion vectors avoid rewriting full parquet files.",
          evidenceIds: [99999],
          status: "supported",
        },
      ],
    });

    assert.equal(result.unsupportedCount, 1);
    assert.deepEqual(result.claims[0].evidenceIds, []);
    assert.equal(result.claims[0].status, "unsupported");
    assert.match(result.claims[0].reason ?? "", /fabricated/i);
  });

  it("flags ungrounded first-person war stories when creatorNotes is absent, and allows them when grounded", () => {
    const ungrounded = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      payload: {
        text: "In our production outage last month, we migrated PgBouncer and cut latency by 65%.",
      },
      evidence: [{ id: 1, text: "PgBouncer pools database connections efficiently." }],
    });

    assert.ok(ungrounded.qualityFlags.includes("ungrounded_first_person"));
    assert.ok(ungrounded.unsupportedCount >= 1);

    const grounded = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      payload: {
        text: "In our production outage, we migrated PgBouncer and cut latency by 65%.",
      },
      evidence: [{ id: 1, text: "PgBouncer pools database connections efficiently." }],
      creatorNotes: "During our production outage we migrated PgBouncer and measured a 65% latency reduction.",
    });

    assert.equal(grounded.qualityFlags.includes("ungrounded_first_person"), false);
    assert.equal(grounded.unsupportedCount, 0);
  });

  it("flags paraphrase_heavy when 4-gram Jaccard overlap reaches 0.35", () => {
    const sourceText =
      "Kubernetes scheduler plugins moved from alpha to stable so platform teams can enforce custom placement policies across clusters.";
    const overlap = computeParaphraseOverlap(sourceText, [{ id: 3, text: sourceText }]);
    assert.equal(overlap, 1);

    const result = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      payload: { text: sourceText },
      evidence: [{ id: 3, text: sourceText }],
    });
    assert.ok(result.paraphraseOverlap >= 0.35);
    assert.ok(result.qualityFlags.includes("paraphrase_heavy"));
  });

  it("checks x_thread units individually against per-unit budgets rather than whole-thread length", () => {
    const okThread = auditArtifactClaims({
      format: "x_thread",
      channel: "x",
      payload: {
        units: [
          "Unit one explains Iceberg deletion vectors clearly in under 200 characters.",
          "Unit two covers compaction cadence and file-size targets cleanly.",
          "Unit three wraps with a concrete takeaway — share your experience in replies.",
        ],
      },
      evidence: [{ id: 1, text: "Iceberg deletion vectors and compaction cadence." }],
    });
    assert.equal(okThread.qualityFlags.includes("over_limit"), false);

    const overThread = auditArtifactClaims({
      format: "x_thread",
      channel: "x",
      payload: {
        units: [
          "x".repeat(278),
          "Short follow-up unit. Reply with thoughts.",
        ],
      },
      evidence: [{ id: 1, text: "Some evidence." }],
    });
    assert.equal(overThread.qualityFlags.includes("over_limit"), true);
  });
});
