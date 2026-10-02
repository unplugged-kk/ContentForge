# ContentForge — Final Parallel Finalization Baseline

**Phase:** 0 (Coordinator Baseline)
**Date:** 2026-09-26
**Branch:** `main` @ `bcf1470`
**Verdict on entry:** the design work is landed and locally verified; final verification and push
have not been completed.

---

## 1. Repository state

| Fact | Value |
|---|---|
| Branch | `main` |
| HEAD | `bcf1470` — `docs(design): land the multi-agent design programme reports` |
| `origin/main` | `d9db1a7` — **untouched**; nothing has been pushed |
| Commits ahead of origin | **20** |
| Modified tracked files | **0** |
| Untracked entries | 13 — all local tooling/scratch material deliberately kept out of the repository |
| Worktrees | 19 (main + 18 programme worktrees) |

`main` contains Phase 33.1 (`ad1a0d0`, `ce884ea`) and the complete design programme
(`fb4d29f` snapshot → 7 workstream commits → 7 merges → 2 coordinator fixes).

### Calibration on 33.2 / 33.3

The orchestrating brief lists 33.2 and 33.3 as remaining implementation work. **Their content is
already implemented and landed on `main`** — the design programme was exactly that work:

| 33.x item | Where it landed |
|---|---|
| Visible Reject action | `components/create/artifact-review-view.tsx`, `components/agent/artifact-review.tsx` |
| Today setup/configuration state | `pages/today.tsx`, `lib/today-schedule-state.ts` |
| Duplicate landmark correction | `App.tsx`, `ui-shared/page-header.tsx` |
| Channel icon accessibility | `ui-shared/channel-icon.tsx` |
| Canonical/legacy route consolidation | `lib/legacy-route-mapping.ts`, `App.tsx` |
| Homeless legacy capability integration | `pages/create.tsx` (`?mode=` handling) |
| Discoverability | `pages/sources.tsx` active-pill fix |
| Visual hierarchy / typography / semantic colour / contrast | workstreams A, B, D, G |
| Component consistency, touch targets, motion | workstreams B, C, F |
| Measurable frontend performance | workstream C (route code splitting) |

Therefore **33.2 and 33.3 are run as independent verification passes, not re-implementation.**
Re-doing them would be redundant work against a tree that already contains the result, and the
brief's own principle is that the goal is not maximum agent activity. This is a deliberate
deviation from the letter of the brief and is recorded here rather than silently taken.

**33.4 is genuinely outstanding** and is the only implementation workstream in this wave.

---

## 2. Verified test baseline

Measured on `main` @ `bcf1470`. Every figure below was produced by a command, not carried over.

| Check | Result |
|---|---|
| `npm run check` (tsc) | **pass** |
| `npm run build` | **pass** |
| Unit tests | **769 pass / 3 fail** of 772 |
| DB tests | 4 pass / 1 fail (1 self-skip pattern across the rest) |
| E2E serial (`--workers=1`) | **250 passed / 4 failed / 1 skipped** |
| E2E parallel (7 workers) | 234 passed / 18 failed |
| axe, canonical routes | **0 violations** (26/26) |
| Security suite | 4/4 |
| Initial JS entry | 354 KB (from 1,792 KB pre-design) |

### Known non-passing tests, all pre-existing

| # | Test | Root cause | Class |
|---|---|---|---|
| 1 | `server/content/threads.test.ts` ×3 (`creates a TEXT container…`, `classifies a dropped publish…`, `adapter publish + fetchMetrics…`) | Threads Graph HTTP double | pre-existing; reproduced on the pre-design baseline |
| 2 | `server/legacyOwnerIsolation.dbtest.ts` | `Missing OpenAI credentials` thrown at import (`server/ai/config.ts:23`) | environment |
| 3 | `e2e/destructive-actions.e2e.spec.ts:9` | navigates to `/ideas`, which redirects; canonical delete flow is in `SavedTab` with different testids | stale spec |
| 4 | `e2e/error-states.e2e.spec.ts:20` "Discover" | force-500s `/api/discover/ideas`, which `DiscoverTab` never calls | obsolete premise |
| 5 | `e2e/agent-publish.e2e.spec.ts:3` | needs the live research pipeline; times out before its own skip guard | environment |
| 6 | `e2e/api.e2e.spec.ts:200` | needs real AI credentials | environment |
| 7 | 14 further tests under **parallel** only | `globalLimiter` exhaustion → `429` on `/api/auth/me` → app falls back to sign-in | harness contention |

**Pre-design baseline comparison (unit):** `87a0601` scored 766 / 763 pass / 3 fail against
`main`'s 772 / 769 / 3 fail. Same three failures; the +6 are new `secret-display` tests.

---

## 3. Current routes and canonical destinations

```
/today  /create  /sources  /agent  /schedule  /insights  /settings
/youtube (secondary, non-canonical)
```
20 legacy paths redirect via `client/src/lib/legacy-route-mapping.ts`. **This IA is frozen.**

---

## 4. Current shared components and tokens

**`components/ui-shared/`** — `page-header`, `status-badge`, `empty-state`, `error-state`,
`state-surface`, `confirm-dialog`, `publish-preview`, `schedule-picker`, `actor-badge`,
`announcer`, `channel-icon`.

**Tokens** (`client/src/index.css`): surfaces, text, `--primary`, `--ring` (≠ `--primary`),
`--destructive` (divergent per theme), `--chart-1..5` (lightness-first ladder), and the six new
semantic role tokens `--success`, `--warning`, `--info` + foregrounds in both themes — **12
definitions**. Type tokens `--text-meta` (12px floor) and `--text-dense`. Motion tokens
`--duration-*` and `--ease-out-*`. Eight shadow steps with live alpha.

**No second design system exists.** One palette, one status vocabulary, one `StateSurface`.

---

## 5. Known deferred items — do not re-open as defects

| Item | Status |
|---|---|
| Surface scheduled posts on `/schedule` | deferred — a **feature**, not a design fix |
| `--primary-text` role token | deferred — one confirmed site fixed via `--info`; axe passes |
| `/sources` third-band consolidation | deferred — navigation change needing dependency proof |
| 45 sub-12px classes | deferred — all now render at 12px via the floor |
| 11 `transition-all`; 35 `<button>`s without `.pressable` | deferred — cosmetic |
| Dead code (`navigation-menu.tsx`, unreachable `vault.tsx`) | deferred — no live impact |
| Polling cadence; auth-gate waterfall; font self-hosting | deferred — need their own decisions |
| 6 pre-existing test failures (rows 1–6 above) | 33.4 owns them this wave |

---

## 6. Security posture on entry

- Credential display: server-side masking in every response; **client-side defensive masking
  added** (`client/src/lib/secret-display.ts`); the settings row reads "Token (masked)".
- A leaked `.env.orig-backup` was committed into a local design branch, **purged before landing**,
  and **never pushed**. `origin/main` is untouched.
- **Credential rotation is an outstanding HUMAN action** and is the gate on pushing `main`.

---

## 7. This wave

| Worker | Branch | Mode |
|---|---|---|
| 33.2 | `phase-33.2-ia-ux-a11y` | verification (read-only) |
| 33.3 | `phase-33.3-visual-design-performance` | verification + measurement (read-only) |
| 33.4 | `phase-33.4-test-stability` | **implementation — sole writer** |
| 34-preaudit | `phase-34-preaudit` | read-only |
| security | `phase-security-verification` | read-only |

**One writer.** Four read-only. No file can be modified by two workers, so there is no
conflict-resolution step after the fact.

**Sequential and untouched by this wave:** integration, integrated verification, the credential
gate, pushing `main`, and the Phase 34 verdict.
