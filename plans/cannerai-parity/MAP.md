# Map: ContentForge — CannerAI parity

Label: `wayfinder:map` (derived) | Workstream: ContentForge only
Source: Registered demand in `plans/wayfinder-contentforge/MAP.md`
Created: 2026-09-10 | Status: open — planning only, no implementation

## Destination

A concrete, reviewable product/implementation map for the CannerAI-parity
demand that was parked in the Wayfinder map's **Registered demand** section.
The map inventories what already exists in `/Users/kishore/git/ContentForge`,
classifies every registered capability, identifies the shared primitives that
must be built once, orders the work by dependency, and names the architectural
pressure points that are **not** covered by the locked Tickets 01–08.

This map designs nothing new architecturally. It routes each CannerAI
capability onto an abstraction that Tickets 01–08 already locked. Where a
capability does **not** fit, the insufficient boundary is recorded as an
explicit future decision rather than silently amended.

## Constraints (hard)

- Architecture decisions in Tickets 01–08 are **LOCKED and MUST NOT be reopened**.
- Video Factory is out of scope. Do not touch it. Ticket 09 stays parked.
- Mission Control, video rendering, subscriptions/billing: out of scope.
- No implementation, no schema changes, no providers, no UI in this session.
- Nothing in Phase B is silently widened.

## Locked architecture this map must route onto

Preserved verbatim from Tickets 01–08:

- Chain: **ResearchJob → Story → Opportunity → GenerationJob → Artifact →
  Schedule → Publication → Result** (03).
- One research engine, two initiations (directed + autonomous), one output
  shape (04 §1–3).
- **SourceProvider** registry with two-stage fetch, provider owns
  normalization (04 §4).
- Content-addressed evidence; facts (`sourced`) vs interpretation (`generated`)
  with origin tags; conflicts first-class (04 §5–6).
- Reusable Story; **Opportunity as selector**; **GenerationJob as reproducible
  execution** with frozen `policy_snapshot` (05 §3–5).
- **Immutable Artifact revisions** with `supersedes_id`; readiness lives on
  Artifact only (03 §2, 05 §6/§8).
- **format × channel** separation + validity matrix (05 §7).
- **Artifact JSONB payload + per-format schema registry** (05 §6).
- Approved-revision-only scheduling; Schedule = series + occurrences (06 §1–4).
- **pg-boss** durable queue; scheduler enqueues only (06 §5–6).
- **Publication → Channel Adapter → Result**; X first, xQuick transport-only
  (07 §1–2).
- Adapter-based future channels; the **07 §12 registration checklist**
  (adapter + payload schema + format policy version + eligibility gate +
  error→class map + analytics mapper, zero core changes).

## Terminology borrowed from the demand

The Registered demand uses the phase vocabulary **Phase B → Phase C → Phase D**.
Reconciling that with `roadmap/phase-0..4` is an open decision (see Open
Decisions OD-1). This map treats them as the demand wrote them:

- **Phase B** — already committed: X only (post + thread) through the full
  locked chain.
- **Post-Phase-B / CannerAI parity** — the parked capabilities (main subject
  of this map).
- **Later** — capabilities requiring genuinely new architectural decisions.

---

# 1. Executive capability map

Sixteen registered capabilities, grouped by the demand's own headings.

| ID | Capability (exact demand wording) | Cluster | Verdict | Phase | Core-domain impact |
|---|---|---|---|---|---|
| C1 | YouTube-to-post (input) | Ingestion | EXTEND | Post-B | No (provider + policy) |
| C2 | blog-to-post (input) | Ingestion | GENERALIZE | Post-B | No |
| C3 | discussion/Reddit mining (input) | Ingestion | GENERALIZE | Post-B | No |
| C4 | repurpose-any-URL (input) | Ingestion | EXTEND | Post-B | No |
| C5 | trending-topics digest (input) | Ingestion | EXTEND | Post-B | No |
| C6 | LinkedIn post/article (format) | Formats | EXTEND | Post-B | No |
| C7 | carousel decks (format) | Formats | REFACTOR | Post-B | No (new payload schema) |
| C8 | AI graphics (format) | Formats | EXTEND | Post-B | **Yes — media/asset pressure** |
| C9 | chat-to-post (format) | Formats | REFACTOR | Post-B | Minor (initiation) |
| C10 | LinkedIn native publishing (channel) | Channels | NEW | Post-B (Phase C+) | No (07 §12 proof) |
| C11 | Memory & Voice (intelligence loop) | Intelligence | GENERALIZE | Post-B | No |
| C12 | custom templates (intelligence loop) | Intelligence | EXTEND | Post-B | No |
| C13 | draft manager (intelligence loop) | Readiness | REFACTOR | Post-B | No — uses Artifact readiness |
| C14 | canned responses | Intelligence | DEFER | Later | No |
| C15 | Chrome extension posting surface | Surface | NEW | Later | **Yes — external auth pressure** |
| C16 | agency multi-brand operation | Account | NEW | Later | **Yes — identity pressure** |

**One-line read:** every ingestion capability already has working,
hardcoded, single-source code that must be generalized behind the locked
SourceProvider; every format capability already has a working bespoke
generator that must be re-homed as a payload schema + versioned policy on the
locked chain; the one channel capability is a by-the-book 07 §12 registration;
the two genuinely new capabilities (extension, multi-brand) are the only ones
that hit architectural boundaries Tickets 01–08 did not settle.

---

# 2. Existing implementation inventory (per capability)

Evidence is file:line from the current `replit` working tree. Status legend:
✅ working · 🟡 partial/hardcoded · 🔴 dead/stub.

## C1 — YouTube-to-post

- **Existing:** `server/youtubeConnector.ts:1-130` (`checkYoutubeChannels`
  L123, `checkYoutubeChannelRow` L63, channel-id resolver L13-41) polls
  `youtube.com/feeds/videos.xml?channel_id=…`, dedupes on `lastVideoId`, calls
  `aiCall` (L82), writes a draft/scheduled post (L108-119). Cron
  `server/scheduler.ts:164-178` (6-hourly, `DISABLE_YOUTUBE_CONNECTOR_CRON`).
  Manual `POST /api/youtube/extract` (oEmbed) `server/routes.ts:2646-2663`;
  `POST /api/youtube/generate-post` L2665-2702. Table
  `youtube_channels` `shared/schema.ts:442-461` (autopost policy,
  `requireApproval`, `lastVideoId`). UI `client/src/pages/youtube.tsx`.
- **Status:** ✅ working loop; 🟡 hardcoded to X (`CONNECTOR_USER_ID=1`, prompt
  says "for X"). **No transcript fetch anywhere** (verified absent).
- **Alignment:** fetch → dedupe → generate is provider-shaped already; the
  generate step bypasses ResearchJob/Story and writes a `posts` row.
- **Reusability:** high for the provider front-end; the generation tail is the
  part that must be re-homed.

## C2 — blog-to-post

- **Existing:** `server/rssAutopost.ts:1-79` (`generateAutopostDraft` L9 →
  always `status:"draft"` L43; `runRssAutopostForBatch` L54) matches discovered
  ideas to sources by **hostname substring** (L61-69). Feed parsing
  `server/discoverRefresh.ts:144-174` (2 items/feed, 20-of-48 rotation by day).
  Table `rss_sources` `shared/schema.ts:250-264` (autopost policy). PATCH
  policy route `routes.ts:2007-2024`. 48 seeded feeds `server/seed.ts:6-79`.
- **Status:** ✅ works; 🟡 draft-only (never auto-schedules), hostname-only
  idea↔source match, `lastFetchedAt` never written (dead field).
- **Alignment:** the `getRssSourcesWithAutopost` filter (`storage.ts:492`) is a
  clean provider-config seam.
- **Reusability:** high; needs per-feed cursor + real article fetch (today it
  only reads feed summaries).

## C3 — discussion / Reddit mining

- **Existing:** Reddit `discoverRefresh.ts:68-142` (hardcoded 15-subreddit
  array L69-89; `/top.json` then permalink comment fetch L113-133). HN
  L43-66; GitHub L176-199 (**stale hardcoded `created:>2026-02-01`** L179);
  ArXiv L201-230 (regex XML); Google Trends L232-252. On-demand thread extract
  `routes.ts:961-997` (`extractRedditThread`). All feed `discovered_ideas`.
- **Status:** ✅ works; 🟡 every source hardcoded, no enable/disable despite
  `discovery_settings.enabledSources`; 3 canned "fallback" ideas injected when
  all sources fail (L265-289) — silently masks total failure.
- **Alignment:** each block already returns a uniform
  `{source, sourceType, category, title, url, …}` shape → provider-ready.
- **Reusability:** high; the `discovery_settings` dead switches become the
  provider enable/disable config.

## C4 — repurpose-any-URL

- **Existing:** `POST /api/ingest` `routes.ts:1086-1420` with
  `detectSourceType` L940-959 routing to `x_tweet` (official API,
  `social/x.ts:277`), `reddit_thread` (L961), `github_repo/discussion` (L999),
  `arxiv_paper` (L1030), else `extractGenericWebpage` (L1054-1082, **cheerio** +
  `og:title`/meta/`article,main,.content`; throws for x.com per policy).
  Writes `storage.createReference` L1400. Batch L1434-1502; screenshot
  (vision) L1506+. Duplicate: `/api/vault/extract-url` L2579-2600.
- **Status:** ✅ works for URLs; 🟡 single default branch (no per-kind
  extractor registry — `youtube_video`, `linkedin_post`, `blog_article` all
  fall through to cheerio); no readability/JS rendering/paywall handling.
- **Alignment:** `references` ingest is manual-only; locked model wants
  providers to feed research, with evidence on ResearchJob.
- **Reusability:** high; extraction is the gap, routing is the gap.

## C5 — trending-topics digest

- **Existing:** `server/marketPulse.ts:1-181` (`getMarketPulse` L147) = HN
  front page (L32) + Google Trends US/IN/GB (L46-73) → `breakingTopics`,
  `trendingKeywords`, `xAlgorithmContext` prompt block, `boostTopics`,
  `applyBreakingNewsBoost` ×1.5 (L170). Consumed by autopilot ranking
  (`autopilot.ts:290-293, 466-468`), route `routes.ts:3102-3110`, weekly recap.
  Digest generation `runDailyAutoPost` `autopilot.ts:642-747`; weekend
  `generateWeekendContent` L808-874. Cron `scheduler.ts:79-95` (05:30 IST).
- **Status:** ✅ works; 🟡 US/IN/GB + IST slots hardcoded.
- **Alignment:** `fetchHnFrontPage` / `fetchGoogleTrendsMultiRegion` are
  cleanly isolated → provider-ready; "digest" is both an ingestion (trends)
  and a generated artifact (see pressure point AP-6).
- **Reusability:** high.

## C6 — LinkedIn post/article (format)

- **Existing:** brand prompt already has a `linkedin` addendum with a
  3000-char rule (`server/brandSystemPrompt.ts:30-59`). Ingest classification
  `routes.ts:954-955`; content-action maps `article`→linkedin prompt
  L1593-1594. Client char limits `client/src/lib/constants.ts:31,46`;
  `postType: "linkedin_post"` label only. **Article generation + editor** is
  fully working: `articles` table `shared/schema.ts:108-126`, endpoints
  `routes.ts:650-922`, TipTap editor `client/src/pages/articles.tsx`.
- **Status:** ✅ generation craft exists; 🔴 no `linkedin_post` /
  `linkedin_article` payload schema, no versioned LinkedIn policy, no publish
  (see C10).
- **Alignment:** none yet — format is a prompt addendum + a free-text
  `postType`, not a payload schema.
- **Reusability:** prompt craft ✅; schema/policy = new.

## C7 — carousel decks (format)

- **Existing:** table `carousels` `shared/schema.ts:407-422` (`slides jsonb`,
  `platform`); routes `routes.ts:2867-2927` incl. `POST /api/carousels/generate`
  (L2898, prompt says "LinkedIn carousel creator"); UI
  `client/src/pages/carousel.tsx:1-265`, nav `App.tsx:50`.
- **Status:** ✅ wired end-to-end (generate→persist→list→render→delete);
  🟡 `slides` schemaless jsonb, platform hardcoded `"linkedin"`, **no image/
  PDF export, no publishing** (gradients only).
- **Alignment:** none — separate store, not an Artifact payload.
- **Reusability:** generation prompt + UI ✅; storage shape must become a
  registered `carousel` payload schema.

## C8 — AI graphics

- **Existing:** table `generated_images` `shared/schema.ts:345-357`; endpoints
  `routes.ts:2450-2539` — `POST /api/images/generate` (`ai.images.generate`,
  `MODELS.IMAGE` L2479), favorite/delete, `/generate-for-post` L2525
  (prompt suggestion only). Autopilot cover image `autopilot.ts:436-450`
  (hardcoded `"gpt-image-1"`, 1024×1024), called L334/L413. Attach columns
  `posts.imageUrl` (`schema.ts:31`), `articles.coverImageUrl` (`:114`). UI
  `client/src/pages/imagegen.tsx`.
- **Status:** ✅ generation + storage work; 🟡 attach-to-post only via
  autopilot, never wired in editors; `postId` param accepted L2461 but client
  never sends it; dead replit image routes (`replit_integrations/image/`).
- **Alignment:** none — images are a side store, not an Artifact payload part.
- **Reusability:** generation + storage ✅.

## C9 — chat-to-post (format)

- **Existing:** `POST /api/chat/message` `routes.ts:3015-3041` (stateless;
  client sends full `messages[]`; extracts `[POST_START]…[POST_END]`);
  `POST /api/chat/refine-post` L3043-3060. UI `client/src/pages/chat.tsx:1-281`
  (chat + "Generated Post" panel + Save as Draft → `POST /api/posts`).
  Tables `conversations`/`messages` `schema.ts:92-106` **exist but are never
  written**; the whole `server/replit_integrations/chat/**` island is dead.
- **Status:** ✅ chat→post works in-memory; 🔴 persistence dead.
- **Alignment:** chat is effectively an unmodeled human-initiation path; locked
  model has `HumanInputInitiation` / `human_edit`, not a conversation artifact.
- **Reusability:** prompt/UX ✅; persistence must be decided (see AP-5/OD-8).

## C10 — LinkedIn native publishing (channel)

- **Existing:** **None.** `server/social/` contains only `x.ts`.
  `POST /api/accounts/connect` `routes.ts:1817-1872` handles only `x` and
  `threads`, else 400 `Unknown platform` (L1870). Settings shows a LinkedIn
  account card (`client/src/pages/settings.tsx:314-322`) that the server
  rejects. `connected_accounts` + `enc:v1:` vault + crypto middleware are
  generic and reusable (`schema.ts:370-387`, `storage.ts:584-607`,
  `middleware/crypto.ts`).
- **Status:** 🔴 format label + dead UI card; no OAuth, no adapter.
- **Alignment:** exactly what 07 §12 says requires **zero core changes**.
- **Reusability:** vault/table/crypto ✅ verbatim (same as X adapter does).

## C11 — Memory & Voice

- **Existing:** `server/brandSystemPrompt.ts:1-70` — `SYSTEM_PROMPT` L6-28
  hardcodes "Kishore Kumar Behera … X and Threads"; `getBrandSystemPrompt(userId,
  platform)` L39-66 **does** read `user_profile` by userId and append
  niche/audience/voice. Second, divergent voice `KISHORE_VOICE`
  `autopilot.ts:206-223` (injected L299/L373 via `getBrandSystemPrompt(1,"x")`).
  `PILLAR_WEIGHTS` L121-138; `matchTemplate` L142-168. Profile/memory
  endpoints `routes.ts:2348-2447`. UI `settings.tsx:370-480`.
- **Status:** ✅ works; 🟡 **two hardcoded voices** + **three divergent pillar
  lists** (server `CONTENT_PILLARS_DATA` routes.ts:55-62 = 6, client
  `constants.ts` = 6, seeded DB `seed.ts:97-113` = 14); persona hardcoded in
  ≥5 server files.
- **Alignment:** profile layer is per-user; assembly is a per-platform string
  addendum, not a versioned policy.
- **Reusability:** prompt craft + profile reads ✅; dedupe + parameterize required.

## C12 — custom templates

- **Existing:** table `templates` `shared/schema.ts:55-62` (name, pattern,
  `postType`, `pillarId`); `GET /api/templates` `routes.ts:289-291`;
  `POST /api/templates/fill` L294-314; 33 seeded `seed.ts:115-163`;
  `matchTemplate` `autopilot.ts:142-168`; UI read-only
  `client/src/pages/templates.tsx:1-205`.
- **Status:** ✅ read + AI-fill; 🔴 **no create/edit/delete route** even though
  `storage.createTemplate` exists (`storage.ts:78,230-233`).
- **Alignment:** locked model wants templates to be the seed corpus for
  versioned format policies (08), not postType/pillar rows.
- **Reusability:** seed data + matcher ✅; CRUD + policy versioning = new.

## C13 — draft manager (Artifact readiness)

- **Existing:** posts status enum `["draft","ready","scheduled","posted",
  "failed"]` `routes.ts:85-88`, mirrored client `constants.ts:35-41`;
  transitions `PATCH /api/posts/:id/status` L183-193, unschedule L218-228;
  client surfaces `queue.tsx` (auto-promote draft→ready before publish
  L211-214), `calendar.tsx:120-126`, and ~10 create-as-draft sites.
  **Articles:** server only ever writes `"draft"` (routes.ts:881);
  client renders 4 states `draft/writing/ready/published` (articles.tsx:26-31)
  — three never produced. **Ideas:** PATCH validator
  `["new","saved","drafted","dismissed"]` (`routes.ts:1942`) vs real writers
  using `"used"/"scheduled"/"auto-drafted"/"briefing_drafted"` — enum mismatch.
- **Status:** 🟡 three inconsistent, mutually-contradictory status vocabularies.
- **Alignment:** none — this is the exact `posts.status` collapse the locked
  model splits (readiness on Artifact, distribution on Publication). Locked
  target readiness is `draft → in_review → approved | rejected`.
- **Reusability:** UX patterns ✅; vocabularies must be replaced at cutover.

## C14 — canned responses

- **Existing:** table `canned_responses` `schema.ts:425-439`; storage
  `storage.ts:514-546`; routes `routes.ts:2929-3012` (CRUD + `:id/use` +
  `ai-suggest`); UI `client/src/pages/canned-responses.tsx:1-158`.
- **Status:** ✅ works; 🟡 UI never calls `/:id/use` so `usageCount` stays 0.
- **Alignment:** outside Phase B; already DEFER per ticket 08.
- **Verdict:** **DEFER** (as registered and as 08 decided).

## C15 — Chrome extension posting surface

- **Existing:** **No extension.** No `manifest.json`, no `extension/` dir, no
  `chrome.*` usage. Only a bookmarklet string `GET /api/bookmarklet`
  `routes.ts:1786-1790` (unauthenticated `javascript:` URI → `POST /api/ingest`)
  and the in-app `client/src/components/quick-capture.tsx`. **No PAT/API-key
  table; inbound auth is session cookie + CSRF only** (`middleware/csrf.ts`).
  Outbound posting = xQuick (`social/x.ts`) is reusable as backend.
- **Status:** 🔴 nonexistent surface; ingestion endpoint it needs already works.
- **Alignment:** does **not** fit — locked architecture has no external-client
  auth story (see AP-1).

## C16 — agency multi-brand operation

- **Existing:** `migrations/0004_nice_martin_li.sql` adds nullable `user_id`
  to 24 tables; `server/middleware/userContext.ts` defines `Request.userId`,
  `sessionUser` (non-enforcing), `requireUserId`, `getUserId`, `forUser` —
  the last two have **zero call sites**. `server/storage.ts` declares `userId`
  on 6 post methods (`storage.ts:64-69`) but **never filters** — `getPosts()`
  L159-166 has no `.where()`. Only working per-user surface is `user_profile`
  (`routes.ts:2350+`, `|| 1` fallback). No `organizations`/`workspaces`/
  `brands`/`memberships` anywhere. Brand persona hardcoded (C11).
- **Status:** 🟡 schema retrofit present; 🔴 isolation dead; org/brand greenfield.
- **Alignment:** does **not** fit — needs its own design (see AP-2).

---

# 3. Classification (KEEP / EXTEND / GENERALIZE / REFACTOR / NEW / DEFER)

Rule carried from ticket 08: **prefer generalizing working code over
rewriting it.** `NEW` is only recorded after the code has been checked.

| ID | Capability | Verdict | Why this verdict |
|---|---|---|---|
| C1 | YouTube-to-post | **EXTEND** | Working connector + policy already exist; extend it into a YouTube SourceProvider (add transcript fetch, route through research instead of straight to `posts`). |
| C2 | blog-to-post | **GENERALIZE** | RSS autopost + 48 feeds + policy store all work; generalizing them off X/hostname-matching and onto the provider contract. |
| C3 | discussion/Reddit mining | **GENERALIZE** | Every source block is already an isolated uniform-shape function; generalize into providers, hardcoded queries into config. |
| C4 | repurpose-any-URL | **EXTEND** | `/api/ingest` + cheerio + AI works; extend with a per-kind extractor registry (and optional readability), keep the ingest endpoint. |
| C5 | trending-topics digest | **EXTEND** | `marketPulse` + briefing + digest generation work; extend onto Trends provider + Opportunity proposals. |
| C6 | LinkedIn post/article | **EXTEND** | Prompt craft + full article editor already exist; extend with `linkedin_post`/`linkedin_article` payload schemas + versioned policy. |
| C7 | carousel decks | **REFACTOR** | Works end-to-end but stores schemaless `slides` in its own table with hardcoded platform; refactor into a registered `carousel` Artifact payload + policy. |
| C8 | AI graphics | **EXTEND** | Generation + storage + autopilot attach work; extend to be a first-class Artifact payload part with editor attach. |
| C9 | chat-to-post | **REFACTOR** | Chat works statelessly; refactor into a modeled initiation/generation surface and resolve the dead persistence island. |
| C10 | LinkedIn native publishing | **NEW** | No OAuth, no adapter, no publisher anywhere. But it is a by-the-book 07 §12 registration — zero core changes. |
| C11 | Memory & Voice | **GENERALIZE** | Prompt craft + per-user profile read already work; generalize into policy assembly (dedupe two voices, three pillar lists). |
| C12 | custom templates | **EXTEND** | Table + fill + matcher + seed corpus exist; extend with CRUD and policy-version seeding. |
| C13 | draft manager | **REFACTOR** | Three working-but-contradictory status vocabularies; refactor onto Artifact readiness + Publication state at cutover. |
| C14 | canned responses | **DEFER** | Works; explicitly outside Phase B and already DEFER per ticket 08. Unchanged. |
| C15 | Chrome extension | **NEW** | Zero surface; needs external-client auth that does not exist (AP-1). |
| C16 | agency multi-brand | **NEW** | `user_id` retrofit exists but isolation doesn't; org/brand model is greenfield (AP-2). |

**Verification that nothing was assumed new:** C1–C13 all had working code
found at the cited file:line. Only C10 (no LinkedIn publisher), C15 (no
extension), and C16 (no org/brand) returned genuine absence — and C10 is
absence of an *adapter instance*, not of an architecture (07 §12 defines it).

---

# 4. Shared primitives (build once, reuse across capabilities)

Each primitive is one of the locked abstractions. No capability gets its own
pipeline.

## P-1 — Ingestion primitive: SourceProvider → ResearchJob
**Unlocks:** C1, C2, C3, C4, C5.
**Locked home:** 04 §4 (`Provider = {id, capabilities, discover, search,
fetch}` + `NormalizedSource`).
**Today:** six inline discovery blocks + two autopost connectors + a cheerio
URL branch, all hardcoded, all feeding different sinks (`discovered_ideas`,
`references`, `posts`).
**Build once:** provider registry + `NormalizedSource` normalization + engine
orchestration; then each input capability is one provider registration.
Adding C1/C2/C4 later must require **no** engine changes.

## P-2 — Repurposing primitive: Story → N Opportunities → N Artifacts
**Unlocks:** C6, C7, C8, C9 (and every future format).
**Locked home:** 03 §3, 05 §2/§9.
**Today:** each generator builds its own prompt from an idea/blob and writes
its own store (`posts`, `articles`, `carousels`, `generated_images`,
in-memory chat).
**Build once:** the Opportunity → GenerationJob → Artifact chain. A new format
is a new payload schema + policy — never a new pipeline.

## P-3 — Policy primitive: versioned generation policy → frozen policy_snapshot
**Unlocks:** C6, C7, C11, C12, C13 (and all formats).
**Locked home:** 05 §5 (`policy_snapshot` frozen per GenerationJob), 08
(templates → policy seed corpus).
**Today:** `templates` rows + `postType`/`pillarId` keys + two hardcoded voice
constants + per-platform prompt addenda.
**Build once:** policy documents (versioned, renderable to full prompt text)
that GenerationJob snapshots verbatim. Templates, brand voice, and format
rules all become inputs to ONE assembly step.

## P-4 — Context primitive: context source → research/generation context
**Unlocks:** C4, C9, C11, C12, C14.
**Locked home:** 04 §3 `rank_context` / 05 §5 policy params.
**Today:** `references`, `context_vault`, `style_profiles`, `canned_responses`,
brand profile, Market Pulse `xAlgorithmContext` — six disconnected context
stores.
**Build once:** an explicit context-assembly seam feeding research ranking and
generation policy. `references`/vault/style-profiles become context sources,
not parallel pipelines.

## P-5 — Distribution primitive: Artifact → Publication → Channel Adapter
**Unlocks:** C10 (and Threads/LinkedIn/future channels).
**Locked home:** 07 §1/§2/§12.
**Today:** one X-shaped publisher (`social/x.ts`) + a hardcoded
`if (platform === …)` connect route.
**Build once:** the adapter interface already specified. C10 = one adapter
implementation + one payload schema + one policy + one gate + one error map +
one analytics mapper. **Zero core changes** is the acceptance proof.

## P-6 — Readiness primitive: Artifact readiness states
**Unlocks:** C13 (and the human-gate UX of every format).
**Locked home:** 03 §2, 05 §6/§8 (`draft → in_review → approved | rejected`).
**Today:** three contradictory status vocabularies (`posts`, `articles`,
`discovered_ideas`).
**Build once:** the Artifact readiness machine + the UI that drives it. The
draft-manager capability is then UX over one primitive, not three.

## P-7 — Media primitive (pressure — see AP-3)
**Unlocks:** C7, C8.
**Locked home:** *not fully specified* — 05 says Artifact payload is JSONB
validated per format, but the storage model for binary media (generated
images, carousel slide renderings, video thumbnails) is not decided.
**Today:** `generated_images` side table, carousel `slides` gradient JSONB.
**Action:** record as open decision OD-4; do not invent a media service.

---

# 5. Dependency graph

```
                       ┌──────────────────────────── Phase B (committed, X only) ────────────────────────────┐
                       │  research engine+casing → Story → Opportunity → GenerationJob → Artifact          │
                       │  → Schedule(occurrences) → Publication → X Adapter → Result   [pg-boss, registry]  │
                       └───────────────┬───────────────────────────────┬───────────────────────┬────────────┘
                                       │                               │                       │
                     ┌─────────────────▼──────────────┐   ┌────────────▼────────────┐   ┌──────▼──────────────┐
                     │ P-1 SourceProvider registry    │   │ P-2/P-3 Repurposing +   │   │ P-5 Distribution    │
                     │ (+P-4 context seam)            │   │ policy primitive        │   │ adapter interface   │
                     └───┬────────┬────────┬──────┬───┘   └───┬────────┬────────┬───┘   └──────┬──────────────┘
                         │        │        │      │           │        │        │            │
         ┌───────────────┘        │        │      │           │        │        └──────┐     │
         │   ┌────────────────────┘        │      │           │        └──────┐        │     │
         │   │   ┌─────────────────────────┘      │           │               │        │     │
         ▼   ▼   ▼                                ▼           ▼               ▼        ▼     ▼
   ┌──────────────────────────────────┐   ┌──────────────────────────────┐  ┌────────────────────────┐
   │ C3 Reddit/HN/GitHub/ArXiv/Trends │   │ C6 LinkedIn format           │  │ C10 LinkedIn native    │
   │ C2 blog/RSS                      │   │ C7 carousel format           │  │     publishing         │
   │ C1 YouTube                       │   │ C8 AI graphics (AP-3)        │  │  (needs C5 vault ✅)   │
   │ C4 repurpose-any-URL (P-4)       │   │ C9 chat-to-post (AP-5)       │  └────────────────────────┘
   │ C5 trending digest               │   └──────────────┬───────────────┘
   └──────────────────────────────────┘                  │
                                                         ▼
                                            ┌──────────────────────────┐
                                            │ C11 Memory & Voice       │
                                            │ C12 custom templates     │
                                            │ C13 draft manager        │
                                            └──────────────────────────┘

   Later (architectural decision first):
   ┌─────────────────────────┐        ┌──────────────────────────────┐
   │ C16 multi-brand  AP-2   │        │ C15 Chrome extension  AP-1   │
   └─────────────────────────┘        └──────────────────────────────┘
   DEFER: C14 canned responses (unchanged per 08)
```

Reading the graph:

- **P-1, P-2/P-3, P-5 are the three roots.** Everything CannerAI either sits
  on one of these or is a registration against it.
- The five input capabilities (C1–C5) all hang off **P-1** and can be built in
  any order once the registry exists — they do not depend on each other.
- The four format capabilities (C6–C9) hang off **P-2/P-3** — they must not
  each grow a pipeline.
- C10 is the only capability that depends on **P-5** alone; it is the proof
  that the 07 §12 checklist holds.
- C11/C12/C13 are cross-cutting on the policy primitive (P-3), not on a
  specific format.
- C15/C16 depend on **neither** root — they depend on *unbuilt architectural
  decisions* (AP-1, AP-2), which is why they are Later.

---

# 6. Phase ordering

## Phase B — already committed (unchanged)

The locked vertical slice: one topic → ResearchJob → Story → Opportunity →
GenerationJob → approved Artifact → Schedule → Publication → X adapter →
Result, with pg-boss and the payload-schema registry. Deliverable of the
Wayfinder map; **not part of this map's scope**, restated only as the
foundation every CannerAI capability is built on.

Two Phase-B sub-pieces are load-bearing for parity and must not be
"simplified" into per-feature code:

1. the **payload-schema registry** (P-2/P-3) — otherwise every format in C6–C9
   forks the pipeline;
2. the **SourceProvider registry** (P-1) — otherwise every input in C1–C5
   forks ingestion.

## Post-Phase-B — CannerAI parity (the parked work)

Ordered by "unlocks the most downstream capabilities first".

**Wave 1 — Generalize the roots (unlocks 5 input capabilities).**
- 1a. **P-1 SourceProvider registry** + migrate the six existing discovery
  blocks (Reddit, HN, GitHub, ArXiv, RSS, Trends) into providers. This is the
  migration ticket 04 §10 already directed. Unlocks C2, C3, C5 immediately
  (they are existing code being generalized, not new code).
- 1b. **YouTube provider (C1)** — add transcript fetch (the one genuine gap)
  and route the existing connector through research.
- 1c. **Generic web/URL provider (C4)** — per-kind extractor registry behind
  the existing `/api/ingest`; decide readability dependency (OD-9).
- 1d. **Trends digest (C5)** — Trends provider + digest as Opportunity
  proposal (not a bespoke autopilot cron).

**Wave 2 — Formats on the locked chain (unlocks 4 format capabilities).**
- 2a. **Policy assembly primitive (P-3)** — dedupe the two voices / three
  pillar lists (C11) because every format inherits it.
- 2b. **LinkedIn post/article payload schemas + policy (C6)**.
- 2c. **AI graphics as Artifact payload part (C8)** — depends on OD-4.
- 2d. **Carousel payload schema + policy (C7)** — depends on OD-4.
- 2e. **Chat-to-post as modeled initiation (C9)** — depends on OD-8.

**Wave 3 — Channels (Phase C+).**
- 3a. **LinkedIn native publishing (C10)** — 07 §12 registration; also the
  acceptance test that adding a channel needs zero core changes.

**Wave 4 — Intelligence loop & readiness.**
- 4a. **Custom templates CRUD + policy seeding (C12)**.
- 4b. **Draft manager on Artifact readiness (C13)** — naturally lands at the
  cutover; do not build a fourth status vocabulary before then.

**Explicitly NOT moved into Phase B:** every Wave 1–4 item above. Phase B
stays X-only post + thread.

## Later — needs a new architectural decision first

- **C15 Chrome extension posting surface** — blocked on AP-1 (external-client
  authentication). The ingestion endpoint it would call already works; the
  missing piece is a decision, not code.
- **C16 agency multi-brand operation** — blocked on AP-2 (identity model).
  Touches the `user_id` retrofit noted in ticket 08; needs its own design and
  must not be assumed as "just add `userId` to queries".
- **C14 canned responses** — DEFER unchanged (ticket 08).

---

# 7. Phase B boundary (explicit)

| In Phase B (committed) | Parked in CannerAI parity (this map) |
|---|---|
| X post + X thread formats only | LinkedIn post/article, carousel, AI graphics, chat-to-post |
| One research engine + provider registry with the sources needed for the slice | YouTube/blog/Reddit/URL/trends providers as first-class capabilities |
| X adapter only (xQuick transport) | LinkedIn adapter + future channels |
| Payload-schema registry seeded with X payloads | Registered payload schemas for C6–C9 |
| Artifact approval + publication release gates | Memory/Voice assembly, template CRUD, draft-manager UX |
| Single operator | Multi-brand / agency (Later) |
| Session+CSRF inbound auth | External-client auth for extension/API (Later) |

No parked item is represented as Phase B work anywhere in this map.

---

# 8. Architectural pressure points

Answers to "does this fit cleanly into the locked architecture?" For every
**No**, the exact insufficient boundary is named. Architecture is **not**
modified to accommodate any shortcut.

| ID | Capability | Fits? | Insufficient boundary / required future decision |
|---|---|---|---|
| AP-1 | C15 Chrome extension | **No** | Locked architecture has no external-client authentication story. Inbound is session cookie + CSRF only; there is no PAT/API-key table or bearer middleware. Needs a new decision: how a non-browser client authenticates and which actor/permission it carries. Do not bolt a shared secret onto `/api/ingest`. |
| AP-2 | C16 multi-brand | **No** | `user_id` retrofit is schema-only (nullable, no FK, no index) and storage does not filter. There is no org/brand/membership entity, and brand persona is hardcoded. Needs its own design: identity hierarchy, brand_id propagation, per-brand vault/pillars, switching context. Not a storage-parameter sweep. |
| AP-3 | C7 + C8 media | **Partial** | 05 defines Artifact payload as JSONB validated per format, but the storage model for **binary/derived media** (generated images, carousel renderings) is unspecified. Decide whether media is (a) embedded asset refs inside payload JSONB, (b) a first-class asset entity keyed to an Artifact revision, or (c) both. Do not invent a media service before this decision. |
| AP-4 | C4 vs evidence model | **Partial** | `/api/ingest` writes `references` directly, while 04 §5 puts evidence **only** on ResearchJob. Two ingest sinks risk re-creating the duplicate-provenance problem 04 exists to kill. Needs a decision: is `references` a context/source store feeding ResearchJob (P-4), or retired into evidence? |
| AP-5 | C9 chat | **Partial** | Locked model has `HumanInputInitiation` and `human_edit` Artifacts, but no conversational entity. Decide whether chat becomes (a) a front-end over `HumanInputInitiation`, (b) a context source (P-4), or (c) persisted conversations with their own lifecycle. The dead `conversations`/`messages` tables are evidence this was never decided. |
| AP-6 | C5 digest | **Partial** | A "digest" is simultaneously ingestion (trends signals) and a generated Artifact. These must be split across P-1 (trends provider) and P-2 (digest as Opportunity/Artifact); otherwise digest generation becomes a second research engine. |
| AP-7 | C2/C3 sources | **Yes** | Fits 04 §4 cleanly. Hardcoded queries/`geo=US`/stale GitHub date become provider config; `discovery_settings` dead switches become enable/disable config. |
| AP-8 | C6/C10 LinkedIn | **Yes** | Format = payload schema + policy (05 §7); channel = adapter registration (07 §12). Fits with zero core changes — this is the designed proof case. |
| AP-9 | C11/C12 memory & templates | **Yes** | Fits 05 §5 policy_snapshot + 08's "templates are the policy seed corpus". Requires dedupe (two voices, three pillar lists) but no new boundary. |
| AP-10 | C13 draft manager | **Yes** | Fits Artifact readiness (03 §2 / 05 §6). The three current vocabularies are exactly what the locked split replaces. |
| AP-11 | Registry mechanics | **Partial** | 05 says "new format = new registered payload schema" and 04 says "provider list is a runtime registry", but **neither pins the mechanism** (code registry vs DB table vs config file) or where format policies are stored/versioned. Needs a decision before Wave 2. |
| AP-12 | C1 transcript | **Yes (with a dependency)** | Transcript fetch is a provider `fetch` capability; no model change. But it introduces a new external fetch/parse dependency and its own failure classes — keep it inside the provider, never in the engine. |

---

# 9. Open decisions

Recorded as explicit future decisions. None may be resolved by amending
Tickets 01–08.

| ID | Decision | Blocks | Notes |
|---|---|---|---|
| OD-1 | Reconcile phase vocabulary: demand's B/C/D vs `roadmap/phase-0..4` | all planning labels | Cosmetic but must be pinned once so "Phase C+" means one thing. |
| OD-2 | SourceProvider registry mechanism (code registry vs DB table) + provider enable/disable wiring | Wave 1 | Must also decide the fate of `discovery_settings.enabledSources` and write-only `monitored_accounts`. |
| OD-3 | Format-policy registry mechanism + where versions live | Wave 2 / AP-11 | Must be decided with the payload-schema registry so C6–C9 never fork. |
| OD-4 | Media/asset storage model for AI graphics + carousels | Wave 2 (C7, C8) | See AP-3. |
| OD-5 | External-client authentication (PAT/API keys) + actor semantics | C15 | See AP-1. |
| OD-6 | Identity model: single-user → enforce `user_id` → org/brand | C16 | Sequencing decision; "enforce user_id" may be a prerequisite of multi-brand but is not sufficient for it. |
| OD-7 | `references`/`context_vault`/`style_profiles` role: context sources vs evidence vs retire | AP-4 / P-4 | Determines C4's target sink. |
| OD-8 | Chat persistence + whether chat is an initiation kind | C9 | See AP-5. |
| OD-9 | Web extraction depth: cheerio-only vs readability vs JS rendering (new dependency, cost) | C4 | Affects quality and infra cost. |
| OD-10 | Canned responses disposition (keep DEFER) | C14 | Already deferred; revisit only if it becomes an input to a format. |
| OD-11 | LinkedIn OAuth mechanism (OAuth 2.0 + reuse of the `connected_accounts` vault) | C10 | Vault/crypto are reusable; the flow is new. |
| OD-12 | Digest definition: opportunity proposal vs dedicated format | C5 | See AP-6. |

---

# 10. Recommended next implementation ticket

**Do not start.** Recommendation for review only.

> **Ticket: Post-Phase-B Wave 1a — generalize the SourceProvider registry and
> migrate the six existing discovery sources (Reddit, HN, GitHub, ArXiv, RSS,
> Trends) onto it.**
>
> Rationale: it is the single highest-leverage step in the map. It unlocks five
> of the sixteen registered capabilities (C2, C3, C4, C5, and C1's front-end),
> it is a generalization of already-working code rather than new code (ticket
> 03/04 direction, ticket 08 verdicts), and it is the prerequisite that stops
> every subsequent input capability from forking its own ingestion path. It
> also forces OD-2 to be decided on real code instead of in the abstract.
>
> Its first sub-deliverable should be the registry seam itself with the
> existing six sources registered and byte-identical output — a pure
> refactor with no behavior change — before any new provider (YouTube
> transcript, generic URL) is added.

**Runner-up (if format-side first is preferred):** Wave 2a + 2b — the policy
assembly primitive (dedupe C11's two voices / three pillar lists) followed by
the LinkedIn post/article payload schemas (C6), which unlocks four format
capabilities and is the lowest-external-risk path.

Both recommendations stay entirely inside the locked architecture. Neither
requires resolving AP-1/AP-2 (extension, multi-brand), which remain Later.

---

# 11. Provenance of this map

- Demand source: `plans/wayfinder-contentforge/MAP.md` → "Registered demand
  (post–Phase B, not designed)" (16 features, exact wording preserved).
- Locked inputs: tickets 03, 04, 05, 06, 07, 08 (and 01/02 inventories).
- Code inventory: read-only walk of `server/`, `shared/`, `client/src/`,
  `migrations/` on the `replit` branch. No files modified except this map and
  the one-line pointer added to the Wayfinder map.
- Every "existing implementation" claim above carries a file:line anchor and
  should be re-verified at implementation time (branches move; the anchors are
  from 2026-09-10).
