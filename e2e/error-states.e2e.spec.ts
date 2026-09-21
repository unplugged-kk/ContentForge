import { test, expect, type Page } from "@playwright/test";

async function force500(page: Page, urlPattern: string | RegExp) {
  await page.route(urlPattern, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "forced failure" }) }),
  );
}

const surfaces: { name: string; path: string; api: RegExp }[] = [
  { name: "Queue", path: "/queue", api: /\/api\/posts\/queue\/today(\?.*)?$/ },
  { name: "Calendar", path: "/calendar", api: /\/api\/posts(\?.*)?$/ },
  { name: "Analytics", path: "/analytics", api: /\/api\/analytics\/summary(\?.*)?$/ },
  { name: "Discover", path: "/discover", api: /\/api\/discover\/ideas(\?.*)?$/ },
  { name: "References", path: "/references", api: /\/api\/references(\?.*)?$/ },
  { name: "Vault", path: "/vault", api: /\/api\/vault(\?.*)?$/ },
  { name: "Settings", path: "/settings", api: /\/api\/accounts(\?.*)?$/ },
];

for (const surface of surfaces) {
  test(`${surface.name}: forced 500 shows ErrorState with working retry, not empty state`, async ({ page }) => {
    await force500(page, surface.api);
    await page.goto(surface.path);

    const errorState = page.locator('[data-testid="error-state"]');
    await expect(errorState).toBeVisible({ timeout: 15_000 });

    // Unmock, then retry should recover into a real (non-error) render.
    await page.unroute(surface.api);
    await page.locator('[data-testid="button-error-state-retry"]').click();
    await expect(errorState).toBeHidden({ timeout: 15_000 });
  });
}

test("Agent Workspace: forced 500 on run history shows ErrorState", async ({ page }) => {
  await force500(page, /\/api\/agent\/runs(\?.*)?$/);
  await page.goto("/agent");
  await expect(page.locator('[data-testid="list-agent-runs"] [data-testid="error-state"]')).toBeVisible({ timeout: 15_000 });
});
