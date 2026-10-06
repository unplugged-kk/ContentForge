# ContentForge — Workflow Guide

Plain-English walkthroughs of every important end-to-end workflow, reverse-engineered from the code.
Evidence is tagged `CONFIRMED` / `DOCUMENTED` / `INFERRED` / `UNKNOWN`. Diagrams live in
[`workflows/`](./workflows/00-workflow-index.md); deep traces live in [`execution/`](./execution/EXECUTION_ATLAS.md).

Everything below is `CONFIRMED` unless marked otherwise.

---

## 0. How to read this

- **Trigger** — what starts the workflow.
- **What happens** — the ordered steps (each with a `file:line`).
- **Data moved** — the real objects/tables that change.
- **Decisions** — the actual predicates.
- **Loops** — where it repeats or retries.
- **Failure** — where it can fail and what happens.
- **Finish** — the terminal state.

There are **two content paths**. Do not confuse them:
- **Canonical** (Research → Story → Opportunity → Artifact → Publication → Result) — deterministic, almost decision-free.
- **Legacy** (`server/routes.ts` + `autopilot.ts` + `discoverRefresh.ts` + `marketPulse.ts`) — where most *live* decisions and the daily autopilot still run, publishing through `server/scheduler.ts`.

---

## 1. Content discovery (idea feed) — legacy path

- **Trigger:** cron `DISCOVER_CRON || "0 6 * * *"` (`server/scheduler.ts:130`), or `POST /api/discover/refresh` (`routes.ts:2155`).
- **Entry:** `runDiscoverRefresh(ownerUserId)` (`server/discoverRefresh.ts:22`).

**What happens**
1. Build `batchId = batch_<Date.now()>` (`discoverRefresh.ts:23`).
2. Fetch sources in parallel — HN Algolia (`:43`), 15 subreddits (`:68`), RSS (20 rotating/day, `:144`), GitHub search (`:176`), ArXiv (`:201`), Google Trends RSS (`:233`) (`:254-261`).
3. Dedupe against the last 14 days by URL and title-prefix (`:25-41`).
4. If nothing was fetched, seed 3 fallback ideas (`:265-289`).
5. **LLM ranking** via `aiCall(...)` (`:294`) — asks for **exactly 20 ideas** and ranks by "AI/DevOps ×1.3 > Value Density > Unique Angle > Emotional Trigger > Discussion Potential" (`:302-311`).
6. Persist with `storage.createDiscoveredIdeas` (`:351`).
7. Chain `runRssAutopostForBatch(saved, ownerUserId)` (`:352`).

**Data moved:** raw feed items → `discovered_ideas` (columns incl. `status:"new"`, `viralScore`, `sourceUrl`); then `posts` (draft) for RSS sources.
**Decisions:** the ranking is *entirely* the model prompt — there is no numeric relevance threshold in code (`INFERRED` that ranking quality is prompt-bound). Autopost candidate predicate: `idea.status === "new" && idea.sourceUrl.includes(feedHost)` then `.slice(0, 2)` (`rssAutopost.ts:64-70`).
**Loops:** one request per source; one autopost pass per enabled RSS source; up to 2 drafts per feed.
**Failure:** an empty fetch does not fail — it seeds fallback ideas (`discoverRefresh.ts:265`). Per-candidate autopost errors are caught (`rssAutopost.ts:72-76`).
**Finish:** `{ batchId, ideas, newIdeasCount, sourcesScanned }`; drafts sit in `posts` with `status:"draft"`.

---

## 2. Research run — canonical

- **Trigger:** `research.run` pg-boss job, or `POST /api/research/jobs` (`server/research/routes.ts:109`).
- **Entry:** `ResearchEngine.execute()` (`server/research/engine.ts:207`).

**What happens (exact order)**
1. Compute depth budget + deadline (`engine.ts:212-214`). Depth caps: quick 10 / standard 20 / deep 50 (`intelligence.ts:141-145`); hard ceiling `maxSources = 50` (`:20`).
2. **Provider fan-out** — cap 8 providers, concurrency 4 (`engine.ts:231-245`); each provider failure degrades to partial (`collectFromProvider` catch).
3. Query-expansion fan-out with early break when `collected.length >= budget.maxSources` (`:253-260`).
4. `dedupeSources` — identity ladder ref → canonicalUrl → contentHash (`engine-core.ts:39-88`).
5. `filterByWindow` — missing/unparseable `publishedAt` passes; else `from ≤ published ≤ to` (`intelligence.ts:397-404`).
6. Cap: `windowed.slice(0, budget.maxSources)` (`engine.ts:281`).
7. **Optional Jev triage gate** — `if (this.deps.triage && kept.length > 0)` (`engine.ts:287`); wired only when `JEV_RESEARCH_GATE === "1" && jevConfigured()` (`research/service.ts:35`). Wrapped in try/catch → **fail-open** (keeps all).
8. Zero-source classification → `markFailed(permanent)` (`engine.ts:307-341`).
9. `insertSources` (`:346`); `deriveEvidence` (400-char clip, sha256 dedupe, `kind:"excerpt"`).
10. `validateResearch` — valid iff **≥1 `origin === "sourced"` evidence** (`engine-core.ts:170-180`); else `markFailed(permanent)`.
11. `insertEvidence` cap ≤50 (`engine.ts:373`).
12. `analyzeResearch` — weighted `0.35·relevance + 0.25·freshness + 0.15·authority + 0.20·convergence + 0.05·engagement`, sorted desc, persisted (`intelligence.ts:478-492`); **gates nothing**.

**Data moved:** `research_sources` (`(jobId, canonicalUrl)` unique; `(jobId, provider, nativeId)` unique), `research_evidence` (`(jobId, sourceId, excerptHash)`), `research_analyses` (`(jobId, analysisVersion)`).
**Decisions (predicates):**
| Decision | Location | Predicate | TRUE | FALSE |
|---|---|---|---|---|
| Window filter | `intelligence.ts:397` | `from ≤ published ≤ to` (missing ⇒ pass) | keep | drop |
| Jev triage | `triageGate.ts:30-34` | `pursue.length > 0 ? pursue : watch` | keep pursue | keep watch |
| Validity | `engine-core.ts:175` | `sourcedCount ≥ 1` | complete | `markFailed` |

**Loops:** provider batch fan-out (`Promise.all`); expansion loop with break; per-source evidence derivation.
**Failure:** provider failure ⇒ partial; 0 sources ⇒ `empty` classification (`classifyEmptyCollection`); no sourced evidence ⇒ permanent failure. Job retry: `retryLimit 3`, `retryDelay 300s`, `retryBackoff true` (`research/job.ts:158-165`).
**Finish:** job `complete` with persisted sources/evidence/analysis, or `failed`.

> **Known defect (`CONFIRMED`):** `selectForResearch` is all-or-nothing — if *any* candidate is `pursue`, every `watch` is discarded.

---

## 3. Agent Reach — does not run

- **Status:** **absent**. ContentForge does not scrape reach data today.
- **What exists:** a hardcoded capability record `{ providerId:"agent-reach", available:false, accessClass:"local-agent-only" }` (`research/routes.ts:259-265`); an access-class allowlist that refuses `local-agent-only` at dispatch (`registry.ts:105-108,229-234`); an e2e assertion; and an agent-side skill folder under `.agents/skills/agent-reach/`.
- **What is missing:** no provider registration in `research/bootstrap.ts`, no dispatch path, no ingest endpoint, no store.
- **Trigger/entry:** none. `UNKNOWN — runtime behaviour cannot be proven from repository inspection.`
- See [`workflows/03-agent-reach.workflow.html`](./workflows/03-agent-reach.workflow.html) which documents the gap deliberately.

---

## 4. Decision OS (Jev) — one `decide()` call

- **Trigger:** a boundary caller invokes `decide({ type, state, refs })`.
- **Entry:** `decide()` (`server/decision/engine.ts:57`).

**What happens**
1. Resolve `policy = decisionPolicy(type)` and `definition = getDecisionDefinition(type)` (`:61-62`).
2. `normalizeState(input.state)` and `hashState(state)` → `inputStateHash` (`:63-65`).
3. `if (!enabled())` → fallback `"decision engine disabled"` (`:119`).
4. `if (!configured())` → fallback `"jev not configured"` (`:123`).
5. `buildQuestions(build)`; empty ⇒ fallback, no Jev call (`:129`).
6. `jevDecide(state, questions)` → parse → `validateDecision(type, ...)` (zod) (`:136-144`).
7. Confidence gate: `if (policy.minConfidence > 0 && permissive && confidence < minConfidence)` → declared fallback (`:149-159`).
8. Record to `jev_decisions` unless `policy.fallback === "skip"` (`:89`).
9. Return `DecisionResult { decision, confidence?, reasons≤10, signals?, policyId, policyVersion, decisionType, fallback, level:"soft" }`.

**Registered types (10):** `research_triage`, `research_depth`, `opportunity_score`, `quality_gate`, `content_strategy`, `publish_gate`, `format_select`, plus the shadow trio `viral_score`, `discover_rank`, `agent_route` (`registry.ts`, `policies.ts`).
**Live boundaries:** `quality_gate` (`content/qualityGate.ts`), `opportunity_score` + `content_strategy` (`content/opportunityScoring.ts`), `publish_gate` (`content/publishGate.ts`, trusted path only), `research_triage` (`research/triageGate.ts`), `research_depth` (`research/service.ts`, own flag `JEV_RESEARCH_DEPTH`), and `format_select` (`content/framing.ts` — framing now goes through the engine).
**Shadow boundaries (record only):** `viral_score` / `discover_rank` / `agent_route` via `decision/legacy.ts` (`JEV_LEGACY_SCORING`); the caller ignores the result.
**Fallbacks:** `fail_open_keep` (triage/depth/format), `deterministic` (depth/opportunity/strategy/legacy shadows), `fail_closed_hold` (quality/publish gate).
**Failure:** any thrown error ⇒ the definition's declared fallback with `fallback:true`. A Jev failure can never publish.
**Finish:** a soft `DecisionResult`; the caller decides what to do.

---

## 5. Content generation — canonical

- **Trigger:** `generation.run` job.
- **Entry:** `createGenerationJob` (`server/content/generation.ts:213`) → `runGenerationJob` (`:319`).

**What happens**
1. Opportunity must exist and `status !== "killed"` (`:220-221`).
2. Load bounded context (`loadGenerationContext:161`).
3. Freeze the policy: `resolveGenerationPolicy` (`policy.ts:209`) → `assembleEffectiveRequest` (`policy.ts:401`) producing `{ systemPrompt, userPrompt, inputHashes, policyVersion, specHash }`.
4. Idempotency `generation:<oppId>:<specHash>` (`:199`); claim the job with the frozen `policySnapshot`.
5. On run: if `status === "succeeded"` reuse the existing artifact (`:325-336`).
6. Guards: `if (!policy.systemPrompt) JobFailure.permanent(...)`; `if (!payloadSchemaRegistry.has(job.format)) JobFailure.permanent(...)` (`:345-352`).
7. Model call via `createGatewayGenerationModel` (`content/model.ts:29`) — **copy only**.
8. Validate the payload against the format schema; `createArtifact` with `readiness:"draft"` and evidence attribution.
9. `markGenerationSucceeded` (or `markGenerationFailed`).

**Data moved:** `generation_jobs` (`policySnapshot`, `policyId`, `idempotency_key`), `artifacts` (immutable payload, `provenance:"generated"`, `generationJobId`).
**Decisions:** the format/schema guards; success-reuse; the model decides the words, not the structure.
**Loops:** one model call per generation job.
**Failure:** missing snapshot/schema ⇒ permanent; model error ⇒ `JobFailure` class (transient/permanent). Job retry `retryLimit 3`, `retryDelay 60s`.
**Finish:** an Artifact revision at readiness `draft`.

---

## 6. Quality gate — advisory, default off

- **Trigger:** `submitArtifactForReview` (`server/content/artifact.ts:269`) when the gate is composed.
- **Entry:** `createJevQualityGate().review(...)` (`server/content/qualityGate.ts:62`).

**What happens**
1. Only runs if `deps.qualityGate` exists — set by `content/routes.ts:2328` `createContentQualityGate()`, which returns `undefined` unless `decisionTypeEnabled("quality_gate")` (needs `JEV_DECISION_ENGINE_ENABLED=1` **and** `JEV_CONTENT_GATE=1`) (`qualityGate.ts:110-113`).
2. `extractBody` → `computeQualitySignals` (deterministic regexes; `intelligence/quality/signals.ts:154`).
3. `decide({ type:"quality_gate", ... })` (`qualityGate.ts:97`).
4. Outcome from `decisions/quality.ts`: `publishWorthy ≥ 0.7 && composite ≥ 0.7 ⇒ approve`; `composite ≥ 0.45 || publishWorthy ≥ 0.45 ⇒ revise`; else `reject`; fallback `hold`.
5. In `artifact.ts:283-286`: if `outcome === "revise" || "reject"` → `throw QualityGateBlockedError` (HTTP 409). A thrown gate ⇒ `review = null` ⇒ the human path proceeds.

**Decisions:** thresholds `JEV_QUALITY_APPROVE` (0.7) / `JEV_QUALITY_REVISE` (0.45).
**Loops:** none (one decision per submit).
**Failure:** gate error ⇒ fail-open at the seam (submission proceeds). Fallback `hold` does **not** block.
**Finish:** the artifact stays `draft` (blocked) or transitions to `in_review`.

---

## 7. Publishing — canonical

- **Trigger:** content-scheduler tick (`server/content/service.ts:771`) or `publication.run` job.
- **Entry:** `dispatchDueOccurrences` (`scheduling.ts:230`) → `runPublication` (`publication.ts:148`).

**What happens**
1. **Schedule** (`createSchedule:137`) requires `artifact.readiness === "approved"` (`scheduling.ts:159-162`) and `channelSupportsFormat`.
2. **Occurrence** — `if (existingCount >= schedule.count) continue`; `if (nextTime > now) continue`; materialize at most one slot per schedule per tick (`:230`); CAS `pending→enqueued` (`markOccurrenceStatusIf`) so only one tick proceeds.
3. **Publication** — claim by `publicationIdempotencyKey = publication:<scheduleId>:<occurrenceId>:<artifactId>` (`:206`).
4. `runPublication`: if `state === "published"` reuse; if `artifact.readiness !== "approved"` → terminal `policy_human` (`publication.ts:170-181`).
5. **Reconcile-first:** `if (publication.providerCalled)` → `failed`, `outcome:"unknown"`, no second transport call (`:185-215`).
6. Acquire lease (`acquirePublicationLease`, CAS to `publishing`, 5-min) — else `skipped` (`:217-221`).
7. Resolve media (transient failure ⇒ reset `queued`, `providerCalled:false`).
8. `adapter.publish(...)`:
   - `ok` → `recordPublished` (state published, `providerCalled:true`, result `published`, occurrence `published`, `learning.recordPublication`; one-shot schedule → `exhausted`).
   - `!ok && providerCalled` → state `failed`, result `outcome:"unknown"` (keeps e.g. the xQuick `writeActionId`), never retried.
   - else classified: `transient` → reset `queued` + `JobFailure.transient`; otherwise `recordTerminal`.

**Adapters registered:** `x`, `linkedin`, `threads`, `instagram`, `youtube` (`adapters.ts:1246-1250`).
**Payload caps:** `x_post` 280, threads `x_post` 500, `linkedin_post` 3000, IG caption 2200, carousel 2–10 (`formatProfiles.ts`).
**Decisions:**
| Decision | Location | Predicate | TRUE | FALSE |
|---|---|---|---|---|
| Schedulable | `scheduling.ts:159` | `readiness === "approved"` | schedule | `ArtifactNotSchedulableError` |
| Publishable | `publication.ts:180` | `artifactId` readiness `approved` | publish | terminal `policy_human` |
| Blind retry | `publication.ts:185` | `providerCalled` | park unknown | invoke transport |
| Classify | `adapters.ts:170/509/685/865/1046` | regex on error | transient/permanent/policy_human | — |

**Loops:** scheduler tick per active schedule; at most one occurrence/tick; in-adapter bounded polls (X 6, IG 3–8); reconciliation ≤ 5 attempts.
**Failure:** transient ⇒ requeue (pg-boss retries, backoff); permanent ⇒ DLQ; ambiguous ⇒ unknown → reconcile.
**Finish:** `results` row (`outcome: published | unknown | failed`) plus provider metrics where available.

---

## 8. Performance feedback

- **Trigger:** `analytics.refresh` job (content-scheduler tick, up to 10 recent publications, `service.ts:792-799`) or `POST /api/learning/extract`.
- **Entry:** `refreshPublicationMetrics` (`learning/refresh.ts:162`) → `extractObservationsAndProposals` (`learning/proposals.ts:89`).

**What happens**
1. Load publication; require `state === "published"` (`refresh.ts:169`).
2. Fetch metrics via the channel adapter; `ingestNormalizedOutcome` writes one `performance_signals` row per metric (absent ≠ 0) + a `performance` `learning_signals` row.
3. `extractObservationsAndProposals` — deterministic: distribution proposal when `sampleCount ≥ 3 && diffPct ≥ 15` (`proposals.ts:316`); style proposal when `sampleCount ≥ 5 && sp.isActive` (`:418`); reliability proposal when `failureRate ≥ 20` (`:544`).
4. `createPolicyCandidateFromExperiment` writes a `policy_candidates` row (`status:"candidate"`, linked evaluation).
5. Human `activatePolicyCandidate` (default `actor:"human"`, `policyActivation/activation.ts:130`) requires `status === "approved_for_future"`, a completed experiment, `decision ∈ {variant_promising, variant_preferred}`, non-insufficient evidence, no regressed guardrail. It writes a **new** `generation_policies` revision and flips the single active pointer in one transaction.
6. Autonomy (`content/autonomy/controller.ts`) may auto-activate within a non-configurable evidence floor (`AUTONOMY_HARD_MINIMUM_EVIDENCE = "repeatable"`, `:74`) and oscillation ceiling `1` (`:82`).
7. Feedback reaches generation only as bounded counts via `context.ts` → `learningSummaryForContext` (`summary.ts:178`).

**Data moved:** `results.metrics` → `performance_signals` → `learning_observations`/`learning_proposals` → `experiments`/`experiment_evaluations` → `policy_candidates` → `policy_activations` (+ new `generation_policies` revision).
**Decisions:**
| Decision | Location | Predicate | TRUE | FALSE |
|---|---|---|---|---|
| Proposal | `proposals.ts:316` | `sampleCount ≥ 3 && diffPct ≥ 15` | propose | no proposal |
| Guardrail | `evaluation.ts:227` | `vFailRate > cFailRate + 0.10` | regressed | ok |
| Recommend | `evaluation.ts:403` | `Δ ≥ 10` (quality ok) | variant_preferred | promising/inconclusive |
| Activation | `activation.ts:78` | `status === "approved_for_future"` + checks | activate | reject |

**Loops:** per publication metric fetch; per metric row; per experiment variant.
**Failure:** non-published publications are skipped; insufficient data yields `insufficient_data` rather than a false conclusion.
**Finish:** a new active `generation_policies` revision (or no change).

---

## 9. Cross-workflow loop map

| Loop | Location | Condition | Max | Retry | Exit |
|---|---|---|---|---|---|
| Provider fan-out | `research/engine.ts:233` | batch of providers | 8 providers / conc 4 | — | all batches resolved |
| Research job retry | `research/job.ts:158` | transient/rate-limited | 3 | 300s backoff | complete / DLQ |
| Jev transport retry | `decision/jev.ts` | HTTP 429/529 | 3 | 500/1000 ms | response / typed error |
| Generation job retry | `content/service.ts:207` | transient | 3 | 60s backoff | succeeded / DLQ |
| Publication job retry | `content/service.ts:267` | transient only | 3 | 60s backoff | published / terminal |
| Scheduler tick | `content/service.ts:826` | every minute | — | — | — |
| Occurrence dispatch | `scheduling.ts:230` | `existingCount < count && nextTime ≤ now` | 1 / tick / schedule | — | all slots materialized |
| Publication reconcile | `publication.ts:475` | `state=failed && providerCalled` | 5 | — | published / absent / unknown |
| Automation step | `automation.ts:741` | one step per delivery | 10 attempts | keep intermediate | completed / awaiting_approval / failed |
| Agent step loop | `agent/runtime.ts:163` | `while (step < MAX_STEPS)` | 16 | — | backend completed / failed |
| Autonomy cron | `autonomy/scheduler.ts:26` | every 6h | — | — | — |

---

## 10. Where each workflow finishes

| Workflow | Terminal outcome |
|---|---|
| Discovery | ideas in `discovered_ideas`; drafts in `posts` |
| Research | ResearchJob `complete` / `failed` |
| Agent Reach | — (does not run) |
| Decision | soft `DecisionResult` (recorded or fallback) |
| Generation | Artifact revision at `draft` |
| Quality gate | `in_review` (approved path) or blocked (`draft`) |
| Publishing | `results` row (`published` / `unknown` / `failed`) |
| Feedback | new active `generation_policies` revision (or none) |

---

## 11. Confidence notes

- All steps above are `CONFIRMED` from source unless tagged otherwise.
- The **ranking quality** of discovery and the **model behaviour** of the AI Gateway are `INFERRED` — the code fixes the prompt/harness, not the output.
- Anything about a live deployment (which flags are set, which path an operator uses) is `UNKNOWN`.

---

## 12. Additional workflows (09–12)

### 12.1 Legacy decisions — LLM + heuristic (`workflows/09-legacy-decisions.workflow.html`)

- **Trigger:** various HTTP routes; autopilot also runs on cron.
- **What happens:** ingest relevance (`routes.ts:1128,1427`), brand-voice learning (`routes.ts:2674`),
  viral 8-dimension score (`routes.ts:2343`), discover ranking (`discoverRefresh.ts:294`) and smart-schedule
  suggestions (`routes.ts:2791`) are **model calls**; autopilot content-type/template/rank and the
  market-pulse ×1.5 boost are **heuristics** (`autopilot.ts`, `marketPulse.ts:170`).
- **Why it matters:** none of these go through the Decision OS — they are the migration surface.
- **Finish:** posts/ideas/scores persisted in the legacy tables.

### 12.2 Chat → opportunity → draft (`workflows/10-chat-opportunity.workflow.html`)

- **Trigger:** `POST /api/chat/message` (`routes.ts:3275`).
- **Entry:** `handleChatRequest` (`server/content/chat.ts:120`).
- **What happens:** the chat-intent LLM (`content/model.ts:105`) picks `format`/`channel`; a Story is
  created, an Opportunity is validated against the registry, a GenerationJob is created and
  `generation.run` enqueued.
- **Decision:** the model chooses the target; code validates it.

### 12.3 Video repurposing (`workflows/11-video-repurposing.workflow.html`)

- **Trigger:** `video.repurpose` job (retry budget 8, expiry 45 min — the largest).
- **Entry:** `createVideoRepurposingJob` / `runVideoRepurposing` (`server/content/videoRepurpose.ts`).
- **What happens:** a source video is rendered into derivatives by an external provider
  (`videoProviders.ts` — HyperFrames Cloud / OpenShorts); outputs persist as visual-asset refs.

### 12.4 Automation run — the four steps (`workflows/12-automation-settle.workflow.html`)

- **Trigger:** `automation.run` job (content-scheduler tick or HTTP trigger).
- **Entry:** `advanceAutomationRun` (`server/content/automation.ts:741`).
- **What happens:** one bounded step per delivery — `runResearchStep` (`:837`) → `runStoryStep` (`:895`) →
  `runFanoutStep` (`:974`, optional Jev framing) → `runSettleStep` (`:1092`).
- **Decision:** `!wantsArtifacts ∨ trusted ? completed : awaiting_approval` (`:1156`); `settleTrustedArtifact`
  (`:1180`) only under a `trusted` + `on_approval` policy.

### 12.5 Control-room map (`../contentforge-control-room.workflow.html`)

The typed Archify source behind the control room's "where am I" map: the content lifecycle
(Opportunity → Research → Draft → In Review → Approved → Scheduled → Published → Measured) with the
rejected and ambiguous exits.

### 12.6 Strategy, expertise & reach (`workflows/13-strategy-expertise-reach.workflow.html`)

- **Trigger:** no independent trigger — these run inside the Opportunity boundary when their flags are on.
- **Entry:** `createJevOpportunityScoring` (`server/content/opportunityScoring.ts:65`) → `decide()`.
- **Evidence (code):** `buildExpertiseProfile` + `expertiseAlignment` (`server/intelligence/expertise/*`)
  and `computeReachSignals` (`server/intelligence/reach/signals.ts`).
- **Decisions (Jev):** `opportunity_score` (band), `content_strategy` (lead angle / audience / goal /
  expertise band, all nullable, chosen from bounded candidates), and `publish_gate`
  (`content/publishGate.ts`, trusted unattended path only, `hold` fails closed).
- **Outcome loop:** `decision/outcomes.ts` attaches observed publication metrics back to every ledger row
  that referenced the publication.
- **Finish:** advisory values (`score`/`audience`/`angle`) persisted on the Opportunity; every decision
  recorded in `jev_decisions`; a `publish_gate` `hold` leaves the artifact in the human queue.

### 12.7 Legacy decisions in shadow mode (`workflows/14-legacy-shadow.workflow.html`)

- **Trigger:** the legacy sites themselves (`POST /api/viral/score`, `runDiscoverRefresh`, `POST /api/agent/runs`).
- **Entry:** `legacyShadows` (`server/decision/legacy.ts`) → `shadowDecide` (`server/decision/shadow.ts`).
- **What happens:** each site keeps its own live answer (the LLM score / ranking / regex plan) and the
  decision layer *also* computes `viral_score` (JC‑01), `discover_rank` (JC‑02) or `agent_route` (JC‑03),
  recording both sides in one `jev_decisions` row. **Nothing acts on the shadow result.**
- **Flags:** per type, `JEV_LEGACY_SCORING`; a disabled entry makes **no call at all**.
- **Finish:** a ledger row for later comparison (`agreementRate`) — the cut-over happens only once the two
  agree on a golden set. This is Phase 6 in progress, not a finished migration.
