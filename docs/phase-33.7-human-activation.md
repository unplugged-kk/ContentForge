# Phase 33.7 — Human-Gated Policy Activation: route precedence

**Date:** 2026-09-26
**Base:** `main` @ `63d6158`
**Branch:** `phase-33.7-human-activation`
**Scope:** `policy-candidates` route precedence only. Files changed:
`server/index.ts` (router mount order only), `e2e/policy-activation-routing.e2e.spec.ts` (new).
**Defect:** HIGH — `GET /api/policy-candidates/activated-ids` returned `400 Invalid candidate id`,
hiding the **Activate** / **Roll Back** controls in Insights → Learning.

Autonomy time/budget logic, activation business logic, and policy architecture were **not** touched.

---

## 1. Root cause

`server/index.ts` mounted the experimentation *policy-candidate CRUD* router before the
*policy-activation* router. Both share the mount path `/api/policy-candidates`:

```
server/index.ts:250   app.use("/api/policy-candidates", await createDefaultPolicyCandidateRouter());  // has catch-all GET /:id
server/index.ts:254   app.use("/api/policy-candidates", await createDefaultPolicyActivationRouter()); // owns literal GET /activated-ids
```

The CRUD router registers a catch-all `GET /:id`
(`server/content/experimentation/routes.ts:455`) that parses the segment as an integer:

```ts
router.get("/:id", async (req, res, next) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ message: "Invalid candidate id" });
  ...
```

Express matches routers **in registration order**, so the catch-all was reached first for
`/activated-ids`. `parseId("activated-ids")` is `NaN` → `null` → **400**. The real handler
(`server/content/policyActivation/routes.ts:58`) was unreachable.

Downstream: `client/src/components/insights/learning-view.tsx:648` queries the URL; the 400 sets
`activatedIdsError` (line 642), and line ~1817 renders an ErrorState
("Couldn't load activation state") that suppresses both the **Activate** and **Roll Back** buttons.

---

## 2. Reproduction (real HTTP boundary)

Against the production bundle *before* the fix (`npm run build && node dist/index.cjs`,
`E2E_PORT=4602`, authenticated session + `x-csrf-token`):

```
GET /api/policy-candidates/activated-ids   →   400 {"message":"Invalid candidate id"}
```

Server access log:

```
GET /api/policy-candidates/activated-ids 400 in 5ms :: {"message":"Invalid candidate id"}
```

A real candidate id already resolved correctly **before** the fix
(`GET /api/policy-candidates/999999` → `404 "Policy candidate not found"`), because the activation
router has no `GET /:id`; only the *literal* route was shadowed.

---

## 3. Fix

Register the policy-activation router **before** the policy-candidate CRUD router, so the static
route wins and real ids still fall through (`server/index.ts`):

```ts
const { createDefaultPolicyActivationRouter, createDefaultPolicyHistoryRouter } =
  await import("./content/policyActivation/http");
app.use("/api/experiments", await createDefaultExperimentRouter());
// static GET /activated-ids must be registered before the CRUD router's catch-all GET /:id
app.use("/api/policy-candidates", await createDefaultPolicyActivationRouter());
app.use("/api/policy-candidates", await createDefaultPolicyCandidateRouter());
app.use("/api/policies", await createDefaultPolicyHistoryRouter());
```

No route handler, schema, or business logic changed — mount order only. The activation router's
`POST /:id/activate|rollback` and the CRUD router's `POST /:id/review` remain disjoint paths, so no
other request is re-routed.

---

## 4. Routing evidence

Same spec (`e2e/policy-activation-routing.e2e.spec.ts`) run against both bundles; it asserts the
**real HTTP response** and never stubs `/activated-ids`.

| Route | Before (pre-fix bundle) | After (this branch) |
|---|---|---|
| `GET /api/policy-candidates/activated-ids` | **400** `Invalid candidate id` | **200** `{activatedCandidateIds:[], activatedCandidateActors:{}}` |
| `GET /api/policy-candidates/:realId` (created via real API) | 200 (candidate) | **200** (candidate, `id`/`title` match) |
| `GET /api/policy-candidates/999999999` | 404 `Policy candidate not found` | **404** `Policy candidate not found` |

Spec result: **pre-fix 2 failed / 4 passed → post-fix 6 passed** (project `chromium`,
`E2E_PORT=4602`). Post-fix server log:

```
GET /api/policy-candidates/activated-ids 200 :: {"activatedCandidateIds":[],"activatedCandidateActors":{}}
POST /api/experiments 201 :: {...}
POST /api/experiments/1908/policy-candidate 201 :: {"id":1787,...}
GET /api/policy-candidates/1787 200 :: {"id":1787,"title":"Routing precedence candidate",...}
```

---

## 5. UI result

With the live `/activated-ids` returning 200, `activatedIdsError` is `false`, the ErrorState is not
rendered, and the Governance queue shows the correct control:

- **Not activated** → `button-activate-candidate-<id>` visible, no `error-state` with
  "Couldn't load activation state".
- **Activated** (state-driven) → `button-rollback-candidate-<id>` + `badge-activated-by-<id>`
  ("Activated by You") visible, Activate gone.

Both are asserted in the new spec against `/insights?view=learning`.

---

## 6. Defect masked by a stubbed test

`e2e/experiments.e2e.spec.ts:392` stubs the URL with a synthetic 200, so the fully-mocked journey
never exercised real route precedence and the defect slipped through. That file is owned by another
worker and was **not** modified. The exact patch (adds `request` to the destructure and a live
pre-check before the stub) will make the journey fail on regression:

```diff
@@ -368,7 +368,7 @@ test.describe("ContentForge Phase 29.3 — Human-Gated Policy Activation (Mocked
-  test("activation requires explicit confirmation and rollback requires a separate explicit confirmation", async ({ page }) => {
+  test("activation requires explicit confirmation and rollback requires a separate explicit confirmation", async ({ page, request }) => {
@@ -388,6 +388,12 @@
     });
 
+    // Phase 33.7: assert the live route is reachable BEFORE mocking it. The stub
+    // below previously hid a route-precedence defect (GET /:id shadowed
+    // /activated-ids -> 400) because it never let a real request through.
+    const liveActivatedIds = await request.get("/api/policy-candidates/activated-ids");
+    expect(liveActivatedIds.status()).toBe(200);
+
     let activatedIds: number[] = [];
     await page.route("**/api/policy-candidates/activated-ids", (route) =>
       route.fulfill({
```

---

## 7. Verification

| Command | Result |
|---|---|
| `npm run check` (`tsc`) | clean |
| `npm run build` | clean |
| `./node_modules/.bin/playwright test e2e/policy-activation-routing.e2e.spec.ts --project=chromium` (pre-fix bundle) | 2 failed, 4 passed |
| same spec (this branch) | **6 passed** |
| `... e2e/experiments.e2e.spec.ts -g "Human-Gated Policy Activation"` | 2 passed |

Environment: `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`, `E2E_PORT=4602`,
`SESSION_COOKIE_SECURE=0`, `CONTENTFORGE_E2E_SERVER=1`, `DISABLE_CRON=1`, production bundle.

> Note: the spec uses the project's authenticated `request` fixture (storageState) rather than
> registering a user in `beforeAll`, because `authLimiter` is 10 req/min/IP and per-worker
> registration tripped it (429), which is unrelated to route precedence.
