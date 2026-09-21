import { test, expect, type APIRequestContext } from "@playwright/test";

async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.get("/api/csrf-token");
  const { csrfToken } = await res.json();
  return { "X-CSRF-Token": csrfToken };
}

test("deleting an idea requires confirmation and only removes it after confirming", async ({ page, request }) => {
  const created = await request.post("/api/ideas", {
    data: { title: `E2E delete idea ${Date.now()}` },
    headers: await csrfHeaders(request),
  });
  expect(created.ok()).toBeTruthy();
  const idea = await created.json();

  await page.goto("/ideas");
  const card = page.locator(`[data-testid="card-idea-${idea.id}"]`);
  await expect(card).toBeVisible();

  // Cancel leaves the row intact.
  await page.locator(`[data-testid="button-delete-idea-${idea.id}"]`).click();
  await expect(page.locator('[data-testid="dialog-confirm"]')).toBeVisible();
  await page.locator('[data-testid="button-confirm-cancel"]').click();
  await expect(page.locator('[data-testid="dialog-confirm"]')).toBeHidden();
  await expect(card).toBeVisible();

  // Confirm actually deletes.
  await page.locator(`[data-testid="button-delete-idea-${idea.id}"]`).click();
  await expect(page.locator('[data-testid="dialog-confirm"]')).toBeVisible();
  await page.locator('[data-testid="button-confirm-action"]').click();
  await expect(card).toHaveCount(0);
});

test("deleting a reference requires confirmation", async ({ page, request }) => {
  const created = await request.post("/api/ingest", {
    data: { url: `https://example.com/e2e-${Date.now()}` },
    headers: await csrfHeaders(request),
  });
  test.skip(!created.ok(), "ingest endpoint requires network access to fetch the URL in this environment");
  const ref = await created.json();

  await page.goto("/references");
  await expect(page.locator(`[data-testid="button-delete-ref-${ref.id}"]`)).toBeVisible();
  await page.locator(`[data-testid="button-delete-ref-${ref.id}"]`).click();
  await expect(page.locator('[data-testid="dialog-confirm"]')).toBeVisible();
  await page.locator('[data-testid="button-confirm-cancel"]').click();
  await expect(page.locator(`[data-testid="button-delete-ref-${ref.id}"]`)).toBeVisible();
});
