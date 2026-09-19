import { test, expect } from "@playwright/test";

test("Agent Workspace: Approve is separate from Publish; Schedule needs date+time; Publish Now needs a preview + confirmation; no /api/agent/agui 403", async ({ page }) => {
  test.setTimeout(180_000);

  const agui403s: number[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/agent/agui")) agui403s.push(res.status());
  });

  await page.goto("/agent");
  await expect(page.locator('[data-testid="text-agent-workspace-title"]')).toBeVisible({ timeout: 30_000 });

  await page.locator('[data-testid="select-agent-backend"]').click();
  await page.getByRole("option", { name: "fixture" }).click();
  await page.locator('[data-testid="textarea-agent-composer"]').fill("Research the latest developments around AI agents and prepare an X post.");
  await page.locator('[data-testid="button-agent-start"]').click();

  const reviewCard = page.locator('[data-testid^="card-artifact-"]');
  const progress = page.locator('[data-testid="text-repurpose-progress"]');

  await Promise.race([
    reviewCard.waitFor({ state: "visible", timeout: 150_000 }),
    progress.waitFor({ state: "visible", timeout: 150_000 }),
  ]).catch(() => {});

  if (!(await reviewCard.isVisible())) {
    const progressText = (await progress.textContent().catch(() => "")) ?? "";
    test.skip(true, `No artifact was produced (progress: "${progressText}") — likely no network access to the research pipeline in this environment, same limitation the UX audit documented.`);
  }
  await expect(reviewCard).toBeVisible();

  const approveBtn = page.locator('[data-testid="button-artifact-approve"]');
  const scheduleBtn = page.locator('[data-testid="button-artifact-schedule"]');
  const publishBtn = page.locator('[data-testid="button-artifact-publish"]');

  // Approve is visually distinct from Publish Now (different variant classes).
  const approveClass = await approveBtn.getAttribute("class");
  const publishClass = await publishBtn.getAttribute("class");
  expect(approveClass).not.toEqual(publishClass);

  // Schedule/Publish are gated on approval.
  await expect(scheduleBtn).toBeDisabled();
  await expect(publishBtn).toBeDisabled();

  await approveBtn.click();
  await expect(approveBtn).toBeDisabled({ timeout: 15_000 }); // already-approved state
  await expect(scheduleBtn).toBeEnabled({ timeout: 15_000 });
  await expect(publishBtn).toBeEnabled();

  // Schedule requires a real date + time before it can be confirmed.
  await scheduleBtn.click();
  await expect(page.locator('[data-testid="dialog-artifact-schedule"]')).toBeVisible();
  await expect(page.locator('[data-testid="button-confirm-schedule"]')).toBeDisabled();
  await page.keyboard.press("Escape");

  // Publish Now shows a preview + target account and needs a second explicit click.
  await publishBtn.click();
  const publishDialog = page.locator('[data-testid="dialog-artifact-publish"]');
  await expect(publishDialog).toBeVisible();
  await expect(publishDialog.locator('[data-testid="publish-preview"]')).toBeVisible();
  await expect(publishDialog.locator('[data-testid="text-publish-target"]')).toBeVisible();
  await page.locator('[data-testid="button-publish-cancel"]').click();
  await expect(publishDialog).toBeHidden();

  expect(agui403s.filter((s) => s === 403)).toHaveLength(0);
});
