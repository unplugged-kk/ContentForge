# ContentForge — Create + Review Workflow Architecture (Phase 28.2C)

## Overview

Phase 28.2C establishes a unified, coherent content production experience across ContentForge. It transforms `/create` from a disconnected set of independent generators into a continuous pipeline:

```text
Source / Story / Idea / Blank
        ↓
   Create Studio
        ↓
     Generate
        ↓
Artifact Review View
        ↓
     Approve
        ↓
Schedule / Publish
```

---

## 1. Domain & Lifecycle Alignment

The implementation strictly preserves the locked backend lifecycle:
`ResearchJob → Story → Opportunity → GenerationJob → Artifact → approval → Schedule → Occurrence → Publication → Result`

### Key Properties

1. **Human Stories & Provenance**:
   - `server/story/routes.ts` accepts human-authored stories (`provenance: "human"`) without requiring an antecedent `researchJobId`.
   - `GET /api/stories` lists recent stories for selection in the studio.
   - Provenance is truthfully surfaced in both studio summary and review header.

2. **Immutable Revisions**:
   - `server/content/artifact.ts` and `POST /api/artifacts/:id/revise` enforce that editing an artifact creates a new row with `supersedesId: id`.
   - Prior revisions remain completely immutable and retain their original text and approval status.
   - New revisions start at `readiness: "draft"` (no inherited approvals).

3. **Approval Decoupling**:
   - `Approve` transitions an artifact from `draft` (via review) to `readiness: "approved"`, pinning the approval timestamp (`approvedAt`).
   - Distribution actions (`Schedule` and `Publish Now`) are strictly gated on approval status.
   - `StatusBadge` provides visual feedback across lifecycle states (`Draft`, `Needs review`, `Approved`, `Scheduled`, `Published`, `Failed`).

4. **Regeneration Semantics**:
   - Regenerating content triggers a new `GenerationJob` with `regenerate: true`.
   - Sibling artifacts belong to the same Opportunity, preserving the history chain without mutating prior outputs.

---

## 2. Dynamic Capability Resolution

Format and channel controls are derived exclusively from runtime backend capabilities (`/api/repurposing/capabilities` and `/api/channels`).

- **No Frontend Allowlists**: Format choices (`Post`, `Thread`, `Article`, `Carousel`, `Image`, `Video`, `Audio`) dynamically inspect the registered capability profiles.
- **Pre-publish Validation**: If an artifact's format is unsupported by its target channel, a clear notice banner (`banner-publish-incompatible`) is displayed and publishing is safely disabled before any request is dispatched.

---

## 3. Account vs. Channel Distinction

ContentForge distinguishes between:
- **Target Channel**: The platform specification (`x`, `linkedin`, `instagram`, `youtube`, `threads`).
- **Connected Account**: The authenticated identity profile fetched from `/api/accounts` (e.g. `@antigravity_dev`).

If no connected account exists for a target channel, the UI indicates that setup is required rather than fabricating credentials or failing silently.

---

## 4. Shared Distribution Primitives

Reused standard primitives created in Phase 28.2A:
- **`SchedulePicker`** (`client/src/components/ui-shared/schedule-picker.tsx`): Real calendar date and time selection, enforcing valid future slots (no hardcoded 24h offsets).
- **`PublishPreview`** (`client/src/components/ui-shared/publish-preview.tsx`): Channel badge, connected handle, content preview, and explicit two-step confirmation dialog before live publication.
- **`ErrorState`** (`client/src/components/ui-shared/error-state.tsx`): Standardized error container with retry callback on generation or loading failures.
- **`StatusBadge`** (`client/src/components/ui-shared/status-badge.tsx`): Shared status indicator supporting `testId` and finite domain vocabulary.

---

## 5. Verification & Test Evidence

- **Database Integration Tests (`server/content/createWorkflow.dbtest.ts`)**:
  - Human Story creation -> Opportunity -> GenerationJob -> Artifact execution.
  - Artifact revision immutability (`supersedesId`, original unchanged).
  - Approval state transition (`draft` -> `in_review` -> `approved` + `approvedAt`).
  - Schedule creation for approved artifact.
  - Regeneration sibling job and artifact creation.
  - *Result*: 4 passed, 0 failed.

- **Playwright E2E Suite (`e2e/create-workflow.e2e.spec.ts`)**:
  - Journey A: Create -> choose Post -> choose Story -> generate -> Review -> Approve.
  - Journey B: Create -> generate -> Edit -> creates Version 2 in draft.
  - Journey C: Create -> generate -> Regenerate -> triggers new generation job.
  - Journey D: Approved content -> Schedule handoff (date & time validation).
  - Journey E: Approved content -> Publish now (preview + confirmation).
  - Journey F: Generation failure recovery -> ErrorState + retry.
  - Journey G: Pre-publish incompatibility notice banner for unsupported formats.
  - Journey H: Responsive layouts at 1440×900, 820×1180, and 390×844.
  - Journey I: 0 Axe accessibility violations in both Studio and Review views.
  - Journey J: Preserved legacy creation modes bar navigation.
  - *Result*: 11 passed, 0 failed (8.3s).

- **Unit Tests (`npm run test:unit`)**:
  - 593 unit tests passed across all domain modules (including `client/src/lib/create-workflow.test.ts`).
