import { test, expect, type Page } from "@playwright/test";

async function force500(page: Page, urlPattern: string | RegExp) {
  await page.route(urlPattern, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "forced failure" }) }),
  );
}

/**
 * Forced-500 → ErrorState coverage, per surface.
 *
 * These paths are the CANONICAL surfaces. Legacy URLs still redirect into them
 * (`/queue` → `/schedule?tab=queue`, `/references` → `/sources?view=references`,
 * see client/src/lib/legacy-route-mapping.ts), so a legacy path is exercised the
 * same way — but the mocked API must be the one the surface ACTUALLY calls.
 *
 * Discover is deliberately absent. It was `/discover`, mocking
 * `/api/discover/ideas`; that endpoint is gone, and the discover capability now
 * lives in `/sources?view=discover`, where the error states are JOB-scoped
 * (a failed research run, or a failed sources read for an active job) rather
 * than a failed list fetch. Reaching them needs an active research job, so
 * expressing the old row would assert something the UI cannot do. Covering that
 * job-scoped path is a follow-up, not a rename.
 */
const surfaces: { name: string; path: string; api: RegExp }[] = [
  { name: "Queue", path: "/schedule?tab=queue", api: /\/api\/posts\/queue\/today(\?.*)?$/ },
  { name: "Calendar", path: "/schedule?tab=calendar", api: /\/api\/posts(\?.*)?$/ },
  { name: "Analytics", path: "/insights?view=performance", api: /\/api\/analytics\/summary(\?.*)?$/ },
  { name: "References", path: "/sources?view=references", api: /\/api\/references(\?.*)?$/ },
  { name: "Vault", path: "/sources?view=vault", api: /\/api\/vault(\?.*)?$/ },
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
