import { test, expect } from "@playwright/test";

/** Logged-in smoke: canonical and compatibility routes render their page chrome. */
const routes: { path: string; selector: string }[] = [
  // Canonical routes
  { path: "/", selector: '[data-testid="page-header-today"]' },
  { path: "/today", selector: '[data-testid="page-header-today"]' },
  { path: "/create", selector: '[data-testid="page-header-create"]' },
  { path: "/sources", selector: '[data-testid="page-header-sources"]' },
  { path: "/agent", selector: '[data-testid="text-agent-workspace-title"]' },
  { path: "/schedule", selector: '[data-testid="page-header-schedule"]' },
  { path: "/insights", selector: '[data-testid="page-header-insights"]' },
  { path: "/settings", selector: '[data-testid="text-settings-title"]' },

  // Compatibility / legacy routes
  { path: "/generate", selector: '[data-testid="text-page-title"]' },
  { path: "/calendar", selector: '[data-testid="page-header-schedule"]' },
  { path: "/ideas", selector: '[data-testid="text-ideas-title"]' },
  { path: "/templates", selector: '[data-testid="text-templates-title"]' },
  { path: "/analytics", selector: '[data-testid="page-header-insights"]' },
  { path: "/articles", selector: '[data-testid="text-articles-title"]' },
  { path: "/references", selector: '[data-testid="page-header-sources"]' },
  { path: "/discover", selector: '[data-testid="text-discover-title"]' },
  { path: "/ingest", selector: '[data-testid="text-ingest-title"]' },
  { path: "/images", selector: '[data-testid="text-imagegen-title"]' },
  { path: "/vault", selector: '[data-testid="text-vault-title"]' },
  { path: "/hooks", selector: '[data-testid="text-hooks-title"]' },
  { path: "/carousel", selector: '[data-testid="text-carousel-title"]' },
  { path: "/chat", selector: '[data-testid="text-chat-title"]' },
  { path: "/formatter", selector: '[data-testid="text-formatter-title"]' },
  { path: "/canned-responses", selector: '[data-testid="text-canned-responses-title"]' },
  { path: "/youtube", selector: '[data-testid="text-youtube-title"]' },
  { path: "/queue", selector: '[data-testid="page-header-schedule"]' },
  { path: "/ai-usage", selector: '[data-testid="page-header-insights"]' },
];

for (const { path, selector } of routes) {
  test(`route ${path || "/"} loads`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(selector)).toBeVisible({ timeout: 30_000 });
  });
}

test("sidebar navigation: exactly 7 canonical links and navigation works", async ({ page }) => {
  await page.goto("/today");
  await expect(page.locator('[data-testid="page-header-today"]')).toBeVisible();

  // Exactly 7 items in the primary navigation
  const navLinks = page.locator('nav[aria-label="Primary"] a[data-testid^="link-nav-"]');
  await expect(navLinks).toHaveCount(7);

  // Navigate to Sources
  await page.locator('[data-testid="link-nav-sources"]').click();
  await expect(page.locator('[data-testid="page-header-sources"]')).toBeVisible();
  await expect(page).toHaveURL(/\/sources/);

  // Navigate to Schedule
  await page.locator('[data-testid="link-nav-schedule"]').click();
  await expect(page.locator('[data-testid="page-header-schedule"]')).toBeVisible();
  await expect(page).toHaveURL(/\/schedule/);

  // Navigate to Create
  await page.locator('[data-testid="link-nav-create"]').click();
  await expect(page.locator('[data-testid="page-header-create"]')).toBeVisible();
  await expect(page).toHaveURL(/\/create/);
});
