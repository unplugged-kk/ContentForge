# ContentForge — implementation status

Last updated: 2026-09-13 · Branch reviewed: `replit` (implementation landed)

This file is the single status artifact for the implementation work. All code,
migrations, tests and planning documents live on `replit`; this document is the
summary kept in the review PR.

---

## Verification (exact, current tree — re-verified this session)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm run test:unit` | **252 passed / 0 failed** (56 suites) |
| `npm test` | **252 passed** |
| `npm run test:db` (real PostgreSQL) | **96 passed / 0 failed / 0 skipped** (12 suites) |
| `npm run test:e2e:live` (real running app) | **72 passed / 0 failed** |
| `npm run test:e2e:visual` (real running app, visual red arrows) | **10 passed / 0 failed** |
| Fresh DB migration | **13 migrations** from zero — unchanged, no new migration needed |
| Existing DB migration | upgrades to the same schema |
| External smoke (non-gating) | `hnrss.org` → complete, 20 sources persisted |

Baseline before this phase: 237 unit / 90 DB / 65 live E2E.

---

## Locked pipeline (unchanged)

```
ResearchJob → Story → Opportunity → GenerationPolicy → GenerationJob → Artifact
            → approval → Schedule → Occurrence → Publication → Result
```

pg-boss only, PostgreSQL for all correctness state, no Redis/BullMQ, no
`channels` table, no X-specific core fields.

## Recurrence (new in this phase — Phase 4)

```
Schedule (recurrence, count, startAt) → Occurrence[0..count-1] → Publication → Result
```

The existing `Schedule → Occurrence` primitive now supports durable recurring
series — no new subsystem, no new table, no migration (the schema already had
`recurrence`/`count`; the occurrence uniqueness constraint already made
materialization idempotent).

- **Grammar**: `every:<n><unit>` (`m`/`h`/`d`/`w`), bounded fixed-interval —
  deliberately not RRULE/cron. Max interval 90 days. No recurrence ⇒ one-shot
  (`count` must be 1); recurrence present ⇒ `count >= 2`.
- **No mutable cursor column.** The next occurrence index is *derived*:
  `count(ScheduleOccurrence rows for this schedule)`. The n-th occurrence's
  time is `startAt + n * interval`. The pre-existing unique
  `(schedule_id, occurrence_time)` index is the single arbiter — concurrent
  ticks computing the same index collapse to one row, proven against real
  Postgres and against the live running app under concurrent HTTP dispatch.
- **Catch-up policy**: one slot per schedule per tick, oldest-due-first. A
  schedule that missed N slots while offline drains one slot per tick until
  it reaches `now`. Never bursts, never silently skips — bounded by
  `schedule.count`.
- **Timezone**: stored metadata only, exactly as one-shot `startAt` already
  was. Recurrence advances the same absolute UTC instant by a fixed duration
  — no new calendar/DST semantics.
- **Exhaustion**: a schedule flips to `status = "exhausted"` the moment its
  last occurrence materializes (also fixes a latent one-shot inefficiency —
  a one-shot schedule previously stayed `active` and was rescanned forever).
- **Retry ≠ recurrence, regeneration ≠ recurrence**: a publication retry
  never advances the recurrence cursor; every recurring slot publishes the
  exact same pinned Artifact revision — no Story/Opportunity/GenerationJob is
  ever created by the scheduler.
- **Verified live**: malformed recurrence rejected before persistence; 3
  overdue hourly slots → exactly 1 materializes per tick; process killed and
  restarted mid-series → the durable cursor resumes correctly with no
  duplicate and no loss; 3 concurrent dispatch ticks → exactly 3 occurrences
  (bounded by count), series exhausted; 3 Publications → 3 Results, all
  pinned to the one approved Artifact revision, research row counts
  unchanged.

## Research architecture (one engine, interchangeable providers)

```
ResearchRequest → ResearchJob → ResearchEngine → provider registry
                                   ↓
              selected providers (rss · reddit · youtube · hn · web)
                                   ↓
                          NormalizedSource
                                   ↓
                  durable sources + Evidence → Story
```

Providers are **replaceable inputs to one durable ResearchEngine**. No provider
may write Evidence, Story or Opportunity directly, and no source-specific
pipeline exists.

| Provider | Access class | Capabilities | State |
|---|---|---|---|
| `rss` | open | discover, search, fetch | pre-existing; still the only `fetch`/Stage-2 path |
| `reddit` | open (or `credentialed` with `REDDIT_ACCESS_TOKEN`) | discover, search | implemented + tested; **real anonymous access is 403** |
| `youtube` | open | **discover only** | public channel Atom feeds, metadata-only by design |
| `hn` | open | discover, search | real Algolia front page + search (externally verified) |
| `web` | open | search, fetch | SSRF-guarded, text-only, no browser runtime |

Capabilities are explicit and enforced: a provider that does not declare a
capability is never called for it (`youtube` has no `fetch` because the open feed
has no transcript).

## Visual intelligence (Phase 3, unchanged this phase)

```
Opportunity → GenerationPolicy → GenerationJob → Artifact ─┬─ visual intent
                                                           └─▶ visual_generations → visual_assets → artifact.payload
```

Three locked concerns stay separate: **VisualIntent** (what the content wants:
subject, composition, aspect ratio, style, role), **VisualAsset** (the durable
generated output — immutable revisions via a DB trigger), **VisualProduction**
(the external mechanism behind a provider-neutral port).

- **Durable request**: `visual_generations` with a UNIQUE idempotency key.
  Duplicate delivery collapses to one row; explicit `regenerate` creates a new
  row → new asset revision. Async via `visual.run` on pg-boss.
- **Durable assets**: `visual_assets` hold `storage_key` (`local:<sha>`) and
  validated MIME/dimensions — no binary blobs in Postgres, no cloud lock-in.
  `visual_asset_refs` records which Artifact references which revision.
- **Provider contract**: declared capabilities only (`generate_image`,
  `generate_slide`; `edit_image` is declared but unproduced — no fake editing
  API). The only producer is a deterministic fixture emitting a real 1×1 PNG.
- **Payloads**: `image` (asset reference + alt/caption/role), `carousel`
  (ordered slides, each independently addressable), `thumbnail`.
- **Failures**: transient → real pg-boss retry; permanent/invalid → terminal;
  invalid provider output never persists (MIME allowlist, SVG ban, byte and
  dimension ceilings).
- Optional vs required visuals come from the format profile (`image`,
  `carousel`, `thumbnail` require; text formats degrade to text-only).
- Owner-scoped reads/listing; path-traversal-safe storage keys.
- **Video Factory**: contract/boundary documented only. No rendering code, no
  renderer imports, no repository modifications.
- Fixed this phase in passing (test-only): `visual.dbtest.ts`'s cleanup
  deleted artifacts before publications/schedules referencing them, 23503-ing
  on any DB run that scheduled/published a visual-pipeline artifact.
  Production code untouched.

## What is implemented (phases B, 1, 1.5, 2, 3, 4)

- **Research**: five providers → NormalizedSource → engine → evidence; directed /
  autonomous / human_input; failure semantics locked (Case A/B/C).
- **Story**: reusable editorial meaning, evidence referenced by ID only.
- **Opportunity**: Story → N directions with `format` × `channel`.
- **GenerationPolicy**: immutable, content-addressed revisions from voice +
  template + format profile + objective/audience + constraints + model
  preference. Jobs pin `policy_id` **and** snapshot the rendered request.
- **GenerationJob**: frozen policy, deterministic idempotency, `generation.run`
  on pg-boss; retry is recovery, `regenerate` is deliberate new work.
- **Artifact**: immutable revisions (DB trigger); readiness
  `draft → in_review → approved | rejected` pinned per revision; human edits
  create new revisions; full revision history via API.
- **Voice / Template authoring**: immutable revisions under stable keys; polite
  deterministic rendering; archived items rejected as policy inputs.
- **Chat-to-post**: message → human-provenance Story → Opportunity → job;
  durable idempotency (`chat_key` UNIQUE) and explicit regeneration.
- **Schedule / Occurrence / Publication / Result**: durable scheduler tick
  (cron → compare-and-set claim → idempotent publication claim → pg-boss),
  single-flight publication lease, reconcile-first unknown handling, exactly one
  Result per Publication, X adapter over the existing xQuick transport.
- **Recurrence** (this phase): as above.
- **Visuals** (Phase 3): as above.

## Architecturally ready (not built)

Non-X format payload schemas beyond image/carousel/thumbnail, non-X channel
adapters, URL/web ingestion expansion, real image vendors, `edit_image`
production, X adapter `reconcile()` — each is a registration/implementation
against an existing seam, not a new pipeline.

## Deferred (deliberately, unchanged)

- Voice **style analysis** of the user's real posts; all authoring/editing **UI**.
- Second Brain / Context Vault.
- LinkedIn / Threads / Instagram and other non-X publishing.
- Analytics metric mappers; X adapter `reconcile()` implementation.
- last30days and Agent-Reach (behind the `SourceProvider` seam).
- Billing, subscriptions, collaboration, notifications, large UI work.
- Video Factory rendering or integration of any kind.
- Full iCalendar/RRULE recurrence (the bounded `every:<n><unit>` grammar
  covers ContentForge's actual need; not revisited unless a real requirement
  demands calendar-aware recurrence).

---

## Live E2E red arrows observed (real app, real Postgres, real pg-boss)

- Golden path: research → Story → Opportunity → policy → job → Artifact →
  approval → Schedule → Occurrence → Publication → X adapter → Result.
- **Recurrence** (new): malformed recurrence rejected pre-persistence; 3
  overdue hourly slots → bounded one-per-tick catch-up; process kill/restart
  mid-series → durable cursor resumes correctly; 3 concurrent dispatch ticks
  → exactly 3 occurrences, series exhausted; 3 Publications → 3 Results, all
  pinned to one Artifact revision, research row counts unchanged.
- **Mixed-provider**: one directed job across `rss + reddit + hn + web` produced
  **8 sources / 8 evidence from 4 providers in one ResearchJob**.
- **Autonomous discovery**: `rss + youtube` discover → 5 sources including the
  YouTube feed path.
- **SSRF boundary in the live app**: a `169.254.169.254` metadata URL →
  permanent failure, 0 sources, 0 evidence.
- **Visual lifecycle** (also covered by dedicated `test:e2e:visual`, 10/10):
  durable generation → PNG asset → revision chain → Artifact attach → approval.
  Duplicate delivery → one asset; explicit regeneration → new revision; transient
  failure → retry; invalid output → terminal with nothing persisted; queued
  generation survives SIGKILL and completes after restart; cross-user attach
  refused with 404.
- **Carousel**: one Story → ordered 3-slide carousel Artifact, each slide an
  independent asset; research row counts unchanged.
- **Research reuse**: mixed research → Story → `x_post` *and* `x_thread` (and
  now carousel) Artifacts with research row counts unchanged.
- Capability surface: `GET /api/research/providers` reports 5 providers,
  `youtube` discover-only.
- One Story → `x_post` **and** `x_thread`; Voice/template revisions never change
  an existing job's frozen snapshot; human-edit revisions and per-revision
  approvals; real periodic scheduler tick; chat idempotency vs explicit
  regeneration; restart recovery after SIGKILL.

---

## Known limitations

- **Recurrence**: the `every:<n><unit>` grammar is fixed-interval only — no
  calendar-aware recurrence (e.g. "every Monday at 9am local"), since nothing
  in the existing Schedule model resolved wall-clock/DST semantics either.
- **Visuals**: the durable pipeline is complete but the only producer is the
  deterministic fixture — **no real image vendor is wired**. There is no editor
  UI, no brand-asset system, and no sizing/derivation policy.
- **Reddit**: provider and credentialed seam implemented and tested, but Reddit
  returns **403 to anonymous scripted clients** on many networks. Production use
  needs `REDDIT_ACCESS_TOKEN`; the app never performs or rotates OAuth.
- **YouTube**: public feeds only — metadata, no transcripts, no Data API.
- **Trends**: Hacker News is the trend input; no Google Trends / social volume.
- **Web**: reads only URLs it is given; no search engine, no browser runtime.
- **Autonomous discovery** has no topic ranking and can never bypass approval.
- last30days / Agent-Reach remain references — nothing vendored, no AGPL code.
- Generation `cost` stays `null`; no authoring/editing UI exists.
- **Video Factory**: no rendering, no integration — contract only.
- X adapter `reconcile()` remains a stub (returns `null`) — ambiguous outcomes
  stay `unknown`, requiring operator reconciliation.

## Deferred (deliberately, unchanged)

Second Brain / Context Vault, voice style analysis, all authoring UI, LinkedIn /
Threads / Instagram publishing, billing, collaboration, notifications, analytics
metric mappers, full iCalendar/RRULE recurrence.

## Next boundary

Not decided here. The next implementation phase is selected externally after
review of this status.
