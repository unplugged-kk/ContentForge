# ContentForge — Agent Workspace Responsive Redesign (Phase 28.2D)

## Overview & Core Principles

**Codename:** THE AGENT IS THE ORCHESTRATOR, NOT THE PRODUCT

Phase 28.2D redesigns `/agent` from a technically capable but cluttered subsystem interface into a focused, responsive **orchestration workspace**.

```text
Understand task
       ↓
Research / create / transform
       ↓
Show progress (stepper timeline)
       ↓
Present result (artifacts & domain entities)
       ↓
Request human approval when required
       ↓
Hand off to Create / Review / Schedule / Publish
```

### Key Principles

1. **The Agent is an Orchestrator, Not a Chatbot**:
   - ContentForge does not reduce agent interactions to conversational chat banter.
   - The workspace presents clear, controllable artifacts: what the user asked, what the agent is currently doing, what has completed, what failed, what was created, what needs human approval, and what happens next.

2. **Canonical Handoffs**:
   - The primary action on any generated artifact in the Agent Workspace is **`[ Review ]`** (`data-testid="button-artifact-review"`), linking directly to canonical `/create?artifact=<id>`.
   - The Agent Workspace does not attempt to be a duplicate content editor or publishing engine; it coordinates work and hands off cleanly to canonical Studio, Review, Schedule (`/schedule`), and Publish dialogs.

3. **Truthful Status Resolution**:
   - Status calculation (`client/src/lib/agent-workspace-state.ts`) is strictly truthful.
   - If a tool call failed (e.g. rate limit, conflict, network drop), the run is labeled `Completed with warnings` (`completed_with_errors`), never a deceptive green `Completed`.
   - Human approval pauses are distinctly badged as `Waiting for approval` with an explicit callout.

4. **Single Vertical Scroll on Mobile (`390 × 844`)**:
   - No nested scrolling panes or trapped inner scroll containers.
   - The mobile experience flows top-to-bottom:
     `PageHeader → Objective Composer → Active Run Status → Stepper Timeline → Human Approval Callout (if needed) → Generated Artifacts → Repurpose Progress → Diagnostics Drawer`.
   - Run history moves into an accessible mobile Sheet (`button-open-mobile-history`).

5. **Durable URL State**:
   - Navigating to `/agent?runId=<id>` or reloading the page automatically restores and hydrates the run from the backend and event logs.

---

## Architecture & Layout Breakdown

### 1. Canonical Page Header (`PageHeader`)
- Uses shared `PageHeader` (`@/components/ui-shared/page-header`) with `title="Agent"` and `titleTestId="text-agent-workspace-title"`.
- Actions:
  - Backend Selector (`data-testid="select-agent-backend"` inside `data-testid="panel-agent-backends"`).
  - Technical Diagnostics Sheet trigger (`data-testid="button-open-diagnostics"`).
  - Mobile Run History Sheet trigger (`data-testid="button-open-mobile-history"`).

### 2. Task Composer
- Accessible `<label htmlFor="agent-composer">` and textarea (`data-testid="textarea-agent-composer"`).
- Starter prompt pills:
  - "Research & Draft X Post"
  - "Repurpose Top Story"
  - "Synthesize Trends"
- Execution actions: `Start run` (`data-testid="button-agent-start"`) and `Retry continue` (`data-testid="button-agent-retry"`).

### 3. Stepper Timeline & Activity Feed (`data-testid="panel-agent-activity"`)
- Formats step names using `humanizeToolName()`.
- Renders individual `ToolCallCard` components with live statuses (`running`, `completed`, `failed`, `denied`).
- Displays truthful status badge (`data-testid="badge-run-status"`).
- Surfaces typed agent errors (`data-testid="text-agent-error"`) with safe retry buttons (`data-testid="button-error-retry"`).
- Embeds a collapsible raw event stream log for deep debugging without visual clutter.

### 4. Human Approval Callout (`data-testid="panel-auth-callout"`)
- Triggers when privileged tools (such as live publishing) require explicit user consent.
- Highlights what action is waiting with `data-testid="text-auth-required"`.
- Action buttons: `[ Approve & continue ]` (`data-testid="button-run-approve"`) and `[ Dismiss ]` (`data-testid="button-run-dismiss"`).

### 5. Generated Artifacts & Review
- If an artifact is produced, renders `ArtifactReviewCard` with:
  - Primary **`[ Review in Studio ]`** button (`data-testid="button-artifact-review"`) linking to `/create?artifact=<id>`.
  - In-place quick edit revision (`data-testid="button-artifact-edit"`).
  - Approval gating: `[ Approve ]` (`data-testid="button-artifact-approve"`).
  - Distribution handoff: `[ Schedule ]` (`data-testid="button-artifact-schedule"`) and `[ Publish Now ]` (`data-testid="button-artifact-publish"`).
- Displays linked Story (`StoryCard`), Opportunities (`OpportunityCard`), Visuals, Videos, and Audio assets.

### 6. Technical Diagnostics Drawer (`data-testid="drawer-technical-details"`)
- Technical panels (`ResearchPanel`, `VideoPanel`, `AudioPanel`, `StyleIntelligencePanel`, and `RepurposePanel`) are moved out of the primary view into an on-demand sheet.
- When an active repurposing plan is executing, progress is also surfaced conditionally in the main stream to maintain visibility.

### 7. Desktop Sidebar
- Visible on viewports `>= 1024px`.
- Capabilities summary (`data-testid="panel-agent-capabilities"`).
- Run history list (`data-testid="list-agent-runs"`):
  - Displays `AgentRunCard` items with active selection indicator.
  - Shows retryable `ErrorState` on network or server 500 failures.

---

## Test & Verification Matrix

| Suite | Tests | Result | Coverage |
|---|---|---|---|
| `e2e/agent-workspace.e2e.spec.ts` | 9 | Passed | Journeys A–H (Task lifecycle, Review link, Approval resume, Publish handoff, Truthful tool failure status, Refresh durability, Mobile layout, Axe accessibility) |
| `e2e/agent-publish.e2e.spec.ts` | 1 | Passed | Approve/Publish separation, Schedule date+time, PublishPreview dialog, zero 403s |
| `e2e/error-states.e2e.spec.ts` | 9 | Passed | Run history 500 error state with working retry |
| `e2e/canonical-ia.e2e.spec.ts` | 12 | Passed | Canonical navigation, root redirect, 404 recovery |
| `e2e/routes.e2e.spec.ts` | 28 | Passed | All canonical and legacy routes render cleanly |
| `e2e/create-workflow.e2e.spec.ts` | 11 | Passed | Phase 28.2C regression verification |
| `e2e/accessibility.e2e.spec.ts` | 13 | Passed | Document titles, meta-viewport, button labels, landmarks |
| `client/src/lib/agent-workspace-state.test.ts` | 13 | Passed | Domain state helpers unit tests |
| Full unit test suite (`npm run test:unit`) | 606 | Passed | 0 failures across 151 suites |
| TypeScript check (`npm run check`) | 1 | Passed | 0 errors |
| Production build (`npm run build`) | 1 | Passed | Clean client and server bundles |
