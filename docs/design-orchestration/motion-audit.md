# ContentForge — Motion / Interaction Audit (Worktree 7)

**Mode:** `/design motion` + `/design interaction` (audit against the existing, already-designed motion system)
**Register:** Product — authenticated single-operator tool, `Operate` + `Monitor` (`.commandcode/design/brief.md:11-19`)
**Scope:** loading, transitions, dialogs/drawers/sheets, state changes, tab transitions, success/error feedback, progress, page arrival
**Sources read:** `.commandcode/design/brief.md` (Motion section), `client/src/index.css:236-440`, `.commandcode/design/checkup-report.md` (#2), `.commandcode/design/smell-report.md`, `references/{motion.md,interaction.md,severity.md}`
**Method:** source inspection + a real Tailwind compile of `client/src/index.css` against the project's own content glob (`npx tailwindcss -i client/src/index.css -o <scratchpad>/tw-full.css`) to resolve which motion rule actually wins the cascade. No dev server was started; nothing in this repo was modified. All `file:line` references are relative to this worktree (`/Users/kishore/git/cf-design/wt-07`).

---

## Verdict

**Needs changes.** No `HIGH` is triggered inside the Motion discipline — the one escalation trigger that lived here (motion running regardless of `prefers-reduced-motion`) is genuinely closed: the two-tier block at `index.css:411-439` plus a global `!important` duration collapse covers every animation in the compiled stylesheet, and `e2e/accessibility.e2e.spec.ts:153,175` asserts it. What remains is a **system that is designed well and applied unevenly**: the token layer promises six behaviours, and three of them either never reach their call site (the 175 ms overlay exit), never reach most of their call sites (`.pressable`, reduced-motion-safe pending state), or are bypassed by a hardcoded literal sitting next to them (the Sheet's 300 ms exit).

There is **no decorative motion to remove.** Nothing here is "look at me". Every finding below is about motion that is absent, unreachable, or contradictory.

Counts: **HIGH 0 · MEDIUM 7 · LOW 4.**

---

## The central question: defined but never applied

Usage of every motion utility in the designed system, counted at real call sites rather than at declarations.

| Utility | Declared at | Direct call sites | What that actually reaches |
|---|---|---|---|
| `.pressable` | `client/src/index.css:272-280` | **1** — `client/src/components/ui/button.tsx:9` (cva base) | 270 `<Button>` usages, 0 of the 35 hand-rolled `<button>` elements. `active:scale`/`hover:scale` appear **0** times anywhere else in `client/src` — see finding 5 |
| `.overlay-motion` | `client/src/index.css:296-305` | **19** valid class strings across 12 primitives (+1 broken by a typo) | Only **4** are in primitives that both render and get the designed 175 ms exit (`dialog.tsx:24`, `dialog.tsx:41`, `popover.tsx:20`, `tooltip.tsx:22`). 15 scope the class to `data-[state=…]` and can never match the exit rule. 8 of the 19 sit in primitives with **0 call sites** (`menubar.tsx:97,120`, `navigation-menu.tsx:72,89,107`, `hover-card.tsx:21`, `context-menu.tsx:47,63`); `drawer.tsx` (vaul) has none at all — see findings 1, 2 |
| `.rise-in` | `client/src/index.css:319-321` | **1** — `client/src/pages/today.tsx:180` (+ inline `animationDelay` at `:181`) | The Today attention list only. This is the designed site; working as documented |
| `.pulse-live` | `client/src/index.css:329-331` | **3** — `status-badge.tsx:66,67,68` | 7 files render `StatusBadge`. Reach is fine; the *meaning* problem is owned by the Color finding and is not re-reported here |
| `.pulse-skeleton` | `client/src/index.css:342-344` | **1** — `client/src/components/ui/skeleton.tsx:9` | 40 `<Skeleton>` usages — the repoint worked |
| `.animate-spin.animate-spin` | `client/src/index.css:358-360` | **0** (it is a normalizer; call sites write bare `animate-spin`) | 82 `animate-spin` occurrences in `client/src`, all normalised to 800 ms linear. Verified in the compiled sheet (`.animate-spin` sets 1 s at `tw-full.css:2444`; the 0,2,0 override wins at `:4313`) — works |
| `.motion-safe-pulse` | **nowhere** | **0** | Referenced only by the reduced-motion kill list at `index.css:425`. A dead selector inside the block that has to be trustworthy |
| Token layer `--duration-*` / `--ease-*` | `client/src/index.css:254-265` | **0 in markup** (`var(--duration` and `var(--ease` = 0 matches in `*.tsx`) | Consumed only by `index.css` itself. Every other motion call site writes a literal instead: `tabs.tsx:30` (150), `sidebar.tsx:221,232,295,409` (150/200/300 + `ease-linear`), `sheet.tsx:34` (300/500), `alert-dialog.tsx:37` (200), `tailwind.config.ts:101-102` (0.2s) |
| Raw `animate-pulse` (Tailwind 2 s) | Tailwind default | **4** still present | `imagegen.tsx:217`, `vault.tsx:174`, `carousel.tsx:125` (skeletons), `artifact-review-view.tsx:271` (loading glyph) — the Phase 33.2 repoint was incomplete; see finding 8 |
| Raw `animate-in` / `animate-out` with no `overlay-motion` | — | **1** | `context-menu.tsx:63` — `shadow-mdoverlay-motion` (missing space). The class is emitted **0** times in the compiled CSS: neither the shadow nor the motion token applies |
| Raw `transition-all` | — | **11** | `progress.tsx:21`, `input-otp.tsx:42`, `accordion.tsx:29,47`, `toast.tsx:26`, `create-studio.tsx:257`, `formatter.tsx:98`, `imagegen.tsx:146`, `vault.tsx:236`, `carousel.tsx:30,251` — see finding 10 |

---

## Where state change happens with no feedback

| Flow | Location | Today | Verdict |
|---|---|---|---|
| **Approval** | `artifact-review-view.tsx:543-551` | Button disables (`disabled:opacity-50`). No spinner, no label change | No in-flight feedback (finding 3) |
| **Publish** (Review + dialog) | `artifact-review-view.tsx:599-607`, `:675-681` | Same — disable only | No in-flight feedback (finding 3) |
| **Confirm Schedule** | `artifact-review-view.tsx:653-659` | Same | No in-flight feedback (finding 3) |
| **Publish / schedule / delete** | `queue.tsx:435-440`, `:613-616`, `:624-627` | Spinner inside the button | Correct model — the exception is Review, the product's terminal `Decide` surface |
| **Retry** | `error-state.tsx:32-35` | `RotateCw` spins, label stays "Try again" | Spin is the only state carrier (finding 4) |
| **Async completion** | `announcer.tsx:54` (live region) | Mounted in `App.tsx:178`; called from **one** component (`quick-capture.tsx:37,42`) out of 199 `toast(...)` call sites | Publication results, agent runs and generation keep completing silently for a non-visual user (finding 6) |

Motion-as-sole-carrier-of-state (what dies under `prefers-reduced-motion: reduce`):

- **9 sites** carry "this is in flight" only by rotating the *same* glyph, with no label change — `learning-view.tsx:664,775,881,980,1638`, `artifact-review-view.tsx:535,589`, `queue.tsx:503`, `error-state.tsx:34`. `index.css:421-423` deliberately stops the spinner, so under reduce the pending and idle states render identically (finding 4).
- The status-badge pulse is also motion-only, but the underlying rule is *meaning carried by hue* and is owned by the Color finding (`checkup-report.md` #4, `smell-report.md` #4). Not re-reported.
- `.rise-in` (`today.tsx:180`) is *not* a sole carrier: severity order is legible from the list itself once rows exist. It is correctly removed under reduce.

---

## Is any exit duration longer than its entrance?

Yes — one, the Sheet, and it is a cascade conflict rather than a choice.

| Overlay | Entrance | Exit | Rule holds? |
|---|---|---|---|
| Dialog (`dialog.tsx:24,41`) | 250 ms (`--duration-overlay`) | 175 ms | yes |
| Popover / Tooltip | 250 ms | 175 ms | yes |
| Toast (`toast.tsx:26`) | 250 ms | 150 ms (plugin default — token never applies) | yes, by accident |
| AlertDialog (`alert-dialog.tsx:37`, and all 18 `ConfirmDialog` sites) | 250 ms | 200 ms (`duration-200` beats the token) | yes, by accident |
| Select (`select.tsx:78`, 32 call sites) | 250 ms | 150 ms (plugin default) | yes, by accident |
| **Sheet** (`sheet.tsx:34`, Agent diagnostics + mobile history) | **250 ms** | **300 ms** (`data-[state=closed]:duration-300`) | **No — exit is 20 % longer than entrance** (finding 2) |

The `index.css:245-246` comment states the rule ("Exits run shorter than entrances because the user already understands the object by the time it leaves") and `motion.md` states it too ("Leaving is faster than arriving"). The Sheet contradicts both, and its `data-[state=open]:duration-500` never runs at all — `data-[state=open]:overlay-motion` has higher specificity (0,3,0 vs 0,2,0), so the 500 ms literal the author wrote is dead on arrival.

---

## Findings

| # | Severity | Discipline | Location (file:line) | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | MEDIUM | Motion | `client/src/components/ui/select.tsx:78`, `sheet.tsx:24`, `sheet.tsx:34`, `alert-dialog.tsx:19`, `alert-dialog.tsx:37`, `toast.tsx:26`, `dropdown-menu.tsx:48,66` (15 sites) | `data-[state=open]:overlay-motion animate-in … data-[state=closed]:animate-out` — the token's exit branch is scoped to the open state it no longer has at close | Drop the `data-[state=open]:` prefix and put plain `overlay-motion` on the element, as `dialog.tsx:24,41`, `popover.tsx:20` and `tooltip.tsx:22` already do | Compiled proof: `.overlay-motion[data-state="closed"].animate-out{175ms}` (`tw-full.css:4253`) can only match when the element still carries `overlay-motion` while closed. For the prefixed form Tailwind emits `.data-[state=open]:overlay-motion[data-state="open"][data-state="closed"].animate-out` (`tw-full.css:5847`) — **an unsatisfiable selector**, so the designed 175 ms exit is unreachable at 15 of 19 call sites and those overlays dismiss at 150–300 ms instead. It is also the root of finding 2 |
| 2 | MEDIUM | Motion | `client/src/components/ui/sheet.tsx:34` | `transition ease-in-out data-[state=open]:overlay-motion … data-[state=closed]:duration-300 data-[state=open]:duration-500` | Use the shared tokens: exit `175ms` / `var(--duration-overlay)`, entrance `var(--duration-overlay)`; delete both literals | Exit (300 ms, from `data-[state=closed]:duration-300`, specificity 0,2,0) is **longer than** entrance (250 ms) — the opposite of the system's stated rule (`index.css:245-246`, `brief.md` Motion). `duration-500` never applies (0,2,0 loses to the overlay-motion variant at 0,3,0), so the literal is dead and the behaviour is the one nobody chose. The Agent diagnostics sheet is the app's largest spatial movement; it dismisses slower than it appears |
| 3 | MEDIUM | Interaction | `client/src/components/create/artifact-review-view.tsx:543-551` (Approve), `:599-607` (Publish Now), `:653-659` (Confirm Schedule), `:675-681` (dialog Publish Now) | `disabled={approveMutation.isPending}` with `CheckCircle2` / `Send` / `Calendar` unchanged | Swap the leading glyph for `Loader2 animate-spin` while pending (as `queue.tsx:613-616` and `confirm-dialog.tsx:57` already do), keeping the label | The product's terminal verbs (approve → publish) round-trip to real social accounts. During the wait the only signal is `disabled:opacity-50`; the sibling Regenerate button in the same card (`:535`) spins, and so do the 18 `ConfirmDialog` sites. On Review — the `Decide` surface — the operator cannot tell a slow publish from a click that never registered |
| 4 | MEDIUM | Motion | `learning-view.tsx:664,775,881,980,1638`; `artifact-review-view.tsx:535,589`; `queue.tsx:503`; `error-state.tsx:34` | ``<RefreshCw className={`… ${mutation.isPending ? "animate-spin" : ""}`} />`` — same glyph, rotation is the only difference | Keep the spin **and** make the state static-legible: change the label while pending ("Regenerating…", "Retrying…") or swap to a distinct glyph | `index.css:411-439` is designed to stop spinners under reduce — that is correct per `brief.md`, but it only works if a static icon still says "in progress". Here the static icon is byte-identical to the idle one, so under `prefers-reduced-motion: reduce` the pending state becomes invisible; only `disabled:opacity-50` is left. This is the one place "motion is the only carrier of state" actually bites. `motion.md`: "Nothing is communicated by movement alone" |
| 5 | MEDIUM | Motion | 35 sites; densest `client/src/pages/sources.tsx:113,128,146,164,182,200,218` (Sources view switcher), `client/src/pages/calendar.tsx:187,194,221,280` (day cells), `client/src/pages/imagegen.tsx:143,172,240,255,261`, `client/src/pages/vault.tsx:200,203,233`, `client/src/pages/discover.tsx:661,725,736,771`, `components/sources/source-card.tsx:74`, `components/create/create-studio.tsx:436,462` | Hand-rolled `<button … transition-colors>` — hover colour only | Add `pressable` to the shared class list at each site (or route them through `Button variant="ghost"`) | `.pressable` is defined (`index.css:272-280`) and wired into exactly one place (`button.tsx:9`), so press feedback exists on `Button` and on nothing else: `active:scale` appears **0** times in `client/src`. The Sources view switcher and Calendar day cells are the primary pointer targets on the `Explore` and `Operate` surfaces and are the two densest clusters |
| 6 | MEDIUM | Interaction | `client/src/components/ui-shared/announcer.tsx:54` (channel), wired at `client/src/components/quick-capture.tsx:37,42` | Live region mounted app-wide (`App.tsx:178`); 1 component of 199 `toast(...)` call sites announces; publish, approval, generation and agent-run completion never do | Call `announce(...)` from the completion handlers that matter: `artifact-review-view.tsx:257-265` (publish outcome), `:178-182` (approve), `agent.tsx` run terminal state | The primitive's own doc comment states the contract — "Every async surface in this product resolves silently … This is the only channel that says 'that finished'". It is now built and almost entirely unused, so the brief's open work item 3 is only half closed: the channel exists, the call sites don't |
| 7 | LOW | Motion | `client/src/components/ui/toast.tsx:26` | `data-[state=open]:slide-in-from-top-full … data-[state=closed]:slide-out-to-right-full` | Enter/exit with a small fixed offset plus opacity (≈12–16 px), keeping the corner origin | The app's primary completion signal arrives and leaves by travelling the full height/width of the toast, at 199 call sites. `motion.md` is explicit: "A small fixed translateY (about -12px) indicates direction without drama; the full container height is theatre", and routine high-frequency feedback should not repeat attention cost on every trigger. One shared component, so one fix covers the whole app |
| 8 | LOW | Motion | `imagegen.tsx:217`, `vault.tsx:174`, `carousel.tsx:125` (skeletons), `artifact-review-view.tsx:271` (loading glyph) | `bg-muted animate-pulse` / `Sparkles animate-pulse` | `Skeleton` (`.pulse-skeleton`) for the loading regions; `.pulse-live` for the glyph only if it is a live signal | The Phase 33.2 repoint is incomplete: 4 raw `animate-pulse` remain on Tailwind's 2 s cycle while every skeleton beside them pulses at 1.6 s, so the tempo disagrees across cold loads of the same app (`index.css:333-344` exists precisely to make waiting read as one state). Reduced motion is still honoured — the global `!important` collapse at `index.css:415-418` catches these |
| 9 | LOW | Motion | `client/src/index.css:425` (`motion-safe-pulse`), `tabs.tsx:30`, `client/src/components/ui/sidebar.tsx:221,232,295,409`, `tailwind.config.ts:101-102` | Call sites hardcode timings (`duration-150`, `duration-200`, `duration-300`, `ease-linear`, `0.2s ease-out`) while `--duration-*`/`--ease-*` exist and are referenced 0 times outside `index.css`; `.motion-safe-pulse` is listed in the reduced-motion kill switch but defined nowhere | Either route these through the tokens (`transition-duration: var(--duration-fast)`) or delete the unused literals; remove `motion-safe-pulse` from `index.css:425` | A token layer that nothing outside its own file can consume will drift — it already has: the designed 250 ms overlay is 300 ms on the Sheet, and the shell animates `width`/`left`/`right` on a `linear` curve while every other surface decelerates hard. The dead selector is a small thing, but it sits in the one block that must be verifiable line by line |
| 10 | LOW | Motion | 11 sites: `toast.tsx:26`, `progress.tsx:21`, `accordion.tsx:29,47`, `input-otp.tsx:42`, `create-studio.tsx:257`, `imagegen.tsx:146`, `vault.tsx:236`, `carousel.tsx:30,251`, `formatter.tsx:98` | `transition-all` | Name the properties: `transition-[color,background-color]`, `transition-transform`, `transition-opacity` — `motion.md`: "I transition exact properties, never all" | `transition-all` on the toast re-animates every property of a swipe-dragged surface (hence the `data-[swipe=move]:transition-none` patch on the same line); on the progress indicator it drags `width`-adjacent changes into the transition. No browser evidence of jank was gathered (**verification gap**), so this is graded LOW — but it is the one class that makes every other timing guarantee unpredictable |

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `client/src/pages/today.tsx:177-183` | `.rise-in` stagger on a page opened many times a day; `motion.md` says not to stagger high-frequency interactions | The brief designs this deliberately (`.rise-in`, index.css:307-318: 6 px offset, total stagger clamped at 200 ms) and the reason is real — the attention list lands in severity order. It is removed cleanly under reduce. Documented intent beats the general rule here |
| `client/src/components/ui/tabs.tsx:36-44` (`TabsContent`) | Tab panels swap with no transition (7 `Tabs` sites incl. Schedule, Insights, Settings) | Tabs are a high-frequency, same-location swap; the trigger's own active state (`tabs.tsx:30`) already shows what changed. `motion.md`: when the interaction repeats often, replacing the element immediately is the correct "exit". Adding motion here would be decoration |
| `client/src/components/ui/drawer.tsx:29-49` (vaul) | No `overlay-motion`; vaul's own ~500 ms transform + `shouldScaleBackground` page scale | `Drawer` has **0 call sites** — nothing renders it. A finding with no reach is an observation |
| `client/src/components/ui/sidebar.tsx:221,232` | `transition-[width] duration-300 ease-linear` animates layout properties in the shell | The refusal ("width/height/margin animation") requires it to *visibly jank*; I could not run a browser, so it stays as evidence in finding 9 rather than a standalone finding |
| `client/src/pages/formatter.tsx:98` | `transition-all` animating `width` on a meter | `/formatter` is a legacy redirect (`App.tsx:112`) — unreachable. Listed in finding 10 only for completeness |
| `client/src/components/ui/progress.tsx:21` | Indicator animates `transform: translateX` with no duration token | Transform is the correct material; the missing token is already covered by finding 10 |

---

## Verification

**Ran in this pass**

| Check | Command | Observed |
|---|---|---|
| Utility reach | `grep -rn "pressable\|overlay-motion\|rise-in\|pulse-live\|pulse-skeleton\|motion-safe-pulse" client/src --include=*.tsx` | 1 / 20 / 1 / 3 / 1 / 0 call sites (see usage table) |
| Raw-fallback residue | `grep -rn "animate-pulse\|animate-in\|animate-out\|transition-all" client/src --include=*.tsx` | 4 raw `animate-pulse`, 11 `transition-all`, 1 `animate-in` without `overlay-motion` (`context-menu.tsx:63`) |
| Colour press feedback | `grep -rn "active:scale\|hover:scale\|hover:-translate" client/src --include=*.tsx` | **0 matches** — press scale exists only through `.pressable` |
| Token consumption | `grep -rn "var(--duration\|var(--ease" client/src --include=*.tsx` | **0 matches** — tokens are consumed only inside `index.css` |
| Primitive reach | `grep -rnE "<(Select\|Dialog\|Tooltip\|Sheet\|AlertDialog\|Tabs\|Popover\|Menubar\|NavigationMenu\|HoverCard\|ContextMenu\|Drawer\|Accordion\|Collapsible)([ >]\|$)"` | Select 32, Dialog 20, Tooltip 8, Tabs 7, Sheet 2, AlertDialog 1+18 ConfirmDialog, Popover 1, Menubar 0, NavigationMenu 0, HoverCard 0, ContextMenu 0, Drawer 0, Accordion 0, Collapsible 1 |
| Pending-state carriers | `grep -rn '? "animate-spin" : ""'` | 9 sites; `grep -rn "isPending ? <\|isLoading ? <…"` → 40 icon-**swap** sites (those stay legible statically, so they are not reported) |
| Completion channel | `grep -rn "announce\|Announcer" client/src` | Provider at `App.tsx:178`; `useAnnouncer` imported by 1 component; 199 `toast({` call sites |
| **Cascade resolution** | `npx tailwindcss -i client/src/index.css -o <scratchpad>/tw-full.css` (project's own `content` glob) | `.overlay-motion[data-state="closed"].animate-out` = 175 ms at rule 4253; the prefixed variants emit **`[data-state="open"][data-state="closed"]`** at 5847 (unsatisfiable); `data-[state=closed]:duration-300` emits `animation-duration: 300 ms` at 5775; `data-[state=open]:duration-500` (5779) is beaten by the 0,3,0 overlay-motion variant (5808); `shadow-mdoverlay-motion` emits **0** rules; `.animate-spin.animate-spin` (0,2,0) overrides `.animate-spin`'s 1 s default |
| Reduced-motion coverage | Compiled `@media (prefers-reduced-motion: reduce)` block, `tw-full.css:4722-4752` | `animation-duration`/`transition-duration: 0.01ms !important`, `animation-iteration-count: 1 !important` on `*`; `.animate-spin.animate-spin{animation:none}`; `.pulse-live`/`.pulse-skeleton`/`.rise-in` removed. Every animation present in the compiled sheet is covered — **no escalation trigger stands** |

`tw-full.css` line references above are to the generated stylesheet from this session's scratchpad (`npx tailwindcss -i client/src/index.css -o <scratchpad>/tw-full.css`, run from the worktree), not to a file in the repo. Re-running that one command reproduces them.

**Not verified (verification gaps, not findings)**

- Rendered behaviour: no dev server, no browser, no `getComputedStyle` sampling. All durations above are resolved from the compiled stylesheet plus selector specificity and source order, not from a running page.
- `e2e/accessibility.e2e.spec.ts:153,175` was not executed. Any change proposed here must keep that suite green (it enumerates up to 400 elements and requires every `animation-duration` and `transition-duration` under 50 ms when reduced motion is requested).
- Frame timing / jank of the sidebar `width` transition and `transition-all` sites — unmeasured, which is why finding 10 and the layout-animation candidate are graded LOW.
- vaul's internal drawer timing was not executed (0 call sites), so the ~500 ms figure is read from the library, not observed.

**Next modes:** `/design motion` scoped to the two token-level defects (findings 1, 2) and the reduced-motion-safe pending state (finding 4), then `/design interaction` for findings 3 and 6. Findings 1 and 2 are one-file changes with the widest reach; findings 5 and 7 are shared-class changes that fix every instance at once.
