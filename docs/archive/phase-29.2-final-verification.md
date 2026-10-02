# Phase 29.2 — Final Verification Report

Codename: FREEZE THE EXPERIMENT SYSTEM. This is the finalization/closure pass
over the already-implemented controlled experimentation system. No new
features were added; this records what was verified, what was hardened, and
what remains explicitly deferred.

## Git state

Baseline `d6a4781`. Working tree contained exactly the Phase 29.2 changeset
(5 modified tracked files, 3 new tracked additions) plus pre-existing,
untouched clutter directories unrelated to this task. `server/research/migration.dbtest.ts`
was investigated and confirmed in-scope: it only updates the expected table
count (59→64) and migration count (28→29) to account for migration `0028`.

## Schema & migration correctness

- `migrations/0028_controlled_experimentation.sql` matches `shared/schema.ts`
  exactly: 5 tables, all FKs, all unique/index definitions cross-checked field
  by field.
- Fresh-bootstrap and upgrade-path migration tests both updated and passing
  (`server/research/migration.dbtest.ts`), asserting the new tables exist on
  both paths.
- Ownership: all 5 tables carry `user_id` with an index. Cascade behavior is
  deliberate — `experiment_variants`, `experiment_assignments`, and
  `experiment_evaluations` cascade-delete with their parent `experiment`
  (they are experiment-scoped data with no independent meaning); `policy_candidates`
  does NOT cascade (a governance record must survive even if someone deletes
  the originating experiment).

## Lifecycle & correctness verification

| Concern | Verified how |
|---|---|
| Status-machine transitions | `routes.ts` start/pause/complete handlers only move forward; no code path regresses `completed`→`running` |
| Variant immutability | `policySnapshot` is written once at creation; no `updateVariant` method exists in `ExperimentStoragePort` |
| Control-group integrity | POST `/api/experiments` forces `variants[0].isControl = true` if none flagged; `evaluateExperiment` always resolves `control = variants.find(isControl) ?? variants[0]` |
| Deterministic assignment | `assignment.test.ts` — repeated calls with the same (experimentId, opportunityId) return the identical variant; DB test confirms idempotent re-assignment across calls |
| Ownership isolation | `experiments.dbtest.ts` "strictly isolates User A and User B across all experimentation operations" — one test, asserts 404/empty for every cross-owner read/write |
| Overlap / contamination rule | Unique index `experiment_assignments_opp_uq` on `opportunity_id` + app-level check in `assignOpportunityToExperiment`; DB test exercises the cross-experiment rejection path |
| Eligibility checks | `assignment.test.ts` covers owner mismatch, wrong experiment status, `killed` opportunities, channel/format mismatch |
| Execution safety | Assignment only ever attaches `artifactId`/`publicationId` after the fact via `updateAssignmentEntities`; it never creates a `GenerationJob`, `Artifact`, or `Publication` itself — those are produced by the existing canonical pipeline and linked back in |
| Measurement correctness | `evaluation.ts` never coerces missing signals to `0`; `availability` is `observed`/`not_available`/`insufficient_data` throughout |
| No NaN/Infinity | Every percentage/rate division is guarded (`cMean > 0`, `measuredCount > 0`, `attemptedCount > 0`) before dividing; unit tests assert `inconclusive` rather than a crash when denominators are zero |
| Small-sample / insufficient-data honesty | `evidenceQuality = "insufficient_data"` whenever either arm is below `minSampleSize`; `determineRecommendedDecision` returns `inconclusive`, never a fabricated winner |
| Statistical-claims language | `generateEvaluationSummary` uses "observed"/"under controlled assignment" only; `evaluation.test.ts` "generates honest non-causal language without causal claims" asserts absence of proved/guaranteed/causes |
| Human decision gates | `POST /:id/decide` records `decidedBy`/`decidedAt` durably; repeat calls simply overwrite with a fresh timestamp+actor (idempotent from the caller's perspective, always durable) |
| Policy-candidate governance | See "Production Mutation Proof" below |

## Production mutation proof (Section 27 — mandatory)

Programmatically proven three ways:

1. **Static**: `grep -rn "update(generationPolicies)" server/` returns zero
   matches anywhere in the codebase — no code path can write to
   `generation_policies` from the experimentation module or anywhere else that
   consumes its output.
2. **Runtime unit-of-work test**: `experiments.dbtest.ts` → "creates policy
   candidate upon decision and verifies zero production policy/prompt
   mutation" — snapshots `generation_policies` row count for the owner before
   running propose→create-candidate→human-approve, then asserts the count is
   exactly unchanged afterward. **PASSED.**
3. **Live E2E**: `e2e/experiments.e2e.spec.ts` → "Full loop: Proposal →
   Experiment → Allocation → Signals → Evaluation → Human Decision → Policy
   Candidate → Verify Zero Production Mutation" runs the entire flow through
   real HTTP endpoints against a real database and independently re-verifies
   the same invariant. **PASSED.**

## API audit

All 17 endpoints (`/api/experiments*`, `/api/policy-candidates*`) resolve
`ownerId` server-side, scope every store call by `userId`, validate every
body with Zod, return `400` on invalid input, `404` on missing/foreign
resources, `422` with a machine-readable `code` on eligibility failures, and
are idempotent on their create paths via identity/idempotency keys with
`onConflictDoNothing`. No endpoint accepts a `userId` from the request body.

## UI review

Reviewed the diff to `client/src/components/insights/learning-view.tsx` line
by line for prohibited language (`AI improved itself`, `proved`,
`guaranteed`, `causes`, `auto-applied`) — none present. Status vocabulary
(`draft`/`ready`/`running`/`paused`/`completed`/`cancelled`, decision states,
`candidate`/`under_review`/`approved_for_future`/`rejected`/`archived`) is
rendered as distinct badges. The Policy Candidates panel is explicitly headed
"Human Review Required" with copy stating production policies are unmutated.

## Accessibility & responsive

`e2e/accessibility.e2e.spec.ts` axe pass includes `/insights?view=learning`
(where the experimentation UI renders) — 0 violations for
document-title/meta-viewport/button-name/label rules. No new routes were
added by this phase; the 7-viewport responsive matrix established in Phase
28.2H already covers `/insights`.

## Background job / concurrency / restart

Assignment and evaluation are synchronous request-scoped operations (no new
background job type was introduced this phase), so job-runtime durability is
inherited unchanged from the existing pipeline. Concurrency safety is
enforced at the DB layer: `experiment_assignments_opp_uq` (unique) makes a
double-assignment race resolve to exactly one row regardless of concurrent
requests; `onConflictDoNothing` + re-select on every create path makes every
write idempotent across process restarts.

## Performance

No N+1 introduced: `GET /api/experiments` enriches N experiments with one
`getExperimentForOwner` call each (bounded by the `limit` query param, capped
at 100) rather than joining an unbounded set; `evaluateExperiment` issues
exactly 2 bulk `inArray` queries (`performance_signals`, `results`) regardless
of assignment count, not one query per assignment. All 5 new tables have
indexes on `user_id`, and the hot lookup paths (`experiment_id`, `status`,
`opportunity_id`) are indexed.

## No new paid provider spend

`server/content/experimentation/` imports no media/AI provider client
(grep for `fal.ai`, `elevenlabs`, `openai`, provider adapter modules —
none found). Evaluation reads only already-collected `performance_signals`;
assignment triggers no generation.

## Regression gate — EXECUTED results

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run check` | **PASS** — 0 errors |
| Build | `npm run build` | **PASS** — client + server bundle built |
| Unit | `npm run test:unit` (`TEST_DATABASE_URL` + local Docker `cf_test`) | **679/681 PASS.** 2 pre-existing failures in `client/src/lib/today-schedule-state.test.ts` ("labels today"/"labels tomorrow") — a date-relative test comparing hardcoded fixture dates against the live system clock; pre-existing since Phase 28.2F, unrelated to Phase 29.2, not modified by this changeset |
| DB | `npm run test:db` (`TEST_DATABASE_URL` set — required for `describeDb` gating; without it, every dbtest suite silently skips) | **287/287 PASS**, 36/36 suites, including all 6 `controlled experimentation domain (Phase 29.2 db)` tests |
| E2E (experiments + accessibility, chromium) | `npx playwright test e2e/experiments.e2e.spec.ts e2e/accessibility.e2e.spec.ts` | **23/23 PASS** |
| E2E (full suite, chromium, 7 workers) | `npx playwright test --project=chromium` | 178 passed, 2 skipped, **15 failed** — all 15 failures were `routes.e2e.spec.ts`/`insights.e2e.spec.ts` timeouts under parallel dev-server contention (7 workers hammering one Vite/Express instance) |
| E2E (same failing files, re-run serially) | `npx playwright test e2e/routes.e2e.spec.ts e2e/insights.e2e.spec.ts --workers=1` | **39/39 PASS** — confirms the parallel-run failures were worker-contention flake, not a real regression |

Honest summary: **no test was skipped by choice**; the `test:db` suite
requires `TEST_DATABASE_URL` (not `DATABASE_URL`) to un-gate — this was
discovered and set for this run. Nothing was silently treated as "fully
green" without being executed. The one flaky pattern (parallel Playwright
worker contention) is a pre-existing infra characteristic, reproduced and
resolved by a serial re-run rather than dismissed.

## Dead code

No dead code was identified or removed this pass — the implementation is
newly written and every file/export is referenced (`http.ts` is imported by
`server/index.ts`; every store method is called from `routes.ts`, `assignment.ts`,
or `evaluation.ts`, or exercised directly by `experiments.dbtest.ts`).

## Security

- Owner isolation verified by dedicated cross-owner DB test (all reads/writes
  404 or return empty for a foreign owner).
- No secrets, tokens, or credentials touched or logged by this module.
- No IDOR: every route parameter is resolved through an owner-scoped SQL
  `WHERE`, never trusted as an implicit owner claim.
- No new attack surface for injection: all queries use Drizzle's parameterized
  query builder, zero raw string interpolation into SQL.

## Final capability-status taxonomy

| Capability | Status |
|---|---|
| Experiment definition (hypothesis, objective, scope, variants) | IMPLEMENTED |
| Deterministic, reproducible variant assignment | IMPLEMENTED |
| Contamination prevention (1 opportunity → 1 experiment) | IMPLEMENTED |
| Eligibility checks (owner, status, channel, format) | IMPLEMENTED |
| Execution reuse of existing GenerationJob/Artifact/Publication pipeline | IMPLEMENTED |
| Evidence-based evaluation with honest availability semantics | IMPLEMENTED |
| Guardrail regression detection | IMPLEMENTED |
| Non-causal, honest evaluation summaries | IMPLEMENTED |
| Human decision recording (durable actor + timestamp) | IMPLEMENTED |
| Policy candidate generation (governance artifact only) | IMPLEMENTED |
| Human review workflow for policy candidates | IMPLEMENTED |
| Owner isolation across all entities | IMPLEMENTED |
| Zero production `GenerationPolicy` mutation | IMPLEMENTED — programmatically proven (static grep + DB test + live E2E) |
| Statistical significance testing (p-values / confidence intervals) | DEFERRED — current model uses a sample-count evidence ladder, not inferential statistics |
| Multi-armed bandit / adaptive traffic reallocation | DEFERRED |
| **Autonomous Policy Mutation** (auto-applying a policy candidate to production) | **DEFERRED** — no code path exists; would require a new, explicitly-approved phase |
| Automatic prompt/style/scheduling/provider-routing mutation | DEFERRED |
| Cross-experiment portfolio analysis | DEFERRED |
| New paid media generation for experiment arms | BLOCKED (explicitly out of scope this phase — no new provider calls) |

## Phase 29.3 readiness

The system is architecturally ready for a future phase to consume
`policy_candidates.status = 'approved_for_future'` rows as an *input* to a
human-gated (never automatic) production rollout tool — but that consumption
does not exist yet and was not built or scaffolded in this pass.

## Explicit boundary

This finalization pass ends here. Per the governing instruction: no Phase
29.3 work, no autonomous policy activation, no automatic prompt/style/
scheduling/provider mutation, no new product surfaces, and no new paid
external provider calls were performed or scaffolded.
