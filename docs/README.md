# ContentForge docs — index

Curated 2026-10-02. **This file is the map. Read it before opening any other
doc, so you do not read a stale one.**

The source of truth is the code. For architecture, read
[`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md) first, then
[`../JEV_DECISION_MAP.md`](../JEV_DECISION_MAP.md). Everything below is either
operational or historical.

## Current — read these

| Doc | What it is |
|---|---|
| [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md) | Authoritative architecture, "as built, not as documented". Dated 2026-10-02. **Start here.** |
| [`../JEV_DECISION_MAP.md`](../JEV_DECISION_MAP.md) | Decision-system map (Jev): boundaries, policies, failure modes. Companion to the above. |
| [`STATUS.md`](STATUS.md) | Short pointer. Current state lives in `CURRENT_ARCHITECTURE.md`. |
| [`HANDOVER.md`](HANDOVER.md) | **Current work handover** (2026-10-04): what is done and verified, what remains, and how to run every suite. |
| [`LOCAL_E2E_ACCEPTANCE_REPORT.md`](LOCAL_E2E_ACCEPTANCE_REPORT.md) | Findings F1–F16 from the local acceptance run, plus the fix addendum. |
| [`LOCAL_VPS_DEPLOYMENT.md`](LOCAL_VPS_DEPLOYMENT.md) | Local / VPS deploy runbook. |
| [`DB_MIGRATION_WORKFLOW.md`](DB_MIGRATION_WORKFLOW.md) | Production-safe migration workflow. |
| [`DOGFOODING.md`](DOGFOODING.md) | Dogfooding guide. |
| [`DOGFOODING_REPORT_TEMPLATE.md`](DOGFOODING_REPORT_TEMPLATE.md) | Dogfooding report template. |
| [`channel-onboarding.md`](channel-onboarding.md) | Adding a distribution channel. |
| [`media-provider-onboarding.md`](media-provider-onboarding.md) | Adding a media provider. |
| [`X_API_COMPLIANCE_AND_RISK.md`](X_API_COMPLIANCE_AND_RISK.md) | X (Twitter) API compliance and risk notes. |
| [`ui-information-architecture.md`](ui-information-architecture.md) | UI information architecture. |
| [`spec_contentforge_reimagined.md`](spec_contentforge_reimagined.md) | Product spec (reimagined). |
| [`contentforge-design-direction.md`](contentforge-design-direction.md) | Design direction. |

## Historical — do NOT treat as current

Frozen artifacts. Each describes the repo at an earlier commit and may
contradict the code. Open only to answer "what did we do in phase N".

| Where | What |
|---|---|
| [`archive/status-phase-history.md`](archive/status-phase-history.md) | Full phase status log (28.2B → 31), newest-first. This is the old 87 KB `STATUS.md`. |
| [`archive/`](archive/) | Phase reports 29 → 34 (`phase-*.md`), plus superseded pre-June plans (`PLAN.md`, `HANDOFF.md`, `replit.md`, the `JEV-*.md` design set). |
| [`archive/audits/`](archive/audits/) | Phase-28/29 design and final-audit reports. |
| [`archive/phases-final/`](archive/phases-final/) | Final phase audit set. |
| [`architecture/`](architecture/) | Generated architecture artifacts (Archify). Partly superseded by `CURRENT_ARCHITECTURE.md`. |
| [`design-orchestration/`](design-orchestration/) | Multi-agent design run artifacts. HISTORICAL. |
| [`ux-audit/`](ux-audit/) | Per-page UX audit captures. HISTORICAL. |

## Not docs

- `../research/` — gathered source material and raw scrapes, not documentation.
- `../plans/` — earlier product and implementation plans.
- `../graphify-out/` — stale generated graph, gitignored. Ignore it; use graft
  (`make graph`, then `graft ask "<question>" --source`).
