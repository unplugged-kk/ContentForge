# JEV Opportunity Audit — ContentForge

**Date:** 2026-09-20 · **Mode:** read-only, no code modified · **Source of truth:** actual code, not README.

## 1. Executive summary

ContentForge is a single-user, full-stack content factory (React + Express 5 + Postgres/Drizzle + pg-boss + node-cron). One OpenAI-compatible gateway (`server/ai/config.ts`, `server/ai/chat.ts:aiCall`) serves ~40 LLM call sites, all defaulting to `gpt-4o-mini` JSON mode. There is no separate model router, no embeddings/pgvector in production, and no LLM-based agent planner — the "agent" is a 30-tool registry (`server/agent/tools.ts`) driven by an explicit deterministic intent compiler (`shared/agent-ui.ts:compileWorkspaceIntent`) plus privileged-tool approval gates.

The dominant cost/latency center is **one daily pipeline**: discover-refresh (1 big LLM rank call over ~30 raw items → 20 ideas) → autopilot rank/filter (heuristic) → 3 drafts/day (3 LLM generations) → scheduled auto-publish. The dominant *decision* center is **scoring and selection**: viral scoring (8-dimension LLM JSON), discover ranking, niche filtering, content-type choice, template match, engagement rank, breaking-news boost.

**Verdict:** 11 Jev candidates (3 Tier 1, 5 Tier 2, 3 Tier 3). The biggest win is consolidating the per-content scoring stack (viral 8-dim + engagement + breaking boost + content-type) into shared-state Jev evaluations, and replacing the brittle regex intent/template/niche routers with bounded Jev choices. Deterministic safety machinery (autonomy controller, experiment evaluation, publish validators, research intelligence ranking) must NOT be touched.

## 2. Architecture overview

```text
User (single user, session auth)
 ↓
React pages (generate, chat, hooks, carousel, discover, ingest, vault, agent, calendar)
 ↓
Express: legacy monolith server/routes.ts (~3300 lines) + modular routers
 (research / stories / content / automation / learning / experiments / policies / autonomy / agent)
 ↓
Application services: autopilot.ts, discoverRefresh.ts, marketPulse.ts, scheduler.ts,
 content/{scheduling, publication, distribution, automation, learning, experimentation, autonomy, policy}
 ↓
Single LLM gateway: server/ai/chat.ts:20 aiCall → OpenAI-compatible (OpenAI default,
 OpenRouter / OllDsoma via AI_BASE_URL) · MODELS.TEXT=gpt-4o-mini · JSON mode · ai_usage_log telemetry
 ↓
30 agent tools (server/agent/tools.ts) · deterministic intent compiler (shared/agent-ui.ts)
 ↓
Postgres (Drizzle) + pg-boss queue + node-cron · no Redis, no vector index in prod
 ↓
X/Threads/LinkedIn/Instagram/YouTube adapters with regex failure classifiers + retry
```

Key execution paths:
1. **Daily autopilot** (`scheduler.ts` → `autopilot.runDailyAutoPost`): discover refresh → market pulse → rank → 3 drafts → schedule → cron publish.
2. **On-demand generation** (`POST /api/generate`, articles, threads, hooks, carousels, chat): brand prompt + vault/style context → LLM generation (pure generation, not Jev).
3. **Discover** (`POST /api/discover/refresh` → `runDiscoverRefresh`): 6-source fan-in → 1 LLM rank call → 20 persisted ideas.
4. **Viral loop** (`POST /api/viral/score|optimize|apply-fix`): score → rewrite → re-score.
5. **Agent workspace** (`POST /api/agent/agui|runs`): intent compile → tool plan → privileged approval gates.
6. **Research jobs** (`POST /api/research/jobs`): provider fan-out → deterministic intelligence analysis (no LLM).
7. **Publish** (`publications/dispatch`, `posts/:id/publish`): eligibility gates → adapters → retry classification.

## 3. AI/LLM inventory (all via `aiCall`, `server/ai/chat.ts:20`)

| # | Location | Feature tag | Generation vs Decision |
|---|----------|-------------|------------------------|
| 1 | `server/routes.ts:271` expand_idea | generation | GENERATION |
| 2 | `server/routes.ts:309` fill_template | generation | GENERATION |
| 3 | `server/routes.ts:330` generate (3 variations) | generation | GENERATION |
| 4 | `server/routes.ts:724,745,766,786,805` article outline/expand/full/improve/meta | generation | GENERATION |
| 5 | `server/routes.ts:826,853,872` article↔thread conversions | generation | GENERATION (bounded format choice is deterministic) |
| 6 | `server/routes.ts:1098` analyze_x_account | ingest classify+summarize | MIXED — Tier 2 |
| 7 | `server/routes.ts:1397,1473` ingest analyze/batch | relevance+summary | MIXED — Tier 2 |
| 8 | `server/routes.ts:1528` screenshot ingest | vision summary | GENERATION |
| 9 | `server/routes.ts:1603` content-actions | action rewrite | GENERATION |
| 10 | `server/routes.ts:1687,1728` style apply/generate | style transfer | GENERATION |
| 11 | `server/routes.ts:2234` discover expand | generation | GENERATION |
| 12 | `server/routes.ts:2273` **viral/score (8-dim + overall + improvements + predicted engagement)** | `viral_score` | **SCORING — Tier 1 (JC-01)** |
| 13 | `server/routes.ts:2335,2365` viral optimize/apply-fix | generation | GENERATION |
| 14 | `server/routes.ts:2596` ai-learn brand voice | memory distill | REASONING — Tier 3 (JC-11) |
| 15 | `server/routes.ts:2698,2711` image prompt suggest + generate-for-post | generation | GENERATION |
| 16 | `server/routes.ts:2756` vault extract-url summarize | summarization | GENERATION (admission gate is Tier 2, JC-06) |
| 17 | `server/routes.ts:2845` youtube generate-post | generation | GENERATION |
| 18 | `server/routes.ts:2972` generate/from-sources | generation | GENERATION |
| 19 | `server/routes.ts:3007` hooks/generate | generation | GENERATION |
| 20 | `server/routes.ts:3069` carousels/generate | generation | GENERATION |
| 21 | `server/routes.ts:3157` canned ai-suggest | retrieval+rewrite | GENERATION |
| 22 | `server/routes.ts:3200,3212` chat message/refine | generation | GENERATION |
| 23 | `server/discoverRefresh.ts:294` **discover rank → 20 ideas w/ viral_score, timeliness, pillar, content_type** | `discover_ideas` | **SCORING+CHOICE — Tier 1 (JC-02)** |
| 24 | `server/autopilot.ts:297,371` draft + article draft | generation | GENERATION |
| 25 | `server/youtubeConnector.ts:82` youtube_connector | classify+summarize | Tier 2 (JC-07) |
| 26 | `server/rssAutopost.ts:13` autopost draft | generation | GENERATION (selection around it is JC-05) |
| 27 | `server/content/styleAnalyzer.ts:70` style confidence + 14 dimensions | `style.analyze` | **GATING — Tier 2 (JC-08)** |
| 28 | `server/content/model.ts:60,121` text generation wrapper | generation | GENERATION |
| 29 | `server/content/videoRepurpose.ts:301,361` OpenShorts local LLM + gemini key | repurpose | GENERATION |
| 30 | `server/routes.ts:2708` schedule/suggest | suggestion | Tier 3 (JC-10) |

Model: everything defaults to `MODELS.TEXT = gpt-4o-mini` ($0.15/$0.60 per 1M). Premium `gpt-4o` exists but is unused in the hot path. No Anthropic/Claude/Gemini calls in production code (names appear only in pricing table + keyword lists + dead `replit_integrations/` stubs).

## 4. Decision inventory

### A. LLM-made bounded decisions today (expensive, fuzzy)
- JC-01 viral 8-dim scoring (`routes.ts:2268-2328`).
- JC-02 discover 20-idea ranking with viral/timeliness/pillar/type (`discoverRefresh.ts:294-320`).
- JC-06/07 ingest & connector relevance judgments (routes.ts:1098-1473, youtubeConnector.ts:82).
- JC-08 style confidence gate (`styleAnalyzer.ts:42-44,70`).
- JC-11 brand-voice learning (`routes.ts:2590-2609`).

### B. Heuristic-made bounded decisions today (cheap but brittle)
- JC-03 agent intent routing: `compileWorkspaceIntent` + `inferTargets` + `inferWindowPreset` + `matchStoryId` (`shared/agent-ui.ts:192-381`) — pure regex over free text.
- JC-04 content pipeline: `isNicheRelevant` keyword list (`autopilot.ts:52-77`), `determineContentType` threshold chain (`autopilot.ts:89-105`), `matchTemplate` additive score (`autopilot.ts:142-168`), `computeEngagementScore` (`autopilot.ts:172-202`), `rankIdeas` filter ≥5.5 + sort (`autopilot.ts:454-473`).
- JC-05 breaking-news boost: `extractNicheTopics`/`applyBreakingNewsBoost` ×1.5 (`marketPulse.ts:86-181`).
- JC-09 failure classification: `classifyXFailure` et al (`content/adapters.ts:170,507,682,861`), `classifyOpenAiImageError` (`visualProviders/openaiImage.ts:41`), `classifyMetricsHttpFailure` (`learning/metrics.ts:132`) — regex → transient/permanent/policy_human.
- JC-10 schedule suggestion (`routes.ts:2708`, `schedule/best-times:3320`).

### C. Deterministic machinery — DO NOT Jev (Tier 4)
Research intelligence ranking (`research/intelligence.ts:468-492` — deliberate versioned determinism `research-analysis-v1`), `classifySource` allowlist, Jaccard clustering, conflict detection, quality state machine, depth budgets, `selectDeterministicVariant` sha256 assignment (`experimentation/assignment.ts:34`), `determineRecommendedDecision` guardrail table (`evaluation.ts:403`), autonomy eligibility chain (`autonomy/controller.ts:214,281` — header states "confidence never decides"), publish validators (280/500/2200 char limits), cooldowns/circuits/budgets, lifecycle transitions, `status == "failed"` checks, arithmetic, `thread-splitter`, client filters.

## 5. Jev candidates (summary; detail in JEV-CANDIDATES.md)

| ID | Decision | Tier |
|----|----------|------|
| JC-01 | Viral 8-dimension scoring | 1 |
| JC-02 | Discover idea ranking/triage | 1 |
| JC-03 | Agent intent + target routing | 1 |
| JC-04 | Content-type / template / engagement rank | 2 |
| JC-05 | Breaking-news boost | 2 |
| JC-06 | Ingest / vault memory admission | 2 |
| JC-07 | YouTube connector relevance | 2 |
| JC-08 | Style confidence gate | 2 |
| JC-09 | Failure retry/escalate/stop | 3 |
| JC-10 | Schedule slot suggestion | 3 |
| JC-11 | Brand-voice learning admission | 3 |

Shared-state opportunities: SS-1 (per-content: viral dims + engagement + boost + content-type in one state), SS-2 (per-idea discover: relevance/quality/urgency/risk scored together instead of one mega-prompt), SS-3 (per-failure: retry/escalate/stop + error-class in one evaluation).

## 6. Non-candidates (Tier 4 highlights)
All pure generation (drafts, threads, articles, hooks, carousels, images, chat, rewrites), complex reasoning (brand-voice synthesis, weekly recap narrative), and all deterministic gates/validators/budgets/circuits/assignment/eligibility listed in §4C.

## 7. Tier analysis
- **Tier 1 (immediate):** JC-01, JC-02, JC-03 — high frequency (daily + interactive), bounded, expensive-or-brittle today, measurable via existing `ai_usage_log` + `viral_scores` + agent run telemetry.
- **Tier 2 (strong):** JC-04–JC-08 — clear bounded decisions, lower frequency or more integration surface.
- **Tier 3 (experimental):** JC-09–JC-11 — benchmark first; failure classifier and scheduler have cheap deterministic baselines to beat; brand learning is low-frequency.
- **Tier 4 (do not use):** §4C + all generation.

## 8. Risk analysis
- Publishing side effects (auto-post 3×/day) must keep the deterministic privileged-approval gates (`agent/policy.ts:11-25`, artifact must be approved before schedule/publish) AFTER any Jev score. Jev informs ranking; it never authorizes publish.
- Autonomy controller and experiment evaluation are explicitly confidence-independent by design; Jev must not feed them.
- Failure classifier mistakes cause retry storms (cost) or dropped posts (silent loss); keep regex as fallback when Jev confidence is low/unavailable.
- Discover ranking mistakes waste 3 LLM drafts (~24K tokens/day); cheap to A/B against current prompt via held-out batches.
- No PII/secrets in Jev state: ideas/titles/URLs only; never send `ai_usage_log`, session tokens, or account credentials.

## 9. Latency/cost opportunities (estimates, marked as such)
Current hot path per day (estimate): 1 discover call (~8-10K in / ~4K out) + 3 drafts (~3-4K in / ~2K out each) + sporadic viral scores (~1.5K in / ~1K out each). At gpt-4o-mini pricing this is cents/day; the win is **latency and determinism**, not dollars: Jev score/choice evaluations are sub-second typed decisions vs multi-second JSON-mode generations, and they remove prompt-format fragility (`safeJsonParse` fallbacks exist at every site because the LLM frequently returns malformed JSON). Expected (estimate): scoring latency 3-8s → <1s; discover triage becomes cacheable per (batch, idea); intent routing becomes testable without a model call. LLM call reduction: viral re-scores and heuristic re-ranks that today require extra generations collapse into shared-state Jev evaluations (estimate 20-40% fewer generation calls on the scoring loop; generation itself stays on the LLM).

## 10. Recommended architecture
`DecisionEngine` facade (`choose/score/classify/gate/route`) between application services and Jev; LLM keeps GENERATE, Jev takes DECIDE, deterministic code keeps EXECUTE; every Jev call carries confidence thresholds, deterministic fallback, and telemetry into the existing `ai_usage_log`/`autonomy_decisions` pattern. Full design in `JEV-ARCHITECTURE.md`; rollout in `JEV-MIGRATION-PLAN.md`.
