# ContentForge status

Living status for Phase B work on `replit` / PR #3. Architecture detail lives in
`plans/contentforge-product/PHASE-B-IMPLEMENTATION.md`.

## Phase 27.1 — Real Video Provider Integration Hardening

**Status:** PARTIALLY IMPLEMENTED (Video Factory local render proven and
imported; OpenShorts REST adapter protocol-correct but processing BLOCKED
without Gemini or a local LLM; HyperFrames Cloud deferred — no subscription)

**Verification:** TypeScript 0; unit 523/523; visual E2E 38/38 (Path B now
asserts `index.html`; Path J confirms the live factory MP4). Live E2E 185/190
(8 Phase 27 checks including Path O all passed; 5 failures are the
pre-existing scheduler-tick / style-snapshot regression on `cf_e2e_live`).
Postgres video/factory/repurpose dbtests 13/13; full Postgres suite 257/258 on
first pass (1 pre-existing `jobs/runtime.dbtest.ts` idempotency flake,
recovered on re-run). Real factory evidence (not a fixture):

| field | value |
|---|---|
| job | `cfvg-9000271` |
| file | `/Users/kishore/git/video-factory/output/cfvg-9000271.mp4` |
| bytes | 126848 |
| codec | H.264 1080×1920, 2.000s |
| sha256 | `fa78ff28c00be603b8e55c9ac974197b15fb8f3626002b91fdabc6ce731dfa4b` |
| storage | `local:fa78ff28c00be603b8e55c9ac974197b15fb8f3626002b91fdabc6ce731dfa4b` |

### Problem

Phase 27 orchestration was real, but none of the three production providers
was actually executable: Video Factory jobs lacked `index.html`, HyperFrames
Cloud and OpenShorts adapters spoke invented HTTP paths, and
`GET /api/video/capabilities` collapsed “configured” into “implemented”.

### What changed

- Video Factory adapter writes a provider-native composition (`index.html` +
  `hyperframes.json`) from the bounded textual contract. Domain models still
  do not see HyperFrames/GSAP/Chrome/FFmpeg. External identity remains
  `cfvg-{VisualGeneration.id}`. Video Factory repo was not modified.
- OpenShorts adapter uses real REST: `POST /api/uploads` + PUT bytes +
  `POST /api/process` `{upload_id, acknowledged, target_clips}` +
  `GET /api/status/{job_id}`. Never MCP tool names as routes. Never
  `publish_clip`.
- Health distinguishes configured / reachable / processing_ready / reason.
  GET `/health` 200 is not operational. Explicit production prefs are never
  silently replaced with fixtures. HyperFrames Cloud `processing_ready` is
  always false in this phase.
- Restart/reconcile: OpenShorts does not resubmit when `providerJobId` is set;
  unknown reconciles the same identity.

### Local / Docker tools (no HyperFrames Cloud)

| tool | host | result |
|---|---|---|
| Video Factory + `npx hyperframes@0.7.60 render` | local filesystem worker at `/Users/kishore/git/video-factory` | **proven** — real MP4 imported through `AssetStoragePort` |
| OpenShorts (`mutonby/openshorts`, Docker) | clone at `/Users/kishore/git/openshorts` HEAD `27d4916`; container `openshorts-backend` on `:8000` | **reachable** — `GET /health` 200, `POST /api/uploads` returns `upload_id`, `POST /api/process` is the real route. **processing BLOCKED** — `400 Missing X-Gemini-Key header`; Ollama is not on `:11434`; factory MP4 is 2s vs `MIN_SOURCE_SECONDS` 45 |
| HyperFrames Cloud / HeyGen | hosted | **deferred** — no subscription; not tested |
| Clips Studio / Clipper / VibeClip | local Docker clippers | researched, **not integrated** this phase (OpenShorts remains the clipping port) |

### Defects D1–D5

| id | defect | outcome |
|---|---|---|
| D1 | HyperFrames Cloud / HeyGen v3 invented | deferred; `processing_ready: false` |
| D2 | OpenShorts invented MCP-as-HTTP | **fixed** (real REST) |
| D3 | OpenShorts health treated `/health` 200 as ready | **fixed** |
| D4 | Video Factory jobs missing `index.html` | **fixed** (adapter composition) |
| D5 | capabilities matrix claimed implemented when ROOT set | **fixed** (architecturally-ready until runner is processing-ready) |

### Deferred

Phase 28 YouTube + TikTok + Threads; HyperFrames Cloud; OpenShorts live
processing (needs Gemini or Ollama + ≥45s source); new clip adapters;
Video Factory repo changes.

## Phase 27 — Video Production + Video Repurposing Factory

**Status:** PARTIALLY IMPLEMENTED (orchestration + fixture E2E implemented;
Video Factory filesystem contract unchanged and unmodified; HyperFrames Cloud
ARCHITECTURALLY READY / unconfigured; OpenShorts ARCHITECTURALLY READY /
unconfigured; YouTube Shorts / TikTok publishing deferred)

**Verification:** TypeScript 0; unit 519/519; Postgres 258/258; live E2E
185/190 (8 new Phase 27 checks all passed; 5 failures are the pre-existing
regression-suite on `cf_e2e_live`: Phase 13 scheduler-tick timeout and
Phase 24 style-snapshot assertions — not Phase 27 paths); agent E2E 21/21
(1 new `repurpose_video` check); workspace/browser E2E 19/19 (video panel
on the existing Path A). Visual E2E not re-run (Video Factory untouched).

```
Regression suite:     177 passed / 5 failed
Phase 27 new live:      8 passed / 0 failed
Phase 27 agent extra:   1 passed / 0 failed
Phase 27 critical invariants: PASS
```

### Problem

Phase 21 proved Story → VideoGeneration → VisualProviderPort → VideoAsset,
with Video Factory remaining an external worker behind `video-factory.contract.v1`.
The missing production loop was derivative short-form: an owned VideoAsset
clipped into N VideoAssets with durable jobs, restart/reconcile, and no
provider-side publishing.

### Architecture

```
Story
  ↓
Opportunity(video)
  ↓
GenerationPolicy / ContextAssembly
  ↓
VideoGeneration
  ↓
VisualProviderPort
  ├── video-factory          (existing contract; not modified)
  ├── hyperframes-cloud      (adapter registered only if HYPERFRAMES_CLOUD_URL)
  └── local-video-fixture    (default omitted providerId)
       ↓
    VideoAsset
       ↓
VideoRepurposingJob
       ↓
VideoRepurposingProviderPort
  ├── openshorts             (if OPENSHORTS_API_URL)
  └── local-video-repurpose-fixture
       ↓
VideoAsset[N] (provenance=derived)
       ↓
Artifact → approval → existing publication pipeline (Instagram Reels)
```

ContentForge is the control plane. Video Factory / HyperFrames / OpenShorts
are workers. `publish_clip` is never called.

### Providers

| provider | capability | configured | verified | status |
|---|---|---|---|---|
| video-factory | generate_video | VIDEO_FACTORY_ROOT | filesystem contract in agent E2E | implemented adapter; factory repo unmodified |
| hyperframes-cloud | generate_video | HYPERFRAMES_CLOUD_URL | no | architecturally-ready / unconfigured |
| local-video-fixture | generate_video | always | yes | implemented |
| openshorts | repurpose_video | OPENSHORTS_API_URL | no | architecturally-ready / unconfigured |
| local-video-repurpose-fixture | repurpose_video | always | yes | implemented |

Explicit production `providerId` is never silently replaced with a fixture.
Omitted video `providerId` still defaults to `local-video-fixture`.

### Video Factory

Unmodified. External identity remains `cfvg-{VisualGeneration.id}`.
Retries reuse that identity. `VIDEO_FACTORY_ROOT` is not ContentForge domain state.

### HyperFrames

Not merged. Optional `hyperframes-cloud` adapter maps safe variables
(title/hook/body/cta/…) and imports bytes from ephemeral signed URLs into
`AssetStoragePort`. Local / Lambda / Cloud Run backends are not claimed.

No VideoTemplate table. Existing Template remains text/content templates.

### OpenShorts

Not merged. Adapter uses `process_video` / `get_job_status` / clip download
only. ContentForge owns publishing.

### Database

Migration `0026_video_repurposing`: `video_repurposing_jobs` (unique
`idempotency_key`) and `video_repurposing_outputs` (unique `job_id, position`).
Tables 55 → 57. Job type `video.repurpose`.

### API

Existing `POST/GET /api/video-generations` unchanged.
New: `GET /api/video/capabilities`, `POST /api/video/repurposing`,
`GET /api/video/repurposing/:id`, `GET /api/video/repurposing/:id/assets`.

### Agent / UI

Tools: `generate_video` (reused), `get_video_generation`, `repurpose_video`,
`get_video_repurposing_status`, `list_video_derivatives`.
`/agent` reuses the Phase 23 workspace with a video panel
(`VideoGenerationCard` / `VideoAssetCard` / `VideoRepurposingCard` / `ClipCard`).
Binaries are never streamed through AgentRun messages.

### Invariants

| invariant | result |
|---|---|
| Story → Video without re-research | PASS (existing Phase 19/21) |
| Context snapshot frozen | PASS |
| VideoGeneration idempotency | PASS |
| External job identity reused on retry | PASS (`cfvg-` / `cfvr-`) |
| Unknown reconciled before retry | PASS (fixture unknown) |
| VideoAsset immutable | PASS (existing trigger) |
| Asset storage validated | PASS |
| Video derivative provenance | PASS |
| Partial clip survival | PASS |
| Owner isolation | PASS |
| Approval gate | PASS |
| Publication uses existing pipeline | PASS (Reels adapter unchanged) |
| No provider-side publishing | PASS |

### CannerAI parity

VI-1 strengthened (video production + separate clipping port).
CR-13 video scripts remain data on the VideoGeneration snapshot.
DI-12 distribution still Instagram Reels only.
YouTube Shorts / TikTok / full YouTube are NOT marked implemented.

### Deferred

Phase 28 YouTube + TikTok + Threads publishing; HyperFrames live cloud
verification; OpenShorts live processing; VideoTemplate revisions;
advanced editor; avatar/lip-sync; auto-publish.

## Phase 26 — Research Intelligence + SEO


**Status:** IMPLEMENTED (last30days live smoke BLOCKED unless explicitly enabled;
OpenSEO ARCHITECTURALLY READY / unconfigured; YouTube remains metadata-only;
Timeplus live MCP remains ENVIRONMENTALLY BLOCKED; Video Factory HyperFrames
render remains the Phase 21 BLOCKED boundary)

**Verification:** TypeScript 0; unit 509/509; Postgres 251/251; live E2E
175/182 (8 new Phase 26 checks all passed; 7 failures are regression-suite on
the shared `cf_e2e_live` DB — Phase 13 scheduler-tick timeout, Phase 24
style-snapshot assertions, plus two Phase 10 context-generation checks that
rate-limited this run — not Phase 26 paths); agent E2E 20/20; workspace/browser
E2E 19/19. Visual E2E not re-run (Video Factory untouched).

```
Regression suite:     167 passed / 7 failed
Phase 26 new live:      8 passed / 0 failed
Phase 26 agent extra:   2 passed / 0 failed
Phase 26 critical invariants: PASS
```

### Problem

Phase 25 proved one research-backed Story can become many content outputs.
The remaining creation gap was the *input* Story: research collected sources
and derived evidence, but did not freeze windows, expand queries, cluster
cross-provider events, rank, surface conflicts, or attach optional SEO
context before synthesis.

### Architecture

```
Research Intent (query, window, depth, asOf, seo)
      ↓
one ResearchEngine
      ↓
SourceProviders in parallel (rss / reddit / youtube / hn / web
                             + last30days if explicitly enabled)
      ↓
NormalizedSource → dedupe → window filter
      ↓
research-analysis-v1 (clusters, ranking, credibility class,
                      conflicts, quality, novelty, synthesis draft)
      ↓
Evidence → Story  → existing Phase 25 repurposing
```

No second research engine. SEO is an optional port (`createSeoProvider`),
not a SourceProvider. last30days is a SourceProvider gated by
`LAST30DAYS_ENABLED=1` or `LAST30DAYS_SCRIPT` plus doctor JSON at probe time.
Agent-Reach is a doctor/fallback *design reference* (`local-agent-only`);
hosted core stays cookie-free.

### Database

`research_analyses` (migration `0025_research_intelligence`): unique
`(job_id, analysis_version)`, owner/job indexes, FK to `research_jobs`.
Completed analysis snapshots are immutable (`ON CONFLICT DO NOTHING`).

### Invariants proven

- no fabricated Story on zero usable sources
- mixed-provider aggregation + analysis-v1 snapshot
- last_30d and asOf frozen on the ResearchJob initiation
- concurrent identical requestKeys collapse to one job
- over-limit `maxSources` is 400, not truncated
- last30days/OpenSEO/Agent-Reach advertised honestly
- prompt injection remains data
- Phase 25 mixed Story → two formats with no extra research

### External posture

| Integration | Status |
|---|---|
| last30days | ARCHITECTURALLY READY / live BLOCKED (not enabled; doctor JSON is capability truth) |
| Agent-Reach | REFERENCE ONLY (not dispatched; no Python internals; no hosted cookies) |
| OpenSEO | ARCHITECTURALLY READY (unconfigured; `research_keywords` returns structured skip) |
| YouTube transcript | NOT CLAIMED (discover metadata only) |

### CannerAI parity

| Item | Status |
|---|---|
| IN-1 directed research | IMPLEMENTED |
| IN-2 autonomous discovery foundation | IMPLEMENTED |
| IN-3 URL research | IMPLEMENTED |
| IN-4 article/blog ingestion | PARTIALLY IMPLEMENTED (web fetch; no PDF extractor) |
| IN-5 YouTube ingestion improvement | PARTIALLY IMPLEMENTED (metadata discover; no transcript) |
| IN-6 Reddit/discussion ingestion | PARTIALLY IMPLEMENTED (cookie-free provider; limitations reported) |
| IN-7 RSS monitoring | IMPLEMENTED |
| IN-8 trending topics | PARTIALLY IMPLEMENTED (freshness/ranking/novelty; no `trend_signals` table) |
| IN-9 multi-source synthesis | IMPLEMENTED |
| IN-10 evidence/provenance | IMPLEMENTED |
| IN-11 credibility/conflict handling | IMPLEMENTED |
| IN-12 recent/current-events research | IMPLEMENTED |
| IN-13 research library | PARTIALLY IMPLEMENTED (job list + frozen analysis; no pin UI) |
| IN-14 saved research/context | PARTIALLY IMPLEMENTED (idempotent reuse + existing ContextAssembly) |

### Deferred

**Deferred:** vector DB; hosted cookie/session research;
YouTube transcript unless a real backend exists; OpenSEO live until configured;
last30days live until `LAST30DAYS_ENABLED=1` plus doctor-available hosted sources;
batch analytics/learning (Phase 29); HyperFrames live; automatic publish.

## Phase 25 — Mass Repurposing Engine

**Status:** IMPLEMENTED (Timeplus live MCP remains ENVIRONMENTALLY BLOCKED;
Video Factory HyperFrames render remains the Phase 21 BLOCKED boundary)

**Verification:** TypeScript 0; unit 493/493; Postgres 249/249; live E2E 169/174
(11 new Phase 25 checks; 5 failures are Phase 13 scheduler-tick timeout + Phase 24
style-snapshot assertions on the shared live DB, not Phase 25 paths); agent E2E
18/18; workspace/browser E2E 18/18. Visual E2E not re-run (Video Factory
untouched).

### Problem

One researched Story must become many independent Opportunities, GenerationJobs,
and Artifacts without re-researching, without a second content graph, and
without a giant batch prompt.

### Architecture

```
Story
  → RepurposingPlan (frozen slots, limits, contextByChannel)
  → Opportunity[N]   (existing; slot identity in repurpose_key)
  → GenerationJob[N] (existing; channel-aware frozen GenerationPolicy)
  → Artifact[N]
  → existing approval / schedule / publication
```

Canonical service: `repurposeStory`. Manual HTTP, agent `repurpose_story`, and
automation fan-out all call it. `count` expands to durable slots. Slot 1 keeps
the Phase 12 key so automation idempotency is unchanged.

### Database

`repurposing_plans` (migration `0024_repurposing_plans`): unique
`(story_id, request_key)`, owner/story/status indexes, FK to `stories`.

### Idempotency / concurrency

- Plan: unique `(story_id, request_key)` via `ON CONFLICT DO NOTHING`
- Opportunity: unique `repurpose_key`
  - slot 1: `repurpose:{storyId}:{requestKey}:{format}:{channel}`
  - slot N: `…:sN`
- Explicit new batch = new `requestKey`. `regenerate: true` uses a nonce and
  does not poison the base key.

### Limits

`maxTargetsPerPlan=20`, `maxCountPerTarget=10`, `maxOpportunities=50`. Over
limit → 400, not silent truncation.

### Failure / restart

Sibling outcomes are independent. Plan status is aggregated from durable rows
(`queued` / `running` / `partial` / `completed` / `failed` / `cancelled` /
`awaiting_approval`). Remaining work is whatever Opportunities/Jobs are missing
for the frozen slots — no in-memory cursor.

### Agent / UI

`repurpose_story` accepts structured targets with `count` and returns
`planId`, `storyId`, `opportunityIds`, `status`, counts. `/agent` has a
controlled repurpose panel; progress is polled from `GET /api/repurposing/plans/:id`.

### CannerAI parity

| Item | Status |
|---|---|
| CR-5 content repurposing | IMPLEMENTED |
| CR-6 one Story → many Opportunities | IMPLEMENTED (count/slots + plan) |
| CR-16 one-click transformations | PARTIALLY IMPLEMENTED (same graph; no extra transform engine) |
| CR-4 research-to-content | STRENGTHENED (research reuse proven) |
| CR-9 LinkedIn | COMPATIBLE where `linkedin_post` is registered |
| CR-10 future formats | COMPATIBLE (registry-driven; unsupported pairs return invalid) |
| DI-7 / DI-8 queue/calendar | UNCHANGED (existing surfaces) |

### Known blockers (unchanged)

- Timeplus live MCP: ENVIRONMENTALLY BLOCKED without `TIMEPLUS_MCP_URL`
- HyperFrames Video Factory render: BLOCKED (Phase 21)

### Deferred

Phase 27 video repurposing; vector duplicate detection; batch
analytics/learning (Phase 29); YouTube/TikTok/Threads; HyperFrames; automatic
publish; batch approval UI.

## Phase 24 — Real Voice + Style Intelligence

**Status:** IMPLEMENTED (Timeplus live MCP remains ENVIRONMENTALLY BLOCKED;
Video Factory HyperFrames render remains the Phase 21 BLOCKED boundary)

**Verification:** TypeScript 0; unit 484/484; Postgres 244/244; live E2E 163/163;
visual E2E 38/38; agent E2E 17/17; workspace/browser E2E 17/17.

### Architecture

```
Real creator content
        ↓
ReferenceContent (`references`, generalized — not a second store)
        ↓
StyleAnalysisJob (`style_analyses` + pg-boss `style.analyze`)
        ↓
StyleObservation (`style_observations`, evidence-backed)
        ↓
StyleProfileRevision (`style_profiles`, immutable, versioned)
        ↓
ContextAssembly (explicit preference ≠ observed style)
        ↓
GenerationPolicy snapshot
        ↓
GenerationJob → Artifact
```

Explicit Voice / user_profile preferences are never overwritten by observations.
Corpus profiles enter future assembly only after explicit activation. Historical
GenerationJobs stay pinned to the context hash frozen at queue time.

Deterministic text statistics are computed in-process. The existing
`StyleAnalyzerPort` (AI gateway / fixture) is used only for validated semantic
dimensions. No vector DB, no performance learning, no second queue.

### Surfaces

- `POST /api/references` (expanded source types), `GET /api/style/references`
- `POST /api/style/analyses`, existing per-reference analysis path kept
- `GET /api/style-analyses/:id`, `GET /api/style-analyses/:id/observations`
- `GET /api/style/profiles`, `POST /api/style/profiles/:id/activate`
- Agent tools: `list_style_references`, `analyze_reference_content`,
  `get_style_profile`, `activate_style_profile`
- `/agent` Style intelligence panel (add / select / analyze / activate;
  explicit vs observed)

### CannerAI parity

| Item | Status |
|---|---|
| SB-1 voice profile | IMPLEMENTED (explicit `voices` / user_profile, unchanged) |
| SB-2 real-post style analysis | IMPLEMENTED (corpus + provenance) |
| SB-3 preferences | IMPLEMENTED (not overwritten) |
| SB-4 brand knowledge | COMPATIBLE (profile + vault still assemble first) |
| SB-6 niche/topic | COMPATIBLE |
| SB-7 messaging pillars | COMPATIBLE |
| SB-8 reusable context | IMPLEMENTED (ContextAssembly freeze) |
| SB-9 feedback learning | DEFERRED (Phase 29) |
| SB-10 approval/edit learning | DEFERRED (Phase 29) |

### Known blockers (unchanged)

- Timeplus live MCP: ENVIRONMENTALLY BLOCKED without `TIMEPLUS_MCP_URL`
- HyperFrames Video Factory render: BLOCKED (Phase 21) — factory still requires
  a prepared composition; ContentForge did not gain HyperFrames, a submit API,
  or a second video queue in this phase.

### Deferred

Mass repurposing is Phase 25 (done). Vector semantic memory; automatic performance
learning; automatic mutation of Voice/preferences; Video Factory composition
builder / remote worker / HyperFrames Cloud-Lambda-Cloud Run selection.

## Phase 23 — CopilotKit + AG-UI Agent-Native Workspace

**Status:** IMPLEMENTED (Timeplus live MCP remains ENVIRONMENTALLY BLOCKED;
Video Factory HyperFrames render remains the Phase 21 BLOCKED boundary)

**Verification:** TypeScript 0; unit 481/481; Postgres 240/240; live E2E 154/154;
visual E2E 38/38; agent E2E 17/17; workspace/browser E2E 16/16 (+ Playwright Path A).

### Architecture

```
CopilotKit (UI / tool rendering)
        ↓
AG-UI SSE  (/api/agent/agui, /api/agent/runs/:id/stream)
        ↓
ContentForge Agent Runtime     Phase 22
        ↓
AgentToolRegistry
        ↓
Existing domain services → PostgreSQL + pg-boss
```

PostgreSQL remains authoritative. CopilotKit is not a second runtime, tool
registry, queue, or domain model. Frontend state is presentation/session only.

### Workspace

`/agent` — composer, live activity, controlled tool-call cards, Story /
Opportunity / Artifact / Visual / Video / Publication / AgentRun cards,
artifact review (edit = new revision, approve / schedule / publish via existing
APIs), run history, backend selector from server-advertised providers,
capability panel from `GET /api/agent/tools`.

Packages: `@copilotkit/react-core@1.72.0`, `@copilotkit/react-ui@1.72.0`.
Transport is ContentForge AG-UI, not CopilotRuntime-as-brain.

### Approval / publish

Agent suggestion vs user approval are distinct badges. Approve / schedule /
publish call ContentForge HTTP APIs. `compilePlan` workspace runs cannot set
privileged grants. `UNKNOWN` publication state is shown as UNKNOWN.

### Recovery

Reload reconstructs from `AgentRun` + `AgentToolCall` + `GET /events` / SSE.
No second conversation store.

### Known blockers (unchanged)

- Timeplus live MCP: ENVIRONMENTALLY BLOCKED without `TIMEPLUS_MCP_URL`
- HyperFrames Video Factory render: BLOCKED (Phase 21)

### Deferred

Phase 25 mass repurposing; A2UI /
MCP Apps; autonomous publishing as default; Chrome extension.

## Phase 22 — Agent Runtime + Agent Tool Layer

**Status:** IMPLEMENTED (Timeplus live MCP ENVIRONMENTALLY BLOCKED; Video Factory
HyperFrames render remains the Phase 21 BLOCKED boundary)

**Verification:** TypeScript 0; unit 470/470; Postgres 240/240; live E2E 154/154;
visual E2E 38/38; agent E2E 17/17.

### Architecture

```
Agent backends (fixture | OpenAI-compatible | AG-UI remote)
        ↓
Agent Runtime (durable AgentRun / AgentToolCall)
        ↓
AgentToolRegistry + authorization policy
        ├─ ContentForge tools → existing domain services → PostgreSQL + pg-boss
        └─ ExternalToolProviderPort → MCP (Timeplus semantic read-only tools)
```

PostgreSQL remains the system of record. Agents never receive SQL tools.
pg-boss remains the only queue (`agent.run` is a job type, not a second broker).

### AgentBackendPort

| Backend | Config | Status |
|---|---|---|
| `fixture` | default / `AGENT_BACKEND_ID=fixture` | IMPLEMENTED |
| `openai-compatible` | `AGENT_BACKEND_BASE_URL`, `AGENT_BACKEND_API_KEY`, `AGENT_MODEL` | IMPLEMENTED (verified against a local HTTP test endpoint) |
| `agui-remote` | `AGENT_AGUI_URL` | IMPLEMENTED (verified against a real external process) |

### Durable state

- `agent_runs` — owner, backend snapshot, objective, status, step/attempt, cancellation, failure class
- `agent_tool_calls` — tool name, idempotency key, input hash, bounded input/result, resource refs

### Tool inventory

See PHASE-B Phase 22. Privileged: `approve_artifact`, `publish_now`. Timeplus
semantic tools are read-only and do not mutate ContentForge tables.

### Timeplus

PARTIALLY IMPLEMENTED / ENVIRONMENTALLY BLOCKED — seam + semantic tools exist;
`TIMEPLUS_MCP_URL` is unset in this environment so agents read ContentForge-local
metrics (`source=contentforge`). Disabling Timeplus does not break the pipeline.

### Security

Owner identity is injected. Foreign IDs return `not_found`. Privileged tools
denied without an explicit grant. Prompt-injection research content cannot
elevate `publish_now`.

### Explicit deferrals

Mass repurposing intelligence, style learning, autonomous publishing as default,
Chrome extension, YouTube/TikTok, vector memory.
