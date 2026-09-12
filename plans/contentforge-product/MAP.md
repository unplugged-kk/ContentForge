# Map: ContentForge — Master Product Map

Label: `wayfinder:map` (master) | Workstream: ContentForge only
Supersedes (as top-level map): `plans/cannerai-parity/MAP.md` (retained as the
narrower CannerAI-parity artifact this map absorbs and extends)
Created: 2026-09-10 | Status: open — planning only, no implementation

## Destination

The complete target ContentForge product mapped as a reviewable artifact:
**an AI-native social-media intelligence + content creation + repurposing +
scheduling + publishing + analytics workspace** — every capability classified
against what already exists in the repo, every capability routed onto a locked
abstraction or recorded as a new architectural decision, ordered into phases
B–H, with the shared primitives and seams named so that no capability is ever
built in isolation.

This map **decides nothing new architecturally**. Tickets 01–08 are locked and
are not reopened. Where the expanded product goal does not fit inside them, the
insufficient boundary is recorded as an explicit new decision (§13), not
silently amended.

## Notes

- **Product references, not architecture.** CannerAI = product-feature
  reference. Postiz = scheduling/publishing + workspace/operational reference.
  last30days / Agent-Reach = research + internet-access provider references.
  None of them define ContentForge's domain model.
- **Standing rule from ticket 08:** prefer generalizing working code over
  rewriting it. `NEW` is only recorded after the repo has been inspected.
- **Skills every session should consult:** `/grilling`, `/domain-modeling`;
  prototypes via `/prototype`; research via `/research` subagents.
- Prior art in repo: `architecture/system-architecture.md`,
  `architecture/data-model.md`, `architecture/workflows.md`,
  `docs/spec_contentforge_reimagined.md`, `plans/cannerai-parity/MAP.md`.
- **Hard boundaries:** do NOT modify Video Factory (behind Provider interface)
  or Mission Control. No subscription/billing implementation. No implementation
  in this mapping session.

## Locked architecture (restated, never reopened)

Canonical chain:

```
ResearchJob → Story → Opportunity → GenerationJob → Artifact
            → Schedule (series + occurrences) → Publication → Result
```

Locked principles (Tickets 01–08): one research engine with directed +
autonomous initiation; SourceProvider abstraction; evidence/provenance on
ResearchJob; fact (`sourced`) vs interpretation (`generated`) separation;
reusable research (format change never re-runs research); Story is editorial
meaning, never a promoted idea; Opportunity is selection; GenerationJob is
reproducible execution with a frozen `policy_snapshot`; Artifact is immutable
with `supersedes_id` revisions; format × channel are separate dimensions;
Artifact payload is JSONB + per-format schema registry; approval happens at
Artifact (`draft → in_review → approved | rejected`); only approved revisions
reach scheduling/publication; pg-boss durable scheduling; Schedule/Occurrence
separated; Publication is durable distribution intent; Channel Adapter owns
channel mechanics; X first with xQuick transport-only; adapter-side retry/error
classification into four core classes; idempotency + leases + reconcile-first
unknown handling; no channel-specific domain model.

---

# 1. Product vision

ContentForge is a single-operator (today) / multi-brand (later) workspace that
turns the open internet into published, performance-measured content in the
user's own voice. It does three things and refuses to conflate them:

1. **Intelligence** — one research engine that watches configured sources and
   answers directed questions, producing *evidence-backed, provenance-tagged,
   reusable* Stories rather than disposable post drafts.
2. **Creation** — one Story becomes many format×channel Artifacts (X post,
   X thread, LinkedIn, article, newsletter, carousel, video script, future),
   each generated under a versioned policy, each owned by a human voice
   profile, each immutably revisable.
3. **Distribution** — one schedule/publication pipeline that publishes
   approved revisions through per-channel adapters, records proof, reconciles
   uncertainty, and feeds results back into ranking.

The unifying claim that separates this from CannerAI or Postiz: **research is
the durable asset, content is a cheap derivation of it.** A Story researched
once serves every format and channel forever without re-research. CannerAI-grade
creation + Postiz-grade distribution + deep internet intelligence, built around
ContentForge's domain model rather than any competitor's schema.

---

# 2. Capability map

Nine capability areas, 89 capabilities. Verdict legend:

`EXISTS` (works today, ship as-is) · `EXTEND` (working code, add capability) ·
`GENERALIZE` (working code, move behind a locked abstraction) · `REFACTOR`
(working but mis-shaped, restructure at cutover) · `NEW` (verified absent) ·
`EXTERNAL` (stays an external provider behind a seam) · `DEFER` (parked).

## 2.1 Intelligence (`IN`)

| ID | Capability | Verdict | Existing evidence | Target home |
|---|---|---|---|---|
| IN-1 | Directed research | GENERALIZE | `routes.ts:1122+` discover paths, `/expand` | ResearchEngine DirectedInitiation (04 §3) |
| IN-2 | Autonomous research | EXTEND | `discoverRefresh.ts:22`, cron `scheduler.ts:115-130` | AutonomousInitiation + domain config (04 §3) |
| IN-3 | URL research | EXTEND | `/api/ingest` `routes.ts:1086-1420` | Web provider (04 §4) |
| IN-4 | Article/blog ingestion | GENERALIZE | `rssAutopost.ts:1-79`, `discoverRefresh.ts:144-174` | RSS/web SourceProvider |
| IN-5 | YouTube ingestion | EXTEND | `youtubeConnector.ts:1-130`; **no transcript** | YouTube provider + `fetch` capability |
| IN-6 | Reddit/discussion ingestion | GENERALIZE | `discoverRefresh.ts:68-142` (15 subs hardcoded) | Reddit provider + config |
| IN-7 | RSS monitoring | GENERALIZE | `rss_sources` table, 48 seeds, `lastFetchedAt` dead | RSS provider + cursor |
| IN-8 | Trending topics | EXTEND | `marketPulse.ts:1-181` (HN + Google Trends) | Trends provider (see §13 AP-6) |
| IN-9 | Multi-source synthesis | GENERALIZE | `discoverRefresh.ts:265-289` 20-idea AI call | RankingHook (04 §9) |
| IN-10 | Evidence / provenance | NEW | nothing exists | Locked 04 §5 — evidence only on ResearchJob |
| IN-11 | Source credibility / conflict handling | NEW | nothing exists | Locked 04 §5 — `conflicts[]`, confidence levels |
| IN-12 | Current-events / recent-discussion research | EXTERNAL | — | last30days behind SourceProvider (§6) |
| IN-13 | Research library | EXTEND | `context_vault` `routes.ts:2563-2643`, `vault.tsx` | Context source (P-4) + library index |
| IN-14 | Saved research / context | EXTEND | `context_vault` table, `references` | Context source (P-4) |

## 2.2 Personalization / Second Brain (`SB`)

| ID | Capability | Verdict | Existing evidence | Target home |
|---|---|---|---|---|
| SB-1 | Writing voice profile | EXTEND | `user_profile.brandVoice` `schema.ts:329-343` | Voice profile entity (§4 doc AI-CREATION) |
| SB-2 | Style analysis | REFACTOR | `style_profiles` capture works but analyzes **sources not the user**; `/apply` has no UI caller | Observed-evidence layer, distinct from profile |
| SB-3 | Preferences | EXTEND | `memoryJson` write-only for generation | Policy assembly input |
| SB-4 | Brand knowledge | EXTEND | `brandingJson` **DEAD** (`routes.ts:2397-2422`) | Policy assembly input |
| SB-5 | Audience definition | EXISTS | `audienceDescription`, consumed `brandSystemPrompt.ts:44-53` | Policy assembly input |
| SB-6 | Niche/topic preferences | EXTEND | `niche`, `contentGoals` | Domain config (04 §3) |
| SB-7 | Messaging pillars | REFACTOR | 3 divergent lists: server 6, client 6, seeded 14 | Policy seed corpus |
| SB-8 | Reusable context | EXTEND | `context_vault`, `references`, `style_profiles` | Context primitive P-4 |
| SB-9 | Feedback learning | NEW | absent (verified) | Learning-signal store (§4) |
| SB-10 | Approval/edit history as learning signals | NEW | absent | Same store; derived from Artifact revisions |

## 2.3 Creation (`CR`)

| ID | Capability | Verdict | Existing evidence | Target home |
|---|---|---|---|---|
| CR-1 | Chat-to-post | REFACTOR | `routes.ts:3015-3060`, `chat.tsx`; `conversations` tables dead | Initiation surface (§4) |
| CR-2 | Topic-to-content | EXTEND | `/api/generate` `routes.ts:317-347` | Opportunity → GenerationJob |
| CR-3 | URL-to-content | EXTEND | ingest → references → generate | Provider → ResearchJob → Story |
| CR-4 | Research-to-content | NEW | no Story concept in code | Locked 05 §3 |
| CR-5 | Content repurposing | REFACTOR | `to-thread` un; `to-tweet`/`thread→article` **no UI caller** | Story → N Opportunities (05 §9) |
| CR-6 | One Story → many Opportunities | NEW | absent | Locked 05 §2 |
| CR-7 | X posts | EXISTS | `x.ts:304-351`, `generate.tsx` | X payload schema |
| CR-8 | X threads | EXISTS | `threadUtils.ts`, `tweets` table, finisher | X payload schema |
| CR-9 | LinkedIn posts | EXTEND | `brandSystemPrompt.ts:30-59`, labels only | `linkedin_post` payload + policy |
| CR-10 | Future social formats | NEW | absent | Payload schema registry (05 §6) |
| CR-11 | Articles / newsletters | EXTEND (articles) / NEW (newsletter) | `articles` full editor `routes.ts:650-922`; no newsletter anywhere | `article` payload; `newsletter` payload |
| CR-12 | Carousel content | REFACTOR | `carousels` table + UI work; schemaless `slides` | `carousel` payload + policy |
| CR-13 | Video scripts | NEW | absent | `video_script` payload (09 contract) |
| CR-14 | Templates | EXTEND | 33 seeded, `matchTemplate`, fill | Versioned generation policy |
| CR-15 | Custom templates | EXTEND | **no CRUD routes**; `storage.createTemplate` unused | Policy CRUD |
| CR-16 | One-click transformations | EXTEND | `/api/content-actions/:action` (8 actions) `routes.ts:1569-1647` | New Artifact revision / Opportunity (05 §8) |

## 2.4 Visuals (`VI`)

| ID | Capability | Verdict | Existing evidence | Target home |
|---|---|---|---|---|
| VI-1 | AI image generation | EXISTS | `/api/images/generate` `routes.ts:2450-2539` | Visual provider |
| VI-2 | Multiple image variations | EXTEND | single-shot today | Visual provider |
| VI-3 | Image refinement | NEW | `/generate-for-post` returns prompt text only | Visual provider |
| VI-4 | Brand-aware image generation | NEW | hardcoded `"gpt-image-1"` `autopilot.ts:436-450` | Policy + visual provider |
| VI-5 | Image attachments | REFACTOR | `posts.imageUrl` exists; editors never set it | Artifact payload part |
| VI-6 | Platform dimension policies | NEW | no platform sizing | Visual policy |
| VI-7 | Carousel slide generation | EXTEND | `/api/carousels/generate` `routes.ts:2898` | `carousel` payload |
| VI-8 | Carousel themes/styles | EXTEND | gradient backgrounds `carousel.tsx` | Theme abstraction |
| VI-9 | Artifact ↔ visual asset relationships | NEW | no asset identity | §13 AP-3 (media model) |

## 2.5 Distribution (`DI`)

| ID | Capability | Verdict | Existing evidence | Target home |
|---|---|---|---|---|
| DI-1 | X | EXISTS | `x.ts` + xQuick transport | X adapter (07 §6) |
| DI-2 | LinkedIn | NEW | card in `settings.tsx:314-322`, server rejects 400 | LinkedIn adapter (07 §12) |
| DI-3 | Future social platforms | NEW | — | Adapter registrations (07 §12) |
| DI-4 | Immediate publish | EXISTS | `POST /api/posts/:id/publish` `routes.ts:200-216` | Implicit one-shot Schedule (06 §3) |
| DI-5 | Scheduled publish | EXISTS | minute cron `scheduler.ts:30-76` | Materializer + pg-boss (06 §5) |
| DI-6 | Recurring publication | NEW | single `scheduledAt` only | Schedule series (06 §1) |
| DI-7 | Content queue | EXTEND | `queue.tsx`, `/api/posts/queue/today` | Queue over Artifact readiness |
| DI-8 | Calendar | EXTEND | `calendar.tsx` month grid | Calendar over Schedule occurrences |
| DI-9 | Drag/drop rescheduling | NEW | **no dnd lib** in `package.json` | Calendar UI |
| DI-10 | Publication history | NEW | absent (no history page) | Publication + Result query |
| DI-11 | Reconciliation | NEW | absent | Adapter `reconcile` (07 §3/§13) |
| DI-12 | Analytics | EXTEND | see §2.8 | Maintenance jobKind + mapper (07 §8) |

## 2.6 Workspace / Workflow (`WS`)

| ID | Capability | Verdict | Existing evidence | Target home |
|---|---|---|---|---|
| WS-1 | Drafts | REFACTOR | `posts.status`, articles status, idea status — 3 vocabularies | Artifact readiness |
| WS-2 | Review | REFACTOR | `queue.tsx` sections; no review page | Readiness `in_review` |
| WS-3 | Approvals | REFACTOR | only YouTube `requireApproval`; autopilot bypasses approval entirely | Artifact approval (05 §10) |
| WS-4 | Saved ideas | EXISTS | `ideas` table + `ideas.tsx`; discover `/:id/status` UI dead | Pre-story signals (`discovered_ideas`) |
| WS-5 | Content calendar | EXTEND | `calendar.tsx` | Schedule occurrences |
| WS-6 | Research vault | EXTEND | `context_vault` + `vault.tsx` | Context source P-4 |
| WS-7 | Notifications | NEW | absent — no table, no email, no SSE/WS | New surface (§13 AP-7) |
| WS-8 | Activity / history | EXTEND | `audit_logs` **write-only**, no read endpoint/UI | Activity feed over audit + Result |
| WS-9 | Search | NEW | one client-side vault filter only | Cross-entity search (§13 AP-8) |
| WS-10 | Collaboration | NEW | absent; Postiz has teams/comments | §13 AP-2 (identity) |
| WS-11 | Multiple brands / workspaces | NEW | absent; `user_id` retrofit unenforced | §13 AP-2 (identity) |

## 2.7 Chrome / capture (`CH`)

| ID | Capability | Verdict | Existing evidence | Target home |
|---|---|---|---|---|
| CH-1 | Save page | EXTEND | `/api/bookmarklet` `routes.ts:1786-1790` (unauthenticated), `quick-capture.tsx` | External-auth surface (§13 AP-1) |
| CH-2 | Save snippet | EXTEND | paste path in `/api/ingest` | Same |
| CH-3 | Capture conversation/comment | EXTEND | `x_tweet` + `reddit_thread` ingest branches | Provider `fetch` |
| CH-4 | Inline content generation | NEW | absent | Extension + GenerationJob |
| CH-5 | Canned responses | EXISTS · DEFER | full CRUD + AI suggest; UI never calls `/:id/use` | Deferred per ticket 08 |
| CH-6 | Contextual generation | NEW | absent | Extension + policy |

## 2.8 Analytics (`AN`)

| ID | Capability | Verdict | Existing evidence | Target home |
|---|---|---|---|---|
| AN-1 | Post-level results | EXTEND | `analytics` table, per-post stats `queue.tsx:106-123` | Result + snapshots (03 §1) |
| AN-2 | Platform analytics | EXTEND | `syncPostAnalyticsFromX` `x.ts:405-459` | Adapter analytics mapper (07 §8) |
| AN-3 | Engagement | EXISTS | `getAnalyticsSummary` `storage.ts:235-298` | Result metrics |
| AN-4 | Content performance | EXTEND | `insights` `routes.ts:355-424` | Derived views |
| AN-5 | Format performance | NEW | no format/postType breakdown | Derived view over Artifact.format |
| AN-6 | Topic performance | EXTEND | `pillarStats` `routes.ts:399-418` | Derived view over Story topics |
| AN-7 | Voice/style performance | NEW | absent | Derived view; feeds learning loop |
| AN-8 | Best posting times | REFACTOR | `/api/schedule/best-times` is a **hardcoded static array** `routes.ts:3154-3172`; real `bestHours` exists separately `routes.ts:384-397` | Derived from Result data |
| AN-9 | Research→performance feedback loop | NEW | absent | Learning-signal store (§4) |

## 2.9 Automation (`AU`)

| ID | Capability | Verdict | Existing evidence | Target home |
|---|---|---|---|---|
| AU-1 | RSS autoposting | GENERALIZE | `rssAutopost.ts`, `AUTOPOST_USER_ID=1`, hostname match | Provider + policy |
| AU-2 | YouTube connector | GENERALIZE | `youtubeConnector.ts`, `CONNECTOR_USER_ID=1` | Provider + policy |
| AU-3 | Scheduled research | NEW | discovery cron exists, not research scheduling | Schedule + ResearchJob (06 §5) |
| AU-4 | Autonomous topic discovery | EXTEND | `discoverRefresh.ts` + `--discover` prior art (last30days) | AutonomousInitiation |
| AU-5 | Automatic opportunity creation | NEW | absent | RankingHook → Opportunity |
| AU-6 | Optional automatic generation | EXTEND | `runDailyAutoPost` `autopilot.ts:642-747` | GenerationJob triggers |
| AU-7 | Optional approval gates | REFACTOR | autopilot creates `status:"scheduled"` and publishes with **zero review** | Artifact approval (05 §10) |
| AU-8 | Automatic publishing after approval | REFACTOR | minute cron publishes directly | Publication worker (06 §14) |

**Classification summary:** EXISTS 12 · EXTEND 30 · GENERALIZE 10 · REFACTOR 15 ·
NEW 31 · EXTERNAL 1 · DEFER 1 (Canned responses counted EXISTS·DEFER).

---

# 3. Existing ContentForge capability inventory

Condensed from read-only walks of `server/`, `shared/`, `client/src/`,
`migrations/`. Line anchors are as of 2026-09-10 and should be re-verified at
implementation time. Full detail lives in
`plans/cannerai-parity/MAP.md` §2 and the two agent inventories this map
summarizes.

## 3.1 What genuinely works today

- **AI gateway** — `server/ai/config.ts` + `aiCall`/`logAiUsage`
  (`server/ai/chat.ts:20-49`), `MODELS` registry. Sole model access path. KEEP.
- **X publishing via xQuick** — `server/social/x.ts`: post + reply-chain +
  write-action polling (`:248-271`), error translation (`:14-38`), thread
  numbering (`threadUtils.ts`), finisher, `tryPublishPostById` (`:364-400`).
- **Account vault** — `connected_accounts` + AES-256-GCM `enc:v1:` encryption
  (`middleware/crypto.ts`, `storage.ts:584-607`). Generic platform column.
- **Discovery** — six sources in `discoverRefresh.ts` (HN L43, Reddit L68,
  RSS L144, GitHub L176, ArXiv L201, Trends L232) with 14-day dedupe and an AI
  ranking call producing `discovered_ideas`.
- **Market pulse** — `marketPulse.ts` HN front page + Google Trends, boost ×1.5.
- **Autopilot** — `server/autopilot.ts` (874 lines): IST slots 13:00/19:30/23:00,
  `PILLAR_WEIGHTS`, `matchTemplate`, `generateDraftFromIdea`,
  `generateArticleDraftFromIdea`, `autofillCalendar`, `runDailyAutoPost`,
  weekend content. Creates posts directly as `status:"scheduled"`.
- **Articles** — full CRUD + outline/expand/improve/full-generation + TipTap
  editor + DOMPurify sanitize (`routes.ts:650-922`). Publish is an intentional
  501 stub (`getXArticlePublishCapability` always false).
- **Images** — `/api/images/generate` via `MODELS.IMAGE`, favorite, delete,
  gallery UI. Autopilot cover images.
- **Carousels** — generate → persist → render → delete, gradients, LinkedIn.
- **Connectors** — `rssAutopost.ts` (drafts), `youtubeConnector.ts`
  (drafts or scheduled +20min gated by `requireApproval`).
- **Analytics** — summary + insights (topPosts, bestHours, pillarStats),
  X sync, x-usage budget surface, analytics dashboard, ai-usage dashboard.
- **Canned responses** — full CRUD + AI suggest.
- **Vault / references / style profiles / templates / ideas / hooks / chat /
  formatter / ingest** — all wired to real endpoints.
- **Security foundation** — helmet, rate limit, CSRF, audit log, DOMPurify,
  upload validation, encrypted tokens.

## 3.2 What is partially built, mis-shaped, or dead

- **Three contradictory status vocabularies**: posts (`draft/ready/scheduled/
  posted/failed` `routes.ts:85-88`), articles (server writes only `draft`;
  client renders 4 states `articles.tsx:26-31`), ideas (validator
  `new/saved/drafted/dismissed` `routes.ts:1942` vs real writers using
  `used/scheduled/auto-drafted/briefing_drafted`).
- **Automation bypasses approval entirely** — autopilot writes
  `status:"scheduled"`; the minute cron publishes it. `requireApproval` exists
  only on the YouTube connector.
- **Publish loop has no lease** — `scheduler.ts:30-76` full-scans due posts;
  double-publish possible across instances/overlapping ticks; retry re-arms
  `status:"scheduled"` (`:63-67`).
- **Write-only stores**: `memoryJson` (read by nothing in generation),
  `brandingJson` (never read), `audit_logs` (no read endpoint or UI),
  `analytics` (never feeds generation), `viral_scores` (never feeds
  generation), `style_profiles.apply` (no UI caller), `reference_content`
  (write-only), `reference_posts` (fully dead).
- **Hardcoded single-user**: `sessionUserId() => req.session?.userId ?? 1`
  (`routes.ts:51-53`), `AUTOPOST_USER_ID=1`, `CONNECTOR_USER_ID=1`,
  `getBrandSystemPrompt(1, …)` (`autopilot.ts:296,368`). `storage.ts` declares
  `userId` on 6 post methods but never filters.
- **Hardcoded X/vertical**: brand persona "Kishore Kumar Behera … 11+ yrs"
  in `brandSystemPrompt.ts:6-28` and dozens of route prompts; second divergent
  `KISHORE_VOICE` `autopilot.ts:206-223`; `targetPlatform` hardcoded `"x"` at
  ~8 autopilot/connector sites.
- **Three divergent pillar lists** (6 / 6 / 14).
- **Stale hardcoded data**: GitHub discovery query pins `created:>2026-02-01`
  (`discoverRefresh.ts:179`); `rss_sources.lastFetchedAt` never written;
  `discovery_settings` fields `enabledSources/minViralScore/customKeywords/
  monitoredXAccounts` have no readers; `monitored_accounts` has writers but no
  engine readers.
- **`/api/schedule/best-times` is a static hardcoded array** (`routes.ts:3154`).
- **No drag-and-drop** anywhere (no dnd dependency installed).
- **Dead islands**: `server/replit_integrations/**` (chat, image, audio, batch)
  is never imported; `chatStorage` is a second ungoverned data path.

## 3.3 UI surface (22 pages)

Create: `generate`, `formatter`, `canned-responses`, `chat`, `youtube`,
`hooks`, `carousel`, `imagegen`, `articles`, `templates`.
Research: `ingest`, `discover`, `vault`, `references`, `ideas`.
Manage: `queue`, `calendar`, `analytics`, `ai-usage`, `settings`.
Auth: `auth`, `not-found`.

**No UI exists for:** autopilot control (`/api/autopilot/*` mostly has no client
caller), search, notifications, activity/audit, publication history, drag/drop
rescheduling, or multi-brand.

---

# 4. CannerAI parity matrix

CannerAI is the *product-feature* reference (voice matching, templates,
repurposing, persistent memory/context, trending discovery, scheduling, images,
carousels, Chrome workflows). Its positioning emphasises analysing **actual
posts** for sentence structure, vocabulary, cadence, tone and content patterns
rather than picking a generic tone.

| CannerAI feature | ContentForge status | Verdict | Gap |
|---|---|---|---|
| AI writing in personal voice | `brandSystemPrompt` + `user_profile` reads profile | EXTEND | Voice is a string addendum, not a versioned policy; two divergent hardcoded voices; no analysis of the user's real posts (style extraction analyses *sources*) |
| Style analysis of real posts | `style_profiles` + `ai-learn` exist | REFACTOR | `ai-learn` reads `getPosts().slice(0,10)` unfiltered (drafts included, all users); `styleProfiles.apply` unreachable from UI |
| YouTube repurposing | `youtubeConnector.ts` + manual routes | EXTEND | No transcript fetch; routes straight to a `posts` row, not research |
| Blog repurposing | `rssAutopost.ts` + 48 feeds | GENERALIZE | Draft-only; hostname-substring matching; feed summary only, no article body |
| Discussion repurposing | `discoverRefresh.ts` Reddit block | GENERALIZE | 15 subreddits hardcoded; no config; writes `discovered_ideas` only |
| Chat-to-post | `/api/chat/message` + `chat.tsx` | REFACTOR | Stateless; `conversations`/`messages` tables dead; no modeling as initiation |
| Templates | 33 seeded + fill + match | EXTEND | No create/edit/delete route; `postType`/`pillarId` keys, not versioned policies |
| Scheduling | minute cron + calendar | REFACTOR | No lease, no occurrences, no recurrence; double-publish possible |
| Memory / context | `context_vault`, `references`, `memoryJson`, `style_profiles` | EXTEND | Six disconnected stores; `memoryJson`/`brandingJson` not consumed by generation |
| Image generation | `/api/images/generate` | EXTEND | Not attachable in editors; no variations/refinement; no platform dimensions |
| Carousel generation | `carousels` + `carousel.tsx` | REFACTOR | Schemaless `slides`; separate table; no publishing; gradients only |
| Chrome workflows | bookmarklet string only | NEW | Not an extension; unauthenticated; no PAT |

**Net CannerAI verdict:** creation craft largely exists but is stored in
mis-shaped places and disconnected from generation; the *intelligence* half
(voice-from-real-posts, memory that actually shapes output, repurposing as a
first-class flow) is the real gap.

---

# 5. Postiz reference matrix

Postiz (35.7k★, **AGPL-3.0**) — NextJS + NestJS + Prisma (Postgres) +
**Temporal** + Resend, pnpm monorepo, `apps/` + `libraries/`. Features:
scheduling across platforms, analytics, collaboration (invite, comment,
exchange/buy posts), automation/API (public API, NodeJS SDK, N8N node, Make.com
integration), self-hosting. Compliance stance: official platform-approved OAuth
flows only; explicitly does **not** automate or scrape; does **not** collect,
store or proxy user API keys; users always authenticate directly with the
platform. Platforms advertised: X, Instagram, YouTube, Dribbble, LinkedIn,
Reddit, TikTok, Facebook, Pinterest, Threads, Slack, Discord, Mastodon,
Bluesky.

**Reference only — do not copy.** AGPL-3.0 is strong copyleft, and network
service use triggers source-disclosure obligations. Extract patterns, not code.

| Postiz primitive | What ContentForge should take | Verdict |
|---|---|---|
| Separate platform integrations per channel | Confirms the adapter boundary; Postiz's per-platform modules are the same shape as 07 §12 | Already locked (P-5) |
| Posting/scheduling across N platforms from one composer | Composer UX: one Artifact → N channel Publications | EXTEND (`generate.tsx` composer) |
| Calendar + list scheduling UX | Calendars, queue views, per-channel previews | EXTEND (`calendar.tsx`, `queue.tsx`) |
| Drag/drop rescheduling | The main calendar affordance we lack | NEW (DI-9) |
| Teams, invite, comments, exchange | Multi-brand/agency direction | NEW → Later (§13 AP-2) |
| Analytics aggregation | Confirms per-channel mapper + normalized metrics | Already locked (07 §8) |
| Public API + SDK + N8N/Make | Automation surface for agents; also the auth problem we must solve | NEW → §13 AP-1 |
| Self-hosting posture | Operational reference for a Node+Postgres single-VPS deploy | Reference |
| Temporal workflow engine | **Do not adopt.** Our locked decision is pg-boss (06 §6). Temporal is prior art for durable-workflow *concepts* we already mapped onto pg-boss | Locked — not reopened |
| Official-OAuth-only compliance stance | Directly validates our "no cookie automation in core publishing" rule | Aligns |
| Email notifications (Resend) | Reference for WS-7 notifications | Reference |
| i18n, dynamicconfig, CodeRabbit | Not needed for a single-operator app | Out of scope |

**Key operational lesson:** Postiz's OAuth-only, no-key-proxying stance is the
compliance-safe posture for *publishing*. It is a different problem from
*research*, where our providers may legitimately read public web/feeds. Keep the
two stances separate — that distinction is §13 AP-4.

---

# 6. Research-provider matrix

Two external references, both behind the locked SourceProvider seam. Neither is
embedded; neither becomes the domain contract.

## 6.1 last30days (mvanhorn/last30days-skill, MIT, 61.7k★, Python 3.12+)

An agent-led search engine scoring by real engagement (upvotes, likes, odds)
rather than editorial ranking, over a rolling recency window ("last 30 days").
Actively evolving (v3.x, multiple releases; user cited v3.24.0 on 2026-09-09) —
**treat as an externally replaceable provider, never a copied subsystem.**

Sources: Reddit (with top comments), X/Twitter, YouTube (**full transcripts**),
TikTok, Instagram Reels, Hacker News, Polymarket, GitHub, Digg, arXiv,
Techmeme, LinkedIn, StockTwits, Threads, Pinterest, Xiaohongshu, Bluesky,
Perplexity (Agent/Search/Deep Research), Web search.

Primitives worth mapping onto our locked architecture:

| last30days primitive | Maps to | Verdict |
|---|---|---|
| "Pre-research brain" resolves handles/subreddits/hashtags/ repos before any API call | Provider resolution stage before `discover`/`search` | New capability, IN-9/IN-1 |
| Multi-query expansion + parallel source fan-out | ResearchEngine Collect stage (04 §2) | Aligned |
| Cross-source cluster merging ("same story, merged") | Conflict/dedupe relations (04 §5) — canonical-URL dedupe is our starting point | Aligned; cluster merging EXTEND |
| Engagement-ranked scoring over a time window | RankingHook (04 §9) + autonomy config | Aligned |
| `--store` SQLite accumulation, watchlist deltas, briefings | Scheduled research + digest (AU-3, C5) | New capability |
| Offline library index + search ("have I researched X before?") | Research library (IN-13) | New capability |
| `--discover` topic-less discovery mode | AutonomousInitiation (04 §3) | Aligned |
| `--emit=json` **versioned** agent contract | NormalizedSource / frozen ResearchJob output (04 §7) | Aligned — adopt the versioning discipline |
| `--as-of` historical lookback | Research window parameter | New capability |
| `doctor`/`--diagnose` provider health | Provider health/observability | New capability |
| Bring-your-own-keys; optional degradation to web-only | Provider capability + budget config | Aligned |
| **Browser-cookie extraction across Chromium family, macOS Keychain, Linux pass** | ⚠️ Conflicts with our official-API/feeds-only constraint | **§13 AP-4 — decision required** |
| Stored-XSS hardening in HTML renderer; cookie temp-file lockdown | Security reference for our own brief rendering | Adopt practice |

**Recommendation:** last30days is best treated as **(a) an EXTERNAL PROVIDER**
behind SourceProvider for recent-discussion research (IN-12), and **(b) a design
reference** for resolution, clustering, library, watchlist and the versioned JSON
contract. Its prompt contract must NOT become ContentForge's domain contract.
Whether it runs as an external executable/sidecar or is reimplemented natively is
a §13 decision (AP-3 execution model).

## 6.2 Agent-Reach (Panniantong/Agent-Reach, MIT, 79.2k★, Python 3.10+)

Self-described as a **capability layer, not a tool**: it chooses, installs,
health-checks and routes access methods; the actual reading is done by upstream
CLIs the agent calls directly. Channels: web (Jina Reader), YouTube (yt-dlp),
RSS (feedparser), full-web search (Exa via mcporter), GitHub (gh CLI), X
(twitter-cli ▸ OpenCLI ▸ bird), Bilibili (bili-cli ▸ OpenCLI), Reddit (OpenCLI ▸
rdt-cli), Facebook/Instagram (OpenCLI browser session), Xiaohongshu (OpenCLI ▸
xiaohongshu-mcp ▸ xhs-cli), LinkedIn (mcp-server-linkedin ▸ Jina Reader), V2EX,
Xueqiu, podcast transcription.

The **single most valuable pattern**: each channel is an *ordered list of
preferred + fallback backends*, and `agent-reach doctor` **really probes** each
candidate (not just checking a command exists), selects the first fully working
one, and prescribes fixes for broken ones. Backends rotate over time (documented
example: yt-dlp was blocked by Bilibili in 2026-06 → switched to bili-cli, user
saw nothing).

| Agent-Reach pattern | Maps to | Verdict |
|---|---|---|
| Channel = ordered preferred+fallback backend list | SourceProvider internals: multiple backends per provider | **Adopt** — this is our fallback strategy (§8) |
| Real probing + `doctor` health command | Provider health checks + observability | Adopt |
| Capability layer above implementations; no wrapper around reads | Confirms provider edge owns normalization, engine owns nothing provider-specific (04 §4) | Aligned |
| Pluggable channel files (swap one without touching others) | Provider registry (04 §4) | Aligned |
| Credentials local-only, file mode 600, never uploaded | Our vault is server-side encrypted `enc:v1:` — different trust model | §13 AP-4 |
| Explicit "use a burner account, cookie use risks bans" warning | ⚠️ ToS/ban risk is real; our core publishing forbids this path | §13 AP-4 |
| `--dry-run` / default-safe install (no system changes without explicit flag) | Operational reference for provider enablement | Adopt practice |
| Reusing the user's existing browser session (OpenCLI) | ⚠️ Not compatible with a server-side, headless, multi-tenant architecture | **Out of our core model** |

**Recommendation:** Agent-Reach is best treated as **(a) the design template for
our provider registry's multi-backend fallback and health model**, and **(b)
potentially an EXTERNAL adapter target** if we ever permit a desktop/local-agent
mode — but NOT as a server-side dependency, because its access model relies on
local browser sessions and user-supplied cookies that our locked architecture
and deployment shape cannot and should not carry.

---

# 7. Shared primitives

Eight primitives. Every capability in §2 must name the one it builds on; none
gets its own pipeline.

## P-1 — Ingestion: SourceProvider → ResearchJob (locked 04 §4)
**Unlocks:** IN-1…IN-14, AU-1…AU-4, CH-1…CH-3.
Provider registry with `discover` / `search` / `fetch`, multi-backend fallback
(Agent-Reach pattern), engine-owned orchestration, two-stage fetch, budget caps.
Adding a source = registering a provider. **Hard rule: new input capabilities
must not create new pipelines or new content tables.**

## P-2 — Repurposing: Story → N Opportunities → N Artifacts (locked 03 §3, 05 §2/§9)
**Unlocks:** CR-1…CR-16, VI-1…VI-9, IN-13.
One Story spawns many format×channel Opportunities; each Opportunity has its
own GenerationJob → Artifact chain. Format change **never** re-runs research.

## P-3 — Policy: versioned generation policy → frozen `policy_snapshot` (05 §5)
**Unlocks:** CR-9…CR-16, SB-1…SB-9, VI-4, VI-6, AU-6…AU-8.
Templates, brand voice, format rules and channel limits all become inputs to
**one** assembly step producing a versioned policy that GenerationJob snapshots
verbatim (full rendered prompt text embedded, never referenced).

## P-4 — Context: context source → research/generation context
**Unlocks:** IN-13, IN-14, SB-8, CR-1, CR-3, CH-5.
`references`, `context_vault`, `style_profiles`, `canned_responses`, brand
profile, `memoryJson`, `brandingJson` and Market Pulse become *context sources*
feeding one assembly seam — not six parallel stores. **This is the Second Brain's
storage layer.**

## P-5 — Distribution: Artifact → Publication → Channel Adapter (locked 07 §1/§2/§12)
**Unlocks:** DI-1…DI-12, CH-4.
One adapter interface (`validate`/`publish`/`reconcile`/`capability`); opaque
idempotency token; four retry classes; normalize outcome. Registering a channel
= adapter + payload schema + policy version + gate + error map + analytics
mapper, with **zero core changes** — that zero is the acceptance proof.

## P-6 — Readiness: Artifact readiness machine (03 §2, 05 §6/§8)
**Unlocks:** WS-1, WS-2, WS-3, AU-7, AU-8.
`draft → in_review → approved | rejected`; revisions via `supersedes_id`; only
approved revisions reach Schedule. Retires all three contradictory status
vocabularies.

## P-7 — Media: Artifact ↔ visual asset references (⚠️ unspecified — AP-3)
**Unlocks:** VI-1…VI-9, CR-12.
Images, carousel renderings and future video thumbnails need an asset identity
and a relation to an exact Artifact revision. Locked 05 defines JSONB payloads
but **not** binary media. Must be decided before Phase E.

## P-8 — Signal: outcome + edit signals → learning (⚠️ unspecified — AP-9)
**Unlocks:** SB-9, SB-10, AN-5, AN-7, AN-9.
Draft → human edit → approval → publication → Result is the learning corpus.
Read-only derivation; **never** mutates historical Artifacts or generation
records. Where signals are stored and how they feed policy is unbuilt.

---

# 8. Architecture fit

| Capability cluster | Fits locked architecture? | Notes |
|---|---|---|
| Intelligence (IN-1…IN-14) | **Mostly yes** | IN-1…IN-9, IN-13, IN-14 sit cleanly on 04 §4. IN-10/IN-11 are *already locked* (04 §5) and simply have no code yet. IN-12 is an external provider. |
| Personalization (SB) | **Yes** | All inputs to policy assembly (05 §5). SB-2 needs the profile/observed-evidence split; SB-9/10 need P-8. |
| Creation (CR) | **Yes** | Every format is a payload schema + policy (05 §6/§7). CR-4/CR-6 are the locked chain itself, unbuilt. |
| Visuals (VI) | **Partial** | VI-1…VI-8 fit as payload parts + policy. **VI-9 does not fit** until the media model is decided (AP-3). |
| Distribution (DI) | **Yes** | DI-1…DI-12 are 07 §12 registrations plus Result analytics; DI-11 is explicitly locked (07 §3/§13). |
| Workspace (WS) | **Partial** | WS-1/2/3/5/6/8 fit (readiness + Schedule + audit/Result). **WS-7 notifications, WS-9 search, WS-10 collaboration, WS-11 multi-brand do not fit** — they need new boundaries (AP-2, AP-7, AP-8). |
| Chrome/capture (CH) | **Partial** | CH-1…CH-3 fit as ingestion. **CH-4/CH-6 need external-client auth** (AP-1). CH-5 deferred. |
| Analytics (AN) | **Yes** | AN-1…AN-4, AN-6, AN-8 are Result + derived views; AN-5/AN-7/AN-9 are derivations over locked fields (format, Story topics, signals). |
| Automation (AU) | **Yes** | AU-1/AU-2 generalize existing connectors; AU-3…AU-5 are Schedule + research + RankingHook; AU-6…AU-8 are GenerationJob/approval triggers. |

**Nothing in this map requires changing Tickets 01–08.** The four capabilities
that don't fit (media assets, notifications, cross-entity search, identity) are
new *boundaries*, recorded in §13.

---

# 9. Dependencies

```
                     ┌──────────────────── LOCKED CORE (Tickets 01–08) ────────────────────┐
                     │  ResearchJob → Story → Opportunity → GenerationJob → Artifact        │
                     │  → Schedule/Occurrence → Publication → Adapter → Result              │
                     │  + payload-schema registry + policy snapshot + pg-boss               │
                     └───┬───────────────┬──────────────────┬──────────────────┬────────────┘
                         │               │                  │                  │
                ┌────────▼──────┐  ┌─────▼─────────┐  ┌─────▼──────────┐  ┌────▼───────────┐
                │ P-1 Ingestion │  │ P-2/P-3 Reuse │  │ P-4 Context    │  │ P-5 Distribution│
                │ SourceProvider│  │ + Policy      │  │ (Second Brain) │  │ + P-6 Readiness │
                └───┬───────┬───┘  └──┬────────┬───┘  └───┬────────┬───┘  └───┬────────┬───┘
                    │       │         │        │          │        │          │        │
        ┌───────────┘       │         │        │          │        │          │        │
        │        ┌──────────┘         │        │          │        │          │        │
        ▼        ▼                    ▼        ▼          ▼        ▼          ▼        ▼
   ┌────────────────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐
   │ Phase D                │  │ Phase C      │  │ Phase C      │  │ Phase E  │  │ Phase F  │
   │ IN-1..IN-14            │  │ CR-1..CR-16  │  │ SB-1..SB-10  │  │ VI-1..VI-8│ │ DI-2,    │
   │ AU-1..AU-5             │  │ SB via P-3   │  │ IN-13, IN-14 │  │ (needs   │  │ DI-3,    │
   │ IN-12 EXTERNAL         │  │ CR-16 xforms │  │ CH-5 defer   │  │  P-7)    │  │ DI-6,    │
   └───────────┬────────────┘  └──────┬───────┘  └──────┬───────┘  └──────────┘  │ DI-9..12 │
               │                      │                 │                        └────┬─────┘
               │                      └────────┬────────┘                             │
               ▼                               ▼                                      ▼
   ┌────────────────────────┐        ┌────────────────────┐              ┌──────────────────────┐
   │ Phase G                │        │ Phase G            │              │ Phase G              │
   │ AU-3..AU-8 automation  │        │ AU-6..AU-8         │              │ AN-1..AN-9 analytics │
   └────────────────────────┘        └────────────────────┘              └──────────┬───────────┘
                                                                                    │
                                                                         ┌──────────▼──────────┐
                                                                         │ P-8 Signal loop     │
                                                                         │ SB-9, SB-10, AN-5/7/9│
                                                                         └─────────────────────┘

   Blocked on NEW architectural decisions (not Phase B/C/D/E/F/G):
   ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
   │ AP-1 external auth   │   │ AP-2 identity        │   │ AP-3 media model     │
   │ → CH-4, CH-6, DI-3   │   │ → WS-10, WS-11       │   │ → VI-9, CR-12        │
   └──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

**Critical path:** P-1 and P-2/P-3 gate the two biggest waves (research
expansion, creation intelligence). P-5 gates all multi-platform work. Nothing
downstream of P-7/P-8 can start before those models are decided.

**Cross-cutting rule (from the roadmap prompt):** every implementation ticket
must name its shared primitive. A "YouTube-to-post" ticket that creates a
YouTube-specific table or pipeline is wrong by construction — it must be a
provider registration plus policy.

---

# 10. Phase ordering

Phases as specified in the product goal. **Phase B is unchanged and already
committed**; C–H are the post-Phase-B roadmap ordered so each phase unlocks the
next.

| Phase | Name | Contains | Blocked by |
|---|---|---|---|
| **B** | Foundation vertical slice | Locked chain end-to-end for X only (see §11) | — |
| **C** | Creation intelligence | SB-1…SB-10, CR-1…CR-6, CR-14…CR-16, IN-13/14 (P-2, P-3, P-4, P-6) | B (payload registry + policy snapshot) |
| **D** | Research expansion | IN-1…IN-12, AU-3…AU-5 (P-1) | B (engine); IN-12 needs AP-4/AP-5 |
| **E** | Visual creation | VI-1…VI-9 (P-7) | B; VI-9 needs AP-3 |
| **F** | Multi-platform | DI-2, DI-3, DI-6, DI-9…DI-12 (P-5) | B; proves 07 §12 zero-core-change |
| **G** | Automation | AU-1…AU-8, AN-1…AN-9, WS-5, WS-8 (P-6, P-8) | C, D, F |
| **H** | Advanced workspace | WS-7, WS-9, WS-10, WS-11, CH-1…CH-6 | AP-1, AP-2 (+ AP-7, AP-8) |

Ordering rationale: C before D because policy assembly is what makes research
*usable* for multiple formats; D before E/F because evidence + Story are the
substrate; F after C because channels need formats; G after C/D/F because
automation and analytics need outcomes to exist; H last because it needs
decisions, not just code.

**Recommended first implementation phase: Phase B** (§16).

---

# 11. Phase B boundary

**In Phase B (committed, unchanged):**

- Topic / URL → **ResearchJob** (one provider minimum, one initiation mode)
  → **Story** → **Opportunity** → **GenerationJob** → **Artifact**
  (X post + X thread payload schemas) → **approval** → **Schedule**
  → **Publication** → **X adapter** (xQuick transport) → **Result**.
- Infrastructure that makes the path reliable: **pg-boss** queue, generic job
  envelope, Schedule/Occurrence materialization, single-flight lease,
  DB-unique idempotency key, four retry classes, DLQ, `publish_outcome_unknown`
  + reconcile-first, per-schedule timezone, correlation-ID observability.
- The two registries that everything later depends on: **payload-schema
  registry** (P-2/P-3) and **SourceProvider registry** (P-1).
- Artifact approval + publication release as the two human gates.

**Explicitly NOT in Phase B** (parked; must not be silently pulled forward):

| Parked | Phase |
|---|---|
| Voice/second-brain, templates-as-policies, chat-to-post, transforms | C |
| YouTube transcripts, Reddit/blog/URL/trend providers, last30days/Agent-Reach | D |
| Images as Artifact parts, carousel payloads, visual provider | E |
| LinkedIn, Threads, Bluesky, Mastodon, and every other channel | F |
| RSS/YouTube autopost, scheduled research, auto-opportunities, auto-approval | G |
| Notifications, search, collaboration, multi-brand, Chrome extension | H |

**Phase-B scope discipline:** X post + X thread only. Multi-channel or
multi-format work in Phase B is a scope violation, not a bonus.

---

# 12. Post-Phase-B roadmap

Summarized per phase; full ticket decomposition is Prompt 6's deliverable
(`ROADMAP.md`), which must read this map plus its four sibling documents.

**Phase C — Creation intelligence.** P-3 policy assembly first (dedupe two
voices + three pillar lists ⇒ SB-1, SB-7), then P-4 context seam (SB-3, SB-4,
SB-8 ⇒ makes `memoryJson`/`brandingJson` actually shape output), then P-2 in
anger: CR-4 research-to-content, CR-6 one Story → many Opportunities, CR-5
repurposing with reachable UI, CR-1 chat-as-initiation, CR-16 transformations as
new Artifact revisions. Deliverable: the same Story yields an X post, an X
thread and a LinkedIn post with no re-research, each under a frozen policy.

**Phase D — Research expansion.** P-1 registry + migrate the six existing
discovery sources as a behavior-preserving refactor, then add providers: IN-5
YouTube transcript, IN-3/IN-4 web+article with a per-kind extractor registry,
IN-7 RSS cursor, IN-8 trends, then IN-12 last30days behind the seam (AP-4). Add
scheduled research (AU-3), autonomous opportunities (AU-4, AU-5), research
library + offline search (IN-13).

**Phase E — Visual creation.** Decide AP-3, then P-7: asset identity + relation
to exact Artifact revision, replaceable visual provider, variations and
refinement, platform dimension policies, carousel-as-payload, themes. Editors
gain attach.

**Phase F — Multi-platform.** LinkedIn first (07 §12 dry-run that also proves
zero core changes), then Threads, Bluesky, Mastodon; recurrence (DI-6),
calendar drag/drop (DI-9), publication history (DI-10), reconciliation (DI-11),
analytics mappers (DI-12). Each channel is one registration.

**Phase G — Automation.** Generalize RSS/YouTube connectors (AU-1, AU-2) onto
provider + policy; enable approval gates as *optional* config (AU-7) so
autopilot stops bypassing approval; automatic publishing after approval
(AU-8); analytics derivations (AN-5, AN-7) and the signal loop (P-8, AN-9).

**Phase H — Advanced workspace.** Decide AP-1/AP-2, then notifications (WS-7),
search (WS-9), activity feed (WS-8 UI), Chrome extension (CH-1…CH-6),
collaboration and multi-brand (WS-10, WS-11).

---

# 13. New architectural decisions required

These are **not** reopened locks. They are boundaries Tickets 01–08 did not
settle, exposed by the expanded product goal. Each must be decided before its
phase.

| ID | Decision | Blocks | Why it doesn't fit today |
|---|---|---|---|
| **AP-1** | **External-client authentication** — PAT/API-key table, bearer middleware, actor + scope semantics | CH-1…CH-6, DI-3, all agent/automation API | Inbound is session cookie + CSRF only; no PAT table, no bearer path. The bookmarklet is unauthenticated. Needed for Chrome extension and any external agent. |
| **AP-2** | **Identity model** — enforce `user_id` → org → brand → membership, brand-scoped vault/pillars/accounts, switching context | WS-10, WS-11, multi-brand operation | `user_id` retrofit is nullable with no FK/index and `storage.ts` never filters; only working per-user surface is `user_profile`. Brand persona is hardcoded in ≥5 files. Not a query-parameter sweep. |
| **AP-3** | **Media/asset model** — asset identity, storage, relation to an exact Artifact revision (embedded in payload JSONB vs first-class asset entity vs both) | VI-9, CR-12, Phase E | Locked 05 specifies JSONB payload validated per format but is silent on binary media. Images live in a side table (`generated_images`). |
| **AP-4** | **Research access policy** — confirm official APIs/feeds only, or permit cookie/browser-session access for *research* providers | IN-12, Phase D, any last30days/Agent-Reach integration | Locked `xDeveloperRisk` says no scraping and official APIs/feeds only. last30days and Agent-Reach both rely on browser cookies / local sessions for several sources, with documented ban risk. **Recommendation: keep core publishing OAuth-only (Postiz-aligned) and keep research cookie-free; treat any cookie-based provider as opt-in, local-agent-only, never server-side.** |
| **AP-5** | **External provider execution model** — in-process library vs external CLI/sidecar vs HTTP service; where Python 3.12 / yt-dlp / Node toolchains live | IN-5, IN-12, Phase D | ContentForge is a Node/Express app; last30days is Python 3.12+ and Agent-Reach is a Python CLI orchestrating third-party binaries. Running them in-process is not possible without a new runtime. |
| **AP-6** | **Digest vs trends split** — a "digest" is both ingestion (trend signals) and a generated Artifact | IN-8, AU-4, Phase D | Must be split across P-1 (trends provider) and P-2 (digest as Opportunity/Artifact), or digest generation becomes a second research engine. |
| **AP-7** | **Notification surface** — table, delivery channels (in-app/email/webhook), which events (DLQ growth, `publish_outcome_unknown` age, scheduled-but-unexecuted, published-without-Result, approvals pending) | WS-7, Phase G/H | No notifications table, no email lib, no SSE/WS. But 06 §13 already requires an alert set with "locked existence" — the mechanism was never chosen. |
| **AP-8** | **Cross-entity search** — Postgres FTS vs external index; scope (posts/ideas/references/Stories/Artifacts/Results) | WS-9, Phase H | No search endpoint exists; only a client-side vault filter. |
| **AP-9** | **Learning-signal store** — what signals are captured, where, and how they feed policy without mutating history | SB-9, SB-10, AN-9, P-8 | No feedback loop exists at all; `analytics` and `viral_scores` are write-only toward generation. |
| **AP-10** | **Voice-state separation** — pin the boundary between stable profile, observed evidence, and the frozen policy snapshot | SB-1, SB-2, SB-9, Phase C | Today voice is a base prompt string plus a duplicate constant; "do not hide voice state inside prompts" requires three distinct homes. |
| **AP-11** | **Registry mechanics** — code registry vs DB table for providers and payload schemas; where format policies are stored and versioned | P-1, P-2/P-3, Phases C/D | Both 04 and 05 say "registry" without pinning the mechanism or the policy storage location. |
| **AP-12** | **Compliance/ToS posture split** — formally separate publishing compliance (official OAuth, no proxying) from research compliance (public feeds, rate limits, robots/ToS per source) | AP-4, §14 | Postiz's OAuth-only stance is correct for publishing and silent about research; we need an explicit policy per side. |

---

# 14. Security / compliance boundaries

**Non-negotiable (already locked or already built):**

- **Retrieved content is never trusted instruction.** Evidence excerpts,
  provider bodies, page text and transcripts enter the system as *data with
  origin tags*, never as prompts. Prompt-injection defense is a first-class
  requirement of the research engine and every provider: retrieved text must not
  be concatenated into a system prompt, must not be able to call tools, and must
  be quoted/marked as untrusted in synthesis. (Locked 04 §6 origin separation is
  the mechanism; the injection rule makes it a security control.)
- **Tokens encrypted at rest** — `enc:v1:` AES-256-GCM boundary, already built
  (`middleware/crypto.ts`, `storage.ts:584-607`).
- **No channel-specific domain model** — no channel mechanics leak into core.
- **Publication safety** — lease + DB-unique idempotency + `provider_called`
  flag + reconcile-first `publish_outcome_unknown` + no blind retry.
- **Artifact immutability** — no mutation of executed/approved rows, ever.

**Required new boundaries:**

- **Credentials never proxied.** Follow Postiz's stance: users authenticate
  directly with the platform; we store the resulting token encrypted in the
  vault, we do not ask for or proxy passwords, and we never accept pasted API
  keys for a hosted third party.
- **Cookie/browser-session access is prohibited in the server core.** Cookie
  paths (Agent-Reach OpenCLI, last30days browser extraction) carry documented
  account-ban risk and require a user-controlled local session. If ever
  supported, only as an opt-in local agent outside the server, never stored
  server-side. (AP-4.)
- **Untrusted-render hardening.** last30days' stored-XSS fixes in its HTML
  renderer are a direct warning for our own brief/digest rendering: sanitize
  (we already have DOMPurify in `routes.ts:30-46`) and never render provider
  HTML raw.
- **Provider egress allowlist + rate limiting + budget caps** per provider;
  `Retry-After` honored as reschedule, not attempt.
- **Upload validation** already exists; extend to any new media ingest.
- **Audit** already writes every non-GET; it must gain a read surface (WS-8)
  before multi-user exists, or it cannot answer "who published this".
- **Multi-tenant isolation** must be real (AP-2) before any collaboration or
  second brand ships — today every query is global.

---

# 15. Licensing considerations

| Component | License | Posture |
|---|---|---|
| **Postiz** (`gitroomhq/postiz-app`) | **AGPL-3.0** | **Reference only. Do not copy or embed.** Strong copyleft; network-service use triggers source-disclosure. Extract UX and operational patterns, write our own code. Note Postiz also requires a CLA of contributors (CCLA/ICLA), reinforcing that its code is not a source we can lift. |
| **last30days** (`mvanhorn/last30days-skill`) | **MIT** | Permissive; embedding is legally possible with attribution. Even so, keep it **behind the provider seam** — it is actively evolving (v3.x), so a native reimplementation or a replaceable external dependency is an engineering choice (AP-5), not a licensing one. |
| **Agent-Reach** (`Panniantong/Agent-Reach`) | **MIT** | Permissive. Same posture: reference/adapter target, not a vendored subsystem. It orchestrates **third-party** tools (yt-dlp, Jina Reader, Exa, gh CLI, feedparser, OpenCLI, twitter-cli, bili-cli, xiaohongshu-mcp, mcp-server-linkedin, …) each with its **own** license and Terms of Service — those must be reviewed individually if we ever route through it. |
| **xQuick** (current X transport) | Existing dependency | Already in use; stays transport-only per locked 07. |
| **Dependencies we already run** | — | No change proposed by this map. |

**Practical rules:** (1) AGPL ⇒ reference, never copy. (2) MIT ⇒ technically
usable, but prefer the seam so we stay swappable. (3) Any external tool's ToS is
a *product* constraint, not just a legal one — platform bans and rate limits are
operational risks.

---

# 16. Recommended first implementation phase

**Recommendation: Phase B — the foundation vertical slice, unchanged and
unwidened.**

Rationale: every CannerAI-parity capability in this map is a *derivation* of the
locked chain. Phase C–H work built before the chain exists would either fork the
pipeline (exactly what the roadmap's critical rule forbids) or have to be thrown
away. Phase B is also what makes the two registries real — and those two
registries are the load-bearing pieces for all 89 capabilities mapped here.

**Smallest first ticket that does not redesign anything** — recommended for the
roadmap prompt to formalize:

> **Ticket: Payload-schema registry + policy snapshot skeleton (Phase B, step 1).**
> Introduce the per-format payload-schema registry as a code-level registry
> (no new domain tables beyond the locked core) with exactly two registered
> payload schemas — `x_post` and `x_thread` — and the `policy_snapshot` shape
> (format policy ref + version + model + params + rendered prompt text +
> input hashes). Validate existing X content against it. No behavior change to
> publishing; nothing else in Phase B can be built correctly until formats are
> data rather than code.

Runner-up if a visible slice is preferred first: **SourceProvider registry seam
with the six existing discovery sources registered behind it as a
behavior-preserving refactor** — pure refactor, zero output change, unblocks all
of Phase D.

---

# 17. Provenance of this map

- **Expanded product goal:** supplied by the user 2026-09-10 (this session),
  naming CannerAI as feature reference, Postiz as scheduling/publishing
  reference, last30days + Agent-Reach as research/internet-access references.
- **Locked inputs:** Wayfinder tickets 01–08 (`plans/wayfinder-contentforge/`).
  Restated, not reopened.
- **Prior artifact absorbed:** `plans/cannerai-parity/MAP.md` (16-capability
  CannerAI map; retained on disk, superseded as the top-level map by this one).
- **Code inventory:** read-only walks of `server/`, `shared/`, `client/src/`,
  `migrations/` on the `replit` branch. No files modified other than this map
  and a pointer line in the Wayfinder map.
- **External prior art:** read via GitHub on 2026-09-10 — Postiz README/feature
  list/tech stack/license/compliance section; last30days README (sources, v3
  pipeline, configuration, library, licensing); Agent-Reach README (channel
  routing model, `doctor`, cookie/security posture, license). No external code
  was copied or added as a dependency.
- **Anchors** are valid as of 2026-09-10 and must be re-verified at
  implementation time.
