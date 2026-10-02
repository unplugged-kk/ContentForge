# ContentForge — Final Integration Gap Report

**Phase:** 14 (Integration Gap Hunt)
**Date:** 2026-09-26
**Tree:** `main` @ `b4ed802` (integrated: security fix + two remediation branches)
**Question:** did combining the branches introduce anything, and what genuinely remains?

---

## 1. Integration-induced defects

**None found.** Specifically checked, on the merged tree:

| Risk | Result |
|---|---|
| CSS / token conflicts | none — the remediation branches touched no token file |
| Duplicate components introduced | none — no new component was created by any fix |
| Navigation regression | none — `canonical-ia`, `routes`, `today-schedule` all pass |
| Route / redirect regression | none — legacy redirect matrix passes |
| Missing imports / changed contracts | none — `tsc` clean, build clean |
| Accessibility regression | **improved**: the merge *resolved* three violations (below) |
| Test regression | none — serial went **250 → 252 passed**, failures unchanged |
| Security regression | none — the merge only added the `.gitignore` hardening |
| Performance regression | none — build output unchanged in shape |

The three writers had **disjoint file ownership** (`schedule.tsx`+`queue.tsx`;
`today.tsx`+`create-studio.tsx`; test/harness), so both merges applied cleanly with no conflict
resolution required. That is the payoff of the one-writer-per-file rule, and it is why there was
no "which implementation wins" decision to make.

---

## 2. What the integrated verification changed

Two claims from the earlier programme were **wrong**, and integration fixed the first.

| # | Claim as previously documented | Truth | Resolution |
|---|---|---|---|
| G1 | "**0 axe violations** on all canonical routes" | True only for the **rule subset** the repo spec runs. The **full** rule set found **6** violations across three routes: `aria-valid-attr-value` (**impact: critical**) on `/schedule` — Radix `Tabs` with no `<TabsContent>`, so every trigger's `aria-controls` pointed at a non-existent id — plus `heading-order` on `/schedule` (`h1→h5`) and `/create` (`h1→h3`). | **FIXED.** All three repaired. Re-verified with the full rule set: **14/14 route-theme combinations clean, 0 violations** across all seven routes in both themes. The claim is now true as stated. |
| G2 | "3 pre-existing unit failures" (`threads.test.ts`) | **They do not reproduce.** 4 consecutive runs of the full suite give **772/772, 0 failures** — on the same tree where two earlier trees reported the same 3 names. | **CORRECTED.** Classified as environment-sensitive/flaky (they exercise a local HTTP Graph double and are sensitive to port/timing contention), **not** deterministic failures. The "pre-existing failure" framing in the earlier reports was inaccurate. |
| G3 | "20 legacy paths" | The file contains **18**; the unit test deep-equals 18. | **CORRECTED** in the docs. Nothing is missing. |
| G4 | The residual 49 palette literals and 45 sub-12px classes are "dead routes + brand colours" | Only ~60% true — **19 literals and 17 sub-12px classes ship in live chunks** (`create-*`, `insights-*`, `x-post-preview-*`). | **CORRECTED.** Still cosmetic; now honestly counted. |
| G5 | `--primary` as text is 3.68:1 in light | **Not reproducible** — light measures 5.40:1. Only the dark failure (3.40:1) is real. | **CORRECTED.** The one confirmed site already uses `--info`. |

---

## 3. Integrated verification results

All on `main` @ `b4ed802`, production build, isolated ephemeral PostgreSQL.

| Check | Result |
|---|---|
| `npm run check` | **pass** |
| `npm run build` | **pass** |
| Unit tests | **772 / 772 pass** (4 consecutive runs) |
| axe — **full rule set**, 7 routes × light+dark | **14/14 clean, 0 violations** |
| Targeted specs (security, accessibility, phase-33.2, phase-fix-today-create, canonical-ia, today-schedule) | **59 / 59 pass** |
| E2E serial | **252 passed / 4 failed / 1 skipped** |
| E2E parallel | harness contention (pre-existing; see below) |
| Browser smoke, production build | **all 7 routes clean** |

### The 4 remaining serial failures — unchanged and pre-existing

| Test | Root cause | Class |
|---|---|---|
| `destructive-actions:9` | navigates to `/ideas`, which redirects; the canonical delete flow lives in `SavedTab` with different testids | stale spec |
| `error-states:20` "Discover" | force-500s `/api/discover/ideas`, which `DiscoverTab` never calls; its error state is driven by a research-job failure | obsolete premise |
| `agent-publish:3` | needs the live research pipeline; times out at 180 s before its own skip guard | environment |
| `api:200` YouTube→Post | needs real AI credentials | environment |

Both `fix-a` and `fix-b` independently reproduced the `error-states` failure on a **pristine
`main`** via stash + rebuild, confirming it is not integration-induced.

**These four were assigned to worker 33.4, which failed twice.** Two attempts hit their turn
limit before completing a single verification run. Its work — including an
`CONTENTFORGE_E2E_SERVER`-gated rate-limit change — is preserved on
`phase-33.4-test-stability` as an explicitly-labelled WIP commit (`b103dcf`,
"UNVERIFIED, DO NOT INTEGRATE") and was **deliberately not merged**, because integrating
unverified harness changes is precisely the failure mode this programme exists to avoid.
The work is recoverable; `main` is unaffected.

### Parallel-run failures

Investigated, not dismissed. `globalLimiter` exhausts under 7 workers; every `/api/*` call then
429s including `/api/auth/me`, the app correctly falls back to the sign-in surface, and
authenticated assertions fail for 60 seconds. Every affected test passes in isolation and in the
serial run. **Pre-existing and not a product defect** — it is a test-harness limitation, which is
exactly what 33.4 was meant to fix.

---

## 4. Browser smoke detail

Production build, real Chromium, all seven canonical destinations:

| Route | h1 | `<main>` | Overflow @1280 | Overflow @390 | Secret-shaped text |
|---|---|---|---|---|---|
| `/today` | Today | 1 | none | none | no |
| `/create` | Create | 1 | none | none | no |
| `/sources` | Sources | 1 | none | none | no |
| `/agent` | Agent | 1 | none | none | no |
| `/schedule` | Schedule | 1 | none | none | no |
| `/insights` | Insights | 1 | none | none | no |
| `/settings` | Settings | 1 | none | none | no |

- Console errors: **1**, the expected `401` from the post-sign-out `/api/auth/me` probe.
- Page errors: **0**. Failed requests: **0**.
- Client storage: **no secret-shaped value**.
- Sign-out **200**; `GET /api/accounts` afterwards **401**; the app renders the sign-in surface.

---

## 5. Remaining issues

**P0:** none. **P1:** none.

**P2 (unchanged, deliberately deferred):**
- `/schedule` still does not surface scheduled occurrences — a **feature**, not a design fix.
- `--primary-text` token — one confirmed site fixed; systemic sweep deferred.
- `/sources` third-band consolidation — navigation change needing dependency proof.
- 4 pre-existing E2E failures and the parallel-run contention — **33.4 not completed**.
- Polling cadence; auth-gate waterfall.
- Sub-24px targets (WCAG 2.5.8 AA): `/create` 7 chips @20px, `/sources` one 149×16, `/settings` 3 help links @16px. **New this wave**, low impact.

**P3:**
- 45 sub-12px classes and 49 palette literals, of which **19 and 17 respectively ship in live chunks**; 11 `transition-all`; 36 `<button>`s without `.pressable`.
- `--accent` vs `--popover` ≈1.002:1 light / 1.062:1 dark — worked around with an inset ring on `--ring`.
- `/create` chunk 647 KB and `/insights` 497 KB exceed Vite's 500 KB warning. **New this wave.**

**P4:** none — the settings credential contradiction was fixed in the security gate.

---

## 6. Verdict

**No integration-induced defect. No P0 or P1.** The merge strictly improved the tree: it resolved
a **critical** axe violation and two `heading-order` violations that the previous acceptance
claim had missed, and it left every other measure where it was.

Two documentation claims were corrected, one of which (the axe claim) is the more serious kind of
error — a green result reported for a rule set that was never fully run.

**INTEGRATION READY.**
