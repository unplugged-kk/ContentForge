import { test, expect } from "@playwright/test";

test("Path A: agent workspace discovers backends and renders", async ({ page }) => {
  await page.goto("/agent");
  await expect(page.locator('[data-testid="text-agent-workspace-title"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="copilotkit-agent-workspace"]')).toBeVisible();
  await expect(page.locator('[data-testid="textarea-agent-composer"]')).toBeVisible();
  await expect(page.locator('[data-testid="select-agent-backend"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-agent-capabilities"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-style-intelligence"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-repurposing"]')).toBeVisible();
});
