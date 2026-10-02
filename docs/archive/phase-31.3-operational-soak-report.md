# Phase 31.3 — Controlled Operational Soak + Production Rehearsal

**Branch:** `main` · **Tree:** 31.1-verified (no code changes in this phase)
**Decision:** SOAK PASSED

## 1. Executive Summary

A live 5-cycle operational soak (real pg-boss runtime, isolated schema,
real controller, real DB) plus a poison-job DLQ drill proved continuous
stability: 14 jobs completed, 5 distinct candidates activated exactly once
each, 13 decisions journaled, 1 poison job retried ×3 with backoff then
DLQ-retained, worker restart mid-soak with zero loss/duplication,
kill-switch ON/OFF cycle honored, duplicate deliveries collapsed, steady
memory (233→239MB) and connections (2–5). No code changes were needed.

## 2. Environment

Isolated Postgres `cf_soak` (migrated, 31 migrations), one owner, one
eligible candidate seeded per cycle, budgets 100/day (non-binding by
design — the soak observes controller bounds, it does not stress them),
cooldown 0. Driver script kept out of the repo (`/tmp`, deleted after);
only this report is committed. No paid calls, no real publications
(fixture-less DB-only activation path), nothing destructive.

## 3. Repeated Execution

| Cycle | Pairs | Enqueued | Completed (cumulative) | Activations | Decisions |
|---|---|---|---|---|---|
| 0 | 1 | 1 | 1 | 1 | 1 |
| 1 (+restart) | 2 | 2 | 4 | 2 | 3 |
| 2 (kill ON) | 0 | 0 | 5 | 2 | 4 |
| 3 (kill OFF) | 4 | 4 | 7+2 pending | 2 | 6 |
| 4 | 5 | 5 | 9+5 pending | 4→5 | 8 |

Final: 14 completed, 5 activations across 5 DISTINCT candidates/policies,
13 decisions (12 ELIGIBLE + 1 DISABLED). The 7 non-activating ELIGIBLE
evaluations are idempotent re-evaluations of already-active candidates
(`alreadyActivated`, zero new rows) — verified by distinct-count query.
Steady state converges to no-op re-sweeps: correct. No duplicate
activation, no stuck lease, no queue corruption, no audit gap.

## 4. Restart Recovery

Cycle 1: job enqueued → runtime stopped → fresh runtime on the same schema
started → pending job processed → activation occurred exactly once, no loss,
no duplication, decisions intact. Matches the dbtest restart proof on a
live runtime.

## 5. Duplicate Delivery

Same owner+scope+hour enqueued twice per cycle: second returns
`deduplicated` (pg-boss singleton); where both executed (cross-hour test in
31.1), the controller bounds to one activation. Zero duplicate activations
across the soak (5 rows / 5 candidates).

## 6. Kill Switch

Cycle 2 with kill ON: reconcile found 0 pairs (join excludes disabled),
nothing enqueued, nothing executed, activations flat. Cycle 3 re-enabled:
normal evaluation resumed. One DISABLED decision journaled from an
in-flight evaluation crossing the flip — proving execution-time (not
enqueue-time) enforcement.

## 7. Stale State

Covered by 31.1 reread proof (post-enqueue flip → DENY) plus soak cycle 2/3
transitions executing against live config. Payload never overrides DB.

## 8. Retry/DLQ

Poison job (`soak.poison`, always-transient): attempt logs show retry at
~2s intervals per test config, then terminal DLQ row retained
(`dlqJobs: 1`, failed: 1). DENY is never retried (13 decisions, 0 retries
of evaluations). Permanent classification unit-pinned in 31.1.

## 9. Multi-Owner

10-owner independence proven in 31.1 dbtests (10/10 isolated activations);
soak ran single-owner by design (resource observation). No cross-owner
execution observed anywhere (0 foreign activations across all phases).

## 10. Stability

Minutes-scale soak (not days — claimed modestly): mem 233→239MB flat,
connections 2–5 flat, no error beyond controlled poison, no log growth
anomaly. Queue drained to 1 created (in-flight at sample end) + poison
failed-row; nothing wedged. Long-duration (multi-day cron) behavior is
inferred from statelessness (no in-memory state to leak), not measured.

## 11. Observability

Operator queries (all existing surfaces):
- pending/retried/DLQ: `select state,count(*) from pgboss.job group by state`
  (+ `<queue>.dlq` via same table); DLQ count verified live.
- denials/failures/activations: `autonomy_decisions` by user (code+reason);
  verified 12 ELIGIBLE + 1 DISABLED live.
- last execution/activation: same journal + `policy_activations`.
Limitation (carried): no push alerts, no dashboard — polling + logs.

## 12. Failures

| Failure | Observed | Expected | Recovery | Integrity | Impact |
|---|---|---|---|---|---|
| Kill flip mid-flight | DISABLED deny | deny | re-enable resumes | intact | none |
| Worker restart with pending | processed once post-restart | same | automatic | intact | none |
| Duplicate delivery | collapsed/no-op | same | automatic | intact | none |
| Transient ×4 | 3 retries + DLQ | same | operator inspects DLQ | intact | none |
| Driver argv bug (soak script) | 0 cycles ran | n/a (harness, not product) | fixed, rerun | n/a | none |

## 13. Test Results

Tree unchanged since 31.1 verification: tsc clean (re-run); unit 740/741,
DB 346/347+flake-rerun, scheduler 10/10+23/23, api 37+1skip, CI 231/1/3 —
all stand. Soak adds operational (non-suite) evidence above; no new suites
needed (all behaviors already suite-pinned).

## 14. Remaining Limitations

- Soak duration is minutes, not days/weeks (statelessness argument covers
  the gap analytically, not empirically).
- Single-owner soak; multi-owner proven in dbtests, not in soak.
- Non-binding budgets in soak (100/day) — binding budgets proven in dbtests.
- DLQ reprocessing is manual inspection (no auto-replay; by design).

## 15. Operational Readiness

The scheduler operates repeatedly and recovers safely under kill flips,
restarts, duplicates, stale state, retries, and DLQ exhaustion, with flat
resources and complete audit. **SOAK PASSED.** No code changes resulted;
proceed to release-candidate preparation.
