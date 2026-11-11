# Design System Audit

Part of the ContentForge UX intelligence package. Discovery only: nothing was changed.

**Headline.** The foundation is sound: a token-based shadcn/ui setup with light and dark values, one readable typeface, consistent radii and near-zero contrast failures. The gaps are at the layer above the primitives: no shared page header, banner, empty state, error state, confirm or schedule components, so each page re-invents them, and one global CSS utility silently breaks a fixed-position control.

## 1. Foundation (what exists)

| Layer | Finding | Evidence | Confidence |
|---|---|---|---|
| Framework | Tailwind 3.4, shadcn/ui (style "new-york", base colour neutral, Radix primitives), lucide-react plus react-icons | `components.json`, `tailwind.config.ts` | HIGH |
| Colour tokens | HSL variables with light and dark values; primary `217 91% 48%`; semantic status colours defined in the Tailwind config | `client/src/index.css`, `tailwind.config.ts` | HIGH |
| Radius | 9 / 6 / 3 px scale | `tailwind.config.ts` | HIGH |
| Typography | `--font-sans: Open Sans` is the only face used, but `index.html` requests about 25 families | `index.css`, `index.html:9` | HIGH |
| Shadows | `--shadow-*` tokens exist but resolve to effectively zero-alpha values, so elevation is expressed by borders and the `hover-elevate` overlay | `index.css` | HIGH |
| Theme | `darkMode: class`; default dark; stored under `theme` in localStorage; light/dark toggle only, no system preference | `theme-provider.tsx` | HIGH |
| Contrast | axe found no systemic failures: 66 of 70 affected runs are one sidebar avatar; one large failure on the 404 page | Evidence Ledger 5.2 | HIGH |

## 2. Component inventory

![Component map](visuals/08-component-map.png)

| Layer | Count and detail |
|---|---|
| shadcn primitives in `components/ui` | 47 files; 17 imported outside `ui/`. The most used are Button (31 importers), Card (30), Badge (25), Input (18), Select and Textarea (17 each), Dialog (13) |
| Not imported anywhere outside `ui/` | 30, including `alert-dialog` (needed for UX-02) and `command` (UX-32). Some may be used transitively inside `ui/` (for example by `sidebar`) |
| App-level components | `app-sidebar`, `quick-capture`, `theme-provider`, `theme-toggle`, `tiptap-editor`, `x-post-preview`, and 9 files under `components/agent/` |
| Missing shared components | PageHeader, Banner (compliance note), EmptyState, ErrorState, ConfirmDialog, SchedulePicker, StatusBadge |
| Utilities | `.hover-elevate`, `.active-elevate`, `.no-default-hover-elevate` in `index.css` |

## 3. Findings

| ID | Finding | Severity | Evidence |
|---|---|---|---|
| UX-01 | `.hover-elevate` sets `position: relative` on any element that also has `.fixed`, breaking Quick Capture at every breakpoint. Utility that changes layout is a design-system defect, not a page defect | High | `index.css:248-253`, `quick-capture.tsx:55` |
| UX-18 | Compliance banners are hand-built four times | Low | Queue, Discover, Ingest, References |
| UX-28 | The 404 page uses raw `bg-gray-50` and `text-gray-900` instead of tokens, so it breaks in dark mode | Low | `not-found.tsx:6-15` |
| UX-31 | About 25 font families requested; one used | Low | `index.html:9` |
| UX-33 | No system-theme option; toggle has no accessible name | Low | `theme-provider.tsx`, `theme-toggle.tsx` |
| UX-35 | Zero-alpha shadow tokens; uneven page headers (icon or none, differing sizes); the Bot icon stands for both Agent Workspace and AI Usage | Low | `index.css`, page headers, `app-sidebar.tsx` |
| UX-36 | Chart axis labels overlapped in one Analytics capture | Low (LOW confidence) | analytics-desktop-dark.png |
| UX-27 | Many controls under 44 px; some under 24 px | Medium | Evidence Ledger 5.3 |
| UX-24 | Icon-only buttons rely on no accessible name; there is no icon-button component that requires one | High | axe `button-name`, 272 nodes |

Additional observation (MEDIUM): `POST_STATUSES` in `client/src/lib/constants.ts` uses raw Tailwind palette classes (`text-blue-500`, `text-amber-500`, `text-green-500`, `text-red-500`) while the Tailwind config defines semantic status colours. Status colour therefore has two sources.

## 4. Patterns that work (keep)

| Pattern | Where | Why |
|---|---|---|
| Real tweet preview plus date and time picker in a dialog | Calendar post detail | The best scheduling interaction in the app; the reference for UX-06 |
| "Agent suggestion" versus "User approval" badge | `artifact-review.tsx` | Makes agent versus human authority explicit |
| Error classification (retryable, permission_denied, not_found, conflict, validation_error, unknown, failed) | `shared/agent-ui.ts` | A ready vocabulary for user-facing error states |
| Skeleton loading | Queue, Ideas, Analytics, AI Usage, Templates, Generate | Loading states exist on most data pages |
| Mutation failure toasts | Nearly every page has `onError` | Write failures are surfaced (the wording is the gap, UX-04) |
| Sidebar with groups, icons and active state | `app-sidebar.tsx` | Clear and consistent |
| One H1 per page, `lang="en"`, `main` landmark | All routes | Sound document basics |

## 5. State-completeness audit

Read from code (counts of matches per page), then checked in the live app for Queue, Ideas, Analytics, Calendar, Discover and Settings.

| Page | Loading | Empty | Read error | Write error toast | Delete confirm |
|---|---|---|---|---|---|
| Generate | Yes | Yes (illustrated) | No | Yes | n/a |
| Queue | Yes (skeleton) | Yes | **No** (shows empty) | Yes | **No** |
| Calendar | Yes | Yes (empty grid) | **No** | Yes | **No** |
| Ideas | Yes (skeleton) | Yes | **No** | Yes | **No** |
| Discover | Spinner | Yes ("0 ideas") | **No** | Yes | **No** |
| Analytics | Yes (skeleton) | Yes | **No** (zeros) | n/a | n/a |
| Settings | Spinner | Partly | **No** ("Connect") | Yes | **No** (disconnect) |
| Agent Workspace | Yes | Yes | Partly (run error and repurpose panel only) | Yes | n/a |
| Other pages (articles, vault, references, youtube, canned, carousel, imagegen, ingest) | Yes | Varies | **No** | Yes | **No** |
| Templates, Hooks, Chat, Formatter | Varies | Varies | No | Yes | n/a (Templates has no delete) |

Summary: loading and write-failure states are widespread; read-failure and destructive-confirmation states are absent everywhere. That is the most repeatable gap and the cheapest to close once a shared component exists (R02, R03).

## 6. Consistency observations

| Area | Observation |
|---|---|
| Page header | Some pages carry an icon, some do not; title sizes differ (text-2xl on some, smaller on others); subtitles vary in tone |
| Content width | Widths differ between pages: a full-bleed three-column grid on Agent Workspace, narrower layouts elsewhere |
| Banners and notes | Four bespoke variants |
| Buttons | Primary, outline and ghost used correctly; icon-only variants lack names |
| Dialogs | Consistent use of the Dialog primitive (13 importers); no AlertDialog |
| Toasts | One toaster; wording inconsistent (raw versus friendly) |

## 7. Recommendations (see UX_ROADMAP.md)

R01 (utility fix and icon-button naming), R02 (ConfirmDialog with the existing AlertDialog primitive), R03 (ErrorState), R05 (shared SchedulePicker taken from the Calendar dialog), R07 (accessible names), R14 (target sizes), R18 (PageHeader, Banner, 404, theme, fonts, shadows, icons).

A specialist design-system pass should happen **before** the IA work, because the IA changes will produce new pages that would otherwise copy the same gaps.
