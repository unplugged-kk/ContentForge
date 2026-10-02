# Phase 33.7 — Calendar tab text contrast (WCAG 2.2 SC 1.4.3)

**Scope:** the Calendar view — the **Calendar** tab inside `/schedule`
(`client/src/pages/calendar.tsx`). Branch `phase-33.7-calendar-a11y`.
No global token (`index.css`) was changed.

## Result

The Calendar tab now clears 4.5:1 for all day numerals in **both** themes, and
the **full axe rule set reports 0 violations** on the view. A regression spec
(`e2e/calendar-contrast.e2e.spec.ts`) pins the measured ratios and guards
against reintroducing the dimming.

## Failing elements (measured, before → after)

Both defects were verified in a real browser (Playwright, computed styles),
not inferred from source.

| # | Element | Selector / source | Theme | Before | After |
|---|---------|-------------------|-------|--------|-------|
| 1 | Adjacent-month day numeral | `.opacity-40 … > .mb-1.text-muted-foreground.text-xs` — cell `calendar.tsx:284`, numeral `calendar.tsx:287` | light | **1.89:1** (axe 1.87 · `#bdbdbd` on `#ffffff`) | **7.00:1** (`rgb(89,89,89)` on `#ffffff`) |
| 1 | Adjacent-month day numeral | same | dark | **2.23:1** (axe 2.21 · `#4e4e4e` on `#141414`) | **7.57:1** (`rgb(166,166,166)` on `#141414`) |
| 2 | Today day numeral | `div.text-primary` — `calendar.tsx:287` | dark | **3.21:1** (`#0b60ea` on `#1a1a1a`) | **15.55:1** (`rgb(242,242,242)` on `#1a1a1a`) |

Adjacent-month numerals are 12px / weight 400 → **normal text**, so the
threshold is 4.5:1 (not the 3:1 large-text floor).

Element **#1** was the defect flagged by the prior analysis (`opacity-40`).
Element **#2** was found during this pass: in dark mode `today` rendered the day
numeral with `text-primary` at only 3.21:1. The axe run before the fix reported
exactly these nodes (1 rule, `color-contrast`) in both themes.

## Fix (confined to `calendar.tsx`)

De-emphasis is now carried by **colour**, never by `opacity`:

- Removed `opacity-40` from adjacent-month cells. `opacity` dims the cell's own
  text — and any post pills inside it — below AA in both themes.
- Adjacent-month day numerals stay on `text-muted-foreground`; in-month numerals
  now use `text-foreground`; `today` uses `text-foreground font-semibold`
  (the cell already carries `border-primary/40`, so the today marker survives).
- Added `data-testid="text-calendar-day"` + `data-day-current-month` /
  `data-day-today` so the regression spec can locate the exact elements.

Hierarchy is preserved: in-month = strong foreground, adjacent-month = muted
(AA-compliant floor), today = foreground + semibold + primary border.

## Global token implication (reported, not changed)

Element **#2**'s root cause is a **global token**, so it is reported rather than
fixed in `index.css`:

- `--primary` is a single value in both themes: **`217 91% 48%`** (`#0b60ea`).
  - vs light `--card` / `--background`: 5.17:1 / 5.40:1 → **passes**.
  - vs dark `--card` (#1a1a1a): **3.24:1**; vs dark `--background` (#141414):
    **3.40:1** → **fails 4.5:1 as small text**.
- `text-primary` is used in **82 places across 37 files**; the dark theme never
  lifts `--primary` (unlike `--destructive`, which is split on purpose, or
  `--sidebar-primary` / `--ring`, which step up to 55% / 72%). Any small
  `text-primary` text on a dark surface inherits the 3.2–3.4:1 shortfall.

**Recommendation (out of scope here):** if `text-primary` is to be used as text
on dark surfaces, the dark `--primary` stop should be lifted (e.g. to
`217 91% 55%`, matching `--sidebar-primary`) or those call sites should move to
`--primary-foreground` on a solid fill. The Calendar's own `text-primary` usage
was removed locally so the view is compliant today.

## Verification

- `e2e/calendar-contrast.e2e.spec.ts` — 2 themes × {measured-ratio assertion,
  full axe rule set}: **5 passed** (incl. setup).
- `e2e/accessibility.e2e.spec.ts` (incl. *color-contrast on every canonical
  route*): **26 passed**.
- `e2e/today-schedule.e2e.spec.ts`, `e2e/canonical-ia.e2e.spec.ts`,
  `e2e/dialog-focus.e2e.spec.ts`: **24 passed**.
- `npm run check` (tsc): clean.

Environment: `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`,
`E2E_PORT=4604`, production build.
