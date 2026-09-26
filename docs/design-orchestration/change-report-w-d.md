# Change Report — Workstream W-D (Insights Surface)

**Workstream:** W-D — `components/insights/**`, `pages/insights.tsx`, `pages/analytics.tsx`, `pages/ai-usage.tsx`
**Branch:** `design/impl-d` (worktree `/Users/kishore/git/cf-design/impl-d`)
**Base:** `87a0601` (baseline snapshot of phase-33.2 working tree)
**Date:** 2026-09-27
**Direction:** `docs/contentforge-design-direction.md` §4.2, §5.2, §5.3, §5.4, §7; `.commandcode/design/brief.md` (Truthfulness, Composition).

---

## 1. Files changed

| File | Lines before → after | What changed |
|---|---|---|
| `client/src/components/insights/learning-view.tsx` | 1909 → **1980** (+71) | E1(a)–(d), D1, M8. Single-writer relayout. |
| `client/src/components/insights/automated-optimization-panel.tsx` | 262 → 273 | D1 (same class; operator audit Finding 1 names this file), 1 semantic literal. |
| `client/src/pages/insights.tsx` | 106 → 117 | G1 (tab strip out of the header action slot + `overflow-x-auto`), WT-09 (URL-initialised tab). |
| `docs/design-orchestration/change-report-w-d.md` | new | this report |

`client/src/pages/analytics.tsx` and `client/src/pages/ai-usage.tsx` were **not modified** — no finding in the W-D row applies to them (their charts already read `useChartColors()`; their few remaining literals are categorical/decorative, which §4.4 excludes).

`git diff --stat`: 3 source files, 357 insertions(+), 256 deletions(-).

---

## 2. Findings addressed

### E1(a) MEDIUM — nested rounded+bordered boxes → flattened (learning-view.tsx)

Before — a four-level box chain inside one `<Card>`: `Card → CardContent → p-3 rounded-md bg-muted/40 border (evidence drawer) → grid → p-2 rounded bg-background/60 border ×4 (metric tiles)` (was `:708→782→805→809-827`), plus the identical pattern in the experiment drawer (`:1031→1073→1074/1084`), the narrative block (`:1068`), the guardrail-table wrapper (`:1116`), the variant chip (`:1016`), the list rows (`:1329`, `:1400`, `:1487`, `:1494`) and the `<pre>` (`:1814`).

After — the metric strips are `<dl>` definition rows on a single bordered rule (`pt-3 border-t`), matching the correct sibling treatment already in the file at `:1561`; list rows use `divide-y`; the drawers are `border-t` rules, not boxes; the `<pre>` and chips are fill-only. No new pattern was invented.

**Grep-proof (learning-view.tsx):** the only line containing both `rounded` and `border` is
`:719 <div className="bg-muted/40 border rounded-lg p-3.5 …">` — the top-level *Editorial Disclaimer Banner*, a direct child of the root container, **not inside any `<Card>`**. Every former in-Card box is gone. No rounded+bordered element now contains another.

(Note: the sanctioned shared `EmptyState`/`ErrorState` are themselves `rounded-md border border-dashed` and are rendered inside Cards by design, so "no rounded bordered box inside a Card" cannot be read literally app-wide; the anti-pattern the direction removes — a *box nested inside another box* — is eliminated here.)

### E1(b) MEDIUM — five byte-identical section headers → one tiered `SectionHeader`

Before: `:643, :860, :1272, :1438, :1617` each rendered `icon + text-lg h2 + outline <Badge>` carrying the tier word ("Proposed", "Optimization Engine", "Learned", "Observed", "Human Review Required"). Squint test = five equal bands.

After: a single local `SectionHeader` (in-file, not exported). Per-section badges removed. Each section now carries a `text-xs uppercase tracking-wider` **eyebrow label** plus its icon (tone = tier), and the heading weight encodes the tier:

| Section | Tier | Eyebrow | `h2` class |
|---|---|---|---|
| Optimization Proposals | queue | Action queue | `text-base font-semibold` |
| Controlled Experiments | queue | Action queue | `text-base font-semibold` |
| Inferred Patterns & Voice | learn | Learned patterns | `text-sm font-semibold` |
| Measured Production Signals | measure | Measurement | `text-sm font-medium` |
| Policy Candidates | queue | Governance queue | `text-base font-semibold` |

Tier 1/1.5 (action queues) and Tier 3 (measurement) no longer read identically. No information was deleted — every section keeps its title and (where it had one) its description.

### E1(c) MEDIUM — clipped guardrail table → `overflow-x-auto`

`:1116` `rounded border bg-background/60 overflow-hidden` → `overflow-x-auto`, matching the sibling table's strategy.

### E1(d) MEDIUM — a wrong number rendered confidently → `MetricDelta`

`:829` hardcoded emerald **and** forced a `+`. It is replaced (with `:1421` and `:1090-1101`) by one shared `MetricDelta` that derives sign and colour from the value: positive → `text-success` with `+`, negative → `text-destructive`, zero/absent → `text-muted-foreground` / `—`. A regression now renders red; `+-12%` can no longer occur; an absent value renders `—` instead of `+undefined%`.

### D1 HIGH — failed reads rendered as clean states

- `learning-view.tsx` **observations** (`:274` query, `:1378` render): added `error` + `refetch`; an `isError` branch renders `ErrorState` before the empty branch.
- `learning-view.tsx` **`/api/policy-candidates/activated-ids`** (`:555-565`, `:1754`): added `isError` + `refetch`; when set, the Activate/Roll-Back controls are replaced by a retryable `ErrorState`. A transport failure can no longer render "Activate for Future Generations" for a policy that is already live.
- `automated-optimization-panel.tsx` (`:82-87` queries; status banner, decisions list): added `isError` branches for both queries. A failed `/api/autonomy/status` previously rendered a confident "Disabled / Mode: Disabled / Circuit Breaker: Closed"; it now renders the honest `ErrorState`. A failed decisions read no longer prints "No autonomous decisions recorded yet."

**Grep-proof — every list/count region now has an `isError` branch:** proposals ✓, experiments ✓, style profiles ✓ (+503 unconfigured), observations ✓, workflow signals ✓, channel signals ✓, policy candidates ✓, activation state ✓, panel status ✓, panel decisions ✓. (analytics/ai-usage already had `isError`.) The pattern mirrors `pages/today.tsx` (`:150-160`, `:170`, `:190-200`).

### M8 — 45 palette literals → semantic tokens (learning-view.tsx)

All 45 `bg|text|border-{emerald,amber,blue,rose}-*` occurrences migrated **by semantic intent**:

- success roles → `bg-success`, `bg-success/10`-family, `border-success/30`, `text-success`, and `text-success-foreground` on the 5 solid fills (`bg-success`), `hover:bg-success/90`;
- info roles (experiment "running", Promote, Activate buttons) → `bg-info` / `text-info-foreground`;
- warning roles (Review Pending badge, "Style Intelligence Not Configured" icon) → `bg-warning/10 text-warning border-warning/30`, `text-warning`;
- negative delta → `text-destructive`.

Categorical/decorative hues were **not** swept: the three non-section card-subheader icons were set to `text-muted-foreground` (they distinguished nothing), and the section icons are driven by `TIER_ICON_CLASS`. `text-white` is gone from the file (0 occurrences). One semantic literal in the panel (`text-emerald-700` → `text-success`) was also migrated.

Also done (direction §3, LOW): every `text-[9px]/[10px]/[11px]` in the file was replaced with `text-xs`. These already resolved to 12px via the type floor, so this is the sanctioned correctness migration, not a visual change.

> **⚠️ Hard integration prerequisite — see §5 (W-A).** `--success`/`--warning`/`--info` do **not** exist on this branch (the W-A token work has not landed anywhere, including `main`). The migrated classes therefore emit **no CSS** until W-A's layer is present — verified: the production CSS contains `.text-destructive` but no `.text-success`/`.bg-info`/`.text-warning`. This is by design in the direction (W-A is the token prerequisite of W-D's §4.2 migration) but **must be integrated before this branch** or the migrated states render unstyled.

### G1 / overflow — `pages/insights.tsx`

Before: the view tab strip occupied `page-header.tsx`'s primary-action slot (`action={<TabsList…>}`), so `/insights` had no primary action anywhere; the strip was `inline-flex + whitespace-nowrap` inside the slot's `shrink-0` container with no scroll.

After: the `TabsList` lives in the page body under the header (`flex shrink-0 border-b px-4 py-2` → `TabsList className="h-8 w-full justify-start overflow-x-auto"`). The header's action slot is left empty (there is no primary action on `/insights`). The strip now scrolls at narrow viewports instead of overflowing. All three trigger `data-testid`s and the `tabs-insights-views` testid are preserved.

### WT-09 — consolidate duplicate GETs

`/insights?view=learning` opened with 9 concurrent GETs: 7 in `learning-view.tsx` (`:245,256,266,274,360,370,555`) + 2 in the rendered `AutomatedOptimizationPanel` (`/api/autonomy/status`, `/api/autonomy/decisions`).

- **Genuinely-same-resource check:** `/api/learning/summary` is consumed by both `learning-view.tsx` and `analytics.tsx`, and both already use the identical key `["/api/learning/summary"]` — so React Query already serves them from one cache entry. No duplicate key exists among the 9.
- **Fixed:** `pages/insights.tsx` previously seeded `activeTab` as `"performance"`, so opening `/insights?view=learning` mounted (and fired the 3 GETs of) `AnalyticsPage` first, then discarded it. The tab is now initialised from the URL synchronously, removing 3 wasted GETs per non-performance load. Polling cadence is untouched (M7 deferred).

---

## 3. Behaviour preservation

Same data, same routes, same API calls, same capability. Every query key, mutation, endpoint, handoff URL and `data-testid` used by the e2e suite is unchanged. `testid`s explicitly re-verified against `e2e/insights.e2e.spec.ts`, `e2e/experiments.e2e.spec.ts`, `e2e/learning-proposals.e2e.spec.ts`, `e2e/full-product-audit.e2e.spec.ts` are all still present: `container-learning-view`, `section-learning-proposals|inferences|observed`, `section-controlled-experiments`, `section-policy-candidates`, `card-proposal-*`, `card-experiment-*`, `card-policy-candidate-*`, `card-learning-voice`, `card-learning-lifecycle`, `card-style-profile-*`, `drawer-evidence-*`, `text-evidence-sample-count`, `drawer-experiment-details-*`, `drawer-experiment-eval-*`, `badge-experiment-status-*`, `badge-experiment-evidence-quality`, `badge-recommended-decision`, `badge-candidate-status-*`, `badge-activated-by-*`, `button-activate-candidate-*`, `button-rollback-candidate-*`, `text-approval-rate`, `text-success-rate`, `metric-total-*`, `button-learning-*`, `empty-*`, `page-header-insights`, `tabs-insights-views`, `tab-trigger-*`.

The evidence-drawer assertions that depend on exact string rendering still hold: `MetricDelta` emits the value verbatim, so `"+48.2%"` and `"+150.0%"` (both asserted in `learning-proposals.e2e.spec.ts:190,459`) render exactly as before.

**Language rules:** no causality was introduced; no `not_available` figure is coerced to zero (unchanged `formatMetricValue` path); denominators are still printed. No exclamation points added.

---

## 4. Verification — what was run, and what was not

**Run:**
- `npm run check` (`tsc`) — **clean** (before and after the final edit).
- `npm run build` — **succeeds**. `dist/public/assets/index-DWmQwDCe.css` 114.12 kB (gzip 18.06 kB); `index-DcJQxH0t.js` 1,791.61 kB (gzip 515.98 kB); `dist/index.cjs` 4.1 mb.
- `client/src/lib/**/*.test.ts` unit tests — **91 pass, 0 fail** (includes `insights-state.test.ts`, the test touching this surface).
- Grep-proofs: no rounded+bordered box nested in a Card in `learning-view.tsx` (§2, E1(a)); every list/count region has an `isError` branch (§2, D1); 0 palette literals remain in `learning-view.tsx`.
- Built-CSS check confirming the token prerequisite: `.text-destructive` present, `.text-success`/`.bg-info`/`.text-warning` **absent** (informational; see §5).

**Not run (and why):**
- **Playwright e2e** (`insights`, `experiments`, `learning-proposals`, `full-product-audit`). No `DATABASE_URL`, no Docker daemon, and nothing listening on `:5432` in this environment — the suite needs the built server plus Postgres. The specs were read in full and every selector/assertion they use was preserved by hand (§3), but the runs themselves could not be executed here.
- **Rendered screenshots / axe / viewport matrix.** Same prerequisite (server + DB).
- **`server/**` unit tests** fail in this environment with `DATABASE_URL must be set` (`server/db.ts:6`) — a **baseline, environment-level** failure, not caused by this change (this change touches only client files).

---

## 5. Patches needing another owner — **required for integration**

### W-A (blocking): add the semantic token layer

The W-D migration in §2 (M8) depends on `--success`, `--warning`, `--info` (+ `-foreground`) and their Tailwind mapping. They do **not** exist on `87a0601`, in `main`, or in this branch. Minimal mapping patch (follows `tailwind.config.ts`'s existing nested convention, e.g. `primary`):

```ts
// tailwind.config.ts → theme.extend.colors  (add alongside primary/secondary/…)
success: { DEFAULT: "hsl(var(--success) / <alpha-value>)", foreground: "hsl(var(--success-foreground) / <alpha-value>)" },
warning: { DEFAULT: "hsl(var(--warning) / <alpha-value>)", foreground: "hsl(var(--warning-foreground) / <alpha-value>)" },
info:    { DEFAULT: "hsl(var(--info) / <alpha-value>)",    foreground: "hsl(var(--info-foreground) / <alpha-value>)" },
```

…with `--success`, `--success-foreground`, `--warning`, `--warning-foreground`, `--info`, `--info-foreground` defined in **both** `:root` and `.dark` of `client/src/index.css` (§4.2/§4.3 — W-A owns the measured values; the §4.3 contrast table is computed by W-A). `text-destructive` already resolves today; only the three new roles are blocked.

### W-C (EmptyState unification) — 3 hand-rolled dashed empties remain in `learning-view.tsx`

E1(e)/M3: the file adopts the shared `EmptyState` 4× but hand-rolls 3 more as `<Card className="border-dashed bg-muted/20">` (proposals `:765`, experiments `:977`, policy candidates `:1717`). Per the single-writer rule I did **not** touch `ui-shared/`; these should be folded into W-C's unified `EmptyState` (`testid`s `empty-learning-proposals`, `empty-controlled-experiments`, `empty-policy-candidates` must be preserved on the replacement). Recommended, not applied.

### W-B — `CardTitle` default (M1, LOW)

`ui/card.tsx` `CardTitle` default `text-2xl`. All 41 call sites override it; this file's are all `text-base font-semibold`. No change made (out of ownership); noted only as the latent footgun the direction already tracks for W-B.

---

## 6. Notes / assumptions

- Section eyebrow copy ("Action queue", "Learned patterns", "Measurement", "Governance queue") encodes the tier word the removed badges carried. This is a deliberate, documented interpretation of E1(b)'s "give each section a `text-xs uppercase tracking-wider` label".
- `automated-optimization-panel.tsx` was included because W-D owns `components/insights/**` and the operator audit's D1 explicitly names it; its changes are additive error branches + one literal, with identical success-path behaviour.
- The panel's circuit-breaker callout was changed from `rounded-md border` to `border-l-2` so the panel also has no rounded+bordered box inside its Card.
