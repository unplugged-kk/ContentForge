# Change report — W-E (Sources + Create)

**Workstream:** W-E — Sources + Create (`components/sources/**`, `pages/sources.tsx`, `components/create/**`, `pages/create.tsx`)
**Branch:** `design/impl-e`
**Direction:** `docs/contentforge-design-direction.md` §4.2, §5.2, §5.4, §7
**Status:** `npm run check` clean · `npm run build` clean · unit tests (client/src/lib) 91/91 pass

Scope note: every edit below is in a file W-E owns. `client/src/lib/**`, `client/src/index.css`,
`tailwind.config.ts`, `client/src/pages/agent.tsx`, `client/src/pages/ingest.tsx` were **read only** —
the patches those need are in §5.

---

## 1. Findings addressed

| ID | Severity | What changed |
|---|---|---|
| B1(a) | HIGH | Focus ring restored on the primary Explore action on `/sources`. |
| D1 | HIGH | `isError` branches added to every list/empty/count region W-E owns. |
| K1(b) | HIGH (Create half) | `create.tsx` now parses `?topic=` and `?sourceUrl=` and seeds the studio. Agent half routed to W-F (§5.1). |
| M8 | — | 27 palette-literal occurrences across 4 files migrated by semantic intent to `success` / `warning` tokens. |
| M6 | LOW | Roadmap text "YouTube (deferred)" removed from the Create UI. |
| Overflow | — | `/sources` band structure made coherent; compatibility row preserved; `/ideas` no-active-primary-pill fixed. |

---

## 2. Files changed and the evidence

### 2.1 `components/sources/source-card.tsx` — B1(a)

`@@` line 77 — before: `class="text-left hover:text-primary transition-colors focus:outline-none"`.

After:
```
class="text-left rounded-sm hover:text-primary transition-colors
       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
       focus-visible:ring-offset-2 focus-visible:ring-offset-background"
```

This is the app's existing focus vocabulary (identical to `ui/button.tsx:8`). Measured with a
WCAG relative-luminance computation over the token values in `client/src/index.css`:

| Ring vs surface | Contrast |
|---|---|
| light `--ring` (217 91% 38%) vs `--background` | **7.65:1** |
| light `--ring` vs `--card` (98%) | **7.33:1** |
| dark `--ring` (217 91% 72%) vs `--background` (8%) | **7.68:1** |
| dark `--ring` vs `--card` (10%) | **7.25:1** |

All clear the 3:1 floor of WCAG 2.2 SC 2.4.11 / 1.4.11. `--ring` ≠ `--primary` confirmed
(measured 1.41:1 between them; `index.css:43` / `:142`).

### 2.2 D1 — "a failed read must never render as an empty or zero state"

| File | Region | Before | After |
|---|---|---|---|
| `research-tab.tsx:75` | research history list | `jobs.length > 0 ? list : "No Research Yet"` | `jobsQuery.isError ? <ErrorState onRetry=…/> : …` |
| `saved-tab.tsx:161,229` | unified saved list | `filteredItems.length > 0 ? list : "Nothing Saved Yet"` | `savedLoadError ? <ErrorState onRetry=…/> : …` where `savedLoadError = vault‖ideas‖references .isError` |
| `saved-tab.tsx:195,204,213,222` | filter pill counts | `Ideas (0)` etc. from `data?.length ?? 0` | `countOf(isError, len)` → renders `—` when its read failed |
| `discover-tab.tsx:217,449,457` | results list + summary metrics | `sources.length > 0 ? list : "No sources found for this topic. Try broadening your search query."` | `sourcesQuery.isError ? <ErrorState onRetry=…/> : …`; metric row prints "Source count unavailable" / "Finding count unavailable" instead of `0`, plus a "this summary may be incomplete" caveat |
| `discover-tab.tsx:108` | analysis query | `catch { return null }` (error swallowed) | error surfaces; `analysisQuery.isError` feeds the same caveat line |
| `source-detail-modal.tsx:168` | evidence list | always claims "Extracted Evidence (0) / Direct evidence derived from primary text excerpt." | new `evidenceError` prop renders "Evidence … couldn't be loaded — the claim list may be incomplete." |
| `create-studio.tsx:327,362` | Story / Ideas pickers | "No research stories yet." / "Ideas Bank is empty." | `storiesQuery.isError` / `ideasQuery.isError` → `<ErrorState onRetry=…/>` |
| `artifact-review-view.tsx:353` | version-history (header badge count) | `deriveVersionNumber(id, [])` reads as `v1` on a failed history read | "Version history unavailable — retry" |

`discover-tab.tsx` is the finding's worst case ("No sources found — try broadening your query" on a
transport failure). After the change, a *successful* empty read still shows that honest empty message;
only a *failed* read shows `ErrorState`, so the operator is no longer blamed for the app's failure
(`brief.md` truthfulness rule 5). Pattern mirrors `today.tsx:152-201`.

Grep-proof (all regions, run after the edits):
```
$ grep -rn isError client/src/components/sources client/src/components/create \
      client/src/pages/sources.tsx client/src/pages/create.tsx
research-tab.tsx:75   jobsQuery.isError
saved-tab.tsx:161     savedLoadError = vault|ideas|references .isError
saved-tab.tsx:204/213/222  countOf(<query>.isError, …)
discover-tab.tsx:217/218/449/457/517  sources/evidence/analysis isError
create-studio.tsx:327/362   stories/ideas isError
artifact-review-view.tsx:277 (pre-existing) / :353  history isError
```

### 2.3 `pages/create.tsx` + `components/create/create-studio.tsx` — K1(b), M6

`getCreateFromSourceUrl` (`lib/sources-research-state.ts:356`) emits
`/create?topic=<title>&sourceUrl=<url>`; `create.tsx` previously parsed `mode`, `artifact`,
`artifactId`, `type`, `storyId`, `ideaId`, `empty` — **not** those two.

- `create.tsx` now parses both **during render** (not in the effect — `CreateStudio` seeds state on
  mount and the effect runs a render too late, which would have silently dropped the values).
- `CreateStudio` gains `initialConcept` / `initialSourceUrl`; when a source is handed off it opens
  on `startWith="source"`, pre-fills the topic from `topic`, and shows a context card with the
  carried title + source URL so the operator can see what came across.
- **Behaviour preserved:** no API payload changed. The studio still creates Story → Opportunity →
  GenerationJob exactly as before; only the pre-filled inputs differ. The e2e contract is unchanged —
  `sources-workflow.e2e.spec.ts` Journey E asserts only `toHaveURL(/\/create\?topic=/)`.

M6: the `Mode:` bar chip rendered `<span>YouTube (deferred)</span>` with an aria-label reading
"legacy capability with canonical placement deferred". Now the visible label, `title`, and
`aria-label` are all user-facing ("YouTube" / "Open YouTube ingest"). The
`data-testid="link-youtube-deferred"` element is **kept** because
`phase-33.2-ia-ux-accessibility.e2e.spec.ts:168` asserts it is visible.

### 2.4 M8 — semantic palette migration

Migrated by intent (§4.4), not by hue. No categorical/decorative hue was touched (none exists in
these files).

| File | Literal(s) | Token(s) |
|---|---|---|
| `discover-tab.tsx:409` | `text-emerald-600 dark:text-emerald-400` | `text-success` |
| `discover-tab.tsx:435` | `text-amber-600 dark:text-amber-400` | `text-warning` |
| `create-studio.tsx:279` | `border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400` | `border-warning/30 bg-warning/10 text-warning` |
| `artifact-review-view.tsx:420` | same amber set | `border-warning/30 bg-warning/10 text-warning` |
| `artifact-review-view.tsx:551` | `text-emerald-400` (check glyph) | `text-primary-foreground` — see note |
| `source-detail-modal.tsx:128,131,132,135,139` | `border-amber-300/800`, `bg-amber-50/950/40`, `text-amber-900/200/600/400/800/300`, `border-l-2 border-amber-400/700` | `border-warning/30`, `bg-warning/10`, `text-warning`, `text-warning/…`, `border-warning/40` |
| `source-detail-modal.tsx:180` | `text-emerald-600 dark:text-emerald-400` | `text-success` |

Post-migration grep for palette literals in owned files returns **no matches**.

**Note on `artifact-review-view.tsx:551`:** the `CheckCircle2` sits *on the primary Approve fill*
(`variant="default"`). The direction's §4.4 table maps `text-emerald-600 dark:text-emerald-400 →
text-success`, but `--success` is a dark green tuned against `--background`/`--card`; on the blue
`--primary` fill it would fall below 3:1 — an accessibility regression, which "Access is the floor"
forbids. The honest token for text on a `--primary` fill is `--primary-foreground`, so that is what
the glyph now uses. Flagged as a deliberate deviation.

### 2.5 `/sources` band structure — overflow, `/ideas`

`pages/sources.tsx`: the previously single `flex … justify-between` row that jammed the primary
(`Discover / Saved / Research`) and compatibility (`Ideas / Vault / References / Ingest`) sets onto
one line is now **two stacked bands inside the same `data-testid="nav-sources-views"` container** —
a primary row, then a subordinate row with a muted "More:" eyebrow. The compatibility row is **not
collapsed** and no pill, route, or testid changed (nav change deferred per J1).

The `/ideas` case (and `/vault`, `/references`): route them to `activeView="saved"` + a sub-filter,
but the primary `Saved` pill was active only when `savedFilter === "all"`, so landing on `/ideas`
lit a compatibility pill while the primary row showed **nothing active**. `Saved` now reflects
`activeView === "saved"`, so the parent row always expresses the active parent and the sub-filter
lives in the subordinate row. This is an active-state fix, not a nav change.

**Remaining, reported not fixed:** `/sources?view=ingest` leaves the primary row with no active pill,
because `Ingest` is a *peer* of Discover/Saved/Research in the compatibility set, not a child of any
of them. Parenting it would require either moving Ingest or adding a primary pill — both are the
deferred consolidation. Left as-is for the coordinator's nav decision.

---

## 3. Measured vs not measured

- **Measured:** focus-ring contrast table (§2.1) from token values via WCAG relative luminance;
  `--ring ≠ --primary`; `npm run check` (tsc) exit 0; `npm run build` success; client-lib unit tests
  91 pass / 0 fail; grep proofs for `isError`, palette literals, and `focus:outline-none`.
- **Not measured:** rendered pixels / axe / e2e — no dev server or browser was run here.

---

## 4. Token dependency (integration-critical)

The migrated `text-success` / `text-warning` / `border-warning/30` / `bg-warning/10` classes resolve
**only after W-A lands** `--success` / `--warning` / `--info` in `client/src/index.css` and maps them
in `tailwind.config.ts` (§4.2). This worktree is a baseline checkout, so at present:

- `grep -c -- '--warning' client/src/index.css` → **0**
- the built CSS emits **zero** `.{text,bg,border}-{success,warning,info}` rules.

Consequence: **standalone, the migrated elements render uncoloured** (e.g. the conflict banner loses
its amber tint). Post-integration with W-A they render per the token contract. This is the intended
single-writer split (§7), but the coordinator must integrate W-A and W-E together — W-E must not be
merged alone. W-E did **not** edit `index.css` or `tailwind.config.ts`.

Also: the sub-12px sweep (`text-[9|10|11px]` → `text-xs`) was applied to the 8 owned files (24
occurrences; 18 components + 6 page-level). Visually a no-op given the floor rule at `index.css`.

---

## 5. Patches needing another owner

### 5.1 `client/src/pages/agent.tsx` → **W-F** (K1(b), agent half)

`getAskAgentUrl` (`lib/insights-state.ts:195`) emits `/agent?prompt=<text>`; the effect at
`agent.tsx:162-169` reads only `runId`, so "Ask Agent" (`learning-view.tsx`) lands on the hardcoded
default objective (`agent.tsx:127`) instead of the observation clicked. Route this to W-F:

```diff
   // Restore run from URL param (?runId=123) on initial load
   useEffect(() => {
     const params = new URLSearchParams(window.location.search);
     const runParam = params.get("runId");
     if (runParam && !Number.isNaN(Number(runParam))) {
       setSelectedRunId(Number(runParam));
     }
+    const promptParam = params.get("prompt");
+    if (promptParam) {
+      setComposer(promptParam);
+    }
   }, []);
```
(`composer` / `setComposer` are at `agent.tsx:127`.) No API change; seeds the composer only.

### 5.2 `client/src/pages/ingest.tsx` → **W-G**

`pages/sources.tsx:239` renders `IngestPage` inside the Sources shell, which already renders the
`PageHeader` `<h1 class="text-lg">`. `ingest.tsx:253` then renders a second, larger page title:

```tsx
<div className="flex flex-col h-full overflow-auto p-6 space-y-6">
  <div>
    <h1 className="text-2xl font-bold" data-testid="text-ingest-title">Ingest Content</h1>
```

Two page-level `<h1>`s on one route, the nested one larger than the shell's (§2.5 of the ia audit).
Suggested patch (keeps the `text-ingest-title` testid that `routes.e2e.spec.ts:24` asserts, and the
shell owns the page title):

```diff
-  <div className="flex flex-col h-full overflow-auto p-6 space-y-6">
+  <div className="flex flex-col h-full overflow-auto p-4 sm:p-6 space-y-6">
     <div>
-      <h1 className="text-2xl font-bold" data-testid="text-ingest-title">Ingest Content</h1>
+      <h2 className="text-base font-semibold" data-testid="text-ingest-title">Ingest Content</h2>
```

---

## 6. Could not do / explicitly deferred

- **`/sources?view=ingest` third band** — `ingest.tsx`'s own `TabsList` (`:271-276`) still stacks a
  third nav band under the two Sources bands. Resolving it means either folding Ingest into the
  subordinate row's vocabulary or demoting its tab row; both are the nav consolidation the
  coordinator deferred. Written up in §5.2 (heading) and §2.5 (band count).
- **Type-floor sweep of the whole client** — only W-E-owned files were swept (direction §3, LOW).
- **e2e** — not run (no dev server / DB in this worktree). Static contracts reviewed:
  `sources-workflow`, `create-workflow`, `canonical-ia`, `phase-33.2`, `full-product-audit`,
  `error-states`, `routes` specs — all asserted testids and hrefs are preserved. Note
  `error-states.e2e.spec.ts`'s "Discover" row forces a 500 on `/api/discover/ideas`, an endpoint
  `DiscoverTab` does not call; that row cannot pass from W-E's surface and was left untouched.
- **`create-studio` Voice/Template `Select` empties** — on a failed `voicesQuery`/`templatesQuery`
  the dropdowns show only "Default voice" / "None"; not treated as a list/empty region because
  there is no empty-state copy to falsify. Reported for completeness.
