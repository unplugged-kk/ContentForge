# ContentForge — implementation status

Last updated: 2026-09-14 (Phase 7) · Branch reviewed: `replit` (implementation landed)

This file is the single status artifact for the implementation work. All code,
migrations, tests and planning documents live on `replit`; this document is the
summary kept in the review PR.

---

## Verification (exact, current tree — re-verified this session)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm run test:unit` | **272 passed / 0 failed** (59 suites) |
| `npm test` | **272 passed** |
| `npm run test:db` (real PostgreSQL) | **113 passed / 0 failed / 0 skipped** (15 suites, +1 file) |
| `npm run test:e2e:live` (real running app) | **79/79, 0 failed** — regression check: every Phase 1–6 red arrow unaffected by the adapter-registry-as-compatibility-authority change and the media-resolution step inserted into `runPublication` |
| `npm run test:e2e:visual` (real running app, visual red arrows) | **10 passed / 0 failed** |
| Fresh DB migration | **13 migrations** from zero — unchanged, no new migration needed |
| Existing DB migration | upgrades to the same schema |
| External smoke (non-gating) | `hnrss.org` → complete, 20 sources persisted |

Baseline before this phase: 266 unit / 108 DB / 79-of-79 live E2E.

---

## Visual delivery (new in this phase — Phase 7)

```
VisualAsset (immutable revision) → image/thumbnail Artifact → approval → Schedule
        ↓
Publication → resolvePublicationMedia() → visual_asset_refs → VisualAsset → AssetStoragePort.get()
        ↓
PublishRequest.media: PublishMedia[]  (ordered, N-capable, N=1 implemented)
        ↓
X adapter: uploadMediaToX(bytes) → media id → postContentToX([caption], {mediaIds}) → Result
```

Closes the gap where an approved image/thumbnail Artifact could reach
Schedule → Occurrence → Publication and then fail permanently because the X
adapter had no media transport. No new visual subsystem, no new table, no
migration — everything needed already existed in `visual_assets` /
`visual_asset_refs` / Artifact payload / `AssetStoragePort`.

- **Exact revision pinning, proved**: the payload names an asset id, never
  a query for "latest." A newer `VisualAsset` revision created after
  Schedule/Occurrence materialization does not change what gets published —
  `visualPublication.dbtest.ts`'s golden-path test creates a newer revision
  between materialization and `runPublication` and asserts the original
  bytes/id were published.
- **Media resolution happens in the core, never the adapter**: the X adapter
  receives already-resolved `PublishMedia[]` (bytes, mime, role, position);
  it never reads `visual_assets`, `visual_asset_refs`, or an Artifact row.
- **Two-step transport, two failure semantics**: a failed media *upload*
  (before any post exists) is a plain classified failure (retry or
  terminal), never `unknown`. A failed *post* after a successful upload is
  ambiguous and reuses the **existing** Phase 5 unknown/reconcile machinery
  unchanged — no second reconciliation system for media. The final
  `externalId` on a resolved Publication is always the post id, never a
  media id.
- **Compatibility drift fixed**: `KNOWN_FORMAT_CHANNELS`, a second
  hand-maintained allowlist in `opportunity.ts` that could (and had) drifted
  from the adapter's real capability, is deleted. `channelSupportsFormat()`
  (a thin read of the registered adapter's own `supports()`) is now the
  single authority, consulted at both Opportunity creation and Schedule
  creation — an undistributable `(format, channel)` pair is rejected
  deterministically before any provider call or ambiguous Publication.
- **Carousel is deliberately deferred**: the contract is already N-capable
  (`PublishRequest.media` is an array; `image`/`carousel`/`thumbnail` each
  declare ordered media references in the payload schema registry), but X's
  adapter does not add `carousel` to its supported-format set, so
  `channelSupportsFormat("x", "carousel")` is `false` and multi-media
  delivery is enforced-absent, not merely undocumented.
- **Thumbnail** reuses the identical `image` mechanism — no thumbnail-specific
  adapter code.
- **Live E2E scope, stated honestly**: there is still no HTTP-level path to
  create an image-format Artifact (Artifacts come from a generation job's
  AI-model completion, or — for visuals — directly through the domain layer,
  which is how every visual DB test builds one; Phase 3 already documented
  this boundary: "the visual E2E stops at approval"). This is a pre-existing
  authoring-surface gap, not something Phase 7 was asked to fix. The
  fixture's new media-upload boundary (`POST /x/media`,
  `/control/x-media-mode`) is real, live infrastructure ready for that
  future live-E2E phase; until an authoring endpoint exists, the golden
  path / retry / ambiguity / reconciliation / recurrence / idempotency
  proofs for image publication live at the real-Postgres tier
  (`server/content/visualPublication.dbtest.ts`), and the 79/79 live E2E run
  is a regression check that Phase 7's core changes broke nothing already
  proven live.

Full detail (exact contract shapes, resolution path, X transport, changed
files): `plans/contentforge-product/PHASE-B-IMPLEMENTATION.md` § Phase 7.

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

## LinkedIn channel adapter (new in this phase — Phase 6)

```
same canonical payload ({ text }) → format registered per (format, channel)
   x_post @ x  (280 chars)   |   linkedin_post @ linkedin  (3000 chars)
                     ↓ Publication.channel := Artifact.channel (unchanged)
              getChannelAdapter(channel) — registry lookup, no core branch
```

First non-X `ChannelAdapter`, proving the abstraction genuinely generalizes.
No new subsystem, no new table, no migration.

- **Format, not a channel flag**: `linkedin_post` is a new payload-schema
  registration (`{ text }`, 3000-char limit) — the same canonical shape as
  `x_post`, just a different platform limit. `KNOWN_FORMAT_CHANNELS` and
  `formatProfiles` already keyed by `(format, channel)`, so this required no
  core change, only a registration.
- **Transport**: `server/social/linkedin.ts` calls LinkedIn's real Posts API
  (`POST /rest/posts`, `Authorization: Bearer`, `LinkedIn-Version`,
  `X-Restli-Protocol-Version`). Unlike xQuick, it is synchronous — no
  write-action/poll protocol.
- **Ambiguity is network-level, not protocol-level**: the only ambiguous case
  is the transport failing before a response arrives (timeout/reset).
  `LinkedInPublishAmbiguousError` carries `{ commentary, attemptedAt }` — the
  durable handle reconciliation re-checks, since LinkedIn issues no
  request/write-action id of its own.
- **Reconciliation can confirm published, never confirm not-published.**
  `reconcile()` re-lists the author's recent posts and matches on exact text;
  a match resolves it (same Result row, same as X). A miss stays `unknown`
  (the existing `null` contract) — LinkedIn's listing endpoint gives no
  completeness guarantee, so absence is not proof of absence. This is an
  honest provider-capability difference from X (xQuick's write-action status
  is authoritative; LinkedIn's post listing is not) — a stuck-unknown
  LinkedIn Publication is bounded by the same `MAX_RECONCILE_ATTEMPTS` (5)
  rather than ever synthesizing a false "not published".
- **No provider-side idempotency**: LinkedIn's Posts API has no
  client-supplied dedup key — duplicate suppression is entirely
  ContentForge's own (`Publication.idempotencyKey` unique constraint +
  pg-boss queue dedup), documented as a boundary, not a provider guarantee.
- **Cross-channel independence, honestly scoped**: `Publication.channel`
  comes from `Artifact.channel`, fixed per Artifact row, so "one Artifact"
  cannot literally target two channels. Proven at the level that matters —
  two channel-specific Artifacts from the same Story/Opportunity lineage,
  independently scheduled/leased/reconciled, with a failure in one never
  touching the other.
- **Credentials**: identical boundary to X —
  `storage.getConnectedAccount("linkedin")` + env override
  (`LINKEDIN_ACCESS_TOKEN`/`LINKEDIN_AUTHOR_URN`), never logged or returned.
- **Verified live**: golden-path LinkedIn text post publishes with a real
  provider URN (`urn:li:share:...`) as `externalId`; a write whose response
  never arrives becomes `unknown` (never falsely published); reconciliation
  discovers the post LinkedIn actually received and resolves the *same*
  Result row; a LinkedIn and an X Publication from the same content lineage
  evolve independently (one published, the other's activity never touches
  it). Recurrence-through-LinkedIn (3 pinned Publications, one Artifact
  revision, no regeneration) is proven against real Postgres
  (`linkedin.dbtest.ts`), not repeated a second time in the live run.

## X publication reconciliation (new in this phase — Phase 5)

```
publish() ambiguous (transport invoked, outcome unconfirmed)
        ↓
Publication: state=failed, providerCalled=true   Result: outcome=unknown, metrics={writeActionId}
        ↓ (periodic tick / manual dispatch, reuses the existing publication lease)
adapter.reconcile() — tri-state
        ├─ null         → still unknown; durably bounded by the existing attempt counter
        ├─ {ok: true}   → SAME Result row resolved unknown→published, never a second row
        └─ {ok: false}  → confirmed NOT published: unknown Result deleted, SAME Publication
                           row reset to queued, re-queued through the existing durable job
```

`reconcile()` is no longer a stub. No new abstraction, no new table, no
migration — the tri-state reuses the existing `PublishOutcome | null`
contract, and the durable identifier (an xQuick `writeActionId`) rides on
the existing `Result.metrics` column via a new, generic,
adapter-opaque `PublishRequest.reconciliationHint` field.

- **What enters `unknown`** (unchanged definition, finally acted on): the
  adapter's transport was invoked and the outcome could not be established
  — for X, xQuick accepted a write (202 + `writeActionId`) but polling gave
  up before it resolved. Ordinary deterministic failures are unaffected.
- **Tri-state, no new type**: `null` = still unknown, `{ok:true}` = confirmed
  published, `{ok:false}` = confirmed NOT published. A read-API miss is
  treated as still unknown, never as proof of absence.
- **Result stays durable, `unknown` is provisional**: `insertResult` now
  upserts into an existing `unknown` Result only
  (`ON CONFLICT ... WHERE outcome = 'unknown'`); a `published`/`failed`
  Result remains immutable exactly as before. Confirmed-not-published
  deletes the provisional row so the eventual real outcome gets a clean one.
- **Safe next action on confirmed-not-published**: reset the *same*
  Publication row (same idempotency key, no new Occurrence) to `queued` and
  re-queue through the existing durable job — identical in spirit to an
  ordinary transient-failure retry. The queue-level dedup key for that retry
  is distinguished from the Publication's permanent identity (pg-boss's own
  singleton window would otherwise silently drop the re-send of an
  already-completed job) — the Publication's real `idempotencyKey` column is
  never changed.
- **Concurrency**: reconciliation reuses the existing single-flight
  publication lease (which already allowed leasing from `state = "failed"` —
  a seam that pre-existed and had simply never been wired to an adapter
  call). PostgreSQL is the sole arbiter; no in-memory lock.
- **Durable bound**: the existing `publications.attempt` column (already
  incremented by every lease acquisition) — after 5 reconciliation attempts,
  a Publication is left `unknown` for an operator rather than checked
  forever.
- **Where it runs**: the existing periodic content-scheduler tick and the
  existing manual `/api/publications/dispatch` endpoint — no new job type,
  no new scheduler, no new endpoint.
- **Verified live** (two consecutive full runs): a write accepted but never
  resolved becomes `unknown` without ever being falsely published;
  reconciliation discovers the external post and resolves the *same* Result
  row (never a duplicate); reconciliation confirms non-publication and the
  retried publish reaches exactly one final Result with no second
  Occurrence; proven against real Postgres with real concurrent
  reconciliation passes and a process restart mid-unknown.

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

## What is implemented (phases B, 1, 1.5, 2, 3, 4, 5, 6, 7)

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
  single-flight publication lease, exactly one Result per Publication, X
  adapter over the existing xQuick transport.
- **Recurrence** (Phase 4): as above.
- **X reconciliation** (Phase 5): as above.
- **LinkedIn channel adapter** (Phase 6): as above.
- **Visuals** (Phase 3): as above.
- **Visual delivery** (this phase, Phase 7): single-image publication to X —
  as detailed above.

## Architecturally ready (not built)

Carousel/multi-image publishing (contract already N-capable; X's adapter
deliberately does not declare support), additional non-X/non-LinkedIn
channel adapters (Threads, Instagram), URL/web ingestion expansion, real
image vendors, `edit_image` production, LinkedIn media — each is a
registration/implementation against an existing seam, not a new pipeline.

## Deferred (deliberately, unchanged)

- Voice **style analysis** of the user's real posts; all authoring/editing **UI**.
- Second Brain / Context Vault.
- Threads / Instagram and other non-X/non-LinkedIn publishing; LinkedIn
  media/articles/video/comments beyond the single text-post format.
- Analytics metric mappers.
- last30days and Agent-Reach (behind the `SourceProvider` seam).
- Billing, subscriptions, collaboration, notifications, large UI work.
- Video Factory rendering or integration of any kind.
- Full iCalendar/RRULE recurrence (the bounded `every:<n><unit>` grammar
  covers ContentForge's actual need; not revisited unless a real requirement
  demands calendar-aware recurrence).

---

## Live E2E red arrows observed (real app, real Postgres, real pg-boss)

- **Visual delivery** (new, proven at the real-Postgres tier this phase —
  see "Visual delivery" above for why the live-E2E golden path itself is
  deferred): image Artifact → media upload → media id → X post → Result,
  exact revision pinned even after a newer VisualAsset revision exists;
  transient media-upload failure retries the same Publication with no new
  lineage rows; media upload succeeds + post creation ambiguous →
  reconciliation → published with the real post `externalId` (never the
  media id); recurring image Schedule publishes the same pinned Asset per
  slot; concurrent duplicate delivery collapses to exactly one published
  Result. The full 79/79 live E2E suite re-ran clean as a regression check.
- Golden path: research → Story → Opportunity → policy → job → Artifact →
  approval → Schedule → Occurrence → Publication → X adapter → Result.
- **X reconciliation** (new): ambiguous write → `unknown` (never falsely
  published) → reconciliation → published, same Result row; ambiguous write
  → confirmed not published → re-queued (same Publication, same idempotency
  identity) → retried → published, exactly one final Result, no second
  Occurrence.
- **Recurrence**: malformed recurrence rejected pre-persistence; 3
  overdue hourly slots → bounded one-per-tick catch-up; process kill/restart
  mid-series → durable cursor resumes correctly; 3 concurrent dispatch ticks
  → exactly 3 occurrences, series exhausted; 3 Publications → 3 Results, all
  pinned to one Artifact revision, research row counts unchanged.
- **LinkedIn channel adapter** (new): golden-path text post publishes with a
  real provider URN as `externalId`; a response that never arrives becomes
  `unknown` without ever being falsely published; reconciliation discovers
  the post LinkedIn actually received and resolves the *same* Result row; a
  LinkedIn and an X Publication from the same content lineage evolve
  independently, one channel's activity never touching the other's state.
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
- **X reconciliation**: bounded at 5 attempts per Publication before being
  left `unknown` permanently for an operator; xQuick's read-lookup fallback
  (`fetchTweetTextByIdViaOfficialApi`) depends on a configured read endpoint
  and is not exercised unless a `writeActionId` is unavailable.
- **LinkedIn**: text posts only (no media/articles/video/comments/company
  pages). No provider-side idempotency — duplicate suppression is entirely
  ContentForge's own. Reconciliation can never safely confirm "not
  published" (LinkedIn's post listing has no completeness guarantee); a
  stuck-unknown Publication is bounded by the same 5-attempt limit as X
  rather than ever resolved to a synthesized negative.

## Deferred (deliberately, unchanged)

Second Brain / Context Vault, voice style analysis, all authoring UI, Threads /
Instagram publishing, LinkedIn media/articles/video/comments, billing,
collaboration, notifications, analytics metric mappers, full iCalendar/RRULE
recurrence.

## Next boundary

Not decided here. The next implementation phase is selected externally after
review of this status.
