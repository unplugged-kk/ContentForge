# Phase 29.4 — Bounded Autonomous Optimization: Architecture

Codename: AUTONOMY WITH GUARDRAILS. This document describes the deterministic
controller that may, for the first time, activate or roll back a production
`GenerationPolicy` without a human clicking a button -- only after every
safety gate below passes.

## Pre-flight audit findings (§3)

Traced the actual Phase 29.3 implementation at `007e437` rather than trusting
status docs:

- `GenerationPolicy` is immutable, content-addressed, and (since 29.3) has
  exactly one `active` revision per `policyKey`, enforced by a partial unique
  index. Activation/rollback both go through `policyActivation/activation.ts`.
- The Insights > Learning UI's "activated" badge was tracked in a local
  `useState<Set<number>>`, resetting on reload -- flagged as a limitation in
  the 29.3 report and explicitly required to be fixed before autonomy could
  be considered safe (§4). **Fixed**: a new `GET /api/policy-candidates/activated-ids`
  route derives the set from the latest `policy_activations` event per
  candidate; the UI now reads it via `useQuery` and invalidates it on
  mutation success instead of setting local state.
- The 2 reported unit failures were real, not flaky noise: `today-schedule-state.ts`'s
  `formatDateBucket` accepted a `now` override for testing, but delegated to
  date-fns' `isToday`/`isTomorrow`, which always read the real system clock
  regardless of the argument passed. **Fixed** by switching to `isSameDay`
  against the provided reference date. Verified deterministic reproduction
  (failed only when the real clock crossed midnight during a test run) and
  confirmed the fix with the full unit suite green.

## Autonomy contract (§66)

**The autonomy controller MAY:** select an eligible learning proposal for
experimentation (architected, not wired to auto-fire -- see Remaining
Limitations); evaluate a completed experiment's `PolicyCandidate` for
eligibility; activate an eligible candidate through the existing Phase 29.3
service; roll back under an explicit, deterministic safety trigger.

**The autonomy controller MAY NOT:** change its own rules, thresholds, or
budgets (`autonomy_configs` is written only by the human-only functions in
`config.ts` -- the controller's only write path is `openCircuitBreaker`, a
one-way, strictly-more-restrictive flip); disable the kill switch; bypass
Phase 29.1 evidence rules, Phase 29.2 experimentation, or Phase 29.3
immutable activation; alter authorization or ownership; touch credentials;
execute arbitrary code; modify the database schema; or modify itself.

## Lifecycle

```
Observe (29.1) -> Learn/Propose (29.1) -> Experiment (29.2) -> Evaluate (29.2)
        |
        v  evaluateActivationEligibility() -- every gate below, server-side
kill switch -> mode -> circuit breaker -> activation-automation flag
        -> ownership -> scope allowlist -> policy-field allowlist
        -> evidence quality -> guardrails -> budget -> cooldown -> churn/oscillation
        |
        v  (only if every gate passes)
executeAutonomousActivation()
        -> activatePolicyCandidate(..., actor: "autonomous_controller")  [Phase 29.3, unchanged]
        |
        v
Monitor (existing learning/performance systems, unchanged)
        |
        v  explicit deterministic safety trigger (guardrail breach, etc.)
executeAutonomousRollback()
        -> rollbackPolicyForCandidate(..., actor: "autonomous_controller")  [Phase 29.3, unchanged]
```

Every evaluation -- allowed or denied -- inserts one row into
`autonomy_decisions` (`server/content/autonomy/controller.ts`'s
`recordDecision`), so "why did/didn't it act" is always answerable from the
database.

## Autonomy modes (§7) and independent enablement flags (§8)

`autonomy_configs.mode`: `disabled | observe_only | recommend | experiment_only
| bounded_activation`, default `disabled`. Only `bounded_activation` mode
permits autonomous activation, and only when `activationAutomationEnabled`
is *also* true -- two independent gates, matching the spec's explicit
example (`experiment_automation_enabled = true, activation_automation_enabled
= false`). `rollbackEnabled` is a third, independent flag specifically for
autonomous rollback.

## Safe defaults (§11)

One row per owner, created lazily on first read (`getOrCreateAutonomyConfig`).
Defaults: `enabled = false`, `mode = "disabled"`, both automation flags
`false`, `rollbackEnabled = false`, `minimumEvidenceQuality = "confirmed"`,
`maxActivationsPerDay = 1`, `maxActivationsPerWeek = 2`,
`maxConsecutiveActivations = 2`, `cooldownMinutes = 1440` (24h),
`circuitBreakerState = "closed"`. No deployment silently enables autonomy --
a never-configured owner is denied with `UNCONFIGURED`, treated identically
to `DISABLED`.

## Policy field allowlist (§12)

`server/content/autonomy/policyFieldAllowlist.ts` enumerates exactly the
`GenerationPolicy` fields Phase 29.3's activation transaction and
`GenerationDeps.activePolicyReader` actually consume: `voiceId`,
`templateId`, `objective`, `audience`, `constraints`, `model`. Any other key
present in a candidate's `proposedConfiguration` -- a credential, a token, an
owner ID, an autonomy-config field -- is rejected server-side with
`FORBIDDEN_FIELD` before any activation attempt proceeds. Since nothing in
the real schema even has a slot for credentials or autonomy config to leak
through, there is no path for them to appear here in the first place.

## Never a second mutation path (§13)

The controller never issues `UPDATE`/`INSERT` against `generation_policies`.
`executeAutonomousActivation`/`executeAutonomousRollback` call
`activatePolicyCandidate`/`rollbackPolicyForCandidate` directly, passing
`actor: "autonomous_controller"` (a new column on `policy_activations`,
default `"human"`, added in migration `0030`). Proven statically in
`server/agent/autonomyDenial.test.ts`: the controller module contains no
`generationPolicies).set(` or `.insert(generationPolicies)` and does contain
calls to both Phase 29.3 functions.

## Budgets, cooldown, churn, oscillation (§21-31)

All counts are read fresh from `policy_activations` on every call -- no
cache, no in-memory counter (§33, §40, §41):

- **Daily/weekly activation budget**: count of `actor='autonomous_controller'
  AND action='activate'` rows in the last 24h/7d for the owner.
- **Cooldown**: the most recent event for the scope's `policyKey`; if it was
  an `activate` within `cooldownMinutes`, deny.
- **Policy churn**: the newest-first run of consecutive
  `actor='autonomous_controller'` events for a scope; `>= maxConsecutiveActivations`
  denies further autonomous activation for that scope until a human acts.
- **Oscillation**: a strict A/B/A/B pattern across the 4 most recent events
  for a scope denies activation outright (`OSCILLATION_DETECTED`).
- **Rollback oscillation**: a hard, non-configurable ceiling
  (`ROLLBACK_OSCILLATION_THRESHOLD = 1`) -- a second autonomous rollback for
  the same scope within 24h opens the circuit breaker instead of rolling
  back again, deliberately independent of the owner-tunable
  `maxConsecutiveActivations` so autonomy cannot raise its own ceiling by
  raising an unrelated setting.

All four checks are pure, unit-tested functions
(`meetsMinimumEvidence`, `cooldownElapsed`, `detectOscillation`,
`countConsecutiveAutonomous` in `controller.ts`) wrapping the DB-derived
inputs, so the decision logic itself is verified without a database.

## Minimum evidence (§24)

`meetsMinimumEvidence` enforces a hard floor of `"repeatable"` regardless of
configuration -- `insufficient_data`, `observed`, and `directional` never
qualify for autonomous activation, matching the spec's explicit "never
activate by default" language for those tiers. A stricter owner-configured
minimum (e.g. `"confirmed"`) is respected on top of the floor.

## Guardrails (§25)

Reuses the identical guardrail check Phase 29.3's `assertEligible` already
performs (any `guardrailResults[].status === "regressed"` denies), evaluated
independently by the controller *before* calling the activation service,
which re-checks it again -- defense in depth, not a single point of trust.

## Kill switch, circuit breaker, human override (§9, §29, §32)

`config.enabled === false` denies every autonomous action unconditionally,
overriding mode and every other flag. `circuitBreakerState === "open"` does
the same. Both are checked fresh on every call, so a queued/retried
evaluation can never act on stale state. Only `resetCircuitBreaker` (in
`config.ts`, called only from the human-facing `/api/autonomy/circuit-breaker/reset`
route) can close the breaker; the controller's own `openCircuitBreaker` call
is one-way.

## Agent boundary (§14, §43)

The agent may create a `PolicyCandidate` through the existing (unrestricted-by-this-phase)
proposal/experiment pipeline, but cannot execute activation or rollback, and
cannot mutate autonomy configuration. Proven statically, zero live
credentials required (same methodology as Phase 29.3's own proof):
`server/agent/autonomyDenial.test.ts` scans every declared agent tool name
for an `autonom(y|ous)` pattern (none found) and scans every agent-tier file
for a reference to the autonomy controller/config module (none found).

## API (§36-37)

| Endpoint | Method | Who | Notes |
|---|---|---|---|
| `/api/autonomy` | GET | owner | full config row |
| `/api/autonomy/status` | GET | owner | compact status for the UI |
| `/api/autonomy/enable` | POST | human | sets `enabled=true` + any provided limits |
| `/api/autonomy/disable` | POST | human | the kill switch |
| `/api/autonomy/pause` | POST | human | disables + records `pausedAt` |
| `/api/autonomy/circuit-breaker/reset` | POST | human | the only way to close the breaker |
| `/api/autonomy/decisions` | GET | owner | recent decision journal |
| `/api/autonomy/decisions/:id` | GET | owner | one decision, owner-checked |
| `/api/autonomy/run` | POST | owner | executes one eligibility check + action for a `candidateId`; never accepts a policy/prompt/scope to blindly apply (§37) |

## UI (§54)

Added one card, "Automated Optimization", to the existing Insights >
Learning surface (no new navigation destination):
`client/src/components/insights/automated-optimization-panel.tsx`. Shows
mode, enabled/circuit-breaker badges, activation budget, cooldown, and the
automation flags -- all from `GET /api/autonomy/status`. Recent Decisions
list (from `GET /api/autonomy/decisions`) shows outcome, code, scope, and
plain-language reason for each evaluation. Human controls: Pause, Disable,
and (only while open) Clear Circuit Breaker. Deliberately non-anthropomorphic
copy throughout ("Automated Optimization", never "AI Controls Your Content").

## Remaining scope boundary (see final-verification.md for the full taxonomy)

Autonomous *experiment selection and creation*, and any background
scheduler/cron that invokes the controller unattended, are **not**
implemented this phase. The controller and its full safety gate set are
real and fully tested; what is missing is the periodic trigger that would
call it without a human or an ops script asking. `POST /api/autonomy/run`
is the safe, explicit invocation point such a scheduler (or a human, or a
test) would call in a future pass.
