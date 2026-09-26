# ContentForge — Final Design Landing Report

**Date:** 2026-09-26
**Coordinator:** design landing + main verification
**Result:** **DESIGN LANDED**

---

## 1. Integration State

The multi-agent design programme had produced:

- nine specialist discovery audits (worktrees `wt-01`…`wt-09`)
- seven parallel implementation workstreams (`design/impl-a`…`g`), partitioned by exclusive file
  ownership — **62 files changed across 7 branches with an intersection size of 0**
- one integration branch (`design/integration`) carrying the merged result plus four
  coordinator fixes and one security fix

**Pre-landing review of the integration diff:**

| Check | Result |
|---|---|
| Files changed vs the pre-design `main` | 91 files, +5,436 / −1,063 |
| `server/` files changed | **0** — no backend, API, or schema change |
| Duplicate design systems | none — one palette, one status vocabulary, one `StateSurface` |
| Duplicate shared components | none — verified by the zero-intersection merge |
| Competing navigation | none — 7 canonical destinations, 20 redirects, unchanged |
| Unauthorised product features | none — the one feature-class finding (`/schedule` occurrences) stayed deferred |
| Test weakening | none — 5 new test files, 0 assertions deleted |
| Scheduler / autonomy changes | none — `server/` untouched |

The working tree at the start of landing was **explicitly understood, not clean**: `main` held
43 uncommitted modifications — the in-progress Phase 33.2 work that the design programme had
been built on. Everything below was verified before that work moved.

---

## 2. Security Gate

Two separate matters. The second is the more serious and was introduced by me.

### 2.1 Settings credential display — fixed (the commissioned finding)

Reproduced empirically: a canary credential was connected through the real API, `/settings` was
loaded in Chromium, and the canary was searched for across **six surfaces** — network responses,
rendered DOM, `localStorage`, `sessionStorage`, the URL, and console output.

**The finding did not reproduce as reported.** The value that reached the browser was already
**masked** (`••••••` + last 4 characters). The server masks it in every response
(`server/routes.ts:1977-1981`, and five more sites), and that masking is present in `main`
today — it was not introduced or broken by the design work.

Two real defects were underneath it, and both are fixed:

1. **The product made a false statement.** "Tokens are never shown here" while the same screen
   showed a masked hint.
2. **The safety was accidental, not enforced.** The UI printed whatever the API returned, so the
   entire protection rested on one server-side mapping. Remove it, or add one endpoint that
   returns the raw row, and a live credential lands in the DOM.

Fix: `client/src/lib/secret-display.ts` derives the display value, and can never expose more
than the last 4 characters — including for secrets short enough that "show the last 4" would
reveal the whole value. The row is labelled **"Token (masked)"** and the claim is now accurate.
Connect, update, test and disconnect are unaffected; no API, storage or authentication change.

Covered by 6 unit tests (including a sliding-window assertion that no run of the secret body
survives) and 4 browser tests asserting on the negative across every surface, plus cross-tenant
isolation, unauthenticated access, and post-logout access. Evidence:
`docs/design-orchestration/security-settings-masked-token.png`. Full detail:
`docs/design-security-gate.md`.

### 2.2 A real credential leak, introduced by me, found during landing and purged

**This is a defect I created, and it blocked the landing until it was fixed.**

Preparing the integration tree, I ran `cp .env .env.orig-backup` before repointing the worktree's
database, then committed with `git add -A`. `.env` is gitignored; **`.env.orig-backup` is not**,
because the ignore rule matches the exact filename. The commit therefore captured the real
environment file.

Verified contents — live values, identical to the working `.env`:

| Key | Status |
|---|---|
| `DATABASE_URL` | **identical to the live value** (production Postgres) |
| `AI_API_KEY` | **identical to the live value** (OpenRouter) |
| `SESSION_SECRET` | **identical to the live value** |
| `X_CLIENT_SECRET`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | live |
| `GOOGLE_CLIENT_SECRET` | live |
| `FAL_KEY`, `ELEVENLABS_API_KEY` | live |

**Exposure assessment — contained, and verified so rather than assumed:**

- It existed in **exactly one branch**, `design/integration` (checked every local and remote ref).
- It was **never pushed**: 0 remote branches contained the commit, and `origin/main` is
  untouched at `d9db1a7`.
- It is now **purged from history**: `git log --all -- .env.orig-backup` is empty, and
  `rev-list --all --objects` returns **0** reachable objects for that path.

**Remediation:** the integration branch was rewritten with `git filter-branch` to remove the file
from every commit, the filter-branch safety refs were deleted, reflogs expired and objects
pruned. The rewrite also removed the local tooling/scratch directories and corrected a history
defect (§3).

**Residual risk, stated plainly:** the credentials were always present in the working `.env` on
this machine, so the leak did not widen exposure beyond the machine. It did put them into a git
object on disk, which would surface in any repo backup or `git clone` of this local repo. If this
machine is backed up to a remote or the repo is shared, **rotating those credentials is
prudent.** There is no evidence of external exposure.

---

## 3. Merge Details

**Result: a fast-forward.** `main` advanced `ad1a0d0 → efae93f`.

Three defects in the design branch's history had to be corrected first, and they are recorded
because they changed what landed:

**(a) The snapshot commit was an orphan root.** In Phase 0 the coordinator created the baseline
snapshot with `git commit-tree` **without `-p HEAD`**, so `87a0601` had no parent and the design
branch shared no history with `main` (`git merge-base` returned nothing). The tree was correct;
the parentage was not. Corrected with `--parent-filter`, re-parenting the snapshot onto
`ad1a0d0`. The branch is now linear and fast-forwardable.

**(b) Local tooling and scratch material would have been committed.** The snapshot's `git add -A`
captured top-level directories that had never been tracked in `main`: `.agents/`, `.commandcode/`,
`.gemini/`, `.grok/`, `.kimchi/`, `.kiro/`, `.scratch/`, `.windsurf/`, `Claude outputs/`,
`architecture/`, `research/`, `roadmap/`, `.ignore`. `.gitignore` already excludes the same class
(`.claude/`, `.cursor/`, `.codex/`, `.mcp.json` — "IDE / AI tooling"), so committing them would
have been an unreviewed decision, and the reversible choice is to leave them untracked.
**113 paths were excluded; 0 application files were removed.** They remain in the working tree,
untracked and untouched, exactly as before.

**(c) No special handling was needed for the unlanded work**, because it was verified to already
be inside the integration tree: **43 tracked files checked, 0 drifted.** Nothing was discarded,
stashed, or reset with content that did not come back.

**Safety measures taken before any of this:**

| Backup | Purpose |
|---|---|
| branch `backup/pre-landing-wip` (`ae0f865`) | the 43-file tracked WIP, content-verified against the working tree with 0 mismatches |
| `/Users/kishore/git/cf-design/backup/untracked.tgz` | every untracked file, 2.1 MB |
| `design/integration` original tip recorded | for recovery of the pre-rewrite branch |
| `/Users/kishore/git/cf-design/backup/pre-ff-untracked/` | the 15 untracked files that collided with the merge |

Nothing was force-pushed and no history was rewritten outside the unlanded design branch itself.

---

## 4. Build/Test Results

All on the real `main` tree after landing.

| Check | Result | Classification |
|---|---|---|
| `npm run check` (tsc) | **pass** | — |
| `npm run build` | **pass** | — |
| Unit tests | **769 / 772** | 3 pre-existing — see below |
| DB tests | 4 / 5, 1 fails | **environment** — see below |
| axe, canonical routes | **0 violations** (26/26 in `accessibility.e2e.spec.ts`) | — |
| Security suite | **4 / 4** | — |
| Targeted (security + a11y + canonical IA + phase-33.2) | **51 / 51** | — |
| **E2E serial** | **250 passed, 4 failed, 1 skipped** | 4 pre-existing |
| E2E parallel | 234 passed, 18 failed | pre-existing harness contention |
| Browser smoke, production build | **pass** | §5 |

### Non-passes, each classified

**1. Three unit tests fail — pre-existing, not a regression.**
`creates a TEXT container then publishes and returns the media id`;
`classifies a dropped publish after container create as unknown (not a retryable clean fail)`;
`adapter publish + fetchMetrics normalize views→impressions and keep quotes unmapped`.

Reproduction: the **same three fail on the pre-design baseline** (`87a0601`), which scores
766 tests / 763 pass / 3 fail against `main`'s 772 / 769 / 3. The +6 are the new
`secret-display` tests. **Production impact: none identified** — they exercise a Threads Graph
HTTP double, and `server/` was not touched by this work.

**2. One DB test fails — environment, not a regression.**
`server/legacyOwnerIsolation.dbtest.ts` throws
`Missing OpenAI credentials: set OPENAI_API_KEY` at import time via `server/ai/config.ts:23`.
Reproduction: **identical failure on the pre-design baseline.** The runner provides no AI
credentials (most DB tests self-skip for the same reason). The security-relevant
`create + review workflow (db)` suite **passed**, covering Story → Opportunity → GenerationJob →
Artifact, revision with `supersedesId`, approval transition, and regenerate. **Production
impact: none** — CI provides the key.

**3. The four E2E failures are the same four carried since the design programme.** Present at the
pre-design baseline and unchanged by the landing:

| Test | Root cause | Class |
|---|---|---|
| `destructive-actions:9` | navigates to `/ideas`, which redirects; the canonical delete flow now lives in `SavedTab` with different testids | stale spec |
| `error-states:20` "Discover" | force-500s `/api/discover/ideas`, an endpoint `DiscoverTab` never calls — its error state is driven by a *research job* failure | obsolete premise |
| `agent-publish:3` | needs the live research pipeline; times out at 180 s before its own documented skip guard fires | environment |
| `api:200` YouTube→Post | needs real AI credentials | environment |

**4. Parallel E2E shows 18 failures; serial shows 4.** Investigated, not dismissed. The
`globalLimiter` (`server/middleware/rateLimit.ts:18`) exhausts under 7 workers, after which
**every** `/api/*` call returns 429 — including `/api/auth/me`, at which point the app correctly
falls back to the sign-in surface and every authenticated assertion fails for 60 seconds. Proof:
every affected test passes in isolation and in the serial run. Pre-existing (the pre-design
baseline failed the same way), and not caused by this work.

**Nothing was hidden, and no assertion was deleted to make anything green.**

---

## 5. Browser Verification

Real Chromium against the **production build** (`dist/index.cjs` + `dist/public`), against an
isolated ephemeral PostgreSQL 16.13 on `127.0.0.1:5433`. The production database was never
contacted.

**Sign-in → seven destinations → sign-out → protected route:**

| Route | h1 | `<main>` landmarks | Overflow @1280 | Overflow @390 | Secret-shaped text |
|---|---|---|---|---|---|
| `/today` | Today | 1 | none | none | no |
| `/create` | Create | 1 | none | none | no |
| `/sources` | Sources | 1 | none | none | no |
| `/agent` | Agent | 1 | none | none | no |
| `/schedule` | Schedule | 1 | none | none | no |
| `/insights` | Insights | 1 | none | none | no |
| `/settings` | Settings | 1 | none | none | no |

- **Console errors: 1**, and it is the expected `401` from the post-sign-out `/api/auth/me`
  probe. No page errors. No failed requests.
- **Client storage contains no secret-shaped value.**
- **Sign-out: 200. `GET /api/accounts` afterwards: 401.** `/today` renders the sign-in surface
  rather than the dashboard.
- **Direct probe:** `curl /api/accounts` with no cookie → **401** `{"message":"Unauthorized"}`.

**Functional journeys** are covered by the E2E suite, which passed in serial except the four
classified above: `today-schedule`, `create-workflow`, `insights` (journeys A–J),
`learning-proposals` (A–E), `experiments`, `sources-workflow`, `quick-capture`, `canonical-ia`,
`full-product-audit`, `accessibility`, `phase-33.2-ia-ux-accessibility`, `security-secret-exposure`.

---

## 6. Design Regression Check

Measured on `main` after landing, against the pre-design baselines established by the programme.

| Measure | Before | On `main` | Status |
|---|---|---|---|
| axe violations, canonical routes | failing (2.58:1 avatar) | **0** | held |
| Initial JS | 1,792,007 B | **354 KB entry** (route chunks split) | held |
| Lazy route chunks | 0 | **8** | held |
| Palette literals (live code) | 250 | **49** | held |
| Exclamation-point successes | 17 | **0** | held |
| Sub-12px text classes | 188 | **45** (all floored to 12px) | held |
| Semantic tokens defined | 0 | **12** (`--success`/`--warning`/`--info` + foregrounds, both themes) | held |
| `focus:outline-none` without a ring | 2 | **0** | held |
| `/settings` credential row | full field rendered | **"Token (masked)" + `••••••` + last 4** | held |

Every claim above was produced by a command run on `main`, not carried over from the
integration tree. Nothing was inferred.

---

## 7. Functional Regression Check

The strongest structural evidence: **`server/` changed by 0 files** across the entire landing.
No API contract, route handler, database schema, scheduler, autonomy control, or authentication
path was modified.

| Area | Evidence |
|---|---|
| Authentication | smoke sign-in works; `401` when anonymous; `200` on logout |
| Owner isolation | cross-tenant test: a second user's account list is `[]`, cannot drive the owner's account (404); the security-relevant DB suite passed |
| Generation / revision | `create + review workflow (db)` passed — revision creates a new row with `supersedesId` without mutating the original |
| Approval / rejection | `phase-33.2` specs passed for both — Reject records the rejected revision state on Create and in the Agent workspace |
| Scheduling / publication | `today-schedule`, `canonical-ia`, `phase-33.2` passed |
| Research / agent execution | `sources-workflow`, `agent-workspace` passed |
| Experiments / learning | `experiments`, `insights` (A–J), `learning-proposals` (A–E) passed |
| Scheduler / autonomy | no `server/` change; scheduler specs unaffected |

---

## 8. Security Verification

| Requirement | Result |
|---|---|
| Canary credential absent from network response | **pass** |
| …from DOM / rendered HTML | **pass** |
| …from `localStorage` / `sessionStorage` | **pass** |
| …from the URL and query string | **pass** |
| …from console output | **pass** |
| Anonymous protected request → 401 | **pass** (test + independent `curl`) |
| Cross-owner access → denied | **pass** (empty list; 404 by id) |
| Post-logout access → denied | **pass** (401) |
| Paid external side effect authenticated and owner-authorized | unchanged — `publishLimiter` and the auth gate untouched; `server/` changed by 0 files |
| No credential present in the repository | **pass** — `.env.orig-backup` unreachable from every ref, 0 objects |

---

## 9. Remaining Deferred Items

**Deliberately deferred, and still deferred. None was implemented during landing.**

| Item | Why deferred |
|---|---|
| **Surfacing scheduled posts on `/schedule`** | The strongest finding in the programme, and correctly identified as a **feature addition**, not a design fix. Needs its own task. |
| `--primary-text` role token | `--primary` is not a safe text colour (3.04:1 dark / 3.68:1 light). The one confirmed failing site uses `--info`; axe passes on all canonical routes. The systemic sweep is a separate testable change. |
| `/sources` third-band consolidation | A navigation change needing proof of what depends on the compatibility band. |
| 4 pre-existing E2E failures | Three need speculative testid/premise rewrites; rewriting them would manufacture a green suite without fixing anything. |
| 45 sub-12px classes, 11 `transition-all`, `.pressable` sweep | All render correctly today; cosmetic. |
| Polling cadence; auth-gate waterfall; font self-hosting | Each alters perceived freshness or loading order. |
| Dead code (`navigation-menu.tsx`, unreachable `vault.tsx`) | No live impact. |
| Not built, as instructed: native app, auto-DM/reply, second chat, speculative dashboards, platform expansion | — |

**Closed rather than deferred:** the `settings.tsx` credential-display contradiction (§2.1).

---

## 10. Final MAIN State

```
branch : main
HEAD   : efae93f  fix(security): make the credential display contract true and enforced
parent : d5822ae  fix(integration): resolve axe color-contrast on all canonical routes
         … 7 workstream commits + 7 merge commits, re-parented onto ad1a0d0
origin : d9db1a7  (untouched — nothing pushed)
tree   : 91 files changed vs the pre-design main, 0 in server/
status : 0 modified tracked files
```

Working tree untracked entries are the local material deliberately kept out of the repository
(`.agents/`, `.commandcode/`, `.scratch/`, `research/`, `roadmap/`, `architecture/`,
`Claude outputs/`, and the programme's own documentation) plus the coordinator's new
`docs/` reports, which are committed separately.

**Branches:** `design/integration` == `main`. `design/impl-a`…`g` and `design/wt-01`…`wt-09` are
superseded — everything useful is in `main` and the reports are in `docs/design-orchestration/`.
`backup/pre-landing-wip` is retained deliberately as the pre-landing recovery point.

**Not done, by instruction:** nothing was pushed, and the four deferred items were not
implemented.

---

# DESIGN LANDED
