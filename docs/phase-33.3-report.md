# Phase 33.3 — Visual / Design-System / Performance Verification

**Worker 33.3 (verifier).** Read-only pass. No source file was modified. Everything below was re-measured
by this worker against branch `phase-33.3-visual-design-performance` @ `bcf1470` (identical to `main`).

**Environment.** Built with `npm run build` (`client/src/App.tsx` → `dist/public/`), served as the production
bundle on `PORT=4202` (`SESSION_SECRET` set, `SESSION_COOKIE_SECURE=0`, `CONTENTFORGE_E2E_SERVER=1`,
`DISABLE_CRON=1`) against the ephemeral PG 16.13 at `postgresql://e2e@127.0.0.1:5433/contentforge_e2e`.
Browser work used Playwright Chromium (`devices["Desktop Chrome"]`, `@axe-core/playwright`).

**Verdict.** The headline perf/palette/type/contrast numbers all reproduce. Two acceptance claims are
**falsified on close inspection**: (1) "axe violations, canonical routes: 0" is only true for the rule
subset the e2e spec checks — the full axe rule set reports 6 violations; (2) the residual palette/type
classes are **not** all on dead routes — 19 of 49 literals and 17 of 45 sub-12px classes ship in live
chunks. Both are quantified below.

---

## 1. Reproduced measurement table

"Before" was reproduced **independently** by building the pre-split commit in a throwaway git worktree
(`git worktree add --detach /tmp/…/before 4d2e9d5^`, `npm run build`), *not* taken from the audit. The
"before" bundle hash came out **byte-identical** to the claimed baseline (`index-dIeE5K35.js`).

| # | Measure | Before | After | Exact command (run in worktree root) |
|---|---|---|---|---|
| 1 | Initial JS entry | **1,792,007 B** `assets/index-dIeE5K35.js` | **362,201 B** `assets/index-DHECXVFP.js` | `ls -l dist/public/assets/index-*.js` |
| 2 | Route-split chunks | **0** | **8** (`today create sources agent schedule insights settings youtube`) | `grep -c 'lazy(' client/src/App.tsx` → `8`; `ls dist/public/assets/{today,create,…}-*.js` |
| 3 | Palette literals (`bg\|text\|border`-palette) | **250** | **49** | `grep -roE '(bg\|text\|border)-(emerald\|green\|blue\|…)-[0-9]{2,3}' --include=*.tsx --include=*.ts client/src \| wc -l` |
| 4 | Exclamation-point success copy | **17** | **0** | `grep -rnoE 'title: *"[^"]*!"' --include=*.tsx --include=*.ts client/src \| wc -l` |
| 5 | Sub-12px arbitrary classes | **188** (127×10px / 55×11px / 6×9px) | **45** (36×10px / 8×11px / 1×9px) | `grep -rnoE 'text-\[(9\|10\|11)px\]' … \| wc -l` |
| 6 | Semantic token declarations | **0** | **12** (`--success/-foreground`, `--warning/-foreground`, `--info/-foreground` ×2 themes) | `grep -cE -- '--(success\|warning\|info)(-foreground)?:' client/src/index.css` |
| 7 | `focus:outline-none` with no ring | **2** | **0** | 9→7 sites carry `focus:outline-none`; grep + ring-pairing scan (below) |
| 8 | axe `color-contrast`, canonical routes | — | **0** (7 routes × 2 themes) | `axe.withRules(["color-contrast"]).analyze()` |
| 9 | axe **all rules**, canonical routes | — | **6** | `new AxeBuilder({page}).analyze()` → see Finding A/B/C |
| 10 | CSS payload | 114,771 B | 111,933 B | `ls -l dist/public/assets/*.css` |

Supporting numbers:

| Measure | Value | Command / method |
|---|---|---|
| Total shipped JS | 1,808,894 B across **48** chunks | `ls -l dist/public/assets/*.js \| awk '{s+=$5} END{print s}'` |
| Top chunks | `create` 647,556 · `insights` 497,168 · `index`(entry) 362,201 · `sources` 72,131 · `agent` 61,596 · `schedule` 31,801 B | `ls -l dist/public/assets/*.js \| sort -rn` |
| `transition-all` | **11** (before 11) | `grep -rn 'transition-all' … \| wc -l` |
| raw `<button>` w/o `.pressable` | **36** of 37 opening tags (1 carries `.pressable`: `agent/workspace-cards.tsx`) | regex over `<button …>` incl. multiline; 35 if vendored `ui/sidebar.tsx` excluded |
| `--accent` vs `--popover` | **1.002:1 light / 1.062:1 dark** | live `getComputedStyle(documentElement)` token values |
| `--primary` as text | **5.40:1 light** (AA) / **3.40:1 dark on `--background`, 3.24:1 on `--card`** (fail) | same probe |
| status tokens on their 10% tint | light **6.20/5.85/5.71**, dark **8.81/9.00/6.32** (success/warning/info) | class-probe of `text-{role} bg-{role}/10` |

### Type floor wins the cascade (byte-offset proof)

Compiled CSS `dist/public/assets/index-9ZB74z3T.css`:

```
offset 47518  .text-\[10px\]{font-size:10px}      ← utility layer
offset 47608  .text-\[9px\]{font-size:9px}
offset 68795  .text-\[9px\],.text-\[10px\],.text-\[11px\]{font-size:var(--text-meta)}   ← floor, +21.2 KB later
```

Same specificity (one class), floor declared later in source order ⇒ it wins on order, no `!important`.
Confirmed in the browser too: on `/insights?view=ai-usage` **4 elements carry `text-[10px]/[11px]` and every
one computes to `font-size: 12px`**; the global minimum rendered font-size on `/insights`, `/insights?view=ai-usage`
and `/create` is **12px**. (`/insights`, `/create` had 0 such classes; `ai-usage` view 4, all 12px.)

### Contrast, sampled on real computed colours (7 routes × 2 themes)

A scalar text-contrast scanner (walks every element with direct text, resolves the effective background by
compositing the ancestor background stack) was **validated against a deliberate 1.24:1 control element**,
which it caught. With that scanner: **0 failing text pairs** on all seven canonical destinations in both
themes; `axe color-contrast` likewise **0**. `--primary`-as-text has no remaining rendered site on the
canonical routes (its only hit is `settings.tsx` "Get API credentials", now `text-info`: **6.59:1 dark /
6.14:1 light** via `--info`).

### Hierarchy & motion

- **Insights / learning**: 5 `<h2>` section headers, now **3 distinct rendered styles** (`text-base font-semibold`
  ×3, `text-sm font-semibold` ×1, `text-sm font-medium` ×1) and **5 distinct eyebrow labels**
  ("Action queue", "Action queue", "Learned patterns", "Measurement", "Governance queue"). No longer byte-identical. ✔
- **Agent workspace**: with a route-mocked `waiting_for_approval` run, `button-run-approve` is at DOM index
  **102**, "Execution Timeline" at **113**; `top` 628 px vs 903 px — **Approve renders above the timeline**. ✔
- **Entrance vs exit**: Quick-Capture dialog content computes `animation: enter 0.25s` open and
  `exit 0.175s` closed (`overlay-motion`). Entrance > exit. ✔
- **`prefers-reduced-motion: reduce` in two tiers** (injected-element probe): a plain 1 s transition collapses
  to **1e-05 s (0.01 ms)**; `.pulse-live` / `.rise-in` / `.animate-spin.animate-spin` compute
  `animation-name: none`. `.overlay-motion.animate-in` keeps `animation-name: enter` but duration `1e-05 s`
  (events still fire). On `/today` under `reduce`: **0 elements animating or transitioning >0.05 s**. ✔

### Responsive

All 7 routes × 7 viewports (1440×900, 1280×800, 1024×768, 820×1180, 768×1024, 430×932, 390×844) = **49
combinations, 0 horizontal-overflow** (`documentElement.scrollWidth − clientWidth ≤ 1`). ✔

---

## 2. Findings (genuine, not fixed)

| # | Severity | Where | Evidence | Concrete fix |
|---|----------|-------|----------|--------------|
| **A** | **MEDIUM** (axe impact: *critical*) | `client/src/pages/schedule.tsx:49-71` | axe `aria-valid-attr-value` on `#radix-\:ra\:-trigger-queue`: `aria-controls="radix-:ra:-content-queue"` references a **non-existent** element. The page renders `<Tabs>`/`<TabsList>`/`<TabsTrigger>` but **no `<TabsContent>`** — the panels are switched by `activeTab` outside the Tabs (`:74-84`). Both themes. | Wrap the three panels in `<TabsContent value="queue">` etc. (as `insights.tsx` / `settings.tsx` already do — they emit 0 axe violations), or replace Radix Tabs with plain buttons carrying correct `aria`. |
| **B** | **LOW** | `client/src/components/create/create-studio.tsx:432` (and `:636`) | axe `heading-order` on `/create`, both themes: `h1 → h3` skips `h2`. | Change the `Content Setup` `<h3>` to `<h2>` (and the `Generation Summary` `<h4>` to `<h3>`), or add a section `<h2>`. |
| **C** | **LOW** | `client/src/pages/queue.tsx:483` via `client/src/components/ui/alert.tsx:39` | axe `heading-order` on `/schedule`, both themes: `h1 → h5`. The `h5` is shadcn `AlertTitle` (renders `<h5>`) used for "Publish on your terms". | Render a real `<h2>` for that callout (`AlertTitle asChild` wrapping an `<h2>`), or drop the shadcn h5 element. |
| **D** | **LOW** | residual sweeps | The known "dead routes" justification is **incomplete**. 19 of the 49 palette literals and 17 of the 45 sub-12px classes are in files **statically imported by live routes**: `create.tsx` imports `imagegen`(3 literals), `canned-responses`(1), and `templates`(2 sub-12px); `insights.tsx` imports `analytics`(1 literal, 8 sub-12px) and `ai-usage`(6 literals, 6 sub-12px); `x-post-preview.tsx`(8 literals) is used by `artifact-review*`/`publish-preview`. Confirmed shipped: `grep` finds **19 palette literals and 17 sub-12px strings inside `create-eFNtuSJX.js`, `insights-ZZNqo5um.js`, `x-post-preview-DSzPyojo.js`**. (Truly dead: `discover` 20, `generate` 7+2, `ideas` 2+2, `vault` 1, `references` 4.) | Extend the sweep to the live legacy views reachable from `/create` and `/insights`, and the shared `x-post-preview`. |
| **E** | **INFO** | residual claim itself | "`--primary` as text below AA (3.04 dark / 3.68 light)" is **half wrong**. Measured: dark **3.40:1** on `--background` / **3.24:1** on `--card` (below AA, real); light **5.40:1** on `--background` (AA **pass**). The "3.68 light" figure is the `blue-500` literal (`217 91% 60%`), not `--primary` (`217 91% 48%`). No rendered `text-primary`-as-text site remains on canonical routes. | Dark-mode only; the deferred `--primary-text` role token is the right fix. Correct the residual note so light mode isn't chased. |
| **F** | **LOW** | narrow viewports | Interactive controls **under WCAG 2.2 SC 2.5.8's 24×24** minimum: `/create` 7 suggestion chips **20 px tall** ("Educate & explain", …); `/sources` 1 button **149×16** ("Research a specific URL"); `/settings` 3 help links **16 px tall** (`link-help-x/threads/linkedin`); `/schedule` "official X API" 70×17 (inline — exception applies). Under 44×44: **164** controls across the 7 routes. | Raise the chips and standalone help links to ≥24 (ideally 44) px, or ensure the 2.5.8 spacing exception holds. |
| **G** | **INFO** | `/create` chunk | The split fixed the entry (362 KB) but `/create` now ships **647,556 B** (> Vite's 500 kB warning) and `/insights` 497,168 B — the tiptap/prosemirror/highlight.js cluster. Not on the known-gaps list. | Add `build.rollupOptions.output.manualChunks` for `@tiptap/**`+`prosemirror-*`+`highlight.js` (and `recharts`+`d3-*`), so the editor/chart code is only paid when used. |

---

## 3. Not measured / not verifiable here

- **Coarse-pointer (`@media (pointer:coarse)`) touch targets.** Playwright Chromium here runs
  `devices["Desktop Chrome"]` with a **fine** pointer. The app's coarse-pointer branches compile
  (`@media(pointer:coarse){.…\:h-11{height:2.75rem} .…\:w-11{width:2.75rem}}` at CSS offset 111214, plus
  `app-sidebar.tsx:160,202`, `App.tsx:245`, `quick-capture.tsx:109`, `theme-toggle.tsx:20`) but **never
  match in this harness**. Real-device hit areas (sidebar toggle, nav rows) are therefore not measurable
  here — structurally invisible, as the brief anticipated. The under-44/under-24 counts in Finding F are
  the fine-pointer values only.
- **Data-populated rendering.** The e2e DB seeds no demo data (`demo data seed disabled`), so populated
  queues, charts, tables and populated `StatusBadge` rows were not exercised. Contrast/heading/axe were
  measured on the empty-state render plus route-mocked agent (`?runId=30`) and empty learning views.
  The semantic-token check is by **token value + compiled-class probe + source mapping**
  (`status-badge.tsx:133-143`), not by a data-populated badge.
- **Per-package gzip attribution** of the new chunks — only raw chunk bytes were measured.
- **Load performance** (TTFB/LCP/TBT/CLS) — no trace harness was run; only payload sizes.
- **`.pressable` runtime feedback** — counted as a class, not observed as motion.
- **Screen-reader / AT behaviour** of the dangling `aria-controls` — inferred from axe, not tested with an AT.

---

## 4. Method notes

- Baseline "before" reproduced from `4d2e9d5^` (`fb4d29f`) in a temporary git worktree (since removed).
- The contrast scanner was control-validated (deliberate 1.24:1 element detected) before its 0-failure
  result was trusted.
- axe run with **all rules enabled** on 7 routes × 2 themes returned: `dark /create: heading-order`,
  `dark /schedule: aria-valid-attr-value + heading-order`, `light /create: heading-order`,
  `light /schedule: aria-valid-attr-value + heading-order` (**6 total**). The committed
  `e2e/accessibility.e2e.spec.ts` only asserts `document-title/meta-viewport/button-name/label` and
  `color-contrast`, so it passes while these remain — that is why the acceptance claim read "0".
