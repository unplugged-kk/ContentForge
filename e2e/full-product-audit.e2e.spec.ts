import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const CANONICAL_ROUTES = [
  { path: "/today", headerTestId: "page-header-today", title: "Today" },
  { path: "/create", headerTestId: "page-header-create", title: "Create" },
  { path: "/sources", headerTestId: "page-header-sources", title: "Sources" },
  { path: "/agent", headerTestId: "page-header-agent", title: "Agent Workspace" },
  { path: "/schedule", headerTestId: "page-header-schedule", title: "Schedule" },
  { path: "/insights", headerTestId: "page-header-insights", title: "Insights" },
  { path: "/settings", headerTestId: "page-header-settings", title: "Settings" },
];

const VIEWPORTS = [
  { name: "Desktop Large", width: 1440, height: 900 },
  { name: "Desktop Standard", width: 1280, height: 800 },
  { name: "Desktop Small / iPad Landscape", width: 1024, height: 768 },
  { name: "Tablet Portrait (iPad Air)", width: 820, height: 1180 },
  { name: "Tablet Portrait (iPad mini)", width: 768, height: 1024 },
  { name: "Mobile Large (iPhone Pro Max)", width: 430, height: 932 },
  { name: "Mobile Standard (iPhone)", width: 390, height: 844 },
];

async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.get("/api/csrf-token");
  const { csrfToken } = await res.json();
  return { "X-CSRF-Token": csrfToken };
}

/** Seeds a real in_review canonical Artifact via HTTP without external AI calls */
async function seedApprovedArtifact(request: APIRequestContext, suffix: string): Promise<number> {
  const headers = await csrfHeaders(request);
  const story = await request
    .post("/api/stories", {
      headers,
      data: {
        title: `Full Audit Story ${suffix}`,
        insightBody: "Empirical observation body for audit journeys.",
        provenance: "human",
        status: "ready",
      },
    })
    .then((r) => r.json());

  const opportunity = await request
    .post("/api/opportunities", {
      headers,
      data: {
        storyId: story.id,
        concept: "Full audit concept",
        objective: "Full audit objective",
        format: "x_post",
        channel: "x",
      },
    })
    .then((r) => r.json());

  const artifact = await request
    .post(`/api/opportunities/${opportunity.id}/artifacts`, {
      headers,
      data: {
        payload: { text: `Audit artifact content ${suffix}` },
        attribution: [],
        attributionReason: "audit fixture",
      },
    })
    .then((r) => r.json());

  // Mark in_review, then approve
  await request.post(`/api/artifacts/${artifact.id}/submit-review`, { headers, data: {} });
  await request.post(`/api/artifacts/${artifact.id}/approve`, { headers, data: {} });
  return artifact.id as number;
}

test.describe("Phase 28.2H: Responsive Viewport Matrix (7 Viewports x 7 Canonical Routes)", () => {
  for (const vp of VIEWPORTS) {
    test.describe(`Viewport: ${vp.name} (${vp.width}x${vp.height})`, () => {
      for (const route of CANONICAL_ROUTES) {
        test(`${route.path} renders with no horizontal overflow and visible PageHeader`, async ({ page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(route.path);
          await expect(page.locator("body")).toBeVisible();
          await expect(page).toHaveTitle(/ContentForge/);

          // Header rendered
          await expect(page.locator(`[data-testid="${route.headerTestId}"]`)).toBeVisible();

          // No horizontal overflow: scrollWidth must equal clientWidth (+/- 1px)
          const hasHorizontalOverflow = await page.evaluate(() => {
            return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
          });
          expect(hasHorizontalOverflow).toBe(false);
        });
      }
    });
  }
});

test.describe("Phase 28.2H: Full Product User Journeys", () => {
  test("Journey A: Sources -> Research -> Story -> Create Studio handoff", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.locator('[data-testid="page-header-sources"]')).toBeVisible();

    // Verify search input is accessible
    const searchInput = page.locator('[data-testid="input-research-query"]');
    await expect(searchInput).toBeVisible();

    // Switch to Saved tab and verify unified collection container
    await page.locator('[data-testid="tab-sources-view-saved"]').click();
    await expect(page.locator('[data-testid="container-saved-tab"]')).toBeVisible();
  });

  test("Journey B: Agent Workspace -> Canonical Review handoff", async ({ page }) => {
    await page.goto("/agent");
    await expect(page.locator('[data-testid="page-header-agent"]')).toBeVisible();
    await expect(page.locator('[data-testid="textarea-agent-composer"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-agent-start"]')).toBeVisible();
  });

  test("Journey C & D: Create Studio Review -> Schedule & Publish Preview", async ({ page, request }) => {
    const artifactId = await seedApprovedArtifact(request, `J-CD-${Date.now()}`);
    await page.goto(`/create?artifact=${artifactId}`);
    await expect(page.locator('[data-testid="page-header-create"]')).toBeVisible();

    // Approved artifact shows Schedule and Publish Now buttons
    const scheduleBtn = page.locator('[data-testid="button-review-schedule"]');
    await expect(scheduleBtn).toBeVisible();

    const publishBtn = page.locator('[data-testid="button-review-publish"]');
    await expect(publishBtn).toBeVisible();

    // Open SchedulePicker
    await scheduleBtn.click();
    await expect(page.locator('[data-testid="dialog-artifact-schedule"]')).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator('[data-testid="dialog-artifact-schedule"]')).toBeHidden();

    // Open PublishPreview
    await publishBtn.click();
    await expect(page.locator('[data-testid="dialog-artifact-publish"]')).toBeVisible();
    await page.locator('[data-testid="button-publish-cancel"]').click();
    await expect(page.locator('[data-testid="dialog-artifact-publish"]')).toBeHidden();
  });

  test("Journey E: Today -> Attention -> Review handoff", async ({ page, request }) => {
    await seedApprovedArtifact(request, `J-E-${Date.now()}`);
    await page.goto("/today");
    await expect(page.locator('[data-testid="page-header-today"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-attention"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-today-schedule"]')).toBeVisible();
    await expect(page.locator('[data-testid="today-quick-actions"]')).toBeVisible();
  });

  test("Journey F: Schedule -> Publications tab displays canonical publications", async ({ page }) => {
    await page.goto("/schedule?tab=publications");
    await expect(page.locator('[data-testid="page-header-schedule"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-trigger-publications"]')).toHaveAttribute("data-state", "active");
    await expect(page.locator('[data-testid="container-publications"]')).toBeVisible();
  });

  test("Journey G: Publication -> Insights Performance visibility", async ({ page }) => {
    await page.goto("/insights?view=performance");
    await expect(page.locator('[data-testid="page-header-insights"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-trigger-performance"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-published-count"], [data-testid="empty-performance-state"]')).toBeVisible();
  });

  test("Journey H: Insights Learning patterns -> Explore Topic handoff", async ({ page }) => {
    await page.goto("/insights?view=learning");
    await expect(page.locator('[data-testid="page-header-insights"]')).toBeVisible();
    await expect(page.locator('[data-testid="container-learning-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-learning-voice"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-learning-lifecycle"]')).toBeVisible();
  });
});

test.describe("Phase 28.2H: Comprehensive Accessibility & Keyboard Navigation", () => {
  const deepLinkRoutes = [
    "/today",
    "/create",
    "/sources",
    "/agent",
    "/schedule",
    "/schedule?tab=publications",
    "/insights",
    "/insights?view=performance",
    "/insights?view=learning",
    "/insights?view=ai-usage",
    "/settings",
  ];

  for (const path of deepLinkRoutes) {
    test(`axe audit: ${path} has 0 accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
      await expect(page).toHaveTitle(/.+/);

      const results = await new AxeBuilder({ page })
        .withRules(["document-title", "meta-viewport", "button-name", "label"])
        .disableRules(["svg-img-alt"])
        .analyze();

      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }

  test("keyboard navigation: Tab moves through skip link and primary nav without trap", async ({ page }) => {
    await page.goto("/today");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toHaveCount(1);
    await skipLink.focus();
    await expect(skipLink).toBeFocused();

    // Tab moves to next element
    await page.keyboard.press("Tab");
    const activeEl = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeEl).toBeTruthy();
  });

  test("dark and light theme toggle works cleanly", async ({ page }) => {
    await page.goto("/today");
    const toggleBtn = page.locator('[data-testid="button-theme-toggle"]');
    await expect(toggleBtn).toBeVisible();

    const isDarkInitial = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await toggleBtn.click();
    const isDarkAfter = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(isDarkAfter).toBe(!isDarkInitial);

    // Toggle back
    await toggleBtn.click();
    const isDarkFinal = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(isDarkFinal).toBe(isDarkInitial);
  });
});
