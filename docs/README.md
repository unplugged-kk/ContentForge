# ContentForge docs — index

Updated 2026-11-28. **This file is the map. Read [`STATUS.md`](STATUS.md) and [`ACTIVE_WORK.md`](ACTIVE_WORK.md) before any other doc.**

The source of truth for behavior is the code. The source of truth for "what are we doing now" is [`STATUS.md`](STATUS.md) and [`ACTIVE_WORK.md`](ACTIVE_WORK.md). For architecture, read [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md), then [`../JEV_DECISION_MAP.md`](../JEV_DECISION_MAP.md).

Names from a generic template that already have a home here:

| Asked name | Actual file |
|---|---|
| PROJECT | [`PROJECT.md`](PROJECT.md) |
| STATUS | [`STATUS.md`](STATUS.md) |
| ACTIVE_WORK | [`ACTIVE_WORK.md`](ACTIVE_WORK.md) |
| HANDOVER | [`HANDOVER.md`](HANDOVER.md). The 2026-11-11 text is [`archive/HANDOVER-2026-11-11.md`](archive/HANDOVER-2026-11-11.md). |
| ARCHITECTURE | [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md). There is no second architecture file. |
| MENTAL-MODEL | [`MENTAL-MODEL.md`](MENTAL-MODEL.md) |
| FLOW | [`FLOW.md`](FLOW.md) |
| CAPABILITIES | [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md), last full pass 2026-11-11 |
| ROADMAP | [`product-discovery/EXECUTION_ROADMAP.md`](product-discovery/EXECUTION_ROADMAP.md) for the productization waves. [`ROADMAP.md`](ROADMAP.md) is the 2026-11-11 ordered list. P0-1 and P0-2 there have since landed. |
| BACKLOG | [`product-discovery/BACKLOG.md`](product-discovery/BACKLOG.md) |
| DECISIONS | [`product-discovery/DECISIONS.md`](product-discovery/DECISIONS.md) |
| AGENT_PROTOCOL | [`product-discovery/AGENT_COLLABORATION.md`](product-discovery/AGENT_COLLABORATION.md) |
| ENVIRONMENT | [`ENVIRONMENT.md`](ENVIRONMENT.md) and [`product-discovery/ENVIRONMENT_INVENTORY.md`](product-discovery/ENVIRONMENT_INVENTORY.md) |
| CONSTRAINTS, DEPENDENCIES, CHECKLIST, ROLLBACK, BUGS, CHANGELOG | The matching file in this directory. |

## Current — read these

| Doc | What it is |
|---|---|
| [`STATUS.md`](STATUS.md) | Verified snapshot. Start here for current truth. |
| [`ACTIVE_WORK.md`](ACTIVE_WORK.md) | Work register. One row per initiative. |
| [`PROJECT.md`](PROJECT.md) | What the product is, and what it is not. |
| [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md) | Authoritative architecture, "as built, not as documented". Dated 2026-10-02, with a 2026-11-11 verification note. |
| [`../JEV_DECISION_MAP.md`](../JEV_DECISION_MAP.md) | Decision-system map (Jev): boundaries, policies, failure modes. Companion to the above. |
| [`HANDOVER.md`](HANDOVER.md) | Current handover (2026-11-28). |
| [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) | Every capability with its status and evidence, plus the verification table for this pass. |
| [`ROADMAP.md`](ROADMAP.md) | 2026-11-11 ordered list. The banner names what has since landed. |
| [`LOCAL_E2E_ACCEPTANCE_REPORT.md`](LOCAL_E2E_ACCEPTANCE_REPORT.md) | Findings F1–F16 from the local acceptance run, plus the fix addendum. |
| [`LOCAL_VPS_DEPLOYMENT.md`](LOCAL_VPS_DEPLOYMENT.md) | Local / VPS deploy runbook. |
| [`DB_MIGRATION_WORKFLOW.md`](DB_MIGRATION_WORKFLOW.md) | Production-safe migration workflow. |
| [`AUTH0.md`](AUTH0.md) | Sign-in through Auth0: architecture, dashboard setup, account linking, logout, rollback. |
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
| [`archive/HANDOVER-2026-11-11.md`](archive/HANDOVER-2026-11-11.md) | Handover written 2026-11-11 against `feat/auth0-migration`. |
| [`product-discovery/PRODUCT_CURRENT_STATE.md`](product-discovery/PRODUCT_CURRENT_STATE.md) | Baseline audit of `origin/main` at `0dca955`, before pull request 7. |
| [`archive/status-phase-history.md`](archive/status-phase-history.md) | Full phase status log (28.2B → 31), newest-first. This is the old 87 KB `STATUS.md`. |
| [`archive/`](archive/) | Phase reports 29 → 34 (`phase-*.md`), plus superseded pre-June plans (`PLAN.md`, `HANDOFF.md`, `replit.md`, the `JEV-*.md` design set). |
| [`archive/ux-intelligence-2026-09/`](archive/ux-intelligence-2026-09/) | ContentForge UX discovery package (2026-09): findings, IA, journeys, feature matrix, "don't build" list. Evidence for UX work, **not** a current roadmap. |
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
