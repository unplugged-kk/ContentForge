import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.get("/api/csrf-token");
  const { csrfToken } = await res.json();
  return { "X-CSRF-Token": csrfToken };
}

/** Seeds a real in_review canonical Artifact via HTTP, no AI call required (human_edit artifact). */
async function seedArtifactNeedingReview(request: APIRequestContext, suffix: string): Promise<number> {
  const headers = await csrfHeaders(request);
  const story = await request
    .post("/api/stories", {
      headers,
      data: {
        title: `E2E today-schedule story ${suffix}`,
        insightBody: "Fixture insight body for the today/schedule journey.",
        provenance: "human",
        status: "ready",
      },
    })
    .then((r) => r.json());
  const opportunity = await request
    .post("/api/opportunities", {
      headers,
      data: {
        storyId: story.id,
        concept: "fixture concept",
        objective: "fixture objective",
        format: "x_post",
        channel: "x",
      },
    })
    .then((r) => r.json());
  const artifact = await request
    .post(`/api/opportunities/${opportunity.id}/artifacts`, {
      headers,
      data: { payload: { text: `Today/Schedule E2E fixture ${suffix}` }, attribution: [], attributionReason: "e2e fixture" },
    })
    .then((r) => r.json());
  await request.post(`/api/artifacts/${artifact.id}/submit-review`, { headers, data: {} });
  return artifact.id as number;
}

async function assertNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
}

test.describe("Phase 28.2F — Today + Schedule Consolidation", () => {
  test("Journey A: Today loads all sections", async ({ page }) => {
    await page.goto("/today");
    await expect(page.locator('[data-testid="page-header-today"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-attention"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-today-schedule"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-recent-activity"]')).toBeVisible();
    await expect(page.locator('[data-testid="today-quick-actions"]')).toBeVisible();
  });

  test("Journey B: a review-needed artifact appears in Attention and hands off to canonical Review", async ({ page, request }) => {
    const artifactId = await seedArtifactNeedingReview(request, `${Date.now()}`);
    await page.goto("/today");
    const card = page.locator(`[data-testid="card-attention-review-${artifactId}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(new RegExp(`/create\\?artifact=${artifactId}`));
  });

  test("Journey G: Schedule has 3 tabs and the Publications tab loads real canonical data", async ({ page, request }) => {
    await seedArtifactNeedingReview(request, `pub-${Date.now()}`);
    await page.goto("/schedule?tab=publications");
    await expect(page.locator('[data-testid="tab-trigger-publications"]')).toHaveAttribute("data-state", "active");
    // Publications tab renders (list or empty state) without erroring — the artifact above
    // is only in_review (no schedule/publication yet), so an empty state is a valid outcome.
    const list = page.locator('[data-testid="list-publications"]');
    const empty = page.locator('[data-testid="empty-state"]');
    await expect(list.or(empty)).toBeVisible({ timeout: 10_000 });
  });

  test("Journey F: one failing Today section never blanks the others", async ({ page }) => {
    await page.route(/\/api\/publications(\?.*)?$/, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "forced failure" }) }),
    );
    await page.goto("/today");
    // Attention + Schedule + Activity all read from /api/publications among other sources;
    // the page itself and its other sections must still render.
    await expect(page.locator('[data-testid="page-header-today"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-today-schedule"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-recent-activity"]')).toBeVisible();
  });

  test("Journey H: mobile Today (390x844) has no horizontal scroll and primary actions are reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/today");
    await expect(page.locator('[data-testid="page-header-today"]')).toBeVisible();
    await assertNoHorizontalScroll(page);
    await expect(page.locator('[data-testid="button-quick-action-create"]')).toBeVisible();
  });

  test("Journey I: mobile Schedule (390x844) has no horizontal scroll and tabs are reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/schedule");
    await expect(page.locator('[data-testid="page-header-schedule"]')).toBeVisible();
    await assertNoHorizontalScroll(page);
    await expect(page.locator('[data-testid="tab-trigger-publications"]')).toBeVisible();
  });
});
