import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = [
  "/",
  "/today",
  "/create",
  "/sources",
  "/agent",
  "/schedule",
  "/insights",
  "/settings",
  "/queue",
  "/calendar",
];

for (const path of routes) {
  test(`axe: ${path} has 0 document-title/meta-viewport/button-name/label violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withRules(["document-title", "meta-viewport", "button-name", "label"])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

test("axe: 404 page has 0 document-title/meta-viewport/button-name/label violations", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  const results = await new AxeBuilder({ page })
    .withRules(["document-title", "meta-viewport", "button-name", "label"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("app shell exposes a nav landmark and a skip link", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("nav")).toHaveCount(1);
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toHaveCount(1);
  await expect(page.locator("main#main-content")).toHaveCount(1);
});

test("route titles are meaningful and change per route", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveTitle(/ContentForge.*Today/);
  await page.goto("/create");
  await expect(page).toHaveTitle(/ContentForge.*Create/);
  await page.goto("/sources");
  await expect(page).toHaveTitle(/ContentForge.*Sources/);
  await page.goto("/schedule");
  await expect(page).toHaveTitle(/ContentForge.*Schedule/);
  await page.goto("/insights");
  await expect(page).toHaveTitle(/ContentForge.*Insights/);
  await page.goto("/settings");
  await expect(page).toHaveTitle(/ContentForge.*Settings/);
  await page.goto("/agent");
  await expect(page).toHaveTitle(/ContentForge.*Agent/);
  await page.goto("/queue");
  await expect(page).toHaveTitle(/ContentForge.*Queue/);
});

test("browser zoom is not disabled by the viewport meta tag", async ({ page }) => {
  await page.goto("/");
  const content = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(content ?? "").not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
  expect(content ?? "").not.toMatch(/user-scalable\s*=\s*no/);
});
