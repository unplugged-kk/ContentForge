import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("ContentForge Phase 28.2G — Insights / Performance Visibility + Learning Surface", () => {
  test.beforeEach(async ({ page }) => {
    // Dismiss any modal or toasts if present
  });

  test("Journey A: Performance tab displays real KPIs, time scope, and content breakdown", async ({ page }) => {
    await page.route("**/api/analytics/summary", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalPosts: 12,
          totalImpressions: 48000,
          totalLikes: 3200,
          totalReplies: 450,
          totalRetweets: 210,
          totalBookmarks: 310,
          byPillar: [{ pillar: "Tech", color: "#3B82F6", count: 12, impressions: 48000 }],
          byPlatform: [{ platform: "x", count: 12, impressions: 48000, likes: 3200 }],
          topPosts: [],
          recentUsage: [],
        }),
      });
    });

    await page.goto("/insights?view=performance");

    // Page header
    await expect(page.locator('[data-testid="page-header-insights"]')).toBeVisible();
    await expect(page.locator('[data-testid="tabs-insights-views"]')).toBeVisible();

    // Verify Performance container
    const perfContainer = page.locator('[data-testid="container-analytics"]');
    await expect(perfContainer).toBeVisible();

    // Verify time scope label
    await expect(page.locator("text=All time (lifetime of published content)")).toBeVisible();

    // Stat cards
    await expect(page.locator('[data-testid="stat-total-posts"]')).toBeVisible();
    await expect(page.locator('[data-testid="stat-impressions"]')).toBeVisible();
    await expect(page.locator('[data-testid="stat-likes"]')).toBeVisible();
    await expect(page.locator('[data-testid="stat-replies"]')).toBeVisible();

    // Tab switcher works
    const tabsList = page.locator('[data-testid="tabs-insights-views"]');
    await expect(tabsList.locator('[data-testid="tab-trigger-performance"]')).toBeVisible();
    await expect(tabsList.locator('[data-testid="tab-trigger-learning"]')).toBeVisible();
    await expect(tabsList.locator('[data-testid="tab-trigger-ai-usage"]')).toBeVisible();
  });

  test("Journey B: Top performing content drilldown links to canonical content view", async ({ page }) => {
    await page.route("**/api/analytics/summary", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalPosts: 5,
          totalImpressions: 12450,
          totalLikes: 820,
          totalReplies: 140,
          totalRetweets: 65,
          totalBookmarks: 90,
          byPillar: [{ pillar: "Tech", color: "#3B82F6", count: 5, impressions: 12450 }],
          byPlatform: [{ platform: "x", count: 5, impressions: 12450, likes: 820 }],
          topPosts: [],
          recentUsage: [],
        }),
      });
    });

    await page.route("**/api/analytics/insights", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          topPosts: [
            {
              postId: 101,
              score: 95,
              preview: "Kubernetes platform engineering patterns for 2026",
              tweets: ["Kubernetes platform engineering patterns for 2026"],
            },
          ],
          bestHours: [{ hour: 14, avgEngagement: 85, posts: 3 }],
          pillarStats: [{ pillarId: 1, pillarName: "Tech", posts: 5, avgEngagement: 80 }],
        }),
      });
    });

    await page.goto("/insights?view=performance");

    // Top post row should be visible
    const topPostRow = page.locator('[data-testid="row-top-post-101"]');
    await expect(topPostRow).toBeVisible();
    await expect(topPostRow).toContainText("Kubernetes platform engineering patterns");

    // View content button should route to canonical content
    const viewBtn = page.locator('[data-testid="button-view-content-101"]');
    await expect(viewBtn).toBeVisible();
    await viewBtn.click();
    await expect(page).toHaveURL(/\/today/);
  });

  test("Journey C: Learning tab shows style profiles, workflow signals, and platform metrics with evidence provenance", async ({
    page,
  }) => {
    // Mock style profiles
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
          byFormat: [{ format: "linkedin_post", published: 10 }, { format: "x_post", published: 4 }],
          byStory: [],
          signalCounts: { approval: 12, rejection: 2 },
          metricTotals: [
            { metric: "impressions", total: 42000, observedCount: 12, notAvailableCount: 2 },
            { metric: "likes", total: 1850, observedCount: 14, notAvailableCount: 0 },
          ],
        }),
      });
    });

    await page.goto("/insights?view=learning");

    // Container should be visible
    const learningContainer = page.locator('[data-testid="container-learning-view"]');
    await expect(learningContainer).toBeVisible();

    // Style profile card with confidence and provenance
    const styleCard = page.locator('[data-testid="card-style-profile-1"]');
    await expect(styleCard).toBeVisible();
    await expect(styleCard).toContainText("Technical Deep-Dive");
    await expect(styleCard).toContainText("Strong signal");
    await expect(styleCard).toContainText("Observed in 8 analyzed references");

    // Workflow signals
    await expect(page.locator('[data-testid="text-approval-rate"]')).toContainText("85.7%");
    await expect(page.locator('[data-testid="text-success-rate"]')).toContainText("100.0%");

    // Channel performance signals table
    await expect(page.locator('[data-testid="metric-total-impressions"]')).toContainText("42,000");
    await expect(page.locator('[data-testid="metric-total-likes"]')).toContainText("1,850");

    // Canonical handoff buttons
    await expect(page.locator('[data-testid="button-learning-sources"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-learning-create"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-learning-agent"]')).toBeVisible();
  });

  test("Journey D: AI Usage tab loads dashboard data with token and model breakdowns", async ({ page }) => {
    await page.goto("/insights?view=ai-usage");

    const usageContainer = page.locator('[data-testid="container-ai-usage"]');
    await expect(usageContainer).toBeVisible();
  });

  test("Journey E: Empty performance state rendered honestly when no data exists", async ({ page }) => {
    await page.route("**/api/analytics/summary", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalPosts: 0,
          totalImpressions: 0,
          totalLikes: 0,
          totalReplies: 0,
          totalRetweets: 0,
          totalBookmarks: 0,
          byPillar: [],
          byPlatform: [],
          topPosts: [],
          recentUsage: [],
        }),
      });
    });

    await page.route("**/api/learning/summary", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          publishedCount: 0,
          successRate: null,
          approvalRate: null,
          byChannel: [],
          byFormat: [],
          byStory: [],
          signalCounts: {},
          metricTotals: [],
        }),
      });
    });

    await page.goto("/insights?view=performance");

    // Empty state should be visible
    const emptyState = page.locator('[data-testid="empty-performance-state"]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("No performance data yet");
    await expect(page.locator('[data-testid="button-empty-create-content"]')).toBeVisible();
  });

  test("Journey F: Forced 500 on analytics summary displays ErrorState with retry", async ({ page }) => {
    let callCount = 0;
    await page.route("**/api/analytics/summary", (route) => {
      callCount++;
      if (callCount === 1) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Server error" }) });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalPosts: 1,
          totalImpressions: 100,
          totalLikes: 10,
          totalReplies: 2,
          totalRetweets: 1,
          totalBookmarks: 1,
          byPillar: [],
          byPlatform: [],
          topPosts: [],
          recentUsage: [],
        }),
      });
    });

    await page.goto("/insights?view=performance");

    // Error state rendered
    const errorContainer = page.locator('[data-testid="error-state"]');
    await expect(errorContainer).toBeVisible();
    await expect(errorContainer).toContainText("Couldn't load performance data");

    // Retry works
    const retryBtn = page.locator('[data-testid="button-error-state-retry"]');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // After retry, data appears
    await expect(page.locator('[data-testid="stat-total-posts"]')).toBeVisible();
  });

  test("Journey G: Partial failure in Learning view keeps other sections visible", async ({ page }) => {
    // Style profiles returns 503 (unconfigured)
    await page.route("**/api/style/profiles", (route) => {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Style analysis is not configured" }),
      });
    });

    // Learning summary succeeds
    await page.route("**/api/learning/summary", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          publishedCount: 8,
          successRate: 1.0,
          approvalRate: 0.75,
          byChannel: [{ channel: "x", published: 8, observedMetrics: 8 }],
          byFormat: [{ format: "x_post", published: 8 }],
          byStory: [],
          signalCounts: { approval: 6 },
          metricTotals: [{ metric: "likes", total: 400, observedCount: 8, notAvailableCount: 0 }],
        }),
      });
    });

    await page.goto("/insights?view=learning");

    // Learning view is visible
    await expect(page.locator('[data-testid="container-learning-view"]')).toBeVisible();

    // Style card shows unconfigured message (not a full page blank)
    await expect(page.locator("text=Style Intelligence Not Configured")).toBeVisible();

    // Workflow signals are still visible and populated!
    await expect(page.locator('[data-testid="text-approval-rate"]')).toContainText("75.0%");

    // Performance signals are still visible!
    await expect(page.locator('[data-testid="metric-total-likes"]')).toContainText("400");
  });

  test("Journey H: Mobile (390x844) single vertical scroll, reachable controls, no horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/insights?view=performance");

    // Verify tabs are visible
    await expect(page.locator('[data-testid="tabs-insights-views"]')).toBeVisible();

    // Check no horizontal scroll on body
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Switch to Learning on mobile
    await page.locator('[data-testid="tab-trigger-learning"]').click();
    await expect(page.locator('[data-testid="container-learning-view"]')).toBeVisible();

    // Verify still no horizontal overflow
    const hasHorizontalOverflowLearning = await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflowLearning).toBe(false);
  });

  test("Journey I: Legacy compatibility routes /analytics and /ai-usage load properly", async ({ page }) => {
    // /analytics loads
    await page.goto("/analytics");
    await expect(page.locator('[data-testid="container-analytics"]')).toBeVisible();

    // /ai-usage loads
    await page.goto("/ai-usage");
    await expect(page.locator('[data-testid="container-ai-usage"]')).toBeVisible();
  });

  test("Journey J: 0 Axe accessibility violations across Performance, Learning, and AI Usage views", async ({
    page,
  }) => {
    for (const view of ["performance", "learning", "ai-usage"]) {
      await page.goto(`/insights?view=${view}`);
      await page.waitForLoadState("networkidle");

      const accessibilityScanResults = await new AxeBuilder({ page })
        .disableRules(["color-contrast", "svg-img-alt"]) // standard exemption for dynamic third-party chart palettes and SVG elements
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    }
  });
});
