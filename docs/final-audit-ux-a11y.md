# Final Audit — UX, UI, Accessibility, Responsive

**Auditor:** independent final auditor (audit-c worktree)
**Scope:** the seven canonical destinations — `/today`, `/create`, `/sources`, `/agent`, `/schedule`, `/insights`, `/settings` — **rendered**.
**Worktree:** `/Users/kishore/git/cf-design/audit-c`, detached at **`origin/main` = `a763250`** (`docs(design): wave-2 parallel verification, corrections, and integration gap report`).
**Build under test:** `npm run build` (production bundle `dist/index.cjs` + `server/public/`), served by `node dist/index.cjs`, `NODE_ENV=production`, `PORT=4303`.
**Tenant data:** `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e` (migrated). The database is **empty** — no demo seed (server logged `demo data seed disabled`). Every "empty" surface below is therefore a real empty state, not a fixture.
**Prior reports:** treated as unverified. Nothing here is copied from them; every number is from this run.

---

## 0. Method (and what it can and cannot see)

* **axe run with the FULL default rule set** — no `withRules([...])` subset, both themes (`localStorage.theme = light|dark`, re-read as a `class` on `<html>`). `resultTypes: ['violations']`.
* The app ships a strict CSP (`script-src 'self'`). Playwright's `addScriptTag({content: axeSource})` is blocked by it (`page.addScriptTag: Executing inline script violates … script-src 'self'`). axe was therefore injected through CDP `Runtime.evaluate` (`page.evaluate(axeSource)`), which is not subject to CSP. This is an environment note, not a product defect — and it is independently good news: the CSP is real and enforced.
* Theme is stored under `localStorage["theme"]` and applied as `.light` / `.dark` on `documentElement` (`client/src/components/theme-provider.tsx`). Both were exercised for every route.
* Each route is code-split (`client/src/App.tsx:30-37`), so each run waited for `#main-content` + `networkidle` + settle.
* **Tab panels and overlays are not rendered on first paint** (Radix Tabs renders the active panel only, and dialogs only when opened), so a first-paint axe pass under-reports them. A **second deep pass** opened every tab and every overlay and re-ran axe there. Where the two disagree, the deep pass is the finding.
* **Keyboard / focus / touch / reflow probes** are custom DOM probes (tab order, computed focus ring, dialog focus-trap and restore, target sizes, `scrollWidth` vs `clientWidth`).
* Raw evidence (JSON + screenshots) was produced by throwaway harnesses `audit-run.mjs`, `audit-probe*.mjs`, `audit-measure.mjs`, `audit-coarse.mjs` at the worktree root. These are not committed.

### Caveat that changes how you read "0 violations"
axe's `label` rule **does not flag a placeholder-only field**. Proven on this app with a synthetic `<input placeholder="hello">` and `<textarea placeholder="world">`: axe returned **0 violations and 0 incomplete**. Section 2.2 is a real WCAG defect that axe is structurally unable to see; it was found by DOM probing, not by axe. **"0 axe violations" is not "accessible".**

---

## 1. axe results — route × theme (full rule set)

### 1.1 Default first paint (the seven destinations)

Every cell is **0 violations**. `mains` = number of `<main>` landmarks; `h1` = number of `<h1>`; both are asserted across the set.

| Route | Light | Dark | `<main>` | `<h1>` | Title |
|---|---|---|---|---|---|
| `/today` | **0** | **0** | 1 | 1 | ContentForge — Today |
| `/create` | **0** | **0** | 1 | 1 | ContentForge — Create |
| `/sources` | **0** | **0** | 1 | 1 | ContentForge — Sources |
| `/agent` | **0** | **0** | 1 | 1 | ContentForge — Agent |
| `/schedule` | **0** | **0** | 1 | 1 | ContentForge — Schedule |
| `/insights` | **0** | **0** | 1 | 1 | ContentForge — Insights |
| `/settings` | **0** | **0** | 1 | 1 | ContentForge — Settings |

Exactly one `<main>`, one `<nav aria-label="Primary">`, `<header>` per route. No `<img>` without `alt`. No console errors on any of the 14 loads.

### 1.2 Deep pass — every tab panel, and every overlay

| Surface (reachable state) | Light | Dark |
|---|---|---|
| `/schedule` → Queue | — | **0** |
| `/schedule` → **Calendar** | **`color-contrast` · serious · 2 nodes** | **`color-contrast` · serious · 3 nodes** |
| `/schedule` → Publications | — | **0** |
| `/insights` → Performance | — | **0** |
| `/insights` → Learning | — | **0** |
| `/insights` → AI Usage & Cost | — | **0** |
| `/settings` → Connected Accounts | — | **0** |
| `/settings` → AI Provider | — | **0** |
| `/settings` → Content Pillars | — | **0** |
| `/settings` → Brand Profile | — | **0** |
| Quick Capture dialog | — | **0** |
| Settings → Connect (X) dialog | — | **0** |
| Agent → Technical Diagnostics sheet | — | **0** |

**Total: 0 violations on all seven destinations at first paint, in both themes. One violation, on one reachable sub-view (`/schedule` → Calendar), in both themes.**

### 1.3 The one violation, exactly

Rule `color-contrast`, impact **serious**.

* **Light:** 2 nodes, measured ratio **1.87:1** (foreground `#bdbdbd` on `#ffffff`, 12px, weight 400).
* **Dark:** 3 nodes, measured ratio **2.21:1** (foreground `#4e4e4e` on `#141414`, 12px, weight 400).
* Node target: `.opacity-40.bg-background.min-h-[90px]:nth-child(2) > .mb-1.text-muted-foreground.text-xs` (0-indexed children 1 and 2 = the leading/trailing out-of-month day cells).

**Cause — `client/src/pages/calendar.tsx:283-287`:**
```tsx
className={`min-h-[90px] rounded-md p-1.5 border transition-colors ${
  isCurrentMonth ? "bg-card" : "bg-background opacity-40"   // line 284
} ${isToday ? "border-primary/40" : "border-transparent"}`}
…
<div className={`text-xs mb-1 ${isToday ? "text-primary font-semibold" : "text-muted-foreground"}`}>
  {format(day, "d")}
```
`opacity-40` on the **wrapper** multiplies the already-muted `text-muted-foreground` day numeral by 0.4, collapsing it to ~1.9:1 (light) / ~2.2:1 (dark). The violation count differs by theme because the month grid's leading/trailing cell count differs between the two rendered runs.

**Concrete fix:** stop dimming the whole cell. Either (a) remove `opacity-40` and de-emphasise out-of-month days with a surface change only (`bg-background border-transparent` vs `bg-card`), keeping the numeral at full-opacity `text-muted-foreground` (which clears AA); or (b) keep a dimmed container but exempt the numeral — set the day number to a contrast-verified token and dim only the event chips. Add a regression assertion: run axe on `?tab=calendar` (the existing `e2e/accessibility.e2e.spec.ts` only covers first paint, which is why this shipped).

---

## 2. Accessibility findings axe does not report (manual probes)

### 2.1 Dialog focus is **not** restored to the invoking control — **HIGH**
Verified timeline after `Escape` (600 ms sample): focus goes `INPUT → BODY`. It never returns to the trigger.

| Overlay | Opened by | Trapped? | Focus restored to trigger? |
|---|---|---|---|
| Quick Capture dialog | plain `<Button onClick>` (`quick-capture.tsx`) | yes | **no → `<body>`** |
| Settings → Connect dialog | plain `<Button onClick>` (`settings.tsx:287`) | yes | **no → `<body>`** |
| Settings → Brand prompt preview | plain `<Button onClick>` (`settings.tsx:633`) | yes | **no → `<body>`** |
| Agent → Technical Diagnostics | `<SheetTrigger asChild>` (`agent.tsx:457`) | yes | **yes → `button-open-diagnostics`** |

The pattern is exact: focus is restored for the sheet, which uses a Radix `Trigger`, and lost for the three dialogs, which are controlled by state and have **no** `DialogTrigger`, so Radix's `triggerRef` is null and its default `onCloseAutoFocus` restores nothing.

This contradicts the stated contract ("Modals trap focus and restore it to the trigger", `docs/contentforge-design-direction.md` §5.5) and is a real keyboard-user defect: dismissing a dialog drops focus at the top of the document.

**Concrete fix:** wrap each invoker in `<DialogTrigger asChild>` (the FAB, the Connect button, the Preview button), **or** pass `onCloseAutoFocus={(e) => { e.preventDefault(); invokerRef.current?.focus(); }}` on the `DialogContent`. Add an e2e that asserts `document.activeElement` equals the invoker's test id after Escape.

### 2.2 Form fields whose label is not associated (accessible name missing) — **HIGH** (axe-invisible)
On **Settings → Brand Profile** every input/textarea is named only by an unassociated sibling `<label>` and its placeholder:

* `getByRole('textbox', { name: 'Brand Voice' })` → **0 matches**. `el.labels.length` → **0** for all 10 controls; `aria-label` → `null`; `id` → `''` → a `<label for>` cannot resolve. Same for `Writing Style Notes`, `Target Audience`, `Content Goals`, `Niche / Expertise`, and the five `Pillar N` inputs.
* **Settings → Connect dialog**: `input-connect-username`, `input-connect-token` — same shape, `labels.length = 0`.

Source: `settings.tsx:565,575,585,595,605,614` render `<label className="…">…</label>` with no `htmlFor`, and the controls carry no `id`. By contrast, `create-studio.tsx` does it correctly (`<label htmlFor="input-concept">` + `<Textarea id="input-concept">`).

**Concrete fix:** give each control an `id` and add `htmlFor` to its label (or use `React.useId()`), exactly as `create-studio.tsx` already does. Then re-run axe — it will still not flag it, so also add a `getByRole('textbox', { name })` assertion.

### 2.3 `aria-modal` absent on dialogs — **LOW/MEDIUM**
Both `DialogContent` elements carry `role="dialog"`, `aria-labelledby`, `aria-describedby`, `tabindex="-1"` — but **no `aria-modal`**. Radix compensates by setting `aria-hidden="true"` on the background siblings while the dialog is open (15 elements observed `aria-hidden`, 0 `inert`, no `aria-modal`), and the focus trap holds. Practical impact is mitigated but not zero: some screen readers will not announce modality. Radix's `DialogContent` normally sets `aria-modal`; the absence here is worth confirming against the pinned `@radix-ui/react-dialog` version. Fix: ensure the modal content advertises `aria-modal="true"` (or set `inert` on the background instead of relying on `aria-hidden` alone).

### 2.4 Everything else checked and clean
* **Landmarks:** exactly one `<main>#main-content` per route; the shell nav is `<nav aria-label="Primary">`; skip link `Skip to main content` is first in tab order.
* **Heading outline:** no skipped levels anywhere. `/today` h1→h2×4; `/create` h1→h2→h3; `/sources` h1→h2→h3; `/agent` h1→h2; `/schedule` h1→h2; `/settings` h1→h2×5. (Penalty: `/insights` renders **only** the h1 — its Performance/AI-Usage panels expose no section headings, so heading navigation finds one node.)
* **Tab semantics:** every `role="tab"` `aria-controls` resolves to a real element **before activation, too** (`radix-…-content-…` → `getElementById` non-null), and each panel is visible after its trigger is clicked. `/schedule`, `/insights`, `/settings`. No dangling references.
* **Keyboard reachability:** tab order on `/today` is skip-link → brand → 7 nav items → Sign out → sidebar toggle → theme toggle → `Create content` → `Create something`. Primary actions are reachable in the first ~13 stops, in DOM order, with no trap.
* **Visible focus:** focused controls compute a real ring — `box-shadow: … rgb(36,116,245) 0px 0px …` and `outline: solid 2px` on buttons/links. One soft spot: the skip link (`App.tsx:226-231`) relies on the UA outline (`auto 1px`) rather than the product ring; it clears contrast but is inconsistent with everything else.
* **Icon accessible names:** 0 `button-name` / `link-name` violations. `ChannelIcon` emits `role="img"` + `aria-label` unless `decorative` (`channel-icon.tsx`); icon-only shell buttons carry `aria-label` (`Sign out`, `Quick capture`, `Open technical diagnostics`).
* **Reflow:** no horizontal document overflow at 320 px on any of the seven routes (`scrollWidth == clientWidth`, verified in dark), nor at 2× CSS zoom on a 1440 viewport.

---

## 3. Responsive

**Viewports:** 1440×900, 1280×800, 1024×768, 820×1180, 768×1024, 430×932, 390×844. **Metric:** `documentElement.scrollWidth − clientWidth`; `offenders` = elements whose right edge exceeds the viewport (these may legitimately live inside an `overflow-x:auto` strip).

| Route | 1440 | 1280 | 1024 | 820 | 768 | 430 | 390 |
|---|---|---|---|---|---|---|---|
| `/today` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/create` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/sources` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/agent` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/schedule` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/insights` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/settings` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**There is no document-level horizontal overflow at any of the 49 route×viewport combinations.** Off-viewport elements only appear inside deliberate scroll strips:

| Route / viewport | off-viewport elements | inside | reachable? |
|---|---|---|---|
| `/create` 1280→390 | 4 → 37 (grows as width shrinks) | mode bar `overflow-x-auto no-scrollbar` (`create.tsx`) | **scroll only — no scrollbar, no fade, no arrow** |
| `/settings` 768 / 430 / 390 | 1 / 12 / 12 | tab strip `overflow-x-auto … no-scrollbar` | as above; `Brand Profile` is off-screen at 768 by 27 px |
| `/schedule`, `/insights` | 0 | tab strips scroll but fit | yes |

**Risk (MEDIUM, `/create`; LOW, `/settings`):** at ≤1024 px the trailing modes (Templates, Formatter, Canned Responses, Chat→Post) and at ≤768 px the trailing Settings tabs are off-screen behind an **invisible** horizontal scroll area (`no-scrollbar`). Keyboard users can reach them, but pointer users get no affordance that more controls exist. Fix: an edge fade / chevron affordance, or wrap the strip to two rows at narrow widths.

All three tabbed destinations keep the header's primary action visible at every viewport, and every dialog is `w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto` (`quick-capture` dialog), so overlay actions stay reachable at 390×844.

**Coarse pointer — a precise statement.** The primary sweeps above ran under Playwright's Desktop Chrome profile: **fine pointer, `hover: hover`, no touch** — so hover-only affordances and coarse-pointer ergonomics are not represented by that evidence. However, contrary to "structurally invisible", Playwright **can** emulate a coarse pointer via `hasTouch`/mobile device descriptors: with `hasTouch:true` Chromium reports `(pointer: coarse)` true and `(hover: hover)` false, and the app's `[@media(pointer:coarse)]` rules engage (I measured the shell toggle at 390 px going **28 px (fine) → 44 px (coarse)**). I did **not** run the full 7×7×2 sweep under coarse emulation, and emulation cannot reproduce finger occlusion, real tap accuracy, virtual-keyboard viewport changes, or hybrid touch+mouse devices — so **true coarse-pointer correctness remains unverified**.

---

## 4. UX / UI per destination

Typography is measured, not eyeballed: the rendered font-size vocabulary is **12 / 14 / 16 / 18 px only** on every route, and the **minimum rendered size is 12 px everywhere** (the type floor holds: `index.css:275-278` maps `.text-[10px]`/`.text-[11px]` to `--text-meta`). Weights are 400/500/600, with stray **700** on `/sources` and `/schedule`.

### `/today` — **clean; the honesty model is the product's best surface**
* **Truthful states — PASS (verified).** The empty "You're all caught up" state is unreachable while any attention source has `isError`: that path renders `ErrorState` ("No clean status is being inferred"). A failed schedule leg or activity leg renders its own `ErrorState`; a *partial* failure is disclosed inline ("Some attention sources couldn't be checked — this list may be incomplete"), and a full 50-row failure window is disclosed ("Showing the 50 most recent failures"). Unknown publications are a distinct kind rendered as "needs verification", never as clean. This is the strongest evidence in the app that a failed/unknown read is not dressed as success.
* **Hierarchy (squint):** loudest = `Today` (25.2) > brand (19.6) > the three section h2s (19.2) — a correct, shallow staircase.
* **Primary action obvious — PASS:** header `Create content` (primary) plus the Quick Actions grid.
* **LOW — FAB overlap risk:** the 48 px Quick-Capture FAB is `fixed bottom-right` and page content ends with `pb-6`; on `/today` the Quick Actions grid is the last block and the FAB can sit over the last card at 390 px. Not measured as an overlap here — flagged to verify.
* **LOW:** "Failures" is carried by `text-warning` **and** an `AlertTriangle` glyph **and** the word "Failures" — non-colour signal present (good).

### `/create` — **strongest information architecture; two mechanical gaps**
* **Primary action obvious — PASS, with one caveat.** The primary is `Generate Content` (`size="lg"`, bottom, `create-studio.tsx:674-692`). It is **disabled** when the concept is empty and gives **no inline reason**; the only signal is the empty Topic field. Design direction §5.4 explicitly forbids "a disabled primary action… the only explanation". **MEDIUM** — add a one-line reason ("Add a topic or pick a story to generate") next to the button when disabled.
* **Progressive disclosure — PASS:** Advanced options (model/hook/constraints) collapse behind a labelled toggle; Voice/Template are secondary selects.
* **Hierarchy:** `Create` (25.2) > `Content Setup` (19.6) > chips — clean.
* **MEDIUM — scroll-strip affordance:** the mode bar is `overflow-x-auto no-scrollbar` (`create.tsx`). At 1024/820/768/430/390 the trailing modes are off-screen with **no visible cue** (37 off-viewport elements at 390). Fix: edge fade/chevrons or wrap.
* **LOW — sentence case:** mode names ("Post & Thread", "Canned Responses", "Chat → Post") and buttons ("Create New") are Title Case against the sentence-case rule.
* **LOW — reachable sub-views reintroduce palette literals:** `?mode=images` mounts `imagegen.tsx` (`text-red-400`), `?mode=carousel`/`?mode=chat` mount others. These are reachable from the mode bar, i.e. inside `/create`.

### `/sources` — **competent, but two titles fight and the header action mismatches the job**
* **MEDIUM — visual hierarchy (squint):** the section heading `Discover & Research` renders at **18 px / 700 (score 25.2)**, tying the page `<h1>` `Sources` (18 px / 600). Two equal-weight titles compete on first paint. The type table says *Section = text-base semibold*. Fix: demote to `text-base font-semibold`; the intro heading then reads as subordinate.
* **MEDIUM — primary action mismatch:** the header's only action is `Quick Capture` (`variant="outline"`), while the surface's real job is "start research" (`button-start-research`, inside Discover). The top-right control doesn't name the surface's primary task. Fix: promote "Start research"/"New research" to the header slot, or make Quick Capture secondary chrome.
* **LOW — duplicate view bands:** the "View:" row (Discover/Saved/Research) and the subordinate "More:" row (Ideas/Vault/References/Ingest) present peers as if ranked; the secondary band is a known deferred consolidation.
* **Truthful states — PASS:** `discover-tab.tsx` distinguishes idle, searching, failed (`ErrorState`), and a *degraded* research summary (`badge-degraded-sources`), and re-runs axe-clean.
* **LOW:** no `role="tab"` on the view switchers (they are `<button>`s) — fine, but it means this surface has no tab semantics at all, so the `aria-controls` check is not applicable here.

### `/agent` — **truthful status model; information is removed, not disclosed, below `lg`**
* **LOW — copy:** "Ready to Orchestrate", "Authorization Required", "Generated Artifacts & Results" are Title Case; "Retry continue" is internal jargon.
* **LOW — disabled reasoning:** `Retry continue` is disabled with no run selected and explains nothing inline.
* **MEDIUM — progressive disclosure inverts at `<lg`:** the desktop sidebar (`aside.hidden lg:flex`, `agent.tsx:901`) holds **Capabilities** and **Run History**. Below `lg` the *Run History* half stays reachable (the `Runs` sheet), but the **Capabilities** list has **no mobile entry point** and the Diagnostics sheet does not include it — so the "what can the agent do / what needs approval" information is *deleted* at narrow widths rather than disclosed. Fix: add Capabilities to the Diagnostics sheet (or a tabbed mobile panel).
* **LOW — pre-filled objective:** the composer seeds a canned demo sentence (`agent.tsx:129`), so `Start run` is enabled before the operator types. It is a real prompt, not a placeholder-as-label, but it lets a run start with no operator intent.
* **Truthful states — PASS:** `deriveRunDisplayStatus` + `StatusBadge` (glyph + word); the approval callout, when hidden, still leaves the `waiting_for_approval` badge and the "nothing was approved" banner; `runsQuery.isError` → `ErrorState` in both the sheet and the sidebar. No run is shown as clean while it is waiting.

### `/schedule` — **the one failing surface (Calendar), otherwise solid**
* **HIGH — colour contrast in the Calendar view (see §1.3).** Both themes. Fix + regression e2e required.
* **Truthful states — PASS.** Queue: `isLoading`→skeletons, `isError`→`ErrorState`, empty→`EmptyState`. Publications: `isUnknown` renders the distinct `unknown` badge ("We couldn't confirm what happened with the platform") and a `Check status` CTA; `failed` renders its error text; a full 30-row window is disclosed ("Older history is not listed here"). The D1 "unknown ≠ clean" rule is visibly honoured.
* **LOW:** three tabs at 390 px scroll with a hidden scrollbar (same affordance issue as `/settings`).
* **LOW:** the Calendar day grid uses `opacity-40` as its *only* out-of-month signal; once contrast is fixed, keep a non-colour cue.

### `/insights` — **clean render, thinnest structure, one latent token defect**
* **MEDIUM — heading navigation:** the default Performance view exposes **only the page `<h1>`**; there are no section headings to move between (measured outline for `/insights` is `["H1:Insights"]`). Fix: give the analytics panels real `<h2>`s.
* **MEDIUM (latent, source-verified, not reproduced at runtime) —** `client/src/pages/analytics.tsx:101`: `{trend && <p className="text-[10px] text-green-500 mt-1">{trend}</p>}`. This is a **raw palette literal** (`text-green-500` = 2.28:1 on light per the design direction §4.1) **and** a sub-floor class. It renders only when a `trend` string exists, and the empty DB produced none — so **axe did not see it**. It is the exact class of defect the direction names. Fix: `text-success` + `text-xs`.
* **LOW — AI Usage tab:** stat icons use `text-purple-500` / `text-green-500` / `text-blue-500` / `text-amber-500` (`ai-usage.tsx:167,190,211,217,224,231`) instead of semantic tokens; icon colour that encodes magnitude/status is not contrast-guaranteed for non-text UI.
* **Truthful states — PASS:** `analytics.tsx` handles `isLoading` / `isError` / `EmptyState("No performance data yet")`; `ai-usage.tsx` handles `isError || !data` with an error path, not a clean one.
* **LOW:** tab label "AI Usage & Cost" is Title Case and uses "&".

### `/settings` — **accurate account model; the a11y gap is here**
* **HIGH — unassociated labels (see §2.2).** Brand Profile (10 controls) and the Connect dialog (2 controls).
* **GOOD — account/channel truthfulness:** each platform card renders a `Connected` badge as **`CheckCircle2` + the word "Connected"** (not colour alone); the stored token is shown **masked** via `maskSecret`; YouTube exposes explicit `OAuth client: Configured/Missing`, `Refresh credential: Present/Absent`, `Channel: …/Not discovered`, `Publishing ready: Ready/Not ready` — a truthful capability matrix, and the AI Provider badge vocabulary ("Checking… / Configured / Not connected / Unable to verify / Configuration required") is word-carried.
* **LOW — sentence case:** tab labels ("Connected Accounts", "AI Provider", "Content Pillars", "Brand Profile") and buttons ("AI Learn from My Content", "Preview Brand Prompt", "Save Brand Profile", "Test Connection", "Update Token", "Connect Account").
* **LOW — hidden-scrollbar tab strip** at ≤768 (Brand Profile off-screen).
* **GOOD:** dialogs use `max-h` + `overflow-auto` (`settings.tsx:660`) as §5.5 requires.

---

## 5. Brand-defining claims

| Claim | Verdict | Evidence |
|---|---|---|
| **No exclamation-point copy** | **PASS (reachable)** | A full `[A-Za-z0-9]!` sweep of `client/src` finds exactly one user-facing `!`: `discover.tsx:217` `"Posted to X!"` — and `/discover` is a `LegacyRouteRedirect` with no live mount (`App.tsx:166`). Every reachable toast/label is `!`-free (create "Generated successfully", "Capture failed", "Brand profile saved", …). |
| **Sentence case** | **PARTIAL / FAIL** | Page titles and body copy are sentence case, but many component labels are Title Case: "Quick Capture", "Create New", "Content Setup", "Authorization Required", "Ready to Orchestrate", "Generated Artifacts & Results", "AI Learn from My Content", "Preview Brand Prompt", "Save Brand Profile", "Connected Accounts", "AI Provider", "Content Pillars", "Brand Profile", "Post & Thread", "Canned Responses", "AI Usage & Cost". Systemic, not isolated. |
| **No placeholder-as-label** | **PASS visually / FAIL for AT** | Every field has a *visible* label (nothing relies on a placeholder as its only visible name). But on Settings → Brand Profile and the Connect dialog the label is unassociated, so the **accessible name collapses to the placeholder** (§2.2). |
| **No status by colour alone** | **PASS (with one latent exception)** | `StatusBadge` maps every status to a distinct glyph **and** word, and the spinner glyphs collapse to a stable arc under `prefers-reduced-motion` (`status-badge.tsx`); `ActorBadge` pairs icon+word ("Activated by You" / "Activated Automatically"); agent capability states carry the words "available / unavailable / approval req."; Calendar "today" uses `font-semibold` + colour. **Exception:** the latent analytics trend (`analytics.tsx:101`) is colour-only text. |

---

## 6. Account/channel identity and human-vs-automatic signalling

* **Which account/channel an action targets — PASS.** `/create` names it twice: a `Target Channel` select (`#select-channel`) and a Generation Summary "Target: **x** · Post" row (`create-studio.tsx:436,642`); channel is carried by `ChannelIcon` (labelled, non-decorative where it stands alone). `/settings` shows a per-platform card with `@username` + masked token. `/today` schedule rows and `/schedule` Queue/Publications rows each render the channel word + icon.
* **Whether the system or a human acted — PASS on the surfaces that claim it, PARTIAL elsewhere.** `ActorBadge` (glyph **and** word, greyscale-safe) appears in artifact review (`artifact-review.tsx:230`) and Insights → Learning (`learning-view.tsx:1827`). The Agent workspace makes autonomy explicit: an `Authorization Required` callout with `Approve & continue`, and when the callout is hidden the run still reads `Waiting for approval` plus "nothing was approved". `/today` distinguishes "Agent run waiting for approval" from "Publication failed" with words.
* **Gaps (LOW):** the Agent **run card does not show who started the run** (no actor badge on the run header), and `/today` / `/schedule` / `/sources` rows carry no actor signal — so "did I do this, or did the system?" requires reading the surrounding copy rather than a badge. Given `ActorBadge` exists and is e2e-pinned, extending it to the run header is cheap.

---

## 7. Explicitly NOT verified

* **Real devices / real browsers.** No iOS Safari, no Android Chrome, no Firefox, no Windows. `100dvh`, `env(safe-area-inset-*)`, momentum scrolling, virtual-keyboard viewport shrink and real touch ergonomics are unverified.
* **Coarse pointer.** Primary sweeps are fine-pointer (`hover: hover`). `hasTouch` emulation does engage `(pointer: coarse)` and the 44 px rules (measured 28→44 px), but I did not run the full matrix under it, and emulation cannot model finger occlusion, tap accuracy, or touch+mouse hybrids.
* **Screen readers.** No VoiceOver/NVDA/TalkBack run. Findings are axe + DOM/ARIA inspection; real announcement order and verbosity are unverified.
* **Data-dependent states.** The DB is empty, so populated queues, publications (including `failed` and `unknown`), attention lists, truncation banners, and non-empty analytics trends were **not rendered**. Findings that depend on them (e.g. the `analytics.tsx:101` trend literal, the 50-row failure disclosure) are **source-verified, not runtime-reproduced**.
* **Zoom.** Reflow verified at 320 px and via CSS `zoom: 2` at 1440 px; true browser zoom (which changes the CSS viewport and can trigger different breakpoints) is approximated by the 320/768 rows, not tested directly.
* **Motion.** I did not independently re-verify `prefers-reduced-motion` suppression (the existing `e2e/accessibility.e2e.spec.ts` covers it); the design-system claim about spinner→arc survival is taken from source, not re-measured here.
* **Non-text contrast** beyond what axe checks (focus rings against every surface, borders, chart series, icon fills) — axe's non-text coverage is partial; only the ring-vs-background ≥3:1 case is asserted by an existing unit-style e2e.
* **Latency/performance**, browser back/forward focus behaviour, and print styles: out of scope.
* **Rooms I did not open:** `/insights` nested dialogs, queue/calendar per-row menus, the settings YouTube connect flow end-to-end, and the `/create` sub-modes' own dialogs were not individually axe'd.

---

## 8. Verdict

* **axe, full rule set, both themes, seven destinations at first paint: clean (0 violations).**
* **One route is not clean in one of its reachable views:** `/schedule` → **Calendar**, `color-contrast`, serious, **1.87:1 light / 2.21:1 dark** (out-of-month cells, `calendar.tsx:284`).
* **Two axe-invisible HIGH defects:** dialog focus is not restored to the invoker (3 dialogs), and 12 form controls on `/settings` have no programmatically associated label.
* **Responsive:** no horizontal overflow at any of 49 route×viewport combinations. The remaining usability risk is invisible-scrollbar strips (`/create` mode bar, `/settings` tabs) at ≤1024 px.
* **Brand:** no exclamation copy (one residual in an unreachable legacy page); status is never colour-only on reachable surfaces (one latent exception); sentence case is violated by a long list of component labels.

### Raw evidence (not committed)
`scratchpad/audit-out/`: `a11y.json`, `responsive.json`, `checks.json`, `deep.json`, `probe.json`, `probe2.json`, `storage.json`, and `shot-<route>-<viewport>.png` / `shot-schedule-calendar-{light,dark}.png`.
