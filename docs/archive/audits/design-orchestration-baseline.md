# ContentForge — Design Orchestration Baseline

**Phase:** 0 (Coordinator Baseline)
**Date:** 2026-09-26
**Coordinator tree:** `/Users/kishore/git/ContentForge` (branch `main`, HEAD `ad1a0d0`)
**Register:** Product — an authenticated single-operator instrument, not a brand surface
(`.commandcode/design/brief.md`)

---

## 1. Why this file exists

This is the shared ground truth every specialist agent reads before it touches anything. It
records what the current tree actually is, what is already fixed, and what is genuinely
still open — so nine parallel agents do not re-diagnose a defect that was resolved yesterday,
and do not collide with each other.

It is deliberately not a design opinion. It is an inventory with citations.

---

## 2. Repository state at baseline

| Fact | Value |
|---|---|
| Branch | `main` |
| HEAD | `ad1a0d0` — `fix(33.1): restore operator env credentials, guard cross-tenant fallback` |
| Uncommitted tracked changes | 43 files, +1069 / −342 |
| Untracked files | 26 paths, including 4 new shared primitives and 2 new e2e specs |
| `npm run check` (tsc) | **passes, exit 0** |
| Last production build | `dist/index.cjs`, 2026-09-26 06:23 |
| Existing design artifacts | `.commandcode/design/{brief,checkup-report,smell-report}.{md,html}` |

**This working tree is unlanded work in progress ("Phase 33.2 — IA/UX/accessibility").**
It is the current source of truth for design purposes. It is *not* committed, and no
specialist agent may commit, stash, reset, or discard any part of it.

### Baseline snapshot

Because a git worktree checks out a *commit*, and the real design state here lives in the
working tree, the coordinator took a non-destructive snapshot through a throwaway git index
(`GIT_INDEX_FILE`), leaving the real index and working tree untouched:

```
BASELINE_SNAPSHOT = 87a0601
message           = chore(design): baseline snapshot of phase-33.2 working tree
```

All nine specialist worktrees were created from `87a0601`, so every agent audits the same
real state. `node_modules` is symlinked from the main checkout to avoid nine 1 GB installs.

### Worktree map

| Agent | Branch | Path | Scope |
|---|---|---|---|
| WT-01 Visual Auditor | `design/wt-01` | `/Users/kishore/git/cf-design/wt-01` | Hierarchy, composition, density, type, colour, cards |
| WT-02 IA / UX | `design/wt-02` | `/Users/kishore/git/cf-design/wt-02` | 7-destination IA, workflow transitions |
| WT-03 Design System | `design/wt-03` | `/Users/kishore/git/cf-design/wt-03` | Tokens, primitives, duplication |
| WT-04 AI / Autonomy UX | `design/wt-04` | `/Users/kishore/git/cf-design/wt-04` | Agent, learning, policy, scheduler |
| WT-05 Accessibility | `design/wt-05` | `/Users/kishore/git/cf-design/wt-05` | axe, keyboard, focus, names, contrast |
| WT-06 Responsive | `design/wt-06` | `/Users/kishore/git/cf-design/wt-06` | 7-viewport recomposition |
| WT-07 Motion | `design/wt-07` | `/Users/kishore/git/cf-design/wt-07` | Motion system application + gaps |
| WT-08 Operator UX | `design/wt-08` | `/Users/kishore/git/cf-design/wt-08` | Real data, failure, unknown, DLQ |
| WT-09 Performance UX | `design/wt-09` | `/Users/kishore/git/cf-design/wt-09` | Load, bundles, duplicate requests |

Coordinator integration tree: `/Users/kishore/git/cf-design/integration` (Phase 5).
The coordinator is the only actor permitted to accept, reject, resolve, or integrate.

---

## 3. Current UI architecture

React 18 + TypeScript, `wouter` for routing, Radix UI primitives, Tailwind CSS 3 with the
`shadcn/ui` component convention, `@tanstack/react-query` for server state,
`framer-motion` available, `recharts` for charts, `next-themes` for theme switching.

```
client/src/
  App.tsx                188 lines — shell, route table, skip link, error boundary
  main.tsx               entry
  index.css              561 lines — the entire token layer, motion system, reduced-motion
  pages/                 28 files — 7 canonical + 1 secondary (/youtube) + 20 legacy redirects
  components/
    ui/                  ~45 shadcn/Radix primitives (button, card, dialog, tabs, …)
    ui-shared/           11 ContentForge-specific primitives (see §5)
    agent/  create/  insights/  schedule/  sources/   domain feature components
    app-sidebar.tsx  quick-capture.tsx  tiptap-editor.tsx  theme-*.tsx
  hooks/                 use-toast, use-mobile, use-chart-colors (new)
  lib/                   query client, api helpers, legacy-route-mapping (new)
server/                  Express 5 + Drizzle + pg-boss. OUT OF SCOPE for this program.
```

**Out of scope for the entire program:** `server/**`, database schema, migrations, API
contracts, autonomy/scheduler logic, and the seven canonical destination paths.

---

## 4. Route structure (settled — do not change)

```
/today      TodayPage             the daily operating loop
/create     CreatePage            the creation workspace
/sources    SourcesPage           discover / saved / research
/agent      AgentWorkspacePage    runs, progress, approvals
/schedule   SchedulePage          queue / calendar / publications
/insights   InsightsPage          performance / learning / AI usage
/settings   SettingsPage          channels, accounts, runtime, autonomy
/youtube    YoutubePage           secondary, non-canonical
```

Twenty legacy paths (`/ideas`, `/calendar`, `/analytics`, `/queue`, `/discover`, `/ingest`,
`/generate`, `/templates`, `/articles`, `/references`, `/images`, `/vault`, `/hooks`,
`/carousel`, `/chat`, `/formatter`, `/canned-responses`, `/queue`, `/ai-usage`) resolve
through `LegacyRouteRedirect` → `client/src/lib/legacy-route-mapping.ts`. Bookmarks do not
404. **This IA is approved and is a hard constraint.**

---

## 5. Shared design-system primitives

### `components/ui-shared/` — the ContentForge layer (11 files)

| Primitive | Lines | Status | Note |
|---|---|---|---|
| `page-header.tsx` | — | existing | Sticky, `backdrop-blur` with `supports-` fallback. Earned. |
| `status-badge.tsx` | ~90 | **modified in WIP** | 9 content statuses → tone; `rejected` added as distinct state |
| `empty-state.tsx` | — | existing | Carries the icon-topper circle pattern (§8) |
| `error-state.tsx` | — | existing | Only `role="alert"` surface before the announcer |
| `confirm-dialog.tsx` | — | existing | |
| `publish-preview.tsx` | — | existing | |
| `schedule-picker.tsx` | — | existing | |
| `actor-badge.tsx` | 86 | **new in WIP** | Human vs automatic. Distinct icon **and** distinct word. Best-evidenced badge in the repo. |
| `announcer.tsx` | 68 | **new in WIP** | Live region; fixes silent async completion |
| `channel-icon.tsx` | 94 | **new in WIP** | Channel identity |
| `use-chart-colors.ts` (hook) | — | **new in WIP** | Resolves `--chart-N` to concrete colour per theme |

### `components/ui/` — ~45 shadcn primitives

`button.tsx` carries `hover-elevate active-elevate-2` and `focus-visible:ring-1
focus-visible:ring-ring`. `card.tsx` supplies `CardTitle` at `text-2xl` (§8). `tabs.tsx` is
the only `transition-all` in the client.

---

## 6. Design tokens (as they exist today)

All in `client/src/index.css`, light at `:root` (l. 6–106) and dark at `.dark` (l. 108–184),
mapped in `tailwind.config.ts`.

**Colour.** Surfaces and text are HSL triples consumed as `hsl(var(--x) / <alpha-value>)`:
`--background --foreground --border --card --card-border --sidebar* --popover --primary
--secondary --muted --accent --destructive --input --ring`.

| Role | Light | Dark |
|---|---|---|
| `--primary` | `217 91% 48%` | `217 91% 48%` |
| `--ring` | `217 91% 38%` | `217 91% 72%` |
| `--foreground` | `0 0% 9%` | `0 0% 95%` |
| `--muted-foreground` | `0 0% 35%` | `0 0% 65%` |
| `--destructive` | `0 84% 42%` | `0 84% 42%` |

**Chart ramp** — re-derived to separate by *lightness first*, so series survive deuteranopia
and protanopia (index.css l. 44–63):
`--chart-1 215 44% 24%` → `--chart-2 277 43% 36%` → `--chart-3 313 42% 48%` →
`--chart-4 43 70% 60%` → `--chart-5 155 55% 72%`.

**Type tokens.** `--text-meta: 0.75rem` (12px, the declared floor) and
`--text-dense: 0.8125rem` (13px). `--font-sans: Open Sans`, `--font-mono: Menlo`
(mono reserved for timestamps and dense cells).

**Radius.** `--radius: .5rem`; `lg: 9px`, `md: 6px`, `sm: 3px`.

**Shadow.** Eight steps, `--shadow-2xs` → `--shadow-2xl`, with real alpha in both themes.

**Motion.** `--duration-press 100ms`, `--duration-fast 150ms`, `--duration-base 200ms`,
`--duration-overlay 250ms`, `--duration-layout 300ms`, `--duration-loop 800ms`; easing
`--ease-out-quint`, `--ease-out-quart`, `--ease-in-out-quart` — all hard deceleration, no
bounce or elastic anywhere in the codebase.

**No semantic status tokens exist.** There is no `--success`, `--warning`, or `--info`.
Status colour is written as raw Tailwind palette classes at each call site (§8).

---

## 7. Layout system

- Shell: `flex` column, sidebar + `flex-1 min-w-0` content column (`App.tsx:157`) — the
  correct guard against flex-child overflow.
- Section rhythm is Tailwind's default spacing scale; there is no custom spacing token, and
  `--spacing: 0.25rem` is declared but unused.
- Breakpoints are Tailwind defaults (`sm 640 md 768 lg 1024 xl 1280 2xl 1536`); the brief's
  viewport matrix (1440/1280/1024/820/768/430/390) is tested through those.
- Cards are the dominant grouping primitive: **123 `<Card>` instances**.
- Badges: **127 `<Badge>` instances**.
- Rounding is disciplined: 98 `rounded-md`, 29 `rounded-lg`, 3 `rounded-xl`, 4 `rounded-2xl`.

---

## 8. Evidence-backed gap register

Everything below was verified by the coordinator directly against the current tree. This is
the register the synthesis in Phase 2 consumes; it does not replace the specialist reports.

### 8a. Already resolved in the unlanded WIP — agents must NOT re-report these

| Prior finding | Verification |
|---|---|
| `--ring` identical to `--primary` (1.41:1 focus defect) | `index.css:43` = `38%`, `:142` = `72%`. Divergent. **Fixed.** |
| No `prefers-reduced-motion` anywhere | `index.css:411` block, two tiers. **Fixed.** |
| Hardcoded chart hex; series 3/4/5 indistinguishable | No hex left in `analytics.tsx`/`ai-usage.tsx`/`learning-view.tsx`; `hooks/use-chart-colors.ts` added. **Fixed.** |
| All 8 shadow tokens at alpha `0.00` (elevation inert) | Real alphas throughout. **Fixed.** |
| No safe-area insets / no `viewport-fit=cover` | `quick-capture.tsx:74`, `client/index.html:5`. **Fixed.** |
| Placeholder-as-label in Quick Capture | Real `<label htmlFor>` + `aria-describedby` hint. **Fixed.** |
| No live region for async completion | `ui-shared/announcer.tsx` + wired into `quick-capture.tsx`. **Fixed.** |
| 12px type floor never applied (188 sub-12px classes) | **Cascade fixed.** Compiling `client/src/index.css` with the real content glob puts `.text-\[10px\]` at byte 62107 and the floor rule's `font-size: var(--text-meta)` at byte **93236** — same specificity, floor later in source order, so the floor now wins. The 188 classes now resolve to 12px. |

> The type-floor result is worth stating precisely, because the smell report's own
> earlier measurement showed the opposite. The WIP moved the rule out of `@layer base`
> (now index.css:230–234, no layer). That relocation is what made it fire. Reporting the
> 188 classes as a live legibility defect would now be wrong.

### 8b. Genuinely still open — verified

| # | Severity | Discipline | Location | Problem | Evidence |
|---|---|---|---|---|---|
| O1 | **HIGH** | Accessibility | `components/sources/source-card.tsx:77` | `focus:outline-none` with **no** replacement ring, on the primary Explore action of `/sources`. A keyboard user tabs onto a source title and sees nothing. | Grep: the class string ends at `focus:outline-none`; no `focus-visible:ring` on the element. |
| O2 | **HIGH** | Accessibility | `components/ui/navigation-menu.tsx:44` | `navigationMenuTriggerStyle` ends in `focus:outline-none` with only `focus:bg-accent` — a background tint is the control's own hover state and does not clear 3:1. | Grep: no `ring` in the cva base. |
| O3 | **HIGH** | Truthfulness | `ui-shared/status-badge.tsx:59-67` | `generating`, `running`, `waiting_for_approval` still differ only by hue and pulse timing. Under `prefers-reduced-motion` the pulse is removed entirely, so they collapse to near-identical tints. No non-colour signal. | The WIP switched `animate-pulse`→`pulse-live` but did not add a glyph or shape. |
| O4 | **MEDIUM** | Design system | `components/ui/card.tsx:39` | `CardTitle` defaults to `text-2xl`. **34 of 41 call sites** do not override it, so a 24px title renders inside 13px dense rows. Call sites fight the default (`workspace-cards.tsx`: 10/10 override to `text-sm`). | Grep `CardTitle` + size overrides. |
| O5 | **MEDIUM** | Design system | 250 literals across `client/src` | Raw Tailwind palette classes (`bg-emerald-700`, `text-blue-600`, `border-amber-500/30`, …) bypass the token layer. No `--success`/`--warning`/`--info` tokens exist. Concentrated in `learning-view.tsx`, `settings.tsx`, `queue.tsx`, `status-badge.tsx`. | `grep -roE "(bg\|text\|border)-(emerald\|blue\|amber\|…)-[0-9]{2,3}"` → **250**. |
| O6 | **MEDIUM** | Layout / surface | `components/insights/learning-view.tsx` | 1909 lines, **65 `<Card>` uses**. Nested `Card → CardContent → div.p-2.rounded.border` chains; five identical section headers each carrying a redundant tier Badge; three hand-rolled empty states that duplicate `EmptyState`. | Direct read + greps. |
| O7 | **MEDIUM** | Design system | `ui-shared/empty-state.tsx:37` + clones at `learning-view.tsx:681,898,1654,1829,1844,1859` | Icon-topper circle (`h-10 w-10 rounded-full bg-muted`) repeated as decoration; identical on every empty state so it distinguishes nothing. | Grep `border-dashed bg-muted/20`. |
| O8 | **LOW** | Writing | 17 instances, 9 files (`settings.tsx`, `auth.tsx`, `ingest.tsx`, `hooks.tsx`, `queue.tsx`, `imagegen.tsx`, `vault.tsx`, `chat.tsx`, `carousel.tsx`) | Exclamation-point successes: `"Posted to X!"`, `"Brand profile saved!"`, `"Copied!"`. The brief rules this out; it clusters on exactly the trust-confirming moments. | `grep -rnoE 'title: *"[^"]*!"'` → **17**. |

### 8c. Carried as known, not yet independently timed

- `e2e/accessibility.e2e.spec.ts` gate breadth — the WIP widened the axe rule set
  (`color-contrast` added); whether it now catches focus-ring contrast and reduced motion is
  unconfirmed. WT-05 owns this.
- The 49-execution viewport matrix is asserted but was not re-run at baseline. WT-06 owns it.
- Route-level code splitting through `App.tsx` is eager at baseline. WT-09 owns it.

---

## 9. Known strengths — protect these

Nine parallel agents will each be tempted to redesign something that is already right. These
are load-bearing and are not to be traded away for novelty:

1. **Genuine state design.** Today composes four independent data sources and renders a real
   loading, error, and empty state for each — and tells the operator when a list is
   *incomplete* rather than implying a clean read.
2. **Contrast.** `--foreground` 17.9:1, `--muted-foreground` 7.0:1 light / 7.2:1 dark.
3. **`ActorBadge`** — three states, each with a distinct icon *and* word, pinned by an e2e
   assertion. This is the model every other badge should follow.
4. **The token layer itself.** Semantic, theme-aware, and documented with the reasoning in
   comments. The 250 literals are the exception that proves it.
5. **Motion discipline.** Hard deceleration only; no bounce, elastic, or spring anywhere.
6. **Landmarks.** `nav aria-label="Primary"`, `<main id="main-content">`, a working skip
   link, per-route document title, `aria-current="page"` on the active route.
7. **Legacy route continuity.** 20 old paths redirect rather than 404.
8. **No navigation duplication.** One nav system; the WIP removed the competing one.

---

## 10. Constraints

**Hard (violating any of these is a rejected change):**
- Do not change the 7 canonical destinations or the legacy redirects.
- Do not introduce a second design system, second navigation, or duplicate shared component.
- Do not redesign the backend architecture or touch `server/**`.
- Do not alter autonomy / scheduler logic.
- No anthropomorphic AI wording. The agent orchestrates; a human disposes.
- Do not add product features because an agent suggested them.
- Existing functionality must remain intact; APIs and canonical routes preserved.
- `DONT_BUILD.md` **D9 forbids a visual re-skin.** Visual polish is out of scope by design —
  the answer to an under-designed surface is a behavioural or structural fix.
- Accessibility is a floor: zero axe violations on all 7 destinations, 3:1 focus indicators,
  touch targets ≈44×44px, `prefers-reduced-motion` honoured, no `maximum-scale=1`.

**Product:**
- One user, ~5 minutes of manual effort per day. Every screen is judged against *does this
  get the operator to a decision faster?*
- Truthfulness is non-negotiable: never round an uncertain state down to a clean one.
- The backend's sophistication must not become the UI's complexity. Advanced capability is
  progressively disclosed.

---

## 11. Conflict-risk map (who will collide)

Nine agents editing one tree would collide here. In Phase 4 the coordinator partitions by
file and serialises these:

| Shared artifact | At risk from | Resolution |
|---|---|---|
| `client/src/index.css` | WT-01, WT-03, WT-07 | **Single writer in Phase 4.** Only the design-system agent edits tokens. |
| `components/ui/card.tsx` | WT-01, WT-03 | Design-system agent only. |
| `components/ui-shared/*` | WT-01, WT-03, WT-04, WT-05 | Design-system agent owns; others file a request in their report. |
| `components/insights/learning-view.tsx` | WT-01, WT-04, WT-08 | **Single writer**, one relayout pass; the other two contribute findings only. |
| 250 palette literals | WT-01, WT-03, WT-08 | Design-system agent owns the token migration; others do not sweep by hand. |
| Toast copy (17 sites) | WT-07, WT-08 | One writer. |
| `e2e/accessibility.e2e.spec.ts` | WT-05, WT-06 | Accessibility owns; responsive adds a separate viewport spec file. |

**Coordination rule carried into every Phase 4 brief:** an agent that needs a change in a
file it does not own writes the exact patch into its change report instead of editing.

---

## 12. Baseline verdict

The foundation is sound and unusually honest. The token layer is real, the state design is
real, and the accessibility shell is better than average. The unlanded Phase 33.2 work has
already closed the most severe prior findings — the invisible focus ring, the inert type
floor, the missing reduced-motion handling, the theme-blind charts, and the dead elevation
system.

What remains is a bounded set of real defects: two focus-ring removals on primary paths,
one status system that still leans on hue and pulse, one 1909-line component holding the
densest surface in the product, a component default that inverts hierarchy at 34 call sites,
250 literals routing around the token layer, one duplicated empty-state motif, and 17
exclamation-point successes in a product whose constitution forbids them.

That is a refinement programme, not a redesign. Which is exactly what `DONT_BUILD.md` D9
requires.

---

*Every `file:line` in §8 was opened and checked on 2026-09-26. If a citation no longer
matches, the file moved — fix the citation rather than trusting this document.*
