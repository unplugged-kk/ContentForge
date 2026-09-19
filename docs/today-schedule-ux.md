# ContentForge — Today + Schedule Consolidation (Phase 28.2F)

## Overview

**Codename:** THE DAILY OPERATING LOOP

Phase 28.2F turns `/today` and `/schedule` — placeholders since 28.2B — into
the real daily operating surface:

```text
TODAY
   ↓
What needs my attention?
   ↓
Review → Approve → Schedule → Publish → See what happened
```

## The two-model reality (read this before touching either page)

ContentForge has two fully independent content lineages, with **zero DB
link** between them:

- **Legacy** `posts`/`tweets` — Queue and Calendar. This is the real,
  actively-used daily surface today.
- **Canonical** `Story → Opportunity → Artifact → Schedule →
  ScheduleOccurrence → Publication → Result` — what Create Studio (28.2C)
  and Agent Workspace (28.2D) write to.

Merging these is the R10 architecture decision the UX audit explicitly
deferred to the product owner. 28.2F does not make that call. Instead:
**Queue and Calendar are untouched**, and a third **Publications** tab was
added to Schedule so the canonical pipeline — previously invisible
anywhere in the UI — has a home. `Schedule = Queue + Calendar +
Publications`, as three real views, not a data-model merger.

## Today information architecture

```text
Today
├── Attention        — needs review / waiting approval / failed / needs verification
├── Today's Schedule  — legacy queue-today posts + canonical occurrences-today, merged by time
├── Recent Activity   — bounded, composed from existing timestamped rows (no new event table)
└── Quick Actions     — Create / Research / Ask Agent / Capture a link
```

Each section runs its **own independent query** and renders its own
loading/error/empty/data state (`client/src/pages/today.tsx`). One failing
section never blanks the page — verified by
`e2e/today-schedule.e2e.spec.ts`'s Journey F (forces `/api/publications` to
500 and asserts the other sections still render).

### Attention rules

Composed by `deriveAttentionItems` (`client/src/lib/today-schedule-state.ts`)
from four sources, priority-sorted (`action_required` before `warning`,
most-recent first within a tier):

| Source | Severity | Backend query |
| --- | --- | --- |
| Artifact `readiness=in_review` | action_required | `GET /api/artifacts?readiness=in_review` |
| Agent run `needsApproval` | action_required | `GET /api/agent/runs` (now returns `needsApproval` per run) |
| Publication `state=failed` | warning | `GET /api/publications?state=failed` |
| Publication with `result.outcome=unknown` | warning | `GET /api/publications` filtered client-side |

Routine success is never turned into an attention item. A failed
verification is always "needs verification", never "Failed" — `Failed` is
reserved for a provider-confirmed failure.

### No new activity/event table

`audit_logs` is an HTTP request log, not a domain-event feed — confirmed by
code audit, no such table exists. Recent Activity is assembled client-side
from `createdAt`/`updatedAt` across the existing artifacts/publications
list endpoints, capped and sorted, never a fabricated timeline.

## Backend additions (all additive, owner-scoped, no schema changes)

None of these existed before this phase — every artifact/schedule/
publication endpoint was previously scoped to a single id or a single
opportunity:

- `GET /api/artifacts?readiness=&limit=` — `storage.listArtifactsByOwner`
- `GET /api/schedule-occurrences?from=&to=&limit=` — `storage.listOccurrencesByOwnerRange` (joins occurrence → schedule → artifact)
- `GET /api/publications?state=&limit=` — `storage.listPublicationsByOwner` (LEFT JOINs `results` for `outcome`)
- `GET /api/agent/runs` — gains a `needsApproval: boolean` per run (one extra query over `agent_tool_calls`, no N+1 per-run event fetch)

## Schedule

Adds a `Publications` tab (`client/src/components/schedule/publications-view.tsx`)
alongside the existing Queue/Calendar tabs. Deep-linkable via
`/schedule?tab=publications` (read with wouter's `useSearch()`). Per-row
action gating mirrors the spec: `View` (published), `View details` (failed,
with the Result's error message when available, never a raw provider
exception), `Check status` (unknown — routes to the same canonical
`/create?artifact=<id>` Review surface; no second detail page was built).

## Responsive & accessibility

- Journeys H/I (`e2e/today-schedule.e2e.spec.ts`) assert no horizontal
  scroll and reachable primary actions at 390×844 for both Today and
  Schedule.
- `/today`, `/schedule`, and `/schedule?tab=publications` are all in the
  axe sweep (`e2e/accessibility.e2e.spec.ts`) — 0 violations for
  `document-title`/`meta-viewport`/`button-name`/`label`.
- Quick Capture's "Capture a link" Quick Action dispatches a
  `contentforge:open-quick-capture` window event that `quick-capture.tsx`
  also listens for — Today doesn't lift or duplicate the capture dialog's
  state.

## Deferred (explicitly, unchanged from the spec)

Insights/analytics redesign (28.2G), a notifications system, multi-account,
TikTok, automation/external schedulers, recurrence redesign, merging the
two content models (R10, still an owner decision), and mobile polish beyond
what Today/Schedule's own new surfaces needed (28.2H).
