import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("ContentForge Phase 29.1 — Learning Foundation & Evidence-Backed Optimization", () => {
  test.beforeEach(async ({ page }) => {
    // Mock standard style profiles
    await page.route("**/api/style/profiles", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profiles: [
            {
              id: 1,
              name: "Technical Deep-Dive",
              confidence: "high",
              sampleCount: 8,
              isActive: true,
              channel: "linkedin",
              stylePromptSnippet: "Direct, metric-driven, bulleted takeaways",
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    // Mock learning summary
    await page.route("**/api/learning/summary", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          publishedCount: 14,
          successRate: 1.0,
          approvalRate: 0.857,
          byChannel: [{ channel: "linkedin", published: 10, observedMetrics: 10 }],
          byFormat: [{ format: "carousel", published: 8 }, { format: "post", published: 6 }],
          byStory: [],
          signalCounts: { approval: 12, rejection: 2 },
          metricTotals: [
            { metric: "impressions", total: 42000, observedCount: 12, notAvailableCount: 2 },
            { metric: "likes", total: 1850, observedCount: 14, notAvailableCount: 0 },
          ],
        }),
      });
    });
  });

  test("Journey A: Learning view renders Observed, Learned, and Proposed tiers with proposals", async ({ page }) => {
    // Mock proposals
    await page.route("**/api/learning/proposals", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            userId: 1,
            observationId: 1,
            proposalType: "format_distribution",
            targetScope: "channel:linkedin;format:carousel",
            title: "Consider increasing carousel content on linkedin",
            rationale: "Observed: carousel content on linkedin showed 48.2% higher average engagements compared to the channel baseline across 6 publications.",
            expectedImpactHypothesis: "Prioritizing carousel format for upcoming linkedin opportunities is expected to maintain above-average engagement.",
            evidenceQuality: "directional",
            evidenceSummary: {
              sampleCount: 6,
              candidateValue: "52.00",
              baselineValue: "35.10",
              differencePercentage: "48.2",
              publicationIds: [201, 202, 203, 204, 205, 206],
            },
            status: "proposed",
            reviewedAt: null,
            reviewedBy: null,
            reviewNotes: null,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    // Mock observations
    await page.route("**/api/learning/observations", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            userId: 1,
            dimension: "distribution",
            observationType: "format_channel_performance",
            targetScope: "channel:linkedin;format:carousel",
            candidatePopulation: { channel: "linkedin", format: "carousel", sampleCount: 6 },
            comparisonPopulation: { channel: "linkedin", baseline: "all_channel_formats", sampleCount: 14 },
            metricName: "engagements_per_post",
            candidateValue: "52.0000",
            comparisonValue: "35.1000",
            differencePercentage: "48.15",
            evidenceQuality: "directional",
            evidenceEntityIds: { publicationIds: [201, 202, 203] },
            measurementWindow: "all_time",
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/insights?view=learning");

    // Container
    await expect(page.locator('[data-testid="container-learning-view"]')).toBeVisible();

    // Verify 3 distinct tiers: Proposed, Learned, Observed
    await expect(page.locator('[data-testid="section-learning-proposals"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-learning-inferences"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-learning-observed"]')).toBeVisible();

    // Proposal card
    const proposalCard = page.locator('[data-testid="card-proposal-101"]');
    await expect(proposalCard).toBeVisible();
    await expect(proposalCard).toContainText("Consider increasing carousel content on linkedin");
    await expect(proposalCard).toContainText("Directional");
    await expect(proposalCard).toContainText("6–10 verified items");
    await expect(proposalCard).toContainText("Observed: carousel content on linkedin showed 48.2% higher average engagements");

    // Action buttons visible
    await expect(page.locator('[data-testid="button-accept-proposal-101"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-dismiss-proposal-101"]')).toBeVisible();
  });

  test("Journey B: Inspect Evidence drawer expands and shows sample count, baseline, and delta", async ({ page }) => {
    await page.route("**/api/learning/proposals", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            userId: 1,
            observationId: 1,
            proposalType: "format_distribution",
            targetScope: "channel:linkedin;format:carousel",
            title: "Consider increasing carousel content on linkedin",
            rationale: "Observed: carousel content on linkedin showed 48.2% higher average engagements compared to the channel baseline across 6 publications.",
            expectedImpactHypothesis: "Prioritizing carousel format for upcoming linkedin opportunities is expected to maintain above-average engagement.",
            evidenceQuality: "directional",
            evidenceSummary: {
              sampleCount: 6,
              candidateValue: "52.00",
              baselineValue: "35.10",
              differencePercentage: "48.2",
              publicationIds: [201, 202, 203, 204, 205, 206],
            },
            status: "proposed",
            reviewedAt: null,
            reviewedBy: null,
            reviewNotes: null,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/insights?view=learning");

    // Evidence drawer is initially hidden
    await expect(page.locator('[data-testid="drawer-evidence-101"]')).not.toBeVisible();

    // Click inspect evidence button
    const toggleBtn = page.locator('[data-testid="button-toggle-evidence-101"]');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    // Evidence drawer is now visible
    const drawer = page.locator('[data-testid="drawer-evidence-101"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-testid="text-evidence-sample-count"]')).toContainText("6 publications");
    await expect(drawer).toContainText("52.00");
    await expect(drawer).toContainText("35.10");
    await expect(drawer).toContainText("+48.2%");
    await expect(drawer).toContainText("channel:linkedin;format:carousel");
  });

  test("Journey C: Human review action - Accept proposal updates status to accepted", async ({ page }) => {
    let accepted = false;

    await page.route("**/api/learning/proposals", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            userId: 1,
            observationId: 1,
            proposalType: "format_distribution",
            targetScope: "channel:linkedin;format:carousel",
            title: "Consider increasing carousel content on linkedin",
            rationale: "Observed: carousel content on linkedin showed 48.2% higher average engagements compared to the channel baseline across 6 publications.",
            expectedImpactHypothesis: "Prioritizing carousel format for upcoming linkedin opportunities is expected to maintain above-average engagement.",
            evidenceQuality: "directional",
            evidenceSummary: {
              sampleCount: 6,
              candidateValue: "52.00",
              baselineValue: "35.10",
              differencePercentage: "48.2",
              publicationIds: [201, 202, 203, 204, 205, 206],
            },
            status: accepted ? "accepted" : "proposed",
            reviewedAt: accepted ? new Date().toISOString() : null,
            reviewedBy: accepted ? 1 : null,
            reviewNotes: null,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.route("**/api/learning/proposals/101/accept", (route) => {
      accepted = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 101,
          status: "accepted",
          reviewedAt: new Date().toISOString(),
          reviewedBy: 1,
        }),
      });
    });

    await page.goto("/insights?view=learning");

    // Click Accept button
    const acceptBtn = page.locator('[data-testid="button-accept-proposal-101"]');
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // Verify accepted badge is rendered
    await expect(page.locator('[data-testid="badge-status-accepted-101"]')).toBeVisible();
    await expect(page.locator('[data-testid="badge-status-accepted-101"]')).toContainText("Accepted (Human Reviewed)");
  });

  test("Journey D: Accessibility audit passes on learning surface with zero violations", async ({ page }) => {
    await page.route("**/api/learning/proposals", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            userId: 1,
            observationId: 1,
            proposalType: "format_distribution",
            targetScope: "channel:linkedin;format:carousel",
            title: "Consider increasing carousel content on linkedin",
            rationale: "Observed: carousel content on linkedin showed 48.2% higher average engagements compared to the channel baseline across 6 publications.",
            expectedImpactHypothesis: "Prioritizing carousel format for upcoming linkedin opportunities is expected to maintain above-average engagement.",
            evidenceQuality: "directional",
            evidenceSummary: {
              sampleCount: 6,
              candidateValue: "52.00",
              baselineValue: "35.10",
              differencePercentage: "48.2",
            },
            status: "proposed",
            reviewedAt: null,
            reviewedBy: null,
            reviewNotes: null,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/insights?view=learning");
    await expect(page.locator('[data-testid="container-learning-view"]')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"]) // match project's standard accessibility test pattern
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
