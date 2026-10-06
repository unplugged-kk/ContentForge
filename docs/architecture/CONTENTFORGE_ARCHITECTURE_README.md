# ContentForge — Architecture (reverse-engineered from the code)

**Audience:** a developer who just inherited this repository.
**Method:** read-only inspection of the current working tree. Every claim is tagged with
`CONFIRMED` (proved by code/config/tests), `DOCUMENTED` (only in a doc), `INFERRED`,
or `UNKNOWN` (cannot be proved from the repo).

**Companion artifacts**
- Diagram: [`contentforge-overview.architecture.html`](./contentforge-overview.architecture.html)
  (source: [`contentforge-overview.architecture.json`](./contentforge-overview.architecture.json))
- Workflow guide: [`WORKFLOW_GUIDE.md`](./WORKFLOW_GUIDE.md)
- Execution atlas: [`execution/EXECUTION_ATLAS.md`](./execution/EXECUTION_ATLAS.md)
- 10-things summary: [`UNDERSTANDING_CONTENTFORGE.md`](./UNDERSTANDING_CONTENTFORGE.md)
- Control room: [`contentforge-control-room.html`](./contentforge-control-room.html)

> **Re-audited at revision `0f3f108`.** Originally traced at `48535b59`; the repository then advanced
> through Phase 4/5 (expertise + reach intelligence, opportunity scoring, strategy, publish gate, the
> outcome loop) and Phase 6 (framing became the versioned `format_select` decision, `research_depth` got
> its own flag, and JC-01/02/03 — viral, discover, agent routing — began running in **shadow mode**).
> The diagrams now pin `0f3f108` and re-verify their source references. Earlier findings that the
> expertise/reach providers did not exist, that `opportunity_score` had no caller, or that framing
> bypassed the engine are **no longer true** — see the corrected §2.10–§2.14, §6, §10 and §11.

> The repo ships two of its own audits — `CURRENT_ARCHITECTURE.md` (dated 2026-10-02) and
> `JEV_DECISION_MAP.md` (a design plan). This README **verifies** them against the code and
> records where they disagree. Do not treat either document as runtime truth.

---

## 1. What ContentForge is — CONFIRMED

A **single-operator content system** that:

1. **Researches** the web (RSS, Reddit, HN, generic URLs, YouTube transcripts, an optional external `last30days` CLI).
2. Turns research into a **Story** and one or more **Opportunities** (a `format × channel` pair).
3. **Generates** copy with an LLM under a *frozen* policy (prompt + voice + template + context snapshot).
4. Stores the result as an **immutable Artifact revision** with a `draft → in_review → approved|rejected` readiness state.
5. **Schedules** and **publishes** approved artifacts to X, Threads, Instagram, LinkedIn, YouTube through channel adapters.
6. **Measures** results and feeds performance back into generation and (bounded) policy activation.

Everything runs in **one Node process** (`server/index.ts`) behind one **Postgres** database
(`shared/schema.ts`, Drizzle), a **pg-boss** durable job runtime, and **node-cron** schedulers.

- Stack: React + Wouter + TanStack Query (client), Express 5 (server), Drizzle + `pg` (data),
  pg-boss v10 (queue), zod (validation), OpenAI-compatible SDK (LLM). `package.json:1-167` — CONFIRMED
- Entry: `npm run dev` → `tsx server/index.ts`; `npm run start` → `dist/index.cjs` — CONFIRMED
- Tests: `npm run test:unit`, `npm run test:db`, `npm run test:e2e` (Playwright) — CONFIRMED

---

## 2. The 15 top-level components

Each row: **name** · responsibility · where it lives · entry symbol · inputs → outputs ·
key dependencies · who calls it · state it writes · external systems.

### 2.1 Operator UI  — CONFIRMED
- **Responsibility:** the single-operator web app (research, review, scheduling, analytics, autopilot).
- **Path:** `client/src/**` (entry `client/src/main.tsx`; routes `client/src/App.tsx`).
- **Inputs:** user actions over HTTP `/api/*`. **Outputs:** JSON responses, optimistic UI.
- **Called by:** the operator. **Calls:** the Express API (via `apiRequest`, `client/src/lib/queryClient.ts:25`).
- **State:** client cache only. **External:** none directly.

### 2.2 Express API + gates — CONFIRMED
- **Responsibility:** mount every router, authenticate, CSRF-protect, rate-limit, log.
- **Path:** `server/index.ts` (mounts at lines 228–283), `server/middleware/{authGate,userContext}.ts`,
  `server/httpHardening.ts`.
- **Gates (in order):** security headers (`index.ts:50`), global limiter (`:70`), session (`:147`),
  `authGate` (`:212`, global — allowlist-aware), CSRF `verifyCsrf` (`:226`), then routers.
- **Called by:** the operator UI. **Calls:** every domain router and the job runtime.
- **Mount order matters:** legacy `registerRoutes` runs first (`:228`), so its `/api/*` paths win on
  conflict; module routers follow (`/api/research`, `/api/decision`, `/api/video`, `/api/stories`,
  `/api` content, `/api/automation`, `/api/learning`, `/api/experiments`, `/api/policy-candidates`,
  `/api/policies`, `/api/autonomy`, `/api/agent`). — CONFIRMED

### 2.3 Legacy APIs + Agent — CONFIRMED
- **Responsibility:** the original monolith (posts, ideas, discover, autopilot, ingest, brand voice,
  viral scoring, analytics) **plus** the agent runtime.
- **Path:** `server/routes.ts` (3,479 lines, `registerRoutes` at `:109`), `server/autopilot.ts`,
  `server/discoverRefresh.ts`, `server/marketPulse.ts`, `server/rssAutopost.ts`,
  `server/youtubeConnector.ts`; agent in `server/agent/*`.
- **Agent entry:** `server/agent/runtime.ts:144` (`advance`), loop bound `MAX_STEPS = 16` (`runtime.ts:11`);
  HTTP at `/api/agent` (`server/index.ts:283`).
- **Inputs:** HTTP. **Outputs:** posts/ideas/drafts (legacy) or tool envelopes (agent).
- **State:** legacy tables via `server/storage.ts`; agent runs via `agent_runs`/`agent_tool_calls`.
- **This is where most *live* decisions still happen.** — CONFIRMED (see §6)

### 2.4 Jobs + Cron (runtime) — CONFIRMED
- **Responsibility:** durable background execution and all scheduled repetition.
- **Path:** `server/jobs/*` (pg-boss), `server/scheduler.ts` (legacy cron), `server/content/service.ts:745`
  (content scheduler), `server/content/autonomy/scheduler.ts` (6-hour autonomy cron).
- **Queues:** `research.run`, `generation.run`, `publication.run`, `visual.run`, `video.repurpose`,
  `style.analyze`, `automation.run`, `analytics.refresh`, `learning.extract`, `autonomy.evaluate`, `agent.run`.
- **Retry/DLQ:** every job gets a dead-letter queue; defaults `retryLimit 3`, `retryDelay 300s`,
  `retryBackoff true`, `expireInSeconds 900`, `singletonSeconds 60` (`server/jobs/registry.ts:50`).
- **Note:** `learning.extract` and `agent.run` are **registered but have no producer** — CONFIRMED (dead lanes).

### 2.5 Research Engine — CONFIRMED
- **Responsibility:** fan out to providers, dedupe, filter by window, cap, optionally Jev-triage,
  persist, derive evidence, validate, deterministically rank.
- **Path:** `server/research/engine.ts:207` (`execute`), pure logic in `engine-core.ts`,
  ranking in `intelligence.ts:448` (`analyzeResearch`).
- **Inputs:** a `ResearchJob` (kind, query, providerIds, window, depth). **Outputs:** `research_sources`,
  `research_evidence`, `research_analyses`.
- **Order (exact):** budgets → provider fan-out (≤8 providers, concurrency 4) → query expansion →
  `dedupeSources` → `filterByWindow` → cap `maxSources` (quick 10 / standard 20 / deep 50) →
  **optional Jev triage** (`engine.ts:287`) → `insertSources` → `deriveEvidence` →
  `validateResearch` (needs ≥1 `sourced` evidence) → `insertEvidence` (≤50) → `analyzeResearch`
  (weighted `0.35 relevance + 0.25 freshness + 0.15 authority + 0.20 convergence + 0.05 engagement`,
  sorted, **persisted but gates nothing**). — CONFIRMED
- **Providers:** `rss`, `reddit`, `youtube` (metadata only), `hn`, `web`, `video` (yt-dlp), `last30days`
  (only when `LAST30DAYS_ENABLED=1`/`LAST30DAYS_SCRIPT`). Access class `local-agent-only` is refused
  server-side (`registry.ts:105-108,229-234`). — CONFIRMED
- **LLM calls:** none in the pipeline itself except the optional Jev triage gate, the opt-in Gemini
  video fallback, and the separate `/api/video/.../extract` path. — CONFIRMED

### 2.6 Story → Opportunity — CONFIRMED
- **Path:** `server/story/service.ts:106` (`createStoryFromResearch`),
  `server/content/opportunity.ts:119` (`createOpportunityFromStory`).
- **Story rule:** requires a `complete` job with ≥1 evidence; `automationRunId` is the only idempotency key.
- **Opportunity rule:** validates `format × channel` against `hasChannelAdapter` **and** a format profile
  **and** `channelSupportsFormat`; persists `status:"proposed"`. `score`/`scoreBreakdown`/`proposer`
  are caller-supplied (nothing computes `score` today). — CONFIRMED

### 2.7 Generation — CONFIRMED
- **Path:** `server/content/generation.ts:319` (`runGenerationJob`), policy freeze in `policy.ts`
  (`resolveGenerationPolicy:209`, `assembleEffectiveRequest:401`), model in `content/model.ts:29`.
- **Rule:** a `GenerationPolicy` (`policyKey`+`version`+`specHash`, one active per key) is frozen into a
  snapshot; the model writes **copy only** — format/structure/hook/voice come from the frozen prompt.
  Output is validated against the format's payload schema (`artifacts/payloadSchemas.ts`). — CONFIRMED
- **Idempotency:** `generation:<oppId>:<specHash>` (`generation.ts:199`).

### 2.8 Artifacts + Readiness — CONFIRMED
- **Path:** `server/content/artifact.ts:120` (`createArtifact`), `:269/:307/:326` (submit/approve/reject),
  immutability trigger in `migrations/0007_dusty_preak.sql:150-169`.
- **Rule:** payload is immutable at insert (DB trigger); changes are **new revisions** linked by
  `supersedes_id`. Readiness transitions are guarded by exact-equality checks
  (`if (artifact.readiness !== "draft") throw`). Only `approved` is schedulable (`schedulableReadiness:379`). — CONFIRMED
- **"trusted" auto-transition:** `automation.ts:1180` (`settleTrustedArtifact`) runs the *same* documented
  transitions (`draft→in_review→approved`) — it is **not** a bypass flag. — CONFIRMED

### 2.9 Publishing (Schedule → Publication → Adapters) — CONFIRMED
- **Path:** `server/content/scheduling.ts:230` (`dispatchDueOccurrences`),
  `server/content/publication.ts:148` (`runPublication`), `server/content/adapters.ts` (registry at `:1245`),
  platform transports in `server/social/{x,threads,instagram,linkedin,youtube}.ts`.
- **Adapters registered:** `x`, `linkedin`, `threads`, `instagram`, `youtube` (`adapters.ts:1246-1250`). — CONFIRMED
- **Hard rules:** single-flight lease (`acquirePublicationLease`, CAS to `state:"publishing"`, 5-min lease);
  `providerCalled ⇒ no blind retry`; ambiguous outcomes become `results.outcome = "unknown"` and are
  reconciled (`reconcileUnknownPublications`, `MAX_RECONCILE_ATTEMPTS = 5`). — CONFIRMED
- **Payload caps (format profiles):** `x_post` 280, threads-channel `x_post` 500, `linkedin_post` 3000,
  instagram caption 2200, carousel 2–10 (`formatProfiles.ts`). — CONFIRMED

### 2.10 Automation — CONFIRMED
- **Path:** `server/content/automation.ts` — policy snapshot (`:395`), run creation (`:619`),
  step machine (`advanceAutomationRun:741`), the four steps
  `runResearchStep:837`, `runStoryStep:895`, `runFanoutStep:974`, `runSettleStep:1092`.
- **Rule:** one bounded step per durable delivery; run stops at `awaiting_approval` unless the policy is
  `trusted` **and** `publicationConfig.mode === "on_approval"`. — CONFIRMED
- **Format selection** is now a versioned, ledgered decision: step 3 calls `format_select` through the
  engine (`content/framing.ts` is a thin adapter), narrow-only over the policy's target set, fail-open. — CONFIRMED

### 2.11 Decision OS (Jev) — CONFIRMED (flag-gated)
- **Path:** `server/decision/*`. Engine `engine.ts:57` (`decide`), registry `registry.ts:59`,
  policies `policies.ts` (`DECISION_POLICIES`), zod `schemas.ts`, state `state.ts`, validator `validator.ts`,
  ledger `ledger.ts`/`ledgerStore.ts`, transport `jev.ts`.
- **Registered decision types (10):** `research_triage`, `research_depth`, `opportunity_score`,
  `quality_gate`, `content_strategy`, `publish_gate`, `format_select`, plus the shadow trio
  `viral_score`, `discover_rank`, `agent_route` (`registry.ts`, `policies.ts`). — CONFIRMED
- **Gate:** master flag `JEV_DECISION_ENGINE_ENABLED === "1"`, default **off**; each type also requires its
  own flag. `research_depth` has its own `JEV_RESEARCH_DEPTH` so it never activates as a side effect of the
  triage gate. — CONFIRMED
- **Live callers (flag-gated):** `quality_gate` ← `content/qualityGate.ts`; `opportunity_score` +
  `content_strategy` ← `content/opportunityScoring.ts` → `opportunity.ts`; `publish_gate` ←
  `content/publishGate.ts` (trusted settle only); `research_triage` ← `research/triageGate.ts`;
  `research_depth` ← `research/service.ts` (asked only when a request specifies no depth); `format_select`
  ← `content/framing.ts`. — CONFIRMED
- **Shadow-only (JC-01/02/03, no cut-over yet):** `decision/legacy.ts` records `viral_score`
  (`routes.ts`), `discover_rank` (`discoverRefresh.ts`) and `agent_route` (`agent/routes.ts`) through
  `shadowDecide`; the caller ignores the result. — CONFIRMED
- **Shadow harness:** `decision/shadow.ts` (`shadowDecide`, `agreementRate`) — restored in Phase 6. — CONFIRMED
- **Outcome loop:** `decision/outcomes.ts` attaches observed publication metrics to every decision that
  referenced the publication (`content/service.ts` analytics handler → `ledger.attachOutcomeByRef`). — CONFIRMED
- **Transport:** HTTP (`POST /systemone`) or CLI (`cmd -p … -m typesafe/jev`); 3 attempts with 500/1000ms
  backoff on 429/529. Failures throw typed errors that the engine converts to a **declared fallback**. — CONFIRMED

### 2.12 AI Gateway — CONFIRMED
- **Path:** `server/ai/{config,router,chat}.ts`. `aiCallRouted` (`chat.ts:35`), `resolveRoute` (`router.ts:75`).
- **Routing:** task `default` → the OpenAI-compatible provider; `video.*` → Gemini; **fallback to `default`
  when Gemini is unkeyed**. `aiCall()` keeps its positional signature and always routes as `default`. — CONFIRMED
- **Only `video.extract` uses a non-default route** (`research/videoExtract.ts:76`). `video.classify` and
  `video.premium` are declared but unused. — CONFIRMED
- **Prompt source:** `server/brandSystemPrompt.ts` (loaded widely); `prompts/tuli-chief-of-staff.md` is
  **not loaded by any code**. — CONFIRMED

### 2.13 Intelligence providers (quality · expertise · reach) — CONFIRMED
- **Quality** — `server/intelligence/quality/signals.ts` (`computeQualitySignals`): deterministic regex
  analysis (boilerplate, hedging, emoji/link density, repetition, specificity, over-limit). Consumed by
  `content/qualityGate.ts` (submit) and `content/publishGate.ts` (trusted settle). — CONFIRMED
- **Expertise** — `server/intelligence/expertise/*`: a deterministic, model-free profile (niche, pillars,
  parsed goals, recurring published topics) plus `expertiseAlignment` / `expertiseBand`. Consumed by
  `content/opportunityScoring.ts` as decision evidence. — CONFIRMED
- **Reach** — `server/intelligence/reach/signals.ts` (`computeReachSignals`): observed history only
  (`historical_performance`, `reach_potential`, sample size, confidence). It deliberately does **not**
  report `trend_strength`/`topic_velocity` — those need a real time series and land with the Agent Reach
  ingest seam. — CONFIRMED
- **All three are signals; none decides.** Each is wrapped by an advisory, flag-gated port
  (`qualityGate` / `publishGate` / `opportunityScoring`). — CONFIRMED

### 2.14 Optimization Loop (Learning → Experiments → Activation) — CONFIRMED
- **Path:** `server/content/learning/*`, `experimentation/*`, `policyActivation/*`, `autonomy/*`.
- **Chain:** `results.metrics` → `performance_signals` → `extractObservationsAndProposals`
  (`MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL = 3`, Δ ≥ 15%) → `learning_observations`/`proposals` → `experiments`
  → `experiment_evaluations` → `policy_candidates` → **human** `policy_activations` (or the bounded
  autonomy controller). — CONFIRMED
- **Reaches generation only as bounded counts** (`context.ts` → `learningSummaryForContext`). No per-topic,
  no per-hook aggregation exists. — CONFIRMED
- **Decision outcomes:** `decision/outcomes.ts` closes prediction-vs-actual by attaching observed
  publication metrics to the ledger rows for the publication that produced them; an unobserved metric is
  recorded as unavailable, never coerced to zero. — CONFIRMED

### 2.15 Postgres + Drizzle — CONFIRMED
- **Path:** `shared/schema.ts` (single file, ~2,518 lines, ~70 tables), pool `server/db.ts`,
  hand-written migrations in `migrations/` (latest `0033_jev_decisions`).
- **Two disjoint persistence layers:** legacy `server/storage.ts` (`IStorage`, ~71 methods over
  posts/ideas/references/styles/accounts) and `server/content/storage.ts` (`ContentStoragePort`,
  lifecycle entities). They share one pool but no tables. — CONFIRMED

---

## 3. The canonical runtime path — CONFIRMED

```
Operator ──HTTP──▶ Express API (+auth/CSRF) ──enqueue──▶ pg-boss
                                                          │
                    ┌─────────────────────────────────────┘
                    ▼
              research.run  →  Research Engine  → research_sources/evidence/analyses
                    │                                    │
                    ▼                                    ▼
              Story (createStoryFromResearch)  →  Opportunity (format × channel)
                    │
                    ▼
              generation.run → Generation (frozen policy + AI Gateway) → Artifact (immutable rev)
                    │
                    ▼
              Schedule/Occurrence (approved only) → publication.run → Channel Adapter → Platform
                    │
                    ▼
              Result (results.metrics) → performance_signals → Optimization Loop → (bounded) context back to Generation
```

The **legacy second path** runs in parallel and independently: `server/scheduler.ts` cron publishes
`scheduled` posts from the legacy `posts` table (`GET /api/posts` domain), while `autopilot.ts`,
`discoverRefresh.ts`, `marketPulse.ts` and `rssAutopost.ts` create and rank ideas and drafts. — CONFIRMED

---

## 4. Synchronous vs asynchronous — CONFIRMED

| Synchronous (in the HTTP request) | Asynchronous (durable job / cron) |
|---|---|
| Auth, CSRF, validation, most reads | `research.run`, `generation.run`, `publication.run` |
| Agent tool calls execute **inline** (`runtime.advance`) | `visual.run`, `video.repurpose`, `style.analyze` |
| Legacy `/api/*` content generation (`aiCall` inline) | `automation.run`, `analytics.refresh`, `autonomy.evaluate` |
| Format/channel validation, artifact transitions | Legacy cron publish + `dispatchDueOccurrences` tick |

The **agent path is synchronous** — `POST /api/agent/runs` calls `createAndRun` → `advance` in-request; its
tools then *delegate* heavy work to the same pg-boss jobs. The durable `agent.run` lane exists but is never
enqueued. — CONFIRMED

---

## 5. Loops, retries, polling, queues, scheduling — CONFIRMED

- **Job retries:** pg-boss per-job `retryLimit`/`retryDelay`/`retryBackoff`; on exhaustion the payload is
  copied to `<job>.dlq`. Rate-limit errors `reschedule` without consuming an attempt (`jobs/runtime.ts:288-309`).
- **Publication retries:** *never* after a provider call. `providerCalled + failure ⇒ outcome:"unknown"`,
  then bounded reconciliation (`MAX_RECONCILE_ATTEMPTS = 5`).
- **Occurrence dispatch:** at most one occurrence per schedule per tick; CAS `pending→enqueued`.
- **Automation:** one step per delivery; `MAX_AUTOMATION_ATTEMPTS = 10`; intermediate state retained.
- **Scheduler crons** (`server/scheduler.ts`): `* * * * *` publish/retry; `30 5 * * *` morning briefing;
  `30 6 * * *` autofill; `0 6 * * *` discover refresh; weekend content; `0 */6 * * *` YouTube connector;
  `30 8 * * 0` X analytics. **Content scheduler** tick every minute; **autonomy** every 6 hours.
- **Legacy retry policy:** delays `[5, 30, 120]` minutes, `MAX_RETRIES = 3`, only when
  `XQUIK_ALLOW_WRITE_RETRIES=1`.
- **Agent loop:** `while (step < 16)`; overflow → `failed("exceeded 16 tool steps")`.
- **In-adapter polling (bounded):** X write-action poll (6 attempts), Instagram container poll (3–8).
- **Dedupe/idempotency ladders:** research source hash ⇒ `computeSourceHash`; evidence
  `(jobId, sourceId, excerptHash)`; publications `(schedule, occurrence, artifact revision)`.

---

## 6. Where decisions are actually made — CONFIRMED

| Decision | Owner today | Kind |
|---|---|---|
| Research triage (which sources survive) | `research/triageGate.ts` → `research_triage` (`JEV_RESEARCH_GATE`) | LLM (fail-open) |
| Research depth | `research/service.ts` → `research_depth` (`JEV_RESEARCH_DEPTH`) | LLM (fail-open to standard) |
| Which format/channel to fan out | `content/framing.ts` → `format_select` (`JEV_FRAMING`) | LLM (narrow-only, fail-open) |
| Quality gate (submit vs revise vs hold) | `content/qualityGate.ts` → Decision OS `quality_gate` | LLM (fail-closed hold) |
| Research ranking | `research/intelligence.ts` | deterministic (gates nothing) |
| Opportunity score + lead strategy | `content/opportunityScoring.ts` → `opportunity_score` + `content_strategy` | LLM (deterministic fallback) |
| Publish gate (unattended path only) | `content/publishGate.ts` → `publish_gate` | LLM (fail-closed hold) |
| Legacy viral / discover / agent (JC-01/02/03) | `decision/legacy.ts` (shadow mode) | LLM (record only; no cut-over) |
| Viral 8-dimension score | `routes.ts:2343` | LLM |
| Discover idea ranking | `discoverRefresh.ts:294` | LLM |
| Autopilot content type / template / rank | `autopilot.ts` | heuristics + regex |
| Agent intent & targets | `shared/agent-ui.ts:192-381` | regex |
| Format×channel validity, caps, leases, readiness | artifact/scheduling/publication/adapters | deterministic hard gates |

**The decision surface is split in two** — the canonical chain is nearly decision-free, while the legacy
monolith holds most live decisions. — CONFIRMED (matches `CURRENT_ARCHITECTURE.md:143`)

---

## 7. Hard gates the code (not Jev) owns — CONFIRMED

1. Only `approved` artifacts are schedulable/publishable (`artifact.ts:379`; `publication.ts:170`).
2. Approval is per exact revision; rejected content is never schedulable.
3. Artifact content is immutable at insert (DB trigger, migration 0007); changes are new revisions.
4. Auto-publish requires an explicit `trusted` + `on_approval` pair.
5. `providerCalled ⇒ no blind retry`; ambiguous ⇒ `unknown` → reconcile.
6. Single-flight leases for publication and automation (DB CAS).
7. Ownership + mandatory attribution on artifacts.
8. Research text is **data, never instructions**.
9. `local-agent-only` providers refused at dispatch.
10. Payload/format caps; a schema must be registered to generate/persist.

---

## 8. Where state lives — CONFIRMED

One Postgres schema. Lifecycle tables (`shared/schema.ts`): `researchJobs/Sources/Evidence/Analyses`,
`videoSources/Chunks/Claims`, `stories`, `opportunities`, `generationPolicies/Jobs`, `artifacts`,
`schedules/occurrences`, `publications`, `results`, `automationPolicies/Runs`, `performanceSignals`,
`learning*`, `experiments*`, `policyCandidates/Activations`, `autonomyConfigs/Decisions`, `jevDecisions`,
`agentRuns/agentToolCalls`, plus `aiUsageLog`/`auditLogs`. Legacy tables: `users`, `userProfile`, `posts`,
`ideas`, `discoveredIdeas`, `references`, `styleProfiles`, `voices`, `contentTemplates`, `connectedAccounts`,
`rssSources`, etc.

Immutable-by-trigger tables: `artifacts` (0007), `visualAssets` (0012). Revision chains also protect
voices, templates, generation policies, style profiles. `jev_decisions` is append-only at the application
layer (the 0033 migration has **no** trigger).

---

## 9. External systems — CONFIRMED

| System | Where | Notes |
|---|---|---|
| Research providers | `server/research/providers/*` | RSS/Atom, Reddit JSON/OAuth, HN Algolia, YouTube Atom, generic web, yt-dlp, optional `last30days` CLI |
| LLM gateway | `server/ai/*` | OpenAI-compatible `default`; Gemini for `video.*` |
| Jev / TypeSafe "System One" | `server/decision/jev.ts` | HTTP or CLI transport |
| X | `server/social/x.ts` | **third-party xQuick gateway**, not the first-party X API |
| Threads / Instagram | `server/social/{threads,instagram}.ts` | Meta Graph API |
| LinkedIn | `server/social/linkedin.ts` | Posts REST API |
| YouTube | `server/social/youtube.ts` | Data API v3 resumable upload, gated by real-publish certification |
| Media providers | `server/content/visualProviders/*`, `videoProviders.ts` | OpenAI image, fal, ElevenLabs, macOS `say`; HyperFrames/OpenShorts contracts |
| Last30days CLI | `server/research/providers/last30days.ts` | doctor-gated, cookie-free only |

---

## 10. Feature-flag surface — CONFIRMED (`.env.example`)

- **AI:** `AI_BASE_URL`/`AI_API_KEY`/`AI_TEXT_MODEL`; `GEMINI_API_KEY`(or `GOOGLE_API_KEY`),
  `VIDEO_TEXT_MODEL`/`VIDEO_MAIN_MODEL`/`VIDEO_PREMIUM_MODEL`, `VIDEO_GEMINI_FALLBACK`.
- **Jev:** `TYPESAFE_*` (transport/creds), `JEV_DECISION_ENGINE_ENABLED` (master), `JEV_RESEARCH_GATE`
  (`research_triage`), `JEV_RESEARCH_DEPTH` (`research_depth`), `JEV_FRAMING` (`format_select`),
  `JEV_CONTENT_GATE` (`quality_gate`), `JEV_OPPORTUNITY_SCORE`, `JEV_CONTENT_STRATEGY`, `JEV_PUBLISH_GATE`,
  `JEV_LEGACY_SCORING` (shadow trio), `JEV_TRIAGE_*`, `JEV_OPPORTUNITY_HIGH/MEDIUM`,
  `JEV_QUALITY_APPROVE/REVISE`, `JEV_PUBLISH_APPROVE/REJECT`.
- **Research:** `LAST30DAYS_ENABLED`/`LAST30DAYS_SCRIPT`, `WEB_RESEARCH_URLS`, `VIDEO_RESEARCH_URLS`,
  `YOUTUBE_CHANNEL_IDS`, `REDDIT_SUBREDDITS`, `HN_TAGS`.
- **Execution:** `XQUIK_ALLOW_WRITE_RETRIES`, `CONTENT_SCHEDULER_ENABLED`, `DISABLE_CRON`, per-cron
  `DISABLE_*`, `REGISTRATION_DISABLED`, `TRUST_PROXY`, `SESSION_COOKIE_SECURE`.
- **Certification gates:** `CONTENTFORGE_REAL_PUBLISH_E2E`, `CONTENTFORGE_PUBLISH_CERTIFICATION`,
  `CONTENTFORGE_REAL_MEDIA_E2E`, `MEDIA_CERT_MAX_*`.

---

## 11. Documentation vs code — where they disagree

| Claim | Source | Code reality |
|---|---|---|
| `expertise/` and `reach/` intelligence providers | `JEV_DECISION_MAP.md §10` | **Now exist** (`server/intelligence/expertise/*`, `server/intelligence/reach/*`). They are signals only; the decision wrappers stay flag-gated. — CONFIRMED |
| `assertHardConstraints` enforces gates | `JEV_DECISION_MAP.md §6` | The function exists (`validator.ts:82`) but **still has no production caller** (tests only). Hard gates remain enforced inside their owning modules. — CONFIRMED |
| Decision ledger `attachOutcome` feeds the loop | `JEV_DECISION_MAP.md §7` | **Now wired**: `decision/outcomes.ts` → `ledger.attachOutcomeByRef`, called from the analytics.refresh handler. — CONFIRMED |
| `composeOpportunityScore` | described as "built but dead" | **No longer dead**: the `opportunity_score` decision composes via `composeOpportunityScore` (`decisions/opportunity.ts`), reachable from `content/opportunityScoring.ts`. — CONFIRMED |
| Content Quality "does not exist" | `CURRENT_ARCHITECTURE.md §4` | Now **full intelligence set**: `quality/` + `expertise/` + `reach/` all exist and are wired through flag-gated advisory ports. Doc predates this. — CONFIRMED |
| Research triage discards all `watch` when any `pursue` | `CURRENT_ARCHITECTURE.md §3.1` (known defect) | **Fixed**: `triageGate` is now an engine adapter using the registry's `research_triage` policy with `JEV_TRIAGE_KEEP` (default `pursue+watch`). `selectForResearch` remains only as a legacy helper. — CONFIRMED |
| Framing runs against `jevDecide` with no policy version or ledger row | this README (earlier revision) | **Changed**: framing is now the `format_select` decision through the engine (versioned policy + ledger). — CONFIRMED |
| `decision/shadow.ts` was removed by the dead-code refactor | this README (earlier revision) | **Restored** in Phase 6, together with `decision/legacy.ts` as the shadow seam for JC-01/02/03. — CONFIRMED |
| `agent.run` job | implied general | Registered worker, **no producer**; agent runs inline. — CONFIRMED |
| `prompts/tuli-chief-of-staff.md` | present in repo | Not read by any code. — CONFIRMED |

---

## 12. Major unknowns — UNKNOWN

- Runtime ordering/latency of the two content paths in a live deployment (which path an operator actually uses).
- Whether any deployment sets `JEV_*` flags on (code is default-off; the repo cannot prove production env).
- Real behaviour of the external `last30days` CLI (opaque process; only its JSON contract is visible).
- Whether the `autonomy` circuit breaker has ever opened in production (`autonomy_decisions` is unread here).
- Whether `learning.extract`/`agent.run` are intentionally dormant or awaiting a caller.

*UNKNOWN — runtime behaviour cannot be proven from repository inspection.*
