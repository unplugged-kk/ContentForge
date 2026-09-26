# ContentForge — Design Acceptance Matrix

**Phase:** 12 (Design Acceptance)
**Date:** 2026-09-26
**Integrated tree:** `design/integration` @ `725b80a`
**Method:** each dimension judged against the changed files, the rendered production build in
a real browser, and the three regression runs in `docs/design-integration-gap-report.md` §5.

**Scale:** `READY` · `NEEDS POLISH` · `BLOCKED` · `DEFERRED`.
No numerical score — the earlier checkup's 35/60 was a composite that hid which vital was
failing, and it is not repeated here.

---

| Dimension | Verdict | Basis |
|---|---|---|
| **Visual hierarchy** | **READY** | `learning-view.tsx`'s five byte-identical section headers are now one tiered `SectionHeader` — action queues at `text-base font-semibold`, measurement at `text-sm font-medium` — so the squint test returns a hierarchy instead of five equal bands. The Agent workspace moved its Approve decision above the execution timeline. Nested card-in-card is gone (grep-verified). `CardTitle` no longer defaults to `text-2xl`. |
| **Typography** | **READY** | The 12px floor now wins the cascade (compiled proof: floor at byte 93236 vs utility at 62107), so the 188 arbitrary `text-[10px]` classes stopped undercutting the scale. 143 were migrated to `text-xs`/`text-dense`; 45 remain and now render at 12px. No new sub-12px value was introduced. |
| **Color** | **READY** | Six semantic tokens added and mapped (`--success`, `--warning`, `--info` + fore/back pairs), each contrast-verified in both themes. `--destructive` is no longer byte-identical across themes: dark error text moved **3.03:1 → 5.41:1**. 250 literals → 49, of which ~31 are in dead routes and 12 are correct platform-brand colours. |
| **Spacing** | **READY** | Not a redesign target, and no regression introduced. The nested-box flattening removed several layers of `p-2`/`p-3` padding that existed only to fill wrappers. |
| **Composition** | **READY** | Dialog bodies now scroll (`max-h-[90vh] overflow-y-auto`) so no action can be scrolled out of an unreachable overlay. Dialogs reserve a small-viewport gutter (`w-[calc(100vw-2rem)]`; 390 → 358px). Tab strips moved out of the header's primary-action slot on `/schedule` and `/insights`, so both routes have a real action again. |
| **Consistency** | **READY** | One status vocabulary (two dead ones deleted). The focused-option highlight is now the system's ring token (6.71:1 dark / 6.47:1 light) instead of an invisible `bg-accent` fill. `EmptyState`/`ErrorState` share one `StateSurface`. 17 exclamation-point successes → **0**. |
| **Information architecture** | **NEEDS POLISH** | The seven canonical destinations and all 20 legacy redirects are intact and verified by the passing `canonical-ia` and `phase-33.2` route specs. But **P2-2**: `/schedule` still does not surface scheduled occurrences, so the create→schedule handoff is a dead end until publication. Deferred as a product task, not a design one. |
| **Workflow** | **NEEDS POLISH** | Fixed: `create.tsx` now parses the `?topic=`/`?sourceUrl=` context the app already emitted, so the research→create handoff carries through; the Agent composer now parses `?prompt=`. Open: the schedule half of the loop (P2-2). |
| **Discoverability** | **READY** | `/sources` now shows an active primary pill for `/ideas`, `/vault`, and `/references` instead of leaving the primary row blank. The compatibility band is visually subordinate rather than a second competing row. Collapsing it fully is deferred (P2-3). |
| **State communication** | **READY** | This is the strongest gain. Five regions that rendered a **failed read as a clean empty/zero** now have honest `isError` branches — Discover no longer says "try broadening your query" on a transport failure, and `/api/policy-candidates/activated-ids` no longer offers to activate an already-live policy. Truncation is disclosed (Attention at 50, Publications at 30). Unknown, failed, and setup-required remain separable. |
| **AI UX** | **READY** | Decision-first ordering; execution detail behind per-card disclosure; internal nouns, raw hashes, `Provider:` and `backendId` moved out of the primary workflow. No anthropomorphic wording introduced. |
| **Autonomy UX** | **READY** | `agent.tsx`'s Dismiss no longer silently clears `waitingForApproval` — it was relabelled to "Hide request" and decoupled from the derived status, with a persistent banner keeping approval reachable. Failed activation reads no longer round down to "nothing activated". |
| **Accessibility** | **READY** | **0 axe violations on all seven canonical destinations** (`accessibility.e2e.spec.ts` 26/26, was failing at baseline on a 2.58:1 avatar). Focus is never removed without a ≥3:1 replacement. Every status carries a non-colour glyph that survives `prefers-reduced-motion`. Route change moves focus to `main`. Quick Capture has a real label. Reduced-motion is asserted and passes. |
| **Responsive** | **NEEDS POLISH** | Overlay clipping and full-bleed dialogs fixed; shell uses `dvh`; a bounded coarse-pointer tier (44px) applied to five shell controls. **Not verified on a physical touch device or real iOS Safari** — Playwright runs Desktop Chrome only, so the suite structurally cannot see these. Carried as an explicit limitation. |
| **Performance** | **READY** | Initial JS **1,792,007 B → 362,254 B** (−79.8%); `/today` first paint **533.78 kB gzip → 152,128 B gzip** (−72%). Duplicate react-query keys consolidated. The checkup's `Speed 10/10` was refuted and corrected to 5/10 with a measurement; the load path now has evidence behind it. Polling cadence and the auth-gate waterfall are deferred (P2-5, P2-6). |
| **Operator usability** | **READY** | Real-data states: schedule dialogs name the target channel and time before anything ships; Queue gives each card one primary action instead of seven equal-weight buttons; Today separates failures from routine activity; Publications discloses its window. Long-content truncation and large-dataset caps are now honest rather than silent. |
| **Design-system integrity** | **READY** | One system. No second palette, no competing navigation, no duplicate shared component, no new abstraction beyond one `StateSurface` that two existing components share. The two dead status vocabularies were deleted so a third cannot be invented later. |

---

## Summary

| Verdict | Count | Dimensions |
|---|---|---|
| **READY** | 14 | Visual hierarchy, Typography, Color, Spacing, Composition, Consistency, Discoverability, State communication, AI UX, Autonomy UX, Accessibility, Performance, Operator usability, Design-system integrity |
| **NEEDS POLISH** | 3 | Information architecture, Workflow, Responsive |
| **BLOCKED** | 0 | — |
| **DEFERRED** | 0 (as a verdict) | deferrals are carried inside the three NEEDS POLISH rows |

**No dimension is BLOCKED.** The three NEEDS POLISH dimensions are each held back by a named,
deliberately deferred item — not by an unresolved defect:

- **IA / Workflow** — P2-2, the `/schedule` occurrences gap. A product task requiring a new
  surface, which a design brief is the wrong vehicle for.
- **Responsive** — device verification, not a known defect. Every responsive issue found in
  audit is fixed and verified in compiled CSS and the browser.

---

## Does this meet the completion bar?

| Requirement | Met |
|---|---|
| No P0/P1 design issue remaining | **yes** |
| No critical accessibility issue | **yes** — 0 axe violations on all canonical routes |
| No critical responsive issue | **yes** — the one HIGH (unreachable overlay action) is fixed |
| No critical functional regression | **yes** — 246 e2e passing; the 4 failures are pre-existing |
| Coherent design system | **yes** — one system, verified after merge |
| Coherent canonical IA | **yes** — 7 destinations and 20 redirects intact, specs pass |
| Real browser validation passed | **yes** — production build in Chromium against an isolated Postgres |
| Regression tests passed | **yes** — with 4 pre-existing failures disclosed, not hidden |
| Remaining issues explicitly deferred and non-blocking | **yes** — enumerated in the gap report |

---

*Derived from `docs/design-integration-gap-report.md`. Fed into
`docs/multi-agent-design-final-report.md` (Phase 13).*

---

## Landing note (2026-09-26)

**Landed to `main`** as a fast-forward to `efae93f`. Post-landing verification on the real
`main` tree reproduced every verdict below: 0 axe violations on all canonical routes, the
characterisation tests green, and the four previously-deferred failures unchanged. Full
results in `docs/final-design-landing-report.md` §4 and §6.

No dimension changed verdict on landing. The three `NEEDS POLISH` rows remain the same three,
for the same named, deferred reasons.
