import { test, expect } from "@playwright/test";

/**
 * Runs in the "no-auth" project — no storageState, no session cookies.
 *
 * `/` is a PUBLIC marketing page (2026-11): an anonymous visitor gets the site,
 * a signed-in visitor is redirected to the app. The auth gate therefore applies
 * to app routes, not to the landing page.
 */
test("anonymous visitor gets the public site, and app routes show the auth gate", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Content Intelligence/);

  await page.goto("/today");
  await expect(page.locator('[data-testid="text-auth-title"]')).toBeVisible({ timeout: 30_000 });
});
