# Phase B — Implementation Notes

Workstream: ContentForge Phase B foundation slice
Started: 2026-09-10 | Status: in progress

## Step 0 — Repository baseline

| Item | Value |
|---|---|
| Branch | `replit` |
| HEAD | `e6e8362 Phase C (b): add user context helpers + Request.userId + sessionUser middleware` |
| Working tree | **not clean** — pre-existing modifications present, left untouched |
| Pre-existing modified (tracked) | `.github/copilot-instructions.md`, `.gitignore`, `AGENTS.md`, `server/storage.ts` |
| Pre-existing untracked | `.adal/ .agents/ .commandcode/ .gemini/ .grok/ .ignore .kimchi/ .kiro/ .scratch/ .windsurf/ Dockerfile GEMINI.md architecture/ docs/spec_contentforge_reimagined.md opencode.json plans/ research/ roadmap/` |

Pre-existing work is **not** reverted, overwritten, or reset. No `reset --hard`,
`checkout .`, or `clean -fd` was used.

### Environment findings (pre-existing, unrelated to this session's changes)

1. **`.env` `DATABASE_URL` points at a remote production Neon database** and is
   unreachable (connection timeout). No local ContentForge DB existed.
   → Development/testing uses an **isolated disposable Postgres 16 on port 5433**
   (`contentforge-dev-db`). The production URL is never used. A guard asserts the
   target contains `localhost:5433` before any DB command.
2. **`node_modules` was installed for the wrong architecture** (`@esbuild/darwin-x64`
   on an arm64 machine), breaking `tsx` and therefore `npm run dev`.
   → Repaired with `npm install --include=dev` (respects the existing lockfile).
   `package.json` / `package-lock.json` are unchanged by this repair.
3. **The shell environment sets `NODE_ENV=production`**, which caused npm to prune
   devDependencies (`drizzle-kit`, `typescript`, `@playwright/test`).
   → Same repair; dev deps restored.
4. **The committed migration chain cannot bootstrap a fresh database.**
   `migrations/0003_spooky_reptil.sql` re-creates `canned_responses` and
   `youtube_channels` (plain `CREATE TABLE`) which `0002` already created with
   `IF NOT EXISTS`. `migrations/meta/` has **no `0002_snapshot.json`**, confirming
   `0002` was hand-written and `0003` was generated — the "branch/squash
   divergence artifact" Ticket 08 identified (`08-classify-existing-code.md`:
   "Migration `0003` replay of `0002` → REMOVE; squash before cutover so ordered
   apply doesn't error on duplicate CREATEs").
   → **Not fixed in this session**: `0002`/`0003` are applied in existing
   environments and Step 2 forbids rewriting applied migrations. Local dev
   bootstraps from `shared/schema.ts` via `drizzle-kit push` (the sanctioned
   `db:push` script). See "Remaining work" — this needs a decision before any
   fresh-environment deploy.

## Step 1 — Architecture reconciliation

Contradiction confirmed by inspection:

| Source | Says |
|---|---|
| `architecture/system-architecture.md` §1–2, `architecture/data-model.md` | Redis + **BullMQ** (pg-boss only as fallback); a `channels` entity as the central config unit; pgvector dedupe |
| Locked Wayfinder Ticket 06 §6 | **pg-boss, locked** ("BullMQ rejected: richer semantics, unjustified operational cost") |
| Locked Ticket 03 §4 / 07 | No channel-specific domain entity; Channel Adapter boundary; `format` × `channel` as generic string columns |

**Decision: the locked architecture wins (as instructed).**

- `architecture/*.md` is treated as **prior art, not specification**.
- **No BullMQ, no Redis** introduced.
- **No `channels` domain table** introduced. Channel remains a string dimension on
  Artifact/Schedule/Publication, per Tickets 03/05/07.
- pg-boss is installed and used for durable jobs.

This is recorded rather than silently resolved. Reconciling the stale documents
(or formally reopening 06) is **not** this session's authority and is listed as
remaining work.

## Scope discipline

In scope: job infrastructure, job envelope, payload-schema registry, SourceProvider
contract + registry + one real provider, NormalizedSource, SSRF boundary, research
engine slice, ResearchJob domain.

Deferred (untouched): last30days, Agent-Reach, YouTube/Reddit/GitHub/ArXiv/Trends
provider migration, autonomous discovery expansion, second brain, voice, templates,
visuals, carousels, LinkedIn/Threads/Bluesky/Mastodon, multi-brand, collaboration,
Chrome extension, notifications, analytics learning loop, Video Factory, billing.

## Progress log

- [x] Step 0 — baseline recorded
- [x] Step 1 — architecture reconciled (locked architecture wins)
- [x] Step 2 — schema/migration safety inspected; pre-existing defect found and documented
- [x] Step 3 — pg-boss foundation (`server/jobs/runtime.ts`)
- [x] Step 4 — generic job envelope (`server/jobs/envelope.ts`)
- [x] Step 5 — payload schema registry (`server/artifacts/payloadSchemas.ts`; `x_post`, `x_thread`)
- [x] Step 6 — SourceProvider contract (`server/research/contracts.ts`)
- [x] Step 7 — provider registry + Tier-1 backend fallback (`server/research/registry.ts`, `health.ts`)
- [x] Step 8 — one real provider: RSS (`server/research/providers/rss.ts`)
- [x] Step 9 — NormalizedSource + shared normalization (`server/research/normalize.ts`)
- [x] Step 10 — research engine slice (`server/research/engine.ts`, `engine-core.ts`)
- [x] Step 11 — SSRF boundary (`server/security/ssrf.ts`)
- [x] Step 12 — ResearchJob domain + additive migration `0005_research_domain.sql`

## Implementation summary

### Queue (pg-boss v10 — Node 20 compatible)

`pg-boss@^10.4.2` was chosen over v12 because the project targets **Node 20**
everywhere (`.nvmrc`, `Dockerfile`, all CI workflows, `engines`); pg-boss v11+
requires Node >= 22. No Redis, no BullMQ.

| Module | Responsibility |
|---|---|
| `server/jobs/envelope.ts` | Versioned, serializable `JobEnvelope`; zod-validated on read |
| `server/jobs/failures.ts` | Four failure classes → `retry` / `reschedule` / `terminal` |
| `server/jobs/registry.ts` | Job type registry (schema + queue config + handler) |
| `server/jobs/logger.ts` | Single-line JSON logs with credential redaction |
| `server/jobs/runtime.ts` | Lifecycle, enqueue, worker dispatch, classification, DLQ, graceful stop |

Retry mapping: transient → throw (pg-boss backoff, then auto-DLQ); rate_limited
→ re-queue after `retryAfterMs` and complete (never consumes an attempt);
permanent / policy_human → copy to DLQ and complete (no retry).

Enqueue dedupe uses pg-boss `singletonKey` + `singletonSeconds`. Note pg-boss
only enforces `singletonKey` under the `short` policy or with a `singleton_on`
window, so the window is always set. **The authoritative idempotency arbiter
remains the domain row's UNIQUE constraint** (Ticket 06 §7), not the queue.

### Research providers

| Module | Responsibility |
|---|---|
| `server/research/contracts.ts` | `discover`/`search`/`fetch` + capability + access class + probe |
| `server/research/normalize.ts` | Canonical URL, content hash, excerpt |
| `server/research/health.ts` | Per `(provider, backend, capability)` state, cooldown, circuit breaking |
| `server/research/registry.ts` | Registration, capability resolution, Tier-1 fallback, diagnostics |
| `server/research/providers/rss.ts` | RSS/Atom discover + SSRF-safe article fetch |
| `server/research/engine-core.ts` | Pure dedupe / evidence / validity |
| `server/research/engine.ts` | Orchestration, partial-failure tolerance, freezing |
| `server/research/storage.ts` | ResearchJob/Source/Evidence persistence |

Access classes are enforced at dispatch: `local-agent-only` providers are
**refused by default**, so browser-session research cannot enter the core.

### ResearchJob domain (migration 0005)

Three additive tables, no destructive statements:
`research_jobs`, `research_sources`, `research_evidence`. Evidence is
content-addressed by `(job_id, source_id, excerpt_hash)`; `research_jobs` carries
UNIQUE `correlation_id` and `idempotency_key`.

### Verification

Three layers, all green:

| Check | Result |
|---|---|
| `npm run test:unit` | **237 passed / 0 failed** (52 suites) |
| `npm run test:db` (real Postgres) | **90 passed / 0 failed / 0 skipped** (11 suites) |
| `npm test` | **237 passed** |
| `npx tsc` | **0 errors** |
| `npm run test:e2e:live` (real running app) | **65 passed / 0 failed** |
| Migrations 0005–0012 | additive only — 0 ALTER/DROP of pre-existing columns |
| Fresh DB migrate | bootstraps to 46 tables / 13 migrations from zero |
| Existing DB migrate | upgrades a 0000–0002 database to the current schema |

## Phase 9 — standalone media generation platform (done, image; video/audio capability-ready)

**The architectural shift**: generated media is a durable product capability
independent of Artifact, not an input to publishing. This was mostly already
true — Phase 3's `VisualIntent → VisualProviderPort → VisualGeneration →
VisualAsset` never required a Story/Opportunity/Artifact (`opportunityId` was
already optional on `createVisualGeneration`, and `POST /api/visual-generations`
already worked with none). Phase 9 makes that explicit, generalizes the
provider seam to be modality-aware and model-selectable, and adds the first
real (non-fixture) provider. `VisualAsset`/`VisualGeneration` are RETAINED as
names — they already satisfy "an independently owned generated media object
with stable identity" (§16 of the mission), so this is not a rename.

```
CreativeRequest (prompt/intent, modality, model preference)
        ↓ POST /api/visual-generations  (already Artifact-independent)
createVisualGeneration(): schema validate → capability check → model check
        ↓ (all BEFORE any provider call)
VisualGeneration (requested → generating → ready | failed)   [pg-boss visual.run]
        ↓
VisualProviderPort.generate() → AssetStoragePort.put() → VisualAsset (immutable revision)
        ↓ (optional, a consumer relationship — never required)
visual_asset_refs → Artifact → approval → Schedule → Publication → Result
```

**Provider abstraction, generalized, not duplicated**: `VisualProviderPort`
(unchanged shape) gains OPTIONAL capability-declaration fields —
`modalities?`, `models?`, `synchronous?` — so an existing provider that omits
them behaves exactly as before. `VisualCapability` gains `generate_video` /
`generate_audio` as TYPE-LEVEL readiness only; no provider registers them, and
`modalityOfCapability()` derives `image | video | audio` from whichever
capability a provider/request actually names — one registry, one capability
model, never `ImageProviderPort`/`VideoProviderPort`/`AudioProviderPort`.

**Deterministic model selection** (`resolveProviderModel` in
`server/content/visual.ts`): a `model` field on the generation request is
checked against the resolved provider's declared `models` list — rejected
with `VisualModelUnsupportedError` (HTTP 409) BEFORE any provider call when
declared and unsupported; a provider that declares no `models` list accepts
whatever it's given (its own business). No "pick the best model" inference,
anywhere. The model preference folds into `intent.modelPreference`, so it
participates in the existing idempotency hash exactly like `role`/`altText`
already did — no second idempotency mechanism.

**One real image provider**: `server/content/visualProviders/openaiImage.ts`,
registered alongside the fixture in `registerBuiltinVisualProviders()` (never
the default — `providerId` still defaults to `"local-fixture"` for every
existing caller). It reuses the project's EXISTING OpenAI-compatible client
(`server/ai/config.ts`, already used for text generation) — so deployment
mode (real OpenAI, a local/self-hosted OpenAI-compatible endpoint, any other
compatible host) is `AI_BASE_URL` configuration, never a branch in this file
or in core business logic. Calls the official `images.generate` contract,
decodes whichever shape the response carries (`b64_json` or `url`), and
classifies failures into the existing transient/permanent taxonomy (429/5xx/
timeout → transient; 400/401/403 → permanent).

**Honest ambiguity ceiling**: OpenAI's `images.generate` is synchronous with
no provider-side job id to poll — unlike xQuick's write-actions or LinkedIn's
provider lookups, an ambiguous outcome (request left the process, response
never arrived) cannot be reconciled here. A timeout is classified transient
and retried as the SAME durable `VisualGeneration` row (never a blind second
generation), but "did the upstream actually produce an image before the
timeout" can never be answered — this is a real provider-capability ceiling,
documented rather than papered over, the same category as LinkedIn's
`reconcile()` in Phase 6.

**Standalone generation, ownership, reuse, revision — all proven, none new**:
- Standalone: `visual.dbtest.ts` now proves `createVisualGeneration` with
  neither `opportunityId` nor `generationJobId` produces a durable, owner-
  scoped, `ready` asset.
- YouTube-readiness: a standalone asset loads by id with zero `visual_asset_refs`
  rows and zero Artifact/Publication rows ever having existed for it — proving
  a future non-publishing consumer needs nothing but the id.
- Reuse: the SAME asset attaches to two independently-created Artifacts via
  `insertVisualAssetRef` — one asset row, two references, never a duplicate.
- Revision: unchanged from Phase 3 (`supersedes_id` chain, `createVisualAssetRevision`) —
  regeneration never mutates an already-referenced asset.
- Retry vs. regenerate: unchanged from Phase 3 — a transient provider failure
  retries the same `VisualGeneration` row; `regenerate: true` (with a nonce)
  is the only path to a new generation/asset revision.

**Verification**: `tsc` 0 errors; unit 290/290 (+12: modality/model-selection
primitives in `visual.test.ts`, the real provider's pure helpers + a local
HTTP-double proof of its actual `images.generate` call in
`openaiImage.test.ts`); real PostgreSQL 121/121 (+4: standalone generation,
YouTube-readiness, reuse, model selection in `visual.dbtest.ts`);
`test:e2e:visual` 14/14 (+1: standalone generation accepts a model preference
through the real HTTP route, proven BEFORE any Artifact exists in the run);
`test:e2e:live` regression unchanged. Zero migrations — `visual_generations.model`,
`requestSnapshot` (jsonb), and `visual_assets.metadata` (jsonb) already carried
everything this phase needed.

**Real-provider execution status**: the adapter is implemented against the
official `images.generate` contract and its actual HTTP request/response
parsing is exercised against a local double (mission §38) — no real OpenAI
credential is available in this environment, so live network execution
against the real OpenAI API is **DEFERRED**, not claimed. Set `OPENAI_API_KEY`
(or `AI_API_KEY`) and request `providerId: "openai-image"` to use it for real;
nothing else changes.

**Status labels**:
- Standalone media generation (no Story/Opportunity/Artifact required):
  **IMPLEMENTED** (Phase 3's existing seam, now explicit and proven).
- Provider-agnostic capability model (modality, model selection, deployment
  mode as configuration): **IMPLEMENTED**.
- Real image-generation provider (OpenAI-compatible, official contract):
  **IMPLEMENTED** against the contract; real network execution **DEFERRED**
  (no credential in this environment).
- Video / audio modality: **ARCHITECTURALLY READY** (capability type exists,
  `modalityOfCapability` handles it) — **DEFERRED**, no provider registers it.
- Artifact as an optional consumer of generated media: **IMPLEMENTED**
  (unchanged relationship, now proven independent).
- Carousel, Threads, Instagram, LinkedIn media, YouTube publishing: **not
  attempted**, out of scope, unchanged.

## Phase 7 — visual delivery: single-image publication to X (done, image/thumbnail; carousel deferred)

Extends the existing `Artifact → Schedule → Occurrence → Publication →
ChannelAdapter → Result` seam so a pinned Visual Intelligence Asset actually
reaches a channel, instead of stopping at Artifact approval. No new visual
subsystem, no new table, no migration.

```
VisualGeneration → VisualAsset (immutable revision)
        ↓ (payload.visualAssetId — a REFERENCE, never bytes)
image/thumbnail Artifact → approval → Schedule → Occurrence
        ↓
Publication  ──resolvePublicationMedia()──▶  visual_asset_refs → VisualAsset
        │         (core layer, never the adapter)         → AssetStoragePort.get()
        ↓
PublishRequest.media: PublishMedia[]   (ordered, N-capable, N=1 implemented)
        ↓
X adapter: uploadMediaToX(bytes) → media id → postContentToX([caption], {mediaIds}) → Result
```

**Media-carrying publication contract** — `PublishRequest.media` extends the
existing generic contract rather than a second media abstraction
(`server/content/adapters.ts`):

```ts
interface PublishMedia {
  visualAssetId: number;   // the EXACT pinned VisualAsset revision, never "latest"
  mime: string;
  role: string | null;
  position: number;
  altText: string | null;
  bytes: Buffer;           // resolved bytes, in-memory only — never queued/persisted
}
```

**Resolution path** (`resolvePublicationMedia` in `server/content/publication.ts`,
runs BEFORE the adapter is ever invoked):
`Artifact.payload → payloadSchemaRegistry.mediaRefs(format, payload)` (a new,
format-declared, per-schema function — `image`/`carousel`/`thumbnail` each
declare their own ordered `PayloadMediaRef[]`; text formats declare none) →
`content.getVisualAsset(ref.visualAssetId)` → owner check (`asset.userId ===
artifact.userId`) → `status === "ready"` check → `AssetStoragePort.get(asset.storageKey)`.
The adapter never reads `visual_assets`, `visual_asset_refs`, or an Artifact
row — it only receives the already-resolved `PublishMedia[]`.

**Exact revision pinning**: the payload names an asset **id**, not a query.
`resolvePublicationMedia` fetches that exact id every time; there is no
"latest asset for this artifact" lookup anywhere in the resolution path. A
later `createVisualAssetRevision` call creates a **new row** (`supersedes_id`
chain, immutable via the existing trigger) — the Artifact's `visual_asset_refs`
row still points at the original id, so publication keeps resolving the
original bytes. Proven in `server/content/visualPublication.dbtest.ts`
("golden path" test: a newer revision is created between Occurrence
materialization and `runPublication`, and the published Result/refs still
name the original asset).

**Media resolution failure semantics**: a `MediaResolutionError` carries a
`failureClass`. Missing asset / owner mismatch / not-ready → `permanent`
(terminal, `recordTerminal`, never touches the transport). A storage-layer
error classified transient (not "unavailable/not found/archived/unsafe/invalid")
→ releases the lease back to `queued` and throws `JobFailure.transient` for a
normal pg-boss retry — **the same mechanism a classified adapter failure
already used**, not a new retry path.

**X adapter** (`server/content/adapters.ts` `createXChannelAdapter`): `image`
and `thumbnail` added to `supported` — both are single-image formats whose
existing payload schema matches the transport 1:1. `carousel` is deliberately
**not** added (multi-media upload is out of scope this phase).
`publishWithMedia()` implements the two-step transport with different failure
semantics per step:
- **Media upload fails** (`uploadMediaToX` throws before any post exists) →
  `providerCalled: false`, classified `transient`/`permanent` exactly like
  any other pre-transport failure. Never `unknown` — nothing was created on
  X's side yet.
- **Post creation is ambiguous after a successful upload**
  (`XWriteActionPendingError`) → identical `unknown` contract as a text post:
  `providerCalled: true`, `ok: false`, `metrics.writeActionId` — reconciled by
  the **existing** `reconcile()`/`reconcileUnknownPublications` machinery,
  unchanged. No second reconciliation system for media.

**X media transport** (`server/social/x.ts`): `uploadMediaToX(bytes, mime,
altText)` posts base64 to a configurable `XQUIK_MEDIA_ENDPOINT` (default
`/x/media`, same override convention as `XQUIK_POST_ENDPOINT` /
`XQUIK_WRITE_ACTION_ENDPOINT`), extracts a provider media id via the same
configurable-path convention as the post id (`XQUIK_MEDIA_ID_PATH`), and
`postContentToX` gained an optional `{ mediaIds }` that attaches to the FIRST
unit only (a single-image post never chains). **Media-upload idempotency**:
xQuick's contract exposes no client-supplied idempotency key for this
endpoint — a retried upload after a transient failure may create a second,
orphaned media object with no post attached to it (harmless: X never
publishes an unattached upload). This is documented, not invented as a
stronger guarantee. `Publication.idempotencyKey` is never derived from a
media id — the publication's own idempotency identity is untouched by this
phase. The final `externalId` recorded on a Publication is always the POST
id (`tweet-…`), never a media id — proven explicitly in the ambiguity test.

**Compatibility source of truth (drift fixed)**: `KNOWN_FORMAT_CHANNELS` — a
second, hand-maintained allowlist in `opportunity.ts` that could (and had)
drifted from the adapter's real capability — is **deleted**.
`formatChannelError` now calls `channelSupportsFormat(channel, format)`
(`server/content/adapters.ts`), which is a thin read of the registered
adapter's own `supports()`. There is exactly one authority. `createSchedule`
(`server/content/scheduling.ts`) calls the same function **before** creating
a Schedule/Occurrence/Publication, so an incompatible `(format, channel)`
pair (e.g. `carousel` on `x` today) is rejected deterministically at
Opportunity-creation time and again at Schedule-creation time — never
reaching an ambiguous Publication or a futile retry. The Artifact itself is
untouched and remains reusable for a channel that does support it.

**Carousel**: intentionally deferred. The contract is already N-capable
(`PublishRequest.media: PublishMedia[]`, `mediaRefs()` already returns an
ordered array per slide for `carousel`'s payload schema) — implementing
multi-media X delivery later needs no data-model or API change, only a new
transport loop in the adapter. `channelSupportsFormat("x", "carousel")` is
`false` today (X's adapter `supported` set deliberately omits it), so this is
enforced, not merely documented.

**Thumbnail**: reuses the exact same `publishWithMedia` X mechanism as
`image` — no thumbnail-specific adapter code exists.

**Changed files** (no schema/migration changes — everything needed already
existed in `visual_assets` / `visual_asset_refs` / Artifact payload /
`AssetStoragePort`):

| File | Change |
|---|---|
| `server/content/adapters.ts` | `PublishMedia`; `PublishRequest.media`; `createXChannelAdapter` supports `image`/`thumbnail`, `publishWithMedia()` (upload → post, classified-vs-unknown split) |
| `server/social/x.ts` | `uploadMediaToX`; `XQUIK_MEDIA_ENDPOINT` (configurable, default `/x/media`); `postContentToX` gains `{ mediaIds }` |
| `server/content/publication.ts` | `resolvePublicationMedia`, `MediaResolutionError`; `runPublication` resolves media before invoking the adapter |
| `server/artifacts/payloadSchemas.ts` | `PayloadMediaRef`; `PayloadSchema.mediaRefs()`; `image`/`carousel`/`thumbnail` each declare their ordered references |
| `server/content/opportunity.ts` | `KNOWN_FORMAT_CHANNELS` deleted; `formatChannelError` derives from `channelSupportsFormat` (the adapter registry) |
| `server/content/scheduling.ts` | `createSchedule` rejects an undistributable `(format, channel)` pair before creating any Schedule row |
| `server/content/service.ts` | `publicationDeps.storage = visualAssetStorage` — the real `AssetStoragePort` wired into publication |
| `server/content/content.test.ts`, `.../reconcile.test.ts` (existing) | unit coverage: media resolution, exact-revision pinning, owner isolation, adapter capability set, compatibility-authority tests |
| `server/content/content.dbtest.ts`, `creation.dbtest.ts`, `phase15.dbtest.ts`, `recurrence.dbtest.ts`, `recurrence.test.ts`, `chat.test.ts` | register the built-in adapters in `before()`/module scope — required now that format×channel validity is adapter-derived, not a static table |
| `server/content/visualPublication.dbtest.ts` | new — real Postgres + real X adapter + a local `http` double at the xQuick media/post/write-action boundary: golden path with exact-revision-survives-a-newer-revision proof, transient media-upload retry, ambiguous-post→reconcile→published with the real post externalId, recurring image Schedule (2 slots, same pinned Asset), concurrent-duplicate-delivery idempotency (distinct owners) |
| `e2e/fixture/rss-fixture.mjs` | `POST /x/media`, `POST /control/x-media-mode` — doubles the xQuick media-upload boundary, same content-scoped one-shot-arming convention as `/control/x-write-mode` |

**Verified in Phase 7**: tsc 0 · unit 272/0 (59 suites, unchanged count —
Phase 7 coverage added to existing suites) · DB 113/0/0 skipped (15 suites,
+1 file, +5 tests) · live E2E 79/79, 0 failed (regression check only — see
below) · fresh DB migration unchanged (13 migrations, no new one needed,
confirming the "zero migrations" prediction).

**Live E2E scope, honestly stated**: the existing `script/e2e-live.mjs` has
**no HTTP-level path to create an image-format Artifact** — Artifacts are
created either by a generation job (AI-model text completion) or, for
visuals, directly through the domain layer (`createArtifact` +
`insertVisualAssetRef`), which is how every visual DB test builds one. This
is a **pre-existing gap in the authoring surface** (Phase 3 documented the
same boundary: "the visual E2E stops at approval"), not something this phase
introduced or was asked to fix — Phase 7's mandate is the adapter/publication
seam, not an authoring endpoint for image Artifacts. The fixture's
media-upload boundary (`POST /x/media`, `/control/x-media-mode`) is real,
live infrastructure ready for that live-E2E phase once an HTTP path to
create an image Artifact exists; until then, the golden
path/retry/ambiguity/reconciliation/recurrence/idempotency proofs for image
publication live at the **real-Postgres** tier
(`visualPublication.dbtest.ts`), which is the deepest tier this phase's
scope actually required — exactly the same tradeoff Phase 6 made explicitly
for LinkedIn recurrence ("proven at the real-Postgres layer... rather than
repeating every already-proven recurrence scenario a second time"). The
79/79 live E2E run above is a **regression check**: it proves Phase 7's
changes (adapter registry as compatibility authority, `formatChannelError`
rewrite, `resolvePublicationMedia` inserted into `runPublication`) broke
nothing in the five already-live-E2E-proven phases.

**Status labels**:
- Single-image delivery to X (upload → post → Result, retry, ambiguity,
  reconciliation, exact-revision pinning, recurrence, idempotency): **IMPLEMENTED**,
  proven with real PostgreSQL + real adapter code + a genuine external-boundary
  double.
- Thumbnail on X: **IMPLEMENTED** (identical mechanism to image).
- Compatibility source-of-truth (single authority, no drift): **IMPLEMENTED**.
- Carousel / multi-image delivery: **ARCHITECTURALLY READY** (N-capable
  contract, `channelSupportsFormat` correctly returns `false`) but
  **DEFERRED** — not implemented.
- Real image-generation vendor: implemented in Phase 9 (see above); real
  network execution deferred there for the same reason (no credential here).
- Live E2E for the image golden path specifically: closed in Phase 8 below.
- Threads / Instagram / LinkedIn media: **not attempted**, out of scope.

## Phase 8 — visual Artifact HTTP authoring: the missing product path closed (done)

Phase 7 closed the *delivery* seam (VisualAsset → media → X). The remaining
gap was authoring: no HTTP request could create an image Artifact, so the
live application could never exercise the visual path end to end — every
prior visual E2E stopped at a raw SQL insert standing in for the missing
route. Phase 8 closes that gap with the smallest possible extension: one new
generic route, reusing the existing format-driven Artifact contract.

```
POST /api/opportunities/:id/artifacts
  { payload: { visualAssetId, altText?, caption?, role?, aspectRatio? },
    attribution?, attributionReason? }
        ↓ (format/channel taken from the Opportunity — never the request body,
        ↓  so compatibility was already checked at Opportunity creation)
createArtifact()
  1. payloadSchemaRegistry.validate(format, payload)      — schema shape
  2. payloadSchemaRegistry.mediaRefs(format, payload)      — Phase 7 mechanism
  3. for each ref: getVisualAsset → exists? owned? "ready"?   (BEFORE any row)
  4. insertArtifact (draft)
  5. insertVisualAssetRef  — durable audit trail, same pinned revision
        ↓
approve → Schedule → Occurrence → Publication → resolvePublicationMedia
        → X media upload → X post → Result           (Phase 7, unchanged)
```

**No new endpoint shape, no new subsystem.** `POST /opportunities/:id/artifacts`
is the sibling of the existing `GET /opportunities/:id/artifacts`; it calls
the same `createArtifact()` that generation-job completion already calls
(`server/content/generation.ts`). The only change to `createArtifact` itself
(`server/content/artifact.ts`) is the media-reference validation step above —
reusing Phase 7's `payloadSchemaRegistry.mediaRefs()` declaration and the same
existence/ownership/readiness checks `resolvePublicationMedia` already makes
at publish time (defense in depth, not a second implementation). A payload
naming no visual asset (e.g. `x_post`, `linkedin_post`) takes the identical
path it always did — `mediaRefs()` returns `[]`.

**Validation boundary**: schema validation runs first (a malformed payload
never reaches a visual-asset lookup); an unresolved reference throws
`ArtifactMediaReferenceError` **before** `insertArtifact` — no partial
Artifact row, no Schedule, no Publication. Owner mismatch and nonexistent
asset both produce the identical `"not found"` message (mapped to HTTP 404),
so the route never leaks whether a foreign asset id exists — the same
convention the existing `/artifacts/:id/visuals` route already followed.

**Compatibility**: unchanged from Phase 7. `format`/`channel` come from the
Opportunity, whose (format, channel) pair was already checked against the
adapter registry at Opportunity creation (`channelSupportsFormat`). An image
Artifact stays reusable independent of any one channel's support — the
authoritative compatibility gate is still only at Schedule creation.

**Approval / revision / idempotency**: all unchanged — the normal Artifact
readiness machine (`draft → in_review → approved`), the normal revision chain
(`/artifacts/:id/revise`), and the existing "repeated authoring creates a new
draft revision" behavior (no synthetic idempotency was invented here; the
route is a thin `createArtifact` call, same as generation, which has never
promised de-duplication for human-initiated creation).

**Live E2E — the previously-missing path, now exercised for real**
(`script/e2e-visual.mjs`, extended): the image Artifact in this harness is now
created via `POST /api/opportunities/:id/artifacts` over real HTTP (the raw
SQL insert this harness used before is gone), then carried all the way through
`approve → Schedule → dispatch → Publication → Result` against a real running
app, real PostgreSQL (`cf_e2e_live`), real pg-boss, and a new minimal xQuick
double (`/x/media`, `/x/tweets`) local to this harness — the only doubled
boundary, exactly mirroring how `e2e/fixture/rss-fixture.mjs` doubles the same
boundary for `e2e-live.mjs`. 13/13 checks pass, including: nonexistent/foreign
VisualAsset rejected by the new route (404, before any row); the published
Result carries `metrics.mediaCount === 1`; the final Artifact's payload still
names the exact original `visualAssetId` after publication.

**Verification**: `tsc` 0 errors; unit 278/278 (+6: image-authoring validation
cases in `content.test.ts`); real PostgreSQL 117/117 (+4: authoring
existence/owner/readiness/reuse cases in `visualPublication.dbtest.ts`, real
rows); `test:e2e:visual` 13/13 (new: the HTTP authoring path itself);
`test:e2e:live` regression unchanged at 79/79. Zero migrations — `Artifact`,
`visual_assets`, `visual_asset_refs`, and the adapter registry already carried
everything this phase needed.

**Status labels**:
- Visual generation: **IMPLEMENTED** (Phase 3, unchanged).
- Visual Artifact HTTP authoring: **IMPLEMENTED** — the product path from an
  external client request through to an approved, schedulable image Artifact.
- X image/thumbnail delivery: **IMPLEMENTED** (Phase 7, unchanged; now proven
  live from HTTP authoring rather than from a DB-seeded Artifact).
- Carousel: **ARCHITECTURALLY READY / DEFERRED** (unchanged from Phase 7).
- Real image-generation vendor: **DEFERRED** (unchanged; still the fixture
  provider).
- Threads / Instagram / LinkedIn media: **not attempted**, out of scope.

## Phase 6 — first non-X channel adapter: LinkedIn text publishing (done)

Proves the `Artifact → Schedule → Occurrence → Publication → ChannelAdapter →
Result` pipeline is genuinely channel-agnostic by adding the second channel.
No new abstraction, no new table, no migration, no core `if (channel ===
"linkedin")` branch anywhere.

```
same canonical payload shape ({ text }) → registered per format, not per channel
   x_post   (280 chars,  channel=x)         ─┐
   linkedin_post (3000 chars, channel=linkedin) ─┴─ both validated by payloadSchemaRegistry,
                                                     both resolved by getFormatProfile(format, channel)

Publication.channel := Artifact.channel (unchanged mechanism, scheduling.ts)
        ↓
getChannelAdapter(channel) → LinkedInAdapter | XAdapter   (registry lookup, no branch)
```

**Why `linkedin_post` is a new format, not a channel flag on `x_post`:**
`server/artifacts/payloadSchemas.ts` already named `linkedin_post` in its own
doc comment as the next format to register, and `content.test.ts` already
asserted `hasFormatProfile("linkedin_post","linkedin") === false` as a
placeholder — the schema architecture is per-`(format, channel)` pair
(`formatProfiles.ts`, `KNOWN_FORMAT_CHANNELS` in `opportunity.ts`), not
per-channel, so a new channel with the same canonical content shape (a single
body of text) is a new *format* registration, never a code branch. The
payload shape (`{ text: string }`) is identical to `x_post`'s — only the
character limit (3000 vs 280) differs, which is exactly what per-format
`limits`/`constraints` already exist for.

**LinkedIn transport (`server/social/linkedin.ts`), real REST contract:**
`POST /rest/posts` (LinkedIn Posts API — `author`, `commentary`, `visibility`,
`distribution`, `lifecycleState`), `Authorization: Bearer`, `LinkedIn-Version`,
`X-Restli-Protocol-Version` headers. Unlike xQuick, this is a *synchronous*
API with no write-action/poll protocol — either an HTTP response arrives
(decisive: 2xx → `x-restli-id` response header is the provider URN; non-2xx →
classified failure) or the transport itself fails before a response arrives
(timeout/reset), which is the *only* ambiguous case.

**Semantic decisions locked this phase:**

- **Ambiguity is modeled at the network layer, not a provider protocol**,
  because LinkedIn's Posts API has none: `postTextToLinkedIn` catches a
  `fetch()` failure (not an HTTP error response) and throws
  `LinkedInPublishAmbiguousError` carrying `{ commentary, attemptedAt }` — the
  exact pinned text and the moment of the attempt, since LinkedIn issues no
  request/write-action id of its own to re-check later.
- **Same `reconciliationHint` field, different content**: the X adapter
  populates it with `{ writeActionId }`; the LinkedIn adapter populates it
  with `{ commentary, attemptedAt }`. The field stays generic/opaque at the
  `PublishRequest` interface — only the adapter that produced a hint knows
  how to read it back.
- **Reconciliation can confirm "published" but never safely confirm "not
  published."** `reconcileLinkedInPost` re-lists the author's recent posts
  (`GET /rest/posts?q=author&author=...`) and matches on exact `commentary` +
  a creation time at or after the attempt. A match → confirmed published,
  same as X. A miss returns `pending` (mapped to the existing `null` = "still
  unknown" contract) — **never** "confirmed not published": LinkedIn's
  listing endpoint has no documented consistency/completeness guarantee, so
  absence is not proof of absence (the same principle X's `reconcile()`
  already applies to a tweet-lookup miss, taken to its honest conclusion
  where the provider gives strictly less to work with). This is a genuine
  provider-capability difference from X, not a shortcut: X's xQuick reports
  an authoritative `failed` status for a write action; LinkedIn's Posts API
  has no equivalent, so a stuck-unknown LinkedIn Publication is bounded by
  the same `MAX_RECONCILE_ATTEMPTS` (5, unchanged from Phase 5) rather than
  ever resolved to a synthesized "not published."
- **No provider-side duplicate protection.** LinkedIn's Posts API has no
  client-supplied idempotency key in its public contract — two identical
  `POST /rest/posts` calls create two posts. Duplicate suppression is
  entirely ContentForge's own: `Publication.idempotencyKey` (unique
  constraint) plus pg-boss's queue-level dedup are the only guarantees; this
  is a documented boundary, not a claim of provider-side exactly-once
  delivery.
- **Cross-channel independence, honestly scoped.** `Publication.channel` is
  derived from `Artifact.channel` at Schedule-creation time
  (`scheduling.ts`), a field fixed on the Artifact — so one Artifact *row*
  cannot literally target two channels. "The same Artifact independently
  publishes to X and LinkedIn" is proven at the level that actually matters
  for the invariant (a failure in one channel must not corrupt another): two
  channel-specific Artifacts from the same Story/Opportunity lineage, each
  independently scheduled, leased, and reconciled, with no shared runtime
  state — see the `content.dbtest.ts`-style cross-channel test in
  `server/content/linkedin.dbtest.ts`.
- **Credentials**: same boundary as X — `storage.getConnectedAccount("linkedin")`
  for the access token/author URN, with `LINKEDIN_ACCESS_TOKEN` /
  `LINKEDIN_AUTHOR_URN` env override for wiring, same as `XQUIK_*`. Never
  logged, never returned from any API response, never persisted outside the
  existing `connected_accounts` row.

**Changed files** (no schema/migration changes):

| File | Change |
|---|---|
| `server/social/linkedin.ts` | new — LinkedIn Posts API transport: `postTextToLinkedIn`, `LinkedInPublishAmbiguousError`, `reconcileLinkedInPost`, `translateLinkedInError` |
| `server/artifacts/payloadSchemas.ts` | `linkedin_post` payload schema (`{ text }`, 3000-char limit) registered |
| `server/content/formatProfiles.ts` | `linkedin_post`/`linkedin` format profile (prompt guidance + constraints) |
| `server/content/opportunity.ts` | `KNOWN_FORMAT_CHANNELS.linkedin_post = ["linkedin"]` |
| `server/content/adapters.ts` | `createLinkedInChannelAdapter`, `classifyLinkedInFailure`; registered in `registerBuiltinChannelAdapters` |
| `server/content/model.ts` | generation payload-shape hint for `linkedin_post` |
| `server/content/content.test.ts` | LinkedIn adapter unit tests (format gating, empty-payload rejection, failure classification, reconcile-without-hint); two Phase-5-era placeholder assertions updated now that `linkedin_post` is genuinely implemented |
| `server/artifacts/payloadSchemas.test.ts` | LinkedIn payload validation tests; "unregistered format" test moved off the now-registered `linkedin_post` name |
| `server/content/linkedin.dbtest.ts` | new — real Postgres + real LinkedIn adapter + a plain local `http` double at the LinkedIn boundary only: golden path, ambiguous→unknown, reconciliation-discovers→published, still-unknown/restart-equivalent (never confirmed-not-published), cross-channel independence, recurrence |
| `e2e/fixture/rss-fixture.mjs` | `POST/GET /rest/posts`, `/control/linkedin-mode`, `/control/linkedin-record-post` — doubles the LinkedIn Posts API boundary only |
| `script/e2e-live.mjs` | new live phase: LinkedIn golden path, ambiguous→reconcile→published, cross-channel independence with X |

Verified in Phase 6: tsc 0 · unit 266/0 (59 suites, +1) · DB 108/0/0 skipped
(14 suites, +6) · live E2E 79/79, 0 failed (real app, real Postgres, real
pg-boss; all 4 LinkedIn checks green: golden path, ambiguous→unknown,
reconcile→published, cross-channel independence with X; zero regression
across every earlier phase's checks) · fresh DB migration unchanged (13
migrations, no new one needed). Recurrence-through-LinkedIn is proven at the
real-Postgres layer (`linkedin.dbtest.ts`, 6 tests); the live E2E adds the
golden path, ambiguity/reconciliation, and cross-channel checks rather than
repeating every already-proven recurrence scenario a second time.

Two live-E2E rate-limit cascades were found and fixed as part of hardening
this run (test-harness only, no production code touched): the cross-channel
check's generation poll was tightened from 300ms to 1000ms, and the shared
`http()` retry helper's backoff window was widened (6×2s → 12×2s) so a
transient 429 under this phase's added request volume self-heals instead of
failing the check outright — the same class of fix Phase 5 already applied
to its own reconciliation polling.

## Phase 5 — X publication reconciliation (done)

Turns `reconcile()` from a stub into a real durable capability of the
existing `Publication → ChannelAdapter → Result` boundary. No new
abstraction, no new table, no migration.

```
publish() ambiguous (transport invoked, outcome unconfirmed)
        ↓
Publication: state=failed, providerCalled=true   Result: outcome=unknown, metrics={writeActionId}
        ↓ (periodic tick / manual dispatch, reuses the publication lease)
adapter.reconcile() — tri-state
        │
        ├─ null            → still unknown; state stays "failed" (never stuck "publishing"); durably
        │                     bounded by publications.attempt (existing column) via MAX_RECONCILE_ATTEMPTS
        ├─ { ok: true }     → recordPublished(): SAME Result row updated unknown→published (never a
        │                     second row), Publication→published, Occurrence→published, schedule
        │                     exhaustion check — identical code path as a normal successful publish
        └─ { ok: false }    → confirmed NOT published: unknown Result deleted, SAME Publication row
                              reset to queued/providerCalled=false, re-queued through the existing
                              durable job (never calls publish() inline, never a new Occurrence)
```

**Semantic decisions locked this phase:**

- **What enters `unknown`** (unchanged from Phase B, just finally acted on):
  the adapter's transport was invoked (`providerCalled: true`) and the
  outcome could not be established — for X specifically, xQuick accepted a
  write (202 + `writeActionId`) but polling gave up before it resolved
  (`XWriteActionPendingError`). Ordinary deterministic failures (config
  missing, 4xx, invalid payload) are still classified `permanent`/`transient`
  and never touch this path.
- **Tri-state reuses the existing `PublishOutcome | null` contract** — no new
  type. `null` = still unknown, `{ok:true}` = confirmed published, `{ok:false}`
  = confirmed NOT published. The adapter, not the caller, decides which:
  a read-API miss (`fetchTweetTextByIdViaOfficialApi` returning `null`) is
  explicitly treated as *still unknown*, never as "confirmed absent" — a miss
  proves nothing (private, deleted, rate-limited, or a misconfigured read
  endpoint all look identical).
- **Durable identifier**: `PublishRequest.reconciliationHint` — a new,
  generic (`JsonRecord`), adapter-opaque field on the existing interface. X
  populates it with `{ writeActionId }` captured from the ambiguous
  `publish()` attempt's `PublishOutcome.metrics` (already-existing field,
  simply no longer discarded); it is read back from the durable `unknown`
  Result's own `metrics` column — no new table, no Publication schema change.
- **Result stays durable, but `unknown` is provisional by definition**:
  `insertResult`'s `ON CONFLICT (publication_id) DO UPDATE ... WHERE outcome
  = 'unknown'` (Postgres compare-and-set) resolves an unknown Result in
  place; a `published`/`failed` Result is still immutable (unaffected — the
  `WHERE` guard simply never matches). Confirmed-not-published instead
  *deletes* the provisional row (`deleteUnknownResult`, itself
  compare-and-set on `outcome = 'unknown'`) so the eventual real outcome of
  the re-queued attempt gets its own clean row.
- **Confirmed-not-published's "safe next action"**: reset the *same*
  Publication row (same idempotency key) to `queued` and re-enqueue through
  the existing durable job — identical mechanism to an ordinary transient
  failure's retry. No new Occurrence, no new row, no inline `publish()` call.
- **Concurrency**: reconciliation reuses `acquirePublicationLease` (which
  already allowed leasing from `state = "failed"` — this seam pre-existed and
  was simply never wired up). The DB lease is the sole arbiter; no in-memory
  lock exists or is needed.
- **Durable bound**: `publications.attempt` (existing column, already
  incremented by every lease acquisition) — once a Publication has been
  leased `MAX_RECONCILE_ATTEMPTS` (5) times, it is left `unknown`
  permanently for an operator rather than checked forever. The bound lives
  in Postgres, survives restart.
- **Where reconciliation runs**: the existing periodic content-scheduler tick
  (same cron that already ran `reconcileStalePublications`) now also runs
  `reconcileUnknownPublications`; `POST /api/publications/dispatch` (the
  existing manual-tick endpoint) runs it too, for a deterministic trigger in
  tests/operators. No new endpoint, no new job type, no new scheduler.

**Changed files** (no schema/migration changes):

| File | Change |
|---|---|
| `server/social/x.ts` | `XWriteActionPendingError` (carries the durable `writeActionId`); `checkXQuickWriteAction`/`reconcileXQuickWriteAction` (one non-throwing status check, reused by both the original poll loop and reconciliation) |
| `server/content/adapters.ts` | `PublishRequest.reconciliationHint`; X adapter's `publish()` catch captures `writeActionId` into `outcome.metrics`; X adapter's `reconcile()` implemented (writeActionId lookup, externalId lookup fallback, tri-state) |
| `server/content/publication.ts` | `recordPublished()` extracted (shared by normal publish and reconciliation); `reconcileUnknownPublications()`, `MAX_RECONCILE_ATTEMPTS`; ambiguous branch now persists `outcome.metrics` |
| `server/content/storage.ts` | `insertResult` upsert-into-unknown-only via `onConflictDoUpdate` + `setWhere`; `deleteUnknownResult`; `listUnknownPublications` |
| `server/content/service.ts` | cron tick also runs `reconcileUnknownPublications`; enqueue closure extracted and shared |
| `server/content/routes.ts` | `/api/publications/dispatch` also runs reconciliation, returns `reconciled` stats |
| `server/content/reconcile.test.ts` | unit: tri-state handling, durable bound, concurrency-skip, duplicate-reconcile idempotency, metrics passthrough |
| `server/content/reconcile.dbtest.ts` | real Postgres + real X adapter + a plain local `http` double at the xQuick boundary only: golden path, confirmed-not-published, still-unknown/restart-equivalent, concurrent reconciliation, recurring-schedule interaction |
| `e2e/fixture/rss-fixture.mjs` | `/control/x-write-mode`, `/control/x-resolve-write-action`, `GET /x/write-actions/:id` — simulates xQuick's async write-action protocol |
| `script/e2e-live.mjs` | new live phase: ambiguous → reconcile → published; confirmed-not-published → re-queued → retried → published; both proven with exactly one final Result and no duplicate Occurrence |

Verified in Phase 5: tsc 0 · unit 259/0 (58 suites) · DB 102/0/0 skipped (13
suites) · live E2E 75/75 (all 3 reconciliation checks green across two
consecutive full runs; a pre-existing, unrelated pg-boss/research queue
timing flake — documented before this phase — surfaced once per run in an
earlier phase, never in reconciliation) · fresh DB migration unchanged (13
migrations, no new one needed).

## Phase 4 — recurrence expansion (done)

Expands the existing `Schedule → Occurrence` primitive to support durable
recurring series. No new subsystem, no new table, no migration — the schema
already anticipated this (`schedules.recurrence`, `schedules.count`) and the
occurrence uniqueness constraint already made materialization idempotent.

```
Schedule (recurrence, count, startAt) → Occurrence[0..count-1] → Publication → Result
```

**Semantic decisions locked this phase:**

- **Recurrence grammar**: `every:<n><unit>` (unit one of `m`/`h`/`d`/`w`), a
  bounded fixed-interval representation — deliberately *not* RRULE/cron. Max
  interval 90 days. `recurrence` absent ⇒ one-shot (`count` must be 1);
  `recurrence` present ⇒ `count >= 2`.
- **No mutable cursor column.** The durable "next occurrence index" is
  *derived*: `count(ScheduleOccurrence rows for this schedule)`. The n-th
  occurrence's time is `startAt + n * interval`, computed fresh every tick.
  `(schedule_id, occurrence_time)` (pre-existing unique index) remains the
  single arbiter — concurrent ticks computing the same index collapse to one
  row via `ON CONFLICT DO NOTHING`, proven under real concurrent load against
  Postgres and against the live running app.
- **Catch-up policy: one slot per schedule per tick**, oldest-due-first. A
  schedule that missed N slots while offline drains one slot per tick until
  it reaches `now`, then resumes normal cadence. Never bursts, never silently
  skips a slot — total occurrences remain bounded by `schedule.count`.
- **Timezone**: `timezone` stays stored metadata only, exactly as it already
  was for one-shot `startAt`. Recurrence advances the same absolute UTC
  instant by a fixed duration; no calendar/DST-aware wall-clock semantics are
  introduced (the existing one-shot model never had them either).
- **Exhaustion**: a schedule transitions to `status = "exhausted"` the moment
  its last occurrence materializes (this also fixes a latent inefficiency in
  the pre-existing one-shot path, which never left `active` and was rescanned
  every tick forever).
- **Retry ≠ recurrence, regeneration ≠ recurrence** (both explicitly tested):
  a publication retry never advances the recurrence cursor (the cursor is the
  occurrence *count*, unaffected by an occurrence's publication status); the
  scheduler never touches GenerationJob/Artifact — every recurring slot
  publishes the exact same pinned Artifact revision.

**Changed files** (no schema/migration changes):

| File | Change |
|---|---|
| `server/content/scheduling.ts` | `parseRecurrenceIntervalMs`, `computeOccurrenceTime`, recurrence validation in `createSchedule`, one-slot-per-tick materialization + exhaustion in `dispatchDueOccurrences` |
| `server/content/storage.ts` | `countOccurrences(scheduleId)` — the derived cursor read |
| `server/content/recurrence.test.ts` | unit: grammar, index arithmetic, `createSchedule` validation, bounded catch-up, exhaustion, concurrent-tick dedup, retry-vs-recurrence |
| `server/content/recurrence.dbtest.ts` | real Postgres: persistence, catch-up, exhaustion, concurrent dedup via the DB constraint, restart-equivalent recovery (fresh storage instance, same cursor), one-shot regression |
| `server/content/visual.dbtest.ts` | unrelated pre-existing cleanup bug fixed in passing: `after()` deleted artifacts before publications/schedules referencing them, 23503 on any DB run that actually scheduled/published a visual-pipeline artifact |
| `script/e2e-live.mjs` | new live phase: malformed recurrence rejected, bounded catch-up (3 overdue slots → 1 materializes), restart survival (kill/restart mid-series, cursor resumes correctly), concurrent-tick dedup over HTTP, 3 Publications → 3 Results all pinned to one Artifact revision |

Verified in Phase 4: tsc 0 · unit 252/0 (56 suites) · DB 96/0/0 skipped (12
suites) · live E2E 72/0 · fresh DB migration unchanged (13 migrations, no new
one needed) · existing DB upgrade unaffected.

## Phase 3 — visual intelligence foundation (in progress)

Durable, provider-agnostic visual layer. Three locked concerns, kept separate:

```
VisualIntent (what content wants) → VisualProduction (external mechanism)
→ VisualAsset (durable immutable revision) → artifact.payload reference
```

Visuals enter the lifecycle through generation, never attached to Stories.
An Artifact references a visual by (asset id + revision); approval still belongs
to the exact Artifact revision.

| Module | Responsibility |
|---|---|
| `shared/schema.ts` + `migrations/0012_majestic_microbe.sql` | `visual_generations` (durable request, UNIQUE idempotency), `visual_assets` (immutable revisions via DB trigger), `visual_asset_refs` (artifact↔asset audit trail) |
| `server/content/visual.ts` | Provider contract (declared capabilities, deterministic selection), output validation (MIME allowlist, SVG ban, size/dimension ceilings), local content-addressed storage seam |
| `server/content/visualService.ts` | Async execution: validate → store → persist; idempotent claims; transient vs permanent; revisions via `supersedes_id` |
| `server/content/service.ts` | `visual.run` job type + `visualAssetStorage` composition; registered at startup |
| `server/content/routes.ts` | `POST/GET /visual-generations`, `GET /visual-assets`, attach + audit endpoints |
| `server/content/visualFixture.ts` | Deterministic double emitting a real 1×1 PNG (test/E2E boundary) |
| `server/artifacts/payloadSchemas.ts` + `formatProfiles.ts` | `image` / `carousel` / `thumbnail` schemas and profiles; carousel keeps slides independently addressable |

Decisions:

- **No binary blobs in Postgres** — only `storage_key` (`local:<sha>` for the
  local impl; S3/R2 swap changes the port, not the domain).
- **Immutable assets via trigger** (mirrors the artifacts trigger): content
  columns frozen, lifecycle `status` mutable.
- **Optional vs required visuals** live in the format-profile `visual`
  constraint: `image`/`carousel`/`thumbnail` mark `required`; text formats have
  none, so they degrade to text-only by default.
- **Failure taxonomy matches the rest of the system**: transient → real pg-boss
  retry; permanent/invalid → terminal; invalid provider output never persists.
- **Carousel is structured**: ordered slides, each a real asset reference.
- **video_script / Video Factory**: contract/boundary only; no rendering code,
  no renderer imports.

Verified in Phase 3: tsc 0 · unit 237/0 · DB 90/0/0 skipped · live E2E 65/0 ·
fresh DB 46 tables/13 migrations · existing DB upgrade clean · external smoke
(hnrss.org) non-gating.

## Phase 1.5 — creation intelligence hardening + product surface

Turns the Phase 1 primitives into a durable, editable, version-safe, schedulable
foundation. Still no parallel content model and no provider coupling.

| Area | What changed |
|---|---|
| **Artifact revisions** | `POST /api/artifacts/:id/revise` (human edit → NEW revision, `provenance=human_edit`, starts `draft`, stale-base guarded with 409) and `GET /api/artifacts/:id/history` (full chain). Prior revisions, their approvals and their pinned Publications are never touched. |
| **Policy composition** | `composeGenerationPolicyInput()` centralizes defaulting from the Opportunity; validation (format × channel profile, template compatibility, voice/template existence + archived, undeclared template variables) lives in exactly one place. `resolveGenerationPolicy` now uses an **indexed** `get_generation_policy_by_spec_hash` lookup instead of scanning the table. |
| **Voice authoring** | `voices.voice_key` + `version`; `POST /voices/:id/revise`, `/archive`, `GET /voices/:id/revisions`; reuses `actor`/per-user conventions. Revisions are immutable. |
| **Template authoring** | `content_templates.template_key` + `version`; `/revise`, `/archive`, `/revisions`. Deterministic rendering (`renderTemplateStructure`) with explicit `[missing: var]` markers; placeholders not declared as variables are rejected at policy resolution — never silently dropped. |
| **Chat hardening** | `opportunities.chat_key` (UNIQUE) gives durable chat idempotency: a repeated request reuses the Opportunity **and its GenerationJob**; an explicit `regenerate` bypasses reuse and creates a new job. Concurrent duplicates are settled by the unique index. |
| **Scheduler tick** | `startContentScheduler()` — a real periodic cron (enabled independently of `DISABLE_CRON` via `CONTENT_SCHEDULER_ENABLED=1`). It materializes due Occurrences and enqueues `publication.run`; it never publishes. Duplicate dispatch is prevented **in PostgreSQL**: a `pending → enqueued` compare-and-set (`markOccurrenceStatusIf`) plus the UNIQUE publication identity. `enqueued` occurrences are re-examined so a crash before enqueue self-heals. |
| **Recurrence** | Still deferred, and now explicitly so: `recurrence`/`count > 1` are rejected with a clear error rather than faking an expansion. The durable seam (columns + occurrence table) exists for a later phase. |
| **Indexes** | `schedules(status, start_at)` and `schedule_occurrences(status, occurrence_time)` back the due-scan; `(voice_key, version)` / `(template_key, version)` / `opportunities.chat_key` are UNIQUE. |

Invariants added/kept: changing a Voice or Template after a GenerationJob exists
never changes that job's frozen request (proved in DB tests and live E2E);
approval never carries to a new revision; a Publication stays pinned to the exact
revision it was created for.

## Phase 1 — creation intelligence (CannerAI parity)

Adds the creation layer on top of the core lifecycle, without a second content
system:

```
Story → Opportunity → GenerationPolicy → GenerationJob → Artifact
```

| Module | Responsibility |
|---|---|
| `shared/schema.ts` + `migrations/0008_damp_mole_man.sql` | `voices`, `content_templates`, `generation_policies` (immutable, content-addressed revisions); `generation_jobs.policy_id` |
| `server/content/policy.ts` | Resolve a policy from voice/template/format × channel; assemble the effective request; spec hashing |
| `server/content/formatProfiles.ts` | Platform-aware formatting config (x_post / x_thread only — no fake placeholders) |
| `server/content/chat.ts` | Chat-to-post: message → human Story → Opportunity → GenerationJob |
| `server/content/model.ts` | Gateway adapters for generation **and** chat-intent (no provider named outside this file) |
| `server/content/artifact.ts` | `createHumanEditRevision` — human edits are new revisions, never overwrites |
| `server/content/generation.ts` | Job creation pins the policy revision + frozen snapshot; regeneration semantics |

Key decisions:

- **GenerationPolicy is the central primitive.** It is generic (no
  `XGenerationPolicy`); `format × channel` stay dimensions, platform behaviour
  comes from the format profile, and payload validation stays in the registry.
- **Policies are immutable and content-addressed.** `spec_hash` is UNIQUE and
  derived from the resolved contents (including voice/template content hashes), so
  resolving the same spec reuses a revision and editing a voice/template
  necessarily produces a new one. A GenerationJob pins `policy_id` *and*
  snapshots the fully rendered request.
- **Idempotency is explicit.** Same (opportunity, policy spec) → the same job
  (duplicate delivery). An explicit `regenerate` nonce → a new job and therefore
  a new Artifact revision linked by `supersedes_id`.
- **Chat is a source of meaning, not a model.** It creates an ordinary
  human-provenance Story (no research) and an ordinary Opportunity; there is no
  chat-only entity.
- **No new abstraction for AI.** Both generation and chat-intent go through the
  existing `server/ai` gateway behind ports; providers are infrastructure.

## Slice B6 — core content lifecycle (done)

The complete core chain is now real and exercised through the running app:

```
ResearchJob → Story → Opportunity → GenerationJob → Artifact
            → approval → Schedule → Occurrence → Publication → Result
```

| Module | Responsibility |
|---|---|
| `shared/schema.ts` + `migrations/0007_dusty_preak.sql` | 7 additive tables + FKs + indexes; a DB **trigger** makes Artifact content immutable |
| `server/content/storage.ts` | Persistence for all six new entities; conditional-UPDATE lease; idempotent claims |
| `server/content/opportunity.ts` | Story → Opportunity; proposed/selected/killed; format×channel validity |
| `server/content/generation.ts` | Frozen policy, deterministic idempotency key, GenerationJob execution |
| `server/content/model.ts` | Default model adapter over the **existing** `server/ai` gateway (`aiCall`) |
| `server/content/artifact.ts` | Immutable revisions + `draft → in_review → approved \| rejected` |
| `server/content/scheduling.ts` | Schedule (series) → Occurrence; the scheduler owns WHEN, never publishes |
| `server/content/publication.ts` | Single-flight lease, reconcile-first unknown handling, Result |
| `server/content/adapters.ts` | `ChannelAdapter` port + X adapter over the existing `postContentToX`/xQuick |
| `server/content/service.ts` | Composition root + `generation.run` / `publication.run` job types |
| `server/content/routes.ts` | Opportunity/Generation/Artifact/Schedule/Publication API |

Decisions worth recording:

- **Provider-agnostic generation.** The domain depends on `GenerationModelPort`;
  only `model.ts` names a provider, and it wraps the existing gateway. No second
  AI abstraction, no provider-specific billing (`cost` is recorded as null).
- **Artifact immutability is enforced by Postgres**, not by convention: a
  `BEFORE UPDATE` trigger rejects any change to payload/format/channel/parents,
  so revisions must be new rows linked by `supersedes_id`.
- **Publication identity is durable**: `schedule × occurrence × artifact revision`
  is a UNIQUE column, and acquisition is a conditional `UPDATE`, so two workers
  cannot publish the same occurrence twice. A lease holder that died is parked as
  an `unknown` Result (`reconcile_required`) rather than retried blindly — an
  external request that was sent is never assumed successful.
- **One-shot schedules only in Phase B.** Recurrence strings are stored but not
  expanded; RRULE expansion is deliberately future work rather than invented
  interval semantics.
- **No re-research for a new format**: a second format is a second Opportunity on
  the same Story, proven by unchanged research row counts.

## Slice B5 — provider-failure semantics (LOCKED)

**Decision (2026-09-12):** locked Ticket 04 §2 ("provider failures degrade to
partial results and **never fail the job unless zero sources survive**";
restated in `RESEARCH-PROVIDERS.md` §13) says *when* the job fails but not *how*.
The class is now decided:

| Case | Condition | Outcome |
|---|---|---|
| **A** | every attempted provider **failed** | job is **failed** with a recoverable class — `rate_limited` if all were rate limited, else `transient` if all were transient/rate-limited, else `permanent`. Transient/rate-limited runs **retry/reschedule** instead of dead-lettering. |
| **B** | some providers succeeded, some failed | job **completes** (partial research); failed calls are retained on `research_jobs.diagnostics`. |
| **C** | providers ran and produced nothing usable | job is **failed permanent** (`no_sourced_evidence`) — the run succeeded, there is genuinely no evidence. |

Implemented in the pure `summarizeCollection` / `classifyEmptyCollection`
(`server/research/engine-core.ts`), applied by the engine before validity
handling. Case B was already correct; Case A previously collapsed into Case C,
so a recoverable provider outage dead-lettered. `engine.dbtest.ts` now asserts
Case A (transient) and Case C (permanent); `engine-core.test.ts` covers the
classification matrix.

## Slice B2 — vertical integration (done)

API → ResearchJob → pg-boss → `research.run` → RSS SourceProvider →
`NormalizedSource` → research engine → persisted sources/evidence.

| Module | Responsibility |
|---|---|
| `server/jobs/bootstrap.ts` | Owns the single JobRuntime; start/stop lifecycle; job registration |
| `server/research/job.ts` | `research.run` job type; engine-outcome → failure-class mapping |
| `server/research/config.ts` | Generic per-provider config resolution |
| `server/research/providers/rssConfig.ts` | RSS provider config from existing `rss_sources` |
| `server/research/service.ts` | Composition root (storage + engine + executor) |
| `server/research/routes.ts` | `POST /api/research/jobs`, `GET /api/research/jobs/:id[/sources|/evidence]` |

- `server/index.ts` starts the job runtime after migrations/seed and stops it on
  SIGTERM/SIGINT (graceful, in-flight work allowed to finish).
- The HTTP layer only persists the job and enqueues; research never runs inline.
- Idempotency is durable: `research_jobs.idempotency_key` UNIQUE is the arbiter,
  with pg-boss `singletonKey` as a scheduling-level guard.
- `0003_spooky_reptil.sql` was made idempotent (`IF NOT EXISTS`) so the migration
  chain can bootstrap a fresh database. `0003` was never applicable (it replayed
  `0002`'s DDL and rolled back in the same transaction), so this repairs an
  unapplied migration rather than rewriting applied history.

## Slice B3 — `ResearchJob → Story` (done)

The first canonical domain transition after research. A Story is the reusable
unit of editorial meaning (Ticket 05 §3); it references its ResearchJob and that
job's evidence **by ID only** and never copies research content.

```
POST /api/stories (ResearchJob id + synthesis)
→ Story service: load ResearchJob → require `complete` → require ≥1 evidence
→ INSERT stories (research_job_id FK, evidence_refs IDs, lifecycle draft)
→ 201 Story
```

| Module | Responsibility |
|---|---|
| `shared/schema.ts` (`stories`) | Durable Story: FK `research_job_id`, provenance, title, insight body, angles, evidence refs, lifecycle |
| `migrations/0006_classy_hannibal_king.sql` | Additive `stories` table + FK + 2 indexes (generated by `drizzle-kit generate`) |
| `server/story/storage.ts` | `StoryStoragePort` + Drizzle implementation |
| `server/story/service.ts` | `createStoryFromResearch`; rejection taxonomy; evidence-ref validation |
| `server/story/routes.ts` | `POST /api/stories`, `GET /api/stories/:id`; domain → HTTP mapping |
| `server/research/storage.ts` | additive `listEvidenceIds` (ID-only provenance accessor) |

- Story lifecycle is `draft → ready → used | archived` with **no kill state**
  (killing is Opportunity-level). `used` is informational, so Stories keep
  spawning formats. Creation may only be `draft` or `ready`.
- **Multiple Stories per ResearchJob are legitimate** (Ticket 03 §3), so there is
  deliberately **no** idempotency key and **no** one-story-per-job constraint at
  this layer. POST is not idempotent by design.
- The service/route surface exposes **no queue and no provider** — a Story can
  never re-run research (structurally, not by convention).
- `basis_claim_ids` (Ticket 05 §3) is **not** persisted yet: claims are not a
  persisted entity in the research slice, so an ID array here could not be
  validated and would let unverifiable IDs masquerade as provenance. Deferred,
  not invented.
- Story versioning/editing is **not** specified by the locked map; this slice
  implements creation only and introduces no versioning semantics.

## Slice B4 — live E2E verification of the running app (done)

`npm run test:e2e:live` → `script/e2e-live.mjs` (+ `e2e/fixture/rss-fixture.mjs`,
documented in `e2e/LIVE-E2E.md`). It never imports application code: it starts the
real production bundle as a child process, the real pg-boss worker, and a
deterministic RSS fixture published on **host port 80**, then drives the real
HTTP API with a session cookie + CSRF token and asserts durable state in both the
`public` and `pgboss` schemas.

Verified live (33/33): research HTTP → ResearchJob → pg-boss → worker → RSS
provider → NormalizedSource → engine → sources/evidence → complete; Story
derivation with no re-research (job/source/evidence counts unchanged); Story
failure paths 400/404/409 (incomplete and failed)/422; permanent failure → DLQ;
transient failure → real pg-boss retry → eventual success on the *same*
ResearchJob; process kill + restart with durable state and pg-boss re-delivery;
correlation id traceable across HTTP, DB, queue envelope and logs. One optional,
non-gating external smoke against `hnrss.org` completed with 20 real sources.

### Findings recorded by live verification

1. **Runtime command.** `npm run dev` (tsx/ESM) fails on Node 24 at
   `server/index.ts`'s `path.join(__dirname, "migrations")` — `__dirname` is
   undefined in ESM. Pre-existing and unrelated. The supported runtime (production,
   Playwright E2E, and this harness) is the built CJS bundle:
   `npm run build && node dist/index.cjs`.
2. **Deterministic fixtures need port 80.** The SSRF syntax gate allows only
   `http(s)` on 80/443 and rejects URL *IP literals* in non-routable space, so a
   local fixture must be fetched as a hostname on port 80. Docker publishes it
   without root; no SSRF control was weakened.
3. **Provider-transient failures become job-permanent failures.** The RSS provider
   correctly raises `JobFailure.transient` when every feed fails, but the engine's
   partial-failure tolerance (Ticket 04 §2) degrades that to an empty collect →
   `no_sourced_evidence` → a **permanent** ResearchJob failure and a DLQ entry,
   with no retry. The transient retry path is reachable when the failure happens
   *after* collection (e.g. persistence), which is what the live retry test
   exercises. Worth an explicit decision: should "all providers failed
   transiently" fail the job transiently so it retries?
4. **pg-boss v10 mechanics.** `pgboss.job` is one partitioned table for every
   queue (the DLQ is a queue named `<jobType>.dlq`); a thrown job sits in
   `state='retry'` with a future `start_after` and `retry_count` stays 0 until the
   retry actually starts (it becomes 1 while running).
5. **Environment.** This machine intermittently freezes the app process for
   several minutes (observed as 5–12 minute gaps with no logs, delaying worker
   pickup). The harness is hardened with statement/query timeouts and a generous
   retry window; transient stalls are environmental, not application defects —
   the same operations complete in tens of milliseconds when the machine is healthy.

## Notes for the next slice

- Next legitimate slice: **Opportunity** (`Story → Opportunity`). Phase B scope
  stops at Story for now; Opportunity/GenerationJob/Artifact/Schedule/
  Publication are untouched.
- Generic URL research remains **disabled**; the SSRF guard is implemented and
  tested, but nothing exposes arbitrary-URL fetching.
- `architecture/*.md` still contradicts locked Ticket 06 (BullMQ / `channels`);
  it remains prior art until reconciled.
- `migrations/meta/0002_snapshot.json` is still absent; it is historical only
  (generate diffs against the latest snapshot), so no repair was needed.
- `server/storage.ts` per-user isolation is still deferred to Phase C slice (c);
  the `userId` parameter is threaded but not yet used for filtering.

