# Workflow index

Reverse-engineered end-to-end workflows. Each link opens a self-contained interactive diagram
(pan/zoom, search, focus) built from a typed Archify source with source-backed facts.

| # | Workflow | Trigger | Entry point | Status |
|---|---|---|---|---|
| 01 | [Content discovery (idea feed)](./01-content-discovery.workflow.html) | cron `0 6 * * *` · `POST /api/discover/refresh` | `server/discoverRefresh.ts:22` `runDiscoverRefresh` | Exists — legacy path |
| 02 | [Research run](./02-research.workflow.html) | `research.run` job · `POST /api/research/jobs` | `server/research/engine.ts:207` `execute` | Exists — canonical |
| 03 | [Agent Reach](./03-agent-reach.workflow.html) | — | — | **Does not run** — capability record only |
| 04 | [Decision OS (Jev)](./04-decision.workflow.html) | caller invokes `decide()` | `server/decision/engine.ts:57` | Exists — flag `JEV_DECISION_ENGINE_ENABLED` default off |
| 05 | [Content generation](./05-content-generation.workflow.html) | `generation.run` job | `server/content/generation.ts:319` `runGenerationJob` | Exists — canonical |
| 06 | [Quality gate](./06-quality-gate.workflow.html) | `submitArtifactForReview` | `server/content/artifact.ts:269` → `content/qualityGate.ts` | Exists — wired, default off |
| 07 | [Publishing](./07-publishing.workflow.html) | content-scheduler tick → `publication.run` | `server/content/publication.ts:148` `runPublication` | Exists — canonical |
| 08 | [Performance feedback](./08-performance-feedback.workflow.html) | `analytics.refresh` job | `server/content/learning/refresh.ts:162` | Exists — wired |
| 09 | [Legacy decisions (LLM + heuristic)](./09-legacy-decisions.workflow.html) | HTTP routes / cron | `server/routes.ts`, `server/autopilot.ts`, `server/discoverRefresh.ts` | Exists — legacy path |
| 10 | [Chat → opportunity → draft](./10-chat-opportunity.workflow.html) | `POST /api/chat/message` | `server/content/chat.ts:120` | Exists — wired |
| 11 | [Video repurposing](./11-video-repurposing.workflow.html) | `video.repurpose` job | `server/content/videoRepurpose.ts` | Exists — wired |
| 12 | [Automation run — four steps](./12-automation-settle.workflow.html) | `automation.run` job | `server/content/automation.ts:741` | Exists — canonical |
| 13 | [Strategy, expertise & reach](./13-strategy-expertise-reach.workflow.html) | Opportunity boundary (flag-gated) | `server/content/opportunityScoring.ts:65` | Exists — Phase 4/5, default off |
| 14 | [Legacy decisions in shadow mode](./14-legacy-shadow.workflow.html) | legacy sites (flag-gated) | `server/decision/legacy.ts` | Exists — Phase 6, record only |

**Plain-language walkthroughs:** see [`../WORKFLOW_GUIDE.md`](../WORKFLOW_GUIDE.md).

**Execution-level traces** (sequence, data-flow, loops, agent, Jev, last30, agent-reach):
see [`../execution/EXECUTION_ATLAS.md`](../execution/EXECUTION_ATLAS.md).

## Read this first

- ContentForge has **two content paths**: the canonical chain (Research → Story → Opportunity →
  Artifact → Publication → Result) and the older legacy chain (`routes.ts` + autopilot + discover).
  Workflows 01 is the legacy path; 02/05/07 are canonical.
- **Workflow 03 is included only as a negative finding.** It documents what is absent so you do not
  go looking for a scraper that is not there.
- Every diagram distinguishes confirmed code from documentation and inference in its cards. Where
  runtime behaviour cannot be proven from the repository it is marked **UNKNOWN**.
- **Re-audited at `0f3f108`** (first traced at `48535b59`). Since then the Decision OS grew to ten types
  (`format_select` plus the JC‑01/02/03 shadow trio), `research_depth` got its own flag, and expertise/reach
  signals landed — see workflows 13 and 14. Re-verify before relying on the decision workflow if the repo
  has moved on again.
