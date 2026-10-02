# ContentForge — Insights / Performance Visibility + Learning Surface

> **Phase 28.2G — Insights / Performance Visibility + Learning Surface**  
> **Codename:** CLOSE THE FEEDBACK LOOP  
> **Status:** IMPLEMENTED  
> **Branch:** `replit` | **PR:** #3 (Open, Unmerged)

---

## 1. Executive Summary

Phase 28.2G transforms `/insights` from a placeholder canonical shell into an evidence-based performance and learning surface. It closes the visible feedback loop between content production, measurement, and learning:

```text
Research
   ↓
Create
   ↓
Publish
   ↓
Measure
   ↓
Understand
   ↓
Learn
   ↓
Better next creation
```

Insights answers two central questions with strict evidence discipline:
1. **Performance**: *"What happened?"* — real observed outcomes across channels without vanity metric inflation.
2. **Learning**: *"What should I understand from it?"* — evidence-grounded patterns across writing styles, workflow decisions, and channel metrics without overstating causality.

---

## 2. Critical Boundaries & Scope Discipline

### What This Phase Is
- A **visibility and learning surface** that reflects real available data in PostgreSQL and existing learning tables.
- Truthful metrics with explicit time scopes and measurement coverage.
- Canonical cross-links back into the creation lifecycle (`Create`, `Sources`, `Agent`, `Today`).

### What This Phase Is NOT (Deferred to Phase 29)
- **NO new analytics database / BI warehouse**: uses existing PostgreSQL storage and schema.
- **NO autonomous generation optimization**: does not mutate `GenerationPolicy`, `StyleProfile`, or `ContextAssembly` automatically.
- **NO automatic content publishing**: does not auto-schedule posts based on engagement heuristics.
- **NO fabricated recommendations**: does not use generic LLM filler when real performance data is insufficient.
- **NO coerced zeros**: if a metric was `not_available` on a channel, it is rendered as unmeasured (`—`), never as `0`.

---

## 3. Metric Source Matrix

Every visible metric maps directly to an audited backend source:

| Metric | Actual Backend Source | Exists | Time Scope | Owner Scoped | Freshness |
|---|---|---|---|---|---|
| **Total Posts** | `GET /api/analytics/summary` | Yes | All-time | Yes | Synced from published posts |
| **Impressions** | `GET /api/analytics/summary` | Yes | All-time | Yes | Real platform impressions |
| **Likes / Replies / Reposts** | `GET /api/analytics/summary` | Yes | All-time | Yes | Real platform counts |
| **Pillar & Platform Breakdowns** | `GET /api/analytics/summary` | Yes | All-time | Yes | Aggregated from post analytics |
| **Top Performing Content** | `GET /api/analytics/insights` | Yes | All-time | Yes | Ranked by engagement score |
| **Best Time to Post** | `GET /api/analytics/insights` | Yes | All-time | Yes | Hour-by-hour UTC distribution |
| **Published Items Count** | `GET /api/learning/summary` | Yes | All-time | Yes | Exact count of publication rows |
| **Draft Approval Rate** | `GET /api/learning/summary` | Yes | All-time | Yes | Calculated from approval/rejection signals |
| **Delivery Success Rate** | `GET /api/learning/summary` | Yes | All-time | Yes | Ratio of published vs failed publications |
| **Format Distribution** | `GET /api/learning/summary` | Yes | All-time | Yes | Aggregated by opportunity format |
| **Platform Metric Totals** | `GET /api/learning/summary` (`metricTotals`) | Yes | All-time | Yes | Sum of observed signals with coverage denominator |
| **Writing Style Profiles** | `GET /api/style/profiles` | Yes | Dynamic | Yes | Derived from analyzed references |
| **AI Token Usage & Spend** | `GET /api/ai-usage/dashboard?days=...` | Yes | 7d, 30d, 90d | Yes | Logged per LLM generation call |
| **Cross-ResearchJob Topics** | N/A | No | N/A | N/A | Architecturally ready / not yet available |

---

## 4. Information Architecture

Insights is organized into three distinct views inside the canonical destination (`/insights`):

```text
Insights
├── [Performance]  (?view=performance) — Measured content outcomes & platform stats
├── [Learning]     (?view=learning)    — Style intelligence, workflow signals, platform metrics
└── [AI Usage]     (?view=ai-usage)    — Token consumption, model usage, estimated spend
```

### Compatibility Routes
- `/analytics` continues to function standalone, rendering the Performance view.
- `/ai-usage` continues to function standalone, rendering the AI Usage dashboard.

---

## 5. View Specifications

### A. Performance View
- **KPI Grid**: Displays Total Posts, Impressions, Likes, and Replies with explicit subtitle context.
- **Time Scope Label**: Prominently notes `Scope: All time (lifetime of published content)` to prevent misleading interpretations.
- **Workflow Strip**: Highlights Total Published Items, Draft Approval Rate, and Delivery Success Rate.
- **Top Content Drilldown**: Lists top-scoring posts with a direct `[ View content ]` button (`data-testid="button-view-content-<id>"`) linking to canonical content.
- **Honest Empty State**: If no posts have been published, displays `EmptyState` (`data-testid="empty-performance-state"`) with a direct `[ Create Content ]` action.
- **Resilient Error Handling**: On query 500, renders `ErrorState` with a working `[ Retry ]` button.

### B. Learning View
- **Writing Style Patterns**: Surfaces active style profiles with humanized confidence badges:
  - `Strong signal` (>=75% / high)
  - `Emerging pattern` (>=40% / medium)
  - `Limited evidence` (<40% / low)
  - `Insufficient data` (no score)
  - Provenance text: `Observed in N analyzed references`.
  - 503 resilience: If style intelligence is unconfigured, displays an honest notice without crashing.
- **Workflow & Approval Signals**: Displays real-time draft approval rate, publication delivery success rate, and format distribution.
- **Channel Performance Signals**:
  - Aggregates platform signals (`metricTotals`) by metric.
  - Distinctly surfaces `Observed on N items` and `N unavailable on channel`.
  - Never coerces `not_available` into zero.
- **Section Independence**: Style, Workflow, and Signal queries run independently. If one endpoint fails or is unconfigured, the remaining sections render cleanly.

### C. AI Usage View
- Visualizes daily token volume and cost trends across supported timeframes (7, 30, 90 days).
- Model-level and feature-level consumption breakdowns.
- Fixed error handling: Replaces previously unhandled error states with `ErrorState` and retry.

---

## 6. Observational vs. Causal Language Rules

To maintain high user trust and scientific discipline:
- **Rule 1**: Use "Observed in available dataset" rather than "ContentForge knows" or "Your audience prefers".
- **Rule 2**: Never imply causality. For example, "Technical posts received higher reach in the available data" is acceptable; "Technical posts cause higher reach" is forbidden.
- **Rule 3**: Expose measurement denominators (e.g. `Measured on 12 publications, unavailable on 2`) so users understand coverage.

---

## 7. Canonical Product Handoffs

| Trigger | UI Element | Destination | Context Passed |
|---|---|---|---|
| Content row | `[ View content ]` | `/today` or `/create` | Artifact / post context |
| Style observation | `[ Analyze References ]` | `/sources` | Navigates to references |
| Observed opportunity | `[ Explore Topics ]` | `/sources` | Topic research query |
| Format pattern | `[ Open Studio ]` | `/create` | Create Studio entry |
| Pattern investigation | `[ Consult Agent ]` | `/agent` | Structured prompt in URL |

---

## 8. Responsive & Mobile Strategy

Tested and validated across canonical breakpoints:
- **Desktop (1440×900)**: Multi-column grids for KPIs, dual-column learning layout, responsive recharts.
- **Tablet (820×1180)**: Fluid responsive containers, accessible tab triggers.
- **Mobile (390×844)**:
  - Single vertical scroll flow without trapped nested scrollbars.
  - Tables wrap in responsive horizontal scrollers without page-level overflow (`document.body.scrollWidth === window.innerWidth`).
  - Touch targets meet or exceed 44×44px.

---

## 9. Test & Verification Summary

- **Unit Tests**: 15 / 15 passed in `client/src/lib/insights-state.test.ts`.
- **Database Tests**: 11 / 11 passed in `server/content/learning.dbtest.ts` (with `metricTotals` and owner isolation).
- **Playwright E2E**: 11 / 11 passed in `e2e/insights.e2e.spec.ts`.
- **Accessibility**: 0 Axe violations across Desktop, Tablet, and Mobile viewports.
