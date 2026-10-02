# ContentForge — Final Independent Production Audit

**Date:** 2026-09-26
**Audited commit:** `d60e55e` (pushed `origin/main`)
**Method:** four bounded auditors, each in a **fresh worktree detached at `origin/main`**, each told
to treat every prior report as unverified
**Decision:** **FINAL GO WITH NON-BLOCKING DEBT**

---

## 1. Executive Summary

This is the first audit in the programme that came back clean on the product.

**No product-code blocker was found.** Auditor D stated it explicitly: *"BLOCKER: none in product
code."* Auditor A falsified nothing. Auditor B verified all six Phase 33.7 fixes 6/6 with no
FALSIFIED and no PARTIAL results. Auditor C found the canonical loop, the scheduler, recovery and
the no-false-publication claim all holding by execution.

The security boundary now holds under the exact attack that broke it: **275 of 275** case-variant
requests across `GET/POST/PUT/PATCH/DELETE` on `/api`, `/API`, `/Api`, `/aPi` and mixed-case paths
return **401** anonymously, with owner-1 row counts unchanged. No owner fallback remains anywhere
in production code.

What remains is **test-infrastructure debt and LOW-severity findings**, not production blockers.

**One correction I owe you:** the plan I wrote hypothesised that `test:db` collapsed because one
file threw at import time and aborted the run. **That is wrong,** and Auditor D refuted it with
evidence. See §3.

---

## 2. Per-auditor results

### Auditor A — Security & isolation: **PASS**

| Check | Verdict |
|---|---|
| Case-variant auth (`/api` `/API` `/Api` `/aPi`, mixed-case paths, all methods) | **VERIFIED** — 275/275 → 401; authed positive control → 200 |
| No fail-open owner fallback | **VERIFIED** — every `?? 1` / `\|\| 1` is a non-owner default (version, count, attempt); no live fallback |
| Paid endpoints anonymous | **VERIFIED** — 15 provider POSTs → 401, provider row counts unchanged |
| Owner isolation (A × B) | **VERIFIED** — cross reads 404, cross mutations blocked, rows unchanged in SQL |
| `discovery_settings` tenancy | **VERIFIED** — `user_id NOT NULL` + unique index; A's keywords invisible to B and not overwritable |
| Allowlist | **VERIFIED** — health/ready/csrf-token 200; 25 other roots → 401 |
| Credential exposure | **VERIFIED** — canary absent from network/DOM/localStorage/sessionStorage/URL/console; Settings shows exactly `••••••cafe` |

**FALSIFIED: none.** Non-blocking: F1 LOW cross-owner existence oracle (403 vs 404, no data change);
F2 LOW a deleted-user session still authenticates (dangling id, not owner 1); F3/F4 INFO.

### Auditor B — The six Phase 33.7 fixes: **6/6 VERIFIED**

| Fix | Verdict | Evidence |
|---|---|---|
| discovery tenancy | VERIFIED | On fresh DBs the auditor created: 1 user → migration succeeds, singleton preserved and attributed; **2 users → aborts**, transaction rolled back, row and both users intact |
| human activation routing | VERIFIED | `activated-ids` → **200**; real id → 200; unknown → 404; Learning UI shows Activate / Roll Back, no ErrorState |
| DB pool resilience | VERIFIED | Terminated **12** idle backends → 12 recoverable log lines, **same PID alive**, health 200, pool reconnected; bad role/db/missing URL still exit loudly |
| calendar contrast | VERIFIED | Re-measured exactly: 7.00 light, 7.57 dark, 15.55 dark-today; full axe 0 violations both themes |
| autonomy timezone | VERIFIED | 20/20 under UTC **and** `Asia/Kolkata`; pre-fix controller restored → **17/20** on Kolkata, reproducing the original 3 failures |
| test isolation | VERIFIED | Poisoned row → pre-fix 7/10 with `Failed to decrypt stored accessToken`; on `origin/main` 10/10 and the guard clears it |

### Auditor C — Platform: **HOLDS**

- **Canonical loop HOLDS by execution** over live HTTP and a real `publication.run` worker:
  `Artifact → review → approve → reject → Schedule → Occurrence → Publication → Result`, plus
  `Activation → Rollback` (activate 201 → duplicate 200 `alreadyActivated` → rollback 200).
- **No false publication success — HOLDS.** The attack: `{x, bogus}` → HTTP 207 `{x:"created",
  bogus:"invalid"}`, and the `x` target then reached `state:"failed"`, `outcome:"failed"`, never
  `"published"`. `"published"` is written only from a confirmed adapter outcome, and the client
  renders `created` as "scheduled… not confirmed". Reconciliation keeps a never-resolving item as
  **unknown, not falsely published**.
- **Scheduler HOLDS** — `scheduler.dbtest` 23/23: durability, enqueue dedupe, 10-way concurrency
  ≤1 activation, kill switch, mode/flag/breaker/guardrail, budget, cooldown, cross-owner,
  reread-proof. Boundary **Scheduler = WHEN / Controller = WHETHER** confirmed.
- **Recovery HOLDS** — `runtime.dbtest` 8/8: retry, DLQ, dedupe, graceful stop, restart-recovers-
  pending, lease/unknown recovery, and **no duplicate activation** path found.
- Both Phase 33.6 defects no longer reproduce.

### Auditor D — Engineering: **no product blocker**

- `tsc` PASS · build PASS · `test:unit` **816/816** · E2E serial **273 passed / 5 failed / 2 skipped**
- All 5 E2E failures and all `test:db` failures are classified **harness/env, stale spec, or
  cross-spec shared state** — `settings-labels` passes 5/5 in isolation.
- Bundle baseline **holds**: entry `362,582 B` (gzip 118.66 kB) vs 1,792,007 B pre-split;
  **8** route chunks; exactly **1** chunk over Vite's 500 kB warning (`create`, 647.56 kB).
- The 33.6 register's four open BLOCKERs are **all fixed**.

---

## 3. Correction: the `test:db` hole is an env-var split, not a crash cascade

My plan said one file threw at import and aborted the run. **Auditor D refuted this**, and the
evidence is clear:

- `npm run test:db` with only `DATABASE_URL` set executes **5 of 364 cases**; **37 of 39 suites
  skip**.
- The cause is that **38 of 39 dbtest files gate on `TEST_DATABASE_URL` alone**
  (`const CONNECTION = process.env.TEST_DATABASE_URL`); only `createWorkflow.dbtest.ts` falls back
  to `DATABASE_URL`.
- The abort hypothesis is refuted directly: a skipped file runs alone and still skips; skips take
  ~0.16 ms; the one import error does not stop later files.
- With `TEST_DATABASE_URL` set: **364 cases run** (349 pass / 10 fail / 5 cancelled).
- **No CI job runs `test:db` at all.**

So `npm run test:db` has been exercising **~1.4 % of its corpus** and reporting success, and it is
not in CI. That is the single largest integrity gap in the project — and it is test
infrastructure, not a product defect. Cheapest fix (identified, not applied): unify the variable,
set `CONTENTFORGE_E2E_SERVER=1`, and pin `ENCRYPTION_KEY` in-process.

---

## 4. Remaining debt (non-blocking)

| # | Item | Class |
|---|---|---|
| D1 | `test:db` covers ~1.4 % of its corpus; 38/39 suites need `TEST_DATABASE_URL`; **absent from CI** | test infrastructure |
| D2 | F1 LOW — cross-owner existence oracle on `POST /api/policy-candidates/:id/activate` (403 vs 404, no data change) | security LOW |
| D3 | F2 LOW — a deleted-user session still authenticates (dangling id, not owner 1) | security LOW |
| D4 | 5 E2E failures (stale `destructive-actions` route, `error-states` obsolete premise, `agent-publish` needs the live pipeline, `api:200` needs real AI creds, one cross-spec shared state) | harness / stale spec |
| D5 | `visualPublication` idempotency fails deterministically 3/3 — a real assertion, not a flake | test-side |
| D6 | Systemic dark `--primary` used as text (3.24:1; 83 sites) | accessibility, backlog |
| D7 | `create` chunk 647.56 kB over Vite's warning | performance |
| D8 | Parallel-run rate-limit contention; `drizzle-kit generate` broken by a pre-existing `meta` snapshot collision | tooling |
| D9 | Research/Generation engines and real provider-side publish success **not executed** (no AI credentials in the audit environment) | verification gap |
| D10 | No long-duration soak | verification gap |

---

## 5. Decision

**FINAL GO WITH NON-BLOCKING DEBT.**

Every criterion required for a GO is satisfied on the product:

| Requirement | Status |
|---|---|
| No auth bypass | **PASS** — 275/275 case variants 401 |
| No owner fallback | **PASS** — none remains |
| No cross-owner `discovery_settings` | **PASS** — verified on fresh DBs and live |
| Human activation works | **PASS** |
| No process crash from a recoverable pool error | **PASS** — 12 terminations survived |
| Accessibility blockers resolved | **PASS** — calendar + dialog focus + settings labels verified |
| Timezone correctness | **PASS** — 20/20 UTC and non-UTC |
| No false publication success | **PASS** — attacked and held |
| Functionality verified | **PASS** — canonical loop by execution |
| Scheduler verified | **PASS** — 23/23 |
| Recovery verified | **PASS** — 8/8, no duplicate activation |
| Independent audit complete | **PASS** — four auditors, none endorsing prior conclusions |

The debt is real but none of it blocks a single operator using the product: the DB suite is not
trustworthy (D1), two LOW security findings (D2, D3), known harness failures (D4, D5), and
verification gaps where no credentials existed (D9, D10).

**Not a clean GO** because a test command that reports success while running 1.4 % of its corpus,
with no CI coverage, is exactly the kind of signal that has misled this project before.

---

## 6. What happens next (from the approved plan)

1. ~~Final independent production audit~~ — **done, this document**
2. **Deploy** — requires your decision: point Railway at `main` (GitHub default branch +
   `deploy.yml` trigger) after confirming every env var the newer code needs exists there. The
   app is fail-closed, so a missing variable is a failed healthcheck, not a degraded start.
3. **Connect your real accounts**
4. **Dogfood for 2–4 weeks**, keeping a friction log
5. **Reassess from observed friction**, not imagined requirements

Deployment branch unchanged (`replit`), nothing deployed, credentials not rotated — all by
instruction.
