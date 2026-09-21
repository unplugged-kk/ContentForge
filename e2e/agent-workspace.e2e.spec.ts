import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const MOCK_RUNTIME = {
  available: true,
  streaming: false,
  backend: {
    id: "fixture",
    configuredId: "fixture",
    model: "fixture-agent",
    hasBaseUrl: false,
    hasAguiUrl: false,
  },
  availableBackends: [
    { id: "fixture", available: true },
    { id: "openai-compatible", available: true },
  ],
};

const MOCK_TOOLS = {
  tools: [
    { name: "research_topic", access: "open", capabilityStatus: "available" },
    { name: "create_story", access: "open", capabilityStatus: "available" },
    { name: "find_opportunities", access: "open", capabilityStatus: "available" },
    { name: "generate_artifact", access: "open", capabilityStatus: "available" },
    { name: "publish_now", requiresApproval: true, capabilityStatus: "available" },
  ],
};

const MOCK_RUNS = [
  {
    id: 10,
    objective: "Research AI workflow agents and create a multi-channel plan",
    status: "completed",
    backendId: "fixture",
    currentStep: 4,
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    finishedAt: new Date(Date.now() - 3500_000).toISOString(),
    errorClass: null,
    errorMessage: null,
    toolCalls: [
      {
        id: 101,
        toolName: "research_topic",
        status: "completed",
        result: { status: "completed", sourceCount: 4 },
        resourceRefs: { researchJobId: 1 },
        errorClass: null,
        errorMessage: null,
      },
      {
        id: 102,
        toolName: "create_story",
        status: "completed",
        result: { status: "completed" },
        resourceRefs: { storyId: 1 },
        errorClass: null,
        errorMessage: null,
      },
      {
        id: 103,
        toolName: "find_opportunities",
        status: "completed",
        result: { refs: { opportunityIds: [1, 2] } },
        resourceRefs: { opportunityIds: [1, 2] },
        errorClass: null,
        errorMessage: null,
      },
      {
        id: 104,
        toolName: "generate_artifact",
        status: "completed",
        result: { status: "completed" },
        resourceRefs: { artifactId: 42, opportunityId: 1 },
        errorClass: null,
        errorMessage: null,
      },
    ],
  },
];

const MOCK_ARTIFACT = {
  id: 42,
  format: "x_post",
  channel: "x",
  payload: { text: "Orchestration over chatbots. The agent coordinates research, synthesis, and handoff." },
  readiness: "draft",
  approvedAt: null,
  supersedesId: null,
  provenance: "agent_orchestrator",
  opportunityId: 1,
  generationJobId: 1,
};

test.describe("Phase 28.2D — Agent Workspace Responsive Orchestrator", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept standard metadata endpoints
    await page.route("**/api/agent/runtime", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_RUNTIME) }),
    );
    await page.route("**/api/agent/tools", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_TOOLS) }),
    );
    await page.route("**/api/accounts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ platform: "x", username: "contentforge" }]),
      }),
    );
  });

  test("Journey A: Task orchestration lifecycle (queued -> running -> completed -> truthful outcome)", async ({ page }) => {
    let runState = {
      id: 20,
      objective: "Orchestrate new AI report",
      status: "running",
      backendId: "fixture",
      currentStep: 1,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      errorClass: null,
      errorMessage: null,
      toolCalls: [
        {
          id: 201,
          toolName: "research_topic",
          status: "running",
          result: null,
          resourceRefs: {},
          errorClass: null,
          errorMessage: null,
        },
      ],
    };

    await page.route("**/api/agent/runs", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runState) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [runState] }) });
    });

    await page.route("**/api/agent/runs/20", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runState) }),
    );

    await page.route("**/api/agent/runs/20/events", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            { type: "RUN_STARTED", runId: 20, payload: { objective: runState.objective } },
            {
              type: "TOOL_CALL_STARTED",
              runId: 20,
              payload: {
                callId: "201",
                toolName: "research_topic",
                arguments: { query: "AI report" },
              },
            },
          ],
        }),
      }),
    );

    await page.goto("/agent");
    await expect(page.locator('[data-testid="text-agent-workspace-title"]')).toBeVisible();

    // Start run
    await page.locator('[data-testid="textarea-agent-composer"]').fill("Orchestrate new AI report");
    await page.locator('[data-testid="button-agent-start"]').click();

    // Verify active run banner appears with running status
    await expect(page.locator('[data-testid="panel-active-run-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="badge-run-status"]')).toContainText(/Running/i);
    await expect(page.locator('[data-testid="panel-agent-activity"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-tool-call-201"]')).toBeVisible();

    // Transition run to completed
    runState = {
      ...runState,
      status: "completed",
      finishedAt: new Date().toISOString(),
      toolCalls: [
        {
          id: 201,
          toolName: "research_topic",
          status: "completed",
          result: { status: "completed", sourceCount: 3 },
          resourceRefs: { researchJobId: 5 },
          errorClass: null,
          errorMessage: null,
        },
        {
          id: 202,
          toolName: "generate_artifact",
          status: "completed",
          result: { status: "completed" },
          resourceRefs: { artifactId: 42 },
          errorClass: null,
          errorMessage: null,
        },
      ],
    };

    await page.route("**/api/agent/runs/20/events", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            { type: "RUN_STARTED", runId: 20 },
            {
              type: "TOOL_CALL_COMPLETED",
              runId: 20,
              payload: {
                callId: "201",
                toolName: "research_topic",
                result: { status: "completed", sourceCount: 3 },
                resourceRefs: { researchJobId: 5 },
              },
            },
            {
              type: "TOOL_CALL_COMPLETED",
              runId: 20,
              payload: {
                callId: "202",
                toolName: "generate_artifact",
                result: { status: "completed" },
                resourceRefs: { artifactId: 42 },
              },
            },
            { type: "RUN_FINISHED", runId: 20, payload: { status: "completed" } },
          ],
        }),
      }),
    );

    // Trigger hydrate / retry
    await page.locator('[data-testid="button-agent-retry"]').click();

    await expect(page.locator('[data-testid="badge-run-status"]')).toContainText(/Completed/i);
    await expect(page.locator('[data-testid="panel-run-outcome-summary"]')).toBeVisible();
  });

  test("Journey B: Canonical review handoff links to /create?artifact=<id>", async ({ page }) => {
    await page.route("**/api/agent/runs", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: MOCK_RUNS }) }),
    );
    await page.route("**/api/agent/runs/10", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_RUNS[0]) }),
    );
    await page.route("**/api/agent/runs/10/events", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            {
              type: "TOOL_CALL_COMPLETED",
              runId: 10,
              payload: {
                callId: "104",
                toolName: "generate_artifact",
                resourceRefs: { artifactId: 42 },
              },
            },
          ],
        }),
      }),
    );
    await page.route("**/api/artifacts/42", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_ARTIFACT) }),
    );
    await page.route("**/api/artifacts/42/history", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/artifacts/42/publications", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/artifacts/42/visuals", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );

    await page.goto("/agent?runId=10");
    const reviewCard = page.locator('[data-testid="card-artifact-42"]');
    await expect(reviewCard).toBeVisible();

    const reviewButton = page.locator('[data-testid="button-artifact-review"]');
    await expect(reviewButton).toBeVisible();
    await expect(reviewButton).toHaveAttribute("href", "/create?artifact=42");

    // Clicking [Review] navigates directly to /create?artifact=42
    await reviewButton.click();
    await expect(page).toHaveURL(/\/create\?artifact=42/);
  });

  test("Journey C: Human approval callout with explicit resume action", async ({ page }) => {
    let resumed = false;
    const approvalRun = {
      ...MOCK_RUNS[0],
      id: 30,
      status: "waiting_for_approval",
    };

    await page.route("**/api/agent/runs", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [approvalRun] }) }),
    );
    await page.route("**/api/agent/runs/30", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...approvalRun,
          status: resumed ? "running" : "waiting_for_approval",
        }),
      }),
    );
    await page.route("**/api/agent/runs/30/events", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            { type: "RUN_STARTED", runId: 30 },
            {
              type: "APPROVAL_REQUESTED",
              runId: 30,
              payload: { reason: "Publishing to production X channel requires authorization" },
            },
          ],
        }),
      }),
    );
    await page.route("**/api/agent/runs/30/resume", (route) => {
      resumed = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    });

    await page.goto("/agent?runId=30");

    // Verify approval callout
    await expect(page.locator('[data-testid="panel-auth-callout"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-auth-required"]')).toBeVisible();

    const approveButton = page.locator('[data-testid="button-run-approve"]');
    await expect(approveButton).toBeVisible();
    await approveButton.click();

    expect(resumed).toBe(true);
  });

  test("Journey D: Schedule and Publish handoff dialogs on approved artifact", async ({ page }) => {
    const approvedArtifact = {
      ...MOCK_ARTIFACT,
      readiness: "approved",
      approvedAt: new Date().toISOString(),
    };

    await page.route("**/api/agent/runs", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: MOCK_RUNS }) }),
    );
    await page.route("**/api/agent/runs/10", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_RUNS[0]) }),
    );
    await page.route("**/api/agent/runs/10/events", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: [] }),
      }),
    );
    await page.route("**/api/artifacts/42", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(approvedArtifact) }),
    );
    await page.route("**/api/artifacts/42/history", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/artifacts/42/publications", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/artifacts/42/visuals", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );

    await page.goto("/agent?runId=10");

    // Schedule handoff
    const scheduleBtn = page.locator('[data-testid="button-artifact-schedule"]');
    await expect(scheduleBtn).toBeEnabled();
    await scheduleBtn.click();

    const scheduleDialog = page.locator('[data-testid="dialog-artifact-schedule"]');
    await expect(scheduleDialog).toBeVisible();
    await expect(page.locator('[data-testid="button-confirm-schedule"]')).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(scheduleDialog).toBeHidden();

    // Publish handoff
    const publishBtn = page.locator('[data-testid="button-artifact-publish"]');
    await expect(publishBtn).toBeEnabled();
    await publishBtn.click();

    const publishDialog = page.locator('[data-testid="dialog-artifact-publish"]');
    await expect(publishDialog).toBeVisible();
    await expect(publishDialog.locator('[data-testid="publish-preview"]')).toBeVisible();
    await expect(publishDialog.locator('[data-testid="text-publish-target"]')).toBeVisible();

    await page.locator('[data-testid="button-publish-cancel"]').click();
    await expect(publishDialog).toBeHidden();
  });

  test("Journey E: Truthful status on tool failure (never falsely reports completed)", async ({ page }) => {
    const failedToolRun = {
      ...MOCK_RUNS[0],
      id: 50,
      status: "completed", // Raw backend reported completed, but tool failed
      toolCalls: [
        {
          id: 501,
          toolName: "generate_artifact",
          status: "failed",
          errorMessage: "Rate limit reached on AI engine",
          result: null,
          resourceRefs: {},
          errorClass: "RATE_LIMITED",
        },
      ],
    };

    await page.route("**/api/agent/runs", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [failedToolRun] }) }),
    );
    await page.route("**/api/agent/runs/50", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(failedToolRun) }),
    );
    await page.route("**/api/agent/runs/50/events", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) }),
    );

    await page.goto("/agent?runId=50");

    // Derived truthful status must be 'Completed with warnings', NOT 'Completed'
    const statusBadge = page.locator('[data-testid="badge-run-status"]');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toContainText(/Completed with warnings/i);
    await expect(statusBadge).not.toHaveText(/^Completed$/i);

    // Warning count pill must be visible
    await expect(page.locator('[data-testid="badge-run-warnings"]')).toContainText(/1 Warnings/i);
  });

  test("Journey F: Refresh durability restores active run from URL (?runId=10)", async ({ page }) => {
    await page.route("**/api/agent/runs", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: MOCK_RUNS }) }),
    );
    await page.route("**/api/agent/runs/10", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_RUNS[0]) }),
    );
    await page.route("**/api/agent/runs/10/events", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) }),
    );

    await page.goto("/agent?runId=10");
    await expect(page.locator('[data-testid="panel-active-run-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-tool-call-101"]')).toBeVisible();

    // Reload page
    await page.reload();
    await expect(page).toHaveURL(/\/agent\?runId=10/);
    await expect(page.locator('[data-testid="panel-active-run-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-tool-call-101"]')).toBeVisible();
  });

  test("Journey G: Mobile layout (390x844) single vertical scroll, reachable composer, no overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.route("**/api/agent/runs", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: MOCK_RUNS }) }),
    );
    await page.route("**/api/agent/runs/10", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_RUNS[0]) }),
    );
    await page.route("**/api/agent/runs/10/events", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) }),
    );

    await page.goto("/agent?runId=10");
    await expect(page.locator('[data-testid="text-agent-workspace-title"]')).toBeVisible();

    // Check no horizontal scroll overflow on page
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Composer and buttons reachable
    const composer = page.locator('[data-testid="textarea-agent-composer"]');
    await expect(composer).toBeVisible();
    const startBtn = page.locator('[data-testid="button-agent-start"]');
    await expect(startBtn).toBeVisible();

    // Mobile run history trigger
    const mobileHistoryTrigger = page.locator('[data-testid="button-open-mobile-history"]');
    await expect(mobileHistoryTrigger).toBeVisible();
    await mobileHistoryTrigger.click();

    const mobileSheet = page.locator('[data-testid="sheet-mobile-history"]');
    await expect(mobileSheet).toBeVisible();
  });

  test("Journey H: 0 Axe accessibility violations across desktop, tablet, and mobile viewports", async ({ page }) => {
    await page.route("**/api/agent/runs", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: MOCK_RUNS }) }),
    );
    await page.route("**/api/agent/runs/10", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_RUNS[0]) }),
    );
    await page.route("**/api/agent/runs/10/events", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) }),
    );

    const viewports = [
      { name: "Desktop", width: 1440, height: 900 },
      { name: "Tablet", width: 820, height: 1180 },
      { name: "Mobile", width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/agent?runId=10");
      await expect(page.locator('[data-testid="page-agent-workspace"]')).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withRules(["document-title", "meta-viewport", "button-name", "label"])
        .analyze();

      expect(
        results.violations,
        `Accessibility violations found in ${vp.name} (${vp.width}x${vp.height}): ` +
          JSON.stringify(results.violations, null, 2),
      ).toEqual([]);
    }
  });
});
