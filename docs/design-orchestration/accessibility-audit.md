# ContentForge — Accessibility Audit

**Agent:** WORKTREE 5 — Accessibility
**Mode:** `/design a11y` (findings only; report only, no source modified)
**Register:** Product (authenticated single-operator tool, `.commandcode/design/brief.md:11-19`)
**Branch:** `design/wt-05` (`/Users/kishore/git/cf-design/wt-05`, content-identical to `ContentForge`, `node_modules` symlinked)
**Scope:** all 7 canonical destinations (`/today`, `/create`, `/sources`, `/agent`, `/schedule`, `/insights`, `/settings`) + shared primitives (`client/src/components/ui`, `components/ui-shared`) + the two a11y e2e specs
**Inputs:** `.commandcode/design/brief.md`, `checkup-report.md`, `smell-report.md`, `docs/full-product-ux-audit.md:65-189`, `e2e/accessibility.e2e.spec.ts`, `e2e/phase-33.2-ia-ux-accessibility.e2e.spec.ts`, `references/accessibility.md`, `references/severity.md`

---

## Verdict

**Block** — four `HIGH` findings stand (two escalation triggers). No dev server was started and no screenshot taken; every finding below cites source or a measured build artefact.

**Counts:** HIGH **4** · MEDIUM **5** · LOW **2**.

### Already-fixed items confirmed fixed (not re-reported)

- `--ring` (`index.css:43` `217 91% 38%`; dark `:142` `217 91% 72%`) is no longer equal to `--primary` (`:29` `217 91% 48%`). The 1.41:1 primary-button ring defect is resolved.
- `prefers-reduced-motion: reduce` block exists (`index.css:411-439`) and zeroes durations to `0.01ms`, not `none`.
- `viewport-fit=cover` + `env(safe-area-inset-*)` present on the capture FAB (`quick-capture.tsx:74`).
- Quick Capture has a real `<label htmlFor>` (`quick-capture.tsx:90`) and an `aria-describedby` hint (`:105`).
- A live-region primitive exists (`components/ui-shared/announcer.tsx`).
- The a11y axe rule set was widened (`accessibility.e2e.spec.ts` now runs `color-contrast` and the `--ring != --primary` token assertion).

---

## Findings

| # | Severity | Discipline | Location (file:line) | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | **HIGH** | Accessibility | `client/src/components/ui/select.tsx:121` (item) + `select.tsx:78` (surface) + `client/src/index.css:26,35` (light) `:128,137` (dark) | `SelectItem` is `outline-none focus:bg-accent focus:text-accent-foreground` drawn on a `bg-popover` panel. `--accent: 210 8% 94%` vs `--popover: 0 0% 94%` (light) and `16%` vs `14%` (dark). **Measured highlight-vs-panel contrast ≈ 1.01:1 light / 1.07:1 dark.** Same class in `dropdown-menu.tsx:84,100,124`, `context-menu.tsx:81,97,121`, `menubar.tsx:139,155,178`, `command.tsx:116`. | Keep `focus:bg-accent` as the fill but add a non-fill cue that clears 3:1 against `--popover`: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`, or shift `--accent` off `--popover`'s lightness (e.g. `210 10% 88%` light / `210 10% 22%` dark). | A keyboard user opening any `<Select>` (reachable on `/create`, `/schedule`, `/settings`, `/sources`, `/agent`) arrows through options that all look identical — the highlight is the same colour as the panel behind it. Escalation trigger: focus travels with nothing visible. The prior checkup dismissed this class as "paired with `focus:bg-accent`"; measured, `bg-accent` is not a visible focus indicator on a `bg-popover` surface. |
| 2 | **HIGH** | Accessibility | `client/src/components/sources/source-card.tsx:77` | `<button … className="text-left hover:text-primary transition-colors focus:outline-none">` — focus stripped, nothing replaces it. | Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`. | The primary Explore action on `/sources` (the source title opens the detail modal). Tab lands on it and nothing shows it landed. Escalation trigger. Carried from `smell-report.md` #1 — still open. |
| 3 | **HIGH** | Color | `client/src/pages/settings.tsx:316`; `client/src/pages/hooks.tsx:43,44`; `client/src/pages/queue.tsx:494`; root cause `client/src/index.css:12-63` | Hardcoded Tailwind ramp steps used as text instead of the contrast-tuned tokens: `text-green-500` (#22c55e) = **2.28:1** on white (`settings.tsx:316` "Active"/"Inactive"; `hooks.tsx:43`), `text-blue-500` (#3b82f6) = **3.42:1** (`hooks.tsx:44`), `text-amber-600` (#d97706) = **3.02:1** (`queue.tsx:494` X-budget line). | Use the darker ramp step that clears AA (`text-green-700`/`text-blue-700`/`text-amber-700`, all ≥ 4.5:1) or map to semantic role tokens (`--success`/`--info`/`--warning`). Not a re-skin — same hue, correct step. | Text on a background it does not have enough contrast against (escalation trigger). These sit on canonical `/settings` and `/schedule`. The suite does not catch them because these nodes only render once an account / near-limit budget exists, which the fixtures do not seed. Part of the same 250-literal token bypass `smell-report.md` #5 records. |
| 4 | **HIGH** | Accessibility | `client/src/components/ui/navigation-menu.tsx:44` | `navigationMenuTriggerStyle` ends in `focus:outline-none` with only `focus:bg-accent focus:text-accent-foreground` (same ~1:1 problem as #1). | Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` to the `cva` base. | Focus removed with no visible replacement. Caveat — **verification correction:** `NavigationMenu` is imported by nothing (grep of `client/src` finds it only in its own definition file), so this is currently **unreachable dead code**. It is HIGH-on-sight *if mounted*; today it blocks nobody. Reported because the brief explicitly lists it. |
| 5 | MEDIUM | Color | `client/src/components/ui-shared/status-badge.tsx:66-68` + `client/src/index.css:426-428` | `generating` and `running` both render `text-blue-600 dark:text-blue-400 border-blue-500/30 pulse-live`; under `prefers-reduced-motion: reduce` `.pulse-live { animation: none }`, so the two become pixel-identical. `waiting_for_approval` keeps a `bg-amber-500/10` fill. | Give each in-flight state a distinct non-colour glyph (spinner for `generating`/`running`, clock for `waiting_for_approval`) and keep the pulse as reinforcement. | Once reduced motion is honoured, the *only* visual differentiator between `generating` and `running` is gone; the text label still distinguishes them, which is why this is MEDIUM and **not** an escalation trigger (the distinction is not colour-alone). Prior `smell-report.md` #4 rated it HIGH; the text label does not make the two states misleading, only hard to scan. Brief open-work item 2. |
| 6 | MEDIUM | Accessibility | `client/src/App.tsx:78-81` (Router) · `client/src/components/ui-shared/page-header.tsx:31` | On client-side route change the effect sets `document.title` only. Nothing throws focus at the new view; `PageHeader`'s `<h1>` carries no `tabindex="-1"`. | After navigation, move focus to the route `<h1>` (`tabindex="-1"`) or `<main>`, and give `<main id="main-content">` (`App.tsx:150`) `tabindex="-1"`. | Client-side navigation changes the screen and announces nothing to a screen reader — focus stays on the nav link the user clicked. `references/accessibility.md` ("Trap and Restore") requires retitle **and** focus move. Prior checkup report praised the titles and missed the focus half. |
| 7 | MEDIUM | Accessibility | `client/src/components/ui-shared/announcer.tsx:23` · wired only at `client/src/components/quick-capture.tsx:37,42` · silent paths `client/src/pages/agent.tsx:296-307`, `client/src/components/schedule/publications-view.tsx` | The announcer primitive is consumed by exactly one surface. Agent-run completion (streamed via `applyEvents`/`streamRun`, no toast, no announce) and publication reconciliation on poll resolve with no announcement. | Call `announce(...)` on the completion transition in `agent.tsx` (run reaches `completed` / `completed_with_errors`) and in `PublicationsView` when a publication settles to `failed`/`unknown`. | Async work the operator started and walked away from completes silently for a screen reader. **Verification correction:** the prior claim that *all* async completion is silent is overstated — Radix Toast already supplies `role="status" aria-live="polite"` (`node_modules/@radix-ui/react-toast/dist/index.mjs:369-371`), so every toast-bearing mutation (approve/reject/schedule/publish) *is* announced. Only the toast-less, poll-driven transitions are genuinely silent. |
| 8 | MEDIUM | Accessibility | `client/src/pages/settings.tsx:57,274,440,523,535` (under the lone `h1` at `:368`) · `client/src/pages/agent.tsx:683,788` (before the `h2` at `:801`) | `/settings` outline is `h1 → h3` with no intervening `h2` (five section headings). `/agent` emits `h3` before its `h2`. | Demote the section labels on `/settings` to `h2` (and their children to `h3`); on `/agent` order `h2` before `h3`, or promote the run header. | A skipped heading level breaks the outline a screen-reader user navigates by (WCAG 1.3.1). The checkup report's "no skipped levels found" covered only `today.tsx`/`page-header.tsx`; the canonical `/settings` and `/agent` were not checked. Presentation is unchanged — only the tag. |
| 9 | MEDIUM | Layout | `client/src/components/ui/button.tsx:23-26`; concretely `client/src/components/sources/source-card.tsx` action buttons (`h-8`), `client/src/pages/schedule.tsx:37,41,45` (`h-7`), `client/src/components/app-sidebar.tsx:188` (`h-7 w-7`) | Shared sizes `size="sm"` = `min-h-8` (32px), `size="icon"` = `h-9 w-9` (36px); `/schedule` tab triggers are `h-7` (28px); sidebar logout `h-7 w-7` (28px). | Raise the shared `sm` step to `min-h-10` and `icon` to `h-10 w-10` on `pointer: coarse`, or extend the hit area with a pseudo-element on the wrapping control; keep the visual box if density demands. | Above the WCAG 2.5.8 AA floor (24px) but below the product's own stated bar of ~44×44px on mobile (`brief.md` "Touch targets"; `docs/full-product-ux-audit.md:187`). Secondary/desktop controls qualify for the spacing exception; the `/schedule` tabs and the sidebar logout do not have the 20px clearance it needs. |
| 10 | LOW | Accessibility | `client/src/pages/articles.tsx:194,195`; `client/src/pages/generate.tsx:374` | `className="… focus-visible:ring-0"` on `<Input>`/`<Textarea>` cancels the primitive's `focus-visible:ring-2 focus-visible:ring-ring` (`input.tsx:12`, `textarea.tsx:12`), and `articles.tsx` also sets `border-0 px-0` — leaving no focus indicator at all. | Replace `focus-visible:ring-0` with `focus-visible:ring-0 focus-visible:border-ring` (or restore the ring) so the field still shows focus. | Same defect class as #2 (focus removed) but on the inline title/subtitle/content fields. **Unreachable today:** `App.tsx` imports neither `ArticlesPage` nor `GeneratePage` (`/articles`,`/generate` redirect via `legacy-route-mapping`), so these are dead code — LOW, and a pattern to avoid if the files are ever re-routed. |
| 11 | LOW | Accessibility | `client/src/components/ui/dialog.tsx:47`; `client/src/components/ui/toast.tsx:78` | `DialogPrimitive.Close` / `ToastClose` use `focus:outline-none focus:ring-2…` (`focus:`, not `focus-visible:`). | Use `focus-visible:` for the ring on both, matching `button.tsx:8`. | A mouse click on the X paints a keyboard-only ring. Cosmetic, but it is an inconsistency in the shared focus vocabulary. |

**`ToastClose` (`toast.tsx:78`) note:** its ring is `focus:ring-2` with no `focus:ring-ring`/offset, so the ring colour falls back to Tailwind's default `--tw-ring-color` rather than the verified `--ring` token; only the `group-[.destructive]` variant pins a colour. The ring exists, its contrast is unverified — see Verification.

---

## `focus:outline-none` enumeration (every occurrence)

`grep -rn "focus:outline-none" client/src` → **9 occurrences across 8 files**.
`grep -rn "focus-visible:outline-none" client/src` → **10 occurrences across 9 files** (all paired with `focus-visible:ring-2`).
`grep -rn "outline-none" client/src` → **39 occurrences across 25 files** (the 19 above plus 20 bare `outline-none`).

### `focus:outline-none` — the 9 instances, classified

| # | Location | Replacement ring? | Detail |
|---|---|---|---|
| 1 | `client/src/components/ui/select.tsx:22` | **Yes** | `focus:ring-2 focus:ring-ring focus:ring-offset-2` |
| 2 | `client/src/components/ui/sheet.tsx:68` | **Yes** | `focus:ring-2 focus:ring-ring focus:ring-offset-2` |
| 3 | `client/src/components/ui/dialog.tsx:47` | **Yes** | `focus:ring-2 focus:ring-ring focus:ring-offset-2` |
| 4 | `client/src/components/ui/badge.tsx:8` | **Yes** | `focus:ring-2 focus:ring-ring focus:ring-offset-2` (renders a `<div>` — not focusable, so inert) |
| 5 | `client/src/components/ui/toast.tsx:63` (`ToastAction`) | **Yes** | `focus:ring-2 focus:ring-ring focus:ring-offset-2` |
| 6 | `client/src/components/ui/toast.tsx:78` (`ToastClose`) | **Yes** | `focus:ring-2` — colour falls back to Tailwind default (see note) |
| 7 | `client/src/components/ui/radio-group.tsx:29` | **Yes** | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| 8 | `client/src/components/ui/navigation-menu.tsx:44` | **No** | only `focus:bg-accent focus:text-accent-foreground` → Finding #4 (unreachable) |
| 9 | `client/src/components/sources/source-card.tsx:77` | **No** | bare `focus:outline-none` → Finding #2 |

**Result: 9 total — 7 with a replacement ring, 2 without.**

### `focus-visible:outline-none` — the 10 instances
All 10 pair with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-*` — 10/10 with a replacement ring:
`button.tsx:8`, `input.tsx:12`, `textarea.tsx:12`, `switch.tsx:12`, `slider.tsx:21`, `toggle.tsx:8`, `checkbox.tsx:14`, `resizable.tsx:32`, `tabs.tsx:30`, `tabs.tsx:45`.

### Bare `outline-none` — the remaining 20
15 of these are listbox/menu items on a `bg-popover` surface relying on `focus:bg-accent` / `data-[selected=true]:bg-accent` — the ~1:1 invisible-highlight defect in Finding #1: `context-menu.tsx:28,81,97,121`, `dropdown-menu.tsx:28,84,100,124`, `menubar.tsx:61,78,139,155,178`, `select.tsx:121`, `command.tsx:116`. The other 5 are non-focusable surfaces or contentEditable styling: `command.tsx:45`, `select.tsx:121` is counted above, `tiptap-editor.tsx:110` (`.tiptap` contenteditable — acceptable), `popover.tsx:20`, `hover-card.tsx:21`, `chart.tsx:55`.

---

## Considered but Rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `client/src/App.tsx:150` | Skip link target `<main id="main-content">` has no `tabindex="-1"` | Modern Chromium/Firefox/Safari move the sequential-focus start point to a plain anchor target, so the skip link works in practice. The related, real gap (focus after client-side navigation) is Finding #6, which cites the same element as its fix. Not a separate finding. |
| `client/src/components/ui/dialog.tsx:32-54`, `alert-dialog.tsx:28-45` | Focus trap / restore on overlays | Radix `Dialog`/`AlertDialog` provide the trap, the inert background, Escape, and focus return to the trigger. `ConfirmDialog` (`confirm-dialog.tsx:39`) and all 18 `DialogContent` call sites title themselves with `DialogTitle`. Correct as written. |
| `client/src/components/ui/tabs.tsx:30,45` | Tabs keyboard model | Radix `Tabs` delivers the full APG model (roving tabindex, arrows, Home/End); `schedule.tsx` tabs are Radix tabs. Sound. |
| `client/src/components/ui/switch.tsx:12` | Switch labelled only by adjacent text | 6 `Switch` sites render a visible sibling `<Label>`/`<span>`; no placeholder-as-label. Acceptable on source evidence. |
| `client/src/components/ui-shared/empty-state.tsx:37` | Icon-topper circle | Design/Surface smell (`smell-report.md` #9), not accessibility — the icon is correctly `aria-hidden="true"`. |
| `client/src/pages/sources.tsx`, `agent.tsx`, `create.tsx` etc. | Duplicate `<main>` / landmark count | Phase 33.2 already asserts exactly one top-level `main#main-content` (`phase-33.2-…spec.ts`); verified single `main` in `App.tsx:150`. |

---

## Verification

### Checks run

| Check | Command / method | Observed |
|---|---|---|
| `focus:outline-none` inventory | `grep -rn "focus:outline-none" client/src` | 9 occurrences, 8 files; classified — 7 with a ring, 2 without (#8 `navigation-menu`, #9 `source-card`). |
| `focus-visible:outline-none` inventory | `grep -rn "focus-visible:outline-none" client/src` | 10 occurrences, 9 files; all 10 carry `focus-visible:ring-2`. |
| All `outline-none` | `grep -rn "outline-none" client/src` | 39 occurrences, 25 files; 15 rely on `focus:bg-accent` on a `bg-popover` surface. |
| Menu-highlight contrast | Relative-luminance computation from tokens (`index.css:26,35,128,137`) | `--accent` vs `--popover` ≈ **1.01:1** light, **1.07:1** dark. Finding #1. |
| Hardcoded-hue text contrast | Relative-luminance computation from Tailwind ramp values | green-500 2.28:1, blue-500 3.42:1, amber-600 3.02:1 on white. Finding #3. |
| `--ring` ≠ `--primary` | Read `index.css:29,43,142` + `accessibility.e2e.spec.ts` assertion | Confirmed distinct (48% vs 38%/72% lightness); defect resolved. |
| Reduced motion | Read `index.css:411-439` + `status-badge.tsx:66-68` | `.pulse-live`/`.pulse-skeleton`/`.animate-spin` all neutralised; `generating`/`running` identical after. Finding #5. |
| Live regions | `grep -rn "aria-live\|role=\"status\"\|role=\"alert\"" client/src` | 1 app `aria-live` (`announcer.tsx:54`); 2 `role="alert"` (`error-state.tsx:22`, `alert.tsx:28`). Radix Toast supplies its own `aria-live` (`node_modules/@radix-ui/react-toast/dist/index.mjs:369-371`). Finding #7. |
| Focus management on nav | Read `App.tsx:77-81`, `page-header.tsx:31` | No focus move; `h1` has no `tabindex="-1"`. Finding #6. |
| Heading outline | `grep -n "<h1\|<h2\|<h3\|PageHeader" client/src/pages` | `/settings` h1→h3 skip (`settings.tsx:57,274,440,523,535`); `/agent` h3 before h2 (`:683,788` vs `:801`). Finding #8. |
| Dead code reachability | `grep -rn "from \"@/components/ui/navigation-menu\"\|ArticlesPage\|GeneratePage" client/src` + `App.tsx` route table | `navigation-menu.tsx`, `articles.tsx`, `generate.tsx` are unreferenced by the router. Findings #4, #10 down-rated accordingly. |
| Icon-only names | `grep -n "size=\"icon\"" client/src` + read each | All icon buttons carry `aria-label` or a `.sr-only` label (theme toggle `theme-toggle.tsx:12`, calendar nav, delete/bookmark, sidebar logout). No unnamed control found. |
| Non-semantic click targets | `grep -rnE "<(div\|span\|li)[^>]*onClick" client/src` | Zero. Native `<button>`/`<a href>` throughout. |

### Not verified (verification gaps — not findings)

- **Rendered focus-ring pixels and forced-colors mode** — computed from tokens; no browser run. The `ToastClose` ring colour (`toast.tsx:78`) is Tailwind's default `--tw-ring-color`, contrast unmeasured.
- **320px reflow and 200% zoom** — the viewport matrix (`docs/full-product-ux-audit.md:69-79`, 49 executions) bottoms out at **390px**; 320px is not in the matrix and the two e2e specs do not exercise it. Source-level risk noted but not asserted (e.g. `source-card.tsx:98` `max-w-[280px]` URL truncation inside a card). A browser pass is required before this becomes a finding.
- **Screen-reader announcement order** on full pages — source-assessed only.
- **axe run** — the suite cannot be executed here (no dev server started per the brief). Findings #1 and #3 are in the class axe does **not** detect anyway (focus-indicator contrast; nodes absent from fixtures), and the `--ring`/`color-contrast` assertions are the only ones that would have caught token-equal defects.
- **`prefers-reduced-motion` behavioural test** — read from `index.css`; not re-run.

---

## Next mode

`/design a11y` scoped to Findings #1, #2, #4 (focus visibility), #5 (status non-colour signal), #3 (contrast steps), #6–#8 (focus/heading semantics), #9 (hit areas). Finding #1's fix touches the `--accent`/`--popover` token pair and must be checked in both themes — it is the highest-leverage change, since one token pair governs every menu, select, dropdown and command list in the product.
