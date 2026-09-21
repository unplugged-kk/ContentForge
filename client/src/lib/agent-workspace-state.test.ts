import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveRunDisplayStatus,
  deriveRunOutcomeSummary,
  formatRelativeTime,
  getCanonicalReviewUrl,
  getCanonicalScheduleUrl,
  humanizeToolName,
} from "./agent-workspace-state";

describe("Agent Workspace State & Domain Helpers (Phase 28.2D)", () => {
  describe("deriveRunDisplayStatus", () => {
    it("reports running when status is running or active", () => {
      assert.equal(deriveRunDisplayStatus({ rawStatus: "running" }), "running");
      assert.equal(deriveRunDisplayStatus({ rawStatus: "in_progress" }), "running");
      assert.equal(deriveRunDisplayStatus({ rawStatus: "active" }), "running");
    });

    it("reports queued for pending or queued runs", () => {
      assert.equal(deriveRunDisplayStatus({ rawStatus: "queued" }), "queued");
      assert.equal(deriveRunDisplayStatus({ rawStatus: "pending" }), "queued");
    });

    it("reports waiting_for_approval when flag is true, overriding raw status", () => {
      assert.equal(
        deriveRunDisplayStatus({ rawStatus: "running", waitingForApproval: true }),
        "waiting_for_approval",
      );
      assert.equal(
        deriveRunDisplayStatus({ rawStatus: "waiting_approval" }),
        "waiting_for_approval",
      );
    });

    it("reports completed when status is complete and no tools failed", () => {
      assert.equal(
        deriveRunDisplayStatus({
          rawStatus: "completed",
          toolCalls: [{ name: "create_story", status: "completed" }],
        }),
        "completed",
      );
    });

    it("reports completed_with_errors when status is completed but a tool failed", () => {
      const status = deriveRunDisplayStatus({
        rawStatus: "completed",
        toolCalls: [
          { name: "research_topic", status: "completed" },
          { name: "generate_image", status: "failed", errorMessage: "Rate limited" },
        ],
      });
      assert.equal(status, "completed_with_errors");
    });

    it("reports failed when raw status is failed or error", () => {
      assert.equal(deriveRunDisplayStatus({ rawStatus: "failed" }), "failed");
      assert.equal(deriveRunDisplayStatus({ rawStatus: "error" }), "failed");
    });

    it("reports unknown when status is missing or ambiguous", () => {
      assert.equal(deriveRunDisplayStatus({ rawStatus: "" }), "unknown");
      assert.equal(deriveRunDisplayStatus({ rawStatus: null }), "unknown");
    });
  });

  describe("deriveRunOutcomeSummary", () => {
    it("computes accurate item counts and warnings for a multi-step run", () => {
      const summary = deriveRunOutcomeSummary({
        status: "completed_with_errors",
        toolCalls: [
          { name: "create_story", status: "completed" },
          {
            name: "find_opportunities",
            status: "completed",
            result: { refs: { opportunityIds: [101, 102, 103] } },
          },
          { name: "generate_artifact", status: "completed" },
          { name: "generate_image", status: "failed", errorMessage: "Service unavailable" },
        ],
        story: { id: 1, title: "Test Story" },
        hasDraftArtifacts: true,
      });

      assert.equal(summary.status, "completed_with_errors");
      assert.equal(summary.statusLabel, "Completed with warnings");
      assert.equal(summary.storiesCreated, 1);
      assert.equal(summary.opportunitiesCreated, 3);
      assert.equal(summary.artifactsCreated, 1);
      assert.equal(summary.mediaCreated, 0);
      assert.equal(summary.warningCount, 1);
      assert.equal(summary.hasArtifactsNeedingReview, true);
    });

    it("reflects empty run cleanly", () => {
      const summary = deriveRunOutcomeSummary({ status: "queued" });
      assert.equal(summary.storiesCreated, 0);
      assert.equal(summary.artifactsCreated, 0);
      assert.equal(summary.warningCount, 0);
    });
  });

  describe("canonical handoff URLs", () => {
    it("returns correct canonical review route for artifacts", () => {
      assert.equal(getCanonicalReviewUrl(42), "/create?artifact=42");
    });

    it("returns canonical schedule route", () => {
      assert.equal(getCanonicalScheduleUrl(), "/schedule");
    });
  });

  describe("humanizeToolName", () => {
    it("maps recognized tools to step titles and categories", () => {
      assert.deepEqual(humanizeToolName("research_topic"), {
        title: "Research Topic",
        category: "Research",
      });
      assert.deepEqual(humanizeToolName("create_story"), {
        title: "Synthesize Story",
        category: "Story",
      });
      assert.deepEqual(humanizeToolName("repurpose_story"), {
        title: "Repurpose Across Channels",
        category: "Generation",
      });
      assert.deepEqual(humanizeToolName("generate_artifact"), {
        title: "Generate Content Artifact",
        category: "Generation",
      });
      assert.deepEqual(humanizeToolName("publish_now"), {
        title: "Publish Content",
        category: "Distribution",
      });
    });
  });

  describe("formatRelativeTime", () => {
    const fixedNow = new Date("2026-09-19T12:00:00Z");

    it("formats relative timestamps accurately", () => {
      assert.equal(formatRelativeTime("2026-09-19T11:59:30Z", fixedNow), "just now");
      assert.equal(formatRelativeTime("2026-09-19T11:55:00Z", fixedNow), "5m ago");
      assert.equal(formatRelativeTime("2026-09-19T10:00:00Z", fixedNow), "2h ago");
      assert.equal(formatRelativeTime("2026-09-18T10:00:00Z", fixedNow), "yesterday");
      assert.equal(formatRelativeTime("2026-09-15T12:00:00Z", fixedNow), "4d ago");
    });
  });
});
