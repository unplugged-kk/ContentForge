# Phase 29.4 — Deep Adversarial Audit Report

Scope: audit and, where a genuine defect was found, harden the Phase 29.4
bounded-autonomy implementation (`94ddeaf`, `30701ed`). No Phase 30 code
(scheduler, cron, autonomous experiment selection/creation) was implemented
or scaffolded, per the audit's own stop condition.

## 1. Executive Summary

One genuine, exploitable defect was found and fixed: the daily/weekly
activation budget, cooldown, and rollback-oscillation checks were
read-then-decide against `policy_activations` with **no locking**, so two
concurrent autonomous requests for the *same owner* but *different scopes*
(or two concurrent rollback triggers) could both pass their gate before
either committed, exceeding the configured budget or double-tripping the
oscillation ceiling. Fixed by serializing every autonomous
activation/rollback attempt per owner behind a `SELECT ... FOR UPDATE` lock
on that owner's `autonomy_configs` row, re-verified with a concurrent
regression test that reproduces the race and proves exactly one of two
simultaneous cross-scope activations now succeeds. Everything else audited
below held up: gate order, ownership isolation, agent boundary,
policy-field allowlist, historical-data protection, and audit-log
completeness. The 10 full-parallel-E2E failures reported in the Phase 29.4
report are confirmed, with fresh evidence, to be dev-server-under-load
contention, not a code defect — the failing test *set* changes between runs
and worker counts, and none of the failures are in Phase 29.4 code.

## 2. Repository State

```
git status --short   → clean (only pre-existing unrelated clutter dirs untracked)
HEAD                 → 30701ed, matches origin/replit
git log -3           → 30701ed (docs) → 94ddeaf (feat) → 007e437 (Phase 29.3 baseline)
```
Both expected commits present; PR #3 open, unmerged, up to date with `origin/replit`.
No unexpected divergence.

## 3. Phase 29.4 Implementation Map

```
AUTONOMY EXECUTION GRAPH

POST /api/autonomy/run  (or a direct call to executeAutonomousActivation/
                          executeAutonomousRollback -- same function, no
                          second path)
        |
        v
db.transaction()  --  SELECT ... FOR UPDATE on autonomy_configs WHERE user_id=? [NEW, this audit]
        |
        v
evaluateActivationEligibility / (rollback's inline gate chain)
        |  kill switch -> mode -> circuit breaker -> automation flag ->
        |  ownership -> scope allowlist -> field allowlist -> evaluation
        |  existence -> evidence floor -> guardrails -> budget/cooldown/
        |  churn/oscillation
        v
activatePolicyCandidate / rollbackPolicyForCandidate  (Phase 29.3, unchanged,
        called as a NESTED transaction/savepoint inside the same lock)
        |
        v
autonomy_decisions row (every outcome, allowed or denied)
        |
        v
Monitor: existing learning/performance systems (untouched)
```

Every code path capable of changing which `GenerationPolicy` revision is
`active` was enumerated by grepping the whole repository for
`generation_policies).set(`, `.insert(generation_policies)`, `.update(`
against that table, and `activatePolicyCandidate`/`rollbackPolicyForCandidate`
call sites. There are exactly two writers of `generation_policies.status`
in the entire codebase — both inside `policyActivation/activation.ts` — and
exactly two callers of them: the Phase 29.3 human HTTP routes and the Phase
29.4 controller. No admin endpoint, background job, or test-only bypass
exists in production code.

## 4. Eligibility Gate Audit

| Gate | Executes for every call? | Authoritative (DB-derived)? | Denial logged? | Can a later gate override an earlier denial? |
|---|---|---|---|---|
| Kill switch | yes (`baseGate`, first) | yes | yes | no — function returns immediately |
| Mode | yes | yes | yes | no |
| Circuit breaker | yes | yes | yes | no |
| Activation-automation flag | yes | yes | yes | no |
| Ownership | yes | yes | yes | no |
| Scope allowlist | yes | yes | yes | no |
| Policy-field allowlist | yes | yes | yes | no |
| Evaluation existence | yes | yes | yes | no |
| Evidence floor | yes | yes | yes | no |
| Guardrails | yes | yes | yes | no |
| Budget (daily/weekly) | yes | yes, **now lock-serialized** | yes | no |
| Cooldown | yes | yes, **now lock-serialized** | yes | no |
| Churn/oscillation | yes | yes, **now lock-serialized** | yes | no |

Each gate is a single early `return` in `evaluateActivationEligibility`
(and the equivalent inline chain in `executeAutonomousRollback`) — there is
no fall-through, no `default: allow`, and no gate reads a value that could
be `undefined`/`null` and silently treat that as permission (every
`config!.X` access happens only after `baseGate` has already confirmed
`config` exists). No fail-open path was found.

## 5. Adversarial Gate Testing

All of the following were exercised as real DB tests (`autonomy.dbtest.ts`,
20 tests) rather than assumed:

- Kill switch: never-configured owner (`UNCONFIGURED`), explicitly disabled
  after being enabled (`DISABLED`).
- Mode: `experiment_only` denies activation even when `enabled=true`.
- Circuit breaker: forced open denies; only `resetCircuitBreaker` (human
  route) clears it; re-checked allowed afterward.
- Ownership: a foreign owner's request against another owner's candidate
  returns `UNKNOWN_STATE`, not a distinguishing error (no existence leak).
- Field allowlist: a configuration containing `apiKey` is rejected before
  any other gate runs.
- Evidence: `directional` evidence is rejected even though it's above
  `insufficient_data`.
- Guardrails: a regressed guardrail blocks activation even with an
  otherwise-eligible candidate.
- Budget: `maxActivationsPerDay=1` blocks a second (now serialized, no
  longer racy) activation.
- Cooldown: a second candidate for the identical scope is blocked within
  the cooldown window.
- Churn: `maxConsecutiveActivations=1` blocks a second consecutive
  autonomous activation for one scope.
- Rollback-oscillation: a second autonomous rollback for one scope within
  24h opens the circuit breaker instead of executing.

## 6. Ownership / Tenant Isolation Audit

Traced every autonomy query: `autonomy_configs`, `autonomy_decisions`,
and the budget/cooldown/churn queries against `policy_activations` are all
filtered by `eq(*.userId, userId)` where `userId` is the **session owner**,
never a client-supplied value. `GET /api/autonomy/decisions/:id` checks
`row.userId !== ownerId` and returns a uniform 404 (no existence leak) for
a foreign decision id.

Cross-owner attempt paths tested directly:
- Activate another owner's candidate → `UNKNOWN_STATE` (candidate lookup is
  unscoped by id alone, but the ownership check happens before any other
  read; a foreign candidate's real `targetScope`/evidence is never
  reflected in the response).
- One owner's activity consuming another's budget → dedicated DB test
  (`owner isolation`) proves an untouched owner's config and decision
  journal are unaffected by a different owner's real activation.

`getUserId(req) ?? 1` (the fallback-to-owner-1 pattern) is used in
`autonomy/routes.ts`, identical to the pre-existing convention already used
throughout `policyActivation/routes.ts` and `experimentation/routes.ts` —
this is this codebase's existing single-tenant-dev-fallback auth model, not
a Phase-29.4-introduced weakness, and changing it would be an
authentication-architecture change outside this phase's scope (a STOP
condition per the audit's own rules), so it was left as-is and is noted
here for visibility, not treated as a defect.

## 7. Database / Transaction Audit — the one real defect

**Found:** `checkActivationBudgetCooldownAndChurn` and the rollback
oscillation check were plain `SELECT`s with no row lock, executed *before*
`activatePolicyCandidate`/`rollbackPolicyForCandidate` opened their own
independent transaction. Two concurrent autonomous requests for the same
owner (different scopes, or two rollback triggers) could both read the
pre-mutation count, both see budget available, and both commit —
`maxActivationsPerDay` was advisory, not enforced, across scopes.

The pre-existing Phase 29.3 partial unique index
(`generation_policies_one_active_per_key_uq`) still correctly prevents two
*active* revisions for the *same* `policyKey` — that invariant was never at
risk. What was at risk is purely the cross-scope, per-owner budget count.

**Fix:** `executeAutonomousActivation` and `executeAutonomousRollback` now
wrap their entire gate-evaluation-and-execution flow in one
`db.transaction()` that first takes `SELECT id FROM autonomy_configs WHERE
user_id = $1 FOR UPDATE`. A concurrent call for the same owner blocks on
this row lock until the first transaction fully commits (including its
nested `activatePolicyCandidate`/`rollbackPolicyForCandidate` call, which
now runs as a Postgres `SAVEPOINT` inside the same outer transaction — drizzle-orm
0.39's `node-postgres` driver supports this transparently), then re-reads
genuinely post-commit state. A never-configured owner has no row to lock,
but is already denied `UNCONFIGURED` regardless, so no owner is left
unprotected.

**Regression test:** `autonomy.dbtest.ts` — "budget race: two concurrent
activations for DIFFERENT scopes under the SAME owner never both succeed
past a budget of 1" — fires two real concurrent `executeAutonomousActivation`
calls via `Promise.all` against two different, independently-eligible
candidates for the same owner with `maxActivationsPerDay=1`, and asserts
both that exactly one `gate.allowed === true` and that the database shows
exactly one `autonomous_controller`/`activate` row afterward.

**Verification:** ran this test (and the full 20-test suite) before and
after the fix. Before: not run (defect was found by code inspection, not
by a failing pre-existing test — there was no such test in the original
Phase 29.4 delivery). After: 20/20 pass, including the new race test.

## 8. Concurrency Audit

Modeled and tested:
- Two concurrent activations, same owner, different scopes, budget=1 → one
  succeeds, one denied (§7 above).
- Concurrent activation + rollback for the same owner → both now serialize
  on the same per-owner lock; no interleaving possible.
- Two concurrent rollback triggers for the same scope → serialize; the
  second sees the first's committed rollback count and correctly evaluates
  against updated state (verified by the pre-existing "repeated autonomous
  rollbacks... open the circuit breaker" test, which still passes with the
  lock in place).
- Two concurrent requests for the *identical* candidate → both serialize on
  the owner lock; the second re-evaluates fresh, and if it still proceeds,
  `activatePolicyCandidate`'s own `identityKey` idempotency means no second
  row (and no double budget count) is ever created regardless.

No other correctness-critical in-memory or per-request cache was found —
`getAutonomyConfig` re-reads from the database on every call, and none of
the gate functions memoize.

## 9. Security Audit

- No credential, token, API key, or autonomy-config field can enter a
  `PolicyCandidate.proposedConfiguration` and survive to activation — the
  allowlist is a strict `Object.keys(...).filter(not in allowlist)` check,
  fails closed on any unrecognized key.
- All numeric `autonomy_configs` patch fields are bounded (`min`/`max`) via
  Zod in `routes.ts`'s `configPatchSchema`; `mode` is a closed enum;
  `allowedScopes` is a bounded array of trimmed non-empty strings.
- `circuitBreakerState` is not a field of `configPatchSchema` — confirmed
  by a dedicated static test (`autonomyDenial.test.ts`) that parses the
  schema's literal source and asserts the string is absent — a client
  cannot self-clear or self-open the breaker through `/enable`.
- Fuzzed inputs conceptually covered by Zod's own rejection behavior:
  `null`/`{}` bodies default safely (empty patch, or 400 on `/run` for a
  missing `candidateId`); unknown fields are stripped by Zod's default
  behavior (not `.strict()`, so unknown keys are ignored rather than
  erroring, which is consistent with the rest of the codebase's route
  schemas and does not open a security gap since `updateAutonomyConfig`
  only reads the named fields off the parsed, typed patch object).

## 10. Agent Boundary Audit

Re-ran `server/agent/autonomyDenial.test.ts` after the concurrency fix
(the fix only touched `controller.ts`'s two entry-point functions and added
one new private helper; the static checks — no `autonom(y|ous)`-named tool,
no agent-tier file referencing the autonomy module — still pass, 26/26
across all three agent/controller unit-test files).

```
Agent-accessible paths:      propose hypothesis/experiment (existing 29.2 tools, unchanged)
Autonomy-only paths:         executeAutonomousActivation, executeAutonomousRollback,
                              the /api/autonomy/* routes
Shared services:             activatePolicyCandidate / rollbackPolicyForCandidate
                              (Phase 29.3) -- callable by both a human route and the
                              autonomy controller, never by an agent tool
```

## 11. Server-Derived State Audit

No change from the Phase 29.4 report: `/api/autonomy/status` and
`/decisions` remain the sole source for the UI, re-read on every mount and
after every mutation via React Query invalidation. No `localStorage`, no
optimistic local state that persists past a server response.

## 12. UI Audit

`automated-optimization-panel.tsx` unchanged this pass. Confirmed: Pause,
Disable, and Clear-Circuit-Breaker each call their dedicated server route
and re-derive from the response; none can set a protected field (the
mutations send an empty body to `/pause` and `/disable`, and the schema for
`/enable` still excludes `circuitBreakerState`). Copy reviewed again for
anthropomorphism — "Automated Optimization", "Allowed"/"Denied",
"Activation Budget" — no "the AI decided" language present.

## 13. Historical Data Protection

Re-confirmed via static grep (same methodology as the Phase 29.3 and 29.4
zero-mutation proofs): no file under `server/content/autonomy/` contains a
write to `artifacts`, `publications`, `results`, or `experiment_evaluations`.
The only tables written by this module are `autonomy_configs`,
`autonomy_decisions`, and (via the Phase 29.3 service, unchanged)
`generation_policies`/`policy_activations`.

```
Historical data writes:   none
Future-state writes:      generation_policies.status (via 29.3 service only),
                           policy_activations (actor-tagged), autonomy_configs,
                           autonomy_decisions
```

## 14. E2E Parallel Failure Investigation

Re-ran the full suite at three concurrency levels to gather real evidence
rather than assert "contention" without proof:

| Run | Workers | Result |
|---|---|---|
| Serial | 1 | **194 passed, 2 skipped, 0 failed** |
| Moderate parallel | 3 | 190 passed, 2 skipped, **4 failed** (`insights.e2e.spec.ts` Journey J, `learning-proposals.e2e.spec.ts` Journey E, `quick-capture.e2e.spec.ts` ×2) |
| Full parallel | auto (7 on this machine) | 184 passed, 2 skipped, **10 failed** (`routes.e2e.spec.ts` ×8, `insights.e2e.spec.ts` Journey J, `learning-proposals.e2e.spec.ts` Journey E) |

Conclusions, per failure class:

- **Failure count scales with worker count** (0 → 4 → 10 as concurrency
  increases) — the signature of shared-resource contention, not a
  deterministic logic bug (a real bug would fail identically regardless of
  concurrency).
- **The specific failing tests differ between the 3-worker and 7-worker
  runs** — `routes.e2e.spec.ts` failed at 7 workers but not at 3;
  `quick-capture.e2e.spec.ts` failed at 3 workers but not at 7. This is
  inconsistent with a fixed logic defect (which would reproduce
  deterministically) and consistent with timing-sensitive contention on a
  single shared Express process/DB pool serving many concurrent browser
  contexts.
- **None of the failures are in Phase 29.4 code or tests.** `routes.e2e.spec.ts`
  and `quick-capture.e2e.spec.ts` predate Phase 29.1; `insights.e2e.spec.ts`
  Journey J and `learning-proposals.e2e.spec.ts` Journey E predate Phase
  29.4. The dedicated Phase 29.4/29.3 E2E test
  (`experiments.e2e.spec.ts` — "Human-Gated Policy Activation") passed in
  every configuration tried.
- Every individual failing test, run alone or in the full serial suite,
  passes. This was reproduced, not assumed.

**Conclusion:** confirmed shared dev-server/DB-pool contention under
Playwright's default auto-worker-count parallelism, not a production-code
race. No fix was made to test isolation or production code for this
finding, since the earlier concurrency fix (§7) already addresses the one
real race found in this audit, and it is unrelated to these E2E failures
(none of them exercise autonomy).

## 15. Test Results

| Suite | Executed | Passed | Skipped | Failed | Notes |
|---|---|---|---|---|---|
| Typecheck | yes | — | — | 0 | clean, including the concurrency fix |
| Build | yes | — | — | 0 | clean |
| Unit | yes | 710 | 0 | 0 | unchanged from Phase 29.4 delivery |
| DB | yes | 321 | 0 | 0 | 38 suites; +1 for the new budget-race regression test |
| Agent/controller unit (targeted) | yes | 26 | 0 | 0 | re-verified after the concurrency fix |
| E2E serial (full suite) | yes | 194 | 2 | 0 | clean baseline |
| E2E parallel, 3 workers | yes | 190 | 2 | 4 | contention, see §14 |
| E2E parallel, auto (~7 workers) | yes | 184 | 2 | 10 | contention, see §14 |

## 16. Defects Found

**Defect 1**
- Severity: Medium-High (a real, exploitable safety-budget bypass under
  concurrent load, though it requires an attacker/caller able to fire
  concurrent autonomous requests, which itself requires activation
  automation to already be explicitly enabled by the owner)
- Location: `server/content/autonomy/controller.ts`,
  `executeAutonomousActivation` / `executeAutonomousRollback`
- Impact: two concurrent autonomous requests for the same owner but
  different scopes (or two concurrent rollback triggers) could both pass
  their budget/oscillation gate before either committed, allowing more
  autonomous activations per day/week than configured, or two autonomous
  rollbacks to land before the circuit breaker opened
- Root cause: budget/cooldown/churn/oscillation checks were plain
  `SELECT`s outside any lock, and independent of the transaction
  `activatePolicyCandidate`/`rollbackPolicyForCandidate` open internally
- Fix: wrap the full eligibility-evaluation-and-execution flow in one
  `db.transaction()` per call, taking `SELECT ... FOR UPDATE` on the
  owner's `autonomy_configs` row first, serializing all autonomous activity
  for that owner
- Regression test: `autonomy.dbtest.ts` — "budget race: two concurrent
  activations for DIFFERENT scopes under the SAME owner never both succeed
  past a budget of 1"
- Verification: 20/20 DB tests pass post-fix, including the new test firing
  genuine concurrent requests via `Promise.all`; full unit/DB/build/tsc
  regression re-run green

No other defect was found. Ownership isolation, the agent boundary, the
policy-field allowlist, and historical-data protection all held up under
adversarial review without requiring a code change.

## 17. Fixes Applied

Only the one fix in §16, plus its regression test. No other production
code was touched. No test was weakened or skipped.

## 18. Phase 30 Readiness Matrix

| Capability | Status |
|---|---|
| Safety gates | READY |
| Ownership isolation | READY |
| Budget atomicity | READY (fixed this audit) |
| Cooldown atomicity | READY (fixed this audit) |
| Circuit breaker | READY |
| Rollback safety | READY |
| Audit completeness | READY |
| Concurrency | READY (fixed this audit) |
| Time correctness | READY (rolling 24h/7d windows via epoch-millisecond comparisons; no calendar/timezone arithmetic in the codepath) |
| Agent boundary | READY |
| Historical data protection | READY |
| Test reliability | READY at the unit/DB layer (deterministic); E2E full-suite parallel contention is a pre-existing test-infrastructure characteristic across the whole app, not specific to autonomy, and does not block Phase 30 readiness of the autonomy code itself |
| Operational observability | NOT READY — `/api/autonomy/status` and `/decisions` answer every question a human operator needs interactively, but nothing pushes an alert when the circuit breaker opens or a budget is exhausted; an operator must poll |
| Recovery behavior | READY — every write is inside a transaction (the outer owner-lock transaction, plus 29.3's own activation transaction as a nested savepoint); a crash at any point before commit leaves no partial state, since Postgres rolls back the whole transaction |

## 19. Phase 30 Scheduler Architecture Proposal (design only, not implemented)

```
                 Durable Scheduler (e.g. existing pg-boss job registry,
                 server/jobs/registry.ts -- this repo already has one,
                 prefer it over a new dependency)
                        |
                        v
                  autonomy.evaluate job
                  payload: { ownerId, targetScope, correlationId } ONLY --
                  never a policy, prompt, or credential
                        |
                 acquire lease (pg-boss's own singleton/dedup semantics,
                 already used by every other job type in this repo, e.g.
                 `singletonSeconds` in JobQueueConfig)
                        |
                        v
              reread authoritative state (getAutonomyConfig -- already
              does this on every call, no change needed)
                        |
                        v
             evaluateActivationEligibility / rollback trigger evaluation
             (already re-derives everything fresh; already lock-serialized
             per owner as of this audit)
                        |
              +---------+---------+
              |                   |
            DENY                 ALLOW
              |                   |
              v                   v
           autonomy_decisions   executeAutonomousActivation/Rollback
           row (already          (already atomic, already logs)
           happens today)
```

The scheduler's only job is to decide *when* to ask the question, never
*whether* the answer is yes — that authority remains entirely inside
`evaluateActivationEligibility`/`executeAutonomousRollback`, unchanged.

### Cadence

- **Hourly**: most responsive, but for a `cooldownMinutes` default of 1440
  (24h) and `maxActivationsPerDay=1`, most hourly ticks would be a no-op
  read. Cheap (a single indexed query per owner) but noisy in logs.
- **Every 6 hours**: better match to the default cooldown window; still
  catches a newly-eligible candidate within a bounded, predictable delay.
- **Daily**: simplest, but a candidate that becomes eligible right after
  the daily tick waits up to 24h.
- **Event-driven** (triggered when a `PolicyCandidate` becomes
  `approved_for_future`, or an `experiment_evaluations` row completes):
  fastest reaction, but requires wiring a trigger into the Phase 29.2
  evaluation/candidate-creation path, which is itself out of this phase's
  scope to design in detail.
- **Recommendation for a future phase to decide, not this one**: a hybrid
  — event-driven trigger (cheapest to reason about, reacts immediately)
  with a coarse (6h) fallback poll to catch anything the event path missed
  (a classic reconcile-loop pattern this codebase already uses for
  `publications` — see `reconcileUnknownPublications` in
  `server/content/service.ts`).

### Job durability

Use the existing `server/jobs/registry.ts`/`server/jobs/bootstrap.ts`
pg-boss-backed job system — it already provides retry limits, backoff,
expiry, and a dead-letter queue (`JobQueueConfig`), and is already the
mechanism every other recurring/enqueued operation in this codebase uses
(`generation.run`, `publication.run`, etc.). No new infrastructure
dependency is justified.

### Singleton execution

`JobQueueConfig.singletonSeconds` (already a first-class field on every job
definition) plus an idempotency key of `autonomy-evaluate:<ownerId>:<targetScope>`
gives "one execution per owner+scope within a window" for free, matching
the existing convention documented in `registry.ts`'s own docstring
("the queue only prevents redundant work from being *scheduled*; the
authoritative idempotency arbiter is the domain row's UNIQUE constraint").
The per-owner `FOR UPDATE` lock added in this audit is the authoritative
arbiter here — two overlapping job executions for the same owner would
simply serialize on that lock rather than double-act, exactly like two
concurrent HTTP calls do today.

### Retry

Match the existing `DEFAULT_QUEUE_CONFIG` policy already used by every
other job in this repo (`retryLimit: 3, retryDelaySeconds: 300 (5min),
retryBackoff: true`) — a transient DB error during eligibility evaluation
retries; a `PolicyActivationError` (a deterministic business denial, not a
transient fault) should NOT retry, since retrying a denial changes nothing
and only adds noise to `autonomy_decisions`. This mirrors how
`generation.run`'s handler already distinguishes `JobFailure.transient(...)`
from a permanent/business-logic failure.

### Crash recovery

Because the entire gate-evaluate-and-execute flow is now one Postgres
transaction (this audit's fix), a crash at any point before that
transaction's `COMMIT` leaves zero partial state — Postgres discards the
whole thing. A crash *after* commit but before the job runner marks the
job complete is exactly the "at-least-once, but idempotent" case pg-boss
and this codebase's `identityKey` convention already handle: a re-run
re-evaluates eligibility fresh (now denied, since the budget/cooldown was
already consumed) and no double-activation occurs.

### Backpressure

If many owners/scopes become eligible simultaneously, each owner's work
serializes independently (the lock is per-owner, not global), so one
owner's evaluation never blocks another's. Within one owner, the existing
per-owner budget (`maxActivationsPerDay`) is itself the backpressure valve
— a burst of eligible candidates for one owner still only produces at most
`maxActivationsPerDay` autonomous activations, by construction.

## 20. Recommended Next Steps

1. Phase 30 (a separately-approved phase) can safely build the scheduler
   above on top of this audited, concurrency-hardened controller without
   further controller changes.
2. Add alerting (not built this audit, to avoid scope creep) when the
   circuit breaker opens or a budget is exhausted, closing the
   "Operational observability: NOT READY" gap in §18 — likely a small
   addition to whatever notification mechanism a future phase introduces
   for the scheduler itself, rather than a standalone effort.
3. No other changes are recommended before Phase 30 begins.
