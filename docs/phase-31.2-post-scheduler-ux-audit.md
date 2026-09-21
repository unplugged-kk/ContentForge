# Phase 31.2 Post-Scheduler UX + Integration Audit

**Branch:** `main` · **HEAD:** `f4d635e` (+ this phase's report commit)
**Decision:** UX READY (zero new findings; no fixes required)

## 1. Executive Summary

Phase 31/31.1 added no UI, no routes, no response-shape changes, and no
client code (verified by diff: 9 files, all server/docs). The only
user-observable scheduler effect is *more rows of pre-existing states*:
autonomy decisions journaled and activations attributed
`autonomous_controller`, both rendered by unchanged truthful components.
Live browser validation on a production build (register → 7 destinations →
learning/autonomy panel → create studio → settings → logout → protected
access) plus CI's full browser gate found zero regressions. No fixes needed.

## 2. Repository State

`main` at `f4d635e`, clean tree. Phase 31 diff vs 30.3 checkpoint: server-only
(autonomy job/scheduler/tests, bootstrap/index wiring, review-endpoint hook,
2 docs). Zero `client/`, zero `e2e/`, zero new endpoints.

## 3. Scheduler UX Surfaces

Phase 31 introduced no dedicated scheduler UI (by design — §24: reuse
logs/audit/job state). Operator-visible surfaces for scheduler activity are
exactly the pre-existing ones: autonomy status/decisions endpoints, the
Insights → Learning Automated Optimization panel, Recent Decisions log, and
pg-boss job/DLQ tables. No implementation detail (job ids, singleton keys,
cron expressions, retry counts) leaks into any UI — verified by grep (no new
client strings) and live panel inspection. This is correct: the scheduler is
infrastructure, and its observable effects (evaluations, denials, activations)
already have first-class truthful presentations.

## 4. Autonomy UX

Live-verified on a fresh account: "Mode: Disabled", "Experiments: Off ·
Activation: Off · Rollback: Off", "1440 minutes per scope" cooldown display,
"No autonomous decisions recorded yet.", Pause/Disable correctly disabled
while off. Copy is factual and non-anthropomorphic ("Bounded, deterministic
autonomy… Never overrides a human decision"). Scheduler-driven evaluations
would append decision rows and (if ever allowed) attributed activations —
same components, same copy. No new states, no new controls, no scheduler
jargon anywhere in the client.

## 5. Human vs Automatic Actions

Unchanged code path: badges key on `activation.actor`
("Activated by You" / "Activated Automatically"), decision journal records
actor per event, rollback history preserves it (30.2/29.5 evidence stands;
no code touched these renders). Scheduler-produced activations carry
`autonomous_controller` like manual `/run` ones — indistinguishable handling
is CORRECT here (same authority, same gates), and the human/automatic
distinction is preserved.

## 6. Failure / Unknown States

No new states introduced. Pending/running/failed/retrying/DLQ are pg-boss
operator concepts, never user-facing; user-facing vocabulary (scheduled /
publishing / published / failed / needs verification / unknown) untouched.
DENY renders as evaluated-and-declined through existing decision UI, never
as failure or success. Unknown publications still park as unknown (code
untouched; suites green).

## 7. Today / Schedule / Insights

Live-verified Today (honest sections) and Schedule (Queue/Calendar/
Publications tabs). Scheduler executions create no content rows, no schedule
rows, no publications — only evaluations and (when allowed) policy
activations — so no duplicate concepts can appear. Activation changes future
default policy only; historical publications pinned (30.2 lineage proof
stands).

## 8. Learning / Experiment / Policy

Lineage Experiment → Evaluation → Candidate → Eligibility → Activation →
Monitoring → Rollback intact (code + CI journeys green). The scheduler never
appears in lineage UI (no actor, no attribution, no surface) — correctly: it
is not the decision-maker, and presenting it as one would be the UX defect.
The approval hook fires after human review without changing the review
response (fire-and-forget, verified by read).

## 9. Settings

Connected Accounts, autonomy controls all server-derived (verified live;
controls enable/disable truthfully with state). No scheduler configuration
is user-facing (cron/flags are operator env, documented in 31 docs) —
correct scope separation.

## 10. Authentication UX

Unchanged since 30.3 (no auth code in 31/31.1): unauthenticated → clean Sign
In; register/login → shell with identity; logout clears cookie and returns
to Sign In; stale cookies 401; 401/403/404 → session-expired / not-allowed /
not-found copy; CSRF auto-retry. Live re-verified on this build with zero
console errors. Scheduler added no UI paths, hence no new protected/
unprotected surface.

## 11. Accessibility

No client changes; CI axe suites green (part of the 231). Live snapshots
confirm landmarks, skip link, labeled inputs, heading order on visited
surfaces. No new interactive elements exist to audit (scheduler is UI-less).

## 12. Responsive

No client changes; CI 7-viewport matrix green (part of the 231). Scheduler
surfaces are the pre-existing panels already covered. No overflow risk
introduced (no new DOM).

## 13. Browser / CI

- Real browser (terminal-browser) on production build: register, 7
  destinations, learning/autonomy panel, create studio (gated Generate
  correctly disabled pre-input), settings, logout, post-logout Sign In,
  console-noise scan clean, log secret scan clean.
- Generation-submit not driven live (synthetic events don't drive React
  state; covered by CI journeys, green).
- CI on this tree: 231 passed / 1 quarantined (Journey E parallel pollution,
  TEST DEFECT) / 3 skipped — matplotlib identical to pre-scheduler baseline.
- Targeted suites on this tree: scheduler/agent/gate/denial 25/25.

## 14. Findings

Zero new findings across all hunt areas (§§3–12). Deliberately considered
and rejected as findings: missing scheduler dashboard (by design — operator
surfaces suffice per phase scope); Generate-button disabled pre-input
(correct gating); review-endpoint hook latency (non-blocking by construction).

## 15. Fixes

None required. No code changed in this phase beyond this report.

## 16. Remaining Limitations

Carried unchanged: R1a/R1b single-tenant posture, M2 polling alerts, M3
platform RPO/RTO, Q1 Journey E quarantine, UX-32/34/40/41 debt. Scheduler-
specific: hourly key granularity, no scheduler-driven rollback, vendor-
default pg-boss retention (all per 31 docs, all inert).

## 17. Final UX Decision

**UX READY.**

No P0/P1 scheduler-induced UX/integration defect; no misleading
autonomy/scheduler state; no auth, accessibility, or responsive regression;
no critical E2E regression. The product communicates scheduler-driven
autonomous behavior clearly and truthfully — mostly by correctly showing
nothing new, and showing decisions/activations through the existing honest
components.
