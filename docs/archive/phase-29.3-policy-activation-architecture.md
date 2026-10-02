# Phase 29.3 — Human-Gated Policy Activation: Architecture

Codename: APPROVE -> ACTIVATE -> PRESERVE HISTORY. This document describes
how a Phase 29.2 `PolicyCandidate` becomes a live production
`GenerationPolicy` revision, exclusively through an explicit, authenticated
human action, with full reversibility and lineage.

## Existing model audited first (Section 4)

`GenerationPolicy` (`server/content/policy.ts`, shared/schema.ts) was
**already** immutable and content-addressed: `resolveGenerationPolicy`
resolves a `PolicySpec` to a SHA-256 `specHash`, and `findOrCreateGenerationPolicy`
either reuses an existing row for that hash or inserts a brand-new one keyed
by `(policyKey, version)`. Every `GenerationJob` pins the exact
`GenerationPolicy.id` it used (`generation_jobs.policy_id`), so historical
provenance already existed. What was **missing**: a durable notion of "which
revision, among possibly many for the same `policyKey`, is the one production
should currently use" -- the `status` column existed (`active`/`archived`)
but was purely decorative: every new revision defaulted to `active` and
nothing ever archived a sibling. This phase reuses the existing table and
gives that column a real, enforced meaning; it does not introduce a second
policy system.

## Lifecycle

```
PolicyCandidate (approved_for_future -- Phase 29.2's own human review action)
        |
        v  POST /api/policy-candidates/:id/activate  (a SEPARATE human action)
Eligibility check (server-side, transactional)
        |
        v
New immutable GenerationPolicy revision (or reuse of an identical existing one)
        |
        v  (one DB transaction)
Archive whatever was previously `active` for this policyKey
Mark the new/reused revision `active`
Insert a PolicyActivation audit row
        |
        v
Future GenerationJobs for this policyKey default to this revision's
voice/template/objective/audience/constraints/model when the caller
does not explicitly override them.
```

Rollback is the mirror image: it re-activates whatever was active
immediately before the most recent activation event for that `policyKey`,
recording a **new** `PolicyActivation` row with `action = "rollback"`. Nothing
is ever deleted or mutated in place.

## Two distinct human actions (Section 9)

1. **Experiment decision** (Phase 29.2, unchanged): "this variant performed
   sufficiently well" (`POST /api/experiments/:id/decide`).
2. **Policy candidate review** (Phase 29.2, unchanged): "this variant is
   eligible for production consideration" (`POST /api/policy-candidates/:id/review`,
   sets `status = approved_for_future`).
3. **Policy activation** (Phase 29.3, new): "I explicitly authorize this
   configuration for future production generation" (`POST /api/policy-candidates/:id/activate`).

Activation eligibility (`assertEligible` in `activation.ts`) additionally
requires: the source experiment is `completed` and its `decision` is
`variant_promising` or `variant_preferred` (not `invalidated`, not
`inconclusive`); the linked evaluation exists, its `evidenceQuality` is not
`insufficient_data`, and none of its `guardrailResults` are `regressed`.

## Single active revision per scope

A partial unique index enforces the invariant at the database level:

```sql
CREATE UNIQUE INDEX generation_policies_one_active_per_key_uq
  ON generation_policies (policy_key) WHERE status = 'active';
```

Migration `0029_policy_activation.sql` backfills existing data before adding
this index: for every `policyKey`, the highest-`version` row keeps
`status = 'active'`, every other row is set to `archived`. This changes no
policy *content*, only the label, and it's what makes the index installable
without breaking any existing scope.

Going forward, `findOrCreateGenerationPolicy` (the ordinary, non-activation
resolver used by every real generation request) inserts new ad-hoc revisions
as `status = 'draft'`, never `active` -- `active` is now reserved exclusively
for the row this module's activation transaction promotes. This was a
necessary correction discovered while integration-testing Section 15/16: a
routine generation request creates its own content-addressed revision (its
`specHash` always differs because Ticket 10's per-request context hash is
part of the spec), and that revision must never silently steal the "active"
slot from the one a human actually activated.

## Concurrency (Section 13, 27)

The activation transaction archives the current active row *before* inserting
the new one, then inserts (or reuses, by `specHash`) the target row and
explicitly sets it `active`. Two genuinely concurrent activations for the
same `policyKey` (different transactions/connections) race on the partial
unique index: the loser's `INSERT ... status = 'active'` blocks on the
winner's row, then fails with Postgres `23505` once the winner commits. That
error is caught and mapped to a `409 CONCURRENT_ACTIVATION` response rather
than leaking a raw SQL error -- deterministic, no partially-activated state.
Verified in `policyActivation.dbtest.ts` with two real concurrent
`activatePolicyCandidate` calls via `Promise.allSettled`.

## Idempotency (Section 18)

`activatePolicyCandidate` derives `identityKey = "activate:<candidateId>"`.
A repeat call for an already-activated candidate looks up that key and
returns the original `{ activation, policy, alreadyActivated: true }` without
touching the database further. `rollbackPolicyForCandidate` is idempotent in
the other direction: if the scope's latest activation event is already a
`rollback`, a second rollback call is a no-op that reports the current state
rather than toggling back and forth.

## Rollback safety (Section 12)

Rollback only ever updates the `status` column of two `generation_policies`
rows and inserts one `policy_activations` audit row. It never touches
`artifacts`, `results`, `publications`, or `experiment_evaluations` -- proven
by `policyActivation.dbtest.ts`'s rollback tests, which assert the previously
active revision's `constraints` content is byte-identical after being
archived and after being reactivated.

## Future-generation binding + historical immutability (Section 15/16)

`GenerationDeps` gained one optional field, `activePolicyReader?: (format, channel) => Promise<GenerationPolicy | undefined>`,
mirroring the existing optional `contextReader?` pattern so no caller or test
double is broken. Inside `createGenerationJob`, when (and only when) the
caller left *every one* of voiceId/templateId/objective/audience/constraints/model
unset, the active policy's values are used as defaults -- an explicit caller
value always wins for that field. Wired at the single production composition
root (`server/content/service.ts`'s `generationDeps`) via
`resolvePolicyForGeneration(db, format, channel)`.

Because each generation request still carries its own frozen Ticket-10
context hash, a `GenerationJob` never literally shares a row id with the
activated policy -- it resolves its *own* content-addressed revision carrying
the active policy's configuration. `policyActivation.dbtest.ts`'s binding
test proves this end-to-end: activate revision A, generate (job 1 carries
A's config); activate revision B; generate again (job 2 carries B's config);
re-inspect job 1 -- it still points at its own original revision, carrying
A's config, never retroactively relabeled.

## Agent restriction (Section 20, 36)

The agent tool layer is a closed allowlist built once at startup
(`server/agent/service.ts:registerAgentTools`) from two enumerable sources
(`createContentForgeTools`, `createTimeplusSemanticTools`). Neither imports,
nor could dynamically reach, `activatePolicyCandidate` or
`rollbackPolicyForCandidate` -- there is no generic "call arbitrary service
function" tool. Proven two ways in `server/agent/policyActivationDenial.test.ts`:
every declared tool name is scanned and none matches an activation/rollback
pattern, and every agent-tier source file is scanned for any reference to the
activation module (zero matches).

## API

- `POST /api/policy-candidates/:id/activate` -- 201 (new) or 200 (idempotent repeat)
- `POST /api/policy-candidates/:id/rollback` -- 200
- `GET /api/policies/active?policyKey=...` (or `?format=&channel=`) -- the current active revision for a scope
- `GET /api/policies/history?policyKey=...` -- every activation/rollback event for a scope, owner-scoped

All four are owner-scoped (candidate ownership for the writes; the
authenticated user's own activation history for reads), Zod-validated where
applicable, and return machine-readable error codes
(`NOT_FOUND` / `FORBIDDEN` / `NOT_APPROVED` / `EXPERIMENT_NOT_COMPLETE` /
`INVALIDATED` / `DECISION_DOES_NOT_PERMIT` / `NO_EVALUATION` / `INSUFFICIENT_EVIDENCE` /
`GUARDRAIL_FAILED` / `CONCURRENT_ACTIVATION` / `NO_HISTORY` / `NO_PRIOR_REVISION` / `INVALID_SCOPE`).

## UI

Added to the existing Policy Candidates panel in Insights > Learning (no new
navigation destination): an "Activate for Future Generations" button on each
`approved_for_future` candidate, gated behind a `ConfirmDialog` that states
scope, rationale, and "existing generated content is never altered, and this
can be rolled back at any time" -- never a bare "Accept"/"Apply". Once
activated, the same slot shows "Roll Back" behind its own separate
confirmation. Discovered and fixed along the way: the existing
"Approved by Human Reviewer" / "Approved for Future Rollout" badges used
`bg-emerald-600` with white text, which axe flagged at 3.56-3.76:1 contrast
(WCAG AA requires 4.5:1); corrected to `emerald-700`/`emerald-800` throughout
the file.

## Security

Policy configurations (`proposedConfiguration`/`constraints`) are plain
JSON produced by this module from a `PolicyCandidate`'s own
`proposedConfiguration` -- never provider secrets, tokens, or credentials
(those live in `connected_accounts`/encrypted columns, an entirely separate
table this module never reads or writes). Nothing here logs or serializes
secret material.

## Explicit deferrals (Section 33, 43)

No automatic activation, no automatic rollback, no self-directed
experimentation, no agent decision authority over activation, no
reinforcement learning or bandit reallocation. Those remain out of scope for
a future, separately-designed Phase 29.4.
