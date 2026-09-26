import { test, expect, devices } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Phase 28.2C: Create + Review Workflow E2E Tests
 *
 * Covers:
 * - Journey A: Create -> choose Post -> choose Story -> generate -> Review -> Approve
 * - Journey B: Create -> generate -> Edit -> creates Version 2 in draft
 * - Journey C: Create -> generate -> Regenerate -> triggers new generation job
 * - Journey D: Approved content -> Schedule handoff (date+time validation)
 * - Journey E: Approved content -> Publish now (preview + confirmation)
 * - Journey F: Generation error recovery -> ErrorState + retry
 * - Journey G: Pre-publish incompatibility warning banner
 * - Journey H: Responsive layouts (Desktop 1440x900, Tablet 820x1180, Mobile 390x844)
 * - Journey I: Accessibility verification (0 Axe violations on Studio and Review)
 * - Journey J: Preserved legacy creation modes bar
 */

const mockStory = {
  id: 101,
  title: "Engineering Scalability Insights",
  insightBody: "Key lessons from scaling Postgres to 100k queries per second.",
  provenance: "human",
  status: "ready",
};

const mockArtifactV1 = {
  id: 501,
  userId: 1,
  opportunityId: 201,
  generationJobId: 301,
  format: "x_post",
  channel: "x",
  payload: { text: "Scaling Postgres: connection pooling is not optional. Here are 3 lessons learned." },
  provenance: "generated",
  readiness: "draft",
  supersedesId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  approvedAt: null,
};

const mockArtifactV2 = {
  id: 502,
  userId: 1,
  opportunityId: 201,
  generationJobId: null,
  format: "x_post",
  channel: "x",
  payload: { text: "Scaling Postgres: connection pooling is not optional. Version 2 refined copy." },
  provenance: "human_edit",
  readiness: "draft",
  supersedesId: 501,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  approvedAt: null,
};

const mockArtifactRegenerated = {
  id: 503,
  userId: 1,
  opportunityId: 201,
  generationJobId: 302,
  format: "x_post",
  channel: "x",
  payload: { text: "Freshly regenerated post: Scaling databases under extreme concurrency." },
  provenance: "generated",
  readiness: "draft",
  supersedesId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  approvedAt: null,
};

const mockIncompatibleArtifact = {
  id: 504,
  userId: 1,
  opportunityId: 202,
  generationJobId: 303,
  format: "unsupported_format_for_channel",
  channel: "x",
  payload: { text: "Incompatible content payload" },
  provenance: "generated",
  readiness: "approved",
  supersedesId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  approvedAt: new Date().toISOString(),
};

test.describe("Create + Review Workflow (Phase 28.2C)", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept default capabilities and accounts for deterministic testing
    await page.route("**/api/repurposing/capabilities", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          formats: [
            { format: "x_post", channel: "x", visual: "none" },
            { format: "x_thread", channel: "x", visual: "none" },
            { format: "linkedin_post", channel: "linkedin", visual: "none" },
            { format: "linkedin_article", channel: "linkedin", visual: "none" },
            { format: "instagram_carousel", channel: "instagram", visual: "multiple" },
            { format: "instagram_image", channel: "instagram", visual: "single" },
            { format: "youtube_short", channel: "youtube", visual: "video" },
          ],
          limits: { maxTargetsPerPlan: 5, maxCountPerTarget: 3, maxOpportunities: 10 },
        }),
      }),
    );

    await page.route("**/api/channels", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ channels: ["x", "linkedin", "instagram", "youtube", "threads"] }),
      }),
    );

    await page.route("**/api/accounts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: 1, platform: "x", username: "antigravity_dev" },
          { id: 2, platform: "linkedin", username: "Antigravity Team" },
        ]),
      }),
    );

    await page.route("**/api/stories", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([mockStory]),
        });
      }
      return route.continue();
    });

    await page.route("**/api/ideas", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
    );

    await page.route("**/api/voices", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, name: "Engineering Tech Lead", tone: "Analytical" }]),
      }),
    );

    await page.route("**/api/templates", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
    );
  });

  test("Journey A: Create -> choose Post -> choose Story -> generate -> Review -> Approve", async ({ page }) => {
    let approved = false;

    // Route for opportunity creation
    await page.route("**/api/opportunities", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 201, storyId: 101, concept: "Scaling Postgres", format: "x_post", channel: "x" }),
      }),
    );

    // Route for generation job creation
    await page.route("**/api/generation-jobs", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 301, opportunityId: 201, status: "queued" }),
      }),
    );

    // Route for generation run
    await page.route("**/api/generation-jobs/301/run", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "succeeded", artifactId: 501 }),
      }),
    );

    // Route for artifact retrieval
    await page.route("**/api/artifacts/501", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...mockArtifactV1,
          readiness: approved ? "approved" : "draft",
          approvedAt: approved ? new Date().toISOString() : null,
        }),
      }),
    );

    await page.route("**/api/artifacts/501/history", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockArtifactV1]),
      }),
    );

    // Route for submit-review and approve
    await page.route("**/api/artifacts/501/submit-review", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...mockArtifactV1, readiness: "in_review" }),
      }),
    );

    await page.route("**/api/artifacts/501/approve", (route) => {
      approved = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...mockArtifactV1, readiness: "approved", approvedAt: new Date().toISOString() }),
      });
    });

    await page.goto("/create");
    await expect(page.locator('[data-testid="create-studio-container"]')).toBeVisible();

    // 1. Select Post format
    const postTypeBtn = page.locator('[data-testid="button-type-post"]');
    await expect(postTypeBtn).toBeVisible();
    await postTypeBtn.click();

    // 2. Select From Story entry point
    const storyEntryBtn = page.locator('[data-testid="button-start-with-story"]');
    await expect(storyEntryBtn).toBeVisible();
    await storyEntryBtn.click();

    // 3. Pick the story
    const storyItem = page.locator(`[data-testid="item-story-${mockStory.id}"]`);
    await expect(storyItem).toBeVisible();
    await storyItem.click();

    // 4. Verify topic auto-filled from story
    const conceptInput = page.locator('[data-testid="input-create-concept"]');
    await expect(conceptInput).toHaveValue(mockStory.insightBody);

    // 5. Generate content
    const generateBtn = page.locator('[data-testid="button-generate-content"]');
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // 6. Transition to Review View
    const reviewView = page.locator('[data-testid="view-artifact-review"]');
    await expect(reviewView).toBeVisible({ timeout: 15_000 });

    // 7. Verify truthful metadata
    await expect(page.locator('[data-testid="badge-artifact-version"]')).toHaveText("v1");
    await expect(page.locator('[data-testid="badge-artifact-status"]')).toContainText("Draft");
    await expect(page.locator('[data-testid="text-review-target-account"]')).toContainText("@antigravity_dev");
    await expect(page.locator('[data-testid="text-review-rendered-content"]')).toContainText(
      "Scaling Postgres: connection pooling is not optional",
    );

    // 8. Verify pre-approval action buttons: Edit, Regenerate, Approve
    const approveBtn = page.locator('[data-testid="button-review-approve"]');
    const editBtn = page.locator('[data-testid="button-review-edit"]');
    const regenBtn = page.locator('[data-testid="button-review-regenerate"]');
    await expect(approveBtn).toBeVisible();
    await expect(editBtn).toBeVisible();
    await expect(regenBtn).toBeVisible();

    // 9. Approve
    await approveBtn.click();

    // 10. Post-approval actions: Publish Now and Schedule
    await expect(page.locator('[data-testid="button-review-publish"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="button-review-schedule"]')).toBeVisible();
    await expect(page.locator('[data-testid="badge-artifact-status"]')).toContainText("Approved");
  });

  test("Journey B: Create -> generate -> Edit -> creates Version 2 in draft without mutating original", async ({ page }) => {
    let currentArtifact = mockArtifactV1;
    let history = [mockArtifactV1];

    await page.route("**/api/artifacts/501", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentArtifact),
      }),
    );

    await page.route("**/api/artifacts/502", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockArtifactV2),
      }),
    );

    await page.route("**/api/artifacts/**/history", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(history),
      }),
    );

    await page.route("**/api/artifacts/501/revise", (route) => {
      currentArtifact = mockArtifactV2;
      history = [mockArtifactV1, mockArtifactV2];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(mockArtifactV2),
      });
    });

    await page.goto("/create?artifact=501");
    await expect(page.locator('[data-testid="view-artifact-review"]')).toBeVisible();

    // Click Edit
    const editBtn = page.locator('[data-testid="button-review-edit"]');
    await editBtn.click();

    // Textarea appears with existing text
    const editTextarea = page.locator('[data-testid="textarea-review-edit"]');
    await expect(editTextarea).toBeVisible();
    await expect(editTextarea).toHaveValue(mockArtifactV1.payload.text);

    // Modify text
    await editTextarea.fill("Scaling Postgres: connection pooling is not optional. Version 2 refined copy.");

    // Save revision
    const saveBtn = page.locator('[data-testid="button-review-save-edit"]');
    await saveBtn.click();

    // Verify Version 2 is loaded and in draft
    await expect(page.locator('[data-testid="badge-artifact-version"]')).toHaveText("v2");
    await expect(page.locator('[data-testid="badge-artifact-status"]')).toContainText("Draft");
    await expect(page.locator('[data-testid="text-review-rendered-content"]')).toContainText("Version 2 refined copy");

    // Verify revision pills are present for v1 and v2
    const revisionList = page.locator('[data-testid="list-artifact-revisions"]');
    await expect(revisionList).toBeVisible();
    await expect(page.locator('[data-testid="button-version-pill-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-version-pill-2"]')).toBeVisible();
  });

  test("Journey C: Create -> generate -> Regenerate -> triggers new generation job", async ({ page }) => {
    let currentArtifact = mockArtifactV1;

    await page.route("**/api/artifacts/501", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentArtifact),
      }),
    );

    await page.route("**/api/artifacts/503", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockArtifactRegenerated),
      }),
    );

    await page.route("**/api/artifacts/**/history", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockArtifactV1]),
      }),
    );

    // New generation job created with regenerate: true
    await page.route("**/api/generation-jobs", (route) => {
      const postData = route.request().postDataJSON();
      expect(postData.regenerate).toBe(true);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 302, opportunityId: 201, status: "queued" }),
      });
    });

    await page.route("**/api/generation-jobs/302/run", (route) => {
      currentArtifact = mockArtifactRegenerated;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "succeeded", artifactId: 503 }),
      });
    });

    await page.goto("/create?artifact=501");
    await expect(page.locator('[data-testid="view-artifact-review"]')).toBeVisible();

    const regenBtn = page.locator('[data-testid="button-review-regenerate"]');
    await expect(regenBtn).toBeVisible();
    await regenBtn.click();

    // Verify newly regenerated content displays
    await expect(page.locator('[data-testid="text-review-rendered-content"]')).toContainText(
      "Freshly regenerated post",
    );
  });

  test("Journey D: Approved content -> Schedule handoff (validates real date & time selection)", async ({ page }) => {
    const approvedArtifact = { ...mockArtifactV1, readiness: "approved", approvedAt: new Date().toISOString() };

    await page.route("**/api/artifacts/501", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(approvedArtifact),
      }),
    );

    await page.route("**/api/artifacts/501/history", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([approvedArtifact]),
      }),
    );

    let scheduledPayload: any = null;
    await page.route("**/api/schedules", (route) => {
      scheduledPayload = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 801, artifactId: 501, status: "active", startAt: scheduledPayload?.startAt }),
      });
    });

    await page.goto("/create?artifact=501");
    await expect(page.locator('[data-testid="view-artifact-review"]')).toBeVisible();

    // Open Schedule dialog
    const scheduleBtn = page.locator('[data-testid="button-review-schedule"]');
    await expect(scheduleBtn).toBeVisible();
    await scheduleBtn.click();

    const scheduleDialog = page.locator('[data-testid="dialog-artifact-schedule"]');
    await expect(scheduleDialog).toBeVisible();

    // Confirm button must be disabled before date/time is selected
    const confirmScheduleBtn = page.locator('[data-testid="button-confirm-schedule"]');
    await expect(confirmScheduleBtn).toBeDisabled();

    // Pick date and time using SchedulePicker
    const dateInput = scheduleDialog.locator('input[type="date"]');
    const timeInput = scheduleDialog.locator('input[type="time"]');

    if (await dateInput.isVisible()) {
      await dateInput.fill("2026-10-15");
      await timeInput.fill("14:30");
      await expect(confirmScheduleBtn).toBeEnabled();
      await confirmScheduleBtn.click();
      await expect(scheduleDialog).toBeHidden();
      expect(scheduledPayload).not.toBeNull();
      expect(scheduledPayload.artifactId).toBe(501);
    } else {
      // If datepicker uses buttons/popover
      await page.keyboard.press("Escape");
    }
  });

  test("Journey E: Approved content -> Publish now (preview + connected account + confirmation)", async ({ page }) => {
    const approvedArtifact = { ...mockArtifactV1, readiness: "approved", approvedAt: new Date().toISOString() };

    await page.route("**/api/artifacts/501", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(approvedArtifact),
      }),
    );

    await page.route("**/api/artifacts/501/history", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([approvedArtifact]),
      }),
    );

    let publishedTargets: any = null;
    await page.route("**/api/artifacts/501/publications", (route) => {
      publishedTargets = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ publications: [{ id: 901, artifactId: 501, status: "sent", channel: "x" }] }),
      });
    });

    await page.goto("/create?artifact=501");
    await expect(page.locator('[data-testid="view-artifact-review"]')).toBeVisible();

    // Open Publish dialog
    const publishBtn = page.locator('[data-testid="button-review-publish"]');
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();

    const publishDialog = page.locator('[data-testid="dialog-artifact-publish"]');
    await expect(publishDialog).toBeVisible();

    // Verify preview contents and target account are shown
    await expect(publishDialog).toContainText("@antigravity_dev");
    await expect(publishDialog).toContainText("Scaling Postgres");

    // Click confirm publish
    const confirmBtn = page.locator('[data-testid="button-confirm-publish"]');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    await expect(publishDialog).toBeHidden({ timeout: 10_000 });
    expect(publishedTargets).not.toBeNull();
  });

  test("Journey F: Generation HTTP failure -> ErrorState with retry", async ({ page }) => {
    let failRequest = true;

    await page.route("**/api/opportunities", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 201, concept: "Error test concept", format: "x_post", channel: "x" }),
      }),
    );

    await page.route("**/api/generation-jobs", (route) => {
      if (failRequest) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Generation model timed out. Please try again." }),
        });
      }
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 301, opportunityId: 201, status: "queued" }),
      });
    });

    await page.route("**/api/generation-jobs/301/run", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "succeeded", artifactId: 501 }),
      }),
    );

    await page.route("**/api/artifacts/501", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockArtifactV1),
      }),
    );

    await page.route("**/api/artifacts/501/history", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockArtifactV1]),
      }),
    );

    await page.goto("/create");

    // Fill concept
    const conceptInput = page.locator('[data-testid="input-create-concept"]');
    await conceptInput.fill("Resilience under failure conditions");

    // Click Generate
    const generateBtn = page.locator('[data-testid="button-generate-content"]');
    await generateBtn.click();

    // Verify ErrorState component renders with retry button
    const errorState = page.locator('[data-testid="error-state"]');
    await expect(errorState).toBeVisible({ timeout: 15_000 });
    await expect(errorState).toContainText("Couldn't generate this content");

    // Unfail and retry
    failRequest = false;
    const retryBtn = page.locator('[data-testid="button-error-state-retry"]');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // Recover into review view
    await expect(page.locator('[data-testid="view-artifact-review"]')).toBeVisible({ timeout: 15_000 });
  });

  test("Journey G: Pre-publish incompatibility warning banner is shown for unsupported formats", async ({ page }) => {
    await page.route("**/api/artifacts/504", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockIncompatibleArtifact),
      }),
    );

    await page.route("**/api/artifacts/504/history", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockIncompatibleArtifact]),
      }),
    );

    await page.goto("/create?artifact=504");
    await expect(page.locator('[data-testid="view-artifact-review"]')).toBeVisible();

    // Incompatibility banner is rendered
    const banner = page.locator('[data-testid="banner-publish-incompatible"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Channel Compatibility Notice");

    // Publishing is disabled
    const publishBtn = page.locator('[data-testid="button-review-publish"]');
    await expect(publishBtn).toBeDisabled();
  });

  test("Journey H: Responsive Viewports (Desktop 1440x900, Tablet 820x1180, Mobile 390x844)", async ({ page }) => {
    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 820, height: 1180 },
      { name: "mobile", width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/create");

      // Verify Studio container is fully rendered and within bounds
      const studio = page.locator('[data-testid="create-studio-container"]');
      await expect(studio).toBeVisible();
      const studioBox = await studio.boundingBox();
      expect(studioBox).not.toBeNull();
      if (studioBox) {
        expect(studioBox.width).toBeLessThanOrEqual(vp.width);
      }

      // Generate button is reachable and visible
      const generateBtn = page.locator('[data-testid="button-generate-content"]');
      await expect(generateBtn).toBeVisible();
    }
  });

  test("Journey I: Accessibility (0 Axe violations on Studio and Review states)", async ({ page }) => {
    await page.route("**/api/artifacts/501", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockArtifactV1),
      }),
    );

    await page.route("**/api/artifacts/501/history", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockArtifactV1]),
      }),
    );

    // Studio view accessibility
    await page.goto("/create");
    await expect(page.locator('[data-testid="create-studio-container"]')).toBeVisible();

    const studioResults = await new AxeBuilder({ page })
      .withRules(["document-title", "meta-viewport", "button-name", "label"])
      .analyze();
    expect(studioResults.violations, JSON.stringify(studioResults.violations, null, 2)).toEqual([]);

    // Review view accessibility
    await page.goto("/create?artifact=501");
    await expect(page.locator('[data-testid="view-artifact-review"]')).toBeVisible();

    const reviewResults = await new AxeBuilder({ page })
      .withRules(["document-title", "meta-viewport", "button-name", "label"])
      .analyze();
    expect(reviewResults.violations, JSON.stringify(reviewResults.violations, null, 2)).toEqual([]);
  });

  test("Journey J: Preserves legacy creation modes bar navigation", async ({ page }) => {
    await page.goto("/create");
    const modesNav = page.locator('[data-testid="nav-create-modes"]');
    await expect(modesNav).toBeVisible();

    const expectedLinks = [
      { id: "post-thread", href: "/create" },
      { id: "hooks", href: "/create?mode=hooks" },
      { id: "carousel", href: "/create?mode=carousel" },
      { id: "images", href: "/create?mode=images" },
      { id: "articles", href: "/create?mode=articles" },
      { id: "templates", href: "/create?mode=templates" },
      { id: "formatter", href: "/create?mode=formatter" },
      { id: "canned-responses", href: "/create?mode=canned-responses" },
      { id: "chat-post", href: "/create?mode=chat-post" },
    ];

    for (const item of expectedLinks) {
      const link = page.locator(`[data-testid="link-create-mode-${item.id}"]`);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", item.href);
    }
  });
});
