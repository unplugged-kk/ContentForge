# Phase 29.2 — Controlled Optimization & Experimentation: Architecture

Codename: FREEZE THE EXPERIMENT SYSTEM. This document describes the durable
experimentation infrastructure that lets ContentForge test a learned
hypothesis (Phase 29.1 `LearningProposal`) against measured production
evidence, without ever mutating live `GenerationPolicy` rows automatically.

## Lifecycle

```
LearningProposal (29.1, optional source)
        ↓
Experiment (draft → ready → running → paused/completed/cancelled/invalidated)
   ├─ ExperimentVariant[] (>=2, exactly one control, immutable policySnapshot)
   ↓
ExperimentAssignment (deterministic hash allocation, 1 Opportunity → 1 experiment ever)
   ↓  (reuses the existing pipeline — no parallel lifecycle)
GenerationJob → Artifact → approval → Schedule → ScheduleOccurrence → Publication → Result
   ↓
ExperimentEvaluation (aggregates performance_signals + results, honest availability)
   ↓
Human decision (`POST /:id/decide`, actor + timestamp recorded)
   ↓
PolicyCandidate (candidate → under_review → approved_for_future | rejected | archived)
   ✗ NEVER auto-applied to `generation_policies` — see "Production Mutation Proof" below
```

## Schema (migration `0028_controlled_experimentation.sql`)

| Table | Purpose | Identity / uniqueness |
|---|---|---|
| `experiments` | Hypothesis, objective, scope, primary + guardrail metrics, status/decision machine | `identity_key` unique (owner+scope+type+name) |
| `experiment_variants` | Immutable `policySnapshot` per arm, exactly one `isControl` | `(experiment_id, variant_key)` unique |
| `experiment_assignments` | Durable, deterministic Opportunity→Variant binding | `idempotency_key` unique; `opportunity_id` unique (contamination guard) |
| `experiment_evaluations` | Append-only measurement snapshots (interim/final) | `identity_key` unique |
| `policy_candidates` | Governance artifact for human review — never a production row | `identity_key` unique |

All five tables are `user_id`-scoped with an index; every FK that references
mutable domain state (`generation_policies`, `opportunities`, `artifacts`,
`publications`) is nullable-by-default and read-only from this module's point
of view (see below).

## Deterministic assignment (`assignment.ts`)

- `selectDeterministicVariant` hashes `sha256(experimentId:opportunityId)` and
  buckets it against variant traffic weights. No `Math.random()` — the exact
  same pair always resolves to the exact same variant, across restarts,
  workers, and repeated calls.
- `checkOpportunityEligibility` enforces owner match, experiment status
  (`running`/`ready` only), opportunity not `killed`, and channel/format scope
  rules before any assignment is created.
- `assignOpportunityToExperiment` is idempotent: a duplicate call for the same
  `(experimentId, opportunityId)` returns the existing assignment rather than
  double-allocating. A second call for a *different* experiment on an already
  assigned opportunity throws `ExperimentEligibilityError("CONTAMINATED")`.
  The DB-level unique index on `experiment_assignments.opportunity_id`
  enforces this even under concurrent requests.

## Evaluation (`evaluation.ts`)

- Reads only from existing durable tables (`performance_signals`, `results`),
  deduplicating multiple signal snapshots per `(publicationId, metric)` to the
  latest `observedAt`.
- Never coerces `not_available`/missing signals to `0`: a variant with zero
  measured samples reports `availability: "insufficient_data"` /
  `"not_available"` and `mean: null`.
- `evidenceQuality` requires both arms to clear `minSampleSize` before
  anything but `insufficient_data` is possible, then scales
  observed → directional → repeatable → confirmed by sample count.
- `determineRecommendedDecision` is a pure function: a regressed guardrail
  always wins (`guardrail_failed`), insufficient data or a null delta is
  always `inconclusive`, and directional deltas map deterministically to
  `variant_promising` / `variant_preferred` / `control_preferred`. No branch
  can produce `NaN`/`Infinity` — every division is guarded by a
  `measuredCount > 0` / `cMean > 0` check first.
- Summaries use observational language only ("observed", "under controlled
  assignment") — never "proved", "guaranteed", or "causes".

## Production mutation boundary (Section 27 requirement)

`server/content/experimentation/*` never imports a write path to
`generation_policies`. Confirmed by:

```
$ grep -rn "update(generationPolicies)" server/
(no results)
```

`ExperimentVariant.generationPolicyId` and `PolicyCandidate.proposedConfiguration`
are read/write only within this module's own tables. Promoting a variant
(`createPolicyCandidateFromExperiment`) only inserts a `policy_candidates` row
— it copies `variant.policySnapshot` into `proposedConfiguration` and stops.
Human review (`POST /api/policy-candidates/:id/review`) only ever updates
`policy_candidates.status/reviewedBy/reviewedAt/reviewNotes`. There is no code
path, scheduled job, or trigger anywhere in the repository that reads
`policy_candidates.status = 'approved_for_future'` and writes it into
`generation_policies`. This is additionally proven at runtime by
`experiments.dbtest.ts`'s "creates policy candidate upon decision and verifies
zero production policy/prompt mutation" test, which snapshots
`generation_policies` row count before and after the full
propose→approve flow and asserts equality.

## API surface

`server/content/experimentation/routes.ts` mounts at `/api/experiments` and
`/api/policy-candidates` (wired in `server/index.ts`, mirroring the existing
`/api/learning` mount pattern). Every handler resolves `ownerId = getUserId(req) ?? 1`
and every store method takes `userId` as a mandatory SQL `WHERE` clause — there
is no code path that reads or writes another owner's experiment, variant,
assignment, evaluation, or policy candidate. Zod schemas validate every body;
`ExperimentEligibilityError` maps to `422` with a machine-readable `code`
(`CONTAMINATED` / `INELIGIBLE` / `NOT_FOUND` / `NO_VARIANTS`); unknown IDs are
`404`; malformed bodies are `400`. Writes are idempotent via
`onConflictDoNothing` + identity/idempotency keys (experiment creation, variant
creation, assignment creation, evaluation creation, policy-candidate creation
all return the existing row unchanged on a repeat call, never a duplicate).

## UI

`client/src/components/insights/learning-view.tsx` renders four tiers:
Experiments list (status badge: draft/ready/running/paused/completed/cancelled),
an evaluation drawer per running experiment (guardrail chips, primary metric
delta, evidence-quality label), a decision action row (Promising / Preferred /
Inconclusive / Control Preferred — human-triggered, not automatic), and a
Policy Candidates panel explicitly labeled "Human Review Required" with copy
stating live production policies remain unmutated. No copy anywhere claims
"AI improved itself" or asserts a causal/statistical guarantee.

## Explicit deferrals

Autonomous policy activation, automatic prompt/style/scheduling/provider
mutation, statistical significance testing (t-test/confidence intervals —
current evidence-quality ladder is sample-count based, not p-value based),
multi-armed bandit reallocation, TikTok, new paid media generation. See the
capability table in `docs/phase-29.2-final-verification.md`.
