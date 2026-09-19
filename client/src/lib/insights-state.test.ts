import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatMetricValue,
  formatMetricRate,
  humanizeConfidence,
  formatDateWindow,
  formatStyleProvenance,
  formatChannelName,
  formatContentType,
  getCanonicalReviewUrl,
  getExploreTopicUrl,
  getAskAgentUrl,
  resolveInsightsTab,
} from "./insights-state";

describe("Phase 28.2G: Insights State Helpers", () => {
  describe("formatMetricValue", () => {
    it("never coerces not_available availability to 0", () => {
      assert.equal(formatMetricValue(0, "not_available"), "—");
      assert.equal(formatMetricValue(null, "not_available"), "—");
      assert.equal(formatMetricValue(1234, "not_available"), "—");
    });

    it("returns — for null or undefined values", () => {
      assert.equal(formatMetricValue(null), "—");
      assert.equal(formatMetricValue(undefined), "—");
    });

    it("formats observed numbers with commas and formats 0 properly", () => {
      assert.equal(formatMetricValue(0, "observed"), "0");
      assert.equal(formatMetricValue(12450, "observed"), "12,450");
      assert.equal(formatMetricValue(1000000), "1,000,000");
    });
  });

  describe("formatMetricRate", () => {
    it("formats fractional numbers as percentages with 1 decimal", () => {
      assert.equal(formatMetricRate(0.8571), "85.7%");
      assert.equal(formatMetricRate(1.0), "100.0%");
      assert.equal(formatMetricRate(0), "0.0%");
    });

    it("returns — for null or undefined rates", () => {
      assert.equal(formatMetricRate(null), "—");
      assert.equal(formatMetricRate(undefined), "—");
    });
  });

  describe("humanizeConfidence", () => {
    it("classifies numeric confidence levels correctly", () => {
      assert.deepEqual(humanizeConfidence(0.85), { label: "Strong signal", variant: "success" });
      assert.deepEqual(humanizeConfidence(0.55), { label: "Emerging pattern", variant: "warning" });
      assert.deepEqual(humanizeConfidence(0.2), { label: "Limited evidence", variant: "outline" });
      assert.deepEqual(humanizeConfidence(0), { label: "Insufficient data", variant: "secondary" });
    });

    it("classifies string confidence tiers correctly", () => {
      assert.deepEqual(humanizeConfidence("high"), { label: "Strong signal", variant: "success" });
      assert.deepEqual(humanizeConfidence("strong"), { label: "Strong signal", variant: "success" });
      assert.deepEqual(humanizeConfidence("medium"), { label: "Emerging pattern", variant: "warning" });
      assert.deepEqual(humanizeConfidence("moderate"), { label: "Emerging pattern", variant: "warning" });
      assert.deepEqual(humanizeConfidence("low"), { label: "Limited evidence", variant: "outline" });
      assert.deepEqual(humanizeConfidence("weak"), { label: "Limited evidence", variant: "outline" });
      assert.deepEqual(humanizeConfidence(null), { label: "Insufficient data", variant: "secondary" });
    });
  });

  describe("formatDateWindow", () => {
    it("returns descriptive human-readable time windows", () => {
      assert.equal(formatDateWindow("7d"), "Last 7 days");
      assert.equal(formatDateWindow(30), "Last 30 days");
      assert.equal(formatDateWindow("90d"), "Last 90 days");
      assert.equal(formatDateWindow("all"), "All time (lifetime of published content)");
      assert.equal(formatDateWindow(null), "All time (lifetime of published content)");
    });
  });

  describe("formatStyleProvenance", () => {
    it("returns evidence-based reference statements without causal overstatements", () => {
      assert.equal(formatStyleProvenance(12), "Observed in 12 analyzed references");
      assert.equal(formatStyleProvenance(1), "Observed in 1 analyzed reference");
      assert.equal(formatStyleProvenance(null), "Observed from style reference analysis");
    });
  });

  describe("formatChannelName and formatContentType", () => {
    it("formats channel identifiers nicely", () => {
      assert.equal(formatChannelName("x"), "X (Twitter)");
      assert.equal(formatChannelName("linkedin"), "LinkedIn");
      assert.equal(formatChannelName("youtube"), "YouTube");
      assert.equal(formatChannelName("threads"), "Threads");
    });

    it("formats content types nicely", () => {
      assert.equal(formatContentType("x_post"), "X Post");
      assert.equal(formatContentType("x_thread"), "X Thread");
      assert.equal(formatContentType("linkedin_post"), "LinkedIn Post");
      assert.equal(formatContentType("article"), "Article");
    });
  });

  describe("canonical handoff URLs", () => {
    it("builds correct URL for Review in Studio", () => {
      assert.equal(getCanonicalReviewUrl(42), "/create?artifact=42");
    });

    it("builds correct URL for Explore topic in Sources", () => {
      assert.equal(getExploreTopicUrl("Kubernetes & Cloud"), "/sources?query=Kubernetes%20%26%20Cloud");
    });

    it("builds correct URL for Ask Agent", () => {
      assert.equal(getAskAgentUrl(), "/agent");
      assert.equal(getAskAgentUrl("Analyze reach"), "/agent?prompt=Analyze%20reach");
    });
  });

  describe("resolveInsightsTab", () => {
    it("resolves active tab from search params", () => {
      assert.equal(resolveInsightsTab("learning"), "learning");
      assert.equal(resolveInsightsTab("ai-usage"), "ai-usage");
      assert.equal(resolveInsightsTab("usage"), "ai-usage");
      assert.equal(resolveInsightsTab("cost"), "ai-usage");
      assert.equal(resolveInsightsTab("performance"), "performance");
      assert.equal(resolveInsightsTab("analytics"), "performance");
      assert.equal(resolveInsightsTab(null), "performance");
    });
  });
});
