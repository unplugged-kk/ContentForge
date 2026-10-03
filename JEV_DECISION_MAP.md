# ContentForge — Jev Decision Map

**Date:** 2026-10-02 · **Companion:** `CURRENT_ARCHITECTURE.md` · **Supersedes:** `docs/archive/JEV-ARCHITECTURE.md`, `docs/archive/JEV-CANDIDATES.md`, `docs/archive/JEV-MIGRATION-PLAN.md` (design-only, 2026-09-20), reusing their JC-01…JC-11 table.

The rule this map encodes:

> **INTELLIGENCE ≠ DECISION ≠ EXECUTION.** Signals are produced deterministically; Jev turns signals into a typed, versioned, logged decision; **execution re-runs its own hard validators and is never authorized by Jev.**

---

## As-built status (AUTHORITATIVE — supersedes the phase plan and the tables below)

Seven decision types are registered. Each has a policy id + version, a declared
fallback class, its own flag, and a ledger row. "Verified live" means observed on
the production instance, not inferred from tests.

| Type | Policy | Fallback | Flag | Consumer | Status |
|---|---|---|---|---|---|
| `research_triage` | research-triage v1 | fail_open_keep | JEV_RESEARCH_GATE | research engine | **VERIFIED LIVE** — kept pursue **+ watch** (conf 0.648) |
| `research_depth` | research-depth v1 | deterministic | JEV_RESEARCH_DEPTH | research engine, only when a request omits depth | IMPLEMENTED + unit-tested (flag off) |
| `opportunity_score` | opportunity-score v1 | deterministic | JEV_OPPORTUNITY_SCORE | `createOpportunityFromStory` → fills `opportunities.score` | **VERIFIED LIVE** (score 0.470) |
| `content_strategy` | content-strategy v1 | deterministic | JEV_CONTENT_STRATEGY | same port → fills `audience`/`angle` | **VERIFIED LIVE** (angle "cost per node") |
| `quality_gate` | quality-gate v1 | fail_closed_hold | JEV_CONTENT_GATE | `submitArtifactForReview` | **VERIFIED LIVE** (409 reject on slop) |
| `publish_gate` | publish-gate v1 | fail_closed_hold | JEV_PUBLISH_GATE | trusted auto-approval (`settleTrustedArtifact`) | IMPLEMENTED + unit-tested (flag off) |
| `format_select` | format-select v1 | fail_open_keep | JEV_FRAMING | automation fan-out (`content/framing.ts`) | **VERIFIED LIVE** — narrowed `x_thread` out |

**Instance state:** `JEV_DECISION_ENGINE_ENABLED=1`, `JEV_RESEARCH_GATE=1`,
`JEV_FRAMING=1`; every other decision flag is `0`, so quality, publish,
opportunity, strategy and depth remain inert.

**Two rules learned in production, both now enforced:**
1. A boundary is wired only when it is genuinely **enabled** (master switch AND
   its own flag). Wiring on the flag alone produced a boundary that looked active
   while silently returning the engine's fail-open fallback.
2. **Every decision carries its owner.** Three ports (triage, framing, depth)
   initially recorded `user_id NULL`, which made the row invisible once the
   ledger read became owner-scoped. All seven now pass the owner through.

**Superseded below:** §5's "Today" column, §9's flag table, and §11's phase list
(phases 3, 4 and 5 are complete, and the feedback half of 7; **Phase 6 — the
JC-01/02/03 legacy migrations — is NOT started**, and `publish_timing` was
deliberately not built because it has no consumer).

---

## 1. The engine

```ts
decisionEngine.decide({
  type: "research_triage",
  state: contentForgeState,   // normalized, assembled once
  refs: { researchJobId },
});
// → DecisionResult { decision, confidence, reasons, signals, policyId, policyVersion, fallback }
```

Located at `server/decision/engine.ts`, dispatched through `registry.ts`. **No module calls Jev directly** except through the engine (`jev.ts` stays the transport). The engine **never executes anything** — it returns a value; the caller acts.

**Level is always `soft`.** Hard constraints are code-owned and re-checked by the caller after the decision (see §6).

### Module layout

```
server/decision/
  jev.ts            (existing transport client — extended, not replaced)
  intake.ts         (existing)
  framing.ts        (existing)
  engine.ts         NEW  decide() — resolve → validate state → ask → parse → ledger → return
  registry.ts       NEW  type → { questions, thresholds, fallbackClass, policyId, level:"soft" }
  policies.ts       NEW  versioned policy ids + env-tunable thresholds + defaults
  schemas.ts        NEW  zod per decision type; one DecisionResult envelope
  state.ts          NEW  assembleState(refs) → ContentForgeState (reuses existing stores)
  validator.ts      NEW  assertHardConstraints(refs) + declared-fallback resolution
  ledger.ts         NEW  record(decision), attachOutcome(decisionId, actual)
  ledgerStore.ts    NEW  DatabaseDecisionLedger (db-test covered)
  shadow.ts         NEW  compute-and-log without acting (agreement harness)
  routes.ts         (existing — add GET /decisions, GET /decisions/:id, GET /policies)
  decisions/*.ts    NEW  one module per family: builds questions + maps answers
```

## 2. ContentForgeState (reuse, don't duplicate)

Assembled by `state.ts` from **existing** store readers; no new tables, no new schema types:

| Field | Source | Notes |
|---|---|---|
| `topic` | Job query / Story title+angles | |
| `research` | `researchJobs` + `researchEvidence` (excerpt + kind) | bounded to ≤5 excerpts, ≤400 chars each |
| `audience` / `expertise` | `user_profile` + **new** expertise provider | Phase 4 |
| `reach` | `performance_signals` aggregates + **new** reach provider | Phase 5 |
| `contentHistory` | prior `opportunities`/`artifacts` titles+formats | for `topic_deduplicate` |
| `performance` | `performance_signals` by channel/format | absent ≠ 0 — always mark availability |
| `quality` | **new** quality provider | Phase 3 |
| `platform` | `formatProfiles.ts` limits + `channelSupportsFormat` | the pair validator is authoritative |
| `constraints` | rate limits, budgets, artifact readiness, `providerCalled` | **hard** — read-only to Jev |

`inputStateHash` = sha256 of the normalized state (mirrors `context.ts:354`'s `contextHash` pattern), stored on every ledger row so a decision can be reproduced.

## 3. DecisionResult

```ts
type DecisionResult<T> = {
  decision: T;
  confidence?: number;
  reasons: string[];              // bounded, ≤ 10
  signals?: Record<string, unknown>;
  policyId: string;               // e.g. "research-triage"
  policyVersion: string;          // e.g. "v1" — NOT NULL in the ledger
  decisionType: string;
  fallback: boolean;              // true ⇒ Jev was not used / unusable
  level: "soft";
};
```

## 4. Fallback classes (declared per decision, never ad hoc)

| Class | Meaning | Used by |
|---|---|---|
| `fail_open_keep` | an outage keeps today's behaviour (no over-blocking) | `research_triage`, `research_depth`, `format_select` |
| `deterministic` | a code-owned fallback computes the value | `opportunity_score` (→ `composeOpportunityScore`) |
| `fail_closed_hold` | an outage produces **HOLD**; never auto-approve, never auto-publish, never auto-kill | `quality_gate`, `publish_gate`, `optimization.*` |
| `skip` | the decision is simply not recorded/acted on | `learning.*` |

**Invariant to assert in tests:** no Jev failure can result in a publish.

## 5. Decision taxonomy → reality

`●` live · `◐` built but unwired · `○` new work · `—` deliberately never

| Type | Family | Status | Where it decides today | Phase |
|---|---|---|---|---|
| `research_triage` | Research | ● | `research/triageGate.ts` ← `engine.ts:287` | 2 (upgrade) |
| `research_depth` | Research | ○ | depth comes from the request | 2 |
| `opportunity_score` | Opportunity | ◐ | `composeOpportunityScore` dead; `Opportunity.score` never computed | 2 |
| `opportunity_rank` / `reach_potential` / `trend_strength` / `audience_fit` | Opportunity | ○ | — (reach provider supplies signals) | 5 |
| `topic_select` / `topic_deduplicate` / `topic_kill` | Topic | ○ | dedupe is ad-hoc; no kill path | 4 |
| `audience_select` / `content_goal` / `positioning` / `angle` / `content_pillar` / `expertise_alignment` | Strategy | ○ | static policy / prompt text | 4 |
| `format_select` | Format | ● | `content/framing.ts` ← `automation.ts:985` | 2 (generalize) |
| `platform_select` | Format | ○ | policy targets | 5 |
| `hook_strategy` / `content_structure` / `content_depth` / `cta_strategy` | Production | ○ | baked into `formatProfiles.ts` + frozen prompt | 5 |
| `quality_gate` / `slop_gate` | Quality | ○ | **no engine exists** | 3 |
| `publish_gate` / `publish_timing` / `thread_length` | Publishing | ○ | hard gates only; Jev may only HOLD | 5 |
| `double_down` / `repurpose` / `kill` / `follow_up` | Optimization | ○ | — | 7 |
| `prediction_vs_actual` / `policy_evaluation` | Learning | ○ | — | 7 |
| **JC-01** viral 8-dim | legacy | ○ | `routes.ts:2343` (LLM) | 6 |
| **JC-02** discover rank | legacy | ○ | `discoverRefresh.ts:294` (LLM) | 6 |
| **JC-03** agent intent + targets | legacy | ○ | `shared/agent-ui.ts:192` (regex) | 6 |
| **JC-04…JC-11** | legacy | ○ | `autopilot.ts`, `marketPulse.ts`, `styleAnalyzer.ts`, adapters, scheduler, ingest | later |
| **Tier 4** (all) | — | — | deterministic by design | **never** |

## 6. Hard vs soft — the validator

```
signals ──▶ Jev ──▶ DecisionResult (soft) ──▶ caller's existing validators ──▶ execute | hold | reject
```

`validator.ts` exposes `assertHardConstraints(state, refs)` which reads (never writes) the hard state: artifact readiness, ownership, `providerCalled`, leases, rate-limit budgets, access class, payload caps. Callers **must** run it before acting. A decision never substitutes for it; a test asserts an unapproved artifact remains unschedulable with every Jev flag on.

## 7. Decision ledger

**New table `jev_decisions`** (hand-written migration `0033_jev_decisions.sql` + `_journal.json` entry, because `drizzle-kit generate` is blocked by debt D8). Shape follows the `autonomy_decisions` precedent, extended with what the brief requires:

| Column | Notes |
|---|---|
| `id`, `decision_id` (public string, unique) | `decision_id` for external references |
| `user_id`, `decision_type` | |
| `policy_id`, `policy_version` | **NOT NULL** — every decision is attributable to a policy |
| `input_state_hash` | sha256 — reproducibility |
| `decision` jsonb, `confidence` numeric null | the typed outcome |
| `reasons` jsonb, `signals` jsonb | bounded |
| `fallback` boolean, `latency_ms` int, `model` text, `transport` text | operational |
| `refs` jsonb | `{researchJobId, storyId, opportunityId, artifactId, publicationId, automationRunId}` |
| `predicted` jsonb null, `actual` jsonb null, `actual_at` timestamp null | the feedback loop |
| `correlation_id` text, `created_at` | |

Indexes: `(decision_type, created_at)`, `(input_state_hash)`, `(user_id)`, `(decision_id)` unique.
**Read API:** `GET /api/decision/decisions`, `/decisions/:id`, `/policies` (mounted at `server/index.ts:236`).

**Outcome attachment** reuses `learning/lineage.ts` to walk artifact → job → policy → opportunity → story, and attaches `actual` from `performance_signals`/`results.metrics`. The ledger **feeds** `learning → experiments → policyCandidates`; it does not replace it.

## 8. Policy versioning

`policies.ts` holds one entry per decision type:

```ts
research_triage: { id: "research-triage", version: "v1", fallback: "fail_open_keep",
                   thresholds: { pursue: env("JEV_TRIAGE_PURSUE", 0.65), watch: env("JEV_TRIAGE_WATCH", 0.45) } }
```

Changing a prompt, a threshold or a weight **requires a version bump** — the ledger must be able to answer "which policy produced this?". Env overrides are recorded on the row, so a tuned deployment is still attributable.

## 9. Feature flags (all default off ⇒ merged code changes no behaviour)

| Flag | Controls |
|---|---|
| `JEV_DECISION_ENGINE_ENABLED` | master — engine on/off |
| `JEV_RESEARCH_GATE` | existing triage boundary (upgraded) |
| `JEV_FRAMING` | existing framing boundary |
| `JEV_CONTENT_GATE` | `quality_gate` advisory (Phase 3) |
| `JEV_EXPERTISE` | expertise signals + strategy decisions (Phase 4) |
| `JEV_AGENT_REACH_DECISION` | reach signals + opportunity/publishing decisions (Phase 5) |
| `JEV_PUBLISH_GATE` | `publish_gate` (HOLD-only) (Phase 5) |
| `JEV_LEGACY_SCORING` | JC-01/02/03 (Phase 6) |

## 10. New intelligence providers (signals only — never decisions)

| Module | Outputs | Method |
|---|---|---|
| `server/intelligence/quality/*` | repetition, hedging density, link/emoji density, claim-less assertion, length vs profile, banned-phrase hits | deterministic text analysis over the Artifact payload |
| `server/intelligence/expertise/*` | expertise profile (domains, authority areas, confidence) + `expertise_alignment(topic)` | `user_profile` + published-topic history + style evidence; confidence-graded like `style_profiles` |
| `server/intelligence/reach/*` | `reach_potential`, `trend_strength`, `topic_velocity`, `historical_performance` | aggregates from `performance_signals`/`results.metrics`/`research_sources` + an **ingest seam** for externally-produced agent-reach JSON |

**Agent Reach is not built as a scraper.** Cookie-based channels carry ban risk and were previously ruled burner-only, never on VPS with production accounts. The first increment derives signals from our own data plus an ingest endpoint; live scraping is a separate, explicit decision and is out of scope.

## 11. Phases

1. **Audit artifacts** — this file + `CURRENT_ARCHITECTURE.md`. No behaviour change. *Stop for review.*
2. **Decision OS core** — engine, registry, policies, schemas, state, validator, ledger + migration `0033`, shadow harness, read routes. Master flag off. No boundary wired.
3. **Quality** — deterministic provider + `quality_gate` (advisory before `submitArtifactForReview`; REVISE returns to generation, REJECT blocks submission; fail-closed).
4. **Expertise** — profile + alignment signals → `expertise_alignment`, `audience_select`, `angle`, `content_goal`.
5. **Reach + publishing** — reach signals → `reach_potential`, `trend_strength`, `opportunity_score`, plus `publish_gate` (HOLD-only) and `publish_timing`.
6. **Tier-1 legacy** — JC-01 (8×score + noul), JC-02 (per-item score/choice + noul), JC-03 (choice over the **existing** tool registry, privileged grants untouched). Shadow-run + golden sets before flipping.
7. **Feedback** — outcome attachment via lineage; `prediction_vs_actual`, `policy_evaluation`; feeds the existing learning→experiments→candidates pipeline.

## 12. Testing

Unit: schemas, registry completeness, state assembly, policy validation, hard/soft classification, ledger persistence, `inputStateHash` stability.
Integration (fake Jev): research→Jev, quality→Jev, opportunity→Jev, Jev→executor (asserting the executor still validates).
Failure matrix: unavailable, timeout, 429, malformed JSON, schema mismatch, missing context, low confidence — assert the **declared** fallback each time, and that no failure can publish.
Shadow agreement: golden sets per JC candidate.
Tier-4 regression: assert those modules never import the engine.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Jev outage stalls a lifecycle stage | declared fallback per type; publishing-class fail **closed** |
| Jev silently bypasses a hard gate | hard gates stay code-owned; explicit bypass test |
| Ledger becomes noise | boundary decisions only; bounded payloads |
| Scope creep into Tier 4 | code-level denylist + import test |
| Interactive latency | cache by `inputStateHash`, timeouts, low confidence → deterministic fallback |
| Legacy migration destabilizes daily autopilot | Phase 6 only, shadow-run first, flag revertible |

## 14. Success metrics

Decision p95 latency < 1s · fallback rate · shadow agreement vs the current model/regex path on JC-01/02/03 goldens · ledger coverage of qualifying boundaries · **zero** hard-gate bypasses · **zero** publishes on Jev failure · (Phase 7) a newer policy version measurably beating the prior one.
