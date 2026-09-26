# Frontend Performance Audit — ContentForge

**Agent:** Frontend Performance UX (worktree 9)
**Worktree:** `/Users/kishore/git/cf-design/wt-09` (branch `design/wt-09`)
**Repo under audit:** `/Users/kishore/git/ContentForge` (read-only, byte-identical worktree)
**Date:** 2026-09-26
**Mode:** report only — no source file was modified; no dev server was started
**Scope:** initial load path, route loading, bundle size, duplicate requests, rendering cost, observable UI delays

---

## Verdict

**Block.** One `HIGH` is standing: the entire application ships as a single **1,792,007-byte (≈1.71 MiB) JavaScript chunk** with **zero route code-splitting**, and **1,389.0 KiB of the 1,743.7 KiB** of shipped code (79.6%) is reachable only from routes other than `/today`.

### Vital 5 (Speed) from `checkup-report.md`: 10/10 — **refuted, corrected to 5/10 (Watch)**

The checkup's Speed justification is narrow and, read literally, correct:

> "No CLS-prone primitives. No `transition-all` on layout-affecting properties. … Skeletons are used instead of spinners for content regions … The only spinner is the auth bootstrap (`App.tsx:136`), which is the correct place for one."

I confirm the *layout-shift* half of that: I found no `transition-all` on layout-affecting properties, no unsized media, no font-swap-induced reflow, and no dynamic content injected above static content. That sub-claim holds.

The *load* half does not hold, and the checkup did not measure it:

- The checkup's "Not verified" section states outright: **"Real Core Web Vitals or bundle timing — no runtime measurement taken."** A 10/10 was therefore awarded on a claim that was never measured. `references/checkup.md` ("Evidence Bar") requires each vital to be based on something visible, interactive, or present in files, and forbids marking a vital healthy without evidence.
- Under the vital's own wording — *"does it load and respond without visible hesitation"* — the load path is the measured defect: a single 1.71 MiB script, no code-splitting, 7 HTTP requests on `/today` delivered in two serial waves, and one render-blocking third-party stylesheet on the critical path.

Correct score: **Watch (5/10)**. The layout-shift probes pass; the load-and-respond claim fails on measurement. Corrected checkup total: **30/60** (Accessibility `Critical` is unchanged and still not averaged away — its escalation trigger already stands in the checkup).

**Caveat, stated honestly:** I did not run Lighthouse or a device-level trace. Every number below is a compile-time or source-level measurement (real bundle bytes, real module attribution, real request counts). The 10/10 is refuted by measurement; the *milliseconds* are a verification gap, listed at the end.

---

## Measured bundle size

| Artifact | Raw | Gzip |
|---|---|---|
| `assets/index-dIeE5K35.js` (the whole app — 1 chunk) | **1,792,007 B (1,750.0 KiB / 1.71 MiB)** | **515.64 kB** |
| `assets/index-BQvJOzMk.css` | 114,771 B (112.1 KiB) | 18.14 kB |
| `index.html` | 750 B | 0.41 kB |
| **Total critical path JS+CSS** | **1,906,778 B (1.82 MiB)** | **533.78 kB** |

The worktree build output hash (`index-dIeE5K35.js`) is **identical** to the artifact already committed in the main repo at `/Users/kishore/git/ContentForge/dist/public/assets/index-dIeE5K35.js` (1,792,007 B, built 06:23 today). This is the shipped bundle, not a synthetic one.

Vite emits its own warning on this build:

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
```

### Top 10 packages by weight that actually ship to the client

Attribution: decoded the production sourcemap (segment-length VLQ attribution, 99.6% of chunk bytes attributed across 834 modules).

| # | Package | Shipped bytes | % of JS |
|---|---|---|---|
| 1 | `recharts` | 263.2 KiB | 15.1% |
| 2 | `highlight.js` | 166.5 KiB | 9.5% |
| 3 | `react-dom` | 129.0 KiB | 7.4% |
| 4 | `prosemirror-view` | 94.8 KiB | 5.4% |
| 5 | `@tiptap/core` | 79.8 KiB | 4.6% |
| 6 | `prosemirror-model` | 43.5 KiB | 2.5% |
| 7 | `lodash` | 36.6 KiB | 2.1% |
| 8 | `prosemirror-transform` | 30.2 KiB | 1.7% |
| 9 | `@tanstack/query-core` | 30.1 KiB | 1.7% |
| 10 | `react-smooth` | 18.6 KiB | 1.1% |

Next: `@radix-ui/react-tooltip` 27.6 · `lucide-react` 21.1 · `date-fns` 20.3 · `tailwind-merge` 19.5 · `@radix-ui/react-select` 17.3 · `linkifyjs` 17.1 · `d3-scale` 14.7 · `@tiptap/extension-list` 14.5 · `d3-shape` 13.5 · `decimal.js-light` 12.8.

Two clusters account for almost all of the waste:

- **Charts cluster — 392.5 KiB:** `recharts` 263.2 + `lodash` 36.6 + `react-smooth` 18.6 + `d3-scale` 14.7 + `d3-shape` 13.5 + `decimal.js-light` 12.8 + `d3-time-format` 9.2 + `d3-color` 7.1 + `fast-equals` 6.3 + `recharts-scale` 5.8 + `d3-format` 4.7. Reached only via `analytics.tsx:24-35`, `ai-usage.tsx:10-13`.
- **Rich-text cluster — 492.6 KiB:** `highlight.js` 166.5 + `prosemirror-view` 94.8 + `@tiptap/core` 79.8 + `prosemirror-model` 43.5 + `prosemirror-transform` 30.2 + `linkifyjs` 17.1 + `@tiptap/extension-list` 14.5 + `prosemirror-state` 11.6 + `prosemirror-commands` 8.9 + `@tiptap/react` 8.5 + `@tiptap/extension-link` 6.4 + `prosemirror-history` 5.6 + `@tiptap/extensions` 5.2. Reached only via `tiptap-editor.tsx:1-9` ← `articles.tsx:7` ← `create.tsx:9`.

Together: **885.1 KiB** of code that no `/today` render touches.

### What `/today` actually needs

Walking the import graph from `client/src/pages/today.tsx` plus the shell (`App.tsx`, `not-found.tsx`, `auth.tsx`, ignoring `App.tsx`'s page imports):

| | KiB | Share of 1,743.7 KiB |
|---|---|---|
| App code needed to render `/today` | 61.0 | 3.5% |
| Packages needed to render `/today` (`react-dom` 129.0, `@tanstack/query-core` 30.1, `@radix-ui/react-tooltip` 27.6, `lucide-react` 21.1, `date-fns` 20.3, `tailwind-merge` 19.5, `@radix-ui/react-toast` 10.3, `react-icons` 7.5, `react` 7.3, `@radix-ui/react-dialog` 4.7, `scheduler` 3.8, `wouter` 3.5, `@tanstack/react-query` 2.4, …) | 293.6 | 16.8% |
| **Total actually needed** | **354.6** | **20.3%** |
| Route-exclusive (other routes' pages, components, and libraries) | **1,389.0** | **79.6%** |

The five heaviest route-exclusive app modules: `learning-view.tsx` 47.0 KiB, `ingest.tsx` 23.5, `settings.tsx` 19.7, `agent.tsx` 18.4, `queue.tsx` 14.4.

---

## Measurements taken

Everything was run inside `/Users/kishore/git/cf-design/wt-09`. Nothing was run against the main repo, and no source file was edited. `<scratch>` = the session scratchpad.

| # | Measurement | Exact command | Exact observed number |
|---|---|---|---|
| M1 | Production bundle, plain | `npx vite build --outDir <scratch>/d9dist` | `index-dIeE5K35.js 1,792.01 kB │ gzip: 515.64 kB`; `index-BQvJOzMk.css 114.77 kB │ gzip: 18.14 kB`; `index.html 0.75 kB`; `✓ 2992 modules transformed`; `✓ built in 3.31s`; warning `Some chunks are larger than 500 kB` |
| M2 | Shipped artifact corroboration | `ls -la /Users/kishore/git/ContentForge/dist/public/assets/` | `index-dIeE5K35.js` **1,792,007 B**, `index-BQvJOzMk.css` **114,771 B** — same content hash as M1 |
| M3 | Production bundle with sourcemap | `npx vite build --sourcemap --outDir <scratch>/d9map` | JS 1,792,050 B; map 12,035,000 B; `834` mapped sources |
| M4 | Per-package shipped weight | `node <scratch>/pkgweight.mjs <scratch>/d9map/assets/index-dIeE5K35.js.map` | `total generated bytes attributed: 1785578` (99.6% of the chunk); top row `263.2 KiB 15.1% node_modules/recharts` |
| M5 | Route reachability vs. weight | `node <scratch>/reach.mjs <scratch>/d9map/assets/index-dIeE5K35.js.map` | needed 61.0 + 293.6 KiB; route-exclusive 366.3 + 1022.7 KiB; `needed file count: 36 of 144` |
| M6 | Code-splitting present? | `grep -rEn "React\.lazy\|[^a-zA-Z]lazy\(\|<Suspense" client/src \| wc -l` | **0** |
| M7 | Query/mutation surface | `grep -rEo "useQuery[(<]" client/src \| wc -l` | **89** call sites (`useMutation`: 154 occurrences) |
| M8 | Polling sites | `grep -rn refetchInterval client/src \| grep -v queryClient.ts \| wc -l` | **7** |
| M9 | `/today` mount request count | `grep -n "useQuery" client/src/pages/today.tsx` + `App.tsx:129` | **7 distinct GETs** (1 import + 6 route calls, + 1 auth) |
| M10 | highlight.js grammars shipped | `grep -o "highlight\.js/es/languages/[a-z0-9-]*\.js" <scratch>/d9map/...js.map \| sort -u \| wc -l` | **37** language modules (`arduino`, `r`, `swift`, `wasm`, `vbnet`, `php-template`, `objectivec`, `scss` 14.0 KiB, `less` 13.9 KiB, `css` 12.9 KiB, …) |
| M11 | Font stylesheet on critical path | `cat <scratch>/d9dist/index.html` vs `client/index.html` | **3** font tags preserved verbatim in the built HTML (2 `preconnect` + 1 render-blocking `rel=stylesheet`); 0 self-hosted font files |
| M12 | Client source size | `find client/src -name '*.tsx' -o -name '*.ts' \| xargs wc -l \| tail -1` | **26,464** lines; largest file `learning-view.tsx` **1,909** lines |
| M13 | `learning-view.tsx` structure | `grep -c` on that file | `useQuery` **7**, `useMutation` **11**, `useState` **4**, `React.memo`/`memo(` **0**, `useMemo` **1** |
| M14 | Chart-colour probe cost | `grep -c getComputedStyle client/src/hooks/use-chart-colors.ts` | **2** call sites — 1 outside a 5-iteration loop, 1 **inside** it (5 write→read pairs) |
| M15 | Server list caps (unbounded-list check) | `grep -n "query.limit" server/agent/routes.ts server/agent/storage.ts server/content/learning/routes.ts server/content/autonomy/routes.ts` | defaults/caps **5 / 10 / 20 / 30 / 50 / 100** — every list endpoint is bounded |
| M16 | `index.css` source → built | `wc -c client/src/index.css` | 20,343 B source → 114,771 B built (5.6×, i.e. Tailwind utilities) |

Attribution method note (for M4/M5): I decoded the shipped sourcemap's `mappings` VLQ stream and summed generated characters per source using segment→segment column deltas, then grouped by `node_modules/<pkg>` and by repo-relative app path. This measures **post-minification generated bytes per module**, which is the correct unit for "what ships" — not the unminified `renderedLength` that visualizer plugins report. 1,785,578 B of the 1,792,007 B chunk (99.6%) is attributed; the 6,429 B residual is chunk framing and top-level statements.

---

## Findings

Ordered by severity, then by reach/leverage. **Discipline** uses the design-reference vocabulary (`references/severity.md`); Performance rules are mapped to their closest owning reference — **Surface** for payload and component structure, **Interaction** for loading and request behaviour, **Layout** for waterfall and render work, **Type** for font delivery.

| # | Severity | Discipline | Location (file:line) | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | HIGH | Surface | `client/src/App.tsx:12-21` (9 static page imports), `client/vite.config.ts:24-27` (no `build.rollupOptions`), `client/src/pages/insights.tsx:5-7` | One chunk: **1,792,007 B / 515.64 kB gzip**, `2992 modules transformed`, 0 `React.lazy`/`Suspense` in `client/src`. `/today` needs **354.6 KiB**; **1,389.0 KiB (79.6%)** is route-exclusive, incl. **392.5 KiB** recharts-cluster and **492.6 KiB** tiptap/prosemirror/highlight.js-cluster. Every cold load pays for all 7 routes to render 1 | Convert the 9 page imports to `React.lazy` + one `<Suspense>` boundary inside `<main id="main-content">` (`App.tsx:155`), and add `build.rollupOptions.output.manualChunks` splitting `recharts`+`d3-*`+`lodash`, `@tiptap/**`+`prosemirror-*`+`highlight.js`, and `@radix-ui/**`. Target: ≤400 KiB on `/today`'s chunk | Systemic on every cold load for every route. The operator's stated budget is 5 minutes/day; the product's own constitution says "Nothing should perform before the operator can work." Today ships the Agent, the editor, and the charts before it ships the page |
| 2 | MEDIUM | Interaction | `client/src/App.tsx:128-138` (`if (isLoading) return <spinner/>`), with `client/src/pages/today.tsx:65-75` | 7 GETs in **2 serial waves**: wave 1 = `/api/auth/me`; wave 2 = 6 route queries. The route tree cannot mount until wave 1 resolves, so 6 parallelisable requests wait on 1 | Render the shell/route immediately and let route queries start in parallel (`getQueryFn({on401:"returnNull"})` already exists for exactly this), or replace the full-screen gate with a per-region boundary | A waterfall that serialises 6 requests behind 1. The 6 route queries are independent of `auth/me` and could all be in flight during the same RTT |
| 3 | MEDIUM | Interaction | `client/src/pages/today.tsx:65` vs `client/src/pages/today.tsx:75`; `client/src/pages/today.tsx:67` vs `client/src/components/schedule/publications-view.tsx:21` | The same collection is fetched twice under two keys: `/api/artifacts?readiness=in_review&limit=10` **and** `/api/artifacts?limit=5` fire on one `/today` mount (2 requests, 1 collection). Separately, publications is keyed `?limit=20` (Today) and `?limit=30` (Schedule) → 2 cache entries, 2 fetches. Global `staleTime: Infinity` + `refetchOnWindowFocus: false` (`queryClient.ts:84-86`) means these are genuine duplicate *network* requests, not cache hits | Key both artifacts reads on one canonical key and `select`-slice the 5-row view client-side; key publications on one canonical key and slice | Today spends 2 of its 6 route requests on one collection. `staleTime: Infinity` correctly prevents refetch storms, which is why key fragmentation — not remounting — is the duplicate cost here |
| 4 | MEDIUM | Interaction | `client/src/components/insights/learning-view.tsx:245,256,266,274,360,370,555` + `client/src/components/insights/automated-optimization-panel.tsx:82,85` | Opening `/insights?view=learning` fires **9 concurrent GETs** at once: `style/profiles`, `learning/summary`, `learning/proposals`, `learning/observations`, `experiments`, `policy-candidates`, `policy-candidates/activated-ids`, `autonomy/status`, `autonomy/decisions` | Gate the below-the-fold tiers (`experiments`, `policy-candidates`, `activated-ids`, `autonomy/*`) behind a lazy mount or `enabled:` flag so tier 1 loads first, or split the component per tier | A 5-minute/day operator opens one tab and opens 9 sockets. Only 3 of the 9 are needed to paint the first tier |
| 5 | MEDIUM | Interaction | `research-panel.tsx:46-50`, `video-panel.tsx:47-50`, `video-panel.tsx:61-65`, `repurpose-panel.tsx:92-96`, `audio-panel.tsx:35-38`, `discover-tab.tsx:73-77` | **7** `refetchInterval` sites, all **1,200–1,500 ms**, with no backoff and no cap on concurrent pollers. The Agent diagnostics drawer (`agent.tsx:443-486`) mounts `ResearchPanel`+`VideoPanel`+`AudioPanel`+`RepurposePanel` together, so with a research job, a video generation, and a repurpose plan in flight, **5 queries poll every 1.2–1.5 s concurrently** (≈3.4 req/s sustained) | Raise the idle poll to 3–5 s, add exponential backoff after N empty polls, and collapse the 3 in-flight pollers into a single `/api/agent/activity` poll | Poll fan-out is per-panel local state, so nothing coordinates it. The panels are correctly `enabled:`-gated on a job id, so the fan-out only occurs while work is genuinely running — which is exactly when the server is busiest |
| 6 | MEDIUM | Type | `client/index.html:7` (preserved verbatim in `dist/index.html`) | **1 render-blocking third-party stylesheet** (`fonts.googleapis.com/css2?family=Open+Sans…`) in `<head>`, mitigated only by 2 `preconnect`s; **0** self-hosted font files. First paint waits on DNS + TLS + CSSOM from a third-party origin before the browser can paint text | Self-host the 2–3 weights actually used (Open Sans 400/600) with `font-display: swap` and `<link rel="preload" as="font" crossorigin>` | `preconnect` removes the handshake but not the blocking fetch. The brief already declares this a product surface where system fonts are acceptable — the only reason for a webfont here is the token name |
| 7 | MEDIUM | Surface | `client/src/components/insights/learning-view.tsx:1907` (single `return`), `:237`, `:349`, `:549-550`, `:345-352` | One component: **1,909 lines**, **7** `useQuery`, **11** `useMutation`, **4** `useState`, **0** `React.memo`, **1** `useMemo`. It ships as **47.0 KiB** — the heaviest app module in the bundle. `toggleEvidence`/`toggleExperiment` set a full-object state map from a row-level button, so one drawer toggle re-renders all four tiers (proposals, experiments, inferences, policy candidates) | Extract each tier into its own memoised component and hoist the two expanded-id maps into a reducer; wrap tier boundaries in `React.memo` | Structural measurement only (I counted the boundaries; I did not profile frames — see Verification gaps). One row toggle currently invalidates the whole 1,909-line subtree, including every card that did not change |
| 8 | LOW | Layout | `client/src/hooks/use-chart-colors.ts:25-35`, called from `analytics.tsx:118` and `ai-usage.tsx:110` | Per mount: appends a probe `<div>` to `document.body`, then runs **5 interleaved write→read pairs** (`probe.style.color = …` immediately followed by `getComputedStyle(probe).color`) — 5 forced synchronous style recalcs. It is called **before** the `isLoading`/`isError` early returns in both pages, so it runs even when the page paints only a skeleton | Read the 5 `--chart-N` tokens once via `getComputedStyle(document.documentElement)` on the root and parse `hsl()` in JS — 1 read, 0 writes, no DOM mutation | Memoised on `theme` so it is not per-render, but the probe is per-mount and does 5 layout-forcing reads where 1 would do |
| 9 | LOW | Surface | `client/src/components/tiptap-editor.tsx:9` (`createLowlight(common)`) | `highlight.js` ships **37 language grammars (166.5 KiB, 9.5% of the bundle)** — `arduino`, `r`, `swift`, `wasm`, `objectivec`, `php-template`, `scss` (14.0 KiB), `less` (13.9 KiB), `css` (12.9 KiB) — to highlight code blocks in a social-post composer | Import the 8–10 grammars the operator's niche actually uses (js, ts, json, bash, yaml, python, sql, go, dockerfile, plaintext) via `createLowlight(...)`, or lazy-load the highlighter on first code-block insertion | Survives even after finding #1 is fixed, because it lands in the `/create` chunk. 166.5 KiB of grammars for a DevOps-single-operator posting surface |

**Counts:** 1 HIGH · 6 MEDIUM · 2 LOW.

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `client/src/pages/today.tsx:176-192`, `client/index.css` (`.rise-in`) | Staggered entry animation on the Attention list (`animationDelay: ${Math.min(index*40,200)}ms`) costs first-paint work on the most-opened page | Deliberate and capped by design. The brief: "Staged arrival … so severity order is legible on arrival. Capped on purpose." Blocked at 200 ms, so it cannot extend the wait. Not a finding |
| `client/src/pages/agent.tsx:154`, `client/src/pages/insights/learning-view.tsx:361,371`, `server/content/autonomy/routes.ts:148`, `server/content/learning/routes.ts:180` | Unbounded lists rendered without virtualization | Measured caps instead: `/api/agent/runs` default 30, hard max 100 (`server/agent/routes.ts:177-179`, `server/agent/storage.ts:182`); learning proposals/observations and autonomy decisions default 50, max 100; Today slices to 5/8/10/20/30. Every list is bounded by the server, so virtualization would buy nothing at these row counts |
| `client/src/pages/ai-usage.tsx:112-115` | Charts re-rendering on every keystroke of a filter | The only control is a 3-option `<Select>` (`days`), which changes the `queryKey` and therefore issues a new request — that is the intended behaviour, not a keystroke re-render. There is **no** text/search input on either chart page. `useChartColors` is memoised on `theme` with an explicit comment about exactly this failure mode. Not a finding |
| `client/src/pages/insights.tsx:5-7`, `:88-112` | `AnalyticsPage` / `AiUsagePage` / `LearningView` all eagerly mounted by the `Tabs` root | Radix `Tabs.Content` does not render inactive content without `forceMount`, so only the active tab's queries fire (confirmed against finding #4: 9 GETs, not 9+3+7). The *code* is eager in the bundle — that is counted in finding #1, not double-reported here |
| `client/src/index.css:50-57` built to `114,771 B` CSS | Oversized stylesheet | 18.14 kB gzip, same-origin, no third-party render-blocking cost, and 5.6× growth from a 20,343 B source is normal Tailwind-utility expansion. Not worth a change |
| `@replit/vite-plugin-runtime-error-modal` in `vite.config.ts:3,10` (always registered, including production) | Dev overlay leaking into the production bundle | Measured: `grep -c "runtime-error\|replit" dist/assets/index-*.js` → **0**. The plugin injects nothing into the built chunk. Correctly not a finding |
| `client/src/components/quick-capture.tsx`, `client/src/components/app-sidebar.tsx` | Shell components issuing data requests on every page | Both use `useMutation` only — no `useQuery` in either. The shell costs exactly 1 request on mount (`App.tsx:129`). Counted in finding #2, not reported separately |

---

## Verification gaps (not findings)

- **No device-level trace.** I did not run Lighthouse, WebPageTest, or a Chrome performance profile, and did not start a dev server. The ms-cost of the 1.71 MiB payload and of the font stylesheet on a cold 4G load is unmeasured. What *is* measured is bytes, module attribution, and request counts.
- **No runtime render profiling.** Finding #7 is the count of memo boundaries and state atoms in `learning-view.tsx`, not a React Profiler flame chart. The claim "one toggle re-renders four tiers" is derived from the component structure; the frame time is unmeasured.
- **Gzip-per-package is unmeasured.** The 515.64 kB gzip is the whole chunk. Per-package figures in the top-10 table are post-minification *raw* bytes from the sourcemap; minified-but-uncompressed, so gzip will compress the repeated React/Radix code proportionally more than the data-heavy parts.
- **Request timing is inferred from source, not observed.** Findings #2–#5 count and locate requests (`useQuery` call sites, `refetchInterval` values, key strings). No HTTP trace was captured — no dev server was started, per the task rules.
- **`prefers-reduced-motion`, hover, and focus behaviour** are outside this audit's scope and are covered by the existing checkup findings.

---

## Verdict

**Block** — finding #1 (single 1.71 MiB chunk, 0 route code-splitting, 79.6% route-exclusive payload) is `HIGH` and standing. Per `references/severity.md`, a report mode does not fix: the follow-up is a **structural** pass, not polish — route-level `React.lazy` + `<Suspense>`, `manualChunks` for the charts and editor clusters, and de-serialising the auth gate. Finding #1 alone is worth roughly **1.3 MB of the 1.71 MB** first-load payload for the route the operator actually opens every day.
