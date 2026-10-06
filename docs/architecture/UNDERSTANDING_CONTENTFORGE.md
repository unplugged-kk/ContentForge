# If you only remember 10 things about ContentForge

> **Re-audited at revision `0f3f108`** (first traced at `48535b59`). Since then the Decision OS grew to
> ten types, `intelligence/expertise/*` and `intelligence/reach/*` landed, opportunity scoring + content
> strategy + publish gate were wired, framing became `format_select`, and JC‑01/02/03 began shadow-running.
> Item 7 and item 10 below have been corrected accordingly.

Written for a developer who did not build this system. No jargon where plain words work.

---

1. **It is one program, not a platform.** A single Express 5 process (`server/index.ts`) reads and writes
   one Postgres database (`shared/schema.ts`). There are no microservices.

2. **There are two content paths, and they barely touch.** The *canonical* path
   (Research → Story → Opportunity → Artifact → Publication → Result) lives under `server/content/` and
   `server/research/`. The *legacy* path (`server/routes.ts`, `autopilot.ts`, `discoverRefresh.ts`) still
   runs the daily autopilot and publishes through `server/scheduler.ts`.

3. **Most long work is a durable job.** `pg-boss` runs `research.run`, `generation.run`, `publication.run`,
   `automation.run` and friends. The HTTP request enqueues and returns; the worker does the work.

4. **Artifacts are immutable.** Once written, an artifact's content can never change (a database trigger
   enforces it). Every edit is a **new revision** linked by `supersedes_id`. Only a revision whose
   readiness is `approved` can be scheduled or published.

5. **The database arbitrates concurrency.** Single-flight is done with unique idempotency keys and
   compare-and-set leases — publication lease, automation lease, occurrence claim — not in-memory locks.

6. **Publishing never blindly retries.** If a provider call was made without a confirmed outcome, the
   result is parked as `"unknown"` and reconciled — the transport is not called again.

7. **The "Decision OS" (Jev) has ten decision types and is still off by default.** Seven decide live
   (`research_triage`, `research_depth`, `format_select`, `opportunity_score`, `content_strategy`,
   `quality_gate`, `publish_gate`); three legacy scores — viral (JC‑01), discover (JC‑02) and agent routing
   (JC‑03) — run in **shadow mode**: they record what they would have chosen and nothing acts on it.

8. **Most live decisions are still in the legacy monolith** — LLM prompts for viral scoring and discover
   ranking, and regex/heuristic logic in autopilot and the agent intent parser.

9. **Feedback is real but coarse.** Published results become `performance_signals`; deterministic
   extraction turns them into proposals; experiments and a **human activation** turn those into a new
   generation policy. Feedback reaches generation only as **bounded counts**, never per-topic.

10. **Agent Reach is still not a scraper, but the expertise and reach *signals* now exist.** ContentForge
    does not scrape reach. It does compute a deterministic **expertise** profile and **reach** signals from
    its own history (`server/intelligence/expertise/*`, `server/intelligence/reach/*`), and those feed the
    (flag-gated) opportunity-scoring decision. Live scraping remains explicitly out of scope.

---

## The most important workflows are

- **Research run** — `server/research/engine.ts:207` (fan-out → dedupe → window → cap → optional Jev triage → evidence → rank).
- **Content generation** — `server/content/generation.ts:319` (frozen policy writes copy only).
- **Publishing** — `server/content/publication.ts:148` (lease, publish, park unknown).
- **Performance feedback** — `server/content/learning/refresh.ts:162` → `policyActivation/activation.ts:130`.
- **Content discovery (legacy)** — `server/discoverRefresh.ts:22`.

Diagrams: [`workflows/`](./workflows/00-workflow-index.md).

## The most important decision points are

- **Research triage** — `server/research/triageGate.ts` (engine adapter for `research_triage`; policy via `JEV_TRIAGE_KEEP`, default `pursue+watch` — the old all-or-nothing `watch` drop is fixed).
- **Research depth** — `server/research/service.ts` → `research_depth` (own flag `JEV_RESEARCH_DEPTH`; fail-open to `standard`).
- **Format select** — `server/content/framing.ts` → `format_select` (`JEV_FRAMING`; narrow-only, keeps the policy's targets on an outage).
- **Evidence validity** — `server/research/engine-core.ts:175` (needs ≥1 `sourced` evidence).
- **Format × channel** — `server/content/opportunity.ts:38`.
- **Opportunity score + strategy** — `server/decision/decisions/opportunity.ts` + `strategy.ts` via `content/opportunityScoring.ts`.
- **Readiness** — `server/content/artifact.ts:269/307/326` and `scheduling.ts:159` (`approved` only).
- **Publish guard** — `server/content/publication.ts:180`.
- **Publish gate (trusted only)** — `server/decision/decisions/publishing.ts` via `content/publishGate.ts` (`hold` fails closed).
- **Legacy shadows (JC‑01/02/03)** — `server/decision/legacy.ts` records `viral_score` / `discover_rank` / `agent_route`; nothing acts on them (`shadowDecide`).
- **Quality thresholds** — `server/decision/decisions/quality.ts` (0.7 / 0.45).
- **Proposal / guardrail / activation** — `learning/proposals.ts:316`, `experimentation/evaluation.ts:227`, `policyActivation/activation.ts:78`.

Trace: [`execution/03-decision-path.workflow.html`](./execution/03-decision-path.workflow.html).

## The most important loops / retries are

- **Job retries** — 3 attempts with backoff, then a per-job dead-letter queue (`server/jobs/runtime.ts`).
- **Publication reconciliation** — ≤5 attempts (`publication.ts:475`).
- **Occurrence dispatch** — one per schedule per minute (`scheduling.ts:230`).
- **Automation steps** — one bounded step per delivery, ≤10 attempts (`automation.ts:741`).
- **Agent loop** — ≤16 steps (`agent/runtime.ts:163`).
- **Adapter polls** — X 6 attempts; Instagram 3–8.

Map: [`execution/04-loop-map.workflow.html`](./execution/04-loop-map.workflow.html).

## The most important data objects are

`ResearchJob` → `Source` / `Evidence` → `Story` → `Opportunity` → `GenerationPolicy` / `GenerationJob` →
`Artifact` (revision) → `Schedule` / `Occurrence` → `Publication` → `Result` → `performance_signals` →
learning proposals → `policy_candidates` / `policy_activations` → new `GenerationPolicy`.

Lifecycle: [`execution/02-data-lifecycle.data-flow.html`](./execution/02-data-lifecycle.data-flow.html).

## The most important external systems are

- **LLM gateway** (`server/ai/*`) — OpenAI-compatible default, Gemini for video tasks.
- **Jev / TypeSafe "System One"** (`server/decision/jev.ts`).
- **Research APIs** — RSS, Reddit, HN, generic web, yt-dlp, optional `last30days` CLI.
- **Publish platforms** — X (through the third-party **xQuick** gateway), Threads, Instagram, LinkedIn, YouTube.
- **Media providers** — OpenAI image, fal, ElevenLabs, macOS `say`.
- **Postgres** — the single source of truth.

---

### Where documentation and code disagree

- `JEV_DECISION_MAP.md` describes `intelligence/expertise/*` and `intelligence/reach/*` — they **now exist** as deterministic signal providers.
- It also implies `assertHardConstraints` and the decision-outcome ledger are wired — the **ledger outcome loop is now wired** (`decision/outcomes.ts`); `assertHardConstraints` remains tests-only.
- It calls `composeOpportunityScore` dead — it is **now the composer behind the `opportunity_score` decision**.
- `CURRENT_ARCHITECTURE.md` says Content Quality "does not exist" and that the triage gate drops all `watch` — **both are now fixed** (quality/expertise/reach providers exist; triage uses `pursue+watch`).
- Both docs imply the legacy boundaries bypass the engine — framing and research triage/depth now go **through** it, and JC‑01/02/03 are **shadow-running** (recorded, not yet cut over).

### What remains UNKNOWN

Anything about a live deployment: which flags are set, whether the autonomy controller has ever fired,
which content path the operator actually uses, and what the external `last30days` CLI does internally.

*UNKNOWN — runtime behaviour cannot be proven from repository inspection.*
