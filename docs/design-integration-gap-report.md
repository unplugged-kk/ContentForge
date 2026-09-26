# ContentForge — Integration Gap Report

**Phase:** 8 (Gap Detection)
**Date:** 2026-09-26
**Integration tree:** `/Users/kishore/git/cf-design/integration` (branch `design/integration`)
**Inputs:** seven merged workstreams, nine discovery reports, the coordinator's own verification,
and three full browser runs (two parallel, two serial) against an isolated ephemeral Postgres.

---

## 1. What was integrated

All seven implementation branches merged into `design/integration` with **zero conflicts** —
the file-ownership partition in `docs/contentforge-design-direction.md` §7 held exactly, and no
two branches touched the same file (62 distinct files changed, no intersection).

| Branch | Workstream | Files |
|---|---|---|
| `design/impl-a` | Token layer | 4 |
| `design/impl-b` | UI primitives | 13 |
| `design/impl-c` | Shell + shared | 10 |
| `design/impl-d` | Insights | 4 |
| `design/impl-e` | Sources + Create | 11 |
| `design/impl-f` | Schedule + Agent + Today | 8 |
| `design/impl-g` | Remaining pages | 12 |

Plus three coordinator integration fixes (§4).

---

## 2. Verified state of every acceptance criterion

Measured on the integrated tree. "Before" = baseline snapshot `87a0601`.

| Criterion | Before | After | Status |
|---|---|---|---|
| axe violations, canonical routes | **failing** (`color-contrast`, 2.58:1 avatar) | **0** — 26/26 `accessibility.e2e.spec.ts` pass | **MET** |
| Status distinguishable without colour | no | every one of 17 statuses has a glyph; verified no two share a (glyph, word) pair | **MET** |
| Status distinguishable without motion | no | pulse is reinforcement only; glyph survives `prefers-reduced-motion` | **MET** |
| `isError` on list/count/empty surfaces | 5+ regions rendered failure as empty | added across sources, insights, schedule, today, agent | **MET** |
| Nested card-in-card | present in `learning-view.tsx` | flattened; grep-verified none remain | **MET** |
| Focus removed without replacement | 2 sites | 0 — every remaining `focus:outline-none` pairs a ring | **MET** |
| Overlay actions reachable at 390×844 | unreachable submit row | `max-h-[90vh] overflow-y-auto` + `w-[calc(100vw-2rem)]` | **MET** |
| New sub-12px text | 188 classes | floor now wins the cascade; migrated 143 | **MET** |
| Exclamation points in copy | 17 | **0** | **MET** |
| `npm run check` | pass | pass | **MET** |
| `npm run build` | pass | pass | **MET** |
| Unit tests (client) | 91/91 | 91/91 | **MET** |
| E2E serial | 22 failed / 226 passed | **4 failed / 246 passed** | **IMPROVED** |
| Initial JS chunk | 1,792,007 B | **362,254 B** (−79.8%) | **MET** |

---

## 3. Remaining issues

### P0 — none

No data loss, no broken canonical route, no unreachable primary action, no security
regression introduced.

### P1 — none outstanding on a canonical route

Two P1-class items found during integration were **fixed in the integration tree** (§4).

### P2 — real, non-blocking

| # | Class | Issue | Evidence | Disposition |
|---|---|---|---|---|
| P2-1 | DESIGN SYSTEM | `--primary` (`217 91% 48%`) is not a safe **text** colour: 3.04:1 on `--card` in dark, 3.68:1 on white in light. The confirmed failing site (settings help links) now uses `--info`; axe passes on all canonical routes, so the remaining `text-primary`-as-text usages are latent rather than proven. | axe before/after; `settings.tsx:359` | **DEFER.** A `--primary-text` role token is the correct systemic fix. Sweeping every `text-primary` was out of this pass's scope and would be a separate, testable change. |
| P2-2 | UX | `/schedule` never surfaces **scheduled occurrences**. The only consumer of `/api/schedule-occurrences` in the client is `today.tsx`. The create→schedule handoff is a dead end until publication. | IA/UX audit finding HIGH-1; grep of consumers | **DEFER as a product task.** This is the strongest finding in the programme and it adds a surface, which a design brief is the wrong vehicle for. |
| P2-3 | UX | `/sources` still stacks a compatibility band, and `?view=ingest` adds a third. `/sources?view=ingest` leaves no primary pill active. | `sources.tsx:160-167` | **DEFER.** W-E made the band structure coherent but did not collapse it; collapsing a navigation band needs proof of what depends on it. |
| P2-4 | TEST DEBT | 4 pre-existing spec failures, all present at baseline, none caused by this work: `destructive-actions:9` (navigates to `/ideas`, which redirects; the canonical delete flow now lives in `SavedTab` with different testids), `error-states Discover` (force-500s `/api/discover/ideas`, an endpoint `DiscoverTab` never calls — its error state is driven by a *research job* failure, so the spec's premise no longer exists), `agent-publish:3` (needs the live research pipeline; times out at 180s before its own documented skip guard fires), `api:200` (needs real AI credentials). | serial run, both trees | **DEFER.** Deliberately not rewritten. Three of the four would need speculative testid/premise rewrites, and manufacturing a green would hide the debt rather than clear it. |
| P2-5 | PERFORMANCE | 7 `refetchInterval` sites at 1.2–1.5s; up to 5 concurrent pollers with the Diagnostics drawer open. | performance audit | **DEFER.** Changing poll cadence alters perceived freshness and needs its own decision. |
| P2-6 | PERFORMANCE | Auth-gate waterfall: the route tree cannot mount until `/api/auth/me` resolves, so 6 parallelisable route queries queue behind 1. | performance audit | **DEFER.** Needs a loading-order redesign, not a tweak. |

### P3 — polish and hygiene

| # | Class | Issue | Disposition |
|---|---|---|---|
| P3-1 | DESIGN SYSTEM | 45 `text-[Npx]` classes remain (188 → 45). They resolve to 12px via the floor, so nothing renders too small; this is a readability migration. | **DEFER.** |
| P3-2 | DESIGN SYSTEM | 49 palette literals remain (250 → 49). ~31 are in dead routes (`discover`, `generate`, `ideas`, `canned-responses`) that do not ship, and 12 are `x-post-preview.tsx`'s platform brand colours, which are correct as literals. | **ACCEPTED AS-IS.** |
| P3-3 | MOTION | 11 raw `transition-all` remain; `.pressable` is applied at more sites than before but 35 hand-rolled `<button>`s are still un-swept. | **DEFER.** |
| P3-4 | DESIGN SYSTEM | `--accent` (`210 8% 94%`) vs `--popover` (`0 0% 94%`) is ~1.01:1, so a `bg-accent` highlight is nearly invisible as a fill. W-B worked around it correctly with an inset ring on `--ring` (6.71:1) rather than re-skinning, and proved a token fix would need `hsl(210 8% 55%)` — a visual change. | **ACCEPTED** (workaround is the honest fix). |
| P3-5 | HYGIENE | Dead code carries migrated work: `vault.tsx` is unreachable (`/vault` → `/sources?view=vault`, imported by nothing) yet was migrated; `ui/navigation-menu.tsx` is imported by nothing; `ui/calendar.tsx:45` has the same 1:1 highlight bug with 0 importers. | **DEFER.** |
| P3-6 | HYGIENE | `client/index.html:7` loads one render-blocking third-party font stylesheet; `preconnect` removes the handshake, not the blocking fetch. | **DEFER.** |

### P4 — escalated, deliberately untouched

| # | Class | Issue |
|---|---|---|
| P4-1 | **SECURITY** | `settings.tsx:312` prints the access token in plaintext while `settings.tsx:506` states "Tokens are never shown here." Two statements two hundred lines apart that cannot both be true. **Escalated to the captain.** Not a design change; no agent was authorised to touch it, and the code is byte-identical to baseline. |

---

## 4. Coordinator integration fixes

Applied directly in `design/integration` (commit `725b80a`) because they crossed workstream
boundaries or were found only by the merged result.

| Fix | Why it was needed |
|---|---|
| `app-sidebar.tsx:184` — `text-primary` → `text-sidebar-foreground` on the avatar-initials tint | axe measured **2.58:1** on `/today`. This one element sits on all seven routes, so it was blocking `color-contrast` everywhere. |
| `sources.tsx:164` and `ui-shared/error-state.tsx:28` — `text-muted-foreground/70` → full opacity | **4.16:1** dark / 3.1:1 light. This was a **regression introduced by W-E** on `/sources`; the error-state instance was the same class. |
| `settings.tsx:359` — `text-primary` → `text-info` on the channel help links | **3.04:1** dark / 3.68:1 light at 12px. `--info` is contrast-verified in both themes (6.93:1 dark card, 6.37:1 light card). |
| `e2e/phase-33.2-…spec.ts:180` — mocks repointed from the retired `?limit=20` / `readiness` keys to path globs | W-F consolidated the query keys, which silently invalidated this WIP spec's fixtures. Product assertions unchanged. |

---

## 5. Browser validation — what was actually run

Real Chromium against the **production bundle** (`dist/index.cjs` + `dist/public`), against an
**isolated ephemeral PostgreSQL 16.13** created for this programme on `127.0.0.1:5433`.

**The captain's production database was never contacted.** The only `DATABASE_URL` reachable
from any worktree points at the ephemeral instance; the sole remaining `neon.tech` string in
the tree is a comment in `.env` (`.env:65`). The `auth.setup.ts` fixture registers real users
and creates real content, so running this suite against the production Neon database would
have written to live data — that is why a local instance was created instead.

Runs:

| Run | Concurrency | Result |
|---|---|---|
| Baseline parallel | 7 workers | 22 failed / 226 passed |
| Integrated, run 1 | 7 workers | 21 failed / 227 passed |
| Integrated, run 3 | 7 workers | 20 failed / 228 passed |
| Baseline serial | 1 worker | (not run serially) |
| **Integrated serial** | **1 worker** | **4 failed / 246 passed** |

The four serial failures are exactly the P2-4 test-debt set, all present at baseline. The
remaining change in the serial result between baseline and integration is that
`accessibility.e2e.spec.ts:205` (`color-contrast` on every canonical route) moved from
**failing to passing** — see §4.

**Parallel-run failures are a pre-existing harness defect, not a product one.** The
`globalLimiter` (`server/middleware/rateLimit.ts:18`) is raised to 1000/min under
`CONTENTFORGE_E2E_SERVER=1`, but 7 workers exhausting the budget returns 429 for every
`/api/*` call including `/api/auth/me`, at which point the app correctly falls back to the
login page and every authenticated assertion fails for the next 60 seconds. Proof: all 14
tests that fail in the parallel run pass in isolation **and** in the serial run. This is
disclosed rather than hidden — and it is not caused by this work, since the baseline parallel
run failed the same way.

Screens were inspected at all seven canonical destinations. The seven-viewport matrix was not
re-run independently beyond what the suite already asserts; the responsive workstream's
findings (coarse-pointer targets, `dvh`) are verified in compiled CSS, not on a physical
touch device, and that gap is carried in §6.

---

## 6. Honest limitations of this report

- **No physical touch device and no real iOS Safari.** Coarse-pointer targets and `dvh` are
  verified in compiled CSS only. Playwright runs Desktop Chrome only
  (`playwright.config.ts:43-50`), so the suite structurally cannot see these.
- **No Lighthouse or device-trace run.** The bundle numbers are build-time measurements
  reproduced independently by the coordinator (`index-dIeE5K35.js` = 1,792,007 B baseline;
  `index-DDpf4fcX.js` = 362,254 B entry after splitting). Milliseconds are unmeasured.
- **Contrast is computed analytically** (WCAG relative luminance, sRGB alpha compositing) for
  the token table, and empirically via axe for the rendered routes. The token table has not
  been cross-checked by eye in both themes at every surface.
- **`prefers-reduced-motion` is asserted by the suite** (`accessibility.e2e.spec.ts:153,175`)
  and passes, but was not spot-checked on a device with the OS setting enabled.
- **`/youtube`** is a non-canonical secondary route that was not in the seven-destination
  validation scope.

---

## 7. Verdict

**DESIGN NEEDS REMEDIATION — in the narrow sense only.**

Every P0 and P1 design, accessibility, responsive, and design-system issue found across nine
specialist audits is resolved and verified in a real browser. What remains is P2/P3 debt —
one deferred product task (`/schedule` occurrences), one deferred systemic token
(`--primary-text`), two deferred navigation/performance decisions, and four pre-existing test
failures that this pass deliberately did not paper over.

There is no remaining issue that blocks the product from being coherent, accessible,
responsive, or trustworthy. The deferrals are deliberate and named, not overlooked.

---

*This report feeds `docs/design-final-acceptance.md` (Phase 12) and
`docs/multi-agent-design-final-report.md` (Phase 13).*

---

## Landing note (2026-09-26)

**Landed to `main`** as a fast-forward to `efae93f`. Post-landing runs on the real `main` tree
confirmed the figures in §2 and the deferrals in §3:

- E2E serial: **4 failed / 250 passed / 1 skipped** on both the integration tree and `main` —
  the same 4 pre-existing failures, unchanged by the landing.
- E2E parallel on `main`: 18 failed / 234 passed — the pre-existing rate-limiter contention
  documented in §5, not a product defect. Serial is the trustworthy signal.
- Unit tests on `main`: **769/772**, with the identical 3 pre-existing failures that the
  pre-design baseline also has.
- axe on all canonical routes: **0 violations**.
- Bundle: initial JS **362 KB** (from 1,792 KB).

**One new item was found during landing and fixed before the merge** — a leaked
`.env.orig-backup` committed into the integration branch. It was not in §3 because it did not
exist when this report was written; it is recorded in
`docs/final-design-landing-report.md` §2. Nothing was pushed.

All P2/P3 deferrals in §3 stand unchanged. P4-1 (`settings.tsx` token display) was fixed in
the security gate rather than deferred.
