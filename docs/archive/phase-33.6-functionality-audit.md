# ContentForge — Phase 33.6 Functionality Audit

**Date:** 2026-09-26
**Scope:** FUNCTIONALITY only (read-only). One dimension the previous audit left unverified.
**Worktree:** `/Users/kishore/git/cf-design/336func`, branch `phase-33.6-functionality-audit`, base `main` @ `d4a3760`.
**Method:** production bundle built (`npm run build`) and run (`NODE_ENV=production`, `PORT=4505`,
`SESSION_COOKIE_SECURE=0`, `DISABLE_CRON=1`) against `postgresql://e2e@127.0.0.1:5433/contentforge_e2e`.
Every capability was driven through real HTTP with a real session cookie + CSRF token, not by reading code alone.
No production code, test, or config was modified.

---

## 1. Capability verdicts

| Capability | Verdict | Evidence |
|---|---|---|
| Authentication | **VERIFIED BY EXECUTION** | `GET /api/auth/me` 200; unauth `GET /api/artifacts` 401; case-fold bypass (`/API/artifacts`) 401 |
| Registration | **VERIFIED BY EXECUTION** | `POST /api/auth/register` 201; duplicate email 409; password <6 400 |
| Logout | **VERIFIED BY EXECUTION** | 200 `{success:true}`, `connect.sid` cleared to empty+expired, replayed cookie → `/api/auth/me` 401 |
| Research | **VERIFIED BY EXECUTION** | `POST /api/research/jobs` 201 (durable, enqueued); worker executed and classified failure (`no_sourced_evidence`); `/providers`, `/capabilities` 200 |
| Stories | **VERIFIED BY EXECUTION** | `POST /api/stories` 201 (human provenance, no research job); `GET /api/stories`, `/:id` 200 |
| Opportunities | **VERIFIED BY EXECUTION** | `POST /api/opportunities` 201 from own story; `GET /opportunities?storyId`, `/:id` 200 |
| Generation | **VERIFIED BY EXECUTION** | `POST /api/generation-jobs` 201, enqueued, frozen `policySnapshot` persisted; worker ran → classified `permanent` failure (AI gateway not configured in env) |
| Artifacts | **VERIFIED BY EXECUTION** | `POST /opportunities/:id/artifacts` 201 (payload + mandatory attribution); `GET /artifacts`, `/:id`, `/:id/history` 200 |
| Revisions | **VERIFIED BY EXECUTION** | `POST /artifacts/:id/revise` 201 → new draft row with `supersedesId`; history chain length 2 |
| Approval | **VERIFIED BY EXECUTION** | `draft→in_review` (submit-review 200) → `approve` 200, readiness `approved`, `approvedAt` set |
| Rejection | **VERIFIED BY EXECUTION** | `draft→in_review` → `reject` 200, readiness `rejected` |
| Scheduling | **VERIFIED BY EXECUTION** | `POST /api/schedules` 201 for approved revision; 409 for a `draft` revision |
| Publication | **VERIFIED BY EXECUTION** | `POST /artifacts/:id/publications` 207; `/publications/dispatch` 200; worker `queued→failed`; see §2 |
| Results | **VERIFIED BY EXECUTION** | `GET /publications/:id/result` 404 before dispatch; 200 `outcome:failed` after; unknown-outcome row readable |
| Insights | **VERIFIED BY EXECUTION** | `GET /api/analytics/summary`, `/api/analytics/insights`, `/api/usage` 200 |
| Learning | **VERIFIED BY EXECUTION** | `GET /api/learning/{summary,signals,proposals,observations}` 200 |
| Experiments | **VERIFIED BY EXECUTION** | `POST /api/experiments` 201; start/pause/complete 200; evaluate 201; decide 200; `/variants`, `/assignments` 200 |
| Policy candidates | **VERIFIED BY EXECUTION** | `POST /experiments/:id/policy-candidate` 201; `GET /api/policy-candidates`, `/:id` 200; `/review` 200 |
| Human activation | **BROKEN** (UI path) | `POST /api/policy-candidates/:id/activate` reachable and gate-enforced, but the supporting `GET /api/policy-candidates/activated-ids` returns **400**; see §3 |
| Autonomous activation | **VERIFIED BY EXECUTION** | `GET /api/autonomy` 200; `POST /api/autonomy/enable {mode:"observe_only"}` 200; `/decisions` 200 |
| Settings | **VERIFIED BY EXECUTION** | `GET/PUT /api/discover/settings` 200; `GET/PUT /api/profile/memory` 200; `PUT /api/profile/branding` 200 |
| Connected accounts | **VERIFIED BY EXECUTION** | `GET /api/accounts` 200; `/api/social/{x,threads,youtube}/status` 200; connect validation 400 (bad platform / missing token); `POST /accounts/:id/test` 404 for unknown id; `/articles-publish-capability` 200 |

Notes on environment (not product defects): generation/research execution failures are
provider/gateway-absent in this sandbox and were correctly **classified** by the system rather than
reported as success. Connected-account *connect* was not driven to a real provider 200 because no
provider credential exists in the environment; its validation branches were exercised.

---

## 2. The false-publication-success attack — NOT OBSERVED (defect stays fixed)

The QA-03 claim ("a publication must never report success when nothing published"; the original
defect was "both Publish Now surfaces treated every HTTP 207 response as success",
`docs/phase-33.1-critical-trust-fix-report.md` §QA-03) was attacked directly:

1. **207 envelope semantics (live).** `POST /api/artifacts/:id/publications` returns HTTP **207**
   with `outcomes[].status ∈ {created, reused, invalid}` — it never returns `published`. Observed:
   - single target → `{"channel":"x","status":"created","publicationId":10118}`;
   - partial multi-target → `x:created`, `instagram:invalid` (format×channel), `nope:invalid`
     (no adapter), each with its own `error`. The string `"published"` is absent from the envelope.
2. **Client mapping.** `client/src/lib/publication-feedback.ts` reads `outcomes[].status`, treats
   only `published` as success, and maps `created/reused → "Publication scheduled"`,
   `failed → destructive`, `unknown → needs verification`, mixed and empty distinctly. Focused suite
   **7/7 pass**, including a test that drives a real local HTTP server returning status 207.
3. **Real dispatch with an unconfigured provider.** Starting from an *approved* revision, a real
   `POST /api/publications/dispatch` took the publication `queued → failed`; the durable Result is
   `outcome:"failed"`, `errorClass:"policy_human"`, `providerCalled:false`, `externalId:null`. No
   `published` state, no `unknown` row created without a provider call.
4. **Reconciliation (live over HTTP).** Unknown-outcome publications were injected as DB fixtures and
   driven through the real `POST /api/publications/dispatch` (which runs
   `reconcileUnknownPublications`): a fresh `unknown` stayed `failed`/`unknown` (`stillUnknown:1`,
   attempt incremented) and an `attempt=5` row was left untouched (`exhausted:1`); the HTTP
   `GET /publications/:id/result` returned `outcome:"unknown"` throughout. Reconciliation never
   auto-resolved to `published` without provider evidence.
5. **Focused server suites.** `reconcile` / `distribution` / `adapters` /
   `publicationConfigFailure` → **27/27 pass** (tri-state reconcile, partial fan-out, config-failure
   classification, ambiguous-outcome continuity).

**Result: no path was found that reports publication success when nothing published.** The
207-is-success defect remains fixed.

---

## 3. Concrete production defect found — BROKEN

### D1 — `GET /api/policy-candidates/activated-ids` is shadowed and always 400s; the human-activation / rollback UI is hidden

**Reproduction** (authenticated session with valid CSRF):
```
GET http://127.0.0.1:4505/api/policy-candidates/activated-ids
-> 400 {"message":"Invalid candidate id"}          # observed live, twice
```
The response body is identical to a deliberately non-numeric `GET /api/policy-candidates/notanumber`,
proving which handler answered.

**Root cause.** `server/index.ts:247-255` mounts two routers on the same path, in this order:
`createDefaultPolicyCandidateRouter()` (experimentation) **before**
`createDefaultPolicyActivationRouter()`. The experimentation router declares a catch-all
`router.get("/:id")` (`server/content/experimentation/routes.ts:455-466`) whose handler runs
`parseId("activated-ids")` → `null` → `400 {"message":"Invalid candidate id"}`. The intended handler
(`server/content/policyActivation/routes.ts:58-67`, returning
`{activatedCandidateIds, activatedCandidateActors}`) is never reached.

**Impact.** `client/src/components/insights/learning-view.tsx:640-654` queries this exact key; the
default query fn throws on non-2xx, so `activatedIdsError` is set and line **1817-1824** renders an
`ErrorState` ("activation controls are hidden") **in place of** the "Activate for Future
Generations" button and the activated `ActorBadge` + "Roll Back" button (lines 1825-1857). Net
effect: server-side `POST …/:id/activate` works, but the Insights → Learning activation/rollback
surface cannot be used, and the human-vs-autonomous actor badges never render for any candidate.

**Why tests missed it.** `e2e/experiments.e2e.spec.ts:392-401` stubs `**/api/policy-candidates/activated-ids`
with a 200 `page.route(...)` response, so the browser journey never hits the real (shadowed) route.

**Root cause files:** `server/index.ts:247-255`; `server/content/experimentation/routes.ts:455-466`;
`server/content/policyActivation/routes.ts:58-67`; `client/src/components/insights/learning-view.tsx:640-654,1817-1857`.

Human activation itself was exercised to the gates live and returned the correct, distinct,
structured refusals (`NOT_APPROVED`, `DECISION_DOES_NOT_PERMIT`, `EXPERIMENT_NOT_COMPLETE`,
`INSUFFICIENT_EVIDENCE`); a 201 success requires the accumulated-evidence ladder and was not reached
in this environment.

### D2 (secondary, availability) — server process terminates on a dropped DB connection

During functional execution the running server **exited**, and the next request got
`ECONNREFUSED`. Log:
```
error: terminating connection due to administrator command
    ... at Parser6.handlePacket ...
Emitted 'error' event on BoundPool instance at:
    at Client2.idleListener ...
throw er; // Unhandled 'error' event
```
`server/db.ts:9` constructs the `pg.Pool` with **no `pool.on("error", …)` handler**, so a FATAL
57P01 on an idle client becomes an unhandled `'error'` event that kills the whole process (all API
capabilities go down together). The trigger reconnect is environment-dependent; the missing handler
is the code defect. Flagged here because it occurred while exercising functionality; it may belong
to the recovery dimension, which is out of this brief's scope.

---

## 4. Summary

- 20 of 22 capabilities **VERIFIED BY EXECUTION**; 1 (human activation) **BROKEN** on its UI path;
  1 (connected-account *connect*) verified on read/validation branches (no live provider credential).
- The false-publication-success attack found **no false success**: 207 envelope, partial outcomes,
  unknown parking, and reconciliation all remain honest.
- One concrete functional defect: **D1** (shadowed `activated-ids`), with reproduction;
  one secondary availability defect: **D2** (pool has no error handler).
