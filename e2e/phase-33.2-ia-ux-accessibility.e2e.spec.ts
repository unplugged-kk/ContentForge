import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const reviewArtifact = (id: number, readiness = "in_review") => ({
  id,
  format: "x_post",
  channel: "x",
  payload: { text: "A focused artifact revision for review." },
  readiness,
  approvedAt: readiness === "approved" ? new Date().toISOString() : null,
  supersedesId: null,
  provenance: "generated",
  opportunityId: null,
  generationJobId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

async function mockArtifactReview(page: any, id: number) {
  let artifact = reviewArtifact(id);
  let rejectCalls = 0;

  await page.route(`**/api/artifacts/${id}`, async (route: any) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(artifact) });
  });
  await page.route(`**/api/artifacts/${id}/history`, async (route: any) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([artifact]) });
  });
  await page.route(`**/api/artifacts/${id}/reject`, async (route: any) => {
    rejectCalls += 1;
    artifact = { ...artifact, readiness: "rejected", approvedAt: null };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(artifact) });
  });
  await page.route("**/api/accounts", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ platform: "x", username: "phase332" }]),
    });
  });
  await page.route("**/api/repurposing/capabilities", async (route: any) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ formats: [] }) });
  });

  return { getRejectCalls: () => rejectCalls };
}

const agentRun = {
  id: 70,
  objective: "Prepare a reviewable artifact",
  status: "completed",
  backendId: "fixture",
  currentStep: 2,
  createdAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  errorClass: null,
  errorMessage: null,
  toolCalls: [
    {
      id: 701,
      toolName: "generate_artifact",
      status: "completed",
      result: { status: "completed" },
      resourceRefs: { artifactId: 701 },
      errorClass: null,
      errorMessage: null,
    },
  ],
};

async function mockAgentArtifact(page: any) {
  await page.route("**/api/agent/runtime", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        streaming: false,
        backend: { id: "fixture", configuredId: "fixture", model: "fixture-agent", hasBaseUrl: false, hasAguiUrl: false },
        availableBackends: [{ id: "fixture", available: true }],
      }),
    });
  });
  await page.route("**/api/agent/tools", async (route: any) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tools: [] }) });
  });
  await page.route("**/api/agent/runs", async (route: any) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [agentRun] }) });
  });
  await page.route("**/api/agent/runs/70", async (route: any) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agentRun) });
  });
  await page.route("**/api/agent/runs/70/events", async (route: any) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) });
  });
  return mockArtifactReview(page, 701);
}

test.describe("Phase 33.2 IA, UX, and accessibility", () => {
  test("canonical Artifact Review exposes Reject and records the rejected revision state", async ({ page }) => {
    const calls = await mockArtifactReview(page, 701);
    await page.goto("/create?artifact=701");

    await expect(page.getByTestId("button-review-reject")).toBeVisible();
    await page.getByTestId("button-review-reject").click();
    await expect(page.getByTestId("dialog-confirm")).toBeVisible();
    await expect(page.getByTestId("dialog-confirm")).toContainText("Reject this revision");
    await page.getByTestId("button-confirm-action").click();

    await expect(page.getByTestId("badge-artifact-status")).toHaveText("Rejected");
    await expect(page.getByTestId("text-rejected-immutable")).toBeVisible();
    await expect(page.getByTestId("button-review-approve")).toHaveCount(0);
    expect(calls.getRejectCalls()).toBe(1);
  });

  test("Agent Workspace Artifact Review exposes the same Reject flow", async ({ page }) => {
    const calls = await mockAgentArtifact(page);
    await page.goto("/agent?runId=70");

    await expect(page.getByTestId("card-artifact-701")).toBeVisible();
    await page.getByTestId("button-artifact-reject").click();
    await expect(page.getByTestId("dialog-confirm")).toBeVisible();
    await page.getByTestId("button-confirm-action").click();

    await expect(page.getByTestId("badge-artifact-readiness")).toHaveText("Rejected");
    await expect(page.getByTestId("text-artifact-rejected-immutable")).toBeVisible();
    await expect(page.getByTestId("button-artifact-approve")).toHaveCount(0);
    expect(calls.getRejectCalls()).toBe(1);
  });

  test("legacy duplicate routes redirect to their canonical destinations with query and hash preserved", async ({ page }) => {
    const mappings = [
      ["/generate", "/create"],
      ["/queue", "/schedule"],
      ["/calendar", "/schedule"],
      ["/analytics", "/insights"],
      ["/ai-usage", "/insights"],
      ["/discover", "/sources"],
      ["/ingest", "/sources"],
      ["/ideas", "/sources"],
      ["/vault", "/sources"],
      ["/references", "/sources"],
    ] as const;

    for (const [legacyPath, canonicalPath] of mappings) {
      await page.goto(`${legacyPath}?bookmark=kept#section-7`);
      await page.waitForURL((url) => url.pathname === canonicalPath && url.searchParams.get("bookmark") === "kept" && url.hash === "#section-7");
      const url = new URL(page.url());
      expect(url.pathname).toBe(canonicalPath);
      expect(url.searchParams.get("bookmark")).toBe("kept");
      expect(url.hash).toBe("#section-7");
    }
  });

  test("homeless legacy capabilities render inside canonical Create and remain deep-linkable", async ({ page }) => {
    await page.goto("/hooks?bookmark=kept");
    await page.waitForURL((url) => url.pathname === "/create" && url.searchParams.get("mode") === "hooks" && url.searchParams.get("bookmark") === "kept");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/create");
    expect(url.searchParams.get("mode")).toBe("hooks");
    expect(url.searchParams.get("bookmark")).toBe("kept");
    await expect(page.getByTestId("page-header-create")).toBeVisible();
    await expect(page.getByTestId("text-hooks-title")).toBeVisible();

    await page.getByTestId("link-create-mode-carousel").click();
    expect(new URL(page.url()).searchParams.get("mode")).toBe("carousel");
    await expect(page.getByTestId("text-carousel-title")).toBeVisible();
    await expect(page.getByTestId("link-youtube-deferred")).toBeVisible();
  });

  test("Create preserves artifact deep links and canonical mode links do not retain stale artifact ids", async ({ page }) => {
    await mockArtifactReview(page, 701);
    await page.goto("/create?artifact=701");
    await expect(page.getByTestId("view-artifact-review")).toBeVisible();
    await page.getByTestId("button-review-back").click();
    await expect(page).toHaveURL(/\/create$/);
    await expect(page.getByTestId("create-studio-container")).toBeVisible();
  });

  test("Today distinguishes server-recorded setup gaps from real failures and unknown outcomes", async ({ page }) => {
    // Today reads artifacts and publications under canonical query keys; match on the
    // path so this fixture survives a limit/state consolidation without going stale.
    await page.route("**/api/artifacts**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    await page.route("**/api/agent/runs?limit=10", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [] }) });
    });
    await page.route("**/api/publications**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            artifactId: 701,
            channel: "x",
            state: "failed",
            providerCalled: false,
            lastError: "XQUICK_CONFIG_MISSING",
            createdAt: new Date().toISOString(),
            result: { outcome: "failed", errorClass: "policy_human", errorMessage: "xQuick credentials missing: connect an xQuick token in Settings." },
          },
          {
            id: 2,
            artifactId: 702,
            channel: "linkedin",
            state: "failed",
            providerCalled: false,
            lastError: "provider rejected payload",
            createdAt: new Date().toISOString(),
            result: { outcome: "failed", errorClass: "permanent", errorMessage: "LinkedIn rejected the post." },
          },
          {
            id: 3,
            artifactId: 703,
            channel: "threads",
            state: "failed",
            providerCalled: true,
            lastError: "reconcile_required",
            createdAt: new Date().toISOString(),
            result: { outcome: "unknown", errorClass: "unknown", errorMessage: "reconcile_required" },
          },
        ]),
      });
    });
    await page.route("**/api/schedule-occurrences**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    await page.route("**/api/posts/queue/today", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    await page.goto("/today");
    await expect(page.getByTestId("card-attention-setup-1")).toContainText("X setup required");
    await expect(page.getByTestId("card-attention-failed-2")).toContainText("Publication failed");
    await expect(page.getByTestId("card-attention-unknown-3")).toContainText("Publication needs verification");
    await expect(page.getByTestId("card-attention-setup-1")).toHaveAttribute("data-attention-kind", "setup_required_publication");
  });

  test("Sources and Agent expose exactly one top-level main landmark", async ({ page }) => {
    for (const path of ["/sources", "/agent"]) {
      await page.goto(path);
      await expect(page.locator("main#main-content")).toHaveCount(1);
      await expect(page.locator("main").filter({ has: page.locator("#main-content") })).toHaveCount(0);
    }
  });

  test("channel icons use accessible names or explicit decorative semantics", async ({ page }) => {
    const calls = await mockArtifactReview(page, 701);
    await page.goto("/create?artifact=701");
    const channelIcon = page.locator('[data-channel="x"]').first();
    await expect(channelIcon).toHaveAttribute("aria-hidden", "true");
    await expect(channelIcon.locator("svg")).toHaveAttribute("aria-hidden", "true");
    expect(calls.getRejectCalls()).toBe(0);
  });

  test("phase surfaces have no targeted axe violations", async ({ page }) => {
    for (const path of ["/today", "/sources", "/agent", "/create?mode=hooks"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withRules(["document-title", "meta-viewport", "button-name", "label", "landmark-main-is-top-level", "landmark-no-duplicate-main", "landmark-unique"])
        .analyze();
      expect(results.violations, `${path}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
    }
  });
});
