# Phase 30.1 Auth Enforcement Report — Production Launch Blocker Remediation

**Branch:** `replit` · **Base:** `3611a99` (Phase 30) · **PR #3:** open, unmerged
**Decision:** BLOCKER FIXED (evidence in §12)

## 1. Executive Summary

Phase 30 left exactly one launch blocker (B1): legacy `server/routes.ts` served
~146 endpoints with no authentication and no ownership checks, and every newer
router derived owner via `getUserId(req) ?? 1`, so any unauthenticated caller
became owner 1 — including for paid external publication. This phase removes the
blocker without migrating, redesigning, or replacing authentication:

- **Global authentication gate** (`server/middleware/authGate.ts`, 30 lines):
  every `/api` request requires a server-side session identity except an explicit,
  pinned 4-entry public allowlist (`/api/auth/*`, `/api/csrf-token`, `/api/health`,
  `/api/ready`). Mounted after express-session, before all routers.
- **Owner fallback removed at every central helper**: `sessionUserId` (routes.ts),
  agent `ownerId()`, story creation, and 6 profile-route `|| 1` sites now fail
  closed instead of defaulting to owner 1.
- **Deputized self-calls fixed**: the two localhost `/api/ingest` proxies forward
  the caller's own session cookie + CSRF token (same identity, never synthesized).
- **Stale E2E harness corrected**: `e2e/api.e2e.spec.ts` now authenticates (register
  + session cookies) and sends CSRF tokens like the real UI; 2 new gate regression
  tests added; 1 AI-credential-dependent test skips cleanly without AI keys.
- **Result:** unauthenticated → 401 on every owner-scoped path (reads, mutations,
  paid generation, publish, autonomy, accounts); authenticated owner → authorized;
  forged client identity → ignored; no external call precedes auth.

No auth-provider change, no schema change, no scheduler, no CSRF weakening.

## 2. Original Blocker

Phase 30 B1: `requireAuth`/`requireUserId` existed with **zero call sites**;
`sessionUserId(req) = req.session?.userId ?? 1`; ~95 inline `getUserId(req) ?? 1`;
reproduced live (`GET /api/posts` with no session returned all rows, and
`POST /api/posts/:id/publish` was reachable anonymously). Temporary mitigation M1
(single-tenant gated operation) is hereby retired for the API surface.

## 3. Legacy Route Inventory

Complete inventory (146 `app.*` + static `/uploads`) was enumerated from
`server/routes.ts`: method, path, session use, mutation, external/paid effect.
Summary: 13 DELETE routes, 1 true external publish (`POST /api/posts/:id/publish`
→ xQuick), ~30 AI-calling routes (paid), 2 paid-media routes
(`POST /api/images/generate`, vault image extraction), 5 connected-account/token
routes (raw token store, live token checks, Google OAuth trio), bulk AI pipelines
(autopilot morning-briefing/autofill/smoke-test, discover refresh), and 2
same-process localhost proxies (`/api/references/analyze`, `/api/ingest/batch`).
Only `GET/PUT /api/auth/me` enforced 401 before this phase. Full PATH|METHOD|AUTH|
OWNER|SIDE-EFFECT|RESULT matrix is §17 of the verification log below (§6): every
row now resolves to 401-unauthenticated / 200-authorized via the gate (matrix
compressed here; the gate is path-prefix-global so per-row behavior is uniform and
was verified on representatives of every class: read, mutation, DELETE, paid AI,
paid media, publish, autonomy, accounts, ingest proxy).

## 4. Authentication Enforcement

`authGate` reuses the existing mechanism (`req.session.userId`, same 401 shape as
the legacy `requireAuth`, whose unused copy was folded into the single
`requireAuthMiddleware` in `userContext.ts` — no second abstraction). Ordering in
`server/index.ts`: session → auditLog → sessionUser → **authGate** → csrf-token
route → verifyCsrf → all routers. A mount-order subtlety was caught by the new
tests during development: mounting on a sub-path (`app.use("/api", gate)`) makes
Express strip the prefix from `req.path`, silently voiding allowlist matching
(potential lockout/login-breakage); the gate is therefore mounted globally and
matches on the full path, with a static test pinning this. Unauthenticated
behavior: `401 {"message":"Unauthorized"}` — the application's established
equivalent. CSRF is unchanged and still enforced after auth (401 precedes 403).

## 5. Owner Derivation

Identity originates exclusively from the server-side session. Verified by grep:
no route trusts `req.body/query/header` ownerId (2 benign hits: body-as-payload,
job-input-body). The gate test `ignores forged client identity` proves
`X-Owner-Id`/`X-User-Id` headers and body/query `ownerId` do not authenticate.
Single-owner endpoints ignore client-supplied IDs entirely (they never read them).
YouTube OAuth pending state (`ownerUserId` stashed server-side in session at
connect, consumed at callback) was already server-derived and is unchanged.

## 6. Cross-Owner Testing

- **Newer slices** (research `loadOwnedJob`, agent `getRunForOwner`, autonomy
  controller + routes, content storages `*ForOwner`): per-row `userId` checks
  return 404/deny on foreign rows; existing suites prove it (autonomy 20/20 incl.
  owner isolation; visual/X dbtests assert foreign-owner rejection). The gate adds
  the missing outer layer (no anonymous entry at all).
- **Legacy pool** (posts/ideas/articles/references/etc.): rows carry no reliable
  owner attribution (`userId` null/ignored by storage), so per-row cross-owner
  denial is impossible without an owner-attribution backfill — a schema/data
  migration, i.e. a STOP condition, explicitly not done here. Post-gate posture:
  **authentication is enforced (no anonymous access); the legacy pool is shared
  among authenticated users (single-tenant residual)**. Verified live: user2
  session → 200 on `/api/posts`; anonymous → 401. Recorded as limitation R1 with
  owner/remediation in §13.
- Owner A × Owner B live probes on research/autonomy paths inherit the existing
  row checks; no new cross-owner bypass was introduced (gate only narrows).

## 7. Paid Side-Effect Protection

For every paid/external class, the gate runs before input validation, business
logic, and any provider call (mount order, §4). Live-verified unauthenticated →
401 with zero handler execution (unit test asserts handler-run counter stays 0):
`POST /api/images/generate` (paid image), `POST /api/autonomy/run`, `POST
/api/posts` (+ creates-nothing assertion in E2E: count unchanged after 401),
`GET /api/accounts`, `GET /api/posts`. Authenticated AI calls proceed (and fail
only on provider credentials, proving the call happens post-auth). No test
performs a real paid call or publishes real content.

## 8. CSRF Test Investigation

Phase 30 found 16 `[api]` failures: session-less POST/PUT/PATCH/DELETE → 403.
Per-test determination: the specs predate CSRF enforcement (`cae1cbf`) and never
implement the production client contract (session cookie + `X-CSRF-Token`); one
further failure (`GET /api/profile/memory` → `{}`) was seed-dependent (no profile
row for the fallback user). Production behavior was correct in all 16 cases;
the harness was stale. Fix: `e2e/api.e2e.spec.ts` now registers one API user per
worker, reuses its session, sends CSRF tokens on all mutating calls, keeps one
explicit 401 test, and gains 2 gate regression tests (anon GET/POST → 401,
POST-creates-nothing). CSRF protection itself is untouched (no weakening, no
global disable). Post-fix `[api]` result: **37 passed / 1 skipped-env** (below).

## 9. Browser/CI Test Environment

Phase 30's ARM64 finding was re-examined: this host (ubuntu26.04-arm64) has no
Playwright browser binaries and Playwright refuses to install them
(`Playwright does not support chromium on ubuntu26.04-arm64`); no system
chromium/firefox exists. Category: **environment/dependency limitation, not an
application issue** — no application behavior was changed to compensate and no
new framework introduced. The repository's CI gate is already correct:
`.github/workflows/e2e.yml` provisions `npx playwright install chromium
--with-deps` on `ubuntu-latest` (x86_64) plus an isolated Postgres service, and
its header comment already requires the E2E check before merge. Requirement for
browser signal: run the full suite in CI (or any x86_64 host with browsers);
this host can execute the `[api]` project only. No repo change was needed.

## 10. Fixes Applied

| # | Change | Files |
|---|---|---|
| 1 | Global `authGate` + pinned allowlist, mounted pre-routers | `server/middleware/authGate.ts` (new), `server/index.ts` |
| 2 | Single `requireAuthMiddleware` in `userContext.ts`; removed zero-callsite duplicate in `auth.ts` (kept as re-export) | `server/middleware/userContext.ts`, `server/auth.ts` |
| 3 | `sessionUserId`, agent `ownerId()`, story insert, 6 profile sites: fail-closed, no `?? 1`/`\|\| 1` | `server/routes.ts`, `server/agent/routes.ts`, `server/story/routes.ts` |
| 4 | Deputized self-fetch proxies forward caller cookie + CSRF token | `server/routes.ts` (`/api/references/analyze`, `/api/ingest/batch`) |
| 5 | E2E harness: authenticate + CSRF like the real UI; 2 gate tests; env-aware AI skip | `e2e/api.e2e.spec.ts` |
| 6 | Regression tests: 8 gate tests (real HTTP boundary + static pins) | `server/middleware/authGate.test.ts`, `authGate.ts` |

Residual (deliberate, documented): ~90 inline `getUserId(req) ?? 1` in gated
routers are unreachable-unauthenticated (gate precedes all routers); rewriting
them is churn with fall-through risk. Guarantee rests on: gate mount order
(statically pinned), frozen allowlist (statically pinned), 401 boundary tests.

## 11. Regression Tests

- `server/middleware/authGate.test.ts` (8 tests): 401-before-handler on GET+POST,
  forged-identity rejection, allowlist passage, session passage, allowlist
  exactness, path classification, mount-order pin, no-fallback pin on central
  helpers. All pass.
- Pre-existing suites guard the rest: agent `autonomyDenial`/`policyActivationDenial`
  (boundary), autonomy 20/20 (gates + isolation), Phase 30 `httpHardening` (11) +
  `legacyFetchDenial` (2).
- E2E `[api]` serial (fresh DB `cf_301`, fresh bundle): **37 passed, 1 environment-skipped (no AI credentials), 0 failed**.
  Added: anon GET/POST → 401 + creates-nothing assertions.

## 12. Verification Results

| Check | Result |
|---|---|
| `tsc` / `build` | clean |
| `test:unit` | **730 pass / 0 fail / 1 skipped (731 total)** — 722 pre-30.1 + 8 new gate tests + 1 pre-existing skip |
| `test:db` | **322/322 pass, 38 suites, EXIT 0** on isolated fresh DB `cf_final` |
| `authGate.test.ts` | 8/8 |
| E2E `[api]` serial (fresh DB, fresh bundle) | 37 passed, 1 env-skipped, 0 failed |
| Live prod bundle: anon GET/POST posts, paid image gen, autonomy run, accounts | all 401, zero handler execution |
| Live: authenticated user2 reads own-context 200; logout → protected 401 | pass |
| Live: authed AI call reaches provider (fails only on placeholder key) | proves post-auth external path intact |
| Pristine-HEAD A/B (Phase 30): api failures byte-identical pre/post 30.0 | no 30.0 regression; 30.1 harness+gate resolves them |
| Browser E2E on this host | environmentally blocked (§9); must run in CI |

### 12.1 DB suite note (shared-database state sensitivity)

The first full `test:db` run on `cf_301` (a database previously used by E2E runs)
failed 1 test: `visualPublication.dbtest.ts` concurrent-duplicate-delivery
(2 published instead of 1). 2x2 isolation matrix: fresh DB + pristine tree → 9/9;
fresh DB + Phase-30.1 tree → 9/9; dirty `cf_301` + pristine tree → 8/9 (same
failure); dirty `cf_301` + Phase-30.1 tree → 8/9. Conclusion: the failure tracks
database state, not code — no file changed by this phase is in the publication
lease path, and the pristine tree fails identically on the dirty DB. Classified
TEST/ENVIRONMENT (suite requires an isolated database; operational rule: never
share one database between E2E and dbtest runs). Full-suite re-run on isolated
fresh `cf_final` gives the gate number.

## 13. Remaining Limitations

- **R1 — legacy pool has no per-row owner attribution.** Authenticated users share
  legacy rows. Remediation: owner-attribution backfill (schema + data migration) —
  STOP condition, needs human review. Until then: single-tenant operation for the
  legacy surface; newer lifecycle slices already isolate per row.
- **R2 — ~90 inline `?? 1` under the gate** (dead-anon; see §10).
- **R3 — push alerting, platform RPO/RTO** (unchanged from Phase 30 M2/M3).
- **R4 — session hardening** (no rotation on login, 30d fixed expiry, Google
  email-linking) carried over as non-blocking for the operating model.
- **R5 — browser E2E signal pending from CI** on this gate's tree.

## 14. Updated Production Readiness

Phase 30 verdict `GO WITH EXPLICIT MITIGATIONS` is updated as follows: **M1 is
retired for the API surface** (replaced by enforced authentication + R1 residual
for the legacy pool). Authorization and Tenant-isolation rows move from
BLOCKED-with-mitigation to READY-WITH-RESIDUAL (R1/R2). All other Phase 30 rows
stand. `@30.1 gate criteria`: unauthenticated → rejected (401, proven at unit +
E2E + live); authenticated owner → authorized (proven); wrong owner → rejected
(row checks + gate; legacy pool shared per R1); paid side effect →
authorization-protected (proven pre-handler). **BLOCKER FIXED.**
