# Phase 31 — Durable Autonomous Scheduler

## 1. Purpose

The scheduler answers only WHEN to ask the bounded-autonomy controller whether
anything may activate. It owns no eligibility, no policy judgment, no
experiments, no budgets. One mechanism: discover due (owner, scope) pairs,
enqueue a durable `autonomy.evaluate` pg-boss job per pair, and at execution
reread authoritative state and invoke the canonical Phase 29.4 controller.

## 2. Architecture

```
node-cron tick (6h, trigger-only) ──┐
human review → approved_for_future ──┼──▶ enqueueAutonomyEvaluation
                                     │
                                     ▼
                          pg-boss `autonomy.evaluate` (durable)
                                     │
                                     ▼
                    handler: reread + executeAutonomousActivation
                             (canonical 29.4 controller, per-owner tx lock)
                                     │
                    ┌────────────────┴───────────────┐
                    DENY                             ALLOW
                    complete + journal               29.3 activation service
                    (no retry)                       + journal
```

Files: `server/content/autonomy/job.ts` (job type, handler, enqueue, keys),
`server/content/autonomy/scheduler.ts` (reconcile scan, cron, approval hook);
wiring in `server/jobs/bootstrap.ts` + `server/index.ts`; hook in
`server/content/experimentation/routes.ts` (review endpoint).

## 3. Scheduler Responsibilities

- Discover due pairs: automation-enabled owners × scopes holding
  `approved_for_future` candidates (`findDueAutonomyPairs`, one join).
- Enqueue durable jobs with deterministic idempotency keys.
- At execution: reread state (implicitly — the controller reads fresh on
  every call), invoke `executeAutonomousActivation`, log the outcome.
- Classify unexpected errors as transient (retry); complete on DENY.

## 4. Non-Responsibilities

Eligibility, evidence evaluation, guardrails, budgets, cooldown, churn,
oscillation, breaker decisions, rollback decisions, experiment
creation/selection/assignment, variant choice, policy invention, RL/bandits,
self-modification, config mutation. The scheduler cannot do these: it holds
no code paths for them (statically tested).

## 5. Job Model

Type `autonomy.evaluate` (registered idempotently in `registerRuntimeJobs`).
Payload (strict zod): `{ ownerId, targetScope, correlationId, candidateId? }`
— durable identifiers only. Queue: retryLimit 3, retryDelay 300s, backoff,
expire 900s, singleton 3600s, DLQ `autonomy.evaluate.dlq`. Envelope carries
jobId/correlationId/idempotencyKey/attempt per the existing registry.

## 6. Lease Model

Two cooperating layers, no new tables:
1. **Enqueue lease (pg-boss singleton):** idempotency key
   `autonomy-evaluate:<owner>:<scope>:<sweep|candidate>:<UTC-hour>` collapses
   duplicate producers within the window (best-effort, queue-level).
2. **Execution lease (controller):** the existing per-owner
   `SELECT … FOR UPDATE` on `autonomy_configs` serializes concurrent
   executions; budgets/cooldown deny the losers deterministically.
No process memory, no in-memory mutex, in the correctness path.

## 7. Authoritative State Re-read

The handler passes only identifiers; `executeAutonomousActivation` re-runs
`evaluateActivationEligibility` on a fresh transaction holding the owner lock.
Mode, flags, breaker, budgets, scope, candidate, evidence, evaluations are all
read at execution time. Payload scope mismatch or vanished candidate completes
quietly as stale (the correct scope's sweep covers moves).

## 8. Controller Invocation

Exactly one call: `executeAutonomousActivation(db, ownerId, candidateId)`.
No `evaluateScheduledEligibility` or any duplicate controller exists
(statically tested). Rollback is NOT scheduler-driven (no metric-signal
source); it remains manual + controller-internal.

## 9. Idempotency

- Creation: deterministic hourly keys (§6); re-enqueue in-window returns
  `deduplicated: true`, no new job.
- Execution: at-most-one activation per owner/window enforced by controller
  budgets + tx lock; `alreadyActivated` + identity keys journal dedup.
- No `Math.random()` in any correctness path (statically greppable;
  test seeds use randomness only for unique labels, never keys).

## 10. Retry Semantics

- DENY (any gate code) → complete, logged. Never retried: denial reasons
  (kill switch, mode, flags, breaker, evidence, guardrails, budget, cooldown,
  churn, oscillation) do not self-heal within a retry window — except budget/
  cooldown windows, which the NEXThour's fresh job re-evaluates.
- Unexpected throw → `JobFailure.transient` → pg-boss retry/backoff → DLQ on
  exhaustion. Safe: activation commits only inside the controller transaction,
  so a throw means nothing committed.
- `retry != regenerate`: retries re-execute the same candidate evaluation,
  never a new lineage. `unknown != failed`: no external calls exist in this
  path (activation is DB-only); publication reconciliation semantics untouched.

## 11. Crash Recovery

- Before lease/enqueue: nothing durable yet; next tick re-discovers.
- After enqueue, before execution: pg-boss persists the job; restart recovers
  it (tested: stop → fresh runtime → processed).
- During controller: tx rollback on crash → no partial state; retry or next
  tick re-evaluates.
- After activation, before response: activation committed + journaled;
  re-execution denies (consumed budget / already-activated).
- Leases: pg-boss expiry reaps stuck executions; no permanent locks (no
  custom lock table to wedge).

## 12. Concurrency

10 simultaneous same-owner/same-scope triggers → per-owner lock serializes;
budgets deny losers; at most one activation; every execution journaled
(tested). Same owner/different scopes proceed independently. Different owners
never interact (owner-scoped rows + lock). Phase 29.4 locking untouched.

## 13. Backpressure

Bounded fan-out: one job per (owner, scope) pair per hour; sweep caps at 25
candidates per execution. pg-boss queue absorbs bursts; per-owner
serialization + budgets act as the valve. One failing pair never stops the
sweep (per-pair try/catch, counted). No unbounded in-process work: the cron
only enqueues; workers are pg-boss's pool.

## 14. Security

- No HTTP endpoint triggers the scheduler (internal producers only).
- Owner identity is server-side (reconcile reads DB; hook uses the reviewed
  row's owner). Payloads are hints; the controller re-verifies candidate
  ownership; cross-owner jobs deny.
- Strict payload schema rejects smuggled objects at enqueue AND execution.
- Agent tier has no reference to the scheduler (statically tested).
- Kill switch/mode/flags/breaker all enforced at execution regardless of how
  the job was created — a forged enqueue still denies.

## 15. Agent Boundary

Agent × Scheduler × Controller: the agent has no tool reaching
`autonomy.evaluate`, its registration, or its producers (static test scans
every non-test agent file). The agent may drive approved human workflows as
before; autonomous execution remains scheduler+controller gated.

## 16. Observability

- Worker logs per execution (owner/scope/candidate/attempt/allowed/code).
- Every evaluation journals to `autonomy_decisions` (existing, queryable per
  owner with machine-readable codes).
- Reconcile tick logs pairs/enqueued/deduplicated/failed counts.
- pg-boss job/DLQ tables answer pending/stuck/retry questions with existing
  tooling. No new platform.

## 17. Failure Modes

| Failure | Outcome | Recovery | Audit |
|---|---|---|---|
| Kill/mode/flag/breaker off | DENY, complete | human reconfigures | decision row |
| Weak evidence / regressed guardrail | DENY, complete | new evidence/fix | decision row |
| Budget/cooldown hit | DENY, complete | next window's job | decision row |
| Cross-owner payload | DENY (unknown state), complete | n/a | decision row |
| Stale/moved candidate | complete as stale | owning sweep | log line |
| DB/boss down mid-run | transient throw → retry → DLQ | operator + next tick | job + DLQ |
| Worker crash | tx rollback; pg-boss redelivers or expires | restart | decision on re-run |
| Duplicate delivery | singleton collapse or controller deny | — | dedup flag / decision |

## 18. Operational Controls

- `DISABLE_CRON=1` or `DISABLE_AUTONOMY_SCHEDULER=1` stops the tick
  (in-flight jobs still execute — they re-check the kill switch).
- Kill switch / pause / breaker behave exactly as in 29.4 (scheduler adds
  no bypass, no reset path).
- Human 29.3 activation and config endpoints unaffected.
- Graceful shutdown: cron stopped first, then pg-boss graceful stop (30s
  drain) — existing handler.

## 19. Testing

`scheduler.test.ts` (10 unit/static) + `scheduler.dbtest.ts` (20 proofs
against real pg-boss + real controller): durable creation, sweep activation,
kill/mode/flag/breaker/evidence/guardrail DENYs, budget, cooldown,
cross-owner, dedup, 10-way race, scope independence, restart recovery, stale
handling, retry classification, reconcile dedup, human-activation regression.
Full matrix (final tree): tsc clean; build clean; unit **740/741**
(1 macOS-speech env skip); DB **346/347** full-serial with the one
`visualPublication` timing flake re-proven transient (9/9 alone on the same
DB, both trees; pre-existing class, lease path untouched by this phase);
E2E `[api]` **37 passed + 1 env-skip**; CI browser gate runs on push.

## 20. Limitations

- Hourly idempotency window: two genuinely distinct same-scope evaluations
  within one hour collapse (sweep covers both via listing; acceptable).
- Rollback is not scheduler-driven (no signal source by design).
- Reconcile scans the configs table every 6h (tiny table; no index needed).
- pg-boss retention is platform-default (no custom archive config — same as
  all existing job types).

## 21. Runbook

- "Is the scheduler running?" — tick log lines every 6h; `isAutonomySchedulerRunning()` in-process.
- "Pending/stuck?" — `pgboss.job` + `autonomy.evaluate.dlq` counts.
- "Why denied?" — `autonomy_decisions` latest row for the owner (code+reason).
- "Breaker opened by scheduler flow?" — same journal; reset ONLY via human
  reset endpoint.
- "Stop everything now" — disable autonomy (kill switch) → in-flight and
  future evaluations deny; `DISABLE_AUTONOMY_SCHEDULER=1` + restart stops the
  tick.
- "Replay a missed window" — enqueue via `enqueueAutonomyEvaluation`
  (server console) or wait for the next tick; never hand-edit policies.
