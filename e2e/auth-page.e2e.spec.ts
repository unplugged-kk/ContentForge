import { test, expect } from "@playwright/test";

/**
 * Runs in the "no-auth" project — no storageState, no session cookies.
 * Verifies the login page is shown when the user is not authenticated.
 */
test("auth page shows when not logged in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid="text-auth-title"]')).toBeVisible({ timeout: 30_000 });
});
