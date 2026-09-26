# ContentForge — Visual Design Audit

**Worktree:** `/Users/kishore/git/cf-design/wt-01` (branch `design/wt-01`)
**Mode:** visual audit — visual hierarchy, composition, density, whitespace, rhythm, typography, color, cards, buttons, status indicators, overall visual quality
**Register:** Product — authenticated single-operator tool, `Operate` + `Monitor` (+ `Compare` on Insights)
**Date:** 2026-09-26
**Scope:** `client/src/**` (audited from source, the compiled stylesheet, and the class inventory — no dev server)
**Report only.** No source file was modified in the main repo or this worktree.

---

## Overall

**Verdict: Block** — one `HIGH` escalation trigger is standing (light-theme text on
insufficient contrast). The rest is `MEDIUM` structural work, concentrated in the two
surfaces the operator touches least often.

The visual foundation is genuinely authored and was **not** the problem: the token layer,
the eight-step elevation ramp, the motion tokens, the reduced-motion tiers, the type floor,
and the `PageHeader` are all deliberate and documented in `.commandcode/design/brief.md`.
This pass found no hero, no gradient, no centered card grid, no stat monument. What remains
is the same pattern the 2026-09-26 smell report named: **unenforced intent**. A palette
vocabulary written inline at 256 call sites instead of in the token layer; and one file
(`components/insights/learning-view.tsx`) that carries a template's worth of nested boxes
and repeated bands.

Per D9 this is **not** a re-skin. Every `After` below is a structural or token-level change,
not a new look.

---

## Findings

One root cause, one row, ordered by severity then reach. Every row carries a severity, a
real `file:line` that was opened, and a concrete **After**.

| # | Severity | Discipline | Location (file:line) | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | HIGH | Color | `client/src/pages/articles.tsx:29-31`, `client/src/pages/hooks.tsx:43-44,81-88`, `client/src/components/create/artifact-review-view.tsx:549` | Status/severity text written as light-ramp Tailwind: `bg-blue-500/20 text-blue-400`, `bg-green-500/20 text-green-400`, `bg-purple-500/20 text-purple-400`; an 8-hue map incl. `bg-amber-500/10 text-amber-500`, `bg-pink-500/10 text-pink-500`, `bg-cyan-500/10 text-cyan-500`; and `text-emerald-400` on a `bg-primary` button | Add semantic role tokens (`--success`, `--warning`, `--danger`, `--info` + paired foregrounds) tuned to clear 4.5:1 in **both** themes, and map each state to one; on the primary button use `text-primary-foreground` for the glyph | Measured WCAG 2.1 contrast on a light card (`#fafafa`): blue-400 **2.5:1**, green-400 **1.7:1**, purple-400 **2.6:1**, green-500 **2.3:1**, amber-500 **2.2:1**, cyan-500 **2.5:1**. All fail AA 4.5:1 for text, and these badges render at 10–12px. Escalation trigger — text on a background it does not have enough contrast against. Only the light theme is affected (dark is the default and passes), but the brief requires both themes to work. |
| 2 | MEDIUM | Color | 256 instances, densest `client/src/components/insights/learning-view.tsx` (45), `client/src/components/ui-shared/status-badge.tsx` (32), `client/src/pages/hooks.tsx` (22), `client/src/pages/discover.tsx` (20), `client/src/pages/settings.tsx` (19) | Literal Tailwind ramps inline at each call site — `bg-emerald-700 hover:bg-emerald-800 text-white`, `text-amber-600 dark:text-amber-400 border-amber-500/30`, `bg-blue-600 hover:bg-blue-700 text-white` | Add semantic role tokens to `:root` / `.dark`, map them in `tailwind.config.ts`, and replace the 256 literals | The token layer is the strongest thing in this codebase and 256 instances route around it. The result is exactly the brief's anti-reference: `emerald-700` / `blue-600` / `amber-500` are stock Tailwind ramps, not a chosen hue, so status reads as generic SaaS and could belong to any product. This is the shared *cause* of finding #1; the two are listed separately because the fixes differ (new token values vs. migrate call sites) and #1 is its own escalation trigger. |
| 3 | MEDIUM | Surface | `client/src/components/insights/learning-view.tsx:708,782,805,809-827` · `:919,987,1033,1074-1084,1116` · `:1282,1294,1331` / `:1365,1400` / `:1448,1487-1494` | `<Card>` → `CardContent` → `<div className="p-3 rounded-md bg-muted/40 border">` → `grid-cols-4` → `<div className="p-2 rounded bg-background/60 border">` ×4. Up to four levels of nested rounded+bordered box in one component | Flatten the evidence/eval drawers to a definition list or a real `<table>` on one bordered rule — the file already renders a real table at `:1562` for the same kind of data. Cards end at the card; metrics are rows, not tiles | Brief line 229: "Never one card inside another." Insights is a `Compare` surface and the brief assigns it "stable scanning lanes"; four bordered mini-boxes inside a drawer inside a card inside a section is the wall, not a lane. 1,908 lines, 34 `<Card>` in one file. |
| 4 | MEDIUM | Surface | `client/src/components/insights/learning-view.tsx:643-651, 860-868, 1272-1278, 1438-1444, 1617-1625` | Five identical section headers: a `h-5 w-5` colored lucide icon + `<h2 className="text-lg font-semibold text-foreground">` + an `outline` `<Badge>` ("Proposed", "Optimization Engine", "Learned", "Observed", "Human Review Required") | Drop the per-section badge. Let the icon carry tier identity and give each section a `text-xs uppercase tracking-wider` label. Vary header weight by tier — action queues (Tier 1/1.5) and measurement (Tier 3) should not read identically | The squint test returns five equal-weight bands on a surface built for comparison. "Proposed" sitting above a heading that already says "Optimization Proposals" is a badge that adds no information. Repeated identical structure is the weakest possible hierarchy on a `Compare` screen. |
| 5 | MEDIUM | Surface | `client/src/components/ui-shared/empty-state.tsx:37`, clones at `client/src/components/insights/learning-view.tsx:681-700, 898-908, 1654-1664` | `flex h-10 w-10 items-center justify-center rounded-full bg-muted` circle above every empty-state title; plus 3 hand-rolled `<Card className="border-dashed bg-muted/20">` blocks with a bare `<Icon className="h-8 w-8 … mx-auto">` | Remove the circle wrapper; render the icon inline at `h-5 w-5` (or drop it on narrow empty states). Replace the 3 hand-rolled cards with the shared `<EmptyState>` so the file has one empty-state pattern | Icon-topper odor. The circle is identical on every empty state, so it distinguishes nothing — decoration standing in for structure. The same file already imports `EmptyState` and uses it 4× (`:1313,1384,1473,1553`) yet hand-rolls 3 more, so one state renders two different ways. |
| 6 | MEDIUM | Color | `client/src/components/ui-shared/status-badge.tsx:66-67` and `:70-72` | `generating` and `running` carry **byte-identical** classes (`text-blue-600 dark:text-blue-400 border-blue-500/30 pulse-live`); `approved`, `completed`, and `published` all carry the identical emerald set (`bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30`) | Give each in-flight state a distinct non-colour glyph (spinner for `generating`/`running`, clock for `waiting_for_approval`) and a distinct token, and separate the three terminal emerald states with an icon or a text shape | Four statuses the operator must triage share one visual encoding. The word differs, so this is not colour-alone and is therefore MEDIUM not HIGH — but under `prefers-reduced-motion: reduce` (`index.css:411`) the pulse that partly separated the in-flight states is removed, and the encoding collapses further. |
| 7 | MEDIUM | Type | `client/src/pages/articles.tsx:263` and `client/src/pages/ingest.tsx:253` vs `client/src/components/ui-shared/page-header.tsx:37` | Tab content hand-rolls `<h1 className="text-2xl font-bold">` ("X Articles", "Ingest Content") beneath a `PageHeader` `<h1 className="text-lg font-semibold">` ("Create", "Sources") | Delete the nested `h1`; let the tab carry a `text-sm font-semibold` sub-header, or pass the tab title into `PageHeader` | Reachable at `/create → Articles` and `/sources → Ingest` (`pages/create.tsx:49`, `pages/sources.tsx:8`). A 24px bold title outranks the 18px page title it sits under — two live `h1`s on one screen, and the child is louder than the parent. |
| 8 | LOW | Type | `client/src/components/ui/card.tsx:39` | `CardTitle` default `"text-2xl font-semibold leading-none tracking-tight"` | Change the default to `"text-base font-semibold leading-tight tracking-tight"` | **Verified, and the premise did not hold:** all 41 `<CardTitle>` call sites already pass an explicit size (`text-sm` / `text-base` / `text-xs`), so 0 render at the 24px default today. The default is dead but hostile — every call site must override it and the next one that forgets inherits a 24px title in a 13px row. Latent footgun, not a live symptom, hence LOW not MEDIUM. |
| 9 | LOW | Type | `client/src/pages/analytics.tsx:94` vs `:269,276,283` | Primary KPI value `text-2xl font-semibold tabular-nums`; the adjacent quality strip uses `text-lg font-semibold tabular-nums` for the same class of number | Pick one numeric scale for metric values on the `Compare` surface — `text-xl` for both, or reserve `text-2xl` for the top KPI row only | Two sizes for the same kind of metric one row apart flattens the intended primary-KPI → supporting-strip hierarchy into noise. |

---

## Considered but rejected

Real candidates inspected this pass and deliberately not reported.

| Location | Candidate | Rejected because |
|---|---|---|
| `client/src/components/x-post-preview.tsx:19,26,38` | `text-sky-400` / `text-emerald-200` "low-contrast" text | Renders on an intentional dark X-mock surface (`bg-[#15202B] text-[#e7e9ea]`, `:31`). The contrast is fine against that backing; it is not a light-surface failure. |
| `client/src/pages/discover.tsx:263` | `text-2xl font-bold` page title (a hierarchy outlier vs the 18px `PageHeader`) | `/discover` is a `<LegacyRouteRedirect>` (`App.tsx:104`) and `DiscoverPage` is imported nowhere else — dead code, not a reachable surface. |
| `client/src/components/ui/card.tsx:12` | `shadcn-card` class in the Card base | Grep finds the string only at its usage; there is no `.shadcn-card` rule anywhere. Vestigial and produces no rendered effect, so there is nothing to fix visually. |
| `client/src/components/ui/card.tsx:12` vs `ui/button.tsx:8` | Card `rounded-xl` (12px) beside controls at `rounded-md` (6px) | Deliberate system: `tailwind.config.ts` sets `lg:9px / md:6px / sm:3px` and a card is a container, not a control. `border.md` allows an established component token over the concentric formula for independent layers. The proportion (98 `rounded-md` vs 29 `rounded-lg` vs few `xl`) reads as a system, not random mixing. |
| `client/src/components/sources/source-detail-modal.tsx:130` | Accent rail (`border-l-2 border-amber-400`) on the conflicting-evidence panel | Carries meaning (two sources disagree), appears exactly once in the repo, and the smell report already ruled it earned. |

---

## Verification

### Checks run

| Check | Method | Observed |
|---|---|---|
| `CardTitle` default is overridden everywhere | Parsed every `<CardTitle …>` opening tag across `client/src` | 41 occurrences; **41 carry a `text-*` size override**, 0 fall through to `text-2xl`. The task's "~34 of 41 do not override" no longer holds — see finding #8. |
| Hardcoded palette reach | `grep -roE "(bg\|text\|border\|fill\|stroke)-(emerald\|blue\|amber\|…)-[0-9]{2,3}"` | 256 instances. Top files: learning-view 45, status-badge 32, hooks 22, discover 20, settings 19, calendar 14, agent 14, source-detail-modal 14. |
| Light-theme contrast failures | Grep for `text-*-400/300` and `text-*-500` on `bg-*-500/10` with no `dark:` sibling; hand-computed WCAG 2.1 relative luminance | 25 `-400/-300` + the `-500` badge map. Reachable examples measured at **1.7–3.8:1** on a light card. |
| `learning-view.tsx` shape | `grep -c "<Card"`, `grep -nE 'rounded(-md)? (bg-\|border)'`, header scan | 34 `<Card>`; ≥15 nested `rounded+border` boxes; 5 identical section-header blocks; 4 shared `EmptyState` + 3 hand-rolled dashed empty cards. |
| Default theme | Read `components/theme-provider.tsx` | Default is `"dark"` (`:9`, `:16`). Light-mode findings are therefore non-default-theme, noted in-severity. |
| Reachability of "legacy" pages | Mapped redirects in `App.tsx:97-115` to their live mount points | `/queue→schedule.tsx`, `/ingest→sources.tsx`, `/articles`,`/images`,`/hooks`,`/canned-responses`→`create.tsx`. These are live tabs; `/discover`,`/generate`,`/vault` are dead imports. |
| Type floor (already fixed) | `dist/public/assets/index-BQvJOzMk.css` byte offsets | `.text-\[9px\],.text-\[10px\],.text-\[11px\]{font-size:var(--text-meta)}` at byte **69644** lands after `.text-\[10px\]{font-size:10px}` at **47811** → the 12px floor wins. Re-confirmed, **not** re-reported. |
| Radius / elevation / ring tokens | Read `index.css`, `tailwind.config.ts` | `--ring` 38%/72% ≠ `--primary`; shadows carry real alpha; reduced-motion block present. All previously-fixed items confirmed intact. |

### Not verified

- **Rendered appearance.** No dev server was started and no screenshot taken. Findings #3–#7 are read from source and the class inventory. The contrast arithmetic in #1 is computed from Tailwind's published hex against `#fafafa`, not measured in-browser against the composited tint.
- 320px reflow and 200% zoom for the 24px legacy `h1`s (finding #7). The viewport matrix in the brief was not re-run.
- Dark-mode contrast of all 256 literals — 12 spot-checked; the `text-*-400` values pass on dark, `text-*-500` on a 10% tint are borderline.
- Whether the `learning-view` nesting overflows at any of the seven matrix widths.

---

## Next modes

- **`/design recolor`** — findings #1, #2, #6. Add the semantic role tokens, then migrate the 256 literals. Explicitly *not* a re-skin.
- **`/design relayout`** — findings #3, #4, #5, scoped to `components/insights/learning-view.tsx`. Highest-leverage single file in this report.
- **`/design typeset`** — findings #7, #8, #9. Page-title scale, `CardTitle` default, KPI scale.

*Report only. No source file was created or modified in `/Users/kishore/git/ContentForge` or this worktree.*
