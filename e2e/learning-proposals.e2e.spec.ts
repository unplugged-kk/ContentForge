import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";

async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.get("/api/csrf-token");
  const { csrfToken } = await res.json();
  return { "X-CSRF-Token": csrfToken };
}

test.describe("ContentForge Phase 29.1 — Learning Foundation (Mocked UI Journeys)", () => {
  test.beforeEach(async ({ page }) => {
    // Mock standard style profiles
    await page.route("**/api/style/profiles", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profiles: [
            {
              id: 1,
              name: "Technical Deep-Dive",
              confidence: "high",
              sampleCount: 8,
              isActive: true,
              channel: "linkedin",
              stylePromptSnippet: "Direct, metric-driven, bulleted takeaways",
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    // Mock learning summary
    await page.route("**/api/learning/summary", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          publishedCount: 14,
          successRate: 1.0,
          approvalRate: 0.857,
          byChannel: [{ channel: "linkedin", published: 10, observedMetrics: 10 }],
          byFormat: [{ format: "carousel", published: 8 }, { format: "post", published: 6 }],
          byStory: [],
          signalCounts: { approval: 12, rejection: 2 },
          metricTotals: [
            { metric: "impressions", total: 42000, observedCount: 12, notAvailableCount: 2 },
            { metric: "likes", total: 1850, observedCount: 14, notAvailableCount: 0 },
          ],
        }),
      });
    });
  });

  test("Journey A: Learning view renders Observed, Learned, and Proposed tiers with proposals", async ({ page }) => {
    // Mock proposals
    await page.route("**/api/learning/proposals", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            userId: 1,
            observationId: 1,
            proposalType: "format_distribution",
            targetScope: "channel:linkedin;format:carousel",
            title: "Consider increasing carousel content on linkedin",
            rationale: "Observed: carousel content on linkedin showed 48.2% higher average engagements compared to the channel baseline across 6 publications.",
            expectedImpactHypothesis: "Prioritizing carousel format for upcoming linkedin opportunities is expected to maintain above-average engagement.",
            evidenceQuality: "directional",
            evidenceSummary: {
              sampleCount: 6,
              candidateValue: "52.00",
              baselineValue: "35.10",
              differencePercentage: "48.2",
              publicationIds: [201, 202, 203, 204, 205, 206],
            },
            status: "proposed",
            reviewedAt: null,
            reviewedBy: null,
            reviewNotes: null,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    // Mock observations
    await page.route("**/api/learning/observations", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            userId: 1,
            dimension: "distribution",
            observationType: "format_channel_performance",
            targetScope: "channel:linkedin;format:carousel",
            candidatePopulation: { channel: "linkedin", format: "carousel", sampleCount: 6 },
            comparisonPopulation: { channel: "linkedin", baseline: "all_channel_formats", sampleCount: 14 },
            metricName: "engagements_per_post",
            candidateValue: "52.0000",
            comparisonValue: "35.1000",
            differencePercentage: "48.15",
            evidenceQuality: "directional",
            evidenceEntityIds: { publicationIds: [201, 202, 203] },
            measurementWindow: "all_time",
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/insights?view=learning");

    // Container
    await expect(page.locator('[data-testid="container-learning-view"]')).toBeVisible();

    // Verify 3 distinct tiers: Proposed, Learned, Observed
    await expect(page.locator('[data-testid="section-learning-proposals"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-learning-inferences"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-learning-observed"]')).toBeVisible();

    // Proposal card
    const proposalCard = page.locator('[data-testid="card-proposal-101"]');
    await expect(proposalCard).toBeVisible();
    await expect(proposalCard).toContainText("Consider increasing carousel content on linkedin");
    await expect(proposalCard).toContainText("Directional");
    await expect(proposalCard).toContainText("6–10 verified items");
    await expect(proposalCard).toContainText("Observed: carousel content on linkedin showed 48.2% higher average engagements");

    // Action buttons visible
    await expect(page.locator('[data-testid="button-accept-proposal-101"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-dismiss-proposal-101"]')).toBeVisible();
  });

  test("Journey B: Inspect Evidence drawer expands and shows sample count, baseline, and delta", async ({ page }) => {
    await page.route("**/api/learning/proposals", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            userId: 1,
            observationId: 1,
            proposalType: "format_distribution",
            targetScope: "channel:linkedin;format:carousel",
            title: "Consider increasing carousel content on linkedin",
            rationale: "Observed: carousel content on linkedin showed 48.2% higher average engagements compared to the channel baseline across 6 publications.",
            expectedImpactHypothesis: "Prioritizing carousel format for upcoming linkedin opportunities is expected to maintain above-average engagement.",
            evidenceQuality: "directional",
            evidenceSummary: {
              sampleCount: 6,
              candidateValue: "52.00",
              baselineValue: "35.10",
              differencePercentage: "48.2",
              publicationIds: [201, 202, 203, 204, 205, 206],
            },
            status: "proposed",
            reviewedAt: null,
            reviewedBy: null,
            reviewNotes: null,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/insights?view=learning");

    // Evidence drawer is initially hidden
    await expect(page.locator('[data-testid="drawer-evidence-101"]')).not.toBeVisible();

    // Click inspect evidence button
    const toggleBtn = page.locator('[data-testid="button-toggle-evidence-101"]');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    // Evidence drawer is now visible
    const drawer = page.locator('[data-testid="drawer-evidence-101"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-testid="text-evidence-sample-count"]')).toContainText("6 publications");
    await expect(drawer).toContainText("52.00");
    await expect(drawer).toContainText("35.10");
    await expect(drawer).toContainText("+48.2%");
    await expect(drawer).toContainText("channel:linkedin;format:carousel");
  });

  test("Journey C: Human review action - Accept proposal updates status to accepted", async ({ page }) => {
    let accepted = false;

    await page.route("**/api/learning/proposals", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            userId: 1,
            observationId: 1,
            proposalType: "format_distribution",
            targetScope: "channel:linkedin;format:carousel",
            title: "Consider increasing carousel content on linkedin",
            rationale: "Observed: carousel content on linkedin showed 48.2% higher average engagements compared to the channel baseline across 6 publications.",
            expectedImpactHypothesis: "Prioritizing carousel format for upcoming linkedin opportunities is expected to maintain above-average engagement.",
            evidenceQuality: "directional",
            evidenceSummary: {
              sampleCount: 6,
              candidateValue: "52.00",
              baselineValue: "35.10",
              differencePercentage: "48.2",
              publicationIds: [201, 202, 203, 204, 205, 206],
            },
            status: accepted ? "accepted" : "proposed",
            reviewedAt: accepted ? new Date().toISOString() : null,
            reviewedBy: accepted ? 1 : null,
            reviewNotes: null,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.route("**/api/learning/proposals/101/accept", (route) => {
      accepted = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 101,
          status: "accepted",
          reviewedAt: new Date().toISOString(),
          reviewedBy: 1,
        }),
      });
    });

    await page.goto("/insights?view=learning");

    // Click Accept button
    const acceptBtn = page.locator('[data-testid="button-accept-proposal-101"]');
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // Verify accepted badge is rendered
    await expect(page.locator('[data-testid="badge-status-accepted-101"]')).toBeVisible();
    await expect(page.locator('[data-testid="badge-status-accepted-101"]')).toContainText("Accepted (Human Reviewed)");
  });

  test("Journey D: Accessibility audit passes on learning surface with zero violations", async ({ page }) => {
    await page.route("**/api/learning/proposals", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 101,
            userId: 1,
            observationId: 1,
            proposalType: "format_distribution",
            targetScope: "channel:linkedin;format:carousel",
            title: "Consider increasing carousel content on linkedin",
            rationale: "Observed: carousel content on linkedin showed 48.2% higher average engagements compared to the channel baseline across 6 publications.",
            expectedImpactHypothesis: "Prioritizing carousel format for upcoming linkedin opportunities is expected to maintain above-average engagement.",
            evidenceQuality: "directional",
            evidenceSummary: {
              sampleCount: 6,
              candidateValue: "52.00",
              baselineValue: "35.10",
              differencePercentage: "48.2",
            },
            status: "proposed",
            reviewedAt: null,
            reviewedBy: null,
            reviewNotes: null,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/insights?view=learning");
    await expect(page.locator('[data-testid="container-learning-view"]')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"]) // match project's standard accessibility test pattern
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe("ContentForge Phase 29.1 — Real Data Learning Loop (Unmocked E2E)", () => {
  test("Journey E: Full end-to-end unmocked cycle from extraction to UI proposal acceptance", async ({
    page,
    request,
  }) => {
    // 1. Get authenticated user ID from session
    const meRes = await request.get("/api/auth/me");
    expect(meRes.ok()).toBeTruthy();
    const me = await meRes.json();
    const userId: number = me.id;
    expect(userId).toBeGreaterThan(0);

    const dbUrl =
      process.env.DATABASE_URL || "postgresql://cfuser:cfpass@127.0.0.1:15433/cf_test";
    const pool = new pg.Pool({ connectionString: dbUrl });

    const runTag = `e2e_${Date.now()}`;
    const createdPublicationIds: number[] = [];
    const createdArtifactIds: number[] = [];
    const createdScheduleIds: number[] = [];
    let storyId: number | null = null;
    let oppId: number | null = null;

    try {
      // 2. Seed real domain entities in PostgreSQL
      // Story
      const storyRes = await pool.query(
        `INSERT INTO stories (user_id, title, insight_body, status)
         VALUES ($1, $2, $3, 'ready') RETURNING id`,
        [userId, `Story ${runTag}`, "Insight body for E2E learning test"]
      );
      storyId = storyRes.rows[0].id;

      // Opportunity
      const oppRes = await pool.query(
        `INSERT INTO opportunities (user_id, story_id, concept, objective, channel, format, status)
         VALUES ($1, $2, $3, $4, 'linkedin', 'carousel', 'selected') RETURNING id`,
        [userId, storyId, `Opp ${runTag}`, "Drive engagement"]
      );
      oppId = oppRes.rows[0].id;

      // Candidate: 3 carousel publications with likes = 50
      for (let i = 1; i <= 3; i++) {
        const artRes = await pool.query(
          `INSERT INTO artifacts (user_id, opportunity_id, channel, format, payload, readiness)
           VALUES ($1, $2, 'linkedin', 'carousel', $3, 'approved') RETURNING id`,
          [userId, oppId, JSON.stringify({ text: `Carousel ${i} ${runTag}` })]
        );
        const artId = artRes.rows[0].id;
        createdArtifactIds.push(artId);

        const schedRes = await pool.query(
          `INSERT INTO schedules (user_id, artifact_id, channel, start_at, status)
           VALUES ($1, $2, 'linkedin', NOW(), 'active') RETURNING id`,
          [userId, artId]
        );
        const schedId = schedRes.rows[0].id;
        createdScheduleIds.push(schedId);

        const occRes = await pool.query(
          `INSERT INTO schedule_occurrences (schedule_id, occurrence_time, status)
           VALUES ($1, NOW(), 'published') RETURNING id`,
          [schedId]
        );
        const occId = occRes.rows[0].id;

        const pubRes = await pool.query(
          `INSERT INTO publications (user_id, schedule_id, occurrence_id, artifact_id, channel, state, idempotency_key, correlation_id)
           VALUES ($1, $2, $3, $4, 'linkedin', 'published', $5, $6) RETURNING id`,
          [userId, schedId, occId, artId, `pub:car:${artId}:${runTag}`, `corr-car-${artId}-${runTag}`]
        );
        const pubId = pubRes.rows[0].id;
        createdPublicationIds.push(pubId);

        await pool.query(
          `INSERT INTO performance_signals (user_id, publication_id, artifact_id, channel, provider, external_id, metric, value, availability, observed_at, retrieved_at, measurement_window, normalization_version, provenance, identity_key)
           VALUES ($1, $2, $3, 'linkedin', 'linkedin', $4, 'likes', 50, 'observed', NOW(), NOW(), 'all_time', 'performance.v1', '{}', $5)`,
          [userId, pubId, artId, `ext-${pubId}`, `perf:${pubId}:likes:${runTag}`]
        );
      }

      // Comparison: 3 post publications with likes = 20
      for (let i = 1; i <= 3; i++) {
        const artRes = await pool.query(
          `INSERT INTO artifacts (user_id, opportunity_id, channel, format, payload, readiness)
           VALUES ($1, $2, 'linkedin', 'post', $3, 'approved') RETURNING id`,
          [userId, oppId, JSON.stringify({ text: `Post ${i} ${runTag}` })]
        );
        const artId = artRes.rows[0].id;
        createdArtifactIds.push(artId);

        const schedRes = await pool.query(
          `INSERT INTO schedules (user_id, artifact_id, channel, start_at, status)
           VALUES ($1, $2, 'linkedin', NOW(), 'active') RETURNING id`,
          [userId, artId]
        );
        const schedId = schedRes.rows[0].id;
        createdScheduleIds.push(schedId);

        const occRes = await pool.query(
          `INSERT INTO schedule_occurrences (schedule_id, occurrence_time, status)
           VALUES ($1, NOW(), 'published') RETURNING id`,
          [schedId]
        );
        const occId = occRes.rows[0].id;

        const pubRes = await pool.query(
          `INSERT INTO publications (user_id, schedule_id, occurrence_id, artifact_id, channel, state, idempotency_key, correlation_id)
           VALUES ($1, $2, $3, $4, 'linkedin', 'published', $5, $6) RETURNING id`,
          [userId, schedId, occId, artId, `pub:post:${artId}:${runTag}`, `corr-post-${artId}-${runTag}`]
        );
        const pubId = pubRes.rows[0].id;
        createdPublicationIds.push(pubId);

        await pool.query(
          `INSERT INTO performance_signals (user_id, publication_id, artifact_id, channel, provider, external_id, metric, value, availability, observed_at, retrieved_at, measurement_window, normalization_version, provenance, identity_key)
           VALUES ($1, $2, $3, 'linkedin', 'linkedin', $4, 'likes', 20, 'observed', NOW(), NOW(), 'all_time', 'performance.v1', '{}', $5)`,
          [userId, pubId, artId, `ext-${pubId}`, `perf:${pubId}:likes:${runTag}`]
        );
      }

      // 3. Trigger pattern extraction via real API endpoint
      const headers = await csrfHeaders(request);
      const extractRes = await request.post("/api/learning/extract", { headers });
      if (!extractRes.ok()) {
        console.error("Extract failed:", extractRes.status(), await extractRes.text());
      }
      expect(extractRes.ok()).toBeTruthy();
      const extractResult = await extractRes.json();
      expect(extractResult.stats.proposalsGenerated).toBeGreaterThanOrEqual(1);

      // 4. Retrieve proposals via real API endpoint
      const proposalsRes = await request.get("/api/learning/proposals");
      expect(proposalsRes.ok()).toBeTruthy();
      const proposals = await proposalsRes.json();
      const targetProp = proposals.find(
        (p: any) =>
          p.proposalType === "format_distribution" &&
          p.targetScope === "channel:linkedin;format:carousel" &&
          p.status === "proposed"
      );
      expect(targetProp).toBeTruthy();
      const propId = targetProp.id;

      // 5. Navigate to UI learning surface without any route mocks
      await page.goto("/insights?view=learning");
      await expect(page.locator('[data-testid="container-learning-view"]')).toBeVisible();

      // 6. Verify proposal card is rendered in the UI
      const proposalCard = page.locator(`[data-testid="card-proposal-${propId}"]`);
      await expect(proposalCard).toBeVisible();
      await expect(proposalCard).toContainText("Consider increasing carousel content on linkedin");
      await expect(proposalCard).toContainText("Observed");
      await expect(proposalCard).toContainText("3–5 verified items");

      // 7. Toggle evidence drawer and verify contents
      const toggleBtn = page.locator(`[data-testid="button-toggle-evidence-${propId}"]`);
      await toggleBtn.click();
      const drawer = page.locator(`[data-testid="drawer-evidence-${propId}"]`);
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-testid="text-evidence-sample-count"]')).toContainText("3 publications");
      await expect(drawer).toContainText("+150.0%");

      // 8. Accept proposal via UI button
      const acceptBtn = page.locator(`[data-testid="button-accept-proposal-${propId}"]`);
      await acceptBtn.click();

      // 9. Verify UI updates to show accepted status
      await expect(page.locator(`[data-testid="badge-status-accepted-${propId}"]`)).toBeVisible();
      await expect(page.locator(`[data-testid="badge-status-accepted-${propId}"]`)).toContainText(
        "Accepted (Human Reviewed)"
      );

      // 10. Direct PostgreSQL verification
      const dbPropRes = await pool.query(
        "SELECT status, reviewed_by, reviewed_at FROM learning_proposals WHERE id = $1",
        [propId]
      );
      expect(dbPropRes.rows[0].status).toBe("accepted");
      expect(dbPropRes.rows[0].reviewed_by).toBe(userId);
      expect(dbPropRes.rows[0].reviewed_at).not.toBeNull();

      // Verify zero prompt or policy mutations occurred in the DB
      const dbPolicyRes = await pool.query(
        "SELECT id FROM generation_policies WHERE user_id = $1",
        [userId]
      );
      expect(dbPolicyRes.rows.length).toBe(0);
    } finally {
      // Cleanup seeded data
      if (pool) {
        await pool.query("DELETE FROM learning_proposals WHERE user_id = $1", [userId]);
        await pool.query("DELETE FROM learning_observations WHERE user_id = $1", [userId]);
        await pool.query("DELETE FROM performance_signals WHERE user_id = $1", [userId]);
        if (createdPublicationIds.length > 0) {
          await pool.query("DELETE FROM results WHERE publication_id = ANY($1::int[])", [createdPublicationIds]);
          await pool.query("DELETE FROM publications WHERE id = ANY($1::int[])", [createdPublicationIds]);
        }
        if (createdScheduleIds.length > 0) {
          await pool.query("DELETE FROM schedule_occurrences WHERE schedule_id = ANY($1::int[])", [createdScheduleIds]);
          await pool.query("DELETE FROM schedules WHERE id = ANY($1::int[])", [createdScheduleIds]);
        }
        if (createdArtifactIds.length > 0) {
          await pool.query("DELETE FROM artifacts WHERE id = ANY($1::int[])", [createdArtifactIds]);
        }
        if (oppId) {
          await pool.query("DELETE FROM opportunities WHERE id = $1", [oppId]);
        }
        if (storyId) {
          await pool.query("DELETE FROM stories WHERE id = $1", [storyId]);
        }
        await pool.end();
      }
    }
  });
});

