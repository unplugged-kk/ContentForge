import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";

async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.get("/api/csrf-token");
  const { csrfToken } = await res.json();
  return { "X-CSRF-Token": csrfToken };
}

test.describe("ContentForge Phase 29.2 — Controlled Optimization & Experimentation (Mocked UI Journeys)", () => {
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
          publishedCount: 10,
          successRate: 1.0,
          approvalRate: 0.9,
          byChannel: [{ channel: "linkedin", published: 10, observedMetrics: 10 }],
          byFormat: [{ format: "carousel", published: 6 }, { format: "post", published: 4 }],
          byStory: [],
          signalCounts: { approval: 9, rejection: 1 },
          metricTotals: [
            { metric: "impressions", total: 25000, observedCount: 10, notAvailableCount: 0 },
            { metric: "likes", total: 1200, observedCount: 10, notAvailableCount: 0 },
          ],
        }),
      });
    });

    // Mock proposals
    await page.route("**/api/learning/proposals", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 201,
            userId: 1,
            observationId: 1,
            proposalType: "format_distribution",
            targetScope: "channel:linkedin;format:carousel",
            title: "Test carousel format vs post format on LinkedIn",
            rationale: "Carousel posts have shown higher average engagement in exploratory signals.",
            expectedImpactHypothesis: "Carousels will increase engagement by >= 25% without impacting delivery.",
            evidenceQuality: "directional",
            evidenceSummary: {
              sampleCount: 6,
              candidateValue: "45.00",
              baselineValue: "30.00",
              differencePercentage: "50.0",
              publicationIds: [1, 2, 3],
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
        body: JSON.stringify([]),
      });
    });
  });

  test("renders empty states for Controlled Experiments and Policy Candidates when none exist", async ({ page }) => {
    await page.route("**/api/experiments", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/policy-candidates", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/insights?view=learning");
    await expect(page.locator('[data-testid="page-insights"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-controlled-experiments"]')).toBeVisible();
    await expect(page.locator('[data-testid="empty-controlled-experiments"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-policy-candidates"]')).toBeVisible();
    await expect(page.locator('[data-testid="empty-policy-candidates"]')).toBeVisible();
  });

  test("renders active experiments, evaluation drawer, guardrail checks, and decision actions", async ({ page }) => {
    const mockExperiment = {
      id: 501,
      userId: 1,
      name: "LinkedIn Carousel Engagement Test",
      hypothesis: "Carousels will produce >= 25% higher engagement compared to text posts",
      objective: "Drive engagement",
      targetScope: "channel:linkedin;format:carousel",
      experimentType: "format_distribution",
      primaryMetric: "likes",
      guardrailMetrics: ["publication_failure_rate"],
      status: "running",
      minSampleSize: 3,
      startedAt: new Date().toISOString(),
      completedAt: null,
      winningVariantId: null,
      decision: "pending",
      decisionNotes: null,
      decidedAt: null,
      sourceProposalId: 201,
      createdAt: new Date().toISOString(),
      assignmentsCount: 6,
      variants: [
        {
          id: 11,
          experimentId: 501,
          variantKey: "control",
          name: "Standard Post",
          description: null,
          isControl: true,
          trafficWeight: 50,
          policySnapshot: { format: "post" },
        },
        {
          id: 12,
          experimentId: 501,
          variantKey: "variant_a",
          name: "Carousel Format",
          description: null,
          isControl: false,
          trafficWeight: 50,
          policySnapshot: { format: "carousel" },
        },
      ],
      latestEvaluation: {
        id: 1,
        experimentId: 501,
        primaryMetric: "likes",
        controlMetrics: { sampleCount: 3, mean: "20.00" },
        variantMetrics: [
          {
            variantId: 12,
            variantKey: "variant_a",
            sampleCount: 3,
            mean: "35.00",
            difference: "15.00",
            differencePercentage: "75.0",
          },
        ],
        guardrailResults: [
          {
            metric: "publication_failure_rate",
            status: "passed",
            controlValue: "0.00",
            variantValue: "0.00",
            message: "Guardrail publication_failure_rate within tolerance",
          },
        ],
        evidenceQuality: "observed",
        recommendedDecision: "variant_promising",
        summary:
          "In channel:linkedin;format:carousel, variant_a achieved a mean likes of 35.00 compared to control mean of 20.00 (+75.0% observed difference across 3 variant samples). All 1 guardrails remained within acceptable thresholds.",
        evaluatedAt: new Date().toISOString(),
      },
    };

    const mockCandidates = [
      {
        id: 801,
        userId: 1,
        experimentId: 501,
        sourceProposalId: 201,
        title: "Candidate from LinkedIn Carousel Test",
        candidateType: "format_distribution",
        targetScope: "channel:linkedin;format:carousel",
        candidatePolicy: {
          recommendedFormat: "carousel",
          channel: "linkedin",
          evidenceObservedDelta: "+75.0%",
        },
        baselinePolicy: { format: "post" },
        rationale: "Validated in experiment #501 with 75% engagement improvement.",
        status: "candidate",
        reviewedAt: null,
        reviewNotes: null,
        createdAt: new Date().toISOString(),
      },
    ];

    await page.route("**/api/experiments", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockExperiment]),
      });
    });

    await page.route("**/api/policy-candidates", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockCandidates),
      });
    });

    await page.goto("/insights?view=learning");

    // 1. Verify Controlled Experiment card rendered
    const expCard = page.locator('[data-testid="card-experiment-501"]');
    await expect(expCard).toBeVisible();
    await expect(page.locator('[data-testid="text-experiment-name-501"]')).toContainText(
      "LinkedIn Carousel Engagement Test"
    );
    await expect(page.locator('[data-testid="badge-experiment-status-501"]')).toContainText("running");

    // 2. Expand details drawer
    await page.locator('[data-testid="button-toggle-experiment-details-501"]').click();
    await expect(page.locator('[data-testid="drawer-experiment-details-501"]')).toBeVisible();

    // 3. Verify evaluation summary, evidence quality, and recommendation
    await expect(page.locator('[data-testid="badge-experiment-evidence-quality"]')).toContainText(
      "observed evidence"
    );
    await expect(page.locator('[data-testid="badge-recommended-decision"]')).toContainText(
      "variant promising"
    );

    // 4. Verify decision action buttons exist
    await expect(page.locator('[data-testid="button-decide-promising-501"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-decide-control-501"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-decide-inconclusive-501"]')).toBeVisible();

    // 5. Verify Policy Candidate card rendered with Governance Actions
    const candidateCard = page.locator('[data-testid="card-policy-candidate-801"]');
    await expect(candidateCard).toBeVisible();
    await expect(page.locator('[data-testid="badge-candidate-status-801"]')).toContainText(
      "Review Pending"
    );
    await expect(page.locator('[data-testid="button-approve-candidate-801"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-reject-candidate-801"]')).toBeVisible();

    // 6. Accessibility Audit
    const accessibilityScanResults = await new AxeBuilder({ page })
      .include('[data-testid="section-controlled-experiments"]')
      .include('[data-testid="section-policy-candidates"]')
      .analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("allows creating an experiment directly from an optimization proposal", async ({ page }) => {
    let createdExperimentPayload: any = null;

    await page.route("**/api/experiments", (route) => {
      if (route.request().method() === "POST") {
        createdExperimentPayload = JSON.parse(route.request().postData() || "{}");
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: 999,
            name: createdExperimentPayload.name,
            status: "running",
            variants: createdExperimentPayload.variants || [],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/policy-candidates", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/insights?view=learning");

    // Click "Test in Experiment" on proposal 201
    const testBtn = page.locator('[data-testid="button-create-experiment-201"]');
    await expect(testBtn).toBeVisible();

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes("/api/experiments") && req.method() === "POST"
    );
    await testBtn.click();
    const interceptedRequest = await requestPromise;

    const payload = JSON.parse(interceptedRequest.postData() || "{}");
    expect(payload.sourceProposalId).toBe(201);
    expect(payload.targetScope).toBe("channel:linkedin;format:carousel");
    expect(payload.variants.length).toBe(2);
    expect(payload.variants[0].isControl).toBe(true);
    expect(payload.variants[1].isControl).toBe(false);
  });
});

test.describe("ContentForge Phase 29.3 — Human-Gated Policy Activation (Mocked UI Journeys)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/style/profiles", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profiles: [] }) }),
    );
    await page.route("**/api/learning/summary", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          publishedCount: 0,
          successRate: null,
          approvalRate: null,
          byChannel: [],
          byFormat: [],
          byStory: [],
          signalCounts: {},
          metricTotals: [],
        }),
      }),
    );
    await page.route("**/api/learning/proposals", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/learning/observations", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/experiments", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
  });

  test("activation requires explicit confirmation and rollback requires a separate explicit confirmation", async ({ page }) => {
    const candidate = {
      id: 901,
      userId: 1,
      experimentId: 601,
      evaluationId: 701,
      title: "Candidate: Carousel default for LinkedIn",
      targetScope: "channel:linkedin;format:carousel",
      proposedConfiguration: { format: "carousel", tone: "energetic" },
      rationale: "Observed +32% engagement under controlled assignment.",
      status: "approved_for_future",
      reviewedAt: new Date().toISOString(),
      reviewNotes: null,
      createdAt: new Date().toISOString(),
    };

    await page.route("**/api/policy-candidates", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([candidate]) });
      }
      return route.continue();
    });

    let activateCalls = 0;
    await page.route("**/api/policy-candidates/901/activate", (route) => {
      activateCalls += 1;
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          activation: { id: 1, action: "activate", policyCandidateId: 901 },
          policy: { id: 5001, status: "active", policyKey: "pol:carousel:linkedin" },
          previousPolicy: null,
          alreadyActivated: false,
        }),
      });
    });
    let rollbackCalls = 0;
    await page.route("**/api/policy-candidates/901/rollback", (route) => {
      rollbackCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          activation: { id: 2, action: "rollback", policyCandidateId: 901 },
          policy: { id: 4999, status: "active", policyKey: "pol:carousel:linkedin" },
          previousPolicy: { id: 5001 },
          alreadyActivated: false,
        }),
      });
    });

    await page.goto("/insights?view=learning");

    const activateBtn = page.locator('[data-testid="button-activate-candidate-901"]');
    await expect(activateBtn).toBeVisible();
    await activateBtn.click();

    // Clicking the trigger must NOT activate immediately -- an explicit confirm dialog gates it.
    expect(activateCalls).toBe(0);
    const confirmDialog = page.locator('[data-testid="dialog-confirm"]');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText("change future generation behavior");
    await expect(confirmDialog).toContainText("channel:linkedin;format:carousel");

    await page.locator('[data-testid="button-confirm-action"]').click();
    await expect(confirmDialog).toBeHidden();
    expect(activateCalls).toBe(1);

    // After activation, the UI flips to offering Roll Back, not a second Activate.
    const rollbackBtn = page.locator('[data-testid="button-rollback-candidate-901"]');
    await expect(rollbackBtn).toBeVisible();
    await expect(activateBtn).toBeHidden();

    await rollbackBtn.click();
    expect(rollbackCalls).toBe(0);
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText("Existing generated content will not change");
    await page.locator('[data-testid="button-confirm-action"]').click();
    expect(rollbackCalls).toBe(1);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .include('[data-testid="section-policy-candidates"]')
      .analyze();
    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

test.describe("ContentForge Phase 29.2 — Controlled Optimization Full Unmocked Live DB Journey", () => {
  test("Full loop: Proposal -> Experiment -> Allocation -> Signals -> Evaluation -> Human Decision -> Policy Candidate -> Verify Zero Production Mutation", async ({
    page,
    request,
  }) => {
    // 1. Authenticated user from session
    const meRes = await request.get("/api/auth/me");
    expect(meRes.ok()).toBeTruthy();
    const me = await meRes.json();
    const userId: number = me.id;
    expect(userId).toBeGreaterThan(0);

    const dbUrl =
      process.env.DATABASE_URL || "postgresql://cfuser:cfpass@127.0.0.1:15433/cf_test";
    const pool = new pg.Pool({ connectionString: dbUrl });

    const runTag = `e2e_exp_${Date.now()}`;
    let expId: number | null = null;
    let storyId: number | null = null;
    const oppIds: number[] = [];
    const createdPubIds: number[] = [];
    const createdArtIds: number[] = [];
    const createdSchedIds: number[] = [];

    try {
      // 2. Baseline check: count existing generation policies
      const initialPolicyCountRes = await pool.query(
        "SELECT count(*) FROM generation_policies WHERE status = 'active'"
      );
      const initialActivePolicyCount = Number(initialPolicyCountRes.rows[0].count);

      // 3. Create a Controlled Experiment via API
      const csrf = await csrfHeaders(request);
      const createExpRes = await request.post("/api/experiments", {
        headers: csrf,
        data: {
          name: `E2E Experiment ${runTag}`,
          hypothesis: "Testing variant performance in unmocked environment",
          objective: "Validate empirical engine",
          targetScope: "channel:linkedin;format:carousel",
          experimentType: "format_distribution",
          primaryMetric: "likes",
          guardrailMetrics: ["publication_failure_rate"],
          minSampleSize: 3,
          status: "running",
          variants: [
            {
              variantKey: "control",
              name: "Baseline Post",
              isControl: true,
              trafficWeight: 50,
              policySnapshot: { format: "post" },
            },
            {
              variantKey: "variant_a",
              name: "Enhanced Carousel",
              isControl: false,
              trafficWeight: 50,
              policySnapshot: { format: "carousel" },
            },
          ],
        },
      });

      expect(createExpRes.ok()).toBeTruthy();
      const expData = await createExpRes.json();
      expId = expData.id;
      expect(expId).toBeGreaterThan(0);

      const controlVariant = expData.variants.find((v: any) => v.isControl);
      const testVariant = expData.variants.find((v: any) => !v.isControl);
      expect(controlVariant).toBeDefined();
      expect(testVariant).toBeDefined();

      // 4. Seed Story and Opportunities
      const storyRes = await pool.query(
        `INSERT INTO stories (user_id, title, insight_body, status)
         VALUES ($1, $2, $3, 'ready') RETURNING id`,
        [userId, `Story ${runTag}`, "Insight body for controlled experiment"]
      );
      storyId = storyRes.rows[0].id;

      // 5. Seed 3 Control posts (likes = 20) and 3 Variant posts (likes = 40)
      for (let i = 1; i <= 6; i++) {
        const isControl = i <= 3;
        const assignedVariantId = isControl ? controlVariant.id : testVariant.id;
        const likeCount = isControl ? "20" : "40";

        const oppRes = await pool.query(
          `INSERT INTO opportunities (user_id, story_id, concept, objective, channel, format, status)
           VALUES ($1, $2, $3, 'Engagement goal', 'linkedin', $4, 'approved') RETURNING id`,
          [userId, storyId, `Opp ${i} ${runTag}`, isControl ? "post" : "carousel"]
        );
        const oppId = oppRes.rows[0].id;
        oppIds.push(oppId);

        const artRes = await pool.query(
          `INSERT INTO artifacts (user_id, opportunity_id, channel, format, payload, readiness)
           VALUES ($1, $2, 'linkedin', $3, $4, 'approved') RETURNING id`,
          [userId, oppId, isControl ? "post" : "carousel", JSON.stringify({ text: `Article ${i}` })]
        );
        const artId = artRes.rows[0].id;
        createdArtIds.push(artId);

        const schedRes = await pool.query(
          `INSERT INTO schedules (user_id, artifact_id, channel, start_at, status)
           VALUES ($1, $2, 'linkedin', NOW(), 'active') RETURNING id`,
          [userId, artId]
        );
        const schedId = schedRes.rows[0].id;
        createdSchedIds.push(schedId);

        const occRes = await pool.query(
          `INSERT INTO schedule_occurrences (schedule_id, occurrence_time, status)
           VALUES ($1, NOW(), 'published') RETURNING id`,
          [schedId]
        );
        const occId = occRes.rows[0].id;

        const pubRes = await pool.query(
          `INSERT INTO publications (user_id, schedule_id, occurrence_id, artifact_id, channel, state, idempotency_key, correlation_id)
           VALUES ($1, $2, $3, $4, 'linkedin', 'published', $5, $6) RETURNING id`,
          [userId, schedId, occId, artId, `p:e2e:${artId}:${runTag}`, `c:e2e:${artId}:${runTag}`]
        );
        const pubId = pubRes.rows[0].id;
        createdPubIds.push(pubId);

        await pool.query(
          `INSERT INTO results (user_id, publication_id, outcome, metrics)
           VALUES ($1, $2, 'published', '{}')`,
          [userId, pubId]
        );

        await pool.query(
          `INSERT INTO performance_signals (user_id, publication_id, artifact_id, channel, provider, external_id, metric, value, availability, observed_at, retrieved_at, measurement_window, normalization_version, provenance, identity_key)
           VALUES ($1, $2, $3, 'linkedin', 'linkedin', $4, 'likes', $5, 'observed', NOW(), NOW(), 'all_time', 'performance.v1', '{}', $6)`,
          [userId, pubId, artId, `ext-${pubId}`, likeCount, `ps:e2e:${pubId}:${runTag}`]
        );

        // Assign to experiment
        await pool.query(
          `INSERT INTO experiment_assignments (user_id, experiment_id, variant_id, opportunity_id, artifact_id, publication_id, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, expId, assignedVariantId, oppId, artId, pubId, `as:e2e:${expId}:${artId}:${runTag}`]
        );
      }

      // 6. Navigate to UI and verify experiment card appears
      await page.goto("/insights?view=learning");
      const expCard = page.locator(`[data-testid="card-experiment-${expId}"]`);
      await expect(expCard).toBeVisible();

      // 7. Click Evaluate button in UI
      const evalBtn = page.locator(`[data-testid="button-evaluate-experiment-${expId}"]`);
      await expect(evalBtn).toBeVisible();
      await evalBtn.click();

      // 8. Open details drawer
      const toggleDetailsBtn = page.locator(`[data-testid="button-toggle-experiment-details-${expId}"]`);
      await toggleDetailsBtn.click();

      // Verify evaluation displayed with variant_promising recommendation (+100% improvement)
      const evalDrawer = page.locator(`[data-testid="drawer-experiment-eval-${expId}"]`);
      await expect(evalDrawer).toBeVisible();
      await expect(page.locator('[data-testid="badge-recommended-decision"]')).toContainText(
        "variant promising"
      );

      // 9. Record human decision: click "Accept Variant"
      const acceptVariantBtn = page.locator(`[data-testid="button-decide-promising-${expId}"]`);
      await expect(acceptVariantBtn).toBeVisible();
      await acceptVariantBtn.click();

      // Verify decision saved in UI
      await expect(page.locator(`[data-testid="badge-experiment-decision-${expId}"]`)).toContainText(
        "Variant Promising"
      );

      // 10. Promote to Policy Candidate
      const promoteBtn = page.locator(`[data-testid="button-promote-candidate-${expId}"]`);
      await expect(promoteBtn).toBeVisible();

      // Click promote and wait for the API POST to complete + refetch
      await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes("/policy-candidate") && resp.status() === 201,
        ),
        promoteBtn.click(),
      ]);

      // Wait for React Query refetch cycle to complete
      await page.waitForResponse(
        (resp) => resp.url().includes("/api/policy-candidates") && resp.request().method() === "GET" && resp.status() === 200,
      );

      // 11. Verify policy candidate appears in the Policy Candidates section
      const candidatesSection = page.locator('[data-testid="section-policy-candidates"]');
      await expect(candidatesSection).toBeVisible();
      const candidateCards = candidatesSection.locator('[data-testid^="card-policy-candidate-"]');
      await expect(candidateCards.first()).toBeVisible({ timeout: 10000 });

      // 12. Approve the candidate in UI — wait for API response
      const approveCandidateBtn = candidatesSection.locator('[data-testid^="button-approve-candidate-"]').first();
      await expect(approveCandidateBtn).toBeVisible();

      await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes("/api/policy-candidates/") && resp.url().includes("/review") && resp.status() === 200,
        ),
        approveCandidateBtn.click(),
      ]);

      // 13. STRICT SAFETY & NON-MUTATION AUDIT:
      // Verify in the database that:
      // - No active generation policies were created or modified
      // - The policy candidate exists in staging with status 'approved_for_future'
      const finalPolicyCountRes = await pool.query(
        "SELECT count(*) FROM generation_policies WHERE status = 'active'"
      );
      const finalActivePolicyCount = Number(finalPolicyCountRes.rows[0].count);
      expect(finalActivePolicyCount).toBe(initialActivePolicyCount);

      const candidateInDbRes = await pool.query(
        "SELECT id, status, proposed_configuration FROM policy_candidates WHERE experiment_id = $1",
        [expId]
      );
      expect(candidateInDbRes.rows.length).toBeGreaterThan(0);
      expect(candidateInDbRes.rows[0].status).toBe("approved_for_future");
    } finally {
      // Cleanup seeded test entities
      if (expId) {
        await pool.query("DELETE FROM policy_candidates WHERE experiment_id = $1", [expId]);
        await pool.query("DELETE FROM experiment_evaluations WHERE experiment_id = $1", [expId]);
        await pool.query("DELETE FROM experiment_assignments WHERE experiment_id = $1", [expId]);
        await pool.query("DELETE FROM experiment_variants WHERE experiment_id = $1", [expId]);
        await pool.query("DELETE FROM experiments WHERE id = $1", [expId]);
      }
      for (const pubId of createdPubIds) {
        await pool.query("DELETE FROM performance_signals WHERE publication_id = $1", [pubId]);
        await pool.query("DELETE FROM results WHERE publication_id = $1", [pubId]);
        await pool.query("DELETE FROM publications WHERE id = $1", [pubId]);
      }
      for (const schedId of createdSchedIds) {
        await pool.query("DELETE FROM schedule_occurrences WHERE schedule_id = $1", [schedId]);
        await pool.query("DELETE FROM schedules WHERE id = $1", [schedId]);
      }
      for (const artId of createdArtIds) {
        await pool.query("DELETE FROM artifacts WHERE id = $1", [artId]);
      }
      for (const oppId of oppIds) {
        await pool.query("DELETE FROM opportunities WHERE id = $1", [oppId]);
      }
      if (storyId) {
        await pool.query("DELETE FROM stories WHERE id = $1", [storyId]);
      }
      await pool.end();
    }
  });
});
