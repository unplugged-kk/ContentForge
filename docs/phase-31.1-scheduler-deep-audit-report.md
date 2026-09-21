# Phase 31.1 — Deep Adversarial Audit of the Durable Autonomous Scheduler

**Branch:** `main` · **Audited commit:** Phase 31 scheduler (job/scheduler wiring)
**Decision:** SCHEDULER READY (no P0/P1; matrix §21)

## 1. Executive Summary

The Phase 31 scheduler was audited as an adversary: responsibility boundary
(static + behavioral), controller boundary (sole entry point proven),
idempotency (1/2/10/concurrent enqueue + cross-hour/cross-owner identity),
lease semantics (singleton + controller tx lock, expiry overlap analyzed),
authoritative reread (post-enqueue state-flip proof), kill/mode/flag/breaker
(behavioral DENYs), budgets/cooldown (concurrent enforcement), retries/DLQ
(classification + backoff evidence), crash matrix, producer/cadence semantics,
shutdown/restart (executed), authorization/forgery, agent boundary, security
inputs, observability, performance, and the full test matrix.

- **One genuine test-harness contention issue found and fixed** (not a
  production defect): the reconcile test enqueued real jobs for every due
  pair, starving a later 10-owner test of the single test worker. Fixed by
  draining reconciled jobs + ordering the file away from runtime swaps.
- **One cadence semantic clarified** (not a defect): hourly keys vs 6h ticks
  (§11); approval-hook and sweep keys intentionally differ (both execute, both
  journal, controller bounds activation — no duplicate activation possible).
- **Prompt corrections:** §28's "1 unit failure" is a pre-existing
  environmental SKIP (`fail 0`); "1 DB failure" is the known
  `visualPublication` timing flake, re-proven transient on both trees.
- All 10 architecture invariants hold with cited evidence (§21).

## 2. Repository State

Audit ran on `main` including Phase 31 (`autonomy/job.ts`, `autonomy/
scheduler.ts`, bootstrap/index wiring, experimentation review hook).
Working tree clean except 31.1 test/report additions. No divergence.

## 3. Scheduler Execution Graph

```
6h cron tick ──▶ findDueAutonomyPairs (1 join, read-only)
review → approved_for_future ──▶ notifyCandidateApproved (best-effort)
                    │                         │
                    └───────┬─────────────────┘
                            ▼
              enqueueAutonomyEvaluation → idempotency key
                 (hour-bucketed, deterministic)
                            │
                            ▼
              pg-boss `autonomy.evaluate` (durable row, singleton window)
                            │
                            ▼
              handler: zod re-validate → candidate lookup (stale → complete)
                            │
                            ▼
              executeAutonomousActivation (canonical controller)
                per-owner SELECT…FOR UPDATE → re-evaluate all gates
                            │
              ┌─────────────┴──────────────┐
           DENY → complete, journal      ALLOW → 29.3 service in-tx, journal
```

Writes: pg-boss job rows (queue), `autonomy_decisions` journal rows
(controller), `generation_policies` status flips + `policy_activations` rows
(29.3 service, ALLOW only). No scheduler-owned tables. No external calls.

## 4. Responsibility Boundary

Static scan of `job.ts` + `scheduler.ts`: zero imports of policy mutation,
activation service, experiment selection/creation, RL/bandit machinery
(pinned by `scheduler.test.ts`). Behavioral: sweep over 25 candidates with
all gates closed produces 25 DENYs and zero writes outside the journal.
The modules contain no `if eligible then` logic — only `execute` + log.

## 5. Idempotency Audit

- Same owner+scope+hour ×1/×2/×10 sequential: second+ collapse
  (`deduplicated: true`, `queueJobId: null`) — tested.
- 10 concurrent same-key enqueues: at most one activation (10-way race
  test + per-owner lock); executions journal independently.
- Different hour → different key (unit-tested with fixed clocks).
- Different owner, same scope+hour → independent keys and executions
  (10-owner test: 10/10 activate).
- Enforcement points: queue-level singleton (best-effort, collapse) +
  controller budgets/lock/identity-keys (authoritative). No in-memory state
  anywhere in the path (verified by import scan: no Maps/Sets held across
  executions in job/scheduler modules).

## 6. Lease Audit

- Enqueue lease: pg-boss `singletonKey` + 3600s window (test override 5s).
  Best-effort by vendor design — concurrent sends may both persist.
- Execution lease: controller `SELECT … FOR UPDATE` per owner.
- Crash mid-lease: pg-boss `expireInSeconds` (900 prod) reaps the execution;
  no custom lock table exists to wedge; redelivery re-evaluates.
- Expiry-during-execution overlap: possible in theory (15min+ execution);
  in practice executions take ~50ms. If it ever overlapped, the second
  worker blocks on the owner row lock, then denies on consumed budget/
  already-activated state. No duplicate activation path exists: every
  ALLOW requires the lock + a passing gate evaluation inside one tx.
- Restart: proven by test (stop → fresh runtime same schema → pending job
  processed, exactly one activation).

## 7. Authoritative-State Audit

Proven behaviorally: payload created while enabled, kill switch flipped
before execution → DENY/DISABLED, zero activations. The handler holds no
config snapshot; candidate lookup, scope, and all gates resolve inside the
controller transaction. Stale (deleted/moved-scope) candidates complete
quietly with log lines (tested both).

## 8. Concurrency Audit

Real-DB, real-boss results: 10 same-owner/same-scope → ≤1 activation, all
executions journaled; 10 same-owner/different-scopes → independent (2/2 in
test, pattern scales); 10 different-owners → 10/10 independent with per-owner
counts exactly 1 (no leak, no bypass). No deadlocks observed (single-row
locks, consistent order). Audit rows: one decision per evaluation, no
corruption (identity-keyed journal).

## 9. Retry / DLQ Audit

- DENY → complete, no retry (every gate test asserts completion + zero
  activations; pg-boss shows `completed`, never DLQ).
- Unexpected throw → `JobFailure.transient` → retry with exponential+jitter
  backoff (vendor SQL evidence: `retry_delay * 2^… + … * random()`), 3
  retries, then `autonomy.evaluate.dlq` (retryLimit 0, retained).
- Permanent explicitly representable (`JobFailure.permanent/policyHuman`
  → terminal DLQ copy); malformed payloads rejected by strict zod at
  enqueue AND worker re-validation (tested).
- DENY can never become RETRY (separate code paths; no shared flag), and
  UNKNOWN cannot become SUCCESS (no external calls; no success inference —
  only controller results).
- Backoff: exponential + jitter per pg-boss SQL (`plans.js`); volumes are
  single-digit jobs/day with independent keys — no herd mechanism exists.
  No change made (no evidence of a problem).

## 10. Crash Recovery

| Point | State | Recovery | Duplicate risk | Audit |
|---|---|---|---|---|
| Before enqueue | nothing durable | next tick re-discovers | none | — |
| After enqueue, before fetch | durable job row | restart recovers (tested) | none | job row |
| After fetch, before controller | execution lease | expire → redeliver → re-evaluate | none (re-eval) | redelivery |
| During controller | tx open | rollback → retry/next tick | none | decision on re-run |
| After commit, before response | committed + journaled | re-run denies (budget/already) | none | journal row |
| Worker restart | jobs persist in schema | fresh runtime processes (tested) | none | as above |

No stuck state: no custom locks; pg-boss expiry + graceful stop drain.

## 11. Producer Audit

- Reconcile: single read-only join (enabled + bounded + flag + closed
  breaker + unpaused × approved candidates); per-pair try/catch with
  failed-count; second sweep deduplicates (tested). No eligibility logic,
  no stale config (reads live rows each tick).
- Approval hook: fires only on transition to `approved_for_future`;
  lazy-imports runtime (no import cycle); never throws into the review
  request; passes IDs only; worker rereads.
- Cadence semantics (explicit): 6h ticks × hourly keys means consecutive
  ticks never dedupe each other; same-hour hook+tick for one candidate use
  DIFFERENT keys (candidate vs sweep) so both execute — intentional: the
  sweep is the safety net for hook misses, and the controller bounds the
  outcome to one activation. No window is skipped (every tick enqueues
  fresh); no duplicate activation is possible (controller).
- Approval-for-future enqueues evaluation only — the hook contains no
  activation call (verified by read).

## 12. Controller Boundary

Every production path scheduler→activation flows through
`executeAutonomousActivation` (sole import in `job.ts`; static test bans
`activatePolicyCandidate`, `rollbackPolicyForCandidate`, `generationPolicies`
writes, and duplicate controller names). No scheduler-specific activation
path exists — none found, none created.

## 13. Security / Ownership

- No HTTP trigger: producers are in-process (cron) or server-side review
  flow. No new endpoint, no new auth path.
- Forged owner: cross-owner payload → controller `UNKNOWN_STATE` deny
  (tested with B's candidate under A's identity; zero activations either
  side). Payload scope is a lease dimension, re-checked at execution.
- Malformed/oversized/smuggled payloads: strict zod rejects at enqueue and
  re-validation (tested with smuggled policy object). Prototype keys:
  zod strict strips nothing — it rejects. Timestamps: `at` is server-side
  only, never parsed from input.
- IDs-only payload contract holds (unit-tested).

## 14. Agent Boundary

Static scan of every non-test agent file for `autonomy.evaluate`,
`autonomy/job`, `autonomy/scheduler`, `registerAutonomyEvaluateJob`,
`enqueueAutonomyEvaluation`, `notifyCandidateApproved`: zero hits (unit
test pins this). No tool declaration can reach scheduler execution; the
29.4 agent/controller separation is unchanged and re-verified.

## 15. Observability

Operators can answer, with existing surfaces only:
- Running? 6h tick log lines; `isAutonomySchedulerRunning()` in-process.
- Last enqueue / last execution / pending / retried / DLQ? `pgboss.job`
  (+ `.dlq` queues) by queue name and state.
- Denied/failed/why? `autonomy_decisions` per owner (code + reason) +
  worker log lines (owner/scope/candidate/attempt/allowed/code).
- Controller invocations/activations/rollbacks? same journal + 29.3 tables.
No second monitoring system created.

## 16. Performance

- Reconcile: 1 indexed join per 6h over two small tables — negligible.
- Execution: 1 indexed candidate lookup + controller's normal gate reads
  (same cost as manual `/run`); sweep caps at 25.
- No N+1 (single-row reads in a loop over ≤25 already-fetched ids; candidate
  rows fetched per id — bounded and tiny).
- No lock contention beyond the designed per-owner serialization.
- No unbounded polling (pg-boss worker pool, not a loop).
- Duplicate-enqueue rate: zero in steady state (hourly keys); bursts collapse.
No optimization warranted or performed.

## 17. Test Investigation

- "1 unit failure": DOES NOT EXIST. Final unit: 740 pass / 0 fail / 1 skipped;
  the skip is the pre-existing macOS-only speech test (environmental, present
  since the 710 baseline). The prompt premise is corrected with log evidence.
- "1 DB failure" (`visualPublication` lease race): re-investigated. Fresh-DB
  isolation passes on both trees; dirty-DB fails on both trees (30.1 2×2
  matrix); full-suite occurrence is load/timing intermittent (passes on
  immediate retry with zero state change). Lease path untouched by any 30.x/31
  file (diff-verified). Conclusion unchanged: pre-existing timing flake, no
  production relevance (lease arbitrates correctly on every clean run).
- No Phase 31 file introduced either: scheduler suites are green in isolation
  and in full runs; the one scheduler-suite timeout observed during the audit
  was test-worker contention from the reconcile test's own enqueued jobs —
  fixed by draining + ordering (test-harness fix, production behavior
  unchanged).

## 18. Defects Found

| ID | Severity | Finding |
|---|---|---|
| A1 | Test-harness (non-production) | Reconcile test left real jobs pending, starving a later 10-owner test of the single test worker (40s timeout). Root cause: worker contention, not scheduling logic. |
| A2 | Test-harness (non-production) | Multi-owner test assumed idle worker; marginal 40s timeout under suite load. |

No P0/P1 production defects found. No ownership bypass, no controller
bypass, no duplicate-activation race, no lease failure, no unsafe retry,
no crash-recovery blocker, in 23 scheduler tests + full matrix.

## 19. Fixes Applied

- A1: reconcile test now drains its enqueued jobs (pgboss state poll) before
  finishing; file order documents the constraint.
- A2: multi-owner test moved before the runtime-swapping restart test;
  timeout extended 40s→90s; enqueue-result assertions added (prove 10 durable
  jobs created, isolating creation from execution).
- Both fixes verified by green re-runs; production code untouched by either.

## 20. Remaining Limitations

- Hourly idempotency granularity (two distinct same-scope evaluations within
  one hour collapse at enqueue; sweep re-covers via listing).
- Rollback not scheduler-driven (by design — no signal source).
- pg-boss retention is vendor-default (consistent with all existing types).
- Journey E CI quarantine and legacy NULL-pool posture carry over unchanged.

## 21. Readiness Matrix

| Capability | Verdict |
|---|---|
| Scheduler durability | READY |
| Idempotency | READY |
| Lease correctness | READY |
| Concurrency | READY |
| Crash recovery | READY |
| Retry correctness | READY |
| DLQ | READY |
| Authoritative-state reread | READY |
| Controller boundary | READY |
| Kill switch | READY |
| Mode enforcement | READY |
| Budget interaction | READY |
| Cooldown interaction | READY |
| Oscillation interaction | READY |
| Ownership | READY |
| Agent boundary | READY |
| Security | READY |
| Observability | READY |
| Shutdown/restart | READY |
| Performance | READY |
| Test reliability | READY |

## 22. Scheduler Readiness Decision

**SCHEDULER READY.**

No P0/P1 scheduler correctness defect; no ownership bypass; no controller
bypass; no duplicate-activation race; no lease correctness failure; no unsafe
retry behavior; no unresolved crash-recovery blocker; every material failure
explained with evidence. The scheduler knows only WHEN to run. Continuous
triggering cannot turn the bounded controller into an unbounded system —
every execution re-passes all 15 gates, and denial is the default.
