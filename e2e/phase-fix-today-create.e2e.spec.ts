import { test, expect } from "@playwright/test";

/**
 * Targeted remediation regression coverage (phase-fix-today-create).
 *
 * Defect 1 — a publication the server left unconfirmed is stored as `state: "failed"`
 * with `result.outcome: "unknown"`. The /today failure read filters on state only, so the
 * row arrived through BOTH the failure read and the outcome read and rendered twice
 * (`card-attention-failed-N` and `card-attention-unknown-N`). It must render exactly once,
 * as the unknown outcome.
 *
 * Defect 2 — /create emitted an `h1 -> h3` skip in the heading outline.
 */

/** The exact server shape of an unknown-outcome publication (state stays "failed"). */
const UNKNOWN_PUBLICATION = {
  id: 3,
  artifactId: 303,
  channel: "threads",
  state: "failed",
  providerCalled: true,
  lastError: "reconcile_required",
  createdAt: new Date().toISOString(),
  result: { outcome: "unknown", errorClass: "unknown", errorMessage: "reconcile_required" },
};

test.describe("phase-fix-today-create", () => {
  test("an unconfirmed publication renders exactly once on /today — as unknown, never as a failure", async ({
    page,
  }) => {
    // Capture which canonical publication reads were exercised.
    const publicationReads: string[] = [];

    await page.route("**/api/artifacts**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.route("**/api/agent/runs?limit=10", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [] }) }),
    );
    await page.route("**/api/schedule-occurrences**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.route("**/api/posts/queue/today", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    // Both the window read (`?limit=30`) and the state-only failure read
    // (`?state=failed&limit=50`) return the SAME unconfirmed publication, which is what the
    // server does today — that is the duplicate's source.
    await page.route("**/api/publications**", async (route) => {
      const url = new URL(route.request().url());
      publicationReads.push(`${url.pathname}${url.search}`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([UNKNOWN_PUBLICATION]),
      });
    });

    await page.goto("/today");
    await expect(page.getByTestId("list-attention")).toBeVisible();

    // Rendered once, and as the unknown outcome (not silently dropped).
    await expect(page.getByTestId("card-attention-unknown-3")).toBeVisible();
    await expect(page.getByTestId("card-attention-unknown-3")).toContainText("Publication needs verification");

    // Never also rendered as a failure.
    await expect(page.getByTestId("card-attention-failed-3")).toHaveCount(0);

    // Exactly one attention card in total for the single publication.
    await expect(page.locator('[data-testid^="card-attention-"]')).toHaveCount(1);

    // Both canonical reads really were mocked/exercised (proves the two-source mechanism).
    expect(publicationReads.some((u) => u.includes("state=failed"))).toBe(true);
    expect(publicationReads.some((u) => u.includes("limit=30"))).toBe(true);
  });

  test("/create heading outline has no skipped level", async ({ page }) => {
    await page.goto("/create");
    await expect(page.getByTestId("text-page-title")).toHaveText("Create");

    const headings = await page.evaluate(() =>
      Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((el) => ({
        level: Number(el.tagName[1]),
        text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      })),
    );

    // Dump the sequence for the record.
    console.log("CREATE_HEADING_OUTLINE", JSON.stringify(headings));

    let previous = 0;
    for (const heading of headings) {
      expect(
        heading.level - previous,
        `heading level skip from h${previous} to h${heading.level} ("${heading.text}")`,
      ).toBeLessThanOrEqual(1);
      previous = heading.level;
    }

    // The two studio sections are present at a correct level.
    expect(headings.some((h) => h.level === 2 && h.text === "Content Setup")).toBe(true);
    expect(headings.filter((h) => h.text === "Content Setup")).toHaveLength(1);
    expect(headings.filter((h) => h.text === "Generation Summary")).toHaveLength(1);
  });
});
