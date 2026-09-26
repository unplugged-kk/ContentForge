# Design System Audit — Worktree 3 (shared system: tokens, spacing, type, buttons, badges, dialogs, tabs, cards, forms, shared states)

**Mode:** `/design tokenize` (consolidation, **not** a re-skin — `DONT_BUILD.md` D9 stands)
**Register:** Product — authenticated single-operator tool (`brief.md:11-19`)
**Scope:** the shared layer of `client/src/**` — the token layer, and the shared primitives in
`client/src/components/ui/**` + `client/src/components/ui-shared/**`, plus every call site that
routes around them.
**Repo:** `/Users/kishore/git/ContentForge` (read-only). All checks run in `/Users/kishore/git/cf-design/wt-03`.
**Date:** 2026-09-26
**Findings owned:** smell-report #5 (hardcoded palette), #6 (nested surfaces), #8 (CardTitle), #9 (empty-state).
Report #4 (hue-only status distinction) and #3 (type floor) are **not** re-reported — #3 is already fixed in
`index.css` (the floor now sits outside `@layer base`, so it wins on source order) and #4 belongs to the
`a11y` pass.

> **Nothing was changed.** No source file in either tree was written. This is a discovery report plus a
> concrete, contrast-verified token proposal. The only file created is this report.

---

## Score

**5/10 — STRONG foundation, unenforced at the call site.**

The token layer is the best-engineered thing in this repo: two themes, an HSL `hsl(var(--x) / <alpha-value>)`
contract, a re-derived chart ladder, a real motion system, a working reduced-motion tier, and a `--ring`
tuned against its own offset rather than against `--primary`. The defect is not the foundation. It is that
the foundation **stops at the primitives**: the moment a screen needs a success, warning or info state —
which is most screens — there is no token to reach for, so 250 literal Tailwind palette classes were written
at the call site instead. The palette then reads as generic (`emerald-700`, `blue-600`, `amber-500` are stock
Tailwind ramps, not a chosen hue) *and* fails contrast, because values picked by eye are not values picked
against a threshold.

Two of the four shared primitives I was asked to check are, in my verified reading, better than the smell
report said (the `CardTitle` default is never actually rendered; the icon-topper circle is not cloned). Two
are worse (the empty-state language has forked 4 ways; the status vocabulary has forked 4 ways).

---

## Findings

Ordered by severity, then by reach and leverage. One root cause, one row.

| # | Severity | Discipline | Location (file:line) | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | **HIGH** | Accessibility | `client/src/components/ui-shared/status-badge.tsx:64-72`, `client/src/pages/settings.tsx:281,316,448`, `client/src/pages/calendar.tsx:125-128,134-135`, `client/src/lib/constants.ts:35-42`, `client/src/pages/hooks.tsx:43-44,81-88`, `client/src/pages/ai-usage.tsx:211,217`, `client/src/pages/analytics.tsx:101`, `client/src/components/create/artifact-review-view.tsx:549` | Status text is a hardcoded light-mode literal: `text-amber-600` on `bg-amber-500/10` = **2.95:1**, `text-emerald-600` on `bg-emerald-500/10` = **3.35:1**, `text-green-500` = **2.28:1**, `text-red-500` = **3.76:1**, bare `text-emerald-400` = **1.92:1** | Move every light-mode status text to a `-foreground` token whose value clears **4.5:1** (see §2). `text-success-foreground`, `text-warning-foreground`, `text-info-foreground`, `text-destructive-text` | WCAG 2.2 SC 1.4.3. Measured by calculation (below the 4.5:1 floor for 12px text), not by eye. This is the escalation trigger "text sitting on a background it does not have enough contrast against" — and it is the whole success/warning text set, not one badge |
| 2 | **HIGH** | Color | `client/src/index.css:37` (`:root`) vs `client/src/index.css:139` (`.dark`) · 23 call sites, e.g. `client/src/pages/queue.tsx:333`, `client/src/pages/agent.tsx:729`, `client/src/components/ui/form.tsx:98` | `--destructive: 0 84% 42%` is **byte-identical in both themes**, so error text uses `text-destructive` at **3.04:1** against `--background` (#141414) and **2.87:1** against `--card` in dark mode | Add `--destructive-text` (light `0 74% 38%` = 7.39:1; dark `0 84% 72%` = 7.04:1) for text/border on the page, and re-derive dark `--destructive: 0 78% 62%` with `--destructive-foreground: 0 0% 8%` (5.14:1 on the fill) | The token was authored for light mode and never re-derived — the exact "dark mode by inversion / not re-authored" failure `color.md` names. Distinct root cause from #1 (a token value, not a literal) |
| 3 | **MEDIUM** | Color | `client/src/index.css` (tokens) · **250** literals across **27** files, densest in `components/insights/learning-view.tsx` (45), `components/ui-shared/status-badge.tsx` (32), `pages/hooks.tsx` (22) | `bg-emerald-700 hover:bg-emerald-800 text-white`, `bg-blue-600 hover:bg-blue-700 text-white`, `text-amber-600 dark:text-amber-400 border-amber-500/30` written inline at each call site. **No `--success`, `--warning` or `--info` token exists anywhere** | Add the three semantic role families in §2, map them in `tailwind.config.ts`, replace all 250 literals. Error folds onto the existing `--destructive` family | The token layer is the strongest thing here and 250 instances route around it. It is also why the palette reads as generic — see §1 for the full inventory. `/design tokenize`, explicitly **not** `/design recolor` |
| 4 | **MEDIUM** | Surface | `client/src/components/ui-shared/status-badge.tsx:63-72` · `client/src/pages/calendar.tsx:122-131` · `client/src/lib/constants.ts:35-42` · `client/src/pages/settings.tsx:34-45` · `client/src/pages/articles.tsx:28-31` · `client/src/pages/hooks.tsx:51-89` · `tailwind.config.ts:78-83` | **Four** status vocabularies coexist. `STATUS_TONE` (emerald/amber/blue + tint + border), `getStatusStyle` (green/amber/blue/red + tint, no border), `POST_STATUSES` (amber-500/green-500/blue-500/red-500, **0 consumers**), and `tailwind.config.ts` `status.{online,away,busy,offline}` (**0 consumers**, raw `rgb()`). "Scheduled" renders three different ways; "success/posted" uses **both** `emerald` and `green` | One vocabulary. Keep `status-badge.tsx`'s `STATUS_TONE`, re-express it on the role tokens, delete the dead `POST_STATUSES` and the dead `status.*` config block, and make `calendar.tsx`/`settings.tsx`/`articles.tsx` consume `StatusBadge` | The brief's rule is that a state is never rounded down; that is unenforceable while the same state has four sources of truth. `emerald` vs `green` for the same "posted" meaning is the grey-test failure `color.md` warns about |
| 5 | **MEDIUM** | Surface | `client/src/components/ui-shared/empty-state.tsx:30-56` (+ circle at `:37`) · hand-rolled clones at `components/sources/research-tab.tsx:173`, `saved-tab.tsx:318`, `discover-tab.tsx:371,482`, `pages/agent.tsx:665,812,906`, `components/insights/learning-view.tsx:681,898,1654`, `pages/imagegen.tsx:205,221`, `components/agent/workspace-cards.tsx:256` | The shared `EmptyState` is used **10** times. **13** more empty states are hand-built in a *competing* visual language: `rounded-lg border border-dashed` (vs shared `rounded-md`), icon at `h-8 w-8 opacity-40 text-primary` with **no** circle (vs shared `h-10 w-10 rounded-full bg-muted`), `<h3 className="text-sm font-semibold">` (vs shared `<p className="text-sm font-medium">`), `space-y-2` (vs `gap-2`) | Route all 13 through `EmptyState`; drop the circle wrapper at `:37` so the icon renders at `h-5 w-5` directly | One concept, four languages. `tokenize.md`: "several versions of one control drifting apart". The circle is the icon-topper tell and it distinguishes nothing |
| 6 | **MEDIUM** | Type | `client/src/components/ui/card.tsx:39` (`CardTitle` default) vs **41** call sites across **19** files | Default is `text-2xl font-semibold leading-none tracking-tight` (24px). **All 41 call sites carry an explicit size override** — `text-sm` (27), `text-base` (6), `text-xs` (5), `text-sm sm:text-base` (3) | Change the default to `text-sm font-semibold leading-tight tracking-tight` | **Correction to smell-report #8.** That report claims "34 carry no size override and therefore render at 24px". Re-verified with a multiline parse: **41 call sites, 0 un-overridden, 0 with a multiline open tag** — nothing renders at 24px. The defect is real but different: the component's own default contradicts 41/41 consumers, i.e. a dead default that would misfire the moment someone writes `<CardTitle>` naively |
| 7 | **MEDIUM** | Surface | `client/src/components/ui-shared/page-header.tsx:37` (`text-lg font-semibold`) · divergent titles at `pages/discover.tsx:263`, `pages/ingest.tsx:253`, `pages/references.tsx:122`, `pages/articles.tsx:263`, `pages/not-found.tsx:13`, `pages/auth.tsx:69` | The shared `PageHeader` is used by **7** files. **28** pages hand-roll their own `<h1>`. **32** use `text-lg font-semibold` (matches the primitive); **9** use `text-2xl font-bold` — two title scales for the same element | Route the 28 hand-rolled headers through `PageHeader`; normalise the 9 `text-2xl font-bold` titles to the primitive's scale | Same concept, two visual languages, and a shared primitive bypassed 4:1 — `tokenize.md`'s extraction-bar failure. `DESIGN_SYSTEM_AUDIT.md` §6 flagged this pre-Phase and it is still standing |
| 8 | **MEDIUM** | Color | `client/src/components/insights/learning-view.tsx:737,940,1165,1221,1690,1716,1779` | Primary actions (`Accept`, `Apply`, `Run`) are painted success-green: `<Button className="… bg-emerald-700 hover:bg-emerald-800 text-white">` (7×) and `bg-blue-600 hover:bg-blue-700 text-white` (3×) | Use `bg-primary text-primary-foreground` (the app's one primary action colour), or a tokenised success fill if the semantics genuinely differ from a primary action | The app's single primary is `--primary: 217 91% 48%` (blue) by constitution (`brief.md:236`). A green "Accept" next to a blue "Approve" elsewhere is the same decision rendered two ways. Note this is where **all 10** solid palette fills live — one file, one fix |
| 9 | **LOW** | Type | `tailwind.config.ts:78-83` | `status: { online: "rgb(34 197 94)", away: "rgb(245 158 11)", busy: "rgb(239 68 68)", offline: "rgb(156 163 175)" }` — 0 consumers, and raw `rgb()` so the `/alpha-value` modifier does not work (`bg-status-online/20` silently emits nothing) | Delete the block; the role tokens in §2 replace it | A dead semantic namespace that breaks the one contract the rest of the config honours (`hsl(var(--x) / <alpha-value>)`). `UI` already had to work around it once (`DESIGN_SYSTEM_AUDIT.md` §3: "Status colour therefore has two sources") |

**Severity counts:** HIGH 2 · MEDIUM 6 · LOW 1.

---

## 1. The hardcoded-palette inventory (finding #3 — the central question)

### 1.1 Exact count

```
grep -roE '(bg|text|border)-(emerald|green|blue|sky|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|teal|cyan)-[0-9]{2,3}' --include=*.tsx --include=*.ts client/src | wc -l
```
**250** (matches smell-report #5). Widening the property prefix to include `ring|fill` adds exactly two more
(`components/ui/toast.tsx:78` `ring-red-400`, `pages/canned-responses.tsx:135` `fill-amber-400`) → **252**.
The **250** figure is the `bg|text|border` set and is the number to hold.

### 1.2 Distribution by file — 250 across 27 files

| File | Count |
|---|---|
| `components/insights/learning-view.tsx` | 45 |
| `components/ui-shared/status-badge.tsx` | 32 |
| `pages/hooks.tsx` | 22 |
| `pages/discover.tsx` | 20 |
| `pages/settings.tsx` | 19 |
| `pages/calendar.tsx` | 14 |
| `pages/agent.tsx` | 14 |
| `components/sources/source-detail-modal.tsx` | 14 |
| `components/x-post-preview.tsx` | 8 |
| `pages/generate.tsx` | 7 |
| `pages/articles.tsx` | 6 |
| `pages/ai-usage.tsx` | 6 |
| `pages/ingest.tsx` | 5 |
| `components/create/artifact-review-view.tsx` | 5 |
| `lib/constants.ts` | 4 |
| `components/ui-shared/actor-badge.tsx` | 4 |
| `components/sources/discover-tab.tsx` | 4 |
| `components/create/create-studio.tsx` | 4 |
| `pages/vault.tsx` | 3 |
| `pages/imagegen.tsx` | 3 |
| `pages/today.tsx` | 2 |
| `pages/queue.tsx` | 2 |
| `pages/ideas.tsx` | 2 |
| `components/ui/toast.tsx` | 2 |
| `pages/canned-responses.tsx` | 1 |
| `pages/analytics.tsx` | 1 |
| `components/insights/automated-optimization-panel.tsx` | 1 |

The top three files hold **99 of 250 (40%)**. Two of them are shared: `status-badge.tsx` is the single
highest-leverage consumer in the repo, and `learning-view.tsx` is the highest-volume one.

### 1.3 Distribution by semantic intent

| Intent | Hues (narrow set) | Literals | Has a token today? |
|---|---|---|---|
| **warning / caution** | amber 87, orange 12, yellow 3 | **102** | **No** |
| **success** | emerald 49, green 31 | **80** | **No** |
| **info / in-progress** | blue 34, sky 2 | **36** | **No** |
| **error** | red 20, rose 1 | **21** | Partial — `--destructive` exists (see finding #2) |
| **categorical** (no semantic role) | purple 7, pink 2, cyan 2 | **11** | **No** (and should not get one — see §2.4) |
| | | **250** | |

**Intents with no token today: success, warning, info.** Error has one token that is mis-scoped for dark
mode. Categorical colour is used in `hooks.tsx:81-88` (hook *types*),
`articles.tsx:28-31` (article status), and `ai-usage.tsx:167,190,224` (provider marks) — those are
*identities*, not states, and they are the right candidates for the existing `--chart-1..5` ramp rather than
a sixth semantic set.

### 1.4 Surface treatments in the wild (why one token per intent is not enough)

The same role is written with **four different surface treatments** and no shared convention:

| Treatment | Example |
|---|---|
| tinted badge + border | `status-badge.tsx:70` `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30` |
| tinted badge, no border | `calendar.tsx:127` `bg-green-500/10 text-green-500 dark:bg-green-500/20` |
| bare text | `constants.ts:39` `text-green-500` |
| solid fill + white text | `learning-view.tsx:737` `bg-emerald-700 hover:bg-emerald-800 text-white` |
| banner, "soft" family | `agent.tsx:677` `border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40` |
| banner, "alpha" family | `create-studio.tsx:272` `border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400` |

Two of those are the *same warning banner component* written two ways (finding #4/grey-test). The token set
below normalises all of them to *one* of two treatments: tinted-with-border (`bg-{role}/10`,
`border-{role}-border`, `text-{role}-foreground`) or plain text.

---

## 2. Proposed semantic token set (contrast-verified)

Naming follows **the repo's own convention**, not a new one: `--{role}`, `--{role}-foreground`,
`--{role}-border` — the exact shape of the existing `destructive` family (`tailwind.config.ts:49-53`).
The brief's `--success-fg` shorthand maps to `--success-foreground`; I use the project's spelling so this is
one system, not two. Error is **not** given a new name — it extends the existing `destructive` family.

### 2.1 `client/src/index.css` — add to `:root` (light)

```css
  /*
   * Semantic state roles. success / warning / info had no token at all, so 218
   * literals were written at the call site and picked by eye. Every value below
   * is measured, not chosen:
   *   -foreground  clears 4.5:1 against --background, --card, and its own /10 tint
   *   DEFAULT/-border clear 3:1 for fills and boundaries (WCAG 2.2 SC 1.4.11)
   */
  --success: 152 60% 36%;              /* #25935f  3.88:1 bg / 3.71:1 card */
  --success-foreground: 152 55% 30%;   /* #22774f  5.50:1 bg  · 4.88:1 on bg-success/10 */
  --success-border: 152 58% 33%;       /* #238557  4.60:1 bg */
  --warning: 30 92% 36%;               /* #b05c07  4.79:1 bg / 4.59:1 card */
  --warning-foreground: 32 92% 30%;    /* #935106  6.14:1 bg  · 5.39:1 on bg-warning/10 */
  --warning-border: 32 90% 32%;        /* #9b5608  5.63:1 bg */
  --info: 221 83% 48%;                 /* #1555e0  6.16:1 bg / 5.90:1 card */
  --info-foreground: 221 78% 42%;      /* #184cbf  7.43:1 bg  · 6.40:1 on bg-info/10 */
  --info-border: 221 80% 45%;          /* #1751cf  6.74:1 bg */
  --destructive-text: 0 74% 38%;       /* #a91919  7.39:1 bg  — error text on the page */
```

### 2.2 `client/src/index.css` — add to `.dark`

```css
  --success: 152 55% 42%;              /* #30a66f  5.97:1 bg / 5.64:1 card */
  --success-foreground: 152 52% 70%;   /* #8bdab5 11.22:1 bg  · 9.88:1 on bg-success/10 */
  --success-border: 152 45% 55%;       /* #59c090  8.22:1 bg */
  --warning: 38 92% 52%;               /* #f5a314  8.89:1 bg / 8.40:1 card */
  --warning-foreground: 38 88% 68%;    /* #f5c166 11.14:1 bg  · 9.47:1 on bg-warning/10 */
  --warning-border: 38 80% 60%;        /* #ebaf47  9.44:1 bg */
  --info: 217 83% 58%;                 /* #3b7fed  4.78:1 bg / 4.51:1 card */
  --info-foreground: 217 85% 72%;      /* #7ba9f4  7.74:1 bg  · 6.96:1 on bg-info/10 */
  --info-border: 217 75% 66%;          /* #6799e9  6.41:1 bg */
  --destructive-text: 0 84% 72%;       /* #f47c7c  7.04:1 bg  — error text on the page */
  /* --destructive was identical to light mode and failed 3:1 on dark. Re-derived: */
  --destructive: 0 78% 62%;            /* #ea5353  fill; 5.14:1 for --destructive-foreground on it */
  --destructive-foreground: 0 0% 8%;   /* dark text on the lighter dark-mode fill */
```

Every pair above was computed, not asserted — see §5 Verification. `info` sits 4° above `--primary`
(217) and is used **only** in the tint/border/text treatment, never as a solid button fill, so it cannot be
confused with a primary action.

### 2.3 `tailwind.config.ts` — exact mapping

Add inside `theme.extend.colors` (after the existing `destructive` block at `tailwind.config.ts:49-53`), and
**delete** the dead `status` block at `tailwind.config.ts:78-83`:

```ts
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(var(--success-foreground) / <alpha-value>)",
          border: "hsl(var(--success-border) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(var(--warning-foreground) / <alpha-value>)",
          border: "hsl(var(--warning-border) / <alpha-value>)",
        },
        info: {
          DEFAULT: "hsl(var(--info) / <alpha-value>)",
          foreground: "hsl(var(--info-foreground) / <alpha-value>)",
          border: "hsl(var(--info-border) / <alpha-value>)",
        },
```

`--destructive-text` needs no second mapping: with `--destructive` re-derived for dark it stays the error
*tone* used through `text-destructive` only where the element is not a fill; for text-on-page use
`text-destructive-text` via one added line in the same `destructive` object:

```ts
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
          text: "hsl(var(--destructive-text) / <alpha-value>)",   // ADD — error text on the page
        },
```

### 2.4 Replacement map (literal → token)

| Literal family | Replace with | Call-site count |
|---|---|---|
| `text-emerald-600 dark:text-emerald-400`, `text-emerald-700`, `text-green-500`, `text-green-600`, bare `text-emerald-400` | `text-success-foreground` | ~34 |
| `bg-emerald-500/10`, `bg-emerald-500/20`, `bg-green-500/5`, `bg-green-500/10`, `bg-green-500/20` | `bg-success/10` (drop the `/20` variants — one tint) | ~16 |
| `border-emerald-500/30`, `border-emerald-500/40`, `border-green-500/20`, `border-green-500/40` | `border-success-border` | ~11 |
| `bg-emerald-700 hover:bg-emerald-800 text-white` | `bg-primary text-primary-foreground` | 7 |
| `text-amber-600 dark:text-amber-400`, `text-amber-700`, `text-amber-500`, `text-orange-500` | `text-warning-foreground` | ~28 |
| `bg-amber-500/10`, `bg-amber-500/20`, `bg-amber-50 dark:bg-amber-950/40`, `bg-orange-500/5`, `bg-orange-500/10` | `bg-warning/10` | ~20 |
| `border-amber-500/30`, `border-amber-300 dark:border-amber-800`, `border-orange-500/30` | `border-warning-border` | ~14 |
| `text-blue-500`, `text-blue-600 dark:text-blue-400`, `text-blue-700`, `text-sky-400` | `text-info-foreground` | ~17 |
| `bg-blue-500/10`, `bg-blue-500/20` | `bg-info/10` | 6 |
| `border-blue-500/20`, `border-blue-500/30` | `border-info-border` | 4 |
| `bg-blue-600 hover:bg-blue-700 text-white` | `bg-primary text-primary-foreground` | 3 |
| `text-red-500`, `text-red-600`, bare `text-red-400`, `text-rose-600` | `text-destructive-text` | ~11 |
| `bg-red-500/10`, `bg-red-500/20` | `bg-destructive/10` | 4 |
| `text-purple-*`, `text-pink-*`, `bg-cyan-500/10 text-cyan-500` (categorical) | fold onto `--chart-1..5` where the identity is data (`hooks.tsx` types, `articles.tsx`), else `text-muted-foreground` | 11 |

`actor-badge.tsx:57` (`text-amber-700 dark:text-amber-400 border-amber-500/40 bg-amber-500/10`) is the
single best-behaved literal in the repo — it is a deliberate 3-state component. It becomes
`text-warning-foreground border-warning-border bg-warning/10` in the same pass, not a separate finding.

### 2.5 What this is *not*

- Not a re-skin. No hue changes visually: `success` is the emerald/green family already in use, `warning`
  is the amber family, `info` is the blue family. Only the **values shift to clear the thresholds** — the
  same hue, re-derived for legibility, the way `--ring` and `--chart-1..5` already were.
- Not a new component library. Zero new components; three token families plus one extension of an existing
  one, and one dead config block removed.
- Not a second design system. The proposal **reuses the project's** `hsl(var(--x) / <alpha-value>)` contract
  and `--{role}-foreground` naming, and folds the dead `status.*` namespace *into* it.

---

## 3. Verified against the smell report (#5, #6, #8, #9)

| Smell report claim | Verified result |
|---|---|
| #5 — 250 hardcoded palette instances, densest `learning-view.tsx` (45) | **Confirmed exactly.** 250 (`bg|text|border`); 252 with `ring`/`fill`. 45 in `learning-view.tsx`. Top intent is warning (102), then success (80). |
| #5 — "no `--success`/`--warning`/`--info` token" | **Confirmed.** `grep -n 'success|warning|info' client/src/index.css tailwind.config.ts` → 1 hit, and it is inside a comment. `tailwind.config.ts` has only the dead `status.*` block. |
| #8 — `CardTitle` default `text-2xl`, "41 call sites / 34 un-overridden" | **Partially contradicted.** 41 call sites confirmed. **0 un-overridden** — every one of the 41 carries an explicit size. Nothing renders at 24px today. The default is *dead*, not harmful. See finding #6. |
| #9 — `empty-state.tsx:37` circle "and 3 further hand-rolled clones repeat the motif", clones at `learning-view.tsx:682,899,1301,1655` | **Contradicted as stated.** The circle at `:37` is the *only* circle — **0 clones**. `learning-view.tsx:683,900,1656` render a bare `h-8 w-8` icon with **no** circle; `:1301` is an "unconfigured" state with `AlertCircle text-amber-500`. The real, larger finding is the opposite: the hand-rolled empties use a *competing* circle-less language. See finding #5. |
| #6 — nested surfaces in `learning-view.tsx` | **Confirmed., not re-reported as a token finding** — it is a `relayout` job, and it is the *reason* the 45 literals cluster in that file. | 

---

## 4. Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `components/x-post-preview.tsx:51,57,65,76` | `bg-slate-600`, `text-slate-400` — 4 neutral literals | It simulates X's own tweet chrome (avatar ring, thread rail, muted meta). Converting it to project tokens would make the preview stop looking like the platform it previews. It is a third-party brand surface, exactly like the brand hexes at `channel-icon.tsx:56-58`. |
| `pages/carousel.tsx:31,178,252` · `lib/constants.ts:2-8,52-58` | Gradient fills, `CONTENT_PILLARS` hex, `CAROUSEL_BACKGROUNDS` hex | The *content* the operator is designing, and persisted data. `color.md` is explicit that a client-controlled artwork fill is not a UI gradient. Out of a token pass. |
| `pages/imagegen.tsx:242,263,272` | `text-red-400` heart / `hover:bg-red-500/60` on image tiles | Sits on a photographic overlay, not on `--background`; the value was chosen against the image, and I could not measure the rendered image background. Not reportable as a finding (unverified), and too small to matter. |
| `components/ui/drawer.tsx:51`, `components/ui/avatar.tsx:43`, `pages/formatter.tsx:97` | `rounded-full bg-muted` matches | Share the class string with the empty-state circle but are a drag handle, an avatar fallback, and a progress track. No relationship. Folded into finding #5's evidence, not counted as clones. |
| `pages/auth.tsx:69`, `pages/auth.tsx:61` | `text-2xl font-bold tracking-tight` title; gradient wash | `auth.tsx` is a pre-authentication surface outside the operator ritual; the `text-2xl` is part of finding #7's count, and the gradient was already assessed and rejected in the smell report. |
| `pages/ingest.tsx:321` | `border-2 border-dashed … cursor-pointer` | A drop target, not an empty state. Different job. Correct as-is. |

---

## 5. Verification

### 5.1 Counts (all re-run in `/Users/kishore/git/cf-design/wt-03`)

| Check | Command | Observed |
|---|---|---|
| Palette literals | `grep -roE '(bg\|text\|border)-(emerald\|…)-[0-9]{2,3}' --include=*.tsx --include=*.ts client/src \| wc -l` | **250** across **27** files |
| Palette + ring/fill | same, wider prefix | 252 (adds `ring-red-400`, `fill-amber-400`) |
| Intent split | same, piped through `sed` + `uniq -c` | warning 102 · success 80 · info 36 · error 21 · categorical 11 = 250 |
| No semantic token | `grep -n 'success\|warning\|info' client/src/index.css tailwind.config.ts` | comment-only hit; no token |
| Dead status vocabulary | `grep -rn 'status-online\|status-busy\|status-away\|status-offline' client/src` | **0** |
| Dead `POST_STATUSES` | `grep -rn 'POST_STATUSES' client/src` | **1** (the declaration only) |
| `CardTitle` call sites | `grep -roE '<CardTitle[ >]' --include=*.tsx client/src \| wc -l` | 41 across 19 files |
| `CardTitle` un-overridden | perl multiline parse of `<CardTitle…>` for `text-(xs\|sm\|base\|lg\|xl\|2xl\|3xl\|4xl)` | **0** un-overridden |
| `CardTitle` multiline open tags | `grep -rnE '<CardTitle\s*$'` | **0** (so the line-based read is not the discrepancy) |
| `PageHeader` consumers | `grep -rln '<PageHeader' client/src` | 7 of 28 pages |
| Hand-rolled `<h1>` scales | `grep -rnE '<h1' \| grep -E 'text-(2xl\|xl\|lg)'` | `text-2xl` ×9 · `text-lg` ×32 |
| `EmptyState` consumers | `grep -rn '<EmptyState' client/src` | 10 |
| Hand-rolled empty containers | `grep -rn 'border-dashed' client/src` | 13 competing + 2 shared + 3 feature-tiles + 1 drop-zone |
| Icon-topper circle | `grep -rn 'rounded-full bg-muted' client/src` | 1 real instance (`empty-state.tsx:37`); drives are unrelated |
| Solid palette fills | `grep -rn 'bg-emerald-700\|bg-blue-600\|bg-blue-700\|bg-emerald-800' client/src` | 10, all in `learning-view.tsx` |

### 5.2 Contrast (computed, WCAG 2.x relative-luminance formula)

Scripts: `scratchpad/contrast.mjs`, `scratchpad/tokens.mjs`, `scratchpad/text-lit.mjs`.
Composited alpha through sRGB, comparing each token against `--background` (`#ffffff` / `#141414`) and
`--card` (`#fafafa` / `#1a1a1a`), and against each role's own `bg-{role}/10` tint.

**Current literals, light mode (fail < 4.5:1 for text):**

| Literal | on `#fff` | on its own /10 tint | Verdict |
|---|---|---|---|
| `text-amber-600` (#D97706) | 3.19:1 | **2.95:1** | FAIL |
| `text-emerald-600` (#059669) | 3.77:1 | **3.35:1** | FAIL |
| `text-green-500` (#22C55E) | **2.28:1** | — | FAIL |
| `text-blue-500` (#3B82F6) | **3.68:1** | — | FAIL |
| `text-red-500` (#EF4444) | **3.76:1** | — | FAIL |
| `text-emerald-400` (#34D399) | **1.92:1** | — | FAIL |
| `text-amber-400` (#FBBF24) | **1.67:1** | — | FAIL |
| `text-amber-700` (#B45309) | 5.02:1 | — | pass |
| `text-emerald-700` (#047857) | 5.48:1 | — | pass |
| `text-blue-600` (#2563EB) | 5.17:1 | — | pass |

Across the 36 unique `text-*` literals in the 250: **8 unique clear 4.5:1 on white; 28 unique do not** — but
the failing set includes values that are only *ever* used on a dark surface or behind a `dark:` variant, so
the defensible light-mode failure set is the table above (each rendered on a light surface).

**Current border pattern:** `border-{hue}-500/30` composited over `#fff` renders `#bedfcf` (1.43:1),
`#e7ceb5` (1.51:1), `#b9ccf6` (1.61:1) → **all below the 3:1** SC 1.4.11 boundary. Over dark,
1.48–1.87:1. This is why the proposal uses a full-opacity `-border` token, not the `/30` alpha literal.

**Proposed tokens:** every value in §2.1–2.2 PASS its threshold (fg ≥ 4.5:1, DEFAULT/-border ≥ 3:1)
against both `--background` and `--card`, in both themes, and every `-foreground` also clears 4.5:1 on its
own `/10` tint (`success` 4.88 / `warning` 5.39 / `info` 6.40 light; 9.88 / 9.47 / 6.96 dark).

### 5.3 Not verified

- **Rendered appearance.** No dev server was started (per the hard rules) and no screenshot was taken.
  Findings #4–#9 are read from source and class inventory, not from pixels.
- **Axe run.** The brief records zero `color-contrast` violations on the 7 canonical routes. The values in
  finding #1 (2.95:1, 2.28:1, 1.92:1) and #2 (3.04:1) are pure arithmetic, so the failure is real regardless
  of rendering — but **why axe did not flag them** is unconfirmed. The likely explanations are (a) the
  specific states (error, `scheduled`, `completed_with_errors`) are not rendered in the seeded axe run, and
  (b) axe's contrast check does not reliably evaluate an element whose background is a semi-transparent
  `bg-amber-500/10`. This is worth a targeted follow-up, because a token pass that *also* silently passes
  axe would leave the same defect unreported next time.
- **320px reflow.** Whether the 9 `text-2xl font-bold` page titles overflow at 320px was not re-run.
- **`--info` vs `--primary` confusion in practice.** They are 4° apart in hue and identical in the grey
  test by construction; the mitigation (info never used as a solid button fill) is a convention, not
  something the token enforces. Confirm on a page that shows both.

---

## 6. Verdict

**Block.**

Two `HIGH` findings are standing, both are contrast failures measured on values (not on appearance), and
both are fixed *once* by the same token pass that finding #3 already requires — so the highest-leverage
action in this report is a single change to two files (`index.css`, `tailwind.config.ts`), not a sweep.

- **#1 HIGH** — the light-mode success and warning *text* values are 2.95:1 and 3.35:1 against their own
  tint, and `text-green-500`/`text-emerald-400` are 2.28:1 / 1.92:1. This is the escalation trigger "text on
  a background it does not have enough contrast against", and it is systemic, not isolated.
- **#2 HIGH** — `--destructive` was authored for light mode and never re-derived, so error text is 3.04:1 in
  dark mode. A token defect, distinct from the literal problem.
- **#3 MEDIUM (the central ask)** — 250 literals, 27 files, three intents with no token. The proposal in §2
  is additive, uses the project's own naming and alpha contract, introduces no new component, and deletes
  one dead namespace.

**Next mode:** `/design tokenize` — apply §2, then migrate in this order: (1)
`components/ui-shared/status-badge.tsx` (32 literals, one file, shared by Queue/Calendar/Agent/Today);
(2) `lib/constants.ts` + `pages/calendar.tsx` + `pages/settings.tsx` (delete the duplicated vocabularies,
finding #4); (3) `pages/hooks.tsx`, `pages/discover.tsx`, `pages/settings.tsx`, `pages/source-detail-modal.tsx`
(the rest of the banner/badge family); (4) `learning-view.tsx` last, because it is also the `relayout`
target — do not tokenize 45 literals in a surface that is about to be flattened.
