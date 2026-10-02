# ContentForge — Phase 33.7 Audit Completeness

**Scope:** AUDIT COMPLETENESS ONLY. READ-ONLY (no production code/test/config modified; this file is the only write).
**Worktree:** `/Users/kishore/git/cf-design/337audit`, branch `phase-33.7-audit-completeness`, from `main` @ `63d6158`.
**Env:** `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e` (reachable), `E2E_PORT=4607`. No secret printed.

Evidence is labelled **BY EXECUTION** (command/suite actually run here), **BY MEASUREMENT** (build output),
or **BY READING** (source `file:line`). This pass did not run the full `test:unit` / `test:db` / E2E suites.

Dimensions in scope: Recovery · Performance · Functionality gaps. The other three (Functionality,
Scheduler/Autonomy, Findings reconciliation) were produced by Phase 33.6 workers — the claim is verified in §0.

---

## 0. Verification of the "two dimensions already completed" claim — HOLDS

The three documents exist on this tree and are substantive (each is a full report, not a stub):

| Document | Dimension | Stated base | Verdict |
|---|---|---|---|
| `docs/phase-33.6-functionality-audit.md` | Functionality | `main` @ `d4a3760` | **Present / HOLDS** |
| `docs/phase-33.6-scheduler-autonomy-audit.md` | Scheduler + Autonomy (covers retry/DLQ/restart/lease/crash) | `main` @ `d4a3760` | **Present / HOLDS** |
| `docs/phase-33.6-findings-reconciliation.md` | Findings reconciliation (cross-cutting) | `main` @ `d4a3760` | **Present / HOLDS** |

The two *dimensions* the brief names as done are **functionality** and **scheduler/autonomy** (the reconciliation
doc is the cross-cutting third). This worktree is based on a **newer** `main` (`63d6158`), so the docs were authored
on an older tip; I therefore **spot-checked that their central claims still reproduce here** rather than trusting the
docs verbatim:

- Functionality D1 (`/api/policy-candidates/activated-ids` shadowed) — **still reproduces** (§3a).
- Functionality D2 (`server/db.ts` pool has no `'error'` handler) — **still true** — `grep -rn 'pool.on|\.on("error"' server`
  → the only pool-level handler is `server/jobs/runtime.ts:109` (pg-boss); `server/db.ts` has none (§1).
- Scheduler F1 (DB timezone fragility) — `server/db.ts` still pins no session timezone (latent; production Postgres is
  expected UTC).

**Conclusion: the claim holds.** The remaining three dimensions were completed in this pass.

---

## 1. Recovery

**Scope.** Worker crash, DB connection loss, job retry, DLQ, restart, lease recovery, unknown state; and specifically
whether any path can cause **duplicate activation**.

**Tests performed (BY EXECUTION, this worktree, `contentforge_e2e`):**

| Suite | Command | Result |
|---|---|---|
| Job runtime (retry / DLQ / restart) | `node --import tsx --test --test-concurrency=1 server/jobs/runtime.dbtest.ts` | **8/8 pass** |
| Durable scheduler (dup / lease / restart / reread / kill switch) | `… server/content/autonomy/scheduler.dbtest.ts` | **23/23 pass** |

`runtime.dbtest` green cases: *runs an enqueued job to completion*; *rejects a payload that fails schema validation*;
*deduplicates a second enqueue with the same idempotency key*; *retries a transient failure and succeeds on a later
attempt*; *dead-letters a permanent failure without consuming retries*; *dead-letters an unparseable envelope*;
*logs job identity with a correlation id*; *shuts down gracefully*.
`scheduler.dbtest` green cases include *duplicate enqueue within the window collapses to one job*; *10 simultaneous
same-owner same-scope triggers yield at most one activation*; *restart recovers a pending job without loss*;
*state changed after enqueue controls execution (reread proof)*; *kill switch denies without activation*;
*reconcile discovers due pairs and enqueues without duplicates*.

**Evidence (BY READING) — the guards behind the green tests:**

- **Retry / DLQ (correct by construction).** `server/jobs/runtime.ts` — transient failures are rethrown so pg-boss
  retries with backoff then auto-dead-letters; `permanent`/`policy_human` are copied to the dead-letter queue and
  completed without consuming retries; `rate_limited` re-queues after a delay; an unparseable envelope is
  dead-lettered (`reason:"invalid_envelope"`). Dead-letter queue is created with `retryLimit:0` (`ensureQueue`).
- **Restart / graceful shutdown.** `server/jobs/bootstrap.ts` owns one `JobRuntime`; `stop()` calls
  `boss.stop({ graceful:true, timeout:30_000 })`. Queue state is durable in the `pgboss` schema.
- **Lease recovery.** pg-boss `expireInSeconds` per queue (`resolveQueueConfig`) reaps an abandoned in-flight lease and
  redelivers (independently reproduced by the 33.6 scheduler audit's in-flight lease repro; the durable-scheduler suite
  re-passes here).
- **Unknown state.** The autonomy controller denies with `UNKNOWN_STATE` when the candidate does not exist or ownership
  cannot be verified (`server/content/autonomy/controller.ts:307,319,354,367,529,541,569`) — no cross-owner leak.
- **Duplicate activation — no path found.** Four independent guards stack:
  1. pg-boss `singletonKey = envelope.idempotencyKey` (dedupe within the window) — `runtime.ts sendEnvelope`;
  2. per-owner `select id from autonomy_configs where user_id = … for update` serialises the controller
     (`controller.ts:163`);
  3. unique index `policy_activations_identity_uq` on `identity_key` (migration `0029_policy_activation.sql:20`;
     `shared/schema.ts:2272`) and partial unique index `generation_policies_one_active_per_key_uq`
     (`shared/schema.ts:1016`);
  4. `insert(...).onConflictDoNothing({ target: policyActivations.identityKey })` plus a
     `CONCURRENT_ACTIVATION` catch on `isUniqueViolation(...generation_policies_one_active_per_key_uq)`
     (`server/content/policyActivation/activation.ts:271,286`).
  Confirmed BY EXECUTION: the 10-way concurrent-claim and duplicate-enqueue cases in `scheduler.dbtest` pass
  (≤1 activation).

**Result:** Recovery is **PASS** on retry, DLQ, restart, lease recovery, unknown state, and **duplicate activation**
(no path found). **One real availability defect remains:**

> **REC-1 (availability, pre-existing — same as 33.6 functionality D2).** `server/db.ts:9` constructs
> `new Pool({ connectionString })` with **no** `pool.on("error", …)` handler. A server-side FATAL (e.g. `57P01`
> "terminating connection due to administrator command") on an **idle** client becomes an unhandled `'error'` event
> on the `pg.Pool` and kills the whole process (observed by the 33.6 functionality worker: `throw er; // Unhandled
> 'error' event`). The main HTTP pool therefore does **not** survive a dropped DB connection; the pg-boss pool does
> (it has its own `boss.on("error")`). No `process.on("unhandledRejection")` / `uncaughtException` handler exists in
> `server` either. **Other workers are fixing this in parallel — state may change.**

**Remaining questions:** whether the in-flight lease is reaped within the production `expire_in` window (15 m) under a
real worker kill — mechanism proven, production-timing not re-measured here; and whether the REC-1 fix lands before
this branch is merged.

---

## 2. Performance

**Scope.** Measure (never estimate): initial JS entry, route chunks, chunks over Vite's 500 KB warning, and
obvious duplicate/waterfalled requests on first load of `/today` and `/insights`; compare against the baseline
**entry 1,792,007 B → 362 KB, 8 route chunks**.

**Tests performed (BY MEASUREMENT) — `npm run build` on `63d6158`** (Vite client + esbuild server; exit 0):

| Artifact | Bytes | Note |
|---|---|---|
| **Entry** `dist/public/assets/index-DG39Bcm9.js` | **362,582 B** (362.58 kB, gzip 118.66 kB) | initial JS entry |
| `create-D-P8KnC4.js` | **647,556 B** (gzip 196.94 kB) | route chunk — **> 500 KB** |
| `insights-DlrxL8YL.js` | 497,168 B (gzip 128.34 kB) | route chunk — **under** 500 KB |
| `sources-DGg7P_8r.js` | 72,131 B | route chunk |
| `agent-Cbtr_Zpt.js` | 61,596 B | route chunk |
| `schedule-K38DGZ1k.js` | 32,197 B | route chunk |
| `settings-DkHWN34y.js` | 22,558 B | route chunk |
| `today-BWJ6JsaD.js` | 14,091 B | route chunk |
| `youtube-lGRXp7f2.js` | 11,211 B | route chunk |

**Route chunks: 8** (the 8 `lazy()` imports in `client/src/App.tsx:30-37`). Chunks exceeding
Vite's 500 KB warning: **exactly 1** — `create` (647,556 B). **`insights` (497,168 B) does NOT exceed 500 KB**, so the
prior report's wording "`/insights` (497 KB) exceeds Vite's 500 KB warning"
(`docs/final-contentforge-v1-audit.md:138`) is **not reproduced by measurement** — only `/create` triggers the warning.
(This is a correction to the baseline's *description*, not to its numbers.)

**Baseline comparison.** Pre-split entry was `index-dIeE5K35.js` = **1,792,007 B**; the post-split baseline entry
measured **362,201 B** (`docs/phase-33.3-report.md:27`) / **362,254 B** (`docs/design-integration-gap-report.md:50`).
Current entry **362,582 B** is **+328…+381 B (~+0.1 %)** over the post-split baseline — i.e. **essentially unchanged**
(reduction vs pre-split **−1,429,425 B = −79.8 %**). Route-chunk count is **8**, unchanged.

> **The baseline still holds: entry ≈ 362 KB, 8 route chunks.**

**First-load requests (`/today`, `/insights`) — BY READING** (fan-out enumerated from the page components; no live
browser/HAR capture was taken in this pass):

- **`/today`** issues **6 queries on mount, all immediately, none `enabled`-gated** (no intra-page waterfall):
  `/api/artifacts?limit=30`, `/api/agent/runs?limit=10`, `/api/publications?limit=30`,
  `/api/publications?state=failed&limit=50`, `/api/schedule-occurrences?from=…&to=…&limit=50`,
  `/api/posts/queue/today` (`client/src/pages/today.tsx:68-85`). Keys are distinct — **no duplicate**. The two
  `publications` queries overlap in data (one is the failed subset) but are separate requests, not a duplicate key.
- **`/insights`** renders Radix `Tabs`; inactive `TabsContent` is **unmounted** (no `forceMount`), so only the active
  tab fetches. Default `performance` → `AnalyticsPage` issues **3 queries**
  (`/api/analytics/summary`, `/api/analytics/insights`, `/api/learning/summary` — `analytics.tsx:124,128,132`); the
  Learning / AI-usage tabs fetch only when opened. The former defect "wrong tab mounted first → 3 wasted GETs" is
  **fixed** (`client/src/pages/insights.tsx:17-23` comment documents the initial-tab-from-URL change).
  `/api/learning/summary` is a *shared query key* between Analytics and LearningView, so react-query **de-dupes** it
  if both mount.
- **Cross-page first-load waterfall (both routes).** `AppShell` blocks the entire route tree on `/api/auth/me`
  (`client/src/App.tsx:206-218`: `isLoading` → spinner, then route). So a cold load is **request #1 `/api/auth/me`,
  then a second level of the route's own queries** — a one-level waterfall. This is the previously logged, **DEFERRED**
  item `P2-6` ("auth-gate waterfall"), still present.

**Result:** Performance **PASS / baseline holds** for the entry size and the 8-chunk split; the 500 KB-chunk claim
corrects to **1** chunk (`create`). One known deferred first-load waterfall (`/api/auth/me` gate) remains; no
*duplicate* request found on either route.

**Remaining questions:** a live HAR capture over `E2E_PORT=4607` was not taken (request fan-out is source-derived);
the polling cadence of background pollers (M7, ~1.2–1.5 s) was not re-measured.

---

## 3. Functionality gaps — re-check the two reported defects

**Scope.** Re-check whether the two concrete defects the 33.6 functionality audit reported still reproduce here.

### 3a. `GET /api/policy-candidates/activated-ids` → 400 (router mount order) — **STILL REPRODUCES**

**BY READING (decisive):** `server/index.ts:250` mounts the experimentation `createDefaultPolicyCandidateRouter()`
on `/api/policy-candidates` **before** `server/index.ts:254` mounts `createDefaultPolicyActivationRouter()`. The
experimentation router declares a catch-all `router.get("/:id")` (`server/content/experimentation/routes.ts:455-466`)
whose handler runs `parseId("activated-ids")` → `Number("activated-ids")` is `NaN` → `null`
(`routes.ts:95-98`) → `return res.status(400).json({ message: "Invalid candidate id" })` (`routes.ts:457`). The
intended handler (`server/content/policyActivation/routes.ts:58-67`, returning `{activatedCandidateIds,
activatedCandidateActors}`) is mounted **second** and is never reached for this path. Express resolves the first
matching route, so `GET /api/policy-candidates/activated-ids` returns **400 `Invalid candidate id`**.
Client impact unchanged: `client/src/components/insights/learning-view.tsx:644-654` (`queryKey
["/api/policy-candidates/activated-ids"]`) errors, hiding the human activation/rollback controls.
**Other workers are fixing this in parallel — state may change.**

### 3b. `server/db.ts` lacks a pool `'error'` handler — **STILL REPRODUCES**

**BY READING:** `server/db.ts` is 11 lines; `export const pool = new Pool({ connectionString: process.env.DATABASE_URL })`
at line 9 with **no** `pool.on("error", …)`. A repo-wide grep (`pool.on|\.on("error"`) finds no pool-level error
handler for the main pool — the only one is `server/jobs/runtime.ts:109` on the pg-boss instance. See **REC-1** (§1).
**Other workers are fixing this in parallel — state may change.**

**Result:** both defects **still reproduce** on `63d6158` at the time of this audit.

---

## 4. Summary and what remains unverified

| Dimension | Result | Key evidence |
|---|---|---|
| 0 · Prior dims (33.6) | **HOLDS** — docs present, central claims re-verified | §0 |
| 1 · Recovery | **PASS** except **REC-1** (pool `'error'` handler missing; availability) | `runtime.dbtest` 8/8, `scheduler.dbtest` 23/23; duplicate-activation: no path found |
| 2 · Performance | **Baseline holds** — entry 362,582 B, 8 route chunks, 1 chunk >500 KB | `npm run build` output |
| 3 · Functionality gaps | **Both defects still reproduce** (D1 shadowed route, D2 no pool error handler) | §3a, §3b |

**Not verified / limits:** full `test:unit`, `test:db` and E2E suites were not re-run in this pass; the first-load
request fan-out is **source-derived**, not a live HAR capture over `E2E_PORT=4607`; the two functionality defects
(and REC-1) are being fixed by parallel workers, so their state may change before merge; the production-timing of
lease reaping (15 m `expire_in`) was not re-measured.

### Commands executed (evidence)

```
npm run build                                              # client+server; entry 362,582 B, 8 route chunks
ls -l dist/public/assets/{index-DG39Bcm9,create-*,insights-*,...}.js
node --import tsx --test --test-concurrency=1 server/jobs/runtime.dbtest.ts            # 8/8 pass
node --import tsx --test --test-concurrency=1 server/content/autonomy/scheduler.dbtest.ts # 23/23 pass
grep -rn 'pool.on|\.on("error"' server                    # no main-pool handler (only runtime.ts:109)
sed -n '247,255p' server/index.ts                         # candidate router mounted before activation router
grep -n 'parseId' server/content/experimentation/routes.ts # /:id catch-all returns 400
```
