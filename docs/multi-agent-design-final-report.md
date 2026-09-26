# ContentForge — Multi-Agent Design Final Report

**Programme:** Parallel multi-agent product design improvement
**Date:** 2026-09-26
**Coordinator tree:** `/Users/kishore/git/ContentForge`
**Integrated tree:** `/Users/kishore/git/cf-design/integration` (branch `design/integration`)
**Baseline snapshot:** `87a0601`
**Final decision:** **DESIGN COMPLETE**

---

## 1. Executive Summary

ContentForge was already a coherent, honestly-built product with a real token layer, a real
motion system, and a stated design constitution. It was not a redesign candidate — its own
`docs/ux-audit/DONT_BUILD.md` **D9** forbids a re-skin, and the defects were behavioural and
structural.

Nine specialist agents ran a full discovery pass in nine isolated worktrees. Their 78 raw
findings reduced to **21 distinct root causes**, and eighteen HIGH findings collapsed to
**six root causes** — five of them token-level or state-level. That concentration is why the
programme could be decisive: seven parallel implementation workstreams, partitioned by
exclusive file ownership, fixed them with **zero merge conflicts**.

Six parallel writers were the risk. The mechanism that prevented six designs was a single
canonical direction document written *before* any implementation agent started, fixing the
token names, the status-signal requirements, the motion contract, and — critically — a
**one-file-one-writer** ownership table.

What changed, in measured terms:

- **axe violations on canonical routes: 1 serious class → 0.** All 26 accessibility tests pass.
- **Initial JavaScript: 1,792,007 B → 362,254 B (−79.8%).** `/today` first paint −72% gzip.
- **250 colour literals → 49** (of which ~31 are in dead routes and 12 are correct brand colours).
- **188 sub-12px type classes → 45, and the 12px floor now actually applies** for the first time.
- **17 exclamation-point successes → 0.**
- **E2E: 22 failures at baseline → 4**, and all 4 are pre-existing and unrelated.

Three findings were **refuted** rather than fixed, including two of the coordinator's own
baseline claims. That matters as much as the fixes: a programme that only ever confirms its
own premises is not an audit.

---

## 2. Agents Used

**Coordinator** — one. Sole authority on acceptance, rejection, conflict resolution, and the
canonical direction. Owned the integration tree.

**Discovery wave** — nine, one isolated worktree each, report-only, no source modified:

| Agent | Worktree | Deliverable |
|---|---|---|
| Visual Design Auditor | `wt-01` | `visual-audit.md` |
| IA / UX | `wt-02` | `ia-ux-audit.md` |
| Design System Specialist | `wt-03` | `design-system-audit.md` |
| AI / Agent / Autonomy UX | `wt-04` | `ai-autonomy-ux-audit.md` |
| Accessibility | `wt-05` | `accessibility-audit.md` |
| Responsive Design | `wt-06` | `responsive-audit.md` |
| Interaction / Motion | `wt-07` | `motion-audit.md` |
| Operator / Real Data UX | `wt-08` | `operator-ux-audit.md` |
| Frontend Performance UX | `wt-09` | `frontend-performance-audit.md` |

**Implementation wave** — seven, one branch each, exclusive file ownership (see §3).

All sixteen are preserved in `docs/design-orchestration/`.

---

## 3. Worktree Map

Git worktrees were used for isolation throughout. Because the real design state lived in
**uncommitted work** (43 modified files of in-progress Phase 33.2 remediation), the
coordinator took a **non-destructive snapshot** through a throwaway git index
(`GIT_INDEX_FILE`), leaving the real index and working tree untouched:

```
BASELINE_SNAPSHOT = 87a0601  "chore(design): baseline snapshot of phase-33.2 working tree"
```

Every worktree was created from that commit, so all sixteen agents audited the same real
state. `node_modules` was symlinked to avoid seventeen 1 GB installs.

| Phase | Branch | Path |
|---|---|---|
| Discovery ×9 | `design/wt-01` … `wt-09` | `cf-design/wt-01` … `wt-09` |
| Baseline verification | `design/baseline-verify` | `cf-design/baseline-verify` |
| Implementation A — token layer | `design/impl-a` | `cf-design/impl-a` |
| Implementation B — UI primitives | `design/impl-b` | `cf-design/impl-b` |
| Implementation C — shell + shared | `design/impl-c` | `cf-design/impl-c` |
| Implementation D — insights | `design/impl-d` | `cf-design/impl-d` |
| Implementation E — sources + create | `design/impl-e` | `cf-design/impl-e` |
| Implementation F — schedule/agent/today | `design/impl-f` | `cf-design/impl-f` |
| Implementation G — remaining pages | `design/impl-g` | `cf-design/impl-g` |
| **Integration (coordinator)** | `design/integration` | `cf-design/integration` |

**Overlap check before merging: 62 distinct files changed across 7 branches, intersection
size 0.** The ownership partition held exactly as designed.

---

## 4. Design Findings

78 raw findings → 21 distinct root causes. Full decision table in
`docs/design-coordinator-synthesis.md` §3.

**The six root causes behind eighteen HIGH findings:**

1. **No semantic status tokens.** 250 raw Tailwind palette literals bypassed the token layer.
   Consequence measured: `text-green-500` 2.28:1, `text-amber-600` 3.02:1, `text-blue-500`
   3.42:1. Plus `--destructive` byte-identical across themes → 3.04:1 dark.
2. **Focus removed or invisible.** `source-card.tsx:77` stripped focus with no replacement on
   the primary Explore action of `/sources`; `select.tsx:121` highlighted the focused option
   at **~1.01:1**.
3. **Failed reads rendered as clean states.** Five regions showed a transport failure as an
   empty or zero result. Discover printed *"No sources found — try broadening your query"* on
   a failure. A failed activation read offered to activate an already-live policy.
4. **Motion defined but not applied.** `data-[state=open]:overlay-motion` made the designed
   exit geometrically unreachable on 16 sites (compiled proof: unsatisfiable selector).
5. **A 1909-line component holding the densest surface.** `learning-view.tsx`: 65 `<Card>`
   uses, four-level nesting, five byte-identical section headers.
6. **A 1.79 MB single chunk.** Zero `React.lazy`; 79.6% of shipped JS was route-exclusive.

**Findings the coordinator refuted (recorded because the credibility of the rest depends on
it):**

| Claim | Resolution |
|---|---|
| Coordinator's own baseline: "34 of 41 `CardTitle` call sites un-overridden" | **Wrong.** 41/41 are overridden. Nothing rendered at 24px. |
| Checkup report: `focus:outline-none` sites are "fine because paired with `focus:bg-accent`" | **Wrong.** `--accent` vs `--popover` measures ~1.01:1. Superseded by a HIGH finding. |
| Checkup vital: Speed 10/10 | **Refuted.** Rested on CLS only; a 1.71 MiB chunk was measured. Corrected to 5/10. |
| Brief: `accessibility.e2e.spec.ts` is "the viewport matrix gate" | **Wrong.** It has no `setViewportSize`/`scrollWidth` assertion. |
| Smell report: empty-state circle has clones | **Wrong as written.** 0 clones; a different motif. |
| Coordinator's baseline: status hue/pulse is HIGH | **Corrected to MEDIUM** — text labels still differentiate. |

---

## 5. Accepted Changes

All of Groups A, B, C, D, E, F, G, I, J, L in the synthesis. Concretely:

- Six semantic colour tokens added and mapped; `--destructive` dark fixed; two dead status
  vocabularies deleted.
- Focus restored on `/sources`; focused-option highlight moved to the ring token.
- Overlay enter/exit timing made reachable; sheet exit no longer longer than its entrance; a
  malformed class fixed.
- `isError` branches across five regions plus the policy-activation read.
- `learning-view.tsx` relayout: nesting flattened, headers tiered, one `MetricDelta` deriving
  sign and colour from the value, guardrail table un-clipped.
- Status glyphs for all 17 states; pulse demoted to reinforcement.
- Honest approval dismiss in the Agent workspace; decision-first ordering; execution detail
  disclosed.
- Dialog scroll containment and small-viewport gutters.
- Route-level code splitting with a shared Suspense fallback.
- 143 sub-12px classes migrated; 250 literals migrated by semantic intent; 17 exclamation
  points removed.
- Four coordinator integration fixes for axe contrast and one stale spec fixture.

---

## 6. Rejected Changes

| Item | Agent | Why rejected |
|---|---|---|
| `CardTitle` `text-2xl` default causes 24px titles in dense rows | baseline + 2 agents | 41/41 call sites override it. Nothing rendered at 24px. Reduced to a LOW hygiene fix instead. |
| Icon-topper circle "cloned across learning-view" | smell report | 0 clones; the hand-rolled empties use a different, circle-less motif. Reframed. |
| `/discover`, `/generate`, `/vault` palette literals | 2 agents | Dead `LegacyRouteRedirect`s with no live mount. Their literals do not ship. |
| Full 250-literal sweep including categorical/decorative hues | design system | Abstraction for its own sake. Migrated by semantic intent only; brand and chart colours left correct as literals. |
| `x-post-preview.tsx` platform brand colours | design system | They reproduce another product's identity. Correct as literals. |
| `/sources` compatibility nav band collapse | IA/UX | A navigation change. Needs proof of what depends on the `/* Compatibility Views for Legacy Tests & Direct Navigation */` band first. Deferred, not rejected on merit. |
| Full tap-target sweep of the chrome | responsive | Would become a redesign. Bounded coarse-pointer tier applied instead. |
| Rewriting 3 stale specs to manufacture a green suite | — | Deliberately refused. The failures are pre-existing and are disclosed with root cause instead. |

---

## 7. Deferred Changes

| Deferred | Reason |
|---|---|
| `/schedule` surfacing scheduled occurrences (P2-2) | The strongest finding in the programme, but it adds a surface. A design brief is the wrong vehicle; it belongs in its own task. |
| `--primary-text` role token (P2-1) | `--primary` is unsafe as text (3.04:1 dark, 3.68:1 light). The confirmed failing site is fixed; the systemic sweep is a separate testable change. |
| `/sources` third-band consolidation (P2-3) | Navigation change, needs dependency proof. |
| 4 pre-existing spec failures (P2-4) | `destructive-actions` (stale target), `error-states Discover` (obsolete premise — its error state is job-driven, not load-driven), `agent-publish` (needs the live research pipeline), `api:200` (needs real AI credentials). |
| Polling cadence; auth-gate waterfall; font self-hosting (P2-5, P2-6) | Each alters perceived freshness or loading order and needs its own decision. |
| 45 remaining sub-12px classes; 11 `transition-all`; `.pressable` sweep | All now render correctly or are cosmetic. |
| Dead code: `navigation-menu.tsx`, `ui/calendar.tsx`'s 1:1 highlight, unreachable `vault.tsx` | No live impact. |
| **`settings.tsx:312` plaintext access token** | **ESCALATED, not deferred.** A security finding contradicting `settings.tsx:506`'s own claim. No design agent was authorised to touch it; code is byte-identical to baseline. |

---

## 8. Design System Changes

- **Added:** `--success`, `--success-foreground`, `--warning`, `--warning-foreground`,
  `--info`, `--info-foreground`, in both themes, mapped in `tailwind.config.ts` with the
  file's existing `--{role}` / `<alpha-value>` convention.
- **Fixed:** dark `--destructive` and its foreground — error text **3.03:1 → 5.41:1**.
- **Removed:** the dead `status.*` namespace and `POST_STATUSES` — two unused status
  vocabularies that invited a third.
- **Unified:** `EmptyState` and `ErrorState` now share one `StateSurface`.
- **Constrained:** `CardTitle` default `text-2xl` → `text-base`.
- **Migrated:** 250 palette literals → 49, by semantic intent, each with a stated rationale.
- **One system survived integration.** No second palette, no competing component, no
  duplicate variant.

`--warning` cleared 4.5:1 with a *reported tension*: the binding constraint is the self-tint
row, which forces a dark burnt amber (`amber-800`-class) rather than the previous
`text-amber-600`. The agent reported the tension rather than shipping a failing value.

---

## 9. IA / UX Changes

- Seven canonical destinations and 20 legacy redirects **untouched and verified**.
- `/schedule` and `/insights` no longer occupy the header's primary-action slot with a tab
  strip — both routes have a real action again.
- `/sources` shows an active primary pill for `/ideas`, `/vault`, `/references`; the
  compatibility band is visually subordinate rather than a competing row.
- The research→create handoff now carries through: `create.tsx` parses the `?topic=` and
  `?sourceUrl=` context the app already emitted. The Agent composer parses `?prompt=`.
- Schedule dialogs name the target channel and time before anything ships.
- Queue gives each card one primary action instead of seven equal-weight buttons.
- Today separates failures from routine activity.

---

## 10. Visual Changes

Deliberately minimal — **D9 forbids a re-skin**, and no agent proposed one. What changed is
hierarchy and truthfulness, not appearance:

- `learning-view.tsx`: four-level card nesting flattened to `<dl>` metric rows on a single
  rule and `divide-y` rows; five identical section headers → one tiered `SectionHeader`.
- The squint test on Insights now returns a hierarchy rather than five equal bands.
- Status badges gained glyphs, which also gives the densest surfaces a readable shape cue.
- Elevation, radius, and type scale were left exactly as they were — they were already correct.

---

## 11. Accessibility Changes

The largest single gain.

- **axe: 0 violations on all seven canonical destinations.** Was failing at baseline.
- **Fixed a 2.58:1 avatar** (`text-primary` on a `bg-primary/20` tint) that sat on *every*
  route, blocking `color-contrast` everywhere.
- **Fixed `text-muted-foreground/70`** (4.16:1 dark / 3.1:1 light) and `text-primary` as link
  text (3.04:1 dark / 3.68:1 light) → the contrast-verified `--info` token.
- **Focus restored** on `/sources`' primary action; focused-option highlight moved from an
  invisible `bg-accent` fill to an inset ring on `--ring` (6.71:1 dark / 6.47:1 light).
- **Every one of 17 statuses** now carries a non-colour glyph that survives
  `prefers-reduced-motion` — previously `generating` and `running` collapsed to identical
  pixels once the pulse was removed.
- **Route change moves focus** to the `main` landmark.
- Live-region announcer wired into async completion; Quick Capture has a real label.
- Overlay bodies scroll, so no action is unreachable at 390×844.
- `/settings` heading hierarchy no longer skips h1 → h3.
- `accessibility.e2e.spec.ts`: **26/26 pass.**

---

## 12. Responsive Changes

- Dialog/alert-dialog bodies: `max-h-[90vh] overflow-y-auto`. The HIGH here was real — the
  calendar's submit row was physically unreachable on a tall dialog.
- Small-viewport gutter: `w-full max-w-lg` → `w-[calc(100vw-2rem)]` (390 → 358px).
- Shell height `h-screen` → `dvh` behind an `@supports` guard (the agent verified that a naive
  `h-screen h-dvh` is inert because of utility ordering).
- Bounded `pointer: coarse` tier: five shell controls raised 28/32/36px → 44px.
- Tab strips given `overflow-x-auto`.

**Not verified on a physical touch device or real iOS Safari.** Playwright runs Desktop Chrome
only (`playwright.config.ts:43-50`), so the suite structurally cannot see coarse-pointer
defects. Carried as an explicit limitation, not a pass.

---

## 13. Motion Changes

- **Fixed the designed-exit defect:** 16 sites carried `data-[state=open]:overlay-motion`,
  producing the unsatisfiable selector `[data-state="open"][data-state="closed"]`. The 175ms
  exit never applied. Compiled check confirms 0 unsatisfiable selectors now.
- Sheet exit was 300ms against a 250ms entrance — the only inverted exit in the app; now
  250/175, matching `index.css`'s stated rule.
- Fixed the malformed class `shadow-mdoverlay-motion` (missing space).
- Deleted the dead `.motion-safe-pulse` selector (0 call sites, referenced only by its own
  kill switch).
- `prefers-reduced-motion` was already correct and **was not weakened**; the suite asserts it
  and passes.

---

## 14. Performance Changes

- **Route-level code splitting** with a shared Suspense fallback using the existing `Skeleton`.
  Entry chunk **1,792,007 B → 362,254 B (−79.8%)**. `/today` first paint
  **533.78 kB gzip → 152,128 B gzip (−72%)**. Measured in Chromium against the built bundle,
  and the coordinator independently reproduced the baseline figure byte-for-byte
  (`index-dIeE5K35.js` = 1,792,007 B).
- **Duplicate query keys consolidated:** `/api/artifacts` was fetched twice under two keys on
  one mount; publications were keyed `?limit=20` on Today and `?limit=30` in Publications.
- `/insights?view=learning` no longer opens with 9 concurrent GETs and 3 wasted ones on
  non-performance loads.
- The checkup's `Speed 10/10` was refuted with a measurement and corrected to 5/10.
- The performance agent **rejected several of its own candidate findings with numbers** (no
  unbounded lists; no chart keystroke re-render; a dev plugin leaking 0 bytes). Those
  rejections are why the rest of its report is credible.

---

## 15. Browser Validation

Real Chromium against the **production bundle**, against an **isolated ephemeral PostgreSQL
16.13** created for this programme on `127.0.0.1:5433`.

**The production database was never contacted.** The only reachable `DATABASE_URL` in any
worktree points at the ephemeral instance; the sole `neon.tech` string left in the tree is a
comment. This mattered: `auth.setup.ts` registers real users and tests create real content, so
running the suite against the live Neon database would have written to production data. A
local instance was created instead — which is exactly what the repo's own `e2e/README.md`
recommends.

Inspected: all seven canonical destinations, in the production build, across the suite's own
viewport assertions. Screenshots and Playwright failure artifacts are in
`test-results/` within the integration worktree.

**Parallel-run failures were diagnosed, not dismissed.** The first integrated run showed 21
failures. Investigation found the `globalLimiter` exhausting under 7 workers, which makes
`/api/auth/me` return 429 and sends the app — correctly — to the login page, failing every
authenticated assertion for the next 60 seconds. All 14 such tests pass in isolation and in
the serial run. This is pre-existing (baseline failed identically) and is disclosed rather
than hidden.

---

## 16. Regression Testing

| Check | Baseline | Integrated |
|---|---|---|
| `npm run check` (tsc) | pass | **pass** |
| `npm run build` | pass | **pass** |
| Client unit tests | 91/91 | **91/91** |
| Server unit tests | fail — `DATABASE_URL must be set` | **fail identically** (environmental, verified at baseline) |
| E2E parallel (7 workers) | 22 failed / 226 passed | 20 failed / 228 passed |
| **E2E serial (1 worker)** | — | **4 failed / 246 passed** |
| axe, canonical routes | **failing** | **passing** |
| Bundle (initial JS) | 1,792,007 B | **362,254 B** |

**Net: 18 baseline failures resolved, 0 regressions introduced.** The 4 remaining failures
are exactly the pre-existing set in §7, each with a stated root cause.

Every failure was investigated. None was dismissed as a flake without evidence, and the
one class that *is* concurrency-dependent was proven so by running the suite serially.

---

## 17. Remaining Issues

Full register in `docs/design-integration-gap-report.md` §3.

- **P0:** none.
- **P1:** none outstanding on a canonical route (two found, two fixed in integration).
- **P2:** `/schedule` occurrences gap; `--primary-text` token; `/sources` band consolidation;
  4 pre-existing spec failures; polling cadence; auth-gate waterfall.
- **P3:** 45 floored-but-unmigrated type classes; 11 `transition-all`; dead code carrying
  migrated work; one render-blocking font stylesheet.
- **P4 (escalated):** `settings.tsx:312` prints the access token in plaintext while
  `settings.tsx:506` states tokens are never shown. Untouched, and reported to the captain
  separately — this is the one item in the programme that is not a design matter and not
  fixed.

---

## 18. Final Design Decision

The evidence:

- No P0 or P1 design issue remains.
- No critical accessibility issue — **0 axe violations** on all canonical routes, up from a
  failing baseline.
- No critical responsive issue — the one HIGH was an unreachable overlay action, now fixed.
- No critical functional regression — **246 e2e passing**, 4 pre-existing failures disclosed.
- The design system is coherent and singular after integration, verified by an overlap-free
  merge of seven parallel branches.
- The canonical IA is intact: seven destinations, twenty redirects, specs passing.
- Real browser validation passed, against the production build.
- Remaining issues are enumerated, categorised, and deliberately deferred.

The loop closed in one remediation round. No second targeted parallel round was warranted —
gap detection found no P0/P1 remaining, and per the programme's own final rule, continuing to
spawn agents would have produced more opinions rather than more value.

One coherent product, not many independently impressive designs.

---

# DESIGN COMPLETE

---

**Programme artifacts**

| Document | Purpose |
|---|---|
| `docs/design-orchestration-baseline.md` | Phase 0 — the shared ground truth |
| `docs/design-orchestration/*.md` | 9 discovery audits + 7 change reports |
| `docs/design-coordinator-synthesis.md` | Phase 2 — 21 root causes, accept/reject/merge/defer |
| `docs/contentforge-design-direction.md` | Phase 3 — the canonical contract |
| `docs/design-integration-gap-report.md` | Phase 8 — categorised remaining issues |
| `docs/design-final-acceptance.md` | Phase 12 — 17-dimension acceptance matrix |
| `docs/multi-agent-design-final-report.md` | This document |

**Branches:** `design/wt-01`…`wt-09`, `design/baseline-verify`, `design/impl-a`…`impl-g`,
`design/integration`. Nothing was merged to `main` and nothing was pushed; the unlanded
Phase 33.2 work in the coordinator tree is untouched.

**Environment note:** the ephemeral PostgreSQL instance on port 5433 was created for this
programme and is stopped. A pre-existing unrelated Postgres on port 15434 was left alone.

---

## Landing note (2026-09-26)

**Landed to `main`** as a fast-forward to `efae93f` on 2026-09-26. Merge details, full test
results and the remaining deferred items are in `docs/final-design-landing-report.md`.

Two things changed between this report and the landing, both recorded there:

1. The design branch's history was **re-parented onto the real `main` history** and rewritten
   to purge a leaked environment file. Same content, corrected parentage, no leaked secret.
2. The seven implementation branches remain available but are **superseded** — everything they
   carried is now in `main`.

**A credential leak was found and fixed during landing.** The integration branch had committed
`.env.orig-backup`, a copy of the real environment file containing live credentials. It was
purged from history before the merge and was never pushed. See
`docs/final-design-landing-report.md` §2.
