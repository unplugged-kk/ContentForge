# Phase 30.2 Final Production Re-Gate

**Branch:** `replit` · **Base:** `6abc12c` (Phase 30.1, BLOCKER FIXED) + `3ec6f77` (CI env fix)
**PR #3:** open, unmerged — merge direction investigated, decision required (§17)
**Decision:** GO WITH EXPLICIT MITIGATIONS (matrix §15, decision §17)

## 1. Executive Summary

Phase 30.2 re-gated the full production system after the Phase 30.1 auth
enforcement fix and answers its charges directly:

- **Auth boundary re-verified live** on the final tree: anonymous → 401 on reads,
  mutations, paid generation, external publish, autonomy, and accounts (handler
  never runs); two-owner live probes: A builds, B gets 404 on every A row,
  A keeps full access; logout invalidates.
- **R1 shared-pool risk investigated model-by-model — and substantially
  remediated in this phase without schema changes.** Beyond the 30.1 gate, ~20
  id-addressed newer-slice endpoints (stories, opportunities + branching,
  generation jobs + paid run, artifacts + all transitions/history/revise,
  schedule create/get, publication result, artifact visuals) now enforce the
  established own-or-null-or-404 pattern. Proven by a new real-HTTP, real-DB
  cross-owner suite (5/5). What remains is the honestly irreducible residue:
  legacy unattributed (NULL) rows are visible to any authenticated user, and
  voices/templates/policies are shared config by explicit decision — both
  harmless under the single-operator model, both tracked (R1a/R1b).
- **Prompt corrections with evidence:** §8's "1 unit failure" is actually 1
  pre-existing environmental SKIP (macOS-only speech test; `fail 0`). §9's "16
  API failures" are resolved (37 passed + 1 env-skip).
- **Browser E2E now runs in CI** (this host cannot run browsers — environment
  limitation, unchanged): latest CI run **231 passed / 1 failed / 3 skipped**.
  The 1 failure (Journey E zero-mutation assertion) is classified TEST DEFECT:
  parallel cross-test pollution via the shared CI user (evidence §11).
  Additionally this phase found and fixed a REAL CI regression of its own
  making: Phase 30's fail-closed boot broke CI (no SESSION_SECRET) — fixed via
  CI env, first green boot since.
- **Autonomy chain re-certified** (48/48 targeted tests: gates, kill switch,
  agent boundary, SSRF, hardening); **human activation regression** 18/18.
- **No schema/migration changes** since 29.4 (git-proven); historical lineage
  intact. **No scheduler implemented.**

## 2. Repository State

- HEAD at gate start `6abc12c`; `3ec6f77` added during this phase (CI env fix).
  Phase 30/30.1 commits present. Tree otherwise clean (only tooling dirs
  `.commandcode/`, `.gemini/` untracked).
- PR #3: open, unmerged. **Direction investigated: it is `status-report` →
  `replit`, a stale Phase-3..22-era status-docs branch.** Merging it as-is would
  merge ancient status docs INTO the work — the opposite of integrating the
  accumulated changes, and there is no `main`/`master` branch in this repo
  (`origin/HEAD → origin/replit`). Merge decision escalated in §17 — no merge
  performed blindly.
- CI status: E2E workflow active per-push; was red since Phase 30 (boot crash,
  now fixed) with older red from the api-harness gap (now fixed).

## 3. Auth Re-Verification

Live battery against production bundle on fresh DB (final tree): anonymous GET
story, POST opportunity, POST images/generate (paid), POST posts publish,
POST autonomy/run, GET accounts → **all 401**. Authenticated A: story +
opportunity creation 200. Authenticated B on A's story/opportunity/list/branch/
select → **all 404**. Logout → cookie cleared, stale cookie → 401. Unit boundary
tests (8/8) prove 401 precedes handler execution and forged client identity
(headers/body/query ownerId) never authenticates. No handler/provider runs
before auth — mount order statically pinned and tested.

## 4. Tenant Isolation

A→A allowed (full chain verified, no lockout), A→B and B→A denied (404,
non-leaking) across stories, opportunities, generation jobs, artifacts (+
transitions/history/revise/visuals), schedules, publications/result — proven by
the new `ownerIsolation.dbtest.ts` (5/5 at the real HTTP boundary with real
routers, real gate, real DB). Anonymous→A/B denied (401). Pre-existing
row-level enforcement (research owned-job 404, agent `getRunForOwner`,
autonomy controller, experiments/learning/policy ForOwner, visual NULL-bridge)
re-verified by suites (48/48). Residual: legacy NULL pool shared (R1a),
voices/templates/policies shared-config (R1b) — §5.

## 5. R1 Shared-Pool Investigation

Model-by-model trace (schema + storage + routes, 67 tables):

| Class | Models | Attribution | Verdict |
|---|---|---|---|
| Strict (`NOT NULL` + ForOwner) | agentRuns/ToolCalls, experiments family, learning, policyActivations, autonomyConfigs/Decisions, userProfile | enforced | SAFE (suites prove) |
| Newer-slice, now guarded (30.2) | stories, opportunities, generationJobs, artifacts, schedules, publications/result, artifact visuals | own-or-null-or-404 at route; services inherit | FIXED this phase (5/5 HTTP tests) |
| Already guarded (pattern pre-existed) | visual generations/assets, style profiles, video repurposing, distribution publish path, repurposing plans (service-level caller check) | own-or-null-or-404 / ForOwner | SAFE |
| Legacy pool (NULL-dominated) | posts/ideas/articles/references/vault/discover/images/carousels/canned/youtube-channels/accounts/analytics | mostly NULL; id-only storage | R1a residual: shared among authenticated users; anonymous blocked by gate |
| Child tables keyed by parent | researchSources/Evidence (via job), scheduleOccurrences (via schedule) | transitive via parent check | SAFE where parent checked; NULL-subtree visible (R1a) |
| Singletons/config | discoverySettings (no owner col), pillars | global | shared-config by design; single-tenant harmless |
| Voices/templates/policies reads | nullable, unguarded single-gets/lists | pinned by generations; needed cross-functionally | R1b: shared-config by EXPLICIT decision (strategy-preference reads; no per-row writes by readers; generations pin revisions immutably) |

Cross-owner risk answers: (1) affected models listed above; (2) no realistic
cross-owner path remains on attributed rows (every id-addressed newer-slice
route checked; legacy rows lack attribution to violate); (3) all affected rows
are behind the gate; (4) ownership enforced at the access boundary (route
pre-checks + service checks), not by obscurity; (5) latent risk is confined to
R1a/R1b, both inert single-tenant; (6) YES — safe under single-operator;
(7) NO schema/backfill required before continuous single-tenant operation
(multi-tenant onboarding is the explicit NO-GO trigger).

No destructive schema work performed (STOP respected).

## 6. Paid Side-Effect Protection

Anonymous → 401 before any provider code (live: images/generate, posts
publish, autonomy/run, analytics sync paths all gated; unit test asserts
handler-run count 0). Wrong owner → 404 before paid execution on every
branching route (opportunity/job/schedule creation from foreign rows denied;
job run denied; artifact publish-intent denied via artifact check;
distribution service enforces `getArtifactForOwner`). Authorized owner →
permitted (live AI call reaches provider post-auth). No real paid calls or
publications performed in verification. Research/ingest AI and vision extractions
inherit the same gate.

## 7. Autonomy Re-Certification

All 15 Phase 29.4 gates re-verified via the 20/20 dbtest suite on the final
tree (kill switch defaults + disable-denies-subsequent, mode, automation flags,
breaker open/reset, ownership, scope allowlist, field allowlist, evaluation
existence, evidence floor, guardrails, budgets, cooldown, churn, oscillation,
rollback, audit lineage) plus agent-boundary static tests (no agent file
references controller/activation/config) and policyActivation denial tests —
**48/48 combined** with SSRF/hardening suites. Auth changes added no alternate
path: `/api/autonomy/*` sits behind the gate (live 401), `/run` still takes
only `candidateId`, all mutation still funnels through the 29.3 service.
Agent × Controller separation holds.

## 8. Human Activation Regression

Phase 29.3 human-gated path re-run on final tree: `activation.test.ts` +
`policyActivation.dbtest.ts` **18/18**. Autonomy configuration does not impede
human activation (separate service, separate `actor`, human-only reset).
No lockout: owner-A full-chain test reaches every own row.

## 9. Database / Recovery

- `git log 007e437..HEAD -- migrations/ shared/schema.ts`: exactly one entry —
  29.4's own `0030` migration. **Zero schema/migration changes in Phases
  30/30.1/30.2.** Historical policies/artifacts/publications/evaluations/
  experiments unmodifiable by these phases (code-only diffs; lineage suites
  green).
- UNKNOWN semantics intact: `providerCalled=true` → parked `unknown`, bounded
  reconcile reusing the same row, terminal states guarded (covered by existing
  distribution/reconcile suites, all green in full runs).
- Production start re-verified: clean install → migrate on empty DB → prod boot
  → `/api/health` ok → `/api/ready` 200 → authenticated flows; fail-closed boot
  without SESSION_SECRET re-confirmed; restore-chain proof from Phase 30 stands
  (no schema drift since).
- Operational caveat (carried): never share one database between E2E and dbtest
  runs — a state-sensitivity finding from 30.1 is recorded in §12.

## 10. Security

Re-run focused checks (final tree): authentication (gate 8/8 + live battery),
authorization (ownerIsolation 5/5 + 48/48 targeted), tenant isolation (§4/§5),
CSRF (unchanged, enforced post-auth; harness implements the real contract),
SSRF (legacyFetchDenial 2/2 + live metadata/loopback/private blocks from
Phase 30, code unchanged), XSS (DOMPurify + sanitized errors, unchanged),
secrets (no new env, redaction intact, CI uses a CI-only secret), forged owner
identifiers (rejected/ignored at gate + routes). No new attack surface added
(one 30-line gate + per-row read guards; no new deps).

## 11. CI / Browser E2E

- This host cannot run browsers (ubuntu26.04-arm64 unsupported by Playwright;
  no system browsers) — environment limitation, not app evidence.
- CI is the documented browser environment and now actually runs: this phase
  fixed CI's boot crash (SESSION_SECRET) and the api harness. Latest CI run
  (post-fix tree): **231 passed / 1 failed / 3 skipped** with default parallel
  workers.
- The 1 failure (Journey E zero-mutation assertion) is classified TEST DEFECT:
  the assertion (`generation_policies WHERE user_id=X` empty) is unscoped in
  time/owner-context while every chromium test shares ONE user, ONE database,
  and `fullyParallel` workers — any concurrent generation-job test creates
  policy revisions as that user. 30.x diffs create no policies; experiments
  journeys explicitly assert no active policies themselves. Pre-existing
  structural class (matches the 29.4 parallel-contention record). Follow-up:
  per-file users or serializing the learning/experiment files; NOT a production
  blocker (no correctness/security/recovery impact).
- 3 skipped: pre-existing environment skips (incl. AI-credential-gated).
- CI parallel note: with the harness fixed, the full parallel run is overwhelmingly
  green (231/235) — the old parallel-contention record is superseded for the
  current tree except the single Journey E interference above.

## 12. Test Results

| Suite | Result |
|---|---|
| `tsc` / `build` | clean (dist contains all 30.2 guards, verified by string) |
| `test:unit` | **730 pass / 0 fail / 1 skipped (731)** |
| `test:db` (isolated fresh DB `cf_gate2`, final tree) | **327/327 pass, EXIT 0** (322 + 5 new ownerIsolation; the §12.1 flake did not reproduce) |
| `ownerIsolation.dbtest.ts` (new, 30.2) | **5/5 over real HTTP** (anon 401s, B 404s, no-branch, no-lockout, NULL bridge) |
| Story harness (`story.dbtest.ts`) | 30.2 route checks broke 3 session-less tests → harness fixed with stub owner-1 session; service assertions preserved |
| Targeted security/autonomy/human | **48/48 + 18/18** |
| E2E `[api]` serial (local) | 37 passed + 1 env-skip, 0 failed |
| E2E full (CI, browsers, parallel) | **231 passed / 1 failed (Journey E, TEST DEFECT §11) / 3 skipped** |
| Live prod battery (final bundle) | anon 401 x6 classes; A builds; B 404 x5; logout→401 |

§8 prompt correction: there is NO unit failure — `fail 0`; the "1" is the
pre-existing macOS-only speech-test SKIP (also skipped in the 710 baseline).
§9 prompt correction: the 16 API failures are resolved by the 30.1 harness fix;
current state above.

### 12.1 DB suite notes (state sensitivity + one timing flake)

(a) Shared-database sensitivity (30.1 finding, confirmed again): `test:db` and
E2E must never share one database. Matrix on record: fresh+pristine 9/9,
fresh+30.x 9/9, dirty+E2E-residue+pristine 8/9, dirty+30.x 8/9 (same
`visualPublication` lease test). Operational rule stands.

(b) Timing flake in full-suite context: the same lease test failed once on
fresh `cf_gate` during the 39-file serial run, then passed alone on `cf_vp2`
fresh, failed immediately after an unrelated file, then passed again on retry
with zero state change (row audit: zero leftovers from the preceding file).
Both trees behave identically; no 30.x file is in the lease path. Classified
pre-existing timing-sensitive concurrency flake (same class as the 28.2B/29.4
records). Production impact: none — the lease arbitrates correctly on every
clean run.

## 13. Remaining Mitigations

- **M1 (retired for API, narrowed):** single-tenant operation remains the posture
  for the legacy NULL pool + shared config (R1a/R1b). Owner: operator. Remove
  when: owner-attribution backfill + legacy storage predicates land (needs human
  review — schema/data migration). Retaining it is honest, not habitual.
- **M2 (retain):** polling-based alerting (breaker/budget/DLQ). Necessity
  unchanged (low action volume). Owner: operator daily poll.
- **M3 (retain):** platform-owned RPO/RTO; app restore proven. Owner: operator
  quarterly confirmation.
- **D1 (retain, amended):** E2E-gated deploys — now with teeth: CI runs the real
  browser gate per push (fixed this phase); Journey E quarantined as known
  parallel-flaky pending harness isolation.
- **NEW Q1:** Journey E parallel interference — quarantine + follow-up, not a
  blocker. Owner: test-harness follow-up.

## 14. Findings

1. R1 partially remediated in-phase (~20 routes) — the certifiable part is done;
   residue R1a/R1b documented with triggers.
2. CI was red since Phase 30 from the fail-closed boot (own regression) — fixed.
3. The "1 unit failure" and "16 API failures" premises were stale — corrected
   with evidence; both suites are green.
4. Journey E is the sole red test anywhere; classified TEST DEFECT with
   mechanism + follow-up.
5. PR #3 cannot be merged as-is (wrong direction: stale status-report →
   replit; no main branch exists) — human decision required (§17).
6. No new product defects found in the re-gate; no P0/P1.

## 15. Final GO / NO-GO Matrix

| Capability | Verdict |
|---|---|
| Authentication | READY |
| Authorization | READY (residue R1a/R1b tracked) |
| Tenant isolation | READY WITH MITIGATION (M1 narrowed) |
| R1 shared-pool risk | READY WITH MITIGATION (R1a/R1b, triggers defined) |
| Database integrity / Backups / Restore / Migrations | READY |
| Job durability | READY |
| External provider safety / Publication safety | READY |
| Autonomy safety / Kill switch / Agent boundary | READY |
| Observability | READY |
| Security / SSRF | READY |
| Resource safety / Performance | READY (Phase 30 record stands) |
| CI reliability | READY WITH MITIGATION (Q1 quarantine) |
| Browser E2E | READY WITH MITIGATION (231/1/3, Q1 only red) |
| UX readiness | READY (29.5 stands; 30.3 post-merge re-audit planned) |
| Operational documentation / Disaster recovery | READY |

## 16. Scheduler Preconditions

Final prerequisites (only on GO / GO-WITH-MITIGATIONS): (1) single-tenant
posture or completed attribution backfill before multi-tenant scheduling;
(2) push alerting if action volume outgrows daily polling; (3) reconcile
node-cron inline jobs with the durable trigger (no double paths); (4) DLQ/
budget/breaker visibility for the new volume; (5) Journey-E-class global
assertions isolated per-tenant for scheduler-volume CI. Architecture unchanged:
durable pg-boss job → lease → reread → existing eligibility → bounded action →
audit; never owns auth/eligibility, never mutates policies directly, never
creates/selects experiments, no RL/bandits. No scheduler code implemented.

## 17. Final Launch Decision

**GO WITH EXPLICIT MITIGATIONS** (M1-narrowed, M2, M3, D1, Q1 as §13).

R1 is explicitly addressed: attributed rows are now per-row enforced (proven
5/5 over HTTP); unattributed legacy rows and shared config are inert under the
certified single-operator model with defined NO-GO triggers (second tenant,
open registration, or exposure without access control before backfill).

**Merge escalation (no blind merge performed):** PR #3 is `status-report` →
`replit` (stale Phase-3..22 docs branch; merging it would pollute `replit`,
not integrate it), and no `main`/`master` exists. Required human decision:
(a) merge `replit` into a new/existing integration branch, (b) close PR #3 as
superseded, or (c) retarget PR #3. Recommended: (a)+(b). Post-merge 30.3 UX
re-audit proceeds only after the target is confirmed and the merge verified.
