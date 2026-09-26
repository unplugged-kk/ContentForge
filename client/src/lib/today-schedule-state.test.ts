import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveAttentionItems,
  formatDateBucket,
  formatTimeOfDay,
  previewArtifactPayload,
} from "./today-schedule-state";

describe("previewArtifactPayload", () => {
  it("prefers a plain text payload", () => {
    assert.equal(previewArtifactPayload({ text: "hello world" }), "hello world");
  });
  it("joins thread units into one preview", () => {
    assert.equal(previewArtifactPayload({ units: ["one", { text: "two" }] }), "one two");
  });
  it("returns empty string for an empty/null payload", () => {
    assert.equal(previewArtifactPayload(null), "");
    assert.equal(previewArtifactPayload({}), "");
  });
});

describe("deriveAttentionItems", () => {
  const base = {
    artifactsNeedingReview: [],
    runsNeedingApproval: [],
    failedPublications: [],
    unknownPublications: [],
  };

  it("returns an empty list when nothing needs attention", () => {
    assert.deepEqual(deriveAttentionItems(base), []);
  });

  it("prioritizes action_required (review/approval) over warnings (failed/unknown)", () => {
    const items = deriveAttentionItems({
      ...base,
      artifactsNeedingReview: [{ id: 1, channel: "x", payload: { text: "draft" }, createdAt: "2026-01-01T00:00:00Z" }],
      failedPublications: [
        { id: 2, artifactId: 5, channel: "x", state: "failed", lastError: "boom", createdAt: "2026-01-02T00:00:00Z", result: null },
      ],
    });
    assert.equal(items[0].kind, "needs_review");
    assert.equal(items[1].kind, "failed_publication");
  });

  it("sorts same-severity items by most recent first", () => {
    const items = deriveAttentionItems({
      ...base,
      artifactsNeedingReview: [
        { id: 1, channel: "x", payload: {}, createdAt: "2026-01-01T00:00:00Z" },
        { id: 2, channel: "x", payload: {}, createdAt: "2026-01-05T00:00:00Z" },
      ],
    });
    assert.equal(items[0].id, "review-2");
    assert.equal(items[1].id, "review-1");
  });

  it("uses the result error message over the raw lastError when present", () => {
    const items = deriveAttentionItems({
      ...base,
      failedPublications: [
        {
          id: 3,
          artifactId: 9,
          channel: "linkedin",
          state: "failed",
          lastError: "raw provider trace",
          createdAt: "2026-01-01T00:00:00Z",
          result: { outcome: "failed", errorMessage: "Rate limited by LinkedIn" },
        },
      ],
    });
    assert.equal(items[0].subtitle, "Rate limited by LinkedIn");
  });

  it("classifies a pre-network configuration failure as setup-required", () => {
    const items = deriveAttentionItems({
      ...base,
      failedPublications: [
        {
          id: 4,
          artifactId: 10,
          channel: "x",
          state: "failed",
          providerCalled: false,
          lastError: "XQUICK_CONFIG_MISSING",
          createdAt: "2026-01-01T00:00:00Z",
          result: {
            outcome: "failed",
            errorClass: "policy_human",
            errorMessage: "xQuick credentials missing: connect an xQuick token in Settings.",
          },
        },
      ],
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "setup_required_publication");
    assert.equal(items[0].title, "X setup required");
    assert.equal(items[0].actionUrl, "/settings");
  });

  it("does not relabel an ambiguous provider call as setup-required", () => {
    const items = deriveAttentionItems({
      ...base,
      unknownPublications: [
        {
          id: 5,
          artifactId: 11,
          channel: "x",
          state: "failed",
          providerCalled: true,
          lastError: "XQUICK_CONFIG_MISSING",
          createdAt: "2026-01-01T00:00:00Z",
          result: {
            outcome: "unknown",
            errorClass: "unknown",
            errorMessage: "reconcile_required",
          },
        },
      ],
    });

    assert.equal(items[0].kind, "unknown_publication");
  });

  it("keeps policy failures that are not setup gaps as publication failures", () => {
    const items = deriveAttentionItems({
      ...base,
      failedPublications: [
        {
          id: 6,
          artifactId: 12,
          channel: "x",
          state: "failed",
          providerCalled: false,
          lastError: null,
          createdAt: "2026-01-01T00:00:00Z",
          result: {
            outcome: "failed",
            errorClass: "policy_human",
            errorMessage: "Artifact 12 is \"draft\"; only approved revisions may publish",
          },
        },
      ],
    });

    assert.equal(items[0].kind, "failed_publication");
    assert.equal(items[0].title, "Publication failed");
  });

  it("routes waiting-for-approval items to the agent run", () => {
    const items = deriveAttentionItems({
      ...base,
      runsNeedingApproval: [{ id: 42, objective: "publish something", needsApproval: true, createdAt: "2026-01-01T00:00:00Z" }],
    });
    assert.equal(items[0].actionUrl, "/agent?runId=42");
  });
});

describe("formatDateBucket", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  it("labels today", () => {
    assert.equal(formatDateBucket("2026-09-19T08:00:00Z", now), "Today");
  });
  it("labels tomorrow", () => {
    assert.equal(formatDateBucket("2026-09-20T08:00:00Z", now), "Tomorrow");
  });
  it("falls back to a short date", () => {
    assert.equal(formatDateBucket("2026-09-25T08:00:00Z", now), "Sep 25");
  });
});

describe("formatTimeOfDay", () => {
  it("formats a compact time", () => {
    assert.equal(formatTimeOfDay("2026-09-19T18:30:00"), "6:30 PM");
  });
});
