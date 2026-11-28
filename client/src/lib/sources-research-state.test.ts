import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCredibility,
  humanizeQuality,
  humanizeNovelty,
  resolveResearchStatus,
  formatTimeWindow,
  formatResearchDepth,
  translateProviderLimitations,
  getCreateFromStoryUrl,
  getCreateFromIdeaUrl,
  getCreateFromSourceUrl,
  parseCreateSourceHandoff,
  findConflictsForSourceUrl,
  formatConflictClaims,
  selectResearchProviders,
  sanitizeUntrustedText,
} from "./sources-research-state";

describe("Phase 28.2E: Sources Research State Helpers", () => {
  describe("resolveCredibility", () => {
    it("reports Conflicting evidence when conflicts exist regardless of source class", () => {
      const result = resolveCredibility("primary_source", 5, true);
      assert.equal(result.level, "conflicting");
      assert.equal(result.label, "Conflicting evidence");
      assert.equal(result.variant, "destructive");
    });

    it("reports High confidence source for primary source or 3+ corroborations", () => {
      const primary = resolveCredibility("primary_source", 1, false);
      assert.equal(primary.level, "high_confidence");
      assert.equal(primary.label, "High confidence source");
      assert.equal(primary.variant, "default");

      const corroborated = resolveCredibility("blog", 4, false);
      assert.equal(corroborated.level, "high_confidence");
    });

    it("reports Established source for journalism/academic or 2 corroborations", () => {
      const est = resolveCredibility("established_publisher", 1, false);
      assert.equal(est.level, "established");
      assert.equal(est.label, "Established source");
      assert.equal(est.variant, "secondary");

      const duo = resolveCredibility(null, 2, false);
      assert.equal(duo.level, "established");
    });

    it("reports Needs verification for social/unverified sources", () => {
      const social = resolveCredibility("social_post", 1, false);
      assert.equal(social.level, "needs_verification");
      assert.equal(social.label, "Needs verification");
      assert.equal(social.variant, "outline");
    });
  });

  describe("humanizeQuality & humanizeNovelty", () => {
    it("humanizes quality into restrained labels", () => {
      assert.equal(humanizeQuality("high_confidence").label, "High Quality");
      assert.equal(humanizeQuality("rich").level, "high");
      assert.equal(humanizeQuality("low_yield").label, "Preliminary");
      assert.equal(humanizeQuality("standard").label, "Standard Quality");
    });

    it("humanizes novelty without raw decimal scores", () => {
      assert.equal(humanizeNovelty(0.85).label, "New Angle");
      assert.equal(humanizeNovelty(0.85).isNew, true);
      assert.equal(humanizeNovelty(0.5).label, "Emerging");
      assert.equal(humanizeNovelty(0.2).label, "Known Topic");
      assert.equal(humanizeNovelty(0.2).isNew, false);
    });
  });

  describe("resolveResearchStatus", () => {
    it("identifies degraded completed research when warnings or provider failures exist", () => {
      const normal = resolveResearchStatus({ jobStatus: "complete", diagnostics: [] });
      assert.equal(normal.status, "complete");
      assert.equal(normal.isDegraded, false);
      assert.equal(normal.label, "Research complete");

      const degraded = resolveResearchStatus({
        jobStatus: "complete",
        diagnostics: [{ providerId: "reddit", status: "unavailable" }],
      });
      assert.equal(degraded.status, "completed_with_warnings");
      assert.equal(degraded.isDegraded, true);
      assert.equal(degraded.label, "Completed with limited sources");
      assert.match(degraded.degradedReasons[0], /Reddit unavailable/i);
    });

    it("correctly identifies failed or in-progress states", () => {
      const running = resolveResearchStatus({ jobStatus: "running" });
      assert.equal(running.status, "running");

      const failed = resolveResearchStatus({ jobStatus: "failed", errorMessage: "Rate limited" });
      assert.equal(failed.status, "failed");
    });
  });

  describe("formatTimeWindow & formatResearchDepth", () => {
    it("formats windows into plain language", () => {
      assert.equal(formatTimeWindow("last_24h"), "Last 24 hours");
      assert.equal(formatTimeWindow("last_7d"), "Last 7 days");
      assert.equal(formatTimeWindow("last_30d"), "Last 30 days");
      assert.equal(formatTimeWindow("custom"), "Custom window");
    });

    it("formats depth into clean labels", () => {
      assert.equal(formatResearchDepth("quick"), "Quick");
      assert.equal(formatResearchDepth("standard"), "Standard");
      assert.equal(formatResearchDepth("deep"), "Deep");
    });
  });

  describe("translateProviderLimitations", () => {
    it("translates limitations without raw environment variables", () => {
      const limits = translateProviderLimitations({
        last30days: { configured: false, available: false },
        openseo: { configured: false, available: false },
        providers: [{ providerId: "reddit", configured: false, available: false }],
      });

      assert.equal(limits.length, 3);
      assert.equal(limits[0].userMessage, "Last 30 days: not enabled");
      assert.equal(limits[1].userMessage, "SEO research: not configured");
      assert.equal(limits[2].userMessage, "Reddit: credentials not configured");

      // Verify no raw environment variables leaked
      for (const item of limits) {
        assert.doesNotMatch(item.userMessage, /LAST30DAYS_ENABLED|REDDIT_CLIENT_ID|OPENSEO_API_KEY/);
      }
    });
  });

  describe("canonical handoff URLs", () => {
    it("builds correct Create URLs from Story, Idea, and Source", () => {
      assert.equal(getCreateFromStoryUrl(42), "/create?storyId=42");
      assert.equal(getCreateFromIdeaUrl(19), "/create?ideaId=19");
      assert.equal(
        getCreateFromSourceUrl({ title: "Kubernetes Trends", url: "https://example.com/k8s" }),
        "/create?topic=Kubernetes+Trends&sourceUrl=https%3A%2F%2Fexample.com%2Fk8s",
      );
    });

    it("encodes and parses researchJobId and evidenceIds without breaking provenance", () => {
      const href = getCreateFromSourceUrl({
        title: "Cloud Native 2026",
        url: "https://cncf.io/reports/2026",
        researchJobId: 101,
        evidenceIds: [201, 202, 201],
      });
      const parsed = parseCreateSourceHandoff(href.split("?")[1] ?? "");
      assert.equal(parsed.topic, "Cloud Native 2026");
      assert.equal(parsed.sourceUrl, "https://cncf.io/reports/2026");
      assert.equal(parsed.researchJobId, 101);
      assert.deepEqual(parsed.evidenceIds, [201, 202]);
    });

    it("ignores invalid researchJobId and evidenceIds when parsing query strings", () => {
      const parsed = parseCreateSourceHandoff("topic=Test&researchJobId=abc&evidenceIds=0,-5,foo,12");
      assert.equal(parsed.researchJobId, undefined);
      assert.deepEqual(parsed.evidenceIds, [12]);
    });
  });

  describe("conflict matching & claim formatting", () => {
    it("matches canonical backend ResearchConflict claims[] by canonicalUrl", () => {
      const conflicts = [
        {
          topic: "launch date",
          claims: [
            {
              canonicalUrl: "https://example.com/a",
              text: "Product launched in January 2026",
              provider: "rss",
            },
            {
              canonicalUrl: "https://example.com/b",
              text: "Launch delayed to March 2026",
              provider: "hn",
            },
          ],
        },
      ];

      const matchesA = findConflictsForSourceUrl(conflicts, "https://example.com/a");
      assert.equal(matchesA.length, 1);
      assert.equal(matchesA[0].topic, "launch date");

      const claims = formatConflictClaims(matchesA[0]);
      assert.equal(claims.length, 2);
      assert.equal(claims[0].provider, "rss");
      assert.equal(claims[0].text, "Product launched in January 2026");
      assert.equal(claims[1].canonicalUrl, "https://example.com/b");

      assert.equal(findConflictsForSourceUrl(conflicts, "https://example.com/unmatched").length, 0);
    });

    it("defensively supports legacy sourceUrlA/sourceUrlB and claimA/claimB fixtures", () => {
      const legacy = [
        {
          topic: "benchmark",
          sourceUrlA: "https://example.com/legacy-a",
          sourceUrlB: "https://example.com/legacy-b",
          claimA: "<b>2x faster</b>",
          claimB: "No measurable gain",
        },
      ];

      const matches = findConflictsForSourceUrl(legacy, "https://example.com/legacy-b");
      assert.equal(matches.length, 1);
      assert.deepEqual(formatConflictClaims(matches[0]), [
        { canonicalUrl: "https://example.com/legacy-a", text: "2x faster" },
        { canonicalUrl: "https://example.com/legacy-b", text: "No measurable gain" },
      ]);
    });
  });

  describe("selectResearchProviders", () => {
    it("keeps up to 4 available providers for normal topic queries", () => {
      assert.deepEqual(
        selectResearchProviders(["rss", "hn", "reddit", "youtube", "web"], "Postgres scaling"),
        ["rss", "hn", "reddit", "youtube"],
      );
    });

    it("ensures web provider is included when query or directUrl is an HTTP(S) URL", () => {
      assert.deepEqual(
        selectResearchProviders(["rss", "hn", "reddit", "youtube", "web"], "https://example.com/post"),
        ["web", "rss", "hn", "reddit"],
      );
      assert.deepEqual(
        selectResearchProviders(["rss", "hn", "reddit", "youtube"], "Release notes", "https://example.com/notes"),
        ["web", "rss", "hn", "reddit"],
      );
    });
  });

  describe("sanitizeUntrustedText", () => {
    it("strips HTML tags and normalizes whitespace", () => {
      const raw = "<script>alert('xss')</script>Hello <b>World</b>!   \n\nNew paragraph.";
      const clean = sanitizeUntrustedText(raw);
      assert.equal(clean, "alert('xss')Hello World! New paragraph.");
    });
  });
});
