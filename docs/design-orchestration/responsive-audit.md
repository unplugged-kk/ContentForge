# ContentForge — Responsive Audit

**Worktree:** `/Users/kishore/git/cf-design/wt-06` (branch `design/wt-06`)
**Repo under audit:** `/Users/kishore/git/ContentForge` (read-only; nothing edited)
**Mode:** `/design responsive` — recomposition pass, report only
**Register:** Product (authenticated single-operator console; `brief.md:11-19`)
**Date:** 2026-09-27
**Scope:** the 7 canonical destinations plus shared chrome — shell/sidebar, `PageHeader`, tables,
dialogs/sheets, filters, forms, action areas, dense operator rows.
**Viewport matrix (hard gate):** 1440×900 · 1280×800 · 1024×768 · 820×1180 · 768×1024 · 430×932 · 390×844

> Evidence rule applied: no dev server was started, so nothing here is a pixel measurement.
> Every finding is either **source-decidable** (geometry/classes/height math read out of the code)
> or is explicitly marked as a **render-confirm** risk with its mechanism named. Anything I could not
> decide from source is in *Verification gaps*, never in the findings table.

---

## Verdict

**Block** — one `HIGH` escalation trigger is standing (overlay content and its action row become
unreachable at phone matrix viewports). The shell itself is in better shape than the brief's vitals
suggest: it genuinely recomposes rather than shrinks. The defects are concentrated in **overlays**,
**coarse-pointer sizing**, and **one residual "the class says one thing, the layout does another"**
issue around `sticky`.

Counts — **HIGH 1 · MEDIUM 7 · LOW 4**.

---

## What already works (checked, not assumed)

These are the things a responsive pass is tempted to "fix", verified as already correct so they are
**not** reported as findings:

- **The sidebar recomposes; it does not merely collapse.** `use-mobile.tsx:3,11` flips at `< 768px`
  and `<Sidebar>` swaps the fixed rail for a Radix `Sheet` (`sidebar.tsx:183-206`,
  `sidebar-width-mobile: 18rem`). Below 768 the nav becomes an off-canvas drawer behind the header
  trigger; at ≥ 768 it is the 15rem fixed rail (`App.tsx:121-124`). That is a composition change, and
  it is the correct one for a Monitor/Operate shell.
- **iOS Safari field zoom is handled.** `ui/input.tsx:12` and `ui/textarea.tsx:12` both carry
  `text-base md:text-sm`, so every `Input`/`Textarea` is ≥16px at ≤430px. Radix
  `SelectPrimitive.Trigger` renders a **`<button>`** (`select.tsx:19`), so despite `text-sm`
  (`select.tsx:22`) a Select cannot trigger Safari's field zoom. The two `Input type="date"|"time"`
  in the queue/calendar dialogs inherit `text-base` from the primitive.
- **Primary surfaces already stack their columns:** `agent.tsx:541` (`grid-cols-1 lg:grid-cols-[1fr_20rem]`),
  `artifact-review-view.tsx:357` (`grid-cols-1 lg:grid-cols-12` + `col-span-8/4`),
  `artifact-review-view.tsx:542` (`grid-cols-1 sm:grid-cols-2` for Approve/Reject),
  `today.tsx:206,298` (`lg:grid-cols-2`, `grid-cols-2 sm:grid-cols-4`),
  `create-studio.tsx:421,476` and `ingest.tsx:469,615` (`grid-cols-1 md:grid-cols-2/3`).
- **Filter/mode strips already chose horizontal scroll:** `sources.tsx:104`, `saved-tab.tsx:182`,
  `create.tsx:155`, `calendar.tsx:212` all use `overflow-x-auto`.
- **`whitespace-nowrap` inside flex rows — the brief's stated overflow worry — is essentially absent.**
  Repo-wide there are 4 occurrences: `button.tsx:8`, `tabs.tsx:30`, `badge.tsx:8`,
  `automated-optimization-panel.tsx:231`. No hand-rolled `whitespace-nowrap` row found.
- **Media/overflow guards are present where they matter:** `x-post-preview.tsx:62,75` (`flex-1 min-w-0`
  + `whitespace-pre-wrap break-words`), `publish-preview.tsx:21` (`break-words`),
  `today.tsx:185-191` (`min-w-0` + `truncate`/`line-clamp-1`), `calendar.tsx:283` (day chips `truncate`).
- **Safe-area on the capture FAB is landed** (`quick-capture.tsx:74`) — brief §*Already fixed*; not
  re-reported.

---

## Findings

| # | Severity | Discipline | Location (file:line) | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | HIGH | Layout | `client/src/components/ui/dialog.tsx:41`, `client/src/pages/calendar.tsx:305`, `client/src/pages/queue.tsx:585`, `client/src/components/quick-capture.tsx:83` | `DialogContent` is `fixed left-[50%] top-[50%] … translate-y-[-50%]` with **no `max-h` and no `overflow-y-auto`**; `calendar.tsx:318-330` renders `XPostPreview` + one `<Card>` per tweet, then puts the Schedule/Save-New-Time action at the bottom (`calendar.tsx:352-372`, unschedule at `:375-380`) | Give the primitive a default cap — `max-h-[90vh] overflow-y-auto` (and `max-w-[calc(100vw-2rem)]`), or split header/scrollable-body/footer so the action row is pinned and the body scrolls | A thread dialog taller than 844/932px is clipped **top and bottom** with no scroll: Radix locks body scroll and the content has no overflow. The bottom action row ("Schedule" / "Save New Time", `calendar.tsx:371`) becomes unreachable. Escalation trigger — controls out of reach once the window narrows. Two dialogs already prove the pattern is known (`queue.tsx:572` `max-h-[90vh] overflow-y-auto`, `settings.tsx:646` `max-h-[80vh] overflow-auto`); three were left without it. |
| 2 | MEDIUM | Interaction | `client/src/components/ui/sidebar.tsx:269` (+ `App.tsx:160`), `sidebar.tsx:478`, `sidebar.tsx:487`, `client/src/components/ui/button.tsx:32`, `client/src/components/theme-toggle.tsx:9`, `client/src/components/sources/saved-tab.tsx:244` | Sidebar toggle is `h-7 w-7` (**28px**); nav rows are `size: default → h-8` (**32px**); `size: icon` is `h-9 w-9` (**36px**) and delete/toggle buttons go to `h-7 w-7` (28px). No `pointer: coarse` sizing tier exists (zero matches for `coarse`) | Add a coarse-pointer tier: `@media (pointer: coarse)` bump the trigger to 44×44, nav rows to ≥44px tall, and icon buttons to 44×44 (hit-area expansion via pseudo-element is fine — see `interaction.md:89`) | The mobile nav has exactly one entry point, the 28px header trigger, and every destination row is 32px — both under the 44×44 floor the brief records at `docs/full-product-ux-audit.md:187`. The gate cannot see this: Playwright runs `devices["Desktop Chrome"]` only (`playwright.config.ts:43-50`), so `setViewportSize` never produces a coarse pointer. |
| 3 | MEDIUM | Layout | `client/src/components/ui/dialog.tsx:41`, `client/src/components/ui/alert-dialog.tsx:37` | `w-full max-w-lg` with no viewport-relative gutter → at 390/430 the panel is exactly `100vw` wide, flush to both edges (close button 16px in) | `w-full max-w-[calc(100vw-2rem)] sm:max-w-lg` (or add `mx-4`) so phone-width dialogs keep a side margin and read as an overlay, not a full-bleed page | The primitive's only width constraint is a **max** (512px), so the phone case degenerates to edge-to-edge. Every dialog and confirm dialog in the product inherits it. Not an overflow (fixed elements don't extend `scrollWidth`), which is why the gate passes while the composition is wrong. |
| 4 | MEDIUM | Layout | `client/src/pages/insights.tsx:55`, `client/src/pages/schedule.tsx:36` (cf. the fix at `client/src/pages/settings.tsx:376`) | The Insights and Schedule tab strips are `inline-flex` (`tabs.tsx:15`) with `whitespace-nowrap` triggers (`tabs.tsx:30`), placed in the `PageHeader` action's `shrink-0` container (`page-header.tsx:47`) — **no `overflow-x-auto`, nothing can wrap or scroll** | Add the same treatment Settings already uses: `flex overflow-x-auto max-w-full no-scrollbar` on the `TabsList` | Same defect class, three different treatments. Settings was fixed for exactly this (`docs/STATUS.md:233`, UX-30) and the other two were not. Intrinsic strip width is estimated ~340px (Insights) and ~290px (Schedule) against ~358px available inside `p-4` at 390px — a margin small enough that render-confirm is required before this is called a hard break, but there is **no fallback** if it grows (an added label, a wider font, a translated string). |
| 5 | MEDIUM | Layout | `client/src/components/insights/learning-view.tsx:1116-1117` (fixed), `:1134-1139`, vs the correct sibling at `:1561` | Guardrail table is `<table class="w-full text-[10px]">` with 5 columns, `font-mono` metric cells, and a `whitespace-nowrap` Status `Badge` — inside a wrapper that is `overflow-hidden`, **not** `overflow-x-auto`. The sibling Channel-Performance table at `:1561` is wrapped in `overflow-x-auto` | Move the guardrail table under an `overflow-x-auto` wrapper (same strategy as `:1561`), or reduce it to the columns that survive 390px. Do not mix strategies for the same data type | Two tables of the same kind use opposite strategies, so on the phone case one scrolls and one clips its own columns with no way to reach them. The type floor (`index.css:230-234`) raises `text-[10px]` to 12px, which widens the `font-mono` min-content further — the two fixes work against each other. |
| 6 | MEDIUM | Layout | `client/src/App.tsx:154` (`h-screen`), `client/src/App.tsx:136` | Shell height is `100vh`. `sidebar.tsx:142` and `:232` already use `svh` (`min-h-svh`, `h-svh`) | Use `h-dvh` (or `100dvh`) for the shell, matching the `svh` already in the sidebar | On iOS Safari `100vh` is the *large* viewport height. `main` is `overflow-hidden` and each page's scroll container is sized from it, so the bottom ~60-90px of every page is behind the collapsing toolbar **and cannot be scrolled into view** — the scroll range itself is short by that amount. The repo already knows the vocabulary (`svh`); the shell just does not use it. |
| 7 | MEDIUM | Layout | `client/src/components/ui-shared/page-header.tsx:30` vs `today.tsx:130`, `sources.tsx:80`+`:236`, `settings.tsx:367`+`:374`, `schedule.tsx:28`+`:54`, `insights.tsx:46`+`:84`, `create.tsx:131`+`:192` | `PageHeader` is `sticky top-0 z-10 … backdrop-blur`. That is only *live* on `/today`, where the scrolling ancestor is the page root that contains the header. On the other five pages the header is a static sibling **above** an inner `overflow-auto` region, so `sticky` and the blur never engage | Either make the header the first child of each page's scroll container (so content scrolls under the blurred chrome, which is what the blur is for), or drop `sticky`/`backdrop-blur` and stop claiming the behaviour | "The class says one thing, the layout does another" on 5 of 7 destinations. The gate does not catch it: it asserts `toBeVisible()` only (`e2e/full-product-audit.e2e.spec.ts:86`), never stickiness. `smell-report.md` calls this blur "earned" for `page-header.tsx:30`; on these five pages it is inert, so it is currently neither earned nor harmful — it is undocumented. |
| 8 | MEDIUM | Layout | `client/src/pages/calendar.tsx:150-177`, `:171` | Month-nav row is a plain `flex items-center gap-2 ml-auto` (no wrap, no `overflow-x-auto`) containing a `min-w-[140px]` centred month label plus a `Best Times` button and two 36px chevrons | Wrap the strip in `overflow-x-auto`, or drop the fixed `min-w-[140px]` to `min-w-0` and let the label shrink | Intrinsic width ≈348px against ≈358px available at 390px — the same no-fallback pattern as §4. The `min-w-[140px]` is the one element that cannot shrink, so it is the one that pushes the row past the gutter. (The `min-w-[120px]` best-times cards at `:214` are fine — they sit in an `overflow-x-auto` strip.) |
| 9 | LOW | Layout | `client/src/pages/create.tsx:155`, `client/src/pages/settings.tsx:376` | Both strips add `no-scrollbar`, but **no `.no-scrollbar` rule and no scrollbar utility exists anywhere** in `client/src/index.css`, `tailwind.config.ts`, or any CSS file | Either define it (`.\!no-scrollbar::-webkit-scrollbar{display:none}; scrollbar-width:none`) or delete the class | Dead class. The Settings mobile-tab fix credited in `docs/STATUS.md:233` works only because of `overflow-x-auto`; the "no visible scrollbar" intent is not implemented, so a scrollbar is painted on the one strip that was supposed to hide it. |
| 10 | LOW | Layout | `client/src/pages/agent.tsx:500` | `<span className="hidden xs:inline">Runs</span>` | Use a configured breakpoint (`hidden sm:inline`) or define `screens.xs` | `tailwind.config.ts:6-104` extends no `screens`, so `xs:` is never generated and the label is hidden at **every** width — the mobile run-history trigger is permanently icon-only. Accessible name is intact (`aria-label`, `:497`), so this is visual only. |
| 11 | LOW | Type | `client/src/pages/discover.tsx:755`, `:761` | Raw `<input type="date">` / `<input type="time">` with `text-sm` (14px) instead of the primitive's `text-base md:text-sm` | Use `<Input type="date">`/`<Input type="time">`, or add `text-base md:text-sm` | The only sub-16px native field inputs left in the client — this is the one place the iOS-zoom class could bite. **Currently unreachable**: `pages/discover.tsx` has no importer and `/discover` redirects (`App.tsx:104`), so this is dead code carrying a latent defect. |
| 12 | LOW | Layout | `client/src/pages/today.tsx:146`, `client/src/pages/analytics.tsx:229`, `client/src/pages/ingest.tsx:251` | Fixed `p-6` (24px) on every breakpoint, while sibling surfaces use `p-4 sm:p-6` (e.g. `sources.tsx` body, `settings.tsx:374`) | `p-4 sm:p-6` | At 390px a fixed `p-6` spends 48px of a 390px line on gutters, leaving 342px for the densest content in the product (metric tiles, ingest forms, the guardrail table of §5). Inconsistent rhythm across the 7 destinations at the same viewport. |

---

## Horizontal-overflow risk register (the brief's explicit ask)

Every element carrying a **fixed `min-width`**, a **wide table**, or `whitespace-nowrap` **inside a
flex row**, and whether it is contained. "Contained" = an ancestor establishes `overflow-x-auto`, so
it can scroll; "open" = nothing upstream can absorb the width.

| Location | Risk | Contained? |
|---|---|---|
| `learning-view.tsx:1116-1117` | 5-col table, `font-mono` cells, `whitespace-nowrap` badge, ≥12px floor | **OPEN** — wrapper is `overflow-hidden` (clips) |
| `insights.tsx:55` | `inline-flex` + `whitespace-nowrap` triggers in a `shrink-0` header action | **OPEN** (finding #4) |
| `schedule.tsx:36` | same pattern | **OPEN** (finding #4) |
| `calendar.tsx:171` | `min-w-[140px]` label in a non-wrapping flex row | **OPEN** (finding #8) |
| `sources.tsx:104` | two `shrink-0` button groups (~500px intrinsic) | contained — `overflow-x-auto` |
| `saved-tab.tsx:182` | 4 filter pills | contained — `overflow-x-auto` |
| `create.tsx:155` | 9 mode links + "Mode:" label | contained — `overflow-x-auto` |
| `settings.tsx:376` | 4 tab triggers | contained — `overflow-x-auto` |
| `learning-view.tsx:1561` | 4-col signals table | contained — `overflow-x-auto` |
| `ai-usage.tsx:376-377` | 6-col recent-calls table | contained — `overflow-x-auto` |
| `calendar.tsx:212-214` | `min-w-[120px]` best-times cards | contained — `overflow-x-auto` |
| `learning-view.tsx:1814` | `<pre>` with long tokens | contained — `overflow-x-auto` |
| `badge.tsx:8`, `button.tsx:8`, `tabs.tsx:30` | `whitespace-nowrap` in the shared primitives | by design; call sites use wrapping containers |
| `select.tsx:91`, `menubar.tsx:120`, `dropdown-menu.tsx:48,66` | `min-w-[var(--radix-*)]` / `min-w-[12rem]` | Radix portals, viewport-collision aware |

**No document-level horizontal overflow is asserted anywhere in this report** — I did not render. The
five "OPEN" rows are the candidates that could produce one; four of them are margin cases that need a
browser to settle.

---

## Per-viewport assessment

| Viewport | Verdict | Notes |
|---|---|---|
| **1440×900** | Pass | Composition holds; `max-w-6xl/5xl` centres the work column, no stretched controls observed in source. |
| **1280×800** | Pass | Same as 1440; sidebar 15rem, content ≥1000px. |
| **1024×768** | Pass | `lg` boundary (1024) — `agent.tsx:541` and `artifact-review-view.tsx:357` flip to two-pane exactly here. |
| **820×1180** | Pass | Above `md` (768) so the desktop rail shows; content ≈580px, tabs fit. |
| **768×1024** | Risk (low) | Boundary case: `use-mobile.tsx:3,11` uses `< 768`, so at exactly 768 the **desktop rail is shown**, not the drawer — intended, but the widest no-fallback strips (#4, #8) are at their tightest relative to their `sm:` row layout here. Header `sm:flex-row` is active. |
| **430×932** | Risk | Drawer nav + 28px trigger (#2); dialogs full-bleed (#3); mobile-height dialog clipping (#1) still possible for long threads; tab strips (#4) marginal. |
| **390×844** | **Risk (highest)** | Everything above plus: `calendar.tsx:171` month row (#8), fixed `p-6` gutters (#12), and the tallest-overlay case for #1 (844px of dialog height). Nav targets 28/32px (#2) are the primary interaction defect at this width. |

---

## Verification

**Ran in this pass (source-level, no server started):**

- Read the shell in full: `App.tsx`, `use-mobile.tsx`, `ui/sidebar.tsx` (727 lines), `app-sidebar.tsx`.
- Read every canonical route root and its scroll architecture: `today.tsx`, `create.tsx`, `sources.tsx`
  (+`discover-tab.tsx`, `saved-tab.tsx`), `agent.tsx` (layout regions), `schedule.tsx`
  (+`queue.tsx` 647 lines, `calendar.tsx`, `publications-view.tsx`), `insights.tsx`
  (+`analytics.tsx`, `ai-usage.tsx` table region, `learning-view.tsx` table regions), `settings.tsx`.
- Read the shared chrome/primitives: `page-header.tsx`, `quick-capture.tsx`, `x-post-preview.tsx`,
  `confirm-dialog.tsx`, `schedule-picker.tsx`, `publish-preview.tsx`, `ui/{dialog,alert-dialog,sheet,tabs,
  input,textarea,select,button,table}.tsx`, `theme-toggle.tsx`, `index.html`, `tailwind.config.ts`,
  `playwright.config.ts`.
- `grep` sweeps: `min-w-[`, `w-[`/`max-w`, `overflow-x-auto`, `whitespace-nowrap` (4 hits, all primitives),
  `grid-cols-*`, `fixed|absolute|sticky`, `size="icon"|h-7 w-7|h-6 w-6`, `no-scrollbar` (2 usages, **0
  definitions**), `<table|<Table`, `h-screen|dvh|svh`, `<SelectTrigger|<input|<select`.
- Read the viewport gate and the report context it cites: `e2e/full-product-audit.e2e.spec.ts:1-97`,
  `e2e/canonical-ia.e2e.spec.ts:120-154`, `e2e/accessibility.e2e.spec.ts` (full), `brief.md` §Viewport,
  `checkup-report.md` (#7), `smell-report.md` (#6, blur note).

**Gate integrity findings (not UX findings — recorded because the brief leans on the gate):**

1. **The brief names the wrong file.** `brief.md:317`/`:309-311` and the task brief call
   `e2e/accessibility.e2e.spec.ts` "the existing viewport gate". That file contains **no viewport
   matrix** — no `setViewportSize`, no `scrollWidth` check. The real gate is
   `e2e/full-product-audit.e2e.spec.ts:75-97` (7 viewports × 7 routes = the "49 executions" the brief
   describes). The matrix itself lives at `:14-22` and matches the brief exactly.
2. **The gate asserts visibility, not stickiness.** `full-product-audit.e2e.spec.ts:86` is
   `expect(locator(headerTestId)).toBeVisible()`. Nothing asserts `position: sticky` or that the header
   stays put while content scrolls — so finding #7 is invisible to it by construction.
3. **Tolerance drift.** The gate uses `+ 1` (`:90`); `canonical-ia.e2e.spec.ts:151` uses `+ 2` for the
   same assertion on `/today` at three viewports. Two numbers for one invariant.
4. **The matrix never runs a coarse pointer.** `playwright.config.ts:40-62` defines only `chromium`,
   `api`, `no-auth`, all `devices["Desktop Chrome"]`. `setViewportSize` changes geometry, not input
   class, so every touch-target defect (#2) is outside the gate's reach by design.

**Verification gaps (never findings):**

- **Rendered geometry.** No dev server, so I did not measure `scrollWidth`/`clientWidth`, sticky
  behaviour, or any of the estimated strip widths in #4/#8. Those two rows are labelled
  *render-confirm* on purpose; the intrinsic-width numbers are estimates from class + font-size, ±10%.
- **Overlay height at 844/932.** #1 is decided from source (no `max-h`/`overflow-y-auto` on the
  primitive; content is a per-tweet list), but the exact thread length that tips a given fixture over
  844px was not measured.
- **`prefers-reduced-motion`, dark mode, and 200% zoom** were not exercised. The reduced-motion layer
  exists and is asserted by `accessibility.e2e.spec.ts:153-186`, so reflow-under-zoom is the untested one.
- **`pages/vault.tsx:156` `min-w-[200px]`, `pages/generate.tsx:400` `min-w-[8rem]`,**
  `pages/discover.tsx:755,761` are in legacy modules with no importer (`/vault`, `/generate`, `/discover`
  all redirect, `App.tsx:99,101,104`). Excluded as dead code rather than audited.
- **RTL.** No `dir` handling and no logical-property migration was audited; the product has no stated
  RTL requirement in `brief.md`, so it is out of scope rather than a finding.

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `ui/sidebar.tsx:183-206` + `use-mobile.tsx:3` | "The nav merely collapses to an icon rail" | It does not collapse — it swaps to a full off-canvas `Sheet`. That is recomposition, which is what the pass is looking for. No finding. |
| `button.tsx:8`, `tabs.tsx:30`, `badge.tsx:8` | `whitespace-nowrap` inside flex rows causing overflow | These are the *primitives*; nowrap on a button/tab/badge is correct, and every call site I read wraps them (`flex-wrap`, `overflow-x-auto`, or `grid-cols-1`). The brief's concern does not materialise. |
| `ui/select.tsx:22`, `agent.tsx:426` (`text-xs`), `create-studio.tsx:388` | iOS Safari input zoom on Select | Radix `SelectTrigger` renders a `<button>` (`select.tsx:19`), not a native field, so Safari's <16px field-zoom does not apply. Reporting it would be inventing a defect. |
| `sources.tsx:104`, `create.tsx:155`, `saved-tab.tsx:182` | Filter/mode strips exceed the viewport | All three declare `overflow-x-auto`. A horizontal-scroll filter strip is a chosen strategy (`responsive.md:189`), not a break — the only residual nit is the undefined `no-scrollbar` (#9). |
| `learning-view.tsx:808-831, 1073-1107, 1486-1499` | Five levels of nested rounded boxes; 1,908-line file | Structural/`surface` defect already owned by `smell-report.md` #6 ("Never one card inside another"). Not a responsive finding; re-reporting it would double-count a different discipline's row. |
| `card.tsx:34-40` | `CardTitle` default `text-2xl` (34 un-overridden call sites) | A type-scale defect owned by `smell-report.md` #8. At 390px it wraps rather than overflows, so it is not a horizontal-overflow risk. |
| `today.tsx:146` | Full-bleed content | Content stays inside `max-w-6xl mx-auto`; the gutters are the only issue and are already row #12. No separate row. |

---

## Recommended order of work (for the fix pass, not this report)

1. **#1** — overlay height/scroll contract on the `Dialog`/`AlertDialog` primitives. One change, every
   dialog, and it removes the only `HIGH`.
2. **#3** — same primitives, viewport-relative max-width. One line, fixes the phone composition of every
   dialog and confirm gate.
3. **#4 + #8** — finish the tab/strip work Settings started; add `overflow-x-auto` to the Insights and
   Schedule `TabsList` and to the calendar month row. Then define or delete `no-scrollbar` (#9).
4. **#5** — put the guardrail table behind `overflow-x-auto` to match `:1561`.
5. **#2** — a `pointer: coarse` sizing tier for the trigger, nav rows, and icon buttons. This is the
   highest-reach defect that the automated gate structurally cannot see, so it needs a manual or a
   `hasTouch` project to stay fixed.
6. **#6 + #7** — `h-dvh` for the shell; decide whether the `PageHeader` is sticky-by-design (then make
   it true on all 7 routes) or not (then strip the class and the blur). Either way, fix the gate so the
   claim is checked.
