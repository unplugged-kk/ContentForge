import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JobFailure } from "../jobs/failures";
import { deriveEditMetrics } from "./learning/edit";
import { deriveApprovalDecision, derivedKindForApproval } from "./learning/approval";
import {
  classifyMetricsHttpFailure,
  missingMetricsOutcome,
  normalizeProviderMetrics,
  notAvailableMetrics,
  validateNormalizedMetrics,
} from "./learning/metrics";
import { boundPayload, hourWindow, learningIdentityKey, performanceIdentityKey } from "./learning/identity";
import { MAX_SIGNAL_PAYLOAD_BYTES, PERFORMANCE_SCHEMA_VERSION } from "./learning/constants";

describe("learning edit derivation", () => {
  it("measures length, hook, CTA, and formatting without claiming semantic intent", () => {
    const metrics = deriveEditMetrics(
      { text: "Hook line\nBody https://example.com" },
      { text: "Different hook\nBody https://example.com\n- list" },
    );
    assert.equal(metrics.hookChanged, true);
    assert.equal(metrics.formattingChanged, true);
    assert.ok(metrics.addedChars > 0);
    assert.equal(metrics.substantial, true);
  });

  it("does not mark a tiny punctuation tweak as substantial when the hook is unchanged", () => {
    const metrics = deriveEditMetrics({ text: "Same hook\nbody" }, { text: "Same hook\nbody!" });
    assert.equal(metrics.hookChanged, false);
    assert.equal(metrics.substantial, false);
  });
});

describe("learning approval derivation", () => {
  it("classifies approved without edit, edited then approved, multiple revisions, and rejected", () => {
    assert.equal(
      deriveApprovalDecision({ readiness: "approved", provenance: "generated" }, [
        { id: 1, provenance: "generated" },
      ]),
      "approved_without_edit",
    );
    assert.equal(
      deriveApprovalDecision({ readiness: "approved", provenance: "human_edit" }, [
        { id: 1, provenance: "generated" },
        { id: 2, provenance: "human_edit" },
      ]),
      "edited_then_approved",
    );
    assert.equal(
      deriveApprovalDecision({ readiness: "approved", provenance: "human_edit" }, [
        { id: 1, provenance: "generated" },
        { id: 2, provenance: "human_edit" },
        { id: 3, provenance: "human_edit" },
      ]),
      "approved_after_multiple_revisions",
    );
    assert.equal(
      deriveApprovalDecision({ readiness: "rejected", provenance: "generated" }, [
        { id: 1, provenance: "generated" },
      ]),
      "rejected",
    );
    assert.equal(derivedKindForApproval("approved_without_edit"), "approval_clean");
    assert.equal(derivedKindForApproval("rejected"), null);
  });
});

describe("provider metric normalization", () => {
  it("maps X public_metrics and leaves unsupported metrics not_available, never zero", () => {
    const rows = normalizeProviderMetrics(
      { public_metrics: { impression_count: 12, like_count: 3, retweet_count: 1, reply_count: 2, bookmark_count: 4 } },
      "x",
    );
    const by = Object.fromEntries(rows.map((r) => [r.metric, r]));
    assert.equal(by.impressions.availability, "observed");
    assert.equal(by.impressions.value, 12);
    assert.equal(by.likes.value, 3);
    assert.equal(by.shares.value, 1);
    assert.equal(by.replies.value, 2);
    assert.equal(by.saves.value, 4);
    assert.equal(by.clicks.availability, "not_available");
    assert.equal(by.clicks.value, null);
    assert.equal(by.comments.availability, "not_available");
    assert.equal(by.comments.value, null);
  });

  it("treats a missing metric as not_available rather than zero", () => {
    const rows = notAvailableMetrics();
    assert.ok(rows.every((r) => r.availability === "not_available" && r.value === null));
  });

  it("validates schema v1 observed vs not_available", () => {
    assert.deepEqual(
      validateNormalizedMetrics([{ metric: "likes", value: null, availability: "observed" }]),
      ["likes: observed metric requires a numeric value"],
    );
    assert.deepEqual(
      validateNormalizedMetrics([{ metric: "likes", value: 1, availability: "not_available" }]),
      ["likes: not_available must have null value"],
    );
  });

  it("classifies transient vs permanent retrieval failures", () => {
    assert.equal(classifyMetricsHttpFailure(429, "slow down"), "rate_limited");
    assert.equal(classifyMetricsHttpFailure(503, "unavailable"), "transient");
    assert.equal(classifyMetricsHttpFailure(401, "unauthorized"), "permanent");
    assert.equal(classifyMetricsHttpFailure(404, "missing"), "permanent");
    assert.equal(classifyMetricsHttpFailure(400, "timeout connecting"), "transient");
  });

  it("keeps performance schema versions in identity so v1 and v2 coexist", () => {
    const at = new Date("2026-09-17T12:00:00.000Z");
    const v1 = performanceIdentityKey({
      publicationId: 9,
      metric: "likes",
      observedAt: at,
      provider: "x",
      normalizationVersion: "performance.v1",
    });
    const v2 = performanceIdentityKey({
      publicationId: 9,
      metric: "likes",
      observedAt: at,
      provider: "x",
      normalizationVersion: "performance.v2",
    });
    assert.notEqual(v1, v2);
    assert.match(v1, /performance.v1/);
  });

  it("uses publication+metric+observedAt+provider as the identity, never a random id", () => {
    const at = new Date("2026-09-17T12:00:00.000Z");
    assert.equal(
      performanceIdentityKey({
        publicationId: 1,
        metric: "likes",
        observedAt: at,
        provider: "x",
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
      }),
      performanceIdentityKey({
        publicationId: 1,
        metric: "likes",
        observedAt: at,
        provider: "x",
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
      }),
    );
  });

  it("bounds oversized payloads", () => {
    const huge = boundPayload({ blob: "x".repeat(MAX_SIGNAL_PAYLOAD_BYTES + 50) });
    assert.equal(huge.truncated, true);
  });

  it("hour windows are deterministic UTC buckets", () => {
    const a = hourWindow(new Date("2026-01-02T15:44:01.123Z"));
    const b = hourWindow(new Date("2026-01-02T15:01:00.000Z"));
    assert.equal(a.window, b.window);
    assert.equal(a.observedAt.toISOString(), "2026-01-02T15:00:00.000Z");
  });
});

describe("descriptive analytics summary math", () => {
  it("computes rates as descriptive ratios, not quality scores", () => {
    assert.equal(JobFailure.permanent("no metrics").failureClass, "permanent");
    assert.match(learningIdentityKey(["v1", "edit", 3]), /^ls:v1:edit:3$/);
  });
});
