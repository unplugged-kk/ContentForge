# Phase 29.3 — Final Verification Report

Codename: APPROVE -> ACTIVATE -> PRESERVE HISTORY.

## Architecture summary

See `docs/phase-29.3-policy-activation-architecture.md` for the full design.
In short: a new `policy_activations` audit table plus a partial unique index
on the *existing* `generation_policies.policy_key` column give the
already-immutable, already-versioned `GenerationPolicy` a real, enforced
"exactly one active revision per scope" invariant, flipped only by an
explicit human HTTP action.

## Policy versioning

Reused as-is: `GenerationPolicy` rows were already immutable and
content-addressed (`specHash` unique index, `policyKey`+`version` unique
index) since Phase 1. No new versioning mechanism was introduced. The one
correction made: ad-hoc revisions created by ordinary generation
(`findOrCreateGenerationPolicy`) now default to `status = 'draft'` instead of
silently claiming `active` -- `active` is reserved exclusively for the
human-activated production revision.

## Activation

`activatePolicyCandidate` runs inside one `db.transaction`: validates
ownership and eligibility outside the transaction (read-only checks), then
inside it archives the current active revision, inserts-or-reuses the target
revision, sets it active, and records the audit event. Idempotent via a
durable `identityKey`. Authorization: candidate ownership is checked against
the calling `userId` before any write; a foreign owner's request is rejected
with `403 FORBIDDEN` before touching the transaction.

## Rollback

`rollbackPolicyForCandidate` looks up the most recent `policy_activations`
event for the candidate's scope and re-activates its `previousPolicyId` as a
brand-new `rollback` event. Idempotent (a second consecutive rollback is a
no-op, not a toggle). Never deletes or mutates a `generation_policies` row's
content -- only flips `status`.

## Lineage

Every `PolicyActivation` row carries `policyCandidateId`, `experimentId`,
`evaluationId`, `activatedPolicyId`, and `previousPolicyId`. Verified by a
dedicated dbtest that activates a candidate and asserts every one of those
foreign keys resolves back to the exact seeded experiment/evaluation/candidate,
and that the activated `GenerationPolicy.contextSnapshot.activatedFrom` field
independently carries the same candidate/experiment/evaluation ids -- the
lineage is reconstructable from either side.

## Agent restriction

Proven with zero live-service dependencies (pure static source analysis, so
it runs without a database or AI credentials): every tool name declared
anywhere under `server/agent/` is scanned for an activation/rollback pattern
(none found), and every file under `server/agent/` is scanned for any
reference to the policy-activation module (none found). See
`server/agent/policyActivationDenial.test.ts`.

## Historical integrity (Section 16, 35 -- mandatory production-mutation test)

`policyActivation.dbtest.ts`'s "future GenerationJobs resolve the currently
active policy" test performs exactly the sequence Section 35 mandates:

1. Activate revision A for a scope. Generate content (job 1) -- its resolved
   policy carries A's configuration.
2. Activate revision B for the same scope. Generate content again (job 2) --
   its resolved policy carries B's configuration, proving the NEW active
   revision is what future generation now uses.
3. Re-inspect job 1 from the database -- it still references its own
   original revision, still carrying A's configuration. Never retroactively
   relabeled.

Separately, the "archives the previously active revision..." and rollback
tests assert no existing `Artifact`, `Publication`, or `experiment_evaluations`
row is touched by an activation or rollback (those tables are never written
by this module at all -- confirmed by static grep, matching the Phase 29.2
methodology for its own zero-mutation proof).

## Security

- Owner isolation: a dedicated dbtest rejects activation of another owner's
  candidate with `FORBIDDEN` before any transaction begins.
- No secret exposure: policy configuration is plain JSON derived from a
  `PolicyCandidate`'s own fields; no credential, token, or provider secret is
  read, written, or logged anywhere in this module.
- No IDOR: every read/write resolves ownership via the candidate row first.

## Audit trail

Every activation and every rollback inserts one `policy_activations` row
with actor (`userId`), action, both policy ids, scope, reason, and a
database-generated timestamp (`created_at`). Verified directly in the "audit
row" assertions of the primary activation test and the lineage test.

## API coverage

| Endpoint | Method | Auth | Owner-scoped | Validated | Idempotent |
|---|---|---|---|---|---|
| `/api/policy-candidates/:id/activate` | POST | yes | yes (candidate) | yes (Zod) | yes |
| `/api/policy-candidates/:id/rollback` | POST | yes | yes (candidate) | yes (Zod) | yes |
| `/api/policies/active` | GET | yes | n/a (global scope, matches existing GenerationPolicy model) | yes | n/a (read) |
| `/api/policies/history` | GET | yes | yes (caller's own activation history) | yes | n/a (read) |

## UI

Activation and rollback each require their own explicit `ConfirmDialog`
(button click alone never mutates). Confirmation copy names the scope,
rationale, and states plainly that existing content is unaffected and the
change is reversible -- never a bare "Accept"/"Done"/"Apply". Discovered and
fixed while testing: `bg-emerald-600` + white text badges failed WCAG AA
contrast (3.56-3.76:1 vs the required 4.5:1); corrected to
`emerald-700`/`emerald-800` across `learning-view.tsx`.

## Accessibility

axe scan scoped to `section-policy-candidates` with a rendered
`approved_for_future` candidate (a state the Phase 29.2 test suite never
exercised) surfaced the contrast defect above; after the fix, 0 violations.
Full-route axe suite (`e2e/accessibility.e2e.spec.ts`) still 0 violations
across all routes including `/insights?view=learning`.

## Responsive

No new routes or navigation destinations were added; the Policy Candidates
panel lives inside the already-verified `/insights?view=learning` surface
covered by Phase 28.2H's 7-viewport matrix. The new buttons/dialog reuse
existing responsive primitives (`Button`, `ConfirmDialog`/`AlertDialog`) with
no custom layout.

## Performance

Activation issues a small, fixed number of queries per call (2 reads for
eligibility, 1 read + up to 2 writes + 1 insert inside the transaction) --
no N+1. `GET /api/policies/history` batches its `GenerationPolicy` lookups
with `Promise.all` over a deduplicated id set rather than one query per
event. The new partial unique index is the only new index; it doubles as the
concurrency-safety mechanism, not an extra performance cost on the read path.

## Migration

`migrations/0029_policy_activation.sql`: creates `policy_activations`,
backfills `generation_policies.status` (latest version per key stays
`active`, all others `archived`), then adds the partial unique index. Both
fresh-bootstrap and upgrade-path variants of `server/research/migration.dbtest.ts`
were updated (table count 64->65, migration count 29->30) and pass.

## Regression gate — EXECUTED results

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run check` | **PASS** — 0 errors |
| Build | `npm run build` | **PASS** |
| Unit | `npm run test:unit` (`DATABASE_URL` set to local Docker `cf_test`) | **684/686 PASS** — same 2 pre-existing `today-schedule-state.test.ts` date-relative failures carried over from Phase 29.2's report, untouched by this phase |
| DB | `npm run test:db` (`TEST_DATABASE_URL` set) | **301/301 PASS**, 37 suites, including all 14 new `policyActivation.dbtest.ts` tests |
| E2E targeted (experiments + insights + accessibility, chromium, serial) | `npx playwright test e2e/experiments.e2e.spec.ts e2e/insights.e2e.spec.ts e2e/accessibility.e2e.spec.ts --workers=1` | **34/34 PASS** |
| E2E full suite (chromium, 7 workers, parallel) | `npx playwright test --project=chromium` | 186 passed, 2 skipped, **8 failed** — all 8 were `routes.e2e.spec.ts`/`insights.e2e.spec.ts` timeouts under parallel dev-server contention (the same pattern documented in the Phase 29.2 report) |
| E2E (same files, serial re-run) | `npx playwright test e2e/routes.e2e.spec.ts e2e/insights.e2e.spec.ts --workers=1` | **39/39 PASS** — confirms worker contention, not a real regression |

Nothing was silently skipped. `test:db` requires `TEST_DATABASE_URL`
specifically (not `DATABASE_URL`) to un-gate every suite beyond one; this was
set for every run reported above.

## Dead code

None removed this pass; every new export is used by `routes.ts`, the dbtest
suite, or the UI.

## Final capability-status taxonomy

| Capability | Status |
|---|---|
| Human-gated policy activation | IMPLEMENTED |
| Immutable policy revisions | IMPLEMENTED (reused existing Phase 1 mechanism, corrected the `active`-by-default defect it had) |
| Activation audit trail | IMPLEMENTED |
| Rollback | IMPLEMENTED |
| Future-generation policy binding | IMPLEMENTED |
| Single active revision per scope (DB-enforced) | IMPLEMENTED |
| Concurrent-activation safety | IMPLEMENTED |
| Agent autonomous activation | DEFERRED — no code path exists; would require a new, explicitly-approved phase |
| Autonomous policy optimization | DEFERRED |

## Remaining limitations

- `GET /api/policies/active` and `/history` scope by `policyKey` (format x
  channel), matching `GenerationPolicy`'s pre-existing global-not-per-owner
  scope model; they are not per-owner partitioned beyond that.
- The UI's "activated" vs "not yet activated" toggle for a candidate is
  tracked in local component state (flips on a successful mutation) rather
  than persisted/derived from a server field on `PolicyCandidate` itself; a
  page reload does not currently re-derive which candidates are already
  active from the server. A future pass could add a computed
  `activatedPolicyId` to the candidate list response.
- No inferential statistics gate activation beyond the Phase 29.2
  sample-count evidence ladder (unchanged from that phase).

## Phase 29.4 boundary

Autonomous optimization (agent-triggered activation, automatic rollback on
regression, self-directed re-experimentation) is explicitly not implemented
or scaffolded. It would require, at minimum: an explicit, separately-approved
capability grant on the agent's `AgentDomainDeps`, a policy-level guardrail
monitor with its own alerting, and a governance decision about acceptable
automatic-rollback blast radius -- none of which exist today.
