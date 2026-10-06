# Execution Atlas — how ContentForge actually executes

Reverse-engineered from the code. Every finding is tagged **CONFIRMED** / **DOCUMENTED** / **INFERRED** /
**UNKNOWN**. Where runtime behaviour cannot be proven from the repository it says so.

Diagrams in this folder:

| File | Type | Answers |
|---|---|---|
| [`01-main-entry.sequence.html`](./01-main-entry.sequence.html) | Sequence | The canonical end-to-end request/queue path |
| [`02-data-lifecycle.data-flow.html`](./02-data-lifecycle.data-flow.html) | Data flow | How the content objects move and change |
| [`03-decision-path.workflow.html`](./03-decision-path.workflow.html) | Workflow | Every place a decision is made |
| [`04-loop-map.workflow.html`](./04-loop-map.workflow.html) | Workflow | Every loop, retry, poll and schedule |
| [`05-agent-trace.sequence.html`](./05-agent-trace.sequence.html) | Sequence | The agent step loop |
| [`06-jev-trace.sequence.html`](./06-jev-trace.sequence.html) | Sequence | One Jev `decide()` call, including fallbacks |
| [`07-last30-trace.sequence.html`](./07-last30-trace.sequence.html) | Sequence | The doctor-gated `last30days` CLI provider |
| [`08-agent-reach-trace.sequence.html`](./08-agent-reach-trace.sequence.html) | Sequence | Why Agent Reach never runs |

---

## 1. Entry points — CONFIRMED

| Entry | Kind | Location | Notes |
|---|---|---|---|
| `registerRoutes` | HTTP (legacy, mounted first) | `server/routes.ts:109` ← `server/index.ts:228` | Wins on `/api/*` conflict |
| `/api/research` | HTTP | `server/index.ts:232` | create + read research jobs |
| `/api/decision` | HTTP | `server/index.ts:236` | triage/intake/read decisions |
| `/api/video` | HTTP | `server/index.ts:240` | intake/claims/extract |
| `/api/stories` | HTTP | `server/index.ts:245` | |
| `/api` (content) | HTTP | `server/index.ts:251` | opportunities/artifacts/schedules/publications |
| `/api/automation` | HTTP | `server/index.ts:257` | |
| `/api/learning` `/api/experiments` `/api/policy-candidates` `/api/policies` `/api/autonomy` | HTTP | `:260-280` | feedback loop |
| `/api/agent` | HTTP | `server/index.ts:283` | inline agent runtime |
| node-cron | Scheduler | `server/scheduler.ts` | legacy publish + autopilot |
| content scheduler | Scheduler | `server/content/service.ts:745` | occurrences + automation + analytics |
| autonomy scheduler | Scheduler | `server/content/autonomy/scheduler.ts:108` | 6-hour activation sweep |
| pg-boss workers | Queue | `server/jobs/runtime.ts:98` | 11 job types |

---

## 2. Function responsibility classification — CONFIRMED

| Role | Examples |
|---|---|
| **ORCHESTRATOR** | `ResearchEngine.execute` `engine.ts:207`; `runGenerationJob` `generation.ts:319`; `runPublication` `publication.ts:148`; `advanceAutomationRun` `automation.ts:741`; `AgentRuntime.advance` `runtime.ts:144` |
| **DECISION** | `decide` `decision/engine.ts:57`; `selectForResearch` `triageGate.ts:30`; `deriveAutomationStep` `automation.ts:699`; `selectDeterministicVariant` `experimentation/assignment.ts`; `evaluateActivationEligibility` `autonomy/controller.ts:316` |
| **TRANSFORMER** | `deriveEvidence` `engine-core.ts:116`; `assembleEffectiveRequest` `policy.ts:401`; `assembleContext` `context.ts:247`; `analyzeResearch` `intelligence.ts:448` |
| **VALIDATOR** | `validateResearch` `engine-core.ts:170`; `createOpportunityFromStory` `opportunity.ts:119`; `createArtifact` `artifact.ts:120`; `classify*Failure` `adapters.ts` |
| **IO / PERSISTENCE** | `DatabaseContentStorage` `content/storage.ts:510`; `DatabaseResearchStorage` `research/storage.ts:87`; `DatabaseStorage` `server/storage.ts:152` |
| **EXTERNAL API** | `server/social/*`; `server/research/providers/*` |
| **LLM** | `aiCallRouted` `ai/chat.ts:35`; `extractVideoClaims` `videoExtract.ts:60` |
| **QUEUE** | `server/jobs/runtime.ts`; `server/jobs/registry.ts` |
| **SCHEDULER** | `server/scheduler.ts`; `startContentScheduler` `service.ts:745` |
| **RETRY/RECONCILE** | `reconcileUnknownPublications` `publication.ts:475`; `failOrDefer` `automation.ts:780` |
| **CACHE/REGISTRY** | `registerChannelAdapter` `adapters.ts:825`; `registerProvider` `research/registry.ts:70` |
| **UTILITY** | `computeSourceHash` `normalize.ts:73`; `*IdempotencyKey` builders |

---

## 3. The main path — step table (CONFIRMED)

| Step | Component | Function | Input | Predicate | Output | Next |
|---|---|---|---|---|---|---|
| 1 | API | `POST /api/research/jobs` | topic query | provider ids all `hasProvider` | ResearchJob + enqueue | queue |
| 2 | Queue | `boss.work("research.run")` | job envelope | valid envelope schema | claimed job | engine |
| 3 | Research | `ResearchEngine.execute` | ResearchJob | depth budget | sources/evidence | next job |
| 4 | Story | `createStoryFromResearch` | complete job | `evidence.length ≥ 1` | Story | opportunity |
| 5 | Opportunity | `createOpportunityFromStory` | Story + format/channel | adapter ∧ profile ∧ supported | Opportunity | generation |
| 6 | Generation | `runGenerationJob` | Opportunity | frozen snapshot ∧ schema exists | Artifact (draft) | review |
| 7 | Artifact | `submitArtifactForReview` | Artifact | `readiness === "draft"` | `in_review` | approve |
| 8 | Artifact | `approveArtifact` | Artifact | `readiness === "in_review"` | `approved` | schedule |
| 9 | Scheduling | `dispatchDueOccurrences` | schedules | `existingCount < count ∧ due` | Occurrence | publication |
| 10 | Publication | `runPublication` | Occurrence | readiness approved ∧ lease ∧ !providerCalled | Result | platform |
| 11 | Adapter | `adapter.publish` | payload + media | caps valid | published/unknown | result |
| 12 | Metrics | `refreshPublicationMetrics` | published publication | `state === "published"` | performance_signals | learning |

---

## 4. Loop map (CONFIRMED)

| Loop | Location | Condition | Max | Retry | Exit |
|---|---|---|---|---|---|
| Provider fan-out | `research/engine.ts:231-245` | batches of providers | 8 providers / conc 4 | — | all batches resolved |
| Query expansion | `research/engine.ts:253` | `collected < maxSources` | budget | — | cap reached / no providers |
| Research job | `research/job.ts:158` | transient / rate-limited | 3 | 300s backoff* | complete / DLQ |
| Jev transport | `decision/jev.ts` | HTTP 429 / 529 | 3 | 500/1000 ms | response / typed error |
| Generation job | `content/service.ts:207` | transient | 3 | 60s backoff | succeeded / DLQ |
| Publication job | `content/service.ts:267` | transient only | 3 | 60s backoff | published / terminal |
| Publication reconcile | `publication.ts:475` | `state=failed ∧ providerCalled` | 5 | — | published / absent / unknown |
| Occurrence dispatch | `scheduling.ts:230` | `existingCount < count ∧ nextTime ≤ now` | 1 / tick / schedule | — | materialized |
| Automation step | `automation.ts:741` | one step per delivery | 10 attempts | keep intermediate | completed / awaiting_approval / failed |
| Agent step loop | `agent/runtime.ts:163` | `while (step < MAX_STEPS)` | 16 | — | backend done / failed |
| X write poll | `social/x.ts:432` | write-action pending | `XQUIK_WRITE_POLL_ATTEMPTS` (6) | 2s gap | success / pending error |
| IG container poll | `social/instagram.ts:645` | container `IN_PROGRESS` | 3 (max 8) | 250ms (max 2s) | FINISHED / ambiguous |
| Content scheduler | `content/service.ts:826` | `* * * * *` | — | — | every minute |
| Autonomy scheduler | `autonomy/scheduler.ts:26` | `0 */6 * * *` | — | — | every 6 hours |
| Legacy publish/retry | `server/scheduler.ts:38` | `status=scheduled ∧ isDue` | 3 | `[5,30,120]` min | published / failed |

\* `retryBackoff: true`; `rate_limited` dispositions `reschedule` with `retryAfterMs` without consuming an attempt.

---

## 5. Decision table (CONFIRMED)

| Decision | Location | Predicate | TRUE | FALSE |
|---|---|---|---|---|
| Window filter | `research/intelligence.ts:397` | `from ≤ published ≤ to` (missing ⇒ pass) | keep | drop |
| Research triage keep | `research/triageGate.ts` (engine adapter) | policy `JEV_TRIAGE_KEEP` (default `pursue+watch`) | pursue (+watch) | drop |
| Evidence validity | `research/engine-core.ts:175` | `sourcedCount ≥ 1` | complete | markFailed |
| Format × channel | `content/opportunity.ts:38` | `hasAdapter ∧ hasProfile ∧ supportsFormat` | create | error |
| Job reuse | `content/generation.ts:325` | `status === "succeeded"` | reuse artifact | run |
| Frozen snapshot guard | `content/generation.ts:345` | `policy.systemPrompt` present | proceed | permanent failure |
| Submit guard | `content/artifact.ts:269` | `readiness === "draft"` | `in_review` | ArtifactStateError |
| Approve guard | `content/artifact.ts:307` | `readiness === "in_review"` | `approved` | ArtifactStateError |
| Schedulable | `content/scheduling.ts:159` | `readiness === "approved"` | schedule | error |
| Publishable | `content/publication.ts:180` | artifact readiness `approved` | publish | terminal `policy_human` |
| Blind-retry guard | `content/publication.ts:185` | `providerCalled` | park unknown | invoke transport |
| Failure class | `content/adapters.ts:170/509/685/865/1046` | regex on error string | transient / permanent / policy_human | — |
| Settle status | `content/automation.ts:1156` | `!wantsArtifacts ∨ trusted` | completed | awaiting_approval |
| Triage verdict | `decision/jev.ts:270` | thresholds `pursue 0.65` / `watch 0.45` + floors | pursue/watch/skip | drop |
| Quality outcome | `decision/decisions/quality.ts:75` | `worthy ≥ 0.7 ∧ composite ≥ 0.7` etc. | approve/revise/reject | hold |
| Opportunity band | `decision/decisions/opportunity.ts` | `score ≥ high ? high : ≥ medium ? medium : low` | high/medium | low/unknown |
| Strategy choice | `decision/decisions/strategy.ts` | candidate match (exact, then contains) | chosen value | null |
| Publish gate | `decision/decisions/publishing.ts` | `readyNow ≥ publish ∧ composite ≥ publish` | publish | hold/reject |
| Format select | `decision/decisions/format.ts` | kept must be a subset of the allowed pairs | kept subset | keep all (fail-open) |
| Research depth | `decision/decisions/research.ts` | asked only when the request has no depth | quick/standard/deep | standard (fail-open) |
| Legacy shadows (JC-01/02/03) | `decision/legacy.ts` | per-type flag `JEV_LEGACY_SCORING` | record only | no call at all |
| Proposal | `content/learning/proposals.ts:316` | `sample ≥ 3 ∧ Δ ≥ 15%` | propose | none |
| Guardrail | `content/experimentation/evaluation.ts:227` | `vFailRate > cFailRate + 0.10` | regressed | ok |
| Activation | `content/policyActivation/activation.ts:78` | `status === "approved_for_future"` + checks | activate | reject |
| Oscillation | `content/autonomy/controller.ts:97` | A/B/A/B over ≥4 events | open breaker | continue |
| Agent intent | `shared/agent-ui.ts:192-381` | regexes | targets | fallback plan |

---

## 6. Async / concurrency (CONFIRMED)

- **Parallel:** provider fan-out (`Promise.all` over batches, concurrency 4, `research/engine.ts:233`); discover source fetches (`discoverRefresh.ts:254`).
- **Serialized by DB:** publication lease, automation run lease, occurrence CAS, unique idempotency keys.
- **Joins:** `Promise.all` in the research fan-out returns when all batches settle; each provider outcome is isolated.
- **Independently failing:** any provider can fail without failing the run; each job type fails independently into its own DLQ.

---

## 7. LLM / agent trace (CONFIRMED)

| Caller | Task/route | Prompt location | Output | Downstream |
|---|---|---|---|---|
| `generation.ts:319` | `default` | frozen policy snapshot (`policy.ts:401`) | copy JSON | Artifact payload |
| `routes.ts` (~30 sites) | `default` | inline + `brandSystemPrompt.ts` | JSON/text | posts/ideas/analysis |
| `discoverRefresh.ts:294` | `default` | inline | 20 ideas | `discovered_ideas` |
| `autopilot.ts:298,373` | `default` | inline + brand | drafts | `posts` |
| `rssAutopost.ts:11` | `default` | inline + brand | thread | `posts` (draft) |
| `styleAnalyzer.ts:70` | `default` | `ANALYSIS_SYSTEM_PROMPT` | style profile | `style_profiles` |
| `research/videoExtract.ts:76` | `video.extract` | `EXTRACT_SYSTEM_PROMPT` | claims | `video_claims` |
| `content/framing.ts:136` | Jev `choice` | built questions | chosen format | automation targets |
| `decision/engine.ts:136` | Jev per type | `decisions/*.ts` | `DecisionResult` | ledger + caller |

**Which LLM decides vs generates:** the **framing/triage/quality** calls are *decisions* (Jev). The
`default`-route calls are *generation* (copy, drafts, analysis). **All numeric gates** (readiness, caps,
leases, thresholds, budgets) are deterministic code, not the model. — CONFIRMED

---

## 8. Jev trace (CONFIRMED)

- **Invoked by:** `decision/engine.ts:57` from ten definitions — live: `quality_gate`
  (`content/qualityGate.ts`), `opportunity_score` + `content_strategy` (`content/opportunityScoring.ts`),
  `publish_gate` (`content/publishGate.ts`, trusted path only), `research_triage` (`research/triageGate.ts`),
  `research_depth` (`research/service.ts`), `format_select` (`content/framing.ts`); shadow-only:
  `viral_score` / `discover_rank` / `agent_route` (`decision/legacy.ts` → `shadowDecide`).
- **Input state:** `normalizeState` → bounded, whitelisted `ContentForgeState`; `hashState` → sha256.
- **Questions:** per-type `buildQuestions`; empty ⇒ no Jev call.
- **Returns:** typed `DecisionResult { decision, confidence?, reasons≤10, signals?, policyId, policyVersion, decisionType, fallback, level:"soft" }`.
- **Invalid output:** zod `validateDecision` throws ⇒ declared fallback, `fallback:true`.
- **Timeout/failure:** typed errors ⇒ declared fallback. Transport retries 429/529 up to 3.
- **Persisted:** `jev_decisions` (append-only at the application layer; migration 0033 has no trigger).
- **Outcome loop:** `decision/outcomes.ts` attaches observed publication metrics to the ledger rows by
  publication reference (`attachOutcomeByRef`), called from the analytics.refresh handler; unobserved
  metrics are recorded as unavailable, never as zero.
- **Fallback:** per policy — `fail_open_keep` / `deterministic` / `fail_closed_hold` / `skip`. **No failure can publish.**
- **UNKNOWN:** whether a live deployment sets `JEV_DECISION_ENGINE_ENABLED`.

---

## 9. Last30 trace (CONFIRMED)

`engine → provider.search → cli doctor --json → filter availableHosted → cli search --no-browser-cookies
→ normalizeLast30DaysItems → NormalizedSource[] → dedupe/persist`. Registered only when
`LAST30DAYS_ENABLED=1` or `LAST30DAYS_SCRIPT` is set; 2 MiB stdout cap; timeout ⇒ transient; no available
source ⇒ permanent. Anything the CLI does internally (including any model use) is **UNKNOWN**.

---

## 10. Agent Reach trace (CONFIRMED — a negative finding)

No provider is registered; the access class `local-agent-only` is refused at dispatch
(`research/registry.ts:105-108,229-234`); the only artifacts are a capability record
(`research/routes.ts:259`), an e2e assertion and an agent skill folder. Nothing dispatches it.

---

## 11. Confidence notes

- Confidence is `CONFIRMED` for every step/loop/decision above (each cites a real symbol).
- Model output and live deployment flags are `INFERRED` / `UNKNOWN`.
- No production code was modified to produce this atlas.
