import { test, expect, devices } from "@playwright/test";

const viewports = [
  { name: "desktop", ...devices["Desktop Chrome"].viewport },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
];

for (const viewport of viewports) {
  test(`Quick Capture stays fixed and reachable at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    const button = page.getByRole("button", { name: "Quick capture" });
    await expect(button).toBeVisible();

    const position = await button.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe("fixed");

    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }

    await button.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}
