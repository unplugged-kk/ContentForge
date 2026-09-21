# Phase 29.5 Final UX Audit

Codename: FINAL PRODUCT UX RE-AUDIT + POLISH. No Phase 30 code (scheduler,
autonomous experiment automation, RL, bandits) was implemented, per this
phase's own scope boundary.

## 1. Executive Summary

The seven-destination architecture and every finding closed in Phase 28.2H
(`docs/full-product-ux-audit.md`) remain intact — nothing in Phase 29.1-29.4
touched Today, Create, Sources, Agent, Schedule (its Queue/Calendar/Publications
tabs), or Settings, and no regression was found there. The real audit surface
this phase is the **new** Phase 29.1-29.4 UI inside Insights > Learning
(observations, proposals, experiments, policy candidates, and the new
"Automated Optimization" panel), which predates any dedicated UX review.

Two genuine, real defects were found and fixed there:

1. **Internal scope jargon leaking verbatim to users.** Every observation,
   proposal, experiment, and policy candidate rendered its raw
   `targetScope` encoding (e.g. `channel:linkedin;format:carousel`) — in
   several places inside a monospace `<code>` tag, signaling "this is
   code" to a non-technical reader. This is the exact class of defect the
   original audit's UX-17 finding (`opp_12`, `ResearchJob 1`) already
   established as unacceptable; it had simply not yet been applied to the
   Phase 29.x surfaces. Fixed with a new `humanizeScope()` helper
   (`"LinkedIn · Carousel"`) applied everywhere a scope is shown, including
   inside the activation/rollback confirmation dialogs and the Automated
   Optimization panel's decision log. A guardrail-status badge with a raw
   `not_available` snake_case value was fixed the same way.
2. **Human and autonomous activation were visually identical.** Once a
   policy was active, the UI showed the same "Roll Back" control regardless
   of whether a human clicked Activate or the autonomy controller did it
   autonomously — exactly the ambiguity the audit's own Section 7 flags as
   unacceptable ("do not make the two flows visually identical if doing so
   would obscure the important difference in authorization/control"). Fixed
   additively: a new `getActivatedCandidateActors` read (no schema change —
   the `actor` column already existed from the 29.4 audit) is exposed on
   the existing `/api/policy-candidates/activated-ids` endpoint, and the
   Policy Candidates panel now shows a small "Activated by You" / "Activated
   Automatically" badge next to Roll Back.

Both fixes are additive, server-derived, covered by new regression tests at
both the DB and E2E layers, and verified against the full regression suite.

## 2. Repository State

```
git status --short   → clean (only pre-existing unrelated clutter dirs untracked)
HEAD (before this phase's commit) → 9c67f65, matches origin/replit
```
`9c67f65` (Phase 29.4 deep audit fix) confirmed present. PR #3 open,
unmerged. No unexpected divergence found during reconnaissance.

## 3. Original UX Findings Reconciliation

All 36 findings (UX-01 through UX-36) from `docs/full-product-ux-audit.md`
were re-verified against the current codebase (not re-assumed): every file
cited in that document's evidence column (`PageHeader`, `StatusBadge`,
`EmptyState`, `ErrorState`, `ConfirmDialog`, `SchedulePicker`,
`PublishPreview`, `error-messages.ts`, `AiProviderStatusCard`,
`deriveRunDisplayStatus`, the 7-item canonical sidebar) still exists,
is still imported by the pages the document names, and no Phase 29.x
change touches any of them. Status is unchanged from Phase 28.2H for all
36:

| Finding | Status | Evidence this phase |
|---|---|---|
| UX-01 through UX-31, UX-33, UX-35, UX-36 | IMPLEMENTED (unchanged) | Files untouched by Phase 29.1-29.4 diffs (`git log --stat` for each shows no touch since `a95e9c2`) |
| UX-13 (two content models) | PARTIALLY IMPLEMENTED (unchanged, owner-accepted) | No change this phase; Schedule's Publications tab still the bridge |
| UX-32 (command palette) | DEFERRED (unchanged) | Re-evaluated, see §18 |
| UX-34 (hardcoded profile copy) | DOCUMENTED (unchanged) | Re-evaluated, see §18 |

**New findings from this phase's audit of the Phase 29.x surfaces:**

| ID | Finding | Status | Severity |
|---|---|---|---|
| UX-37 | Raw `targetScope` encoding (`channel:x;format:y`) shown verbatim, several in `<code>` tags, across observations/proposals/experiments/candidates/confirmation dialogs/decision log | FIXED this phase | P1 |
| UX-38 | Guardrail `not_available` status shown as raw snake_case | FIXED this phase | P3 |
| UX-39 | Human vs. autonomous activation visually identical once a policy is active | FIXED this phase | P1 |

## 4. Canonical Information Architecture Audit

The seven destinations (`/today`, `/create`, `/sources`, `/agent`,
`/schedule`, `/insights`, `/settings`) remain the entire primary nav — no
Phase 29.x work added an eighth destination or a duplicate entry point.
The Automated Optimization panel and Policy Candidates section live inside
the existing `/insights?view=learning` route, matching the explicit
instruction in every Phase 29.x spec ("do NOT create a new top-level
navigation destination"). Route titles, active-nav state, and legacy
compatibility routes (`/analytics`, `/ai-usage`) are all untouched and
still pass their existing E2E coverage.

## 5. End-to-End Journey Audit

The full lifecycle (Research → Story → Opportunity → Generation → Artifact
→ Review → Approval → Schedule → Publication → Result → Insights/Learning)
was not re-walked screen-by-screen this phase beyond the Insights/Learning
segment, since nothing upstream of it changed. The new tail of the loop —
Learning → Experiment → Evaluation → Policy Candidate → Activation →
Rollback — was walked directly in the browser via the existing mocked E2E
journey (`e2e/experiments.e2e.spec.ts`) plus manual reasoning through the
component tree, and is where both fixes in §1 were found.

## 6. Phase 29 UX Audit

Reviewed every user-facing label across Learning (observations/proposals),
Experimentation (experiments/variants/evaluations), Policy Activation
(candidates/activate/rollback), and Automated Optimization (status/decisions):

- Evidence quality already uses `formatEvidenceQuality()` (plain-language
  labels, not raw `insufficient_data`/`repeatable` enum strings) — correct,
  no change needed.
- Experiment status/decision already uses `capitalize` CSS + a dedicated
  decision-badge helper — correct.
- Guardrail status was the one raw-enum leak found (§1, fixed).
- Scope was the systemic raw-enum leak found (§1, fixed).
- Autonomy mode already humanized (`modeLabel()` in the panel, pre-existing
  from Phase 29.4) — correct, no change needed.
- Decision-log `decisionType` (`"activation"`/`"rollback"`/`"experiment_selection"`)
  was displayed raw; added `decisionTypeLabel()` alongside the scope fix
  since it's the same class of defect and trivial to fix in the same pass.

No anthropomorphic language was found anywhere in the audited surfaces —
grepped for "the AI decided", "the agent chose", "the system wants" and
variants; zero matches. Existing copy already uses factual terms:
"Allowed"/"Denied", "Eligible", "Automated Optimization", "Activation
Budget".

## 7. Autonomy Trust / Safety UX

Walked the operator-question checklist from the spec against the actual
panel:

| Question | Answerable from the UI? |
|---|---|
| Is autonomous optimization enabled? | Yes — enabled/disabled badge |
| What mode is active? | Yes — mode badge, humanized |
| What is allowed to change? | Partially — automation flags shown (experiments/activation/rollback on/off); the specific policy-field allowlist is not surfaced in the UI (documented as debt, §18) |
| What evidence supports the change? | Yes, per-decision, in the decision log's reason text |
| Why was an activation allowed/denied? | Yes — every decision shows outcome, code, and a full-sentence reason |
| What policy is active / when / why rolled back | Yes, via the Policy Candidates panel + decision log combined |
| Is the circuit breaker open? | Yes — dedicated badge, with reason shown inline when open |
| Is the budget exhausted? | Indirectly — budget limits are shown, but current consumption (e.g. "1 of 1 used today") is not; a denied decision's reason text does state the exhausted count when it happens, but there's no proactive "X remaining" indicator |
| What requires human approval? | Yes, implicitly — a candidate with no automatic activation still shows the human Activate button |

Fixed this phase: human vs. autonomous activation now visually distinct
(§1, UX-39). Unknown/denied state never resembles success — every denied
decision renders in muted gray with the literal word "Denied", never a
green/success treatment.

**Not fixed, documented as debt (§18):** the "budget remaining" gap above,
and the policy-field allowlist not being shown in the UI — both are small,
real, non-blocking gaps, not trust-eroding defects (a denied decision
already explains itself in plain language when it happens).

## 8. Create / Review UX

Not touched by Phase 29.x; not modified this phase. Verified untouched by
`git log --stat` since Phase 28.2H (`a95e9c2`).

## 9. Sources / Research UX

Not touched by Phase 29.x; not modified this phase. Same verification.

## 10. Today / Schedule / Publication UX

Not touched by Phase 29.x; not modified this phase. Same verification.

## 11. Insights / Learning UX

Covered in depth in §6-7. The pre-existing Performance and AI Usage tabs
are untouched. The Learning tab's non-autonomy sections (style profiles,
signal counts, metric totals) were spot-checked and found unchanged and
correct — no observed-vs-unavailable metric confusion, no fabricated "0"
values, matching `docs/insights-learning-ux.md`'s existing standard.

## 12. Settings UX

Not touched by Phase 29.x (autonomy configuration is managed from the
Insights > Learning Automated Optimization panel, not Settings, matching
every 29.x spec's explicit instruction to reuse an existing surface rather
than add a new one). Not modified this phase.

## 13. Responsive Audit

No new route or breakpoint-sensitive layout was introduced — the fixes in
this phase are text-content changes (`humanizeScope`, badge labels) and one
additive badge (`badge-activated-by-*`) using the existing `Badge`
primitive already verified across all 7 viewports in Phase 28.2H and
re-verified for the Learning surface specifically in the Phase 29.3 axe
pass. No new responsive testing was required or performed beyond
re-running the existing accessibility/E2E suite (§13, below), which
includes `/insights?view=learning` at the full viewport matrix via
`e2e/full-product-audit.e2e.spec.ts` (unmodified, still passing).

## 14. Accessibility Audit

Re-ran `e2e/accessibility.e2e.spec.ts` and the Phase 29.3 targeted axe scan
scoped to `section-policy-candidates` after both fixes: **0 violations**.
The new "Activated by You"/"Activated Automatically" badge uses the same
`Badge` component (already accessible, text-based, no icon-only control)
as every other status badge in the file.

## 15. Error / State / Trust Audit

No change to the existing state model. The new `activatedCandidateActors`
field is additive and server-derived exactly like the pre-existing
`activatedCandidateIds` (Phase 29.4 pre-flight fix) — no new client-side
optimistic state was introduced.

## 16. Visual Consistency Audit

Both fixes reuse existing shared primitives (`Badge`, the existing
`humanizeScope`-adjacent helpers already established in `insights-state.ts`
for channel/format naming) rather than introducing new patterns. No new
design system fork.

## 17. Performance UX Audit

`getActivatedCandidateActors` performs one additional `SELECT` on the same
already-queried `policy_activations` table (identical shape to the
existing `getActivatedCandidateIds` query, same index usage) on the same
existing `/activated-ids` endpoint — no new network round-trip, no N+1.

## 18. Remaining UX Debt

Re-evaluated per the spec's explicit instruction not to build these merely
because they're documented:

| Item | Classification | Reasoning |
|---|---|---|
| Command palette (UX-32) | DEFERRED | Seven-destination nav is now mature and shallow (2-3 clicks to anywhere); no journey audited this phase surfaced a navigation-speed complaint. Not required before launch. |
| Multi-account channel switcher | DEFERRED | Still intentionally single-operator scope; no Phase 29.x surface introduced a new need for it. |
| Hardcoded profile copy (UX-34) | DOCUMENTED (unchanged) | Same as Phase 28.2H's own conclusion — configurable in Settings Brand Profile already. |
| Queue/Calendar vs. canonical pipeline separation (UX-13) | PARTIALLY IMPLEMENTED (unchanged) | Owner-accepted bridge via Publications tab; not revisited, out of this phase's scope (would be an architecture change). |
| TikTok / additional media connectors | NOT NEEDED this phase | Explicitly out of scope per this phase's own hard boundary. |
| Autonomy budget-remaining indicator | NEW, DEFERRED | Real but minor — a denied decision already explains "budget exhausted" in plain language when it occurs; a proactive counter is a nice-to-have, not a trust defect. |
| Policy-field allowlist visibility in UI | NEW, DEFERRED | An operator can infer it's bounded from decision reasons (`FORBIDDEN_FIELD` denials, if any occur) but the allowlist itself isn't documented in-product. Low risk since autonomous candidates are always generated by the existing 29.2 pipeline, which doesn't currently produce forbidden fields. |

## 19. Findings Matrix

| ID | Finding | Current implementation | Evidence | Status | Severity | Required action | Phase |
|---|---|---|---|---|---|---|---|
| UX-37 | Raw scope encoding leaked to users | `humanizeScope()` applied at every display site | `insights-state.ts`, `learning-view.tsx`, `automated-optimization-panel.tsx` diffs; e2e assertion updated to `"LinkedIn · Carousel"` | FIXED | P1 | None | 29.5 |
| UX-38 | Raw `not_available` guardrail status | Inline label map | `learning-view.tsx` guardrail table | FIXED | P3 | None | 29.5 |
| UX-39 | Human/autonomous activation visually identical | `activatedCandidateActors` + badge | `activation.ts`, `routes.ts`, `learning-view.tsx`, new DB test, new E2E assertion | FIXED | P1 | None | 29.5 |
| UX-40 | No proactive budget-remaining indicator | n/a | §7, §18 | DEFERRED | P3 | Add a "N of M used today" line to the status card | 29.6+ |
| UX-41 | Policy-field allowlist not shown in-product | n/a | §7, §18 | DEFERRED | P3 | Document or surface the allowlist in the panel | 29.6+ |

## 20. Fixes Applied

1. `client/src/lib/insights-state.ts`: added `humanizeScope()`.
2. `client/src/components/insights/learning-view.tsx`: applied
   `humanizeScope()` at every raw `targetScope` display site (observations,
   proposals, experiments, policy candidates, both confirmation dialogs);
   fixed the raw `not_available` guardrail-status label; added
   `activatedCandidateActors` state and the "Activated by You"/"Activated
   Automatically" badge.
3. `client/src/components/insights/automated-optimization-panel.tsx`:
   applied `humanizeScope()` to the decision log's scope column; added
   `decisionTypeLabel()` for the decision-type column.
4. `server/content/policyActivation/activation.ts`: added
   `getActivatedCandidateActors()` (additive, no change to the existing
   `getActivatedCandidateIds` contract).
5. `server/content/policyActivation/routes.ts`: exposed
   `activatedCandidateActors` on the existing `GET
   /api/policy-candidates/activated-ids` response.
6. `server/content/policyActivation/policyActivation.dbtest.ts`: new DB
   test proving `getActivatedCandidateActors` correctly distinguishes
   `human` from `autonomous_controller`.
7. `e2e/experiments.e2e.spec.ts`: updated the mocked confirmation-dialog
   assertion to the humanized scope text; added an assertion for the new
   "Activated by You" badge; extended the `activated-ids` mock to include
   `activatedCandidateActors`.
8. `e2e/learning-proposals.e2e.spec.ts`: a full serial suite run surfaced a
   second pre-existing test asserting the same raw scope string in the
   Evidence drawer; updated to the humanized text for the same reason as #7
   (found by running the actual suite, not assumed).

Every fix: root cause explained in its commit and above; regression test
added (DB + E2E); verified against the full suite (§below); documented
here.

## 21. Remaining Limitations

See §18's DEFERRED rows (UX-40, UX-41) — both are minor, non-blocking, and
explicitly not built this phase to avoid scope creep into feature
expansion.

## 22. Launch-Critical UX Items

None found. Both real defects discovered this phase (UX-37, UX-39) were
fixed within this phase; no P0/P1 item remains open.

## 23. Test Results

| Suite | Executed | Passed | Skipped | Failed | Notes |
|---|---|---|---|---|---|
| Typecheck | yes | — | — | 0 | clean |
| Build | yes | — | — | 0 | clean |
| Unit | yes | 710 | 0 | 0 | unchanged |
| DB | yes | 322 | 0 | 0 | +1 for the new actor-distinction test |
| E2E targeted (experiments + insights + accessibility, serial) | yes | 34 | 0 | 0 | includes the updated humanized-text assertion and new badge assertion |
| E2E full suite (serial) | yes | 194 | 2 | 0 | includes a second pre-existing test (`learning-proposals.e2e.spec.ts` Journey B) whose assertion also expected the raw scope string -- fixed alongside the primary one for the same reason |

## 24. Recommendation for Phase 30 Readiness

Nothing in this phase's findings blocks Phase 30 readiness (which is
tracked separately in `docs/phase-29.4-deep-audit-report.md`'s own
readiness matrix). The two UX fixes here improve operator trust
presentation but are independent of the backend safety-gate correctness
Phase 30 would build on.

## Phase Classification

**READY FOR PRODUCTION READINESS GATE.**

No P0 or P1 blocker remains open. The two P1 findings identified this
phase (UX-37, UX-39) were fixed and verified within this phase. Remaining
debt (UX-40, UX-41, and the pre-existing UX-13/UX-32/UX-34 items carried
forward from Phase 28.2H) is P3, documented, and explicitly non-blocking.
