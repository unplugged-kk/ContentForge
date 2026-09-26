# Phase 33.6 — Scheduler + Autonomy + Recovery Audit

**Dimension:** scheduler durability, idempotency, lease, concurrency, authoritative
state re-read, kill switch; autonomy modes, budget, cooldown, oscillation, circuit
breaker, rollback, agent boundary; retry, DLQ, worker restart, crash recovery.

**Worktree:** `/Users/kishore/git/cf-design/336sched` (branch `phase-33.6-scheduler-audit`,
from `main` @ `d4a3760`). **Mode:** READ-ONLY (no production code changed; only this report).
**Env:** `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`, `E2E_PORT=4506`,
`NODE_ENV=production`, `SESSION_COOKIE_SECURE=0`, `CONTENTFORGE_E2E_SERVER=1`.

Evidence is labelled **BY EXECUTION** (suite/command actually run) or **BY READING**.
Every **BY EXECUTION** claim below was run on this worktree, on this machine.

---

## 1. Verdict

The scheduler/autonomy/recovery dimension is **PASS** on all critical cases and on every
non-critical dimension, **with one environment-dependent BROKEN finding (F1)** that is
pre-existing and is *not* a scheduler/autonomy logic defect.

**Scheduler = WHEN, Controller = WHETHER: CONFIRMED.** The scheduler never mutates
policy or autonomy state; only the Phase 29.4 controller does, and it does so via the
one-way `openCircuitBreaker` (more restrictive only) and the single Phase 29.3
policy-mutation service. Details in §5.

---

## 2. Critical cases — reproduced, not read

| # | Critical case | Result | Evidence | How |
|---|---|---|---|---|
| C1 | **Duplicate activation attempts** | PASS | BY EXECUTION | `scheduler.dbtest` "duplicate enqueue within the window collapses to one job" (real pg-boss: 2nd enqueue `deduplicated:true`, `queueJobId:null`, ≤1 activation). Live HTTP: 7 repeat/concurrent `POST /api/autonomy/run` for candidate 1616 → **1 activation total** (DB: `policy_activations` count=1; journal 1×ELIGIBLE, 7×denied). |
| C2 | **Concurrent claim of the same job** | PASS | BY EXECUTION | `scheduler.dbtest` "10 simultaneous same-owner same-scope triggers yield at most one activation" (10 enqueues → `policy_activations` ≤ 1, `autonomy_decisions` = 10). Also `autonomy.dbtest` "budget race … DIFFERENT scopes … budget of 1" → exactly 1 of 2 concurrent cross-scope activations passes, DB shows exactly 1 activation. |
| C3 | **Kill switch actually stopping work** | PASS | BY EXECUTION | `scheduler.dbtest` "kill switch denies without activation" (0 activations, journal `DISABLED/UNCONFIGURED`) + "state changed after enqueue controls execution (reread proof)" (enabled at enqueue → disabled before execution → 0 activations, `DISABLED`). Live HTTP: `POST /api/autonomy/disable` → next `POST /api/autonomy/run` → HTTP 422 `DISABLED`, 0 activations. |
| C4 | **Lease recovery after a simulated crash** | PASS | BY EXECUTION | `scheduler.dbtest` "restart recovers a pending job without loss" (real pg-boss, enqueue → stop runtime → fresh runtime → processed). Plus a dedicated in-flight lease repro (`_repro_lease.mts`, deleted after use): real `JobRuntime` + real `autonomy.evaluate` handler → enqueue (state `created`) → simulate a crashed worker holding the lease (`state='active'`, `expire_in=1s`) → start a **fresh** runtime → pg-boss maintenance reclaimed the expired lease and redelivered (`attempt:2`, `retry_count` 0→1) → real controller executed the activation (`ELIGIBLE`, `activated:true`) → job `completed`. |

---

## 3. Full proof matrix

### Scheduler (`server/content/autonomy/job.ts`, `scheduler.ts`)

| Property | Verdict | Evidence type | Proof |
|---|---|---|---|
| Durability (job survives process) | PASS | BY EXECUTION | `scheduler.dbtest`: "creates durable work visible in the pg-boss schema"; "restart recovers a pending job without loss". |
| Idempotency key | PASS | BY EXECUTION | `scheduler.test.ts`: deterministic, hour-bucketed (`…:sweep:20260921T10`), `Math.random()`-free. `scheduler.dbtest`: duplicate collapse. |
| Idempotency — strict payload | PASS | BY EXECUTION | `scheduler.dbtest`: "malformed payloads are rejected, never executed" (strict zod rejects smuggled `policy` at enqueue) + `scheduler.test.ts` payload IDs-only. |
| Lease — enqueue (singleton) | PASS | BY EXECUTION | `scheduler.dbtest` duplicate/enqueue dedup; `runtime.dbtest` "deduplicates a second enqueue with the same idempotency key". |
| Lease — execution (per-owner `SELECT … FOR UPDATE`) | PASS | BY EXECUTION | `scheduler.dbtest` 10-way race → ≤1 activation; `autonomy.dbtest` cross-scope budget race → exactly 1. |
| Lease — expiry reaping of a stuck execution | PASS | BY EXECUTION | `_repro_lease.mts` (see C4). |
| Concurrency | PASS | BY EXECUTION | `scheduler.dbtest`: 10-way same-key; same-owner/different-scope independent; 10 owners independent. |
| Authoritative state re-read at execution | PASS | BY EXECUTION | `scheduler.dbtest` "state changed after enqueue controls execution (reread proof)"; handler passes IDs only and calls the controller (`job.ts:170`). |
| Kill switch at execution (regardless of enqueue provenance) | PASS | BY EXECUTION | scheduler.dbtest kill-switch + reread tests; live HTTP C3. |
| Reconcile discovery + dedup | PASS | BY EXECUTION | `scheduler.dbtest` "reconcile discovers due pairs and enqueues without duplicates" (`pairs≥1`, 2nd sweep `deduplicated≥1`). |
| Cadence / trigger-only cron | PASS | BY EXECUTION | `scheduler.test.ts`: `AUTONOMY_SCHEDULER_CRON === "0 */6 * * *"`. |
| Scheduler has no policy/autonomy mutation path | PASS | BY EXECUTION + READING | `scheduler.test.ts` static boundary suite; grep of `job.ts`+`scheduler.ts` for `updateAutonomyConfig/openCircuitBreaker/resetCircuitBreaker/generationPolicies/activatePolicyCandidate/rollbackPolicyForCandidate/insert(/.set(/update(` → **NONE**. |
| Agent tier cannot reach scheduler | PASS | BY EXECUTION | `scheduler.test.ts` "agent tier never references the scheduler job"; `autonomyDenial.test.ts` agent boundary. |

### Controller / autonomy (`server/content/autonomy/controller.ts`, `config.ts`)

| Property | Verdict | Evidence type | Proof |
|---|---|---|---|
| Autonomy modes | PASS | BY EXECUTION | `autonomy.dbtest`: `UNCONFIGURED`; mode `experiment_only` → `MODE_NOT_PERMITTED`; `activationAutomationEnabled=false` → `ACTIVATION_AUTOMATION_DISABLED`; `bounded_activation` allow (§45 end-to-end). |
| Evidence floor (hard minimum) | PASS | BY EXECUTION | `controller.test.ts` (never below `repeatable` regardless of config); `autonomy.dbtest` `INSUFFICIENT_EVIDENCE`. |
| Budget (daily/weekly) | PASS | BY EXECUTION | `autonomy.dbtest` `BUDGET_EXHAUSTED_DAILY`; `scheduler.dbtest` "daily budget enforced across scheduled executions". |
| Cooldown | PASS | BY EXECUTION | `controller.test.ts` `cooldownElapsed`; `autonomy.dbtest` `COOLDOWN_ACTIVE`; `scheduler.dbtest` "cooldown cannot be bypassed by a second scheduled job". |
| Oscillation / churn | PASS | BY EXECUTION | `controller.test.ts` `detectOscillation`/`countConsecutiveAutonomous`; `autonomy.dbtest` `POLICY_CHURN` (**passes under UTC — see F1**). |
| Circuit breaker (open blocks; human-only reset) | PASS | BY EXECUTION | `autonomy.dbtest` `CIRCUIT_OPEN` then human `resetCircuitBreaker` → `closed` → allowed; `scheduler.dbtest` "open breaker denies without activation". |
| Rollback (immutable prior revision) | PASS | BY EXECUTION | `autonomy.dbtest` "rollback … prior revision as a new immutable event" (previous rev archived, not deleted) (**passes under UTC — see F1**); `rollbackEnabled=false` → `ROLLBACK_DISABLED`; repeated rollbacks → `CIRCUIT_OPENED_OSCILLATION`. |
| Rollback is controller-internal (not scheduler-driven) | PASS | BY READING | `scheduler.ts`/`job.ts` contain no rollback path; design §8. |
| Owner isolation / cross-owner denial | PASS | BY EXECUTION | `scheduler.dbtest` "cross-owner execution is denied"; `autonomy.dbtest` "unknown state (foreign owner)"; "owner isolation". |
| Every evaluation journaled (allowed+denied, machine-readable) | PASS | BY EXECUTION | `autonomy.dbtest` "every evaluation … durably logged". |
| Agent boundary (no autonomy exec/config from agent) | PASS | BY EXECUTION | `autonomyDenial.test.ts` (static: no autonomy tool names, no controller/config imports, controller never calls human mutators, no direct `generation_policies` writes). |

### Job runtime / recovery (`server/jobs/*`)

| Property | Verdict | Evidence type | Proof |
|---|---|---|---|
| Retry (transient) | PASS | BY EXECUTION | `runtime.dbtest` "retries a transient failure and succeeds on a later attempt"; `researchRuntime.dbtest` (parallel). |
| DLQ (permanent) | PASS | BY EXECUTION | `runtime.dbtest` "dead-letters a permanent failure without consuming retries" (`failureClass:permanent`, DLQ data asserted). |
| DLQ (unparseable envelope) | PASS | BY EXECUTION | `runtime.dbtest` "dead-letters an unparseable envelope" (`reason:invalid_envelope`). |
| Retry classification contract | PASS | BY EXECUTION | `failures.test.ts`; `scheduler.dbtest` "unexpected handler errors classify as transient". |
| Worker restart / graceful shutdown | PASS | BY EXECUTION | `runtime.dbtest` "shuts down gracefully"; `scheduler.dbtest` restart recovery. |
| Crash recovery (pending + in-flight lease) | PASS | BY EXECUTION | `scheduler.dbtest` restart recovery; `_repro_lease.mts` (C4). |

### Suite tallies (this worktree, this machine)

| Suite | Command | Result |
|---|---|---|
| Unit/static (scheduler, controller, agent-denial, job infra) | `node --import tsx --test server/content/autonomy/scheduler.test.ts server/content/autonomy/controller.test.ts server/agent/autonomyDenial.test.ts server/jobs/{envelope,failures,registry,logger}.test.ts` | **61/61 pass** |
| `scheduler.dbtest.ts` | `TEST_DATABASE_URL=… node --import tsx --test --test-concurrency=1` | **23/23 pass** |
| `autonomy.dbtest.ts` (DB TZ = Asia/Kolkata, default) | as above | **17/20 pass** — see **F1** |
| `autonomy.dbtest.ts` (DB session `timezone=UTC`) | `…?options=-c timezone=UTC` | **20/20 pass** |
| `runtime.dbtest.ts` + `researchRuntime.dbtest.ts` | as above | **14/14 pass** |
| Live server on :4506 (auth + autonomy API) | `npm run build`; `npm start` PORT=4506 | boot OK; C1/C3 reproduced |

---

## 4. Finding F1 — autonomy.dbtest is BROKEN under a non-UTC Postgres session timezone

**Status: BROKEN (environment-dependent); pre-existing; not a scheduler/autonomy logic defect.**

Under the default local DB session TZ (`Asia/Kolkata`), 3/20 `autonomy.dbtest` cases fail;
all 20 pass with `timezone=UTC`. The 3 failures all share the same cause:

- `policy churn` → got `COOLDOWN_ACTIVE`, expected `POLICY_CHURN`
- `rollback … immutable event` → 2nd same-scope activation denied (`allowed:false`)
- `repeated autonomous rollbacks … circuit breaker` → got `NO_PRIOR_REVISION`, expected `CIRCUIT_OPENED_OSCILLATION`

**Root cause (proven by execution):** `policy_activations.created_at` (and every model
timestamp) is `timestamp without time zone` with default `CURRENT_TIMESTAMP`. With the DB
session TZ at `Asia/Kolkata`, Postgres stores *local wall-clock* (`11:11:49`), while the
application reads it back through drizzle as if it were UTC (`…T11:11:49Z`), so the value is
**~5.5 h in the future** relative to `Date.now()`. Measured: `delta = Date.now() - createdAt
= -19,799,983 ms`; live `/api/autonomy/run` reported `"elapsedMinutes":-330`. With
`cooldownMinutes=0`, `cooldownElapsed()` therefore returns `false` and the gate reports
`COOLDOWN_ACTIVE` — masking the churn/oscillation/rollback outcomes the tests assert.

Decisive experiment: re-running the identical suite against a `timezone=UTC` session turns
17/20 into **20/20**. The controller/scheduler source is unchanged, so this is a
DB-timezone ↔ `timestamp`-column interaction, not a logic regression from this phase.
`server/db.ts` does not pin a session timezone, and production Postgres is expected to be
UTC (Railway default) — so this is **latent in production** and only bites non-UTC DBs /
local dev.

**Impact on this audit:** none of the four critical scheduler cases depend on this; all four
were reproduced (C1–C4). The controller's cooldown/oscillation windows are, however,
timezone-fragile and should be pinned (e.g. `timestamp with time zone`, or force
`timezone=UTC` on every pool) — reported, not redesigned.

---

## 5. Scheduler = WHEN, Controller = WHETHER — confirmed

**BY READING (and statically asserted BY EXECUTION via `scheduler.test.ts`):**

- `server/content/autonomy/scheduler.ts` and `job.ts` perform **read-only discovery**
  (`findDueAutonomyPairs` reads `policy_candidates` ⨝ `autonomy_configs`) and **enqueue only**.
  Grep for every mutation primitive (`updateAutonomyConfig`, `openCircuitBreaker`,
  `resetCircuitBreaker`, `disableAutonomy`, `pauseAutonomy`, `generationPolicies`,
  `activatePolicyCandidate`, `rollbackPolicyForCandidate`, `insert(`, `.set(`, `.update(`)
  over both scheduler files returns **NONE**.
- The scheduler invokes exactly one controller entry point — `executeAutonomousActivation`
  (`job.ts:170`) — and does not contain `evaluateScheduledEligibility` or any duplicate
  controller (`scheduler.test.ts`).
- The only writers of autonomy policy state are the controller
  (`openCircuitBreaker` one-way to `open`; rollback oscillation) and the Phase 29.3 service
  (`activatePolicyCandidate`/`rollbackPolicyForCandidate`) — the sole policy-mutation path
  (`autonomyDenial.test.ts` proves the controller never calls human mutators and never writes
  `generation_policies` directly).
- Human-only mutators live in the HTTP surface (`/api/autonomy/{enable,disable,pause,circuit-breaker/reset}`);
  there is no HTTP endpoint that triggers the scheduler (internal producers only).

Verdict: **the scheduler decides WHEN; the controller decides WHETHER and is the only actor
that may mutate policy/autonomy state.**

---

## 6. Nothing else FALSIFIED

No scheduler durability/idempotency/lease/concurrency/reread/kill-switch claim was
falsified. No autonomy mode/budget/cooldown/oscillation/breaker/rollback/agent-boundary
claim was falsified. No retry/DLQ/worker-restart/crash-recovery claim was falsified. The
only BROKEN item is **F1** (environment-dependent, pre-existing, controller-timing only).

## 7. Reproduce

```bash
# unit/static
NODE_ENV=test node --import tsx --test server/content/autonomy/scheduler.test.ts \
  server/content/autonomy/controller.test.ts server/agent/autonomyDenial.test.ts \
  server/jobs/{envelope,failures,registry,logger}.test.ts
# db (real pg-boss + real controller; isolated schemas pgboss_sched / pgboss_test)
TEST_DATABASE_URL=$DATABASE_URL NODE_ENV=test node --import tsx --test --test-concurrency=1 \
  server/content/autonomy/scheduler.dbtest.ts server/content/autonomy/autonomy.dbtest.ts \
  server/jobs/runtime.dbtest.ts server/jobs/researchRuntime.dbtest.ts
# F1 proof
TEST_DATABASE_URL="${DATABASE_URL}?options=-c timezone=UTC" NODE_ENV=test node --import tsx \
  --test --test-concurrency=1 server/content/autonomy/autonomy.dbtest.ts   # 20/20
# live
SESSION_SECRET=… npm run build && SESSION_SECRET=… PORT=4506 DATABASE_URL=$DATABASE_URL \
  SESSION_COOKIE_SECURE=0 CONTENTFORGE_E2E_SERVER=1 npm start
```

## 8. Assumptions / limits

- The local Postgres (`:5433`) is shared with other sessions; `pgboss*` test schemas are
  isolated, so no cross-run state was assumed. `pgboss` (the app schema) may be shared.
- Lease-reap uses a short `expire_in`; production `autonomy.evaluate` uses the queue default
  (`expire_in 15m`) and thus reaps more slowly — same mechanism, longer window.
- Reproduction of C1/C3 over live HTTP used API-driven `/api/autonomy/run` (the controller
  surface) plus the real-runtime dbtest for the scheduler job path.
