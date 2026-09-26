# W-C — Shell + Shared Primitives: change report

**Workstream:** W-C (Shell + Shared Primitives)
**Branch:** `design/impl-c` @ `/Users/kishore/git/cf-design/impl-c`
**Base commit:** `87a0601` (baseline snapshot, phase-33.2 working tree)
**Direction read:** `docs/contentforge-design-direction.md` §2, §3, §4.2–4.4, §5.1–5.2, §6, §7, §8 ·
`docs/design-coordinator-synthesis.md` Groups G1(c), G1(e), H1, I1 · the four orchestration audits
(`accessibility`, `frontend-performance`, `responsive`, `motion`).

---

## 1. Files changed

| File | Findings | Change |
|---|---|---|
| `client/src/App.tsx` | H1, G1(e), route-change focus, G1(c) | 8 route pages converted to `React.lazy`, one shared `<Suspense>` with a `Skeleton` fallback inside `<main>`; shell height moved to `dvh` behind an `@supports` fallback; `main` made programmatically focusable and focused on client-side route change; sidebar trigger gets a coarse-pointer tier |
| `client/src/components/ui-shared/status-badge.tsx` | I1, A1 (§4.4 migration) | A glyph for all 17 statuses, spinner only where in flight, pulse demoted to reinforcement; 9 tone blocks migrated from amber/blue/emerald literals to `--warning`/`--info`/`--success` |
| `client/src/components/ui-shared/actor-badge.tsx` | A1 (§4.4 migration) | 4 palette literals → `--warning` |
| `client/src/components/ui-shared/empty-state.tsx` | `EmptyState` unification | Surface taken from the new shared `StateSurface`; contract documented; API and DOM/testids unchanged |
| `client/src/components/ui-shared/state-surface.tsx` | `EmptyState` unification | **New.** The one dashed surface shared by `EmptyState` and `ErrorState`, so the family cannot drift |
| `client/src/components/ui-shared/error-state.tsx` | `EmptyState` unification, motion audit #4, §3 type floor | Uses `StateSurface`; pending state now carries a word (`Retrying…`) instead of spin alone; `text-[10px]` → `text-xs` |
| `client/src/components/app-sidebar.tsx` | G1(c), §3 type floor | Nav rows take the 44px floor on `pointer: coarse`; logout button 28px → 44px on coarse; two `text-[10px]` → `text-xs` |
| `client/src/components/theme-toggle.tsx` | G1(c) | Header theme control 36px → 44px on `pointer: coarse` |
| `client/src/components/quick-capture.tsx` | G1(c) | Capture dialog's primary action 36px → 44px on `pointer: coarse` |

Not touched: `components/ui/**` (W-B), any page (W-D/E/F/G), `index.css` / `tailwind.config.ts` (W-A),
`use-mobile.tsx` (see §7.4 — deliberately unchanged), the seven canonical destinations, nav structure,
`CANONICAL_NAV_ITEMS`, and every legacy redirect.

---

## 2. I1 — status must not depend on hue or motion

`StatusBadge` now pairs every status with a glyph, exactly as `ActorBadge` pairs an icon with a word.

Proof (`status-glyph-proof.py`, run against the component source; exit 0):

```
statuses: 17   icons: 17   tone keys: 9

STATUS                   GLYPH              PULSE    WORD
draft                    FileText           -        Draft
needs_review             Eye                -        Needs review
approved                 Check              -        Approved
scheduled                Clock              -        Scheduled
publishing               Loader2            -        Publishing
published                Check              -        Published
generating               Loader2            yes      Generating
queued                   Clock              -        Queued
running                  Loader2            yes      Running
waiting_for_approval     Clock              yes      Waiting for approval
completed                Check              -        Completed
completed_with_errors    TriangleAlert      -        Completed with warnings
failed                   CircleAlert        -        Failed
rejected                 CircleX            -        Rejected
blocked                  Ban                -        Blocked
processing               Loader2            -        Processing
unknown                  CircleHelp         -        Unknown

PASS: every STATUS_TONE key has a paired icon; every status has a glyph AND a distinct word;
      no two statuses share a (glyph, word) pair; pulse is only ever reinforcement.
```

What the checks assert mechanically:
1. `STATUS_LABEL`, `STATUS_VARIANT`, `STATUS_ICON` cover the same 17 keys. All three are
   `Record<ContentStatus, …>`, so `tsc` enforces this at compile time — a new status cannot ship
   without a glyph. The script re-checks it against the literal source.
2. **Every `STATUS_TONE` key (9) has a paired icon** — the check the brief asked for.
3. No two statuses render the same (glyph, word) pair, so nothing collapses to identical pixels once
   the pulse is removed.
4. `pulse-live` appears only on states that also have a glyph: reinforcement, never the differentiator.

The spinner is `Loader2`, a broken-arc shape, not a rotated circle: under `prefers-reduced-motion`
the rotation stops (`.animate-spin.animate-spin{animation:none}`) and what remains is still a
distinct glyph. `generating`/`running` no longer differ by hue plus animation — they differ by glyph
and by word.

Contract preserved: `data-testid="status-badge-<key>"` and the label strings are untouched, including
the exact text asserted by the suite (`"Rejected"`, `/Completed with warnings/i`, and the negative
`not.toHaveText(/^Completed$/i)` at `agent-workspace.e2e.spec.ts:450`). Lucide icons are SVG paths
with no text nodes, so `toHaveText`/`toContainText` see the same string as before.

---

## 3. G1(e) — the shell height

`App.tsx` shell and auth-gate containers moved off bare `100vh` to
`h-screen [@supports(height:100dvh)]:h-dvh`.

**Measured, and the reason for the shape of the fix:** in the built stylesheet
`dist/public/assets/index-CfJgnxtb.css`, `.h-dvh{height:100dvh}` is emitted at byte offset **27,518**
and `.h-screen{height:100vh}` at **27,576** — i.e. *after* it. Both have the same specificity, so the
obvious `className="h-screen h-dvh"` silently keeps `100vh` and changes nothing. The `@supports
(height:100dvh)` rule is emitted at offset ≈114,000 (after every core height utility):

```
@media(pointer:coarse){…h-11{height:2.75rem}…w-11{width:2.75rem}}
@supports (height:100dvh){.\[\@supports\(height\:100dvh\)\]\:h-dvh{height:100dvh}}
```

so the upgrade applies only where `dvh` is understood and `100vh` remains the fallback everywhere
else. A scratch Tailwind run also confirmed that `[height:100vh;height:100dvh]` (two declarations in
one arbitrary property) is **not** supported by Tailwind 3.4.17 — it emits nothing — which is why the
`@supports` variant is the mechanism.

---

## 4. H1 — route-level code splitting

8 of the 10 page imports are now `lazy()`: the seven canonical destinations plus `/youtube` (the one
legacy route with a live mount). `NotFound` and `AuthPage` stay eager on purpose: a redirect or a 404
that flashes a skeleton before resolving reads as a broken route, and the pre-auth gate must not wait
on a second request.

One shared `<Suspense>` sits inside `<main id="main-content">`, above `<Router/>`, so the shell
(nav, header, theme, capture FAB) never suspends. The fallback is a `Skeleton` page-shaped frame —
`Skeleton`, not a spinner, per §5.2 ("spinners are for actions, not for page loads"), and it is
reduced-motion-safe by construction because `.pulse-skeleton` is neutralised.

### 4.1 Measured bundle (production build, same machine, same commit base)

| | pristine `HEAD` (all changes stashed) | W-C |
|---|---|---|
| JS assets | **1** (`index-dIeE5K35.js`) | **49** |
| Entry chunk | **1,792,007 B** | **362,254 B** (gzip 118,506 B) |
| Route chunks | — | create 646,110 · insights 497,549 · sources 71,130 · agent 60,275 · schedule 30,283 · settings 21,863 · today 12,537 · youtube 11,211 |

The pristine number reproduces WT-09's audited figure (1,792,007 B, filename `index-dIeE5K35.js`)
byte-identically, so the "before" column is the artifact the audit measured, not a synthetic one.

### 4.2 Measured `/today` first paint (real Chromium against the built bundle, stubbed API)

15 JS/CSS files, **152,128 B gzip / 521,985 B raw** to paint `/today` — the route the operator opens
every day. Baseline was a single-chunk critical path of 515.64 kB gzip JS + 18.14 kB gzip CSS =
**533.78 kB gzip**, so the first-load transfer for `/today` falls by **≈72 %**. The heavy
route-exclusive clusters now live in the chunks that need them: recharts + d3 in `insights`, tiptap +
prosemirror + highlight.js in `create`.

### 4.3 "Does any test rely on a synchronous mount?" — checked, and run

`e2e/routes.e2e.spec.ts` and `e2e/canonical-ia.e2e.spec.ts` both assert through auto-retrying
Playwright assertions (`toBeVisible` with a 20 s/30 s expect timeout, `toHaveCount`, `toHaveText`) —
none of them samples the DOM synchronously after navigation. I also grepped the whole `e2e` directory:
there are **zero** `.count()` / `allTextContents()` non-retrying samples, and the only two
`isVisible()` calls (`create-workflow.e2e.spec.ts:471`, `agent-publish.e2e.spec.ts:27`) target an
in-dialog date input and a review card, neither of which is route content.

Because the suite itself cannot run here (no PostgreSQL — see §6), I built a route-mount harness
(`route-smoke.mjs`) that runs the **real production bundle** in Chromium against a stubbed API and
asserts the exact selector each route is checked on, copied out of the two specs:

| | pristine `HEAD` | W-C (lazy) |
|---|---|---|
| Routes asserted (17, incl. every canonical + legacy-mapped destination) | **17/17 mounted** | **17/17 mounted** |
| Page errors | none | none |
| Active element after client-side nav to `/insights` | `A` (the nav link) | `MAIN#main-content`, title `ContentForge — Insights` |
| Focus inside Quick Capture dialog after an in-page route change | dialog owns it | dialog owns it |
| Spinning loaders on `/today` under `prefers-reduced-motion: reduce` | 0 | 0 |

**No route regressed.** Nothing was reverted. (Two of my early harness runs failed `/agent` and
`/ai-usage` for both builds — that was the stub returning `[]` where a page expects an object; with a
shape-agnostic failing-read stub, both builds mount all 17.)

---

## 5. Route-change focus (accessibility audit #6)

`Router`'s location effect now does two things instead of one: it sets the document title (as before)
and moves focus to the `main` landmark, which carries `tabIndex={-1}`.

- **Initial document load is skipped** (a `useRef` guard) — the browser already starts focus at the
  top of the page, and every `page.goto` in the suite is a full load, so no test's focus state moves.
- **A modal is never overridden.** If any `[role="dialog"|"alertdialog"][data-state="open"]` exists,
  or focus is already inside one, the move is skipped: Radix traps focus, hides the rest of the
  document from assistive tech and restores focus to the trigger on close, so moving focus out would
  be a focus escape. Measured: with Quick Capture open, a route change leaves focus inside the dialog.
- **It targets `main`, not the route `<h1>`.** The `<h1>` lives inside a lazily-loaded route chunk
  and does not exist at the moment the URL changes; `main` always does.

Before/after in the harness: `A` (still on the nav link the user clicked, nothing announced) →
`MAIN#main-content`.

---

## 6. G1(c) — bounded coarse-pointer tier, and what it cannot be verified by

8 utilities in 4 files, all scoped to `@media (pointer: coarse)`, all on the shell's highest-traffic
controls only:

| Control | Desktop | Coarse pointer | File |
|---|---|---|---|
| Mobile nav trigger (`SidebarTrigger`, the single entry point to nav on a phone) | 28px | 44px | `App.tsx:245` |
| 7 nav destination rows | 32px | 44px | `app-sidebar.tsx:160` |
| Sidebar sign-out | 28px | 44px | `app-sidebar.tsx:200` |
| Header theme toggle | 36px | 44px | `theme-toggle.tsx:20` |
| Quick Capture submit | 36px | 44px | `quick-capture.tsx:109` |

Compiled proof that the tier actually emits and actually wins: the built CSS contains one
`@media(pointer:coarse)` block,

```
@media(pointer:coarse){.\[\@media\(pointer\:coarse\)\]\:h-11{height:2.75rem}.\[\@media\(pointer\:coarse\)\]\:w-11{width:2.75rem}}
```

emitted at offset ≈114,000 — after `.h-8{` (27,177), `.h-7{` (27,157), `.h-9{` (27,145), so the
coarse rule overrides the primitives' desktop sizing inside the media query. (Note the same hazard as
§3: a *plain* `h-11` loses to `h-8`, because Tailwind emits `.h-11` at 26,812 — before `.h-8`.)

Before the change: `grep -rn coarse client/src` → **0 matches**; the tier did not exist anywhere in
the codebase.

**Stated plainly: this is structurally invisible to the automated suite.** `playwright.config.ts:40-62`
defines only `devices["Desktop Chrome"]` (chromium, api, no-auth), and `setViewportSize` changes
geometry, not input class — no project sets `hasTouch`/`isMobile`, so `pointer: coarse` never matches
in CI. I did **not** run a real touch device or a `hasTouch` project, so the tier is verified by
compiled CSS and source only. If the coordinator wants it *stayed* fixed, the gate needs a
`hasTouch: true` project — that is a config change outside my ownership.

---

## 7. Deliberately not done, and why

1. **No full tap-target sweep.** Per the brief: bounded to the five shell controls above. The 32px
   rows and 28px icons inside the pages (calendar day cells, `h-8` card actions, `h-7` tab triggers
   on `/schedule`, 30+ hand-rolled buttons) are untouched — that is a chrome redesign, not a fix.
2. **`components/ui/button.tsx`'s shared `size="icon"` (36px) is not raised**, because that file
   belongs to W-B. My controls raise their own box on coarse. Patch for W-B in §8.
3. **The mobile sidebar `Sheet` does not close when a nav row is clicked.** `ui/sidebar.tsx` exposes
   `setOpenMobile` and nothing calls it on navigation, so on a phone the drawer stays over the
   destination. It is a real shell defect and a two-line fix, but it is a navigation-behaviour change
   that the brief did not authorise for this workstream — routed to the coordinator in §8. (It is also
   exactly the case my focus guard deliberately defers to, so the two interact.)
4. **`hooks/use-mobile.tsx` is unchanged.** It decides `isMobile` from viewport width only
   (`< 768px`), never from pointer class. Making it pointer-aware looks like the obvious G1(c) move,
   but the suite runs `Desktop Chrome` — a `(pointer: coarse)`-based switch would flip the desktop
   rail on at 390px in CI, where the rail is `hidden md:block`, leaving the mobile matrix with **no
   nav at all**. Width-based detection plus the coarse sizing tier above is the bounded change; a
   pointer-aware composition decision belongs to the coordinator.
5. **`page-header.tsx`'s `sticky top-0 … backdrop-blur` is untouched.** The responsive audit (#7)
   found `sticky` is inert on 5 of 7 routes because the header is a sibling *above* the scroll
   container, and asked for a decision: make it sticky-by-design on all 7 (pages' files) or drop the
   class and the blur (my file). That is a product decision, not a defect fix; routed in §8.
6. **No re-skin.** Radii, spacing, type scale, hue direction, and the visual language are unchanged.
   The only colour changes are semantic-literal → semantic-token at identical intent.

---

## 8. Patches the coordinator must route (I did not edit these files)

1. **W-A — required integration prerequisite.** The `--success`, `--warning`, `--info` tokens and
   their `tailwind.config.ts` mapping (§4.2) must land with, or before, this branch, or the migrated
   classes are inert. Verified: with the §4.2 mapping in place, all nine semantic utilities I use
   emit correctly —
   `.text-success`, `.text-warning`, `.text-info`, `.bg-success/10`, `.bg-warning/10`,
   `.border-success/30`, `.border-warning/30`, `.border-warning/40`, `.border-info/30`.
   In *this* worktree they emit nothing (the tokens do not exist here yet), so the status/actor
   badges currently fall back to the `Badge` variant's own colour. **Do not integrate W-C alone.**
2. **W-D — `components/insights/learning-view.tsx`** (explicitly routed to me as a recommendation
   only; I did not touch it). 13 hand-rolled empties compete with `EmptyState`: `Card
   className="border-dashed bg-muted/20"` at `:681`, `:898`, `:1654`, plus the three
   `p-4 border-dashed bg-muted/20 flex flex-col justify-between` cards at `:1829`, `:1844`, `:1859`.
   Recommended patch, per site — replace the outer `<Card className="border-dashed bg-muted/20">`
   wrapper with `<EmptyState icon={…} title={…} description={…} testId="empty-…">`, keeping the
   existing `data-testid` (which the suite reads) and moving the action into `action={…}`.
   `EmptyState`'s surface is now `StateSurface` (`rounded-md`), the same as `ErrorState`, so the
   three sights stop disagreeing about radius.
3. **W-E / W-F / W-G — the other 7 bypasses**, same swap, exact sites:
   `components/sources/research-tab.tsx:173` · `saved-tab.tsx:318` · `discover-tab.tsx:371,482` ·
   `pages/agent.tsx:665,812,906`. Their present markup is
   `rounded-lg border border-dashed p-6|p-8 text-center space-y-2 text-muted-foreground` — a
   hand-rolled copy of `EmptyState` with a different radius. `EmptyState` accepts the same props they
   already have; `className="p-6"` is available for the denser two.
4. **W-B — `components/ui/button.tsx`.** `size: icon` is `h-9 w-9`; the shared step could carry the
   coarse tier once (`[@media(pointer:coarse)]:h-11`), which would fix every icon button in the
   product instead of the five shell ones. `components/ui/sidebar.tsx`'s `SidebarMenuButton` size
   `default: "h-8"` and `SidebarTrigger`'s hardcoded `h-7 w-7` are the same argument — I patched them
   from my files via `className`, which is the bounded version.
5. **Coordinator decision — mobile sheet dismissal** (§7.3): `app-sidebar.tsx` (my file) could call
   `setOpenMobile(false)` on nav click; `ui/sidebar.tsx` (W-B) could do it in the primitive. One
   owner should own it.
6. **Outstanding spin-only pending states (motion audit #4)** — I fixed the one in my files
   (`error-state.tsx`, now `Retrying…` + spin). The other 8 sites are other owners':
   `learning-view.tsx:664,775,881,980,1638`, `artifact-review-view.tsx:535,589`, `queue.tsx:503`.
   Same patch shape: keep the spin, change the word while pending.
7. **Do not change `EmptyState`'s default `testId` (`"empty-state"`)** — `today-schedule.e2e.spec.ts:76`
   locates publications through it.

---

## 9. Verification: what I ran, and what I could not

**Ran — all green unless stated**

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run check` | clean |
| Production build | `npm run build` | succeeds, 49 assets, `✓ built in 2.93s` |
| Bundle before/after | `git stash push -u` → `npm run build` → `git stash pop`, `ls -l dist/public/assets/*.js` | 1,792,007 B / 1 chunk → 362,254 B entry + 8 route chunks |
| `/today` first-paint transfer | `today-transfer.mjs` — real Chromium, production bundle, response bodies summed | 15 files, 152,128 B gzip (was 533.78 kB gzip) |
| Route-mount regression | `route-smoke.mjs` — 17 spec-copied selectors, pristine vs W-C builds | 17/17 in both; no page errors in either |
| Route-change focus | same harness | `A` → `MAIN#main-content`; dialog keeps focus |
| Reduced motion | same harness, `emulateMedia({reducedMotion:"reduce"})` | 0 spinning loaders on `/today` |
| I1 glyph coverage | `status-glyph-proof.py` | PASS (table in §2; exit 0) |
| Coarse-pointer emission | byte-offset scan of `dist/public/assets/index-*.css` | 1 `@media(pointer:coarse)` block, emitted after `.h-7/.h-8/.h-9` |
| `dvh` emission order | byte-offset scan of the same CSS | `.h-dvh` 27,518 < `.h-screen` 27,576; `@supports (height:100dvh)` ≈114,000 |
| Token migration compiles | scratch Tailwind 3.4.17 run with the §4.2 mapping over `client/src/**` | 9/9 semantic utilities emit |
| Literal sweeps | `grep -rnE "(bg\|text\|border\|ring\|fill)-(amber\|blue\|emerald\|…)-[0-9]{2,3}"` over my files | 0 palette literals; 0 `text-[10px]/[11px]/[9px]` |

**Could not run — stated honestly**

1. **`playwright test` (the real suite).** No PostgreSQL in this environment: `DATABASE_URL` is unset,
   `pg_isready` reports no response on 5432, and docker is unavailable, so the auth `setup` project
   and every fixture-based spec cannot start. This is the one verification the brief asks for that I
   could not complete; §4.3's harness is the substitute, and it covers the specific risk (route mount
   path) the brief names.
2. **axe / `color-contrast` on the new badges.** Requires the running app + DB. Nothing measured.
3. **Contrast of `--warning` / `--success` / `--info`.** Cannot be measured here — the tokens do not
   exist in this worktree (W-A owns them, §4.3 is W-A's deliverable). I add no contrast claim.
4. **A real coarse-pointer device / `hasTouch` project.** Not run — see §6. The tier is verified from
   compiled CSS only.
5. **iOS Safari `dvh` behaviour on device.** Verified from CSS emission order only.
6. **`npm run test:unit`** was attempted: the pure unit tests pass, and the failures are
   `Error: DATABASE_URL must be set` (server DB tests) — environmental, identical with and without my
   changes, and unrelated to any file I touched.
7. **Rendered pixels.** No screenshots were taken; every claim above is from the built bundle, the
   compiled stylesheet, or a headless run against the production artifact.

## 10. Assumptions recorded

- The `@supports (height:100dvh)` construction is a *fallback in the CSS-idiomatic direction*
  (old value first, upgrade last) rather than `dvh` alone, because an unsupported engine would get no
  height at all on a fixed app shell.
- `publishing` and `processing` are treated as in-flight (spinner), and `needs_review`/`draft` as
  neutral — the direction's table does not name them; every state still got a distinct glyph so the
  "no state distinguished by colour or motion alone" bar holds for the whole vocabulary, not just the
  seven named rows.
- `waiting_for_approval` keeps its warning tone (it needs the operator) while taking the clock glyph,
  per the direction's table.
