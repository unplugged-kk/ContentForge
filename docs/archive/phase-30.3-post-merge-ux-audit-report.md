# Phase 30.3 Post-Merge UX + Integration Audit

**Branch:** `main` · **HEAD:** `341c3bc` (certified checkpoint, byte-identical to replit `193c88b`)
**Decision:** UX READY (no P0/P1; zero new post-merge findings)

## 1. Executive Summary

The merged MAIN tree was re-audited end-to-end after all production-readiness
and authorization changes (29.1–29.4, 30, 30.1, 30.2). Method: code
reconciliation of all 36 original findings + UX-37/38/39, targeted leak sweeps,
and REAL browser validation via terminal-browser against a production build
(auth, register, 7 destinations, learning/autonomy surfaces, create studio,
logout, post-logout access, console-noise scan), plus CI's full browser gate.

- **36/36 original findings hold; UX-37/38/39 hold.** Zero regressions.
- **Zero client changes since 29.5** (`git log e66630b..origin/replit -- client/`
  empty) — the 29.5 verdict stands structurally; this phase verified the delta,
  which is entirely server-side auth enforcement.
- **Auth UX delta verified good:** unauthenticated → clean Sign In (no data, no
  error storm, no console errors); register/login → full shell with identity;
  logout → cookie cleared, protected routes return to Sign In; 401/403/404 map
  to "Session expired" / "Not allowed" / "Not found" (never raw, never leaking
  owner existence); CSRF retry is automatic single-retry in the client.
- **Zero new post-merge findings** after a directed hunt (§19).
- CI on main: 231 passed / 1 quarantined (Journey E parallel pollution,
  TEST DEFECT) / 3 skipped — unchanged from replit.

## 2. Repository / Merge State

- `main` at `341c3bc`; tree byte-identical to certified `193c88b` (verified by
  diff). Working tree clean. PR #3 left open for the owner (superseded; merge
  direction was status-report→replit, correctly NOT merged).
- CI E2E runs per push on main (run 35600508004): 231/1/3, same single
  quarantined failure as replit.

## 3. Original 36-Finding Reconciliation

All 36 + UX-37/38/39 re-checked against merged code (shared-primitive presence
+ 8 deep checks + full leak sweep): IMPLEMENTED holds everywhere it was
claimed; PARTIAL (UX-13 bridge), DEFERRED (UX-32), DOCUMENTED (UX-34) unchanged.
Evidence table retained from the verification pass: ConfirmDialog (13+ pages),
ErrorState/StatusBadge/PageHeader (7/7 destinations), SchedulePicker/
PublishPreview (review flows), `humanizeScope` at all 8 scope renders,
actor badges end-to-end (server `getActivatedCandidateActors` → route →
"Activated Automatically"/"Activated by You"), `not_available`→"—"/"Not
Available", `decisionTypeLabel`. Leak sweep (`targetScope`, `decisionType`,
`actor`, `channel:`/`format:`, `ownerId`, `userId`, `policyKey`, `specHash`,
`idempotencyKey`): zero user-visible raw renders — types/parsers/payloads only.

## 4. Canonical IA

Verified live: all 7 destinations navigate with correct titles
(`ContentForge — <Name>`), h1s, landmarks, skip link; sidebar identity block
(avatar initials, name, title) + Sign out; legacy routes unchanged (no client
diff). No IA drift.

## 5. End-to-End Journeys

Canonical lifecycle + learning→experiment→activation→rollback covered by CI
browser journeys (all green in the 231) and unchanged code. Live smoke:
register → Today (honest empty states) → Create studio (all modes/entry
points render; Generate correctly disabled until input) → Sources/Agent/
Schedule/Insights/Settings. Generation-submit not driven live (synthetic
events don't drive React state; covered by CI journeys).

## 6. Authentication UX

Live-verified: unauthenticated visit → branded Sign In/Create Account (no
leak); registration → shell; logout → Sign In on next protected visit; stale
cookie rejected. Expiry mid-use: queries throw 401 → ErrorState with "Session
expired / Sign in again" copy (code path verified; no misleading empty
states — ErrorState, not empty lists, is the failure render). CSRF 403 →
single auto-refresh-and-retry, then honest error. No raw API errors surfaced
(`toUserMessage` + tests).

## 7. Owner / Account Identity UX

Sidebar identity; Settings → Connected Accounts with per-channel connect +
target-handle preview (`@username` in review flow); publish preview shows
target account + rendered preview + confirmation (unchanged). No technical
owner IDs rendered anywhere (grep-verified). No stale-state defects: logout
nulls the identity query → shell gates on it; per-query caches are inert
without identity.

## 8. Create / Review

Unchanged code; CI journeys green. Immutability messaging intact (Version 2
in draft, originals untouched, regeneration as siblings). A user cannot
conclude an edit changed history: versions, provenance, approval resets all
present per 29.5 (re-verified by code presence, not re-clicked).

## 9. Agent

Unchanged code; CI journeys green (lifecycle, approval callout, truthful
`completed_with_errors`, refresh durability, mobile). States render honestly;
unknown never resembles success (verified copy paths). Agent tool registry
unchanged — no autonomous-activation exposure (30.2 static tests green).

## 10. Sources / Research

Unchanged code; CI journeys green. Credibility/quality/novelty/conflict
badges, degraded-research honesty, provenance, untrusted-source labeling all
present per 29.5; leak sweep confirms no env-var or backend-token renders.

## 11. Today / Schedule / Publications

Unchanged code; CI journeys green. State vocabulary (scheduled / publishing /
published / failed / needs verification / unknown) intact with StatusBadge;
legacy Queue/Calendar vs canonical Publications tab bridge unchanged (UX-13).
No contradictory states introduced (no code touched these surfaces).

## 12. Insights / Learning

Live-verified learning view: honest empties ("No Optimization Proposals Yet"),
evidence-grounded copy, autonomy card ("Experiments: Off · Activation: Off ·
Rollback: Off", "1440 minutes per scope" cooldown display — humanized,
acceptable). No causal overclaim in copy. Evidence-quality ladder
(observed→directional→repeatable→confirmed) intact.

## 13. Experiments / Policy / Autonomy

Unchanged code; CI journeys green (mocked + unmocked). Human vs autonomous
activation badges present with plain-English copy; scope humanized everywhere
(sweep-verified). Kill switch, breaker, budget, cooldown, eligibility,
evidence, guardrail surfaces unchanged and understandable per 29.5.

## 14. Error / State / Trust

Systematic code + live review across research/generation/agent/scheduling/
publishing/experiments/activation/rollback: loading, empty, success, partial,
failed, blocked, waiting, unknown, unauthorized, forbidden, needs-verification
all render distinctly. 401→Sign In (shell) / "Session expired" (queries);
403→"Not allowed"; 404→"Not found" (non-leaking, matches server). No error
masquerades as empty data; no unknown as success; no auth failure as missing
data (live-verified post-logout, console-noise scan clean).

## 15. Responsive

No client changes; CI viewport matrix (7 viewports × 7 routes + dialogs/
sheets/drawers) green as part of the 231. This ARM host cannot render
viewports locally (no browsers) — recorded as environment limitation, covered
by CI evidence, not by assumption.

## 16. Accessibility

No client changes; CI axe suites (0 violations across destinations, tabs,
deep links, dialogs) green as part of the 231. Landmarks/skip-link/focus
order spot-verified live in snapshots (nav landmark, skip link first,
labeled inputs). Keyboard/focus behavior preserved by code identity.

## 17. Visual Consistency

No client changes; shared primitives (PageHeader, StatusBadge, ErrorState,
EmptyState, ConfirmDialog, SchedulePicker, PublishPreview) unchanged and
universally applied per the reconciliation. No new patterns introduced
(server-only phases). No duplicate systems.

## 18. CI / Browser Verification

- Main-push CI run 35600508004: **231 passed / 1 failed / 3 skipped** —
  identical to replit. Sole failure: Journey E zero-mutation assertion,
  classified TEST DEFECT (parallel cross-test pollution via shared CI user;
  unscoped global assertion; 30.x diffs create no policies). 3 skips:
  pre-existing environment skips.
- ARM local limitation (no Playwright binaries) unchanged; real-browser
  validation for this phase performed via terminal-browser (auth, journeys,
  states, console) + CI matrix.
- No failure represents a production correctness defect (evidence per item
  above + 30.2 §11).

## 19. New Findings

Directed hunt over 30/30.1/30.2 effects (auth redirects, unauthorized-state
presentation, stale client state, account context, unexpected 401/403, legacy
routes, publish UX, security-driven empty states, API error leakage):
**zero new findings.** Each hunt area verified good with evidence in §§4–17.
The `/opportunities?storyId=` missing-story 404 (vs prior empty list) is an
improvement, not a defect (client passes valid ids; standard error paths
cover the rest).

## 20. Fixes Applied

None required — no genuine defects found. (Deliberately: a no-fix audit
outcome with a documented hunt is stronger than cosmetic churn.)

## 21. Remaining UX Debt

Carried, unchanged, non-blocking: UX-32 palette (deferred), UX-34 profile copy
(documented), UX-40 budget-remaining counter (P3), UX-41 allowlist surfacing
(P3). Plus test-harness follow-up: Journey E parallel isolation (Q1).

## 22. Final Findings Matrix

| ID | Category | Finding | Evidence | Severity | Status | Fix | Phase |
|---|---|---|---|---|---|---|---|
| UX-01–UX-36 | prior | all original findings | reconciliation §3 + code refs | mixed→fixed | IMPLEMENTED (UX-13 partial, UX-32 deferred, UX-34 documented) | — | 28.2–29.5 |
| UX-37/38/39 | prior | scope jargon, not_available, actor badge | humanizeScope/badge code + live | P1/P3/P1 | IMPLEMENTED | — | 29.5 |
| (none new) | hunt §19 | no defect in any hunt area | live browser + sweeps + CI 231 | — | NO NEW FINDINGS | n/a | 30.3 |

No P0/P1. No numerical scoring.

## 23. UX Launch Decision

**UX READY.**

Zero P0/P1 UX or integration blockers on the merged tree. The integrated
application is clear, trustworthy, secure-looking, accessible, responsive,
and understandable after all production-readiness and authorization changes.

Scheduler posture: the merged product is ready for future scheduler
implementation under the approved architecture (durable pg-boss job → lease →
reread → existing eligibility → bounded action → audit; never owns auth/
eligibility/policy invention/experiment selection/RL/bandits). No scheduler
code in this phase.
