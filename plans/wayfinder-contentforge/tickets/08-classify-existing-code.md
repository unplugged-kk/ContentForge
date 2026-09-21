# Ticket: Classify existing code KEEP/REFACTOR/GENERALIZE/REPLACE/REMOVE/DEFER

Type: `wayfinder:task` (HITL — agent drafts, human confirms) | Status: closed 2026-09-10
Blocked by: 03, 04, 05, 06, 07 (needs all architecture decisions) — satisfied, all closed.

## Question

Walk the existing ContentForge surface (`server/routes.ts`, `server/storage.ts`,
`shared/schema.ts` tables, scheduler, autopilot, social, discovery, analytics)
and classify each area KEEP / REFACTOR / GENERALIZE / REPLACE / REMOVE / DEFER
against the locked domain, research, story, scheduler, and publishing
decisions. Constraint: do not rewrite working functionality for cleanliness —
prefer generalizing. Output is a classification table with reasons, one row per
area.

## Resolution

Locked 2026-09-10 via agent draft + human confirm (5 questions, all
recommendations accepted). Rule throughout: prefer generalizing working code
over rewriting it. No implementation — classification and migration direction only.

### Classification table (one row per area)

| Area (files) | Verdict | Reason / direction |
|---|---|---|
| `posts` table (`shared/schema.ts:14-34`) — god-table mixing readiness + distribution + retry + policy + provenance | REPLACE | Split along the readiness/distribution line (03 §5): content → Artifact payloads, status/scheduledAt → Schedule/Publication state, retry cols → queue config + DLQ, externalIds/Urls → Result proof. No mapping layer (rejected — carries the collapse forward). |
| `tweets` table (`schema.ts:36-43`) | REPLACE | Retires into `post`/`thread` Artifact payload JSONB. Position/content/charCount become payload schema, not rows. |
| `articles` table (`schema.ts:108-126`) | REPLACE | Same treatment as third payload schema (`article`); unifies the two artifact stores into one Artifact table. `postId` cross-link retires. |
| `ideas` + `discovered_ideas` (`schema.ts:45-53,187-213`) | REPLACE | Never become Stories directly. `ideas` = manual signals, `discovered_ideas` = triage output; both feed Opportunity proposal. Promotion to Story requires synthesis with claim refs + origin tags (05 adversarial lock). `contentAngles/suggestedHook/viralScore` inform the proposer, do not transfer as provenance. |
| `analytics` table + `upsertAnalytics` (`schema.ts:64-78`, `storage.ts:305-320`) | REFACTOR | Evolves into Result metrics snapshots: unique per-publication identity (missing today), true upsert (delete+insert is race-prone). Manual vs x_api `source` rows unify under snapshot append. |
| `viral_scores` table (`schema.ts:225-237`) | GENERALIZE | Per-Artifact evaluation records re-keyed to `artifact_id` (polymorphic postId/articleId retires). Correctly placed already, just repointed. Must not conflate with idea-level `viral_score` guess (RankingHook input, not evaluation). |
| `templates` table (`schema.ts:55-62`) | GENERALIZE | Seed corpus for versioned format policies, generalized off postType/pillar keys. Matcher (`matchTemplate`) becomes policy-selection logic. |
| `discoverRefresh.ts` (6 source blocks) | GENERALIZE | Each inline block (HN, Reddit, RSS, GitHub, ArXiv, Trends) becomes a SourceProvider behind 04 §4; orchestration becomes engine code; the 20-idea AI call becomes the first RankingHook. Hardcoded queries/fallbacks retire into config or deletion. |
| `marketPulse.ts` (niche filter + boost) | GENERALIZE | Niche terms + boost multipliers become domain config + hook context; `xAlgorithmContext` becomes channel-specific ranking-context input, not engine core. |
| `rssAutopost.ts` + `youtubeConnector.ts` | GENERALIZE | Source-side rows already carry autopost policy; prompt skeleton + `---` protocol + host-substring join generalize into provider fetch + policy-driven generation. Hardcoded user id (1) becomes actor. |
| `discovery_settings` live fields (`rss_sources`/`youtube_channels` autopost*) | KEEP | Already the working policy store — wire as engine/provider config. |
| `discovery_settings` dead fields (`enabledSources`, `minViralScore`, `customKeywords`, `monitoredXAccounts`) | REMOVE | No readers anywhere. `monitored_accounts` table: writers but no readers — REMOVE or repair in cutover (no parallel dead config). |
| `reference_posts` table | REMOVE | Duplicates `reference_content`; dead-write table, only touched in delete cascade. |
| Migration `0003` replay of `0002` | REMOVE | Branch/squash divergence artifact; squash before cutover so ordered apply doesn't error on duplicate CREATEs. |
| `server/ai/config.ts` + `chat.ts` gateway (`aiCall`/`logAiUsage`/MODELS) | KEEP | Sole model access path (04 §2). Engine adds prompts + validation, never a second client. |
| `brandSystemPrompt.ts` + `KISHORE_VOICE` + `formatPrompt`s + thread utils | GENERALIZE | Prompt craft is the asset; inline constants become versioned format-policy content, parameterized by channel instead of hardcoded `"x"`. Divergent discover-expand persona (routes.ts:2070) converges onto the same policy. |
| Autopilot draft builders (`generateDraftFromIdea`, `generateArticleDraftFromIdea`, rss/YT autopost) | GENERALIZE | Become GenerationJob executors: same prompt-building craft, inputs switch from idea blobs to (Story + basis claims + frozen policy), outputs write Artifacts with embedded policy snapshots. |
| `server/scheduler.ts` cron table | REFACTOR | Timers RETAINED as trigger-only (06 §14); bodies shrink to materialize + enqueue. DISABLE_* flags KEEP, generalized per job_kind. Per-minute publish full-scan loop: REPLACE with materializer + pg-boss. Hand-rolled retry/backoff: REPLACE with queue config + DLQ (delays kept as initial transient policy). CRON_TZ global: GENERALIZE to per-schedule tz. |
| `server/social/x.ts` | REFACTOR | SPLIT into X adapter layers (07 §6): transport (xQuick POST + chain + write-action polling) + channel policy (gate, numbering, slicing, finisher, compliance) + payload assembly + error classifier. `Post & Tweet[]` input signature retires. |
| `assertEligibleForXPublish` + `X_COMPLIANCE_RULES` | GENERALIZE | Gate shape becomes per-channel adapter policy invoked at worker time; X rules table stays as the X instance; doc stays human reference. |
| `tryPublishPostById` execution body | REFACTOR | Becomes publish-worker handler (lease → eligibility re-check → provider call with `provider_called` flag → Result write), minus status-string state machine. |
| `translateXError` | GENERALIZE | Moves into X adapter as classifier input mapping to core's four retry classes. |
| Analytics sync (`syncPostAnalyticsFromX`, `refreshXAnalytics`, daily cron) | GENERALIZE | Becomes maintenance jobKind + per-channel analytics mapper (07 §8). Fire-and-forget-after-publish retires as orphan code; first sync owned by worker completion or first maintenance tick. Budget logging (`xquick-api` rows) KEPT. |
| `connected_accounts` vault + encryption | KEEP | OAuth vault with `enc:v1:` boundary carries forward; upsert keyed on platform stands. |
| Cost dashboard (`/api/ai-usage/dashboard`, `MODEL_PRICING`, x-usage budget) | KEEP | Working cost/tokens/budget surface; generalizes to per-job cost events later without rebuild. |
| `pillars` taxonomy + `user_profile` brand voice | GENERALIZE | Pillars become hook-context weights (already numeric in `PILLAR_WEIGHTS`); brand profile feeds policy assembly, not inline prompt strings. `messagingPillars[]` vs `pillars` table overlap resolved in cutover. |
| `references` / swipe-file + `styleProfiles` | DEFER | Valid intelligence inputs (style extraction, inspiration store) but outside the Phase-B slice (Research → Story → post/thread → Schedule → Publish → Result). No verdict on shape yet. |
| `carousels`, `cannedResponses`, `contextVault`, `generatedImages`, chat Replit integration | DEFER | Working features outside Phase B. `contextVault`/`cannedResponses` shape-duplicate — noted, not resolved now. |
| `user_id` retrofit (`0004`) + storage signature drift | REFACTOR | Columns exist, isolation doesn't (storage never filters). Enforce or drop at cutover — no parallel untracked multi-tenancy during migration. |
| `status`/`targetPlatform`/`postType` route + UI vocabulary (`routes.ts`, client) | REPLACE | Phased with the posts split: route bodies stop accepting collapsed fields once new tables are source of truth. No parallel status tracking during migration (06 §14). |
| Direct-`db` bypasses (`users`, `generatedImages`, `contextVault`, `carousels`, audit) | REFACTOR | Consolidate behind storage interface at cutover; split-brain persistence (chat `chatStorage` vs `storage.ts`) resolved one way or the other. |

### Phase-B safe reuse vs wait

REUSE in Phase B: model gateway, publish-gate shape, xQuick env plumbing,
analytics sync flow, scoring craft (as hook/config), prompt craft (as versioned
policies), account vault, cost dashboard, DISABLE_* flag pattern, autopilot slot
math (as trigger config).

WAIT (post-Phase B): references/style-profiles intelligence loop, carousels,
canned responses, chat integration, multi-user enforcement, Threads/LinkedIn
adapters (registration checklist ready, 07 §12), X articles (still gated),
ranking-threshold tuning (fog).

### Cutover rule (locked)

New tables are source of truth from cutover; no parallel status tracking, no
mapping layer over the collapse, no edits to executed rows. Migration mechanics
(backfill vs parallel-run vs flag-flip) stay fog until implementation planning.
