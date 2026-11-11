# ContentForge capability matrix

**Last reconciled:** 2026-11-11, branch `feat/auth0-migration`.
**Source of truth for architecture:** [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md).
**Source of truth for the decision layer:** [`../JEV_DECISION_MAP.md`](../JEV_DECISION_MAP.md).

This matrix is written from the code, not from the phase history. A row says
IMPLEMENTED only when the code path exists and a test exercises it; it says
VERIFIED LIVE only when the behaviour was observed running. The verification
table at the bottom records what was actually executed and when.

Status vocabulary is deliberately narrow — do not widen it.

| Status | Means |
|---|---|
| **IMPLEMENTED** | Code exists and is covered by a test in this repository. |
| **PARTIALLY IMPLEMENTED** | The path exists but a named part is missing or flag-gated off. |
| **NOT VERIFIED** | Code exists; no run of it was observed in the pass that wrote the row. |
| **BLOCKED** | Cannot progress without a decision or an external dependency. |
| **DEFERRED** | Deliberately out of scope for now. |

Classification is `EXISTS / EXTEND / GENERALIZE / REFACTOR / NEW / EXTERNAL / DEFER`.

## A. Intelligence and research

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Research providers — RSS, Reddit, YouTube metadata, Hacker News, web, video transcripts, last30days | EXISTS | IMPLEMENTED | `server/research/providers/*`, registry with access classes | `last30days` is registered only when `LAST30DAYS_ENABLED=1` |
| Research engine — dedupe, window filter, cap 50, evidence derivation, validation | EXISTS | IMPLEMENTED | `server/research/engine.ts`, `verticalSlice.dbtest.ts` | — |
| Descriptive ranking (`research-analysis-v1`) | EXISTS | IMPLEMENTED | `research/intelligence.ts` | Ranks and persists; gates nothing, by design |
| Evidence provenance, conflicts, clustering | EXISTS | IMPLEMENTED | `research/intelligence.ts`, `normalize.ts` | — |
| Research triage decision (`research_triage`) | EXISTS | IMPLEMENTED | `research/triageGate.ts` → `decision/engine.ts` | Single keep-set policy in the registry; the old all-or-nothing `selectForResearch` is gone |
| Research depth decision (`research_depth`) | EXISTS | IMPLEMENTED | `research/service.ts` | Flag `JEV_RESEARCH_DEPTH`, default off |
| Opportunity creation from a Story | EXISTS | IMPLEMENTED | `content/opportunity.ts` | — |
| Opportunity scoring (`opportunity_score`) | EXTEND | PARTIALLY IMPLEMENTED | `content/opportunityScoring.ts` → `decision/decisions/opportunity.ts` → `composeOpportunityScore` | Scores only when `JEV_OPPORTUNITY_SCORE=1`; otherwise `opportunities.score` stays null by design |
| Content strategy (`content_strategy`) | EXTEND | PARTIALLY IMPLEMENTED | same port → fills `audience` / `angle` | Flag `JEV_CONTENT_STRATEGY`, default off |
| Agent Reach discovery | EXTERNAL | PARTIALLY IMPLEMENTED | inert record in `research/routes.ts` (`available:false`) | Never registered or dispatched. Live scraping was ruled out (ban risk) in `JEV_DECISION_MAP.md` §10 |
| Competitor monitoring / audience question mining | NEW | NOT VERIFIED | none found | Needs a provider and a Story kind |

## B. Personalization

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Voice and style profiles | EXISTS | IMPLEMENTED | `content/style*`, agent tools `get_style_profile`, `activate_style_profile` | Learning from approved edits is count-only |
| Personal expertise — profile + alignment signals | EXTEND | PARTIALLY IMPLEMENTED | `server/intelligence/expertise/{profile,signals}.ts` | Feeds `expertise_alignment`; no per-domain history weighting yet |
| Second brain / context vault | EXTEND | PARTIALLY IMPLEMENTED | context assembly, `/sources` | Legacy ingest and reference routes redirect; not a distinct knowledge subsystem |
| Multiple brands | DEFER | DEFERRED | owner-scoped model only | Needs a brand dimension and a switcher |

## C. Creation

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Policy-driven generation | EXISTS | IMPLEMENTED | `content/generation.ts`, frozen `GenerationPolicy` | — |
| Immutable artifacts + revisions | EXISTS | IMPLEMENTED | `content/artifact.ts`, DB trigger (migration 0007) | — |
| Quality gate (`quality_gate`) | EXTEND | PARTIALLY IMPLEMENTED | `content/qualityGate.ts` ← `content/routes.ts`; `server/intelligence/quality/signals.ts` | Flag `JEV_CONTENT_GATE`; a REJECT holds submission, it is not a score on the Artifact |
| Formats and channels | EXISTS | IMPLEMENTED | adapters registered in `content/adapters.ts` | Facebook, newsletter and blog publishing have no adapter |
| Conversational composer, URL-to-content | EXISTS | NOT VERIFIED | `/create`, `content/chat.ts` | — |

## D. Repurposing

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Story fan-out to many formats | EXISTS | PARTIALLY IMPLEMENTED | `repurpose_story`, automation `runFanoutStep` | One-click campaign, batch review and similarity detection are not built |
| Format selection (`format_select`) | EXISTS | IMPLEMENTED | `content/framing.ts` ← `automation.ts` | Narrow-only over the policy's format × channel set; fail-open |

## E. Visual and video

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Image generation, carousel format | EXISTS | PARTIALLY IMPLEMENTED | `generate_image`, visual assets + refs, 2–10 slide carousel | Quote cards, infographics, asset library and visual QA unaudited |
| Video | EXTERNAL | PARTIALLY IMPLEMENTED | `generate_video`, `repurpose_video` call the Video Factory | Separate repository; not modified here |

## F. Distribution

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Approval (`draft → in_review → approved/rejected`) | EXISTS | IMPLEMENTED | `content/artifact.ts`, `publication.ts` gate | Per exact revision; rejected content is never schedulable |
| Scheduling, durable occurrences, leases | EXISTS | IMPLEMENTED | `content/scheduling.ts`, `publication.ts` | Single-flight lease; `providerCalled` ⇒ no blind retry |
| Publication + reconcile | EXISTS | IMPLEMENTED | `content/publication.ts`, adapters | Ambiguous outcomes become `unknown` and reconcile |
| Publish gate (`publish_gate`) | EXISTS | IMPLEMENTED | `content/publishGate.ts` ← `content/service.ts` | HOLD-only, fail-closed; flag `JEV_PUBLISH_GATE`, default off |
| Calendar drag-and-drop, best-time recommendations | EXTEND | NOT VERIFIED | `/schedule`, legacy smart scheduling | — |

## G. Analytics and learning

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Publication results and performance signals | EXISTS | IMPLEMENTED | `results.metrics` → `learning/refresh.ts` → `performance_signals` | Absent ≠ 0 |
| Observations and proposals | EXISTS | IMPLEMENTED | `learning/observations.ts` | Deterministic; minimum sample 3, Δ ≥ 15% |
| Experiments and policy candidates | EXISTS | IMPLEMENTED | `content/experimentation/*` | Human-gated activation |
| Reach signals | EXTEND | PARTIALLY IMPLEMENTED | `server/intelligence/reach/signals.ts` | Derived from our own history; no ingest seam yet |
| Per-topic and per-hook aggregation; predicted vs actual | NEW | NOT VERIFIED | none found | `viral_scores` and `performance_signals` are never joined |
| Decision ledger | EXISTS | IMPLEMENTED | `decision/ledger*.ts`, `jev_decisions` | Covers Jev boundaries, not the autonomy controller |

## H. Capture

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| URL, article, snippet, YouTube, RSS capture | EXISTS | NOT VERIFIED | quick-capture component, `/sources`, ingest routes | — |

## I. Automation

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Automation policies, runs, bounded steps | EXISTS | IMPLEMENTED | `content/automation.ts` | One bounded step per durable delivery |
| Durable jobs (pg-boss) | EXISTS | IMPLEMENTED | `server/jobs/*`, `jobs/runtime.dbtest.ts` | Idempotency via singleton window |
| Autonomy controller | EXISTS | IMPLEMENTED | `content/autonomy/*` | Evidence floor and oscillation ceiling are not owner-tunable |

## J. Agents

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Domain tools behind the agent runtime | EXISTS | IMPLEMENTED | `server/agent/tools.ts` (29 tools), `/agent` | — |
| Agent routing (`agent_route`, shadow) | EXISTS | IMPLEMENTED | `agent/routes.ts` → `decision/legacy.ts` | Shadow only; cut-over needs a labelled golden set |
| MCP server exposing those tools to outside assistants | NEW | NOT IMPLEMENTED | only an MCP **client** exists (`agent/external.ts`) | Roadmap phase B |

## Platform and public surface

| Capability | Class | Status | Evidence | Gap / next step |
|---|---|---|---|---|
| Auth — password, Google, Auth0 (Universal Login + bearer) | EXISTS | IMPLEMENTED | `docs/AUTH0.md`, `server/auth*` | — |
| CSRF, owner scoping, rate limits | EXISTS | IMPLEMENTED | `httpHardening.ts`, owner-isolation DB suites | — |
| Public marketing site | NEW | VERIFIED LIVE (2026-11-11) | `site/`, `server/site.ts`; served at `/`, `/chatgpt`, `/dots`, `/claude`, `/claude-cowork` | Agent pages describe the MCP connector as planned; its URL is a placeholder |

## Verification performed in this pass

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, no diagnostics |
| Unit + client suite | `npm run test:unit` | **1069 passed, 0 failed** |
| DB integration suite | `npm run test:db` | **388 passed, 0 failed** |
| Production build | `npm run build` | exit 0; `dist/index.cjs`, SPA in `dist/public`, marketing pages + `_site/` assets emitted to `dist/` |
| Marketing routes | `NODE_ENV=production node dist/index.cjs` then HTTP GET | `/`, `/chatgpt`, `/dots`, `/claude`, `/claude-cowork`, `/_site/site.css` → 200 |
| API health | same process | `/api/health` → 200 JSON; `/today` falls through to the SPA |
| Playwright | `npx playwright test` | 270 passed / 2 skipped / 7 failed pre-fix; 6 were load flake (serial re-run with retry: 25 passed, 2 flaky, 1 failed), and the 2 real spec defects are fixed and pass 12/12. A clean full re-run is **NOT VERIFIED** — a concurrent Craft Anything run was rebuilding `dist/`. Details in `docs/HANDOVER.md` §5.1 |

**Not verified:** live provider publishing (no real post was made from this pass),
last30days, Agent Reach (inert), MCP server (does not exist), Video Factory
integration (separate repository).
