# Phase 29.4 — Final Verification Report

Codename: AUTONOMY WITH GUARDRAILS.

## Pre-flight

- **Server-derived state (§4)**: fixed. Policy Candidate activation state in
  Insights > Learning now comes from `GET /api/policy-candidates/activated-ids`,
  derived from `policy_activations` on every render, not local React state.
  Verified against the existing Phase 29.3 mocked E2E journey (had to add
  stateful mocks for the new endpoint -- see Tests below).
- **Unit test flakes (§5)**: both were the same real bug in
  `today-schedule-state.ts`'s `formatDateBucket` (date-fns' `isToday`/
  `isTomorrow` ignore the injected `now` override). Fixed with `isSameDay`
  against the provided reference date. Confirmed deterministic (not
  timing-flaky) and green across repeated runs post-fix.
- **Baseline (§6)**, run before any Phase 29.4 code was written: `npm run
  check` clean; `npm run build` clean; unit 686/686 after the flake fix (was
  684/686); DB 301/301 (Phase 29.3 baseline, before Phase 29.4 tests
  existed); targeted E2E 34/34; full E2E 203 passed, 2 skipped, 5 did not
  run (pre-existing, unrelated to this phase) on the first parallel pass.

## Architecture

See `docs/phase-29.4-autonomous-optimization-architecture.md` for the full
design. Summary: Observe/Learn/Experiment/Evaluate (29.1/29.2, unchanged) ->
`evaluateActivationEligibility` (every deterministic gate, DB-derived,
logged either way) -> `executeAutonomousActivation`, which only calls the
*existing* Phase 29.3 `activatePolicyCandidate` -> Monitor (existing
learning/performance systems, unchanged) -> `executeAutonomousRollback` on
an explicit safety trigger, calling the existing `rollbackPolicyForCandidate`.

## Autonomy modes

`disabled` (default) / `observe_only` / `recommend` / `experiment_only` /
`bounded_activation`. Only `bounded_activation` + `activationAutomationEnabled=true`
together permit autonomous activation. Verified in
`autonomy.dbtest.ts`: "mode enforcement" and "activationAutomationEnabled=false"
tests.

## Eligibility (every deterministic gate, in the order actually checked)

kill switch (`enabled`) -> mode -> circuit breaker -> activation-automation
flag -> candidate ownership/existence (`UNKNOWN_STATE` if either fails) ->
scope allowlist -> policy-field allowlist -> evaluation existence -> minimum
evidence quality (hard floor `repeatable`, §24) -> guardrails -> daily/weekly
activation budget -> cooldown -> policy churn -> oscillation. Each gate has a
dedicated DB test in `autonomy.dbtest.ts` proving it independently denies
when triggered and does not when it isn't.

## Experiment automation

Architecturally scoped but not implemented this phase (see Remaining
Limitations) -- the eligibility-gate machinery (mode, kill switch, circuit
breaker, budget) is generic and would apply identically to an experiment-selection
gate; building it out and wiring the actual proposal-to-experiment
creation call was deferred to keep this phase's diff focused on the
higher-risk activation/rollback safety surface the spec weights most
heavily (§22-35, §43-53).

## Activation automation

`executeAutonomousActivation` re-runs `evaluateActivationEligibility` (never
trusts a prior check) and, only if still allowed, calls
`activatePolicyCandidate(db, candidateId, userId, reason, "autonomous_controller")`.
The Phase 29.3 service independently re-verifies its own eligibility rules
(ownership, approval status, experiment completion/decision, evidence,
guardrails) -- two independent checks must both pass. Proven end-to-end by
the §45 production-policy test.

## Policy allowlist

`voiceId | templateId | objective | audience | constraints | model` --
exactly the fields Phase 29.3's activation transaction and
`GenerationDeps.activePolicyReader` consume. Anything else (a credential
field, an owner-id field, an autonomy-config field) is rejected server-side
with `FORBIDDEN_FIELD` before the eligibility check even reaches the
evidence/guardrail gates. Unit-tested directly (`controller.test.ts`) and
DB-tested via a candidate with `apiKey` in its configuration.

## Budgets

Daily and weekly activation budgets, both counted fresh from
`policy_activations` per owner (not per scope) on every call. DB-tested:
exhausting `maxActivationsPerDay=1` denies a second candidate's activation
with `BUDGET_EXHAUSTED_DAILY`.

## Cooldown

Per-scope: the most recent event's timestamp for that `policyKey`, compared
against `cooldownMinutes`. DB-tested: two candidates for the identical scope,
second activation denied with `COOLDOWN_ACTIVE`.

## Guardrails

Any `regressed` guardrail in the linked evaluation denies activation
outright, regardless of a positive primary metric -- reuses the exact same
check Phase 29.3 already enforces, evaluated independently by the controller
first. DB-tested.

## Kill switch

`enabled=false` (the default for every owner until explicitly turned on)
denies unconditionally, overriding every other setting. DB-tested both for
a never-configured owner (`UNCONFIGURED`) and for an owner who was enabled
and then explicitly disabled (`DISABLED`).

## Circuit breaker

`circuitBreakerState` on `autonomy_configs`: `closed` (default) / `open`.
Opened only by the controller itself (`openCircuitBreaker`, called on
repeated autonomous rollback for one scope) or a human forcing it for a
test; closed only by the human-only `resetCircuitBreaker`. While open, every
activation attempt is denied with `CIRCUIT_OPEN` regardless of every other
gate passing. DB-tested for both the open-blocks-activation and
only-a-human-clears-it halves.

## Rollback

`executeAutonomousRollback` requires an explicit `RollbackTrigger`
(`GUARDRAIL_BREACH | RELIABILITY_REGRESSION | PUBLICATION_FAILURE_RATE |
MANUAL_SIGNAL` + a reason) -- never a bare confidence judgment. Gates:
enabled, mode, `rollbackEnabled`, ownership, a valid prior revision actually
existing. On success, calls the existing `rollbackPolicyForCandidate` with
`actor: "autonomous_controller"`. A second autonomous rollback for the same
scope within 24h opens the circuit breaker instead of executing (§28) --
DB-tested with two activate/rollback cycles proving the second rollback is
denied with `CIRCUIT_OPENED_OSCILLATION` and the config row shows the
breaker open afterward.

## Agent boundary

Proven statically, zero live AI/DB credentials required:
`server/agent/autonomyDenial.test.ts` scans every declared agent tool name
(none match `autonom(y|ous)`) and every agent-tier source file (none
reference the autonomy controller or config module).

## Server-derived state

Every value the UI shows (`enabled`, `mode`, budgets, cooldown, circuit
breaker state, decision history) is read fresh from
`GET /api/autonomy/status` / `/decisions` on every load -- no client-side
cache of correctness-critical state beyond React Query's normal
invalidate-on-mutation flow. The pre-existing Policy Candidate
activated/rolled-back badge was migrated to the same pattern this phase
(§4).

## Audit trail

Every `evaluateActivationEligibility`/`evaluateRollbackEligibility` call
inserts one `autonomy_decisions` row -- allowed or denied -- with
`decisionType`, `targetScope`, the full chain of foreign keys
(proposal/experiment/evaluation/candidate/previous+new policy), evidence
quality, a JSON `context` snapshot of the gate state actually evaluated, a
machine-readable `code`, and a human-readable `reason`. DB-tested directly:
"every evaluation, allowed or denied, is durably logged."

## Security

Owner isolation is checked at the candidate/ownership layer before any gate
runs (`UNKNOWN_STATE` for a foreign-owned candidate, never leaking whether
it exists). DB-tested with a dedicated cross-owner test proving one owner's
autonomous activity never touches another, never-configured owner's config
or decision journal. No secret ever enters a policy field (the allowlist
structurally excludes them) or an audit row.

## UI

One new card, "Automated Optimization"
(`client/src/components/insights/automated-optimization-panel.tsx`), added
to the existing Insights > Learning surface -- no new navigation
destination. Status badges, budget/cooldown/automation summary, recent
decisions with plain-language reasons, and Pause/Disable/Clear-Circuit-Breaker
controls, all server-derived.

## Accessibility

The panel is rendered unconditionally on `/insights?view=learning`, which is
already in the full-route axe sweep (`e2e/accessibility.e2e.spec.ts`) --
0 violations after adding it (rerun as part of the full suite below). No
new dialogs or focus traps were introduced (Pause/Disable/Reset are plain
buttons with immediate, reversible effect -- no destructive confirmation
needed for a *disable*; re-enabling always requires a fresh, explicit
`/enable` call).

## Responsive

No new route or layout; the card reuses the existing `Card`/`Badge`/`Button`
primitives inside the already 7-viewport-verified `/insights?view=learning`
page (Phase 28.2H baseline).

## Performance

Every gate query is a single, indexed, bounded-limit `SELECT` (`limit(1)`
or `limit(8)`) against `policy_activations`, scoped by `userId`+`policyKey`
via the existing indexes -- no N+1, no full-table scan, no per-request
caching to go stale. `GET /api/autonomy/decisions` is a single paginated
query. No polling loop was introduced anywhere -- the UI fetches on mount
and on mutation, matching the rest of the Insights surface.

## Production safety

Historical `GenerationPolicy` rows, `Artifact`s, `Publication`s, and
`experiment_evaluations` are never written by any code in
`server/content/autonomy/` -- confirmed by the same static-grep methodology
used for the Phase 29.3 zero-mutation proof (no `.update(` or `.insert(`
against any of those tables anywhere in the new module). Only future policy
*resolution* (which revision a new `GenerationJob` defaults to) is affected
by an activation, exactly as in Phase 29.3.

## E2E

The existing Phase 29.3 mocked UI journey
(`e2e/experiments.e2e.spec.ts`) was extended to mock the new
`/api/policy-candidates/activated-ids` and `/api/autonomy/status`/`/decisions`
endpoints so the now-server-derived activate/rollback toggle continues to
work under mocks; re-verified the full activate -> confirm -> flips to
Roll Back -> confirm -> flips back journey plus the scoped axe scan.
A dedicated full autonomous-lifecycle E2E (proposal -> autonomous experiment
-> autonomous activation -> monitor -> autonomous rollback, driven through
the UI) was not built this phase -- the lifecycle is proven at the DB layer
instead (`autonomy.dbtest.ts`'s §45 test and the budget/cooldown/circuit-breaker/rollback
tests), which exercises the real controller and the real Phase 29.3
service against a real database, the same rigor the DB-test suite already
carries for Phase 29.2/29.3.

## Tests

| Suite | Executed | Passed | Skipped | Failed | Notes |
|---|---|---|---|---|---|
| Typecheck | yes | -- | -- | 0 | `npm run check`, clean |
| Build | yes | -- | -- | 0 | `npm run build`, clean |
| Unit | yes | 710 | 0 | 0 | 24 new (`controller.test.ts` gates, `policyFieldAllowlist` cases); the 2 prior date-relative failures are fixed, not skipped |
| DB | yes | 320 | 0 | 0 | 38 suites; 19 new in `autonomy.dbtest.ts`; requires `TEST_DATABASE_URL` + `SESSION_SECRET` |
| Agent negative (unit) | yes | 7 | 0 | 0 | 5 new autonomy-specific + 2 pre-existing Phase 29.3 activation-denial tests |
| E2E targeted (experiments + insights + accessibility, serial) | yes | 34 | 0 | 0 | required extending the Phase 29.3 mock with the new activated-ids/autonomy endpoints |
| E2E full (7 workers, parallel) | yes | 184 | 2 | 10 | all 10 failures in `routes.e2e.spec.ts`/`insights.e2e.spec.ts`/`learning-proposals.e2e.spec.ts` -- identical dev-server contention pattern documented in the Phase 29.2 and 29.3 reports |
| E2E (same 3 files, serial re-run) | yes | 44 | 0 | 0 | confirms contention, not a regression |

An earlier attempt to run `test:db`/E2E without exporting `DATABASE_URL` to
the local Docker test database surfaced two environment-configuration
issues unrelated to this phase's code (the live-DB Phase 29.2 E2E test using
a different `DATABASE_URL` than the raw-SQL pool default it falls back to;
`youtube.oauth.dbtest.ts` requiring `SESSION_SECRET`) -- both resolved by
setting the correct env vars for the run, not by touching test code.

## Final capability-status taxonomy

| Capability | Status |
|---|---|
| Autonomy Configuration | IMPLEMENTED |
| Autonomous Experiment Selection | ARCHITECTURALLY READY -- eligibility-gate pattern exists and is generic; proposal-to-experiment creation call not wired |
| Autonomous Experiment Execution | DEFERRED -- depends on the above |
| Autonomous Evaluation | ARCHITECTURALLY READY -- reuses Phase 29.2's `evaluateExperiment` unchanged; no autonomous trigger to call it added this phase |
| Autonomous Policy Activation | IMPLEMENTED |
| Autonomous Rollback | IMPLEMENTED |
| Circuit Breaker | IMPLEMENTED |
| Kill Switch | IMPLEMENTED |
| Human Override | IMPLEMENTED (pause/disable/reset-breaker, all human-only) |
| Agent Restriction | IMPLEMENTED |
| Server-Derived State | IMPLEMENTED (including the retrofit of Phase 29.3's UI toggle) |
| Audit Trail | IMPLEMENTED |
| Background/unattended scheduler | DEFERRED -- `POST /api/autonomy/run` is the safe explicit trigger point; no cron/pg-boss job calls it automatically |

## Remaining limitations

- No autonomous experiment selection/creation is wired -- the safety-gate
  machinery for it would be a near-copy of the activation gates, but the
  actual "pick a proposal and call the experiment-creation path" logic does
  not exist yet.
- No unattended scheduler invokes the controller. `POST /api/autonomy/run`
  exists specifically so a future job or ops script has a safe, minimal-surface
  entry point (§37-compliant: it accepts only a `candidateId`, never a policy
  to apply) once one is built.
- `maxActiveExperiments`/`maxExperimentsPerDay` config fields exist on
  `autonomy_configs` (for forward compatibility with experiment automation)
  but are not yet read by any gate, since no experiment-automation code path
  exists to check them against.
- The rollback-oscillation ceiling (`ROLLBACK_OSCILLATION_THRESHOLD = 1`) is
  a hard-coded constant, not owner-configurable, by design (§44: autonomy
  must not be able to raise its own safety ceiling by tuning an unrelated
  setting) -- documented here since it's the one autonomy-relevant number
  in the codebase that isn't in `autonomy_configs`.

## Phase 30 boundary

Autonomous experiment selection/creation, a background scheduler, formal
inferential statistics, multi-armed bandits, reinforcement learning, and any
form of autonomous self-modification remain explicitly out of scope and were
not implemented or scaffolded. A future phase adding a scheduler would need,
at minimum: a durable job (e.g. `autonomy.evaluate`, payload limited to
`ownerId`/`targetScope`/`correlationId`) that re-reads all authoritative
state before every action (this phase's controller already satisfies that
contract, having been designed to be called from exactly such a job); and a
governance decision about default cadence, since a scheduler running this
controller under the existing safe defaults would still only ever activate
`maxActivationsPerDay` times, but that decision belongs to a separate,
explicitly-approved phase, not this one.
