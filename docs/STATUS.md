# ContentForge — implementation status

Last updated: 2026-09-12 · Branch reviewed: `replit` (implementation landed)

This file is the single status artifact for the implementation work. All code,
migrations, tests and planning documents live on `replit`; this document is the
summary kept in the review PR.

---

## Verification (exact, current tree)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm run test:unit` | **200 passed / 0 failed** (39 suites) |
| `npm test` | **200 passed** |
| `npm run test:db` (real PostgreSQL) | **74 passed / 0 failed / 0 skipped** (9 suites) |
| `npm run test:e2e:live` (real running app) | **59 passed / 0 failed** |
| Fresh DB migration | **42 tables / 11 migrations** from zero |
| Existing DB migration | `0000–0002` database upgrades to the same schema |
| External smoke (non-gating) | `hnrss.org` → complete, 20 sources persisted |

Baseline before this work: 182 unit / 56 DB / 44 live E2E.

---

## Locked pipeline

```
ResearchJob → Story → Opportunity → GenerationPolicy → GenerationJob → Artifact
            → approval → Schedule → Occurrence → Publication → Result
```

pg-boss only, PostgreSQL for all correctness state, no Redis/BullMQ, no
`channels` table, no X-specific core fields.

## What is implemented

- **Research**: RSS SourceProvider → NormalizedSource → engine → evidence;
  directed / autonomous / human_input; provider-failure semantics locked
  (all-providers-failed → retryable, partial → completes, no usable evidence →
  permanent).
- **Story**: reusable editorial meaning, evidence referenced by ID only.
- **Opportunity**: Story → N directions with `format` × `channel`.
- **GenerationPolicy**: immutable, content-addressed revisions from voice +
  template + format profile + objective/audience + constraints + model
  preference. Jobs pin `policy_id` **and** snapshot the rendered request.
- **GenerationJob**: frozen policy, deterministic idempotency, `generation.run`
  on pg-boss; retry is recovery, `regenerate` is deliberate new work.
- **Artifact**: immutable revisions enforced by a DB trigger; readiness
  `draft → in_review → approved | rejected`, approval pinned per revision;
  human edits create a new revision (`provenance=human_edit`); full revision
  history via API.
- **Voice / Template authoring**: immutable revisions under a stable key, with
  revise / archive / revisions endpoints; deterministic template rendering with
  explicit `[missing: var]` markers and undeclared-placeholder rejection.
- **Chat-to-post**: message → human-provenance Story → Opportunity → job;
  durable idempotency (`chat_key` UNIQUE) and explicit regeneration.
- **Schedule / Occurrence / Publication / Result**: durable scheduler tick
  (cron → compare-and-set claim → idempotent publication claim → pg-boss),
  single-flight publication lease, reconcile-first unknown handling, exactly one
  Result per Publication, X adapter over the existing xQuick transport.

## Architecturally ready (not built)

Additional format payload schemas and non-X channel adapters, URL/web ingestion
providers — each is a registration, not a new pipeline.

## Deferred (deliberately, unchanged)

- Recurrence expansion (RRULE/cron). `recurrence` and `count > 1` are rejected
  with a clear error rather than faked; the durable seam exists.
- Voice **style analysis** of the user's real posts; all authoring/editing **UI**.
- Images, carousel, video script, media/asset model.
- Second Brain / Context Vault (must feed policy/research context, never bolted
  onto Story).
- LinkedIn / Threads / Instagram and other non-X publishing.
- Analytics metric mappers; X adapter `reconcile()` implementation.
- last30days and Agent-Reach (they belong behind the `SourceProvider` seam).
- Billing, subscriptions, collaboration, notifications, large UI work.

---

## Live E2E red arrows observed (real built app, real Postgres, real pg-boss)

- Golden path: research → Story → Opportunity → policy → job → Artifact →
  approval → Schedule → Occurrence → Publication → X adapter → Result.
- One Story → `x_post` **and** `x_thread` Artifacts, with research row counts
  unchanged (no re-research).
- Voice-driven and template-driven generations each resolving a distinct policy
  revision, with the rendered rules visible in the frozen request.
- Artifact revisions: `rev1 8 approved → rev2 9 draft`, rev1 payload/approval
  untouched, history `[8, 9]`, stale base → 409.
- Editing a **template** or a **voice** afterwards leaves an existing job's
  frozen snapshot byte-identical.
- Chat: duplicate request → same Opportunity/job (`reused: true`); explicit
  regenerate → new job (2 jobs, 1 Opportunity).
- **Real periodic scheduler tick** (not the HTTP dispatch endpoint) enqueued and
  published `publication 2 → revision 9`.
- Restart recovery: a queued GenerationJob survived SIGKILL and completed.
- Transient research failure retried on the same ResearchJob; permanent failure
  reached the DLQ; an invalid model payload failed validation with no Artifact.

---

## Known limitations

- Recurrence expansion deferred (explicitly rejected, not faked).
- X adapter `reconcile()` is a stub → a mid-thread failure records
  `Result(unknown, reconcile_required)`.
- Everything above is an API foundation; no authoring/editing UI exists.
- Generation `cost` remains `null` (no billing by design).
- One pre-existing timing-sensitive DB test (pg-boss singleton window) can flake
  under load; it passes in isolation and the full suite is green.

## Next boundary

Not decided here. The next implementation phase is selected externally after
review of this status.
