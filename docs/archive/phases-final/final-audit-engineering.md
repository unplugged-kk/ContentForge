# ContentForge — Final Independent Production Audit

## Auditor D — Engineering · Test Integrity · Performance

**Tree audited:** detached worktree `/Users/kishore/git/cf-design/fa4` at `origin/main` = **`d60e55e`**
(`fix(33.7): close six production blockers; add audit reports`). `git status` clean before audit.
**Mode:** READ-ONLY. This file is the only write.
**Env:** `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e` (reachable; 68 public tables,
32 migrations applied, `discovery_settings.user_id` present), `E2E_PORT=4804`. Node v24.19.0 (repo
`engines` asks for node 20 — see §2). No secret printed.

Evidence is labelled **BY EXECUTION** (a command actually run here), **BY MEASUREMENT** (build output),
or **BY READING** (`file:line`). Prior reports were treated as unverified and re-derived.

---

## 1. The DB-test coverage hole — measured root cause

### 1.1 Truth of `npm run test:db`

The corpus contains **39** `server/**/*.dbtest.ts` files. The script is:

```
NODE_ENV=test node --import tsx script/test-db-guard.ts && \
NODE_ENV=test node --import tsx --test --test-concurrency=1 "server/**/*.dbtest.ts"
```

**BY EXECUTION** — `DATABASE_URL=… npm run test:db` (the env given for this audit) → raw tail:

```
[test-db-guard] cleared 0 stale connected_accounts row(s) before run
﹣ agent runtime (db) (0.19ms) # SKIP
…  (37 suites reported as SKIP) …
▶ create + review workflow (db)         ← the only suite that executes
  ✔ human Story creation -> Opportunity -> GenerationJob -> Artifact works end-to-end
  ✔ Artifact revision creates a new row with supersedesId without mutating original
  ✔ Approval transitions artifact readiness and records approvedAt timestamp
  ✔ Regenerate creates a sibling GenerationJob and Artifact revision without touching original
✖ server/legacyOwnerIsolation.dbtest.ts (578ms)
      Error: Missing OpenAI credentials: set OPENAI_API_KEY (or AI_API_KEY / …).
          at resolveOpenAiApiKey (server/ai/config.ts:23:9)
ℹ tests 5   ℹ suites 38   ℹ pass 4   ℹ fail 1   ℹ skipped 0
```

**So `npm run test:db` executes 5 test cases (4 pass, 1 file-level error); 37 of 39 files never run.**
The corpus (measured below) holds **364** cases → the scripted run covers **~1.4 %** of it.

### 1.2 Why the other files do not run (the hypothesis is REFUTED)

The strong hypothesis was: one file throws at import (`Missing OpenAI credentials`) and *aborts the run*,
causing the others to be reported as skipped. **This is refuted.**

The real cause is an environment-variable split. **BY READING** — every suite gates itself:

```ts
const CONNECTION = process.env.TEST_DATABASE_URL;          // 38 files
const describeDb  = CONNECTION ? describe : describe.skip;
```

There are **38** `const CONNECTION = process.env.TEST_DATABASE_URL;` sites; **exactly one** file
(`server/content/createWorkflow.dbtest.ts:34`) also falls back to `DATABASE_URL`:

```ts
const CONNECTION = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
```

With only `DATABASE_URL` set, 37 files resolve `CONNECTION` to `undefined` and call `describe.skip` — the
37 `# SKIP` lines. The 39th file (`server/legacyOwnerIsolation.dbtest.ts`) has **no** gate at all; it
imports `./routes` → `server/ai/config.ts`, which throws at module load (`config.ts:23`) with no
`OPENAI_API_KEY` — the single `fail 1`.

Refutation evidence (all **BY EXECUTION**):

1. A “skipped” file run **alone** still skips — it is not starved by a sibling crash:
   ```
   $ DATABASE_URL=… node --import tsx --test server/content/creation.dbtest.ts
   ﹣ creation intelligence (db) (0.16ms) # SKIP
   ℹ tests 0  ℹ suites 1   EXIT=0
   ```
2. Skip durations are ~0.16 ms — the suites never execute (a registration-time `describe.skip`), not a
   post-crash cancellation.
3. In the full run the import crash at `legacyOwnerIsolation` does **not** stop the runner: files after it
   (`research engine`, `migration chain`, `research providers`, `story domain`, `YouTube OAuth`) still load
   and run. Node’s runner continues past a file-level load error.

The import crash is a **separate, real defect** (it is one of the fails), but it is **not** the cause of the
coverage hole.

### 1.3 The corpus when the environment is correct

**BY EXECUTION** — with `TEST_DATABASE_URL` also set (the name the suites actually read):

```
ℹ tests 364   ℹ suites 44   ℹ pass 349   ℹ fail 10   ℹ cancelled 5   ℹ duration_ms 188898
```

### 1.4 Verdict — can `npm run test:db` be trusted?

**No.** As invoked with `DATABASE_URL` it runs **5 / 364 cases (~1.4 %)** and reports a near-green summary
(4 pass, 1 fail) while 37 suites silently skip. Even under the correct env the suite is **red**
(10 fail / 5 cancelled). A green `test:db` therefore proves almost nothing, and a red one can be produced
by an unrelated skipped suite. It is **not currently a usable CI signal** — and note **no CI workflow runs
it at all** (`grep test:db .github` → ∅; `.github/workflows/{e2e,migration-guard,deploy,prod-migrate}.yml`).

### 1.5 Cheapest correct fix (NOT applied)

Three one-line-class changes; none applied:

1. **Unify the connection variable.** Either add `export TEST_DATABASE_URL="${TEST_DATABASE_URL:-$DATABASE_URL}";`
   to the `test:db` script (one shell line, covers both `node` invocations), or — better — have the 38 suites
   read the existing shared resolver `testDatabaseUrl()` (`server/testing/testIsolation.ts:37`, which already
   returns `TEST_DATABASE_URL || DATABASE_URL`). This alone takes the run from 5 → 364 cases.
2. **Provide the AI placeholder to the test process.** Add `CONTENTFORGE_E2E_SERVER=1` (or `CI=true`) to the
   `test:db` env — exactly what `server/ai/config.ts:17-21` is designed for — fixing `legacyOwnerIsolation`
   (import crash) and `ownerIsolation` (its `before()` calls `createDefaultContentRouter`, which imports
   `ai/config` and throws).
3. **Pin `ENCRYPTION_KEY` in the same process as the tests.** `script/test-db-guard.ts` calls
   `pinTestEncryptionKey()` in its own `node` invocation, so the pin **does not propagate** to the `&& … node
   --test …` process. Move the pin into an `--import` module loaded by the test run (or export `ENCRYPTION_KEY`
   in the script env). Fixes `social/youtube.oauth.dbtest.ts`.

Also note the internal inconsistency: the guard reads `TEST_DATABASE_URL || DATABASE_URL` and will purge
`connected_accounts` when only `DATABASE_URL` is set — while the suites it guards then skip.

---

## 2. Full test matrix

| Command | Result | Verdict |
|---|---|---|
| `npm run check` (`tsc`) | exit 0 | **PASS** |
| `npm run build` | exit 0 | **PASS** (warnings: one >500 kB chunk; stale browserslist) |
| `npm run test:unit` (as scripted) | 614 tests / 172 suites · **14 files fail** at import | **FAIL — env/harness** |
| `npm run test:unit` (+ `DATABASE_URL`) | **816 pass / 0 fail** | PASS |
| `npm run test:db` (`DATABASE_URL` only) | 5 run (4 pass/1 fail); 37 skip | **coverage hole** |
| `npm run test:db` (+ `TEST_DATABASE_URL`) | 364: 349 pass / 10 fail / 5 cancelled | **FAIL** |
| full E2E serial (`npx playwright test --workers=1`) | **273 passed / 5 failed / 2 skipped** (8.4 m) | **FAIL** (5) |

> **E2E environment caveat.** The first E2E attempt (env as given) is **invalid**: the Playwright webServer’s
> `reuseExistingServer: true` (non-CI) attached to a **foreign** server on `:4804` (two stray
> `node dist/index.cjs` observed); it later died → 186 cascade failures (`ERR_CONNECTION_REFUSED`).
> The second attempt exposed why a local run needs a secret: the server **refuses to boot** with
> `Error: SESSION_SECRET must be set in production` — the harness/`vite`-free playwright config does not
> supply it (CI does: `.github/workflows/e2e.yml:43`). The valid run (#3) set a local non-production
> `SESSION_SECRET` and produced the numbers above.

### 2.1 Every non-pass, classified

| # | Test · reproduction | Class | Production impact |
|---|---|---|---|
| **U1** | `test:unit` — 14 files (`content/{adapters,authoring,automation,chat,content,distribution,instagram,publicationConfigFailure,reconcile,recurrence,repurposing,threads,youtube}.test.ts`, `story/service.test.ts`) fail with `Error: DATABASE_URL must be set` at `server/db.ts:6` when `npm run test:unit` is run without `DATABASE_URL`. | **Harness/env** | None. All 816 pass once `DATABASE_URL` is set. |
| **DB1** | `test:db` coverage hole (§1) — 37/39 suites skip; corpus 364, run 5. | **Harness defect** | None direct; **masks** real regressions (§1.4). |
| **DB2** | `legacyOwnerIsolation.dbtest.ts` + `ownerIsolation.dbtest.ts` — `Missing OpenAI credentials` (`ai/config.ts:23`), import-time and in `before()` (`content/routes.ts:2300`). | **Harness/env** | None. |
| **DB3** | `autonomy/scheduler.dbtest.ts` — `durable autonomous scheduler (db)` fails in the full run: `update or delete on table "generation_policies" violates foreign key … policy_activations.previous_policy_id` at teardown (`scheduler.dbtest.ts:230`). **Passes 23/23 in isolation.** | **Harness (inter-suite isolation)** | None. Owner-scoped teardown collides with rows left by a sibling suite. |
| **DB4** | `research/verticalSlice.dbtest.ts` ×4 — `SyntaxError: Unexpected token '<', "<!DOCTYPE"`: the create route 500s. Handler calls `requireOwnerId(req)` (`research/routes.ts:127`); the test’s minimal Express app supplies **no owner**, `postJob` sends only `content-type`, so it throws and Express’s default handler returns an HTML error page. | **Stale spec** | None — the route correctly enforces owner identity; the test predates owner-scoping. |
| **DB5** | `research/migration.dbtest.ts` ×2 — `32 !== 31` (“all thirty-one migrations recorded”). The tree ships **32** migrations (`0000_init` … `0031_discovery_settings_ownership`; `migrations/meta/_journal.json` has 32 entries). | **Stale spec** | None. Test hard-codes a migration count. |
| **DB6** | `social/youtube.oauth.dbtest.ts` ×2 — `Error: ENCRYPTION_KEY or SESSION_SECRET must be set to encrypt secrets at rest` (`middleware/crypto.ts:39`). The guard’s `pinTestEncryptionKey()` runs in a different process. | **Harness/env** | None. |
| **DB7** | `content/visualPublication.dbtest.ts` — `idempotency: concurrent duplicate delivery … 3 !== 1`. **Deterministic: 3/3 runs, always `3 !== 1`** (not a flake). The three concurrent `runPublication` calls all return `status:"published"`; a delivery that observes the winner’s committed `state:"published"` returns the documented no-op `{status:"published", reused:true}` (`content/publication.ts:159`), which the test counts as “actually published”. The lease SQL (`DatabaseContentStorage.acquirePublicationLease`, `content/storage.ts:1638`) is a correctly-guarded conditional UPDATE; the one-Result guarantee is independently verified and passes (`content.dbtest` “keeps exactly one Result per Publication”, `distribution.dbtest` “uniqueness is the arbiter under concurrency”, `reconcile.dbtest` “two reconciliation passes … exactly one final outcome”). | **Stale spec / harness** | None on data integrity. Registrar calls this “T9 … flake” — **refuted** (deterministic). |
| **E1** | E2E `agent-publish.e2e.spec.ts:3` — needs the live research pipeline/fixture backend; times out (3 m). | **Environment** (documented T5) | None. |
| **E2** | E2E `destructive-actions.e2e.spec.ts:9` — “deleting an idea requires confirmation” (legacy `/ideas`). | **Stale spec** (documented T3) | None. |
| **E3** | E2E `error-states.e2e.spec.ts:20` — Discover forced-500 premise obsolete. | **Stale spec** (documented T4) | None. |
| **E4** | E2E `settings-labels.e2e.spec.ts:63` and `:126` — wait for `button-connect-threads`, 60 s timeout. `security-secret-exposure.e2e.spec.ts` (`:62`) runs **earlier** and does `POST /api/accounts/connect {platform:"threads"}` for the **shared** `storageState` user, so the card renders “Reconnect”, not “Connect”. **In isolation the whole spec passes 5/5.** | **Harness (cross-spec shared state)** | None. |

No non-pass was recorded as a flake: every one reproduced deterministically (DB7 explicitly 3/3).

---

## 3. Performance — measured

**BY MEASUREMENT** — `npm run build` (Vite 7.3.0, 2995 modules), `dist/public/index.html` →
`<script src="/assets/index-B1ifRCER.js">`.

| Metric | Baseline claim | Measured | Verdict |
|---|---|---|---|
| Initial JS entry | `1,792,007 B → ~362 KB` | **`index-B1ifRCER.js` = 362,582 B** (gzip 118.66 kB) | **HOLDS** |
| Route chunks | 8 | **8** lazy pages (`App.tsx:30-37`: today, create, sources, agent, schedule, insights, settings, youtube) | **HOLDS** |
| Chunk > 500 kB (Vite warning) | — | **`create-CVgEwmee.js` = 647.56 kB** (gzip 196.94). `insights-D4NgYSCM.js` = 497.17 kB is just under. | **1 chunk over** |

CSS `index-9ZB74z3T.css` = 111.93 kB (gzip 17.75). Server bundle `dist/index.cjs` = 4.1 MB.

### 3.1 First-load requests (BY EXECUTION — Playwright against a locally-booted prod bundle on :4806)

| Route | API calls on first load |
|---|---|
| `/today` | `/api/auth/me`, `/api/artifacts?limit=30`, `/api/agent/runs?limit=10`, **`/api/publications?limit=30`**, **`/api/publications?state=failed&limit=50`**, `/api/schedule-occurrences?…`, `/api/posts/queue/today` — **7** |
| `/insights` (performance) | `/api/auth/me`, `/api/analytics/summary`, `/api/analytics/insights`, `/api/learning/summary` — **4** |
| `/insights?view=learning` | `auth/me`, `autonomy/status`, `autonomy/decisions`, `style/profiles`, `learning/summary`, `learning/proposals`, `learning/observations`, `experiments`, `policy-candidates`, `policy-candidates/activated-ids` — **10** |

- **No duplicate identical requests; no request waterfall between data calls.** All API calls for a route
  fire in parallel.
- **One overlapping/redundant pair on `/today`:** two requests to **`/api/publications`** (`limit=30` and
  `state=failed&limit=50`). Distinct query keys → React Query issues both; the failed feed largely overlaps
  the first 30. Candidate for consolidation; not a duplicate fetch.
- **CSRF is *not* a first-load waterfall.** No `/api/csrf-token` is requested on load — the default query fn
  (`client/src/lib/queryClient.ts:66`) uses plain `fetch`; CSRF is added only by `apiRequest` (mutations).
- **Real waterfall is JS→data:** the API calls begin only after the lazy route chunk loads (entry 362.6 kB →
  route chunk). There is no server-side prefetch/SSR. `staleTime: Infinity`, `refetchInterval: false` are the
  defaults (`queryClient.ts:83-84`); 7 components opt into polling (`refetchInterval`) — the deferred M7 item.

---

## 4. Findings reconciliation (against **d60e55e**)

Register used: **`docs/phase-33.6-findings-reconciliation.md`** (base `d4a3760`, **199 findings**, identifier
families `SEC-*`, `TEN-*`, `UX-01…41`, `29.x-*`, phase-30/31/33 rows, `T1…T10`, design `O/P/group` rows).
Every prior status was re-checked against the current tree; the rows whose status the 33.7 work could change
are listed. Rows not listed were re-confirmed unchanged by spot-check and are **not dropped**.

**Status changes found:**

| ID | Was | Now | Evidence (current tree) |
|---|---|---|---|
| **SEC-02 / 33.5-B1** `discovery_settings` ownerless | **BLOCKER** | **FIXED** | `shared/schema.ts:313-323` adds `user_id` + `uniqueIndex`; `migrations/0031_discovery_settings_ownership.sql` backfills fail-closed; live DB columns now include `user_id`. |
| **33.5-B2a** dialog focus not restored | **BLOCKER** | **FIXED** | `client/src/components/ui/dialog.tsx` `useRestoreFocusToOpener`/`onCloseAutoFocus`; `e2e/dialog-focus.e2e.spec.ts` **passed** in the valid E2E run. |
| **33.5-B2b** 12 `/settings` labels unassociated | **BLOCKER** | **FIXED** | `settings.tsx:565-698` now use `htmlFor`+`id` (`textarea-brand-voice` … `input-connect-token`); aggregate e2e passes; spec 5/5 in isolation. (The 2 connect-dialog e2e tests fail **only** in the full serial run via §2 E4 shared state — not re-opened as a product defect.) |
| **33.5-B2c** Calendar contrast | **BLOCKER** | **FIXED** | `calendar.tsx:284-300` — `opacity-40` removed, de-emphasis via `text-muted-foreground`; `e2e/calendar-contrast.e2e.spec.ts` **passed** (light+dark). |
| **33.7 human-activation** `activated-ids` 400 | (new) | **FIXED** | `server/index.ts:254-262` mounts the activation router before the candidate CRUD catch-all; live probe shows `/api/policy-candidates/activated-ids` served; `e2e/policy-activation-routing.e2e.spec.ts` passed. |
| **33.7 db-resilience** pool has no `'error'` handler | (new) | **FIXED** | `server/db.ts:160` `pool.on("error", …)`. |
| **33.7 autonomy-timezone** | (new) | **FIXED** | `autonomyTimezone.dbtest.ts` passes inside the full 364-case run. |
| **Test-isolation defect** (shared DB poisons itself) | **NON-BLOCKING (open)** | **PARTIALLY FIXED** | Guard + pinned key + owner-scoped purge exist (`script/test-db-guard.ts`, `server/testing/testIsolation.ts`) — but the **pin does not reach the test process** (DB6) and the **coverage hole stands** (DB1). |
| **T2** `legacyOwnerIsolation` throws without `OPENAI_API_KEY` | NON-BLOCKING (env) | **NOT FIXED (still reproduces)** | DB2 above. |
| **T1** `threads.test.ts` failures | NON-BLOCKING (env) | **NOT REPRODUCED with `DATABASE_URL`** (part of 816/816). | |
| **T9** `visualPublication.dbtest.ts` lease race “flake” | NON-BLOCKING (flake) | **RECLASSIFIED** | Deterministic **3/3** and is a **status-contract mismatch**, not a flake (DB7). |
| **T3 / T4 / T5 / T6** stale/env E2E | DEFERRED | **CONFIRMED** | E1/E2/E3 reproduce; T6 skip reproduced (api `youtube/generate-post` skipped). |

**Unchanged (spot-checked):** `H1` route splitting FIXED (`App.tsx` lazy = 8); `O8` (`!`-successes = 0);
`O6`, `A1`, `D1`, `M4`/`P4-1` (settings token masking) FIXED; `M7`/`P2-5` pollers DEFERRED (7 `refetchInterval`);
`33.3-G` `/create` chunk >500 kB **NON-BLOCKING/open** (still true — §3). No new engineering defect found
beyond those classified in §2.

**NOT APPLICABLE — identifiers that do not exist in the repo** (carried forward from the register §12, re-swept):
`QA-02` · `A11Y-*` · `DES-*` · `DLQ-01` · `PERF-01` · `ENG-01` · `UX-F03` · **Phase 32** (no `docs/phase-32*`
document exists). Recorded, not mapped to an invented finding.

---

## 5. Don't-build check — PASS (no scope expansion)

| Prohibited | Evidence (BY READING) | Verdict |
|---|---|---|
| Second queue engine | only `pg-boss` in `package.json`; no bull/bullmq/agenda/kue/temporal/kafka/rabbit | **clean** |
| Second workflow engine | none | **clean** |
| Second design system | Radix + Tailwind + tokens only; no antd/mui/chakra/mantine/heroui/bootstrap | **clean** |
| Native/desktop app | no react-native/expo/capacitor/electron/tauri; no `ios`/`android`/`expo` dirs | **clean** |
| Auto-DM / auto-reply | channels are public-publish only; the only “message” routes are the app’s own chat UI (`/api/chat/message`, `/api/conversations/:id/messages`) | **clean** |
| RL / bandits | no `thompson`/`epsilon-greedy`/`ucb`/`multi-armed`/`reinforcement`/`bandit` in `server` | **clean** |
| Autonomous experiment creation / self-modification | `createExperiment` is reachable **only** from the authenticated HTTP route (`experimentation/routes.ts:147` ← `http.ts`); the autonomy controller/reconcile path never creates experiments or mutates policies — activation stays behind the human gate (`policyActivation`) | **clean** |

---

## 6. BLOCKER

**None attributable to product code.** Every red result in §2 classifies as harness/env, stale spec, or
cross-spec shared state — none is a production defect. The single most consequential integrity problem is
**the `npm run test:db` coverage hole (DB1 / §1)**: the DB gate executes ~1.4 % of its corpus and is not in
CI, so it cannot currently gate a release. The 33.6 register’s four open **BLOCKERs** are all now **FIXED**
(§4).

## 7. Raw evidence

```
$COMMANDCODE_SCRATCHPAD/testdb-raw.txt     # DATABASE_URL-only run
$COMMANDCODE_SCRATCHPAD/testdb-correct.txt # TEST_DATABASE_URL run (364 cases)
$COMMANDCODE_SCRATCHPAD/check.txt  build.txt  unit.txt  unit-with-db.txt
$COMMANDCODE_SCRATCHPAD/e2e.txt    # attempt 1 — INVALID (foreign :4804 server, 186 cascade)
$COMMANDCODE_SCRATCHPAD/e2e2.txt   # attempt 2 — server refused boot (SESSION_SECRET)
$COMMANDCODE_SCRATCHPAD/e2e3.txt   # attempt 3 — VALID (273 pass / 5 fail / 2 skip)
$COMMANDCODE_SCRATCHPAD/sched-alone.txt    # scheduler 23/23 in isolation
```
