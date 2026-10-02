# ContentForge — Current Architecture (as built, not as documented)

**Date:** 2026-10-02 · **Mode:** read-only audit, no code modified · **Source of truth:** the code.
**Supersedes:** `JEV-OPPORTUNITY-AUDIT.md` (2026-09-20). Reuses its JC-01…JC-11 candidate table.
**Companion:** `JEV_DECISION_MAP.md`.

---

## 1. Runtime shape

React (client/) + Express 5 (server/) + Postgres/Drizzle + pg-boss + node-cron. Single operator, session auth, CSRF, global auth gate on `/api`.

One LLM gateway: `server/ai/chat.ts:aiCallRouted` with a task router (`server/ai/router.ts`) — `default` → the configured OpenAI-compatible provider (Command Code in this deployment), `video.*` → Gemini, with graceful fallback to `default` if Gemini is unkeyed. `aiCall()` retains its positional signature and delegates, so ~40 call sites are untouched.

Three layers, and they are genuinely distinct in the code:

| Layer | Modules | Nature |
|---|---|---|
| **Intelligence** (signals) | `server/research/*` (engine, providers, `intelligence.ts` ranking), `server/content/style*`, `learning/*`, `content/context.ts` | Deterministic. Exactly one model call in the research layer (`video.extract`). |
| **Decision** | `server/decision/*` (Jev), `server/content/framing.ts` | Jev. Two live boundaries. |
| **Execution** | `story/`, `content/{opportunity,generation,artifact,scheduling,publication,automation,repurposing}`, `server/agent/*`, legacy `server/routes.ts` | Deterministic state machines + channel adapters. |

**Everything is mounted from `server/index.ts`.** The legacy monolith `registerRoutes` runs first (so its `/api/*` routes win on conflict), then module routers: `/api/research` (232), `/api/decision` (236), `/api/video` (240), `/api/stories` (245), `/api/content` at `/api` (251), `/api/automation` (257), `/api/learning` (260), `/api/experiments` (266), `/api/policy-candidates` (275-276), `/api/policies` (277), `/api/autonomy` (280), `/api/agent` (283).

---

## 2. The canonical lifecycle

```
ResearchJob ──▶ Story ──▶ Opportunity[N] ──▶ GenerationJob ──▶ Artifact(rev)
                                                                    │
                                              Schedule ──▶ Occurrence ──▶ Publication ──▶ Result
                                                                                          │
                                                                       performance_signals ──▶ learning/*
```

**Research** (`server/research/`): providers fan out → `dedupeSources` → `filterByWindow` → cap at `maxSources` (50) → **[optional Jev triage gate]** → `insertSources` → `deriveEvidence` (400-char clip, sha256 dedupe, `kind:"excerpt"`) → `validateResearch` (needs ≥1 `sourced` evidence) → `insertEvidence` (≤50) → `analyzeResearch` (descriptive ranking: `0.35 relevance + 0.25 freshness + 0.15 authority + 0.20 convergence + 0.05 engagement` — sorted, persisted, **never gates anything**).

**Providers:** `rss`, `reddit`, `youtube` (metadata only), `hn`, `web`, `video` (transcripts via yt-dlp), `last30days` (registered only when `LAST30DAYS_ENABLED=1`/`LAST30DAYS_SCRIPT`). Access classes are enforced at dispatch (`research/registry.ts` — `local-agent-only` is refused server-side).

**Story → Opportunity:** `createStoryFromResearch` (`story/service.ts:106`) requires a `complete` job with ≥1 evidence; multiple Stories per job are legitimate; `automationRunId` is the only idempotency key. `createOpportunityFromStory` (`content/opportunity.ts:119`) validates `format × channel` against the adapter registry + format profiles, then persists `status:"proposed"`.

**Opportunity → GenerationJob → Artifact:** a frozen `GenerationPolicy` (`policyKey`+`version`+`specHash`, one-active-per-key) carries the context snapshot; `runGenerationJob` calls the model to write **copy only** — format, structure, hook-first and voice all come from the frozen prompt. `createArtifact` stores an immutable revision (DB trigger, migration 0007); changes are new revisions linked by `supersedes_id`.

**Artifact → Publication:** `readiness` walks `draft → in_review → approved|rejected` (human, or `trusted` auto-transition). Only `approved` is schedulable. `runPublication` leases single-flight, records `providerCalled`, and **never blind-retries after a provider call** — ambiguous outcomes become `results.outcome = "unknown"`.

**Automation** (`content/automation.ts`) is the canonical auto-chain: `AutomationPolicy` (frozen `policySnapshot`, `specHash`, version) → `AutomationRun` → `runResearchStep` → `runStoryStep` (deterministic `synthesizeStory`) → `runFanoutStep` (`boundAutomationTargets` + optional Jev framing → `repurposeStory`) → `runSettleStep` (stops at `awaiting_approval` unless `trusted`+`on_approval`). One bounded step per durable job delivery.

---

## 3. Decision inventory

### 3.1 Jev, live (2)

| Boundary | Wiring | Policy | Failure |
|---|---|---|---|
| `research_triage` | `decision/jev.ts:triageCandidates` ← `research/triageGate.ts` ← `research/engine.ts:287`, flag `JEV_RESEARCH_GATE=1` | keep `pursue`; else `watch`; else nothing | fail-**open** (keep all) |
| `format_select` (framing) | `content/framing.ts:createJevFraming` ← `content/automation.ts:985`, flag `JEV_FRAMING=1` | narrow-only over the policy's `format × channel` set | fail-**open** (policy set stands) |

**Known defect:** `selectForResearch` is all-or-nothing — if *any* candidate is `pursue`, every `watch` is discarded.

### 3.2 Jev, built but dead

`composeOpportunityScore` (`decision/jev.ts:342`) — a complete, tested weighted composer with **no production caller**. `Opportunity.score` is a free caller-supplied field nobody computes. `decision/intake.ts` + `POST /api/decision/{triage,intake}` exist but are not in any funnel.

### 3.3 Model-made decisions (the real target list = JC-01…JC-11)

`viral` 8-dim score (`routes.ts:2343`), discover rank (`discoverRefresh.ts:294`), style confidence gate (`content/styleAnalyzer.ts:70`), smart scheduling (`routes.ts:2791`), video claim/relevance extract (`research/videoExtract.ts:76`), brand-voice admission (`routes.ts:2674`), ingest relevance (`routes.ts:1128,1427`), chat-intent `format`/`channel` (`content/model.ts:121`).

### 3.4 Heuristic-made decisions

Agent intent regex (`shared/agent-ui.ts:192-381` + `inferTargets`/`inferWindowPreset`/`matchStoryId`), niche filter (`autopilot.ts:52-77`), content-type chain (`autopilot.ts:89-105`), template match (`autopilot.ts:142-168`), engagement score (`autopilot.ts:172-202`), rank (`autopilot.ts:454-473`), breaking boost ×1.5 (`marketPulse.ts:170`), failure classification regex (`content/adapters.ts:170,507,682,861`).

### 3.5 Tier 4 — deterministic by design, NEVER to be decided by a model

Research `intelligence.ts` ranking (versioned `research-analysis-v1`), `classifySource`, Jaccard clustering, conflict detection, quality-state machine, depth budgets, experiment assignment (`assignment.ts:34`) and evaluation (`evaluation.ts:403`), autonomy eligibility (`autonomy/controller.ts:214,281`) and its evidence floor/oscillation ceiling, publish validators, payload/character limits, rate limits, budgets/circuits/cooldowns, lifecycle transitions, `status === "failed"` checks, arithmetic, thread-splitter, client-side filters.

---

## 4. Intelligence providers — what exists and what does not

| System | State | Evidence |
|---|---|---|
| Research | **Real** | `server/research/*`, 7 providers |
| Last30 | **Real, off by default** | `research/providers/last30days.ts`, doctor-gated; `LAST30DAYS_ENABLED=1` |
| Agent Reach | **Inert** | Only a hardcoded capability record (`research/routes.ts:259`, `available:false`, `local-agent-only`), an e2e assertion, and an agent-side skill under `.agents/skills/agent-reach/`. Never registered, never dispatched. |
| Content Quality | **Does not exist** | No module scores quality/slop. `approveArtifact` performs no quality check. Nearest: legacy `viral_score` (advisory), `autopilot.computeEngagementScore` (ideas), research source ranking. |
| Personal Expertise | **Does not exist** | Only `user_profile.niche`/`messagingPillars` via ContextAssembly, `style_profiles` (observed *style*, not domain expertise), and Jev's transient `relevance_to_expertise` question. No table, no module, no output type. |
| Performance Analytics | **Real** | `results.metrics` → `learning/refresh.ts` → `performance_signals` (impressions, likes, comments, shares, clicks, saves, replies, followers_gained, engagement_rate; **absent ≠ 0**) |
| Experimentation | **Real** | `content/experimentation/*` — deterministic hash assignment, guardrailed evaluation, `policy_candidates` (human-gated activation) |
| Autonomy | **Real, bounded** | `content/autonomy/*` — non-configurable "repeatable" evidence floor, oscillation ceiling 1 |

---

## 5. Hard constraints (Jev must never override — enforced by code, not by docs)

1. Only `approved` artifacts are schedulable/publishable (`artifact.ts:336`; enforced in `publication.ts:180` and `scheduling.ts`).
2. Approval is per exact revision; rejected content is never schedulable.
3. Content is immutable at insert (DB trigger, migration 0007); changes are new revisions.
4. Auto-publish requires an explicit `trusted` + `on_approval` policy pair; otherwise runs stop at `awaiting_approval`.
5. `providerCalled` ⇒ never blind-retry; ambiguous outcomes become `unknown` and reconcile.
6. Single-flight leases (publication, automation) arbitrated by DB compare-and-set.
7. Ownership + mandatory attribution on artifacts; owner checks on publication.
8. Research text is **DATA, never instructions** — it cannot reach a policy, target or approval decision.
9. Access-class allowlist refuses `local-agent-only` at dispatch.
10. Rate limits: publish 30/min, global 100/min.
11. Payload/format caps: `x_post` 280, `threads` 500, `linkedin` 3000, `instagram` 2200; carousel 2-10 slides; schema registration required to generate or persist.
12. Autonomy evidence floor "repeatable" and oscillation ceiling are not owner-tunable.
13. A ResearchJob with no evidence fails the run — no fabricated Story.
14. Policy activation needs a human-reviewed candidate + completed experiment + non-regressed guardrails.

---

## 6. Feedback loop (as built)

`results.metrics` → `performance_signals` → `extractObservationsAndProposals` (deterministic; `MINIMUM_SAMPLE_SIZE_FOR_PROPOSAL = 3`, Δ ≥ 15%) → `learning_observations` / `learning_proposals` → `experiments` → `experiment_evaluations` → `policy_candidates` → `policy_activations` (human) or `autonomy/*` (bounded, journaled to `autonomy_decisions`).

Feedback reaches generation only as **bounded counts** (`context.ts:318`, `learningSummaryForContext`). Per-channel and per-format aggregation exists; **per-topic and per-hook do not**.

**There is no decision ledger.** `autonomy_decisions` is the closest artifact but covers only the autonomy controller and lacks an input hash, numeric confidence, a distinct policy version, and predicted-vs-actual. Predicted performance (`viral_scores.predicted_engagement`) and actual (`performance_signals`) are never joined.

---

## 7. Data model notes

Canonical tables live in `shared/schema.ts` (single file, ~2,460 lines). Migrations are **hand-written** — `drizzle-kit generate` is broken by a pre-existing meta snapshot-id collision (snapshots `0016`–`0019` share one id; snapshots stop at `0021` while the journal runs to `0032`; debt D8). Latest migration: `0032`. A new migration = SQL file + a `migrations/meta/_journal.json` entry.

Tables that matter for a decision layer: `researchJobs/Sources/Evidence/Analyses`, `videoSources/Chunks/Claims`, `stories`, `opportunities` (`score`, `scoreBreakdown`, `proposer`), `generationPolicies/Jobs`, `artifacts`, `schedules/occurrences`, `publications`, `results`, `automationPolicies/Runs`, `performanceSignals`, `learningSignals/Observations/Proposals`, `experiments/Variants/Assignments/Evaluations`, `policyCandidates/Activations`, `autonomyConfigs/Decisions`, `aiUsageLog`, `auditLogs`.

---

## 8. Feature flags in force (behaviour toggles, not credentials)

**Jev:** `TYPESAFE_TRANSPORT`, `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_MODEL`, `TYPESAFE_TIMEOUT_MS`, `JEV_CLI_ENABLED`, `JEV_CLI_PATH`, `JEV_TRIAGE_PURSUE`, `JEV_TRIAGE_WATCH`, `JEV_RESEARCH_GATE`, `JEV_FRAMING`, `CONTENTFORGE_EXPERTISE`, `CONTENTFORGE_AUDIENCE`.
**AI:** `AI_BASE_URL`/`AI_API_KEY`, `AI_TEXT_MODEL`, `VIDEO_TEXT_MODEL`, `VIDEO_MAIN_MODEL`, `VIDEO_PREMIUM_MODEL`, `VIDEO_GEMINI_FALLBACK`, `GEMINI_*`.
**Research:** `LAST30DAYS_ENABLED`/`LAST30DAYS_SCRIPT`, `WEB_RESEARCH_URLS`, `VIDEO_RESEARCH_URLS`, `YOUTUBE_CHANNEL_IDS`, `REDDIT_SUBREDDITS`, `HN_TAGS`.
**Execution:** `XQUIK_ALLOW_WRITE_RETRIES`, `CONTENT_SCHEDULER_ENABLED`, `DISABLE_CRON`, `REGISTRATION_DISABLED`, `TRUST_PROXY`, `SESSION_COOKIE_SECURE`, `CONTENTFORGE_E2E_SERVER`.

---

## 9. The two structural problems a decision layer must not inherit

1. **The decision surface is split.** The canonical lifecycle is already deterministic and nearly decision-free; the *actual* decisions live in the legacy monolith (`routes.ts`, `discoverRefresh.ts`, `autopilot.ts`, `marketPulse.ts`, `shared/agent-ui.ts`). A decision layer wired only into the canonical chain would decide almost nothing that matters; wired only into the legacy chain it would fight code that is deliberately heuristic. Both must be covered, and the coverage must be explicit per candidate.
2. **Prior art exists and is half-implemented.** `JEV-ARCHITECTURE.md` (facade sketch), `JEV-CANDIDATES.md` (JC-01…JC-11 + Tier 4), `JEV-MIGRATION-PLAN.md` (phased rollout) were written as design-only, and `server/decision/*` + `triageGate` + `framing` now implement a slice of them. Any new work must extend that code rather than start a parallel one.
