import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * A destructive action must require an explicit confirmation.
 *
 * Rewritten against the CURRENT IA. The original spec deleted an idea from
 * `/ideas` and a reference from `/references`; both are now READ-ONLY views
 * (`/ideas` → `/sources?view=ideas`, `/references` → `/sources?view=references`)
 * — the per-item delete controls no longer exist anywhere in the client, so the
 * old assertions could never pass again.
 *
 * The confirm-protected delete that does exist is the ingest view's reference
 * delete (`button-delete-active` + the shared ConfirmDialog), which is what this
 * spec exercises. It needs an ingested reference, so it skips loudly when the
 * ingest endpoint cannot fetch (no network in this environment) rather than
 * pretending the flow is broken.
 */

async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.get("/api/csrf-token");
  const { csrfToken } = await res.json();
  return { "X-CSRF-Token": csrfToken };
}

test("deleting an ingested reference requires confirmation", async ({ page, request }) => {
  const created = await request.post("/api/ingest", {
    data: { url: `https://example.com/e2e-${Date.now()}` },
    headers: await csrfHeaders(request),
  });
  test.skip(!created.ok(), "ingest endpoint requires network access to fetch the URL in this environment");

  await page.goto("/sources?view=ingest");

  const del = page.locator('[data-testid="button-delete-active"]');
  await expect(del).toBeVisible({ timeout: 15_000 });
  await del.click();

  // Cancel leaves everything intact...
  const dialog = page.locator('[data-testid="dialog-confirm"]');
  await expect(dialog).toBeVisible();
  await page.locator('[data-testid="button-confirm-cancel"]').click();
  await expect(dialog).toBeHidden();

  // ...and confirming is required to actually delete.
  await del.click();
  await expect(dialog).toBeVisible();
  await page.locator('[data-testid="button-confirm-action"]').click();
  await expect(dialog).toBeHidden();
});
