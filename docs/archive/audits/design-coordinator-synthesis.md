# ContentForge — Coordinator Synthesis

**Phase:** 2 (Coordinator Synthesis)
**Date:** 2026-09-26
**Inputs:** nine specialist discovery reports from worktrees `wt-01` … `wt-09`, all audited
against baseline snapshot `87a0601`
**Decision authority:** the coordinator. Nothing below was accepted because an agent
recommended it.

---

## 1. Method

Every recommendation from every report was reduced to a **root cause**, not a symptom.
Where two agents reported the same defect differently, they are merged into one decision
row. Where an agent's claim contradicted another's, or contradicted the coordinator's own
baseline register, the coordinator re-opened the file and measured it. Three such
contradictions were found and resolved (§4).

Findings were then filtered against the hard constraints in
`docs/design-orchestration-baseline.md` §10 — in particular `DONT_BUILD.md` **D9**, which
forbids a visual re-skin. Any recommendation whose only effect was cosmetic was rejected
on scope, not on merit.

---

## 2. Volume

| | Count |
|---|---|
| Raw findings across nine reports | 78 |
| CRITICAL | 0 |
| HIGH | 18 (with overlap) |
| Distinct root causes after merge | **21** |

Twenty-one root causes is small, and that is the headline: **eighteen HIGH findings
collapse to six root causes.** Five of the six are token-level or state-level, which means
the product's remaining design debt is concentrated, not diffuse.

---

## 3. Decision table

### Group A — Semantic status tokens (the single highest-leverage decision)

| Field | Value |
|---|---|
| **IDs** | A1 |
| **Agents** | WT-01 (#1, #2), WT-03 (#1, #2, #3), WT-05 (#3) |
| **Screens** | all 7 canonical, concentrated `/insights`, `/settings`, `/schedule` |
| **Problem** | 250 raw Tailwind palette literals (`text-emerald-600`, `bg-blue-600`, `border-amber-500/30`…) bypass the token layer. There is no `--success`, `--warning`, or `--info`. Status colour is re-decided at every call site, so the same concept renders in different hues on different pages. |
| **Evidence** | WT-03 counted **250** exactly (`bg\|text\|border`, 252 with `ring`/`fill`) across 27 files: warning 102 · success 80 · info 36 · error 21 · categorical 11. Top files `learning-view.tsx` 45, `status-badge.tsx` 32, `hooks.tsx` 22. WT-05 measured the consequence on canonical routes: `text-green-500` **2.28:1**, `text-blue-500` **3.42:1**, `text-amber-600` **3.02:1** — all below AA 4.5:1. WT-01 independently measured a 1.7–3.8:1 cluster. |
| **Overlap** | Three agents, one root cause. Not three findings — one. Also exposes two dead vocabularies: `tailwind.config.ts:78-83` `status.*` (0 consumers) and `lib/constants.ts:35` `POST_STATUSES` (0 consumers). |
| **Conflict** | None. WT-01/03/05 agree on cause; only the call-site lists differ because each worked a different screen set. Union taken. |
| **Second defect in the same pass** | `--destructive: 0 84% 42%` is byte-identical in light (`index.css:37`) and dark (`:139`), so error text lands at **3.04:1** on the dark surface. A token file that defines one value twice for two themes is a bug, not a style. |
| **User value** | High. This is the difference between an operator trusting a red badge and ignoring it. Status is the product's most repeated semantic signal. |
| **Implementation risk** | Medium — 27 files, but mechanical and independently verifiable. |
| **Decision** | **ACCEPT** (merged). One writer owns `index.css`, `tailwind.config.ts`, and the migration. Token values are contrast-verified before any call site moves. |

### Group B — Focus visibility on primary paths

| Field | Value |
|---|---|
| **IDs** | B1 |
| **Agents** | WT-05 (#1, #2, #4) |
| **Problem** | (a) `sources/source-card.tsx:77` strips focus with `focus:outline-none` and no replacement — the primary Explore action on `/sources`. (b) `ui/select.tsx:121` and its siblings highlight the focused option with `focus:bg-accent`, and `--accent (210 8% 94%)` against `--popover (0 0% 94%)` measures **~1.01:1 light / 1.07:1 dark**. Arrowing through any Select, DropdownMenu, ContextMenu, Menubar, or Command shows nothing. |
| **Evidence** | WT-05 enumerated all 9 `focus:outline-none` occurrences across 8 files: **7 have a replacement ring, 2 do not**. Separately 15 `outline-none` sites sit on `bg-popover` and inherit (b). |
| **Why (a) is HIGH** | WCAG 2.2 SC 2.4.11 / 1.4.11. Not a marginal miss — there is no indicator at all. |
| **Why (b) is HIGH** | The checkup report explicitly dismissed this class as "paired with `focus:bg-accent`". WT-05 measured the pair and it is ~1:1. **The dismissal was wrong**, and it means the fix belongs to the coordinator's canonical decision, not to the prior report. |
| **Conflict** | WT-05 rates `navigation-menu.tsx:44` HIGH with a correction: `NavigationMenu` is imported by nothing, so it is unreachable today. Coordinator verified: dead. |
| **Decision** | **ACCEPT** (a) and (b) as HIGH, at measured values. **DEFER** the navigation-menu instance as dead code, but fix it in the same edit since it costs one class and would otherwise become live the day someone imports it. |

### Group C — Motion system: defined but not applied

| Field | Value |
|---|---|
| **IDs** | C1 |
| **Agents** | WT-07 (#1, #2, #5) |
| **Problem** | The token layer defines a complete motion system. Three defects in its application: (a) `data-[state=open]:overlay-motion` on 15 primitive sites means the 175 ms **exit** the system specifies is unreachable — WT-07 proved it with the compiled selector `[data-state="open"][data-state="closed"]`, which is unsatisfiable. (b) `sheet.tsx:34` runs exit 300 ms against entrance 250 ms — the only inverted exit in the app, opposite to the rule at `index.css:245-246`; its `duration-500` literal is dead. (c) 35 hand-rolled `<button>` elements get no `.pressable`; `active:scale` appears 0 times outside `button.tsx`. |
| **Evidence** | Usage table: `.pressable` 1 site (reaching 270 `<Button>`, 0 of 35 raw buttons), `.overlay-motion` 19 valid + 1 broken by a missing space in `context-menu.tsx:63` (`shadow-mdoverlay-motion`), `.rise-in` 1 (working as designed), `.pulse-live` 3, `.pulse-skeleton` 1, `.animate-spin.animate-spin` 0 real call sites as a normaliser over 82 `animate-spin` occurrences, `.motion-safe-pulse` **0 — a dead selector referenced only by its own kill switch**. Also 4 raw `animate-pulse` survivors and 11 raw `transition-all`. |
| **Overlap** | None. WT-07 is sole owner. |
| **Conflict** | None. Note it explicitly *did not* re-report the reduced-motion escalation trigger: verified closed. |
| **User value** | Medium-high. This is what makes the product feel considered rather than assembled, and (a) means overlays currently leave faster than they arrive. |
| **Implementation risk** | Low — the contract already exists; this is application, not invention. |
| **Decision** | **ACCEPT** (a), (b), (c). **ACCEPT** deleting the dead `.motion-safe-pulse` selector and fixing the missing-space class bug. |

### Group D — Failed reads rendered as clean states (truthfulness)

| Field | Value |
|---|---|
| **IDs** | D1 |
| **Agents** | WT-08 (#1, #2, #3), WT-04 (#1) |
| **Problem** | Five data regions render a **failed read as an empty or zero state**: `saved-tab.tsx:157,223,318`; `research-tab.tsx:59,74,173`; `discover-tab.tsx:112,220,483`; `learning-view.tsx:274,1378`; `automated-optimization-panel.tsx:84,216`. Discover goes furthest and prints "No sources found — try broadening your query" on a transport failure. WT-04 found the same class in one more place with a sharper consequence: `learning-view.tsx:555-565` has no `isError` branch on `/api/policy-candidates/activated-ids`, so a failed read renders an **Activate for Future Generations** button for a policy that is already live. Separately, Today's Attention derives failure state from only the newest **20** publications (`today.tsx:67,82`) and ignores the `?state=` filter the server already supports (`server/content/routes.ts:1192`), and Publications fetches `?limit=30` with no total and no disclosure (`publications-view.tsx:21`). |
| **Evidence** | Every site carries a `file:line` and the coordinator's baseline §9 records the counter-example: `today.tsx` already renders `isError` correctly for its other regions. The pattern to copy exists in the same codebase. |
| **Overlap** | Two agents, one root cause: **an absent error branch is indistinguishable from a true empty result.** |
| **Conflict** | None. |
| **User value** | **Highest in the programme.** `brief.md` calls truthfulness the strongest principle in the product and rule 5 forbids rounding an uncertain state down. An operator who cannot tell "you have no failures" from "I failed to look" will stop trusting every other number on the screen. |
| **Implementation risk** | Low — additive branches, mirroring an existing pattern. |
| **Decision** | **ACCEPT**. Split across two writers, `learning-view.tsx` going to the same writer as Group F. |

### Group E — Learning-view structural composition

| Field | Value |
|---|---|
| **IDs** | E1 |
| **Agents** | WT-01 (#3, #4, #5), WT-03 (#5), WT-04 (#3), WT-08 (#4) |
| **Problem** | `components/insights/learning-view.tsx` is **1909 lines with 65 `<Card>` uses**. (a) Up to four rounded+bordered boxes nest inside one Card (`:708→782→805→809-827`, four more sites). (b) Five byte-identical section headers — icon + `text-lg` h2 + outline badge — so the squint test returns five equal-weight bands (`:643,860,1272,1438,1617`). (c) `:1116-1117` puts a 5-column guardrail table behind `overflow-hidden`, clipping its own columns, while the sibling table at `:1561` correctly uses `overflow-x-auto`. (d) `:829-830` hardcodes emerald and forces a `+`, so a regression renders green and a negative value renders as `+-12%`. (e) Every row is a full Card with no pagination, filter, or virtualisation. |
| **Evidence** | Direct reads and greps; `EmptyState` is imported 4× in the same file yet bypassed 3× more. |
| **Overlap** | WT-01, WT-03, WT-04, WT-08 all land here. This is the single densest conflict surface in the programme and the reason for strict single-writer ownership. |
| **Conflict** | WT-01 read the icon-topper circle as cloned here; WT-03 verified **0 clones** — the hand-rolled empties use a circle-less `h-8 w-8 opacity-40` motif. **WT-03 is correct**; the finding is reframed from "duplicated circle" to "the shared `EmptyState` is adopted 10× and bypassed 13× in a competing visual language (`rounded-lg` vs its `rounded-md`)". |
| **User value** | High. Insights is a **Compare** surface and the brief assigns it stable scanning lanes; a stack of equal rounded tiles is not a lane. |
| **Implementation risk** | **High** — 1909 lines, four agents' findings, the whole `/insights` product surface. |
| **Decision** | **ACCEPT**, with the strongest guardrails in the programme: single writer, one file, no behaviour change, table fixture required. |

### Group F — Agent Workspace approval truthfulness

| Field | Value |
|---|---|
| **IDs** | F1 |
| **Agents** | WT-04 (#2, #4, #5), WT-02 (#5) |
| **Problem** | (a) `agent.tsx:705-706` — the approval callout's **Dismiss performs no request** and clears `view.waitingForApproval`, which `deriveRunDisplayStatus` (`agent-workspace-state.ts:54`) reads. It silently removes "Waiting for approval" while the privileged action is still unauthorized. (b) `workspace-cards.tsx:32-35` renders raw enum statuses (`completed_with_errors`, `denied`) in the primary timeline, with `failed` visually identical to `completed` (both `secondary`), duplicating `StatusBadge` on the same page. (c) Approve sits at Section 6 of 6 (`agent.tsx:798-801`) below composer, run summary, auth callout, timeline and repurpose plan, with the same `StatusBadge` rendered twice (`:635`, `:723`). (d) `workspace-cards.tsx:129-168` + `agent.tsx:623` surface internal nouns, raw hashes, `Provider:`, and `backendId` in the primary workflow. |
| **Evidence** | Direct reads; `deriveRunDisplayStatus` confirms the derived state is what the UI trusts. |
| **Overlap** | WT-02 and WT-04 both rank the burying of the Approve decision. |
| **Conflict** | None. |
| **User value** | High for (a) — a control that changes what the UI claims without changing the world is the exact defect class the product forbids. |
| **Implementation risk** | Medium. (a) needs care: the correct fix is to make Dismiss honest (route to a real dismiss action or hide the affordance when unauthorized), not to remove the button. |
| **Decision** | **ACCEPT** (a), (b). **ACCEPT** (c) as progressive disclosure of execution detail behind the existing Diagnostics sheet. **DEFER** (d) to a follow-up — it is a labelling sweep with no single owner and would collide with Group D's writer. |

### Group G — Overlay composition on small viewports

| Field | Value |
|---|---|
| **IDs** | G1 |
| **Agents** | WT-06 (#1, #2, #3, #4) |
| **Problem** | (a) `ui/dialog.tsx:41` has no `max-h`/`overflow-y-auto`; a per-tweet list taller than 844/932px clips top and bottom with body scroll locked, so the "Schedule"/"Save New Time" row (`calendar.tsx:371`) is **unreachable**. (b) `dialog.tsx`/`alert-dialog.tsx` are `w-full max-w-lg` with no gutter — exactly `100vw` at 390/430. (c) Mobile nav trigger 28px and nav rows 32px, icon buttons 36px; **no `pointer: coarse` tier anywhere**. (d) Tab strips `inline-flex` + `whitespace-nowrap` in a `shrink-0` header slot with no `overflow-x-auto`, while `settings.tsx:376` does it right. (e) `h-screen` on the shell hides content behind the iOS toolbar. |
| **Evidence** | WT-06 also corrected the coordinator's premise: `brief.md:317` names `accessibility.e2e.spec.ts` as the viewport gate but **it has no `setViewportSize`/`scrollWidth` check** — the real 49-execution gate is `e2e/full-product-audit.e2e.spec.ts:75-97`, which asserts the header is *visible*, never *sticky*. It also noted Playwright runs Desktop Chrome only (`playwright.config.ts:43-50`), so the coarse-pointer defects are structurally invisible to the suite. |
| **Overlap** | None — WT-06 sole owner. |
| **Conflict** | (c) is "cannot see it" rather than "does not pass", and the coordinator is keeping the self-reported gap rather than closing it as a pass. |
| **User value** | High for (a) — an unreachable primary action is a broken screen, not a polish item. |
| **Implementation risk** | Medium. (a)+(b) are two shared primitives; (c) touches chrome. |
| **Decision** | **ACCEPT** (a), (b), (d), (e). **ACCEPT** (c) as a bounded coarse-pointer tier on the highest-traffic controls only — not a full tap-target sweep, which would be a redesign of the chrome. |

### Group H — Route-level code splitting

| Field | Value |
|---|---|
| **IDs** | H1 |
| **Agents** | WT-09 (#1, #2, #3, #4) |
| **Problem** | `App.tsx:12-21` has **0 `React.lazy`/`Suspense`**. One 1.79 MB chunk ships all seven routes. The route tree cannot mount until `/api/auth/me` resolves, so 6 parallelisable route queries queue behind 1. `/api/artifacts` is fetched twice under two keys on one mount; publications are keyed `?limit=20` on Today and `?limit=30` in Publications. `/insights?view=learning` opens with 9 concurrent GETs. `client/index.html:7` has one render-blocking third-party font stylesheet. |
| **Evidence** | WT-09 measured `assets/index-dIeE5K35.js` = **1,792,007 B (1.71 MiB), gzip 515.64 kB**, `2992 modules` transformed, `/today` needs 354.6 KiB, **1,389.0 KiB (79.6%) is route-exclusive**. **The coordinator independently rebuilt the integration worktree and reproduced the identical filename and byte count.** |
| **Overlap** | WT-09 also **refuted** the checkup's `Speed 10/10`, which rested only on the CLS half and whose own "Not verified" section admits no runtime measurement was taken. Corrected vital: 5/10. Coordinator's baseline register carried the eager-route-tree gap as unconfirmed; WT-09 confirmed it with a number. |
| **Conflict** | WT-09 honestly **rejected** several of its own candidate findings with numbers: no unbounded lists (every list endpoint is server-capped 5/10/20/30/50/100), no chart keystroke re-render (both chart pages expose only a 3-option Select), `@replit/vite-plugin-runtime-error-modal` leaks 0 bytes into prod. Those rejections are accepted and are the reason the rest of its report is credible. |
| **User value** | Medium-high — and it is the one group that is safe to defer, which is exactly why it must be argued rather than assumed. |
| **Implementation risk** | Medium-high. Introducing `lazy`/`Suspense` changes the mount path of all seven routes and can regress the e2e route specs. |
| **Decision** | **MERGE**: accept route-level `lazy`/`Suspense` with a shared fallback, and accept the duplicate-query-key fixes. **DEFER** the font-stylesheet self-hosting and the auth-gate waterfall — the first is a build-config change with a caching implication, the second needs a loading-order redesign that belongs in its own task. |

### Group I — Status system still leans on hue and pulse

| Field | Value |
|---|---|
| **IDs** | I1 |
| **Agents** | WT-05 (#5), WT-04 (a11y), coordinator register O3 |
| **Problem** | `status-badge.tsx:66-68` — `generating`, `running`, `waiting_for_approval` differ only by hue and a `pulse-live` animation. Under `prefers-reduced-motion` (`index.css:426-428`) the pulse is removed, so `generating` and `running` collapse to identical pixels. No non-colour signal. |
| **Evidence** | `index.css:426-428` kills `.pulse-live`; the WIP switched `animate-pulse` → `pulse-live` but added no glyph. |
| **Conflict** | Coordinator register rated this HIGH; **WT-05 rates it MEDIUM**, because the text label still distinguishes the states so it is not colour-alone. **WT-05 is right.** The coordinator's register is corrected to MEDIUM. |
| **Decision** | **ACCEPT** at MEDIUM. A spinner glyph for `generating`/`running` and a clock for `waiting_for_approval`, with the pulse kept as reinforcement only. |

### Group J — Tab strips occupying the primary-action slot

| Field | Value |
|---|---|
| **IDs** | J1 |
| **Agents** | WT-02 (#4, #3) |
| **Problem** | `/schedule` (`:34-50`) and `/insights` (`:54-80`) repurpose the header slot that `page-header.tsx:14` documents as "primary action", so **neither route has a primary action anywhere**. `/sources` stacks two nav rows — the second literally commented `/* Compatibility Views for Legacy Tests & Direct Navigation */` (`sources.tsx:162`) — and `/sources?view=ingest` adds a third band; landing on `/ideas` shows no active pill in the primary row. |
| **Evidence** | Direct reads. WT-02 confirmed the top-level nav itself is clean: `CANONICAL_NAV_ITEMS` (`app-sidebar.tsx:25-33`) is exactly the seven approved destinations with no duplication. |
| **Overlap** | WT-02 (#4) and WT-06 (#4) both touch these tab strips — one for IA, one for overflow. Merged into one owner. |
| **Conflict** | None. |
| **Decision** | **ACCEPT** the primary-action separation. **DEFER** the `/sources` multi-band consolidation: collapsing the compatibility row is a navigation change, and the coordinator will not authorise a nav change on evidence that a compatibility row exists for tests without first proving what depends on it. |

### Group K — Create → Schedule → Review handoff loses context

| Field | Value |
|---|---|
| **IDs** | K1 |
| **Agents** | WT-02 (#1, #2) |
| **Problem** | (a) Canonical scheduled occurrences are **invisible on `/schedule`** — it renders Queue/Calendar/Publications, and the only consumer of `/api/schedule-occurrences` in the whole client is `today.tsx:72`. The create→schedule handoff is a dead end until publication. (b) Two handoff URLs carry context the destination never parses: `getCreateFromSourceUrl` emits `?topic=&sourceUrl=` but `create.tsx:75-103` reads neither; `getAskAgentUrl` emits `?prompt=` but `agent.tsx:162-171` reads only `runId`. |
| **Evidence** | Grep for the endpoint's consumers returns one file. Direct reads of both URL builders and both parsers. |
| **User value** | High — but this is the one HIGH group that is **structural product work, not design work**. |
| **Implementation risk** | Medium-high: (a) means adding a surface to `/schedule`, which edges toward a feature. |
| **Decision** | **ACCEPT** (b) — parsing context the app already emits is a bug fix, and it is the cheapest high-value item in the report. **DEFER** (a) with a written recommendation: it is the strongest product finding in the programme, it is genuinely out of scope for a design pass, and it should be filed as its own task rather than smuggled in under a design brief. |

### Group L — Contrast corrections the token pass does not reach

| Field | Value |
|---|---|
| **IDs** | L1 |
| **Agents** | WT-03 (#2), WT-01 (#1) |
| **Problem** | `--destructive` is byte-identical across themes (already in Group A). Separately, `articles.tsx:29-31`, `hooks.tsx:43-44,81-88`, `artifact-review-view.tsx:549` hardcode light-ramp hues as text on light cards — 1.7–3.8:1. |
| **Conflict** | WT-01 flagged that `/discover`, `/generate`, `/vault` are `LegacyRouteRedirect`s with no live mount, so their palette issues are **unreachable** and must not be reported. Coordinator verified against `App.tsx:97-115`. Accepted — those findings are dropped. `/queue`, `/ingest`, `/articles`, `/images`, `/hooks` are live tabs and are kept. |
| **Decision** | **MERGE** into Group A's migration. The token pass resolves these call sites; they do not need a separate workstream. |

### Group M — Rejected and deferred, with reasons

| ID | Item | Agent | Decision | Reason |
|---|---|---|---|---|
| M1 | `CardTitle` default `text-2xl` causes 24px titles in dense rows | baseline O4, WT-01, WT-03 | **REJECT** | Both agents independently verified **41/41 call sites carry an explicit size override**. Nothing renders at 24px. The default is dead, not harmful. The coordinator's own baseline register was wrong. Retained only as a LOW latent footgun, not a defect. |
| M2 | `navigation-menu.tsx:44` focus ring | WT-05 | **DEFER** (dead code) | `NavigationMenu` is imported by nothing. Fixed opportunistically in Group B, not tracked. |
| M3 | Icon-topper circle cloned across `learning-view.tsx` | smell report #9, baseline O7 | **REJECT as written** | WT-03 verified **0 clones**. The hand-rolled empties use a different, circle-less motif. Reframed into Group E as "`EmptyState` adopted 10×, bypassed 13×". |
| M4 | `settings.tsx:312` prints the access token in plaintext while `:506` states "Tokens are never shown here" | WT-02 | **ESCALATE, do not fix** | This is a **security** finding, not a design one, and it contradicts the product's own stated rule two hundred lines apart. Not authorised for a design agent to change. Reported to the captain separately. |
| M5 | `/today` asks "create?" twice (header CTA + Quick Actions) | WT-02 | **DEFER** | Real, but low value and it collides with Group J's owner. |
| M6 | `create.tsx:187` renders roadmap text "YouTube (deferred)" into the UI | WT-02 | **ACCEPT** (trivial) | Folded into Group J's writer as a one-line copy fix. |
| M7 | 7 items in `useRef`/`refetchInterval` at 1.2–1.5s; 5 concurrent pollers | WT-09 | **DEFER** | Changing poll cadence alters perceived freshness; needs its own decision. |
| M8 | Full 250-literal sweep of categorical/decorative hues | WT-03 | **PARTIAL** | Migrate by semantic intent. Categorical chart/artwork fills stay as they are. Abstraction for its own sake is excluded by the brief. |

---

## 4. Coordinator corrections to the input reports

Recorded because the credibility of this synthesis depends on them. In each case the
coordinator re-opened the file and is reporting the measured result, not either agent's
claim.

| # | Claim | Resolution |
|---|---|---|
| 1 | Baseline register O4: "34 of 41 `CardTitle` call sites un-overridden" | **Wrong.** 41/41 are overridden (WT-01 and WT-03 agree). Corrected in Group M1. |
| 2 | Checkup report: `focus:outline-none` sites are fine because they are "paired with `focus:bg-accent`" | **Wrong.** `--accent` vs `--popover` is ~1.01:1. WT-05's measurement supersedes the checkup's dismissal and produces HIGH B1(b). |
| 3 | Smell report #9: empty-state circle has clones | **Wrong as written.** 0 clones; different motif. Reframed in Group E. |
| 4 | Checkup vital 5: Speed 10/10 | **Refuted.** The vital rested on CLS only; WT-09 measured a 1.71 MiB single chunk, reproduced byte-identically by the coordinator's own build. Corrected to 5/10. |
| 5 | Brief `:317`: `accessibility.e2e.spec.ts` is "the viewport matrix gate" | **Wrong.** It has no `setViewportSize`/`scrollWidth` assertion. The real gate is `e2e/full-product-audit.e2e.spec.ts:75-97`, and it asserts *visible*, never *sticky*. |
| 6 | Baseline register O2: `navigation-menu` focus is HIGH | **Unreachable.** Not imported anywhere. Corrected to dead code. |
| 7 | Baseline register O3: status hue/pulse is HIGH | **Corrected to MEDIUM** by WT-05's colour-alone analysis (text labels still differentiate). |
| 8 | Baseline register: type floor "now wins the cascade" | **Confirmed independently.** WT-01 measured floor at byte 69644 > utility 47811 with its own glob; coordinator measured 93236 > 62107. Different globs, same conclusion. |

---

## 5. What the synthesis deliberately does not do

- **No re-skin.** `DONT_BUILD.md` D9 stands. Groups A, B, C, D, I, L are token-level,
  focus-level or state-level. Groups E and G are structural. Nothing here changes the
  visual direction, and no agent proposed that it should.
- **No navigation change.** Group J separates the primary action from the tab strip; it
  does not touch the seven destinations or the legacy redirects.
- **No new features.** Group K(a) is the one item that would add a surface, and it is
  deferred to its own task precisely because a design brief is the wrong vehicle for it.
- **No autonomy-logic changes.** Group D and F change what the UI *claims*, never what the
  system *does*.

---

## 6. Next

Phase 3 fixes the canonical design direction, including the exact token contract every
implementation agent codes against — written before any agent starts, so six parallel
workstreams cannot each invent their own.

Phase 4 partitions implementation by **file ownership** in `contentforge-design-direction.md`
§7. The single-writer rule is the mechanism that keeps nine agents' worth of findings from
producing nine designs.

---

*Findings IDs A1–M8 are referenced by `docs/design-integration-gap-report.md` (Phase 8) and
`docs/design-final-acceptance.md` (Phase 12).*
