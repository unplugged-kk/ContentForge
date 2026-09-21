# ContentForge UI Information Architecture

**Phase:** 28.2B — Canonical Information Architecture + Product Shell  
**Codename:** ONE PRODUCT, NOT 21 TOOLS  
**Baseline commit:** `ff076bd`  
**Status:** IMPLEMENTED  

---

## 1. Executive Summary & Philosophy

ContentForge transitions from a fragmented set of 21 disparate sidebar destinations into a coherent **Content Operating System**.

The backend and content lifecycle remains the durable source of truth:
```text
ResearchJob → Story → Opportunity → GenerationJob → Artifact → approval → Schedule → Occurrence → Publication → Result
```

The user-facing mental model collapses this complex machinery into a clean, human daily ritual:
```text
Research (Sources)
      ↓
Create (Create / Agent)
      ↓
Review (Approval)
      ↓
Schedule (Schedule)
      ↓
Publish (Automatic / Guarded)
      ↓
Learn (Insights)
```

The guiding principle of Phase 28.2B is:
> **Navigation is consolidated before implementation is consolidated.**

No legacy feature has been deleted or broken. Rather, the application shell and route ownership are organized around **seven canonical product destinations**, while legacy URLs remain fully backward-compatible as modes and subviews.

---

## 2. Canonical Product Navigation

The primary navigation contains **exactly seven** top-level destinations:

| Destination | Canonical Route | Icon | Purpose | Owned Sub-modes & Views |
|---|---|---|---|---|
| **Today** | `/today` | `CalendarCheck` | What needs my attention right now? Home & briefing surface. | Attention queue, quick launchpad, morning briefing (Phase 28.2F). |
| **Create** | `/create` | `Sparkles` | Create content from a story, source, or direct idea. | Post & Thread, Hooks, Carousel, Images, Articles, Templates, Formatter, Canned Responses, Chat → Post. |
| **Sources** | `/sources` | `Database` | Discover, capture, organize, and research source material. | Discover, Ideas Bank, Ingest, Context Vault, References, YouTube Ingest, Quick Capture. |
| **Agent** | `/agent` | `Bot` | Autonomous agent workspace for research and content generation. | Agent runs, approvals, artifact review, run history. |
| **Schedule** | `/schedule` | `Calendar` | Plan, queue, and monitor scheduled publications and calendar. | Today's Queue, Content Calendar, scheduled posts, Best Times. |
| **Insights** | `/insights` | `BarChart3` | Understand performance, content signals, and AI usage. | Performance Analytics, AI Usage & Cost, learning signals. |
| **Settings** | `/settings` | `Settings` | Configure accounts, AI providers, brand profiles, and pillars. | Connected Accounts, AI Provider, Content Pillars, Brand Profile. |

---

## 3. Legacy Route Policy & Compatibility Matrix

Every pre-existing client route is classified according to the legacy route policy:
- **CANONICAL**: Primary top-level product destination.
- **MODE**: Specialized generation workflow grouped under Create.
- **SUBVIEW**: Dedicated view grouped under Sources, Schedule, or Insights.
- **COMPATIBILITY**: Preserved endpoint ensuring zero broken links, bookmarks, or tests.
- **DEPRECATED**: None in this phase (no functionality deleted).

| Legacy Route | New Canonical Owner | Classification | Behavior & Compatibility Handling |
|---|---|---|---|
| `/` | Today | Redirect | Automatically redirects to `/today` (renders canonical Today shell). |
| `/generate` | Create | Compatibility / Mode | Renders Post & Thread generator; activates `Create` in sidebar. |
| `/formatter` | Create | Compatibility / Mode | Renders Post Formatter; activates `Create` in sidebar. |
| `/hooks` | Create | Compatibility / Mode | Renders Hook Generator; activates `Create` in sidebar. |
| `/carousel` | Create | Compatibility / Mode | Renders Carousel Builder; activates `Create` in sidebar. |
| `/images` | Create | Compatibility / Mode | Renders AI Image Generation; activates `Create` in sidebar. |
| `/articles` | Create | Compatibility / Mode | Renders X Articles Editor; activates `Create` in sidebar. |
| `/templates` | Create | Compatibility / Mode | Renders Template Library; activates `Create` in sidebar. |
| `/canned-responses` | Create | Compatibility / Mode | Renders Canned Responses; activates `Create` in sidebar. |
| `/chat` | Create | Compatibility / Mode | Renders Chat → Post; activates `Create` in sidebar. |
| `/ingest` | Sources | Compatibility / Subview | Renders Ingestion workspace; activates `Sources` in sidebar. |
| `/discover` | Sources | Compatibility / Subview | Renders Idea Discovery; activates `Sources` in sidebar. |
| `/ideas` | Sources | Compatibility / Subview | Renders Ideas Bank; activates `Sources` in sidebar. |
| `/vault` | Sources | Compatibility / Subview | Renders Context Vault; activates `Sources` in sidebar. |
| `/references` | Sources | Compatibility / Subview | Renders References & Source Analysis; activates `Sources` in sidebar. |
| `/youtube` | Sources | Compatibility / Subview | Renders YouTube Ingest; activates `Sources` in sidebar. |
| `/queue` | Schedule | Compatibility / Subview | Renders Today's Queue; activates `Schedule` in sidebar. |
| `/calendar` | Schedule | Compatibility / Subview | Renders Content Calendar; activates `Schedule` in sidebar. |
| `/analytics` | Insights | Compatibility / Subview | Renders Analytics Dashboard; activates `Insights` in sidebar. |
| `/ai-usage` | Insights | Compatibility / Subview | Renders AI Usage & Spend; activates `Insights` in sidebar. |

---

## 4. Product Ownership Hierarchy

```text
TODAY (/today)
├── Attention Queue (live from /api/posts/queue/today)
├── Quick Actions Launchpad (Create, Schedule, Sources, Agent)
└── [Phase 28.2F] Morning Briefing & Proactive Attention Feed

CREATE (/create)
├── [Default Mode] Post & Thread Generation (/generate)
├── Hook Generator (/hooks)
├── Carousel Builder (/carousel)
├── AI Image Generation (/images)
├── X Articles (/articles)
├── Template Library (/templates)
├── Post Formatter (/formatter)
├── Canned Responses (/canned-responses)
└── Chat → Post (/chat)

SOURCES (/sources)
├── Global Quick Capture (Action / Modal)
├── Idea Discovery (/discover)
├── Ideas Bank (/ideas)
├── Content Ingest (/ingest)
├── Context Vault (/vault)
├── References & Analysis (/references)
└── YouTube Ingestion (/youtube)

AGENT (/agent)
├── Interactive Workspace & Composer
├── Run History & Execution Trace
├── Artifact Review & Approval Guardrails
└── Audio / Video / Style / Repurpose Panels

SCHEDULE (/schedule)
├── Queue View (/queue)
├── Calendar View (/calendar)
├── Best Time Recommendations
└── Publishing & Compliance Alerts

INSIGHTS (/insights)
├── Content Performance Analytics (/analytics)
├── AI Usage & Token Spend (/ai-usage)
└── [Phase 29] Automated Learning Signals

SETTINGS (/settings)
├── Connected Social Accounts
├── AI Provider Configuration
├── Content Pillars & Topics
└── Brand Profile & Voice
```

---

## 5. User Language vs. Backend Vocabulary

To reduce cognitive friction and align with operator mental models, internal engine terms are translated into natural product concepts in the user interface:

| Backend Concept | Internal Vocabulary | User-Facing Label | UI Context |
|---|---|---|---|
| `ResearchJob` | `ResearchJob`, `jobId` | Research / Source | Sources & Agent |
| `Story` | `Story`, `storyId` | Story / Angle | Sources & Ideas |
| `Opportunity` | `Opportunity` | Idea / Trend | Discover & Sources |
| `GenerationJob` | `GenerationJob` | Generation / Draft | Create & Queue |
| `Artifact` | `Artifact`, `revision` | Content / Version | Agent & Review |
| `Occurrence` | `Occurrence` | Scheduled Post | Schedule & Calendar |
| `Publication` | `Publication`, `pubId` | Publication | Queue & Today |
| `Result` | `Result`, `published` | Live Post | Analytics & History |

Backend contracts, database tables, and API schemas remain unmodified.

---

## 6. Shared UX Foundation & Component Architecture

Phase 28.2B reuses and completes the shared design primitives in `client/src/components/ui-shared/`:

| Component | File | Role & Features |
|---|---|---|
| `PageHeader` | `client/src/components/ui-shared/page-header.tsx` | Standardized canonical header with product title, description, sticky backdrop, and actions slot. |
| `EmptyState` | `client/src/components/ui-shared/empty-state.tsx` | Truthful empty container with Lucide icon, message, and call-to-action. |
| `ErrorState` | `client/src/components/ui-shared/error-state.tsx` | Error container with retry mutation button for network boundaries. |
| `StatusBadge` | `client/src/components/ui-shared/status-badge.tsx` | Unified status pill for publication and agent run lifecycle states. |
| `ConfirmDialog` | `client/src/components/ui-shared/confirm-dialog.tsx` | Accessible confirmation gate for destructive operations. |
| `SchedulePicker` | `client/src/components/ui-shared/schedule-picker.tsx` | Native date + time selector for post scheduling. |
| `PublishPreview` | `client/src/components/ui-shared/publish-preview.tsx` | WYSIWYG target preview and account confirmation before publication. |

---

## 7. UX Decision Records (ADRs)

### Decision 1: Canonical 7-Destination Architecture
The primary navigation of ContentForge is strictly organized around seven top-level destinations: `Today`, `Create`, `Sources`, `Agent`, `Schedule`, `Insights`, and `Settings`. No generator, tool, or raw view may be placed in the primary sidebar.

### Decision 2: Artifact Lifecycle as Source of Truth
The canonical pipeline (`ResearchJob → Story → Opportunity → GenerationJob → Artifact → Schedule → Publication`) remains the architectural source of truth. UI simplifications present this loop intuitively without fracturing backend guarantees.

### Decision 3: Backward-Compatible Legacy Route Policy
Every pre-existing URL remains active and functional. Bookmarks, external links, and automated tests are never broken. Navigation is consolidated before implementation is consolidated.

### Decision 4: Specialized Generators as Create Modes
Standalone generators (Hooks, Carousel, Images, Articles, Formatter, Templates, Canned Responses) are sub-modes of Create rather than independent top-level products.

### Decision 5: Queue and Calendar Unified under Schedule
Today's Queue and Content Calendar are complementary views of the same temporal scheduling domain, consolidated under `/schedule`.

### Decision 6: Analytics and AI Spend Unified under Insights
Performance analytics and operational AI usage/costs are consolidated under `/insights`.

### Decision 7: Multi-source Ingestion Unified under Sources
Discover, Ideas Bank, Ingest, Context Vault, References, and YouTube Ingestion are consolidated under `/sources`, with Quick Capture serving as a global entry point.

---

## 8. Deferred UX Slices

In accordance with the phased UX roadmap:
- **Phase 28.2C**: Create + Review workflow redesign (unified composer, direct schedule pipeline).
- **Phase 28.2D**: Agent Workspace full responsive re-layout and tool execution cards.
- **Phase 28.2E**: Sources / Research unified repository and deduplication.
- **Phase 28.2F**: Today morning briefing, proactive attention signals, and calendar drag-drop.
- **Phase 28.2G**: Insights learning signals and voice calibration.
- **Phase 28.2H**: Comprehensive mobile polish and final WCAG audit.
- **TikTok & New Media Providers**: Deferred to post-28.2 phases.
