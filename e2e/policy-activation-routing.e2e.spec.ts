import { test, expect } from "@playwright/test";

/**
 * Phase 33.7 — `policy-candidates` route precedence.
 *
 * A confirmed defect: the policy-candidate CRUD router owns a catch-all
 * `GET /:id` and used to be mounted BEFORE the policy-activation router, whose
 * literal `GET /activated-ids` it therefore shadowed. Express parsed
 * "activated-ids" as a non-numeric candidate id and answered
 * `400 {"message":"Invalid candidate id"}`, so the real handler was
 * unreachable and the Learning UI hid its Activate / Roll Back controls behind
 * an ErrorState.
 *
 * These tests intentionally do NOT stub `/api/policy-candidates/activated-ids`:
 * they assert the resolver at the *real HTTP boundary*, so they fail the moment
 * precedence regresses. The existing `experiments.e2e.spec.ts` journey stubbed
 * this URL with a 200, which masked the defect — that is why the boundary test
 * lives here instead.
 *
 * The authenticated `request` fixture (project storageState) is used rather
 * than registering a fresh user, so the spec is not subject to the 10/min/IP
 * `authLimiter` that a per-worker `beforeAll` register would trip.
 */

let csrfHeaders: Record<string, string> = {};

test.beforeAll(async ({ request }) => {
  const tok = await request.get("/api/csrf-token");
  expect(tok.ok()).toBeTruthy();
  csrfHeaders = { "X-CSRF-Token": (await tok.json()).csrfToken };
});

test.describe("policy-candidates route precedence (real HTTP boundary)", () => {
  test("GET /api/policy-candidates/activated-ids reaches the activation handler, not the id catch-all", async ({
    request,
  }) => {
    const res = await request.get("/api/policy-candidates/activated-ids");
    const body = await res.text();
    expect(res.status(), body).toBe(200); // pre-fix: 400 "Invalid candidate id"

    const parsed = JSON.parse(body) as {
      activatedCandidateIds: number[];
      activatedCandidateActors: Record<number, string>;
    };
    // Shape is owned by the activation handler; the CRUD router never emits it.
    expect(Array.isArray(parsed.activatedCandidateIds)).toBeTruthy();
    expect(typeof parsed.activatedCandidateActors).toBe("object");
  });

  test("GET /api/policy-candidates/:id still serves a real candidate (id route survives)", async ({
    request,
  }) => {
    // Build a real experiment -> candidate chain through the real API (no stubs).
    const expRes = await request.post("/api/experiments", {
      headers: csrfHeaders,
      data: {
        name: `Routing precedence ${Date.now()}`,
        hypothesis: "Route precedence does not break candidate lookup",
        objective: "Prove GET /:id still resolves to the CRUD handler",
        targetScope: "channel:linkedin;format:carousel",
        experimentType: "content_variant",
        primaryMetric: "engagement_rate",
        variants: [
          { variantKey: "control", name: "Control", isControl: true, policySnapshot: { format: "carousel" } },
          { variantKey: "v2", name: "Variant 2", policySnapshot: { format: "carousel", tone: "energetic" } },
        ],
      },
    });
    expect(expRes.status(), await expRes.text()).toBe(201);
    const experiment = await expRes.json();
    const variant = experiment.variants.find((v: { variantKey: string }) => v.variantKey === "v2");

    const candRes = await request.post(`/api/experiments/${experiment.id}/policy-candidate`, {
      headers: csrfHeaders,
      data: { variantId: variant.id, title: "Routing precedence candidate" },
    });
    expect(candRes.status(), await candRes.text()).toBe(201);
    const candidate = await candRes.json();

    const got = await request.get(`/api/policy-candidates/${candidate.id}`);
    const body = await got.text();
    expect(got.status(), body).toBe(200);
    const fetched = JSON.parse(body);
    expect(fetched.id).toBe(candidate.id);
    expect(fetched.title).toBe("Routing precedence candidate");
  });

  test("an unknown numeric id is handled by the id route (404), not treated as a bad literal", async ({
    request,
  }) => {
    const res = await request.get("/api/policy-candidates/999999999");
    expect(res.status()).toBe(404);
    expect((await res.json()).message).toBe("Policy candidate not found");
  });
});

test.describe("Learning UI activation state (real /activated-ids)", () => {
  const approvedCandidate = {
    id: 9101,
    userId: 1,
    experimentId: 7001,
    evaluationId: 8001,
    title: "Candidate: Carousel default for LinkedIn",
    targetScope: "channel:linkedin;format:carousel",
    proposedConfiguration: { format: "carousel", tone: "energetic" },
    rationale: "Observed engagement lift under controlled assignment.",
    status: "approved_for_future",
    reviewedAt: new Date().toISOString(),
    reviewNotes: null,
    createdAt: new Date().toISOString(),
  };

  async function mockLearningShell(page: import("@playwright/test").Page) {
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
    // NOTE: the glob below does NOT match `/api/policy-candidates/activated-ids`,
    // so that request is left un-stubbed and must reach the real server.
    await page.route("**/api/policy-candidates", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([approvedCandidate]),
      }),
    );
    await page.route("**/api/autonomy/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: false,
          mode: "disabled",
          experimentAutomationEnabled: false,
          activationAutomationEnabled: false,
          rollbackEnabled: false,
          circuitBreakerState: "closed",
          circuitBreakerReason: null,
          maxActivationsPerDay: 1,
          maxActivationsPerWeek: 2,
          cooldownMinutes: 1440,
        }),
      }),
    );
    await page.route("**/api/autonomy/decisions", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
  }

  test("Governance queue renders Activate (no ErrorState) when the live /activated-ids returns 200", async ({
    page,
  }) => {
    await mockLearningShell(page);

    const liveActivationState = page.waitForResponse((r) =>
      r.url().includes("/api/policy-candidates/activated-ids"),
    );
    await page.goto("/insights?view=learning");

    // The live request must succeed — pre-fix this was the 400 that flipped the UI to ErrorState.
    const resp = await liveActivationState;
    expect(resp.status()).toBe(200);

    await expect(page.locator('[data-testid="section-policy-candidates"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-activate-candidate-9101"]')).toBeVisible();
    // The activation-state ErrorState specifically must be gone.
    await expect(
      page.locator('[data-testid="error-state"] [data-testid="text-error-state-title"]', {
        hasText: "Couldn't load activation state",
      }),
    ).toHaveCount(0);
  });

  test("an activated candidate shows Roll Back (activation state drives the control)", async ({ page }) => {
    await mockLearningShell(page);
    await page.route("**/api/policy-candidates/activated-ids", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          activatedCandidateIds: [approvedCandidate.id],
          activatedCandidateActors: { [approvedCandidate.id]: "human" },
        }),
      }),
    );

    await page.goto("/insights?view=learning");

    await expect(page.locator('[data-testid="button-rollback-candidate-9101"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-activate-candidate-9101"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="badge-activated-by-9101"]')).toHaveText("Activated by You");
  });
});
