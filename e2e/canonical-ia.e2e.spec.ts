import { test, expect } from "@playwright/test";

test.describe("Phase 28.2B — Canonical Information Architecture & Product Shell", () => {
  test("root / redirects to /today and displays Today page header", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/today/);
    await expect(page.locator('[data-testid="page-header-today"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-page-title"]')).toHaveText("Today");
  });

  test("sidebar primary navigation contains exactly the 7 canonical destinations", async ({ page }) => {
    await page.goto("/today");
    const primaryNav = page.locator('nav[aria-label="Primary"]');
    await expect(primaryNav).toBeVisible();

    const expectedDestinations = [
      { id: "today", label: "Today", url: "/today" },
      { id: "create", label: "Create", url: "/create" },
      { id: "sources", label: "Sources", url: "/sources" },
      { id: "agent", label: "Agent", url: "/agent" },
      { id: "schedule", label: "Schedule", url: "/schedule" },
      { id: "insights", label: "Insights", url: "/insights" },
      { id: "settings", label: "Settings", url: "/settings" },
    ];

    const navLinks = primaryNav.locator('a[data-testid^="link-nav-"]');
    await expect(navLinks).toHaveCount(7);

    for (const dest of expectedDestinations) {
      const link = primaryNav.locator(`[data-testid="link-nav-${dest.id}"]`);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", dest.url);
      await expect(link).toContainText(dest.label);
    }
  });

  test("route-aware active states activate canonical parent on legacy routes", async ({ page }) => {
    // Legacy Create route activates Create
    await page.goto("/hooks");
    await expect(page.locator('[data-testid="link-nav-create"]')).toHaveAttribute("aria-current", "page");

    // Legacy Schedule route activates Schedule
    await page.goto("/queue");
    await expect(page.locator('[data-testid="link-nav-schedule"]')).toHaveAttribute("aria-current", "page");

    // Legacy Sources route activates Sources
    await page.goto("/discover");
    await expect(page.locator('[data-testid="link-nav-sources"]')).toHaveAttribute("aria-current", "page");

    // Legacy Insights route activates Insights
    await page.goto("/analytics");
    await expect(page.locator('[data-testid="link-nav-insights"]')).toHaveAttribute("aria-current", "page");
  });

  test("Create modes bar is visible and provides links to specialized creation modes", async ({ page }) => {
    await page.goto("/create");
    await expect(page.locator('[data-testid="page-header-create"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-create-modes"]')).toBeVisible();

    const modes = ["post-thread", "hooks", "carousel", "images", "articles", "templates", "formatter", "canned-responses", "chat-post"];
    for (const mode of modes) {
      await expect(page.locator(`[data-testid="link-create-mode-${mode}"]`)).toBeVisible();
    }
  });

  test("Schedule view switcher toggles between Queue and Calendar", async ({ page }) => {
    await page.goto("/schedule");
    await expect(page.locator('[data-testid="page-header-schedule"]')).toBeVisible();
    await expect(page.locator('[data-testid="tabs-schedule-views"]')).toBeVisible();

    // Default is Queue
    await expect(page.locator('[data-testid="alert-queue-x-compliance"]')).toBeVisible();

    // Toggle to Calendar
    await page.locator('[data-testid="tab-trigger-calendar"]').click();
    await expect(page.locator('[data-testid="button-best-times"]')).toBeVisible();

    // Toggle back to Queue
    await page.locator('[data-testid="tab-trigger-queue"]').click();
    await expect(page.locator('[data-testid="alert-queue-x-compliance"]')).toBeVisible();
  });

  test("Insights view switcher toggles between Analytics and AI Usage", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.locator('[data-testid="page-header-insights"]')).toBeVisible();
    await expect(page.locator('[data-testid="tabs-insights-views"]')).toBeVisible();

    // Toggle to AI Usage
    await page.locator('[data-testid="tab-trigger-ai-usage"]').click();
    await expect(page.locator('[data-testid="container-ai-usage"]')).toBeVisible();

    // Toggle back to Analytics
    await page.locator('[data-testid="tab-trigger-analytics"]').click();
    await expect(page.locator('[data-testid="container-analytics"]')).toBeVisible();
  });

  test("Sources view switcher toggles between Discover, Ideas, Ingest, Vault, and References", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.locator('[data-testid="page-header-sources"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-sources-views"]')).toBeVisible();

    // Default is Discover
    await expect(page.locator('[data-testid="text-discover-title"]')).toBeVisible();

    // Switch to Ideas
    await page.locator('[data-testid="tab-sources-view-ideas"]').click();
    await expect(page.locator('[data-testid="text-ideas-title"]')).toBeVisible();

    // Switch to Vault
    await page.locator('[data-testid="tab-sources-view-vault"]').click();
    await expect(page.locator('[data-testid="text-vault-title"]')).toBeVisible();
  });

  test("Quick Capture is globally accessible from Sources header", async ({ page }) => {
    await page.goto("/sources");
    const qcAction = page.locator('[data-testid="button-sources-quick-capture"]');
    await expect(qcAction).toBeVisible();
    await qcAction.click();
    await expect(page.locator('[data-testid="dialog-quick-capture"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-quick-capture-url"]')).toBeVisible();
  });

  test("404 page provides obvious return route to /today", async ({ page }) => {
    await page.goto("/completely-unknown-route");
    const backBtn = page.locator('[data-testid="button-back-to-today"]');
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(page).toHaveURL(/\/today/);
    await expect(page.locator('[data-testid="page-header-today"]')).toBeVisible();
  });

  // Responsive shell tests
  const viewports = [
    { name: "Desktop", width: 1440, height: 900 },
    { name: "Tablet", width: 820, height: 1180 },
    { name: "Mobile", width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    test(`canonical shell remains functional and readable at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/today");
      await expect(page.locator('[data-testid="page-header-today"]')).toBeVisible();

      // Quick Capture floating button remains visible
      await expect(page.locator('[data-testid="button-quick-capture"]')).toBeVisible();

      // Ensure no horizontal scroll blowout on body
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    });
  }
});
