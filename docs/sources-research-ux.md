# ContentForge — Sources & Research UX Specification

> **Phase 28.2E — Sources / Research UX**  
> **Codename:** FROM INFORMATION TO CONTENT  
> **Status:** IMPLEMENTED  
> **Branch:** `replit` | **PR:** #3 (Open, Unmerged)

---

## 1. Executive Summary

Phase 28.2E transforms `/sources` from a placeholder canonical shell into a coherent, production-grade research and knowledge workspace. It bridges the gap between raw intelligence gathering and content creation, allowing users to discover information, evaluate evidence, save references, synthesize Stories, and create publishable content without needing to understand backend data models.

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Discover   │ ──> │  Investigate │ ──> │ Save/Capture │ ──> │ Create Story │ ──> │Create Content│
│ (Topic/URL)  │     │  (Evidence)  │     │   (Saved)    │     │(Provenance)  │     │  (/create)   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

---

## 2. Information Architecture

The Sources workspace is structured around three primary views accessible via the view selector (`data-testid="nav-sources-views"`):

| View | Purpose | Data Source | Primary Actions |
|---|---|---|---|
| **Discover** | Topic-based and directed URL research, evidence synthesis, quality ratings | `POST /api/research/jobs`, `GET /api/research/jobs/:id` | Run Research, View Details, Save, Create Story, Create Content |
| **Saved** | Consolidated knowledge base of saved excerpts, ideas, and references | `GET /api/vault`, `GET /api/ideas`, `GET /api/references` | Filter (`All`, `References`, `Ideas`, `Vault`), Delete, Create Story, Create Content |
| **Research** | Chronological audit log of research jobs, execution time, and provider diagnostics | `GET /api/research/jobs` | Run Again, View Results, Inspect Status |

### Backward Compatibility
Legacy routes and conceptual tabs are seamlessly preserved:
- `/discover` redirects or anchors to `/sources?tab=discover`
- `/ideas` links to `/sources?tab=saved&subtab=ideas` (with legacy selector `text-ideas-title`)
- `/vault` links to `/sources?tab=saved&subtab=vault` (with legacy selector `text-vault-title`)
- `/references` links to `/sources?tab=saved&subtab=references`
- `/ingest` routes to `/sources?tab=saved&action=quick-capture`
- Top-level button `data-testid="button-sources-quick-capture"` opens a quick capture modal for manual knowledge base entries.

---

## 3. Plain-Language Domain Model

Internal engineering structures are translated into intuitive, user-facing terminology:

| Internal Structure | User-Facing Concept | Description |
|---|---|---|
| `ResearchJob` | **Research** | A specific inquiry into a topic or URL with configured time window and depth. |
| `NormalizedSource` | **Source** | An article, video, discussion thread, or document discovered during research. |
| `Evidence` | **Evidence Claim** | A key fact, data point, or quote extracted from a source with corroboration tracking. |
| `ResearchAnalysis` | **Finding / Angle** | Synthesized insights, patterns, and editorial angles generated from discovered sources. |
| `Story` | **Story** | A structured editorial narrative with background, angles, and provenance. |
| `Opportunity` | **Opportunity** | A timely content idea or hook ready for generation. |

---

## 4. Credibility, Quality & Evidence Evaluation

ContentForge evaluates sources across multiple dimensions to help creators separate signal from noise:

### Credibility Ratings
- **High Confidence**: Multiple corroborating sources, established institutional provenance (`badge: High Confidence`, emerald).
- **Established**: Recognized authority or reputable publisher (`badge: Established`, blue).
- **Needs Verification**: Single source or preliminary finding (`badge: Needs Verification`, amber).
- **Conflicting**: Divergent claims or contested findings across sources (`badge: Conflicting Evidence`, rose).
- **Unknown**: Provider data without sufficient reputation score (`badge: Unverified`, slate).

### Quality & Novelty Scores
- **Quality Score**: Normalized (0–100%) mapped to descriptive tags: "High Quality" (>=80%), "Moderate Quality" (>=50%), or "Preliminary" (<50%).
- **Novelty Score**: Normalized (0–100%) mapped to "Fresh Angle" (>=75%), "Emerging Trend" (>=50%), or "Standard Context" (<50%).

### Conflicting Evidence Callouts
When conflicting viewpoints are detected in research analysis, a warning callout is rendered immediately at the top of the findings:
```text
⚠️ Conflicting Evidence Detected
Multiple sources disagree on key metrics or interpretations. Review evidence claims before publishing.
```

---

## 5. Bridges: From Research to Content

### Bridge A: Research / Source → Create Story
- **Action**: Clicking `Create Story` opens the `CreateStoryDialog` (`data-testid="dialog-create-story"`).
- **Endpoint**: `POST /api/stories`
- **Payload**:
  ```json
  {
    "title": "Cloud Native Platform Trends 2026",
    "body": "Synthesized overview from CNCF survey...",
    "angles": ["Wasm in production", "Edge computing"],
    "researchJobId": 42,
    "provenance": "researched"
  }
  ```
- **Provenance**: Retains `researchJobId` and links all source evidence IDs, ensuring auditability from content back to original sources.

### Bridge B: Source / Story → Create Content
- **Action**: Clicking `Create Content` navigates directly to the Create workflow:
  - From Story: `/create?storyId=42`
  - From Source: `/create?sourceId=12`
  - From Idea: `/create?ideaId=7`
- **Experience**: `/create` automatically pre-fills the topic, audience, and source material, ready for generation.

---

## 6. Truthful Status & Degraded State Handling

ContentForge never presents misleading states or leaks backend implementation details:

### Degraded State Handling
- When providers encounter rate limits or missing credentials, research completes partially.
- **Truthful Status**: Displays `Completed with limited sources` with an amber warning badge (`data-testid="badge-degraded-research"`).
- **User Explanation**: An informative alert explains that research succeeded with available open providers while some sources were restricted.

### Zero Raw Environment Leaks
- Internal flag names such as `LAST30DAYS_ENABLED`, `REDDIT_CLIENT_ID`, `YOUTUBE_API_KEY` are **never** rendered to users.
- Instead, user-friendly notices are displayed:
  - "Reddit social discussions are currently unconfigured in this environment."
  - "YouTube video transcripts are currently unavailable."
  - "Real-time web search is operating in cached mode."

---

## 7. Responsive & Mobile Strategy

Tested across three canonical viewports:
- **Desktop (1440×900)**: Multi-column layouts, sticky controls, side-by-side evidence inspection.
- **Tablet (820×1180)**: Fluid 2-column grid, responsive cards, touch-optimized dialogs.
- **Mobile (390×844)**:
  - Single vertical scroll without trapped nested scrollbars.
  - Sticky query input and action bar.
  - No horizontal overflow (`overflow-x: hidden`).
  - Touch targets meet or exceed 44×44px minimum sizing.
  - Dialogs adapt to full-width bottom sheets.

---

## 8. Accessibility & Quality Verification

- **Axe Core**: 0 violations across Desktop, Tablet, and Mobile viewports.
- **ARIA**: Accessible dialog titles, descriptions, status badges, and tab roles.
- **Keyboard Navigation**: Full tab order and Escape key dismissal for all modals.
- **Automated Tests**:
  - 13 pure domain unit tests (`client/src/lib/sources-research-state.test.ts`).
  - 11 comprehensive Playwright E2E tests (`e2e/sources-workflow.e2e.spec.ts`).
  - 619 unit tests passing.
  - 92 Playwright E2E tests passing across all suites.
