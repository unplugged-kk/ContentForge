/**
 * Offline Golden-Set Evaluation Suite (INC-07).
 *
 * Evaluates 8 labelled quality, grounding, paraphrase, and budget-fit cases
 * deterministically with zero network or model calls.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditArtifactClaims } from "./claimCheck";
import { fitUnitToBudget } from "../../content/unitFit";
import { xUnitBudgetAt, validateXText } from "../../social/xTextLimits";

describe("golden-set content quality & grounding eval (INC-07)", () => {
  it("case 1 (positive): good cited technical post has 0 unsupported claims, low paraphrase, clean flags", () => {
    const audit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      researchJobId: 101,
      payload: {
        text: "Iceberg v3 deletion vectors cut read amplification by 3.5x on CDC tables in 2026 benchmarks without rewriting full Parquet files.",
      },
      evidence: [
        {
          id: 1,
          text: "Apache Iceberg v3 specification introduces binary deletion vectors. Early 2026 engine benchmarks report 3.5x lower read amplification for high-churn CDC workloads.",
        },
      ],
      modelClaims: [
        {
          unitIndex: 0,
          claimText: "Iceberg v3 deletion vectors cut read amplification by 3.5x on CDC tables in 2026.",
          evidenceIds: [1],
          status: "supported",
        },
      ],
    });

    assert.equal(audit.unsupportedCount, 0);
    assert.ok(audit.paraphraseOverlap < 0.35);
    assert.deepEqual(audit.qualityFlags, []);
    assert.equal(audit.claims.length, 1);
    assert.equal(audit.claims[0].status, "supported");
  });

  it("case 2 (positive): hybrid post using creator proofPoints grounds first-person metrics as supported", () => {
    const audit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      researchJobId: 102,
      payload: {
        text: "We migrated PgBouncer to transaction pooling and cut P99 latency from 420ms to 85ms while Iceberg compaction stayed flat.",
      },
      evidence: [
        {
          id: 2,
          text: "PgBouncer transaction pooling multiplexes client connections across fewer Postgres backends.",
        },
      ],
      creatorNotes:
        "First-hand proof: we migrated PgBouncer to transaction pooling and measured P99 drop from 420ms to 85ms.",
    });

    assert.equal(audit.unsupportedCount, 0);
    assert.equal(audit.qualityFlags.includes("ungrounded_first_person"), false);
    assert.ok(audit.claims.some((c) => c.status === "supported"));
  });

  it("case 3 (negative): hallucinated percentage and latency metric not in evidence is flagged unsupported", () => {
    const audit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      researchJobId: 103,
      payload: {
        text: "DuckDB 1.2 reduced cold query latency to 14ms and lowered S3 egress costs by 63% across enterprise data lakes.",
      },
      evidence: [
        {
          id: 3,
          text: "DuckDB 1.2 adds improved Parquet predicate pushdown and memory management for local analytics.",
        },
      ],
    });

    assert.ok(audit.unsupportedCount >= 1);
    assert.ok(
      audit.claims.some(
        (c) => c.status === "unsupported" && /14ms|63%/i.test(c.reason ?? ""),
      ),
    );
  });

  it("case 4 (negative): fabricated evidenceId 99999 returned by model is stripped and flagged unsupported", () => {
    const audit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      researchJobId: 104,
      payload: {
        text: "Kafka KRaft removes ZooKeeper from broker metadata consensus.",
      },
      evidence: [
        {
          id: 4,
          text: "Apache Kafka KRaft mode replaces ZooKeeper with an internal Raft quorum.",
        },
      ],
      modelClaims: [
        {
          unitIndex: 0,
          claimText: "Kafka KRaft removes ZooKeeper from broker metadata consensus.",
          evidenceIds: [99999],
          status: "supported",
        },
      ],
    });

    assert.equal(audit.unsupportedCount, 1);
    assert.deepEqual(audit.claims[0].evidenceIds, []);
    assert.equal(audit.claims[0].status, "unsupported");
  });

  it("case 5 (negative): fabricated first-person war story with empty creator notes is flagged ungrounded_first_person", () => {
    const audit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      researchJobId: 105,
      payload: {
        text: "During our production outage last week, my team rebuilt the Airflow scheduler and saved the release.",
      },
      evidence: [
        {
          id: 5,
          text: "Airflow 3 separates task execution from scheduler loops to improve isolation.",
        },
      ],
      creatorNotes: "",
    });

    assert.ok(audit.qualityFlags.includes("ungrounded_first_person"));
    assert.ok(audit.unsupportedCount >= 1);
  });

  it("case 6 (negative): near-verbatim source paraphrase is flagged paraphrase_heavy", () => {
    const excerpt =
      "OpenTelemetry collectors buffer spans in memory and export batches asynchronously to prevent application threads from blocking on downstream backend latency.";
    const audit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      researchJobId: 106,
      payload: {
        text: "OpenTelemetry collectors buffer spans in memory and export batches asynchronously to prevent application threads from blocking on downstream backend latency.",
      },
      evidence: [{ id: 6, text: excerpt }],
    });

    assert.ok(audit.paraphraseOverlap >= 0.35);
    assert.ok(audit.qualityFlags.includes("paraphrase_heavy"));
  });

  it("case 7 (negative): generic AI slop boilerplate is flagged boilerplate_heavy", () => {
    const audit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      researchJobId: 107,
      payload: {
        text: "In today's fast-paced world, let's dive in and delve into this game-changing paradigm to unlock the power of data platforms.",
      },
      evidence: [
        {
          id: 7,
          text: "Columnar table formats separate metadata snapshots from immutable data files.",
        },
      ],
    });

    assert.ok(audit.qualityFlags.includes("boilerplate_heavy"));
  });

  it("case 8 (negative): over-limit X thread unit is flagged over_limit and fits cleanly with word-safe budget fitting", () => {
    const longUnit =
      "Modern data platforms fail silently when schema contracts drift between ingestion pipelines and warehouse models, causing downstream dashboards to compute stale numbers without triggering alerts, and teams only discover the corruption days later during executive reviews when trust is already broken.";
    const units = [
      longUnit,
      "Enforce schema checks at write time and reply with the worst drift bug you have debugged.",
    ];

    const unfittedAudit = auditArtifactClaims({
      format: "x_thread",
      channel: "x",
      researchJobId: 108,
      payload: { units },
      evidence: [
        { id: 8, text: "Data contracts validate schema evolution before records reach analytics tables." },
      ],
    });
    assert.ok(unfittedAudit.qualityFlags.includes("over_limit"));

    const fittedUnits = units.map((u, i) => fitUnitToBudget(u, xUnitBudgetAt(i, units.length)).text);
    assert.equal(validateXText(fittedUnits).ok, true);

    const fittedAudit = auditArtifactClaims({
      format: "x_thread",
      channel: "x",
      researchJobId: 108,
      payload: { units: fittedUnits },
      evidence: [
        { id: 8, text: "Data contracts validate schema evolution before records reach analytics tables." },
      ],
    });
    assert.equal(fittedAudit.qualityFlags.includes("over_limit"), false);
  });
});
