import { test, expect } from "@playwright/test";

/** Logged-in smoke: each primary route renders its page chrome. */
const routes: { path: string; selector: string }[] = [
  { path: "/", selector: '[data-testid="text-page-title"]' },
  { path: "/calendar", selector: '[data-testid="text-calendar-title"]' },
  { path: "/ideas", selector: '[data-testid="text-ideas-title"]' },
  { path: "/templates", selector: '[data-testid="text-templates-title"]' },
  { path: "/analytics", selector: '[data-testid="text-analytics-title"]' },
  { path: "/settings", selector: '[data-testid="text-settings-title"]' },
  { path: "/articles", selector: '[data-testid="text-articles-title"]' },
  { path: "/references", selector: '[data-testid="text-references-title"]' },
  { path: "/discover", selector: '[data-testid="text-discover-title"]' },
  { path: "/ingest", selector: '[data-testid="text-ingest-title"]' },
  { path: "/images", selector: '[data-testid="text-imagegen-title"]' },
  { path: "/vault", selector: '[data-testid="text-vault-title"]' },
  { path: "/hooks", selector: '[data-testid="text-hooks-title"]' },
  { path: "/carousel", selector: '[data-testid="text-carousel-title"]' },
  { path: "/chat", selector: '[data-testid="text-chat-title"]' },
  { path: "/queue", selector: '[data-testid="text-queue-title"]' },
  { path: "/ai-usage", selector: '[data-testid="text-ai-usage-title"]' },
];

for (const { path, selector } of routes) {
  test(`route ${path || "/"} loads`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(selector)).toBeVisible({ timeout: 30_000 });
  });
}

test("sidebar navigation: Discover link works", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible();
  await page.locator('[data-testid="link-nav-discover"]').click();
  await expect(page.locator('[data-testid="text-discover-title"]')).toBeVisible();
});

test("auth page shows when logged out (fresh context)", async ({ browser, baseURL }) => {
  // Create a context with no storageState (no session cookies) but with the correct baseURL.
  const ctx = await browser.newContext({ baseURL: baseURL ?? "http://127.0.0.1:4173" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator('[data-testid="text-auth-title"]')).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});
