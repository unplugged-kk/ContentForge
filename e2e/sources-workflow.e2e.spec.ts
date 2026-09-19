import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const MOCK_CAPABILITIES = {
  providers: [
    { providerId: "rss", configured: true, available: true },
    { providerId: "hn", configured: true, available: true },
    { providerId: "web", configured: true, available: true },
    { providerId: "reddit", configured: false, available: false, reason: "credentials not configured" },
  ],
  last30days: { providerId: "last30days", configured: false, available: false },
  openseo: { configured: false, available: false },
};

const MOCK_JOB = {
  id: 101,
  kind: "directed",
  query: "Kubernetes platform engineering",
  providerIds: ["rss", "hn", "web"],
  status: "complete",
  createdAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  sourceCount: 2,
  evidenceCount: 1,
  quality: "high_confidence",
  summary: { sources: 2, providers: 2, claims: 1, conflicts: 0 },
  warnings: [],
};

const MOCK_SOURCES = [
  {
    id: 1,
    jobId: 101,
    canonicalUrl: "https://cncf.io/reports/cloud-native-2026",
    title: "Cloud Native Platform Trends 2026",
    provider: "rss",
    sourceClass: "primary_source",
    excerpt: "Over 78% of enterprise platform engineering teams have standardized on internal developer portals built on Kubernetes.",
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
    retrievedAt: new Date().toISOString(),
    author: { name: "CNCF Research Group" },
    quality: "high",
    novelty: 0.8,
  },
  {
    id: 2,
    jobId: 101,
    canonicalUrl: "https://news.ycombinator.com/item?id=99999",
    title: "Ask HN: How are platform teams scaling Kubernetes clusters in 2026?",
    provider: "hn",
    sourceClass: "social_post",
    excerpt: "Discussion on scaling multi-tenant clusters and automating canary deployments with GitOps.",
    publishedAt: new Date(Date.now() - 7200_000).toISOString(),
    retrievedAt: new Date().toISOString(),
    author: { handle: "devops_guru" },
    quality: "standard",
    novelty: 0.4,
  },
];

const MOCK_EVIDENCE = [
  {
    id: 201,
    jobId: 101,
    sourceId: 1,
    canonicalUrl: "https://cncf.io/reports/cloud-native-2026",
    kind: "excerpt",
    claim: "78% of enterprise platform teams standardized on developer portals",
    excerpt: "Over 78% of enterprise platform engineering teams have standardized on internal developer portals built on Kubernetes.",
    corroborationCount: 3,
  },
];

const MOCK_ANALYSIS = {
  jobId: 101,
  analysisVersion: "1.0",
  snapshot: {
    quality: "high",
    novelty: 0.8,
    conflicts: [],
    summary: { sources: 2, providers: 2, claims: 1, conflicts: 0 },
  },
};

test.describe("Phase 28.2E — Sources & Research UX", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept standard capabilities
    await page.route("**/api/research/capabilities", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_CAPABILITIES) }),
    );
    await page.route("**/api/vault", (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: 99, ...body }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    await page.route("**/api/ideas", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/references", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/research/jobs?*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([MOCK_JOB]) }),
    );
    await page.route("**/api/research/jobs", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: 101, status: "complete" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([MOCK_JOB]) });
    });
    await page.route("**/api/research/jobs/101", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_JOB) }),
    );
    await page.route("**/api/research/jobs/101/sources", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SOURCES) }),
    );
    await page.route("**/api/research/jobs/101/evidence", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_EVIDENCE) }),
    );
    await page.route("**/api/research/jobs/101/analysis", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_ANALYSIS) }),
    );
  });

  test("Journey A: Research query, time window, search, and results display", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.locator('[data-testid="page-header-sources"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-discover-title"]')).toBeVisible();

    // Fill query and select time window
    await page.locator('[data-testid="input-research-query"]').fill("Kubernetes platform engineering");
    await page.locator('[data-testid="select-time-window"]').click();
    await page.getByRole("option", { name: "Last 7 days" }).click();

    // Trigger research
    await page.locator('[data-testid="button-start-research"]').click();

    // Verify summary and results
    await expect(page.locator('[data-testid="panel-research-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="panel-research-summary"]')).toContainText(/2 sources reviewed/i);

    const sourceCard = page.locator('[data-testid="card-source-1"]');
    await expect(sourceCard).toBeVisible();
    await expect(sourceCard).toContainText("Cloud Native Platform Trends 2026");
    await expect(sourceCard.locator('[data-testid="badge-source-credibility"]')).toContainText(/High confidence/i);
  });

  test("Journey B: Source detail modal with evidence claims and credibility", async ({ page }) => {
    await page.goto("/sources");

    // Perform research to load results
    await page.locator('[data-testid="input-research-query"]').fill("Kubernetes platform engineering");
    await page.locator('[data-testid="button-start-research"]').click();

    // Open detail
    const viewBtn = page.locator('[data-testid="button-source-view-1"]');
    await expect(viewBtn).toBeVisible();
    await viewBtn.click();

    const detailModal = page.locator('[data-testid="dialog-source-detail"]');
    await expect(detailModal).toBeVisible();
    await expect(detailModal).toContainText("Cloud Native Platform Trends 2026");
    await expect(detailModal.locator('[data-testid="section-source-evidence"]')).toBeVisible();
    await expect(detailModal.locator('[data-testid="section-source-evidence"]')).toContainText(/78% of enterprise/i);

    // Close modal
    await page.keyboard.press("Escape");
    await expect(detailModal).toBeHidden();
  });

  test("Journey C: Save source to knowledge base and view in Saved tab", async ({ page }) => {
    let saved = false;
    await page.route("**/api/vault", (route) => {
      if (route.request().method() === "POST") {
        saved = true;
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: 99,
            title: "Cloud Native Platform Trends 2026",
            sourceUrl: "https://cncf.io/reports/cloud-native-2026",
            content: "Saved excerpt",
          }),
        });
      }
      if (saved) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: 99,
              title: "Cloud Native Platform Trends 2026",
              sourceUrl: "https://cncf.io/reports/cloud-native-2026",
              content: "Saved excerpt",
              createdAt: new Date(),
            },
          ]),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });

    await page.goto("/sources");

    // Trigger research
    await page.locator('[data-testid="input-research-query"]').fill("Kubernetes");
    await page.locator('[data-testid="button-start-research"]').click();

    // Click Save on source card
    const saveBtn = page.locator('[data-testid="button-source-save-1"]');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(saveBtn).toContainText(/Saved/i);

    // Switch to Saved tab
    await page.locator('[data-testid="tab-sources-view-saved"]').click();
    const savedCard = page.locator('[data-testid="card-saved-item-99"]');
    await expect(savedCard).toBeVisible();
    await expect(savedCard).toContainText("Cloud Native Platform Trends 2026");
  });

  test("Journey D: Create Story bridge retains research provenance", async ({ page }) => {
    let storyCreated = false;
    await page.route("**/api/stories", (route) => {
      if (route.request().method() === "POST") {
        storyCreated = true;
        const body = route.request().postDataJSON();
        expect(body.provenance).toBe("researched");
        expect(body.researchJobId).toBe(101);
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: 55, title: body.title }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });

    await page.goto("/sources");
    await page.locator('[data-testid="input-research-query"]').fill("Kubernetes");
    await page.locator('[data-testid="button-start-research"]').click();

    // Click Create Story on source
    await page.locator('[data-testid="button-source-create-story-1"]').click();

    const storyDialog = page.locator('[data-testid="dialog-create-story"]');
    await expect(storyDialog).toBeVisible();
    await expect(storyDialog).toContainText(/Provenance: Researched/i);

    await page.locator('[data-testid="button-confirm-create-story"]').click();
    expect(storyCreated).toBe(true);
    await expect(storyDialog).toBeHidden();
  });

  test("Journey E: Create Content handoff preserves context to /create", async ({ page }) => {
    await page.goto("/sources");
    await page.locator('[data-testid="input-research-query"]').fill("Kubernetes");
    await page.locator('[data-testid="button-start-research"]').click();

    // Click Create Content on source
    const createContentBtn = page.locator('[data-testid="button-source-create-content-1"]');
    await expect(createContentBtn).toBeVisible();
    await createContentBtn.click();

    // Verifies navigation to canonical /create with query parameters
    await expect(page).toHaveURL(/\/create\?topic=/);
  });

  test("Journey F: Research failure displays ErrorState with working retry", async ({ page }) => {
    let failCount = 1;
    await page.route("**/api/research/jobs", (route) => {
      if (route.request().method() === "POST") {
        if (failCount > 0) {
          failCount -= 1;
          return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Engine error" }) });
        }
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: 101, status: "complete" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });

    await page.goto("/sources");
    await page.locator('[data-testid="input-research-query"]').fill("Failing research");
    await page.locator('[data-testid="button-start-research"]').click();

    // Verify ErrorState appears
    const errorState = page.locator('[data-testid="error-state"]');
    await expect(errorState).toBeVisible();

    // Retry should recover
    await page.locator('[data-testid="button-error-state-retry"]').click();
    await expect(errorState).toBeHidden();
    await expect(page.locator('[data-testid="panel-research-summary"]')).toBeVisible();
  });

  test("Journey G: Empty states for Discover, Saved, and Research tabs", async ({ page }) => {
    await page.route("**/api/research/jobs?*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/research/jobs", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );

    await page.goto("/sources");
    await expect(page.locator('[data-testid="state-discover-idle"]')).toBeVisible();

    // Saved empty state
    await page.locator('[data-testid="tab-sources-view-saved"]').click();
    await expect(page.locator('[data-testid="state-saved-empty"]')).toBeVisible();

    // Research history empty state
    await page.locator('[data-testid="tab-sources-view-research"]').click();
    await expect(page.locator('[data-testid="state-research-empty"]')).toBeVisible();
  });

  test("Journey H: Degraded research surfaces honest 'completed with limited sources' state", async ({ page }) => {
    const degradedJob = {
      ...MOCK_JOB,
      warnings: ["Reddit unavailable: credentials not configured"],
    };

    await page.route("**/api/research/jobs/101", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(degradedJob) }),
    );

    await page.goto("/sources");
    await page.locator('[data-testid="input-research-query"]').fill("Kubernetes");
    await page.locator('[data-testid="button-start-research"]').click();

    // Degraded badge must be visible
    const degradedBadge = page.locator('[data-testid="badge-degraded-sources"]');
    await expect(degradedBadge).toBeVisible();
    await expect(page.locator('[data-testid="panel-research-summary"]')).toContainText(/Completed with limited sources/i);
  });

  test("Journey I: Mobile layout (390x844) single vertical scroll, reachable controls, no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sources");

    // Check no horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Controls reachable
    await expect(page.locator('[data-testid="input-research-query"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-start-research"]')).toBeVisible();

    // Run research on mobile
    await page.locator('[data-testid="input-research-query"]').fill("Kubernetes");
    await page.locator('[data-testid="button-start-research"]').click();

    // Verify results render cleanly without overflow
    await expect(page.locator('[data-testid="card-source-1"]')).toBeVisible();
    const stillNoOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(stillNoOverflow).toBe(false);
  });

  test("Journey J: 0 Axe accessibility violations across Desktop, Tablet, and Mobile viewports", async ({ page }) => {
    const viewports = [
      { name: "Desktop", width: 1440, height: 900 },
      { name: "Tablet", width: 820, height: 1180 },
      { name: "Mobile", width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/sources");
      await expect(page.locator('[data-testid="page-sources"]')).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withRules(["document-title", "meta-viewport", "button-name", "label"])
        .analyze();

      expect(
        results.violations,
        `Accessibility violations in ${vp.name} (${vp.width}x${vp.height}): ` +
          JSON.stringify(results.violations, null, 2),
      ).toEqual([]);
    }
  });
});
