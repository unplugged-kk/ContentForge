# Phase 33.7 — Independent Production Audit of the Six Fixes (Auditor B)

**Audited revision:** detached worktree `/Users/kishore/git/cf-design/fa2` at
`origin/main` = `d60e55ed1dce34b98bf1f94a197c14861b70f5d2` ("fix(33.7): close six
production blockers; add audit reports").

**Method:** every claim was reproduced independently of the fix author's report —
fresh databases created for this audit (`cf_fa2_*`), the shipped production bundle
(`npm run build` → `dist/index.cjs`) run as the real server, real HTTP requests,
and, where a "before" number was asserted, the pre-fix source restored into a
throwaway copy of the tree (the audited worktree was never modified).

**Environment**

| | |
|---|---|
| `DATABASE_URL` (as given) | `postgresql://e2e@127.0.0.1:5433/contentforge_e2e` |
| Server port | `E2E_PORT=4802` |
| Build | `npm run build` → exit 0 (`dist/index.cjs`, 4.1 MB) |
| Node | v24.19.0; process TZ `Asia/Calcutta` (offset −330) |
| PG | `postgresql://e2e@127.0.0.1:5433` (PostgreSQL 16.13), session default `Asia/Kolkata` |

Databases created for this audit (never the shared `contentforge_e2e` for the
migration/reuse work): `cf_fa2_one`, `cf_fa2_two` (0031 fail-closed),
`cf_fa2_app` (server + API + isolation), `cf_fa2_tz` (autonomy timezone).

**Verdicts: 6 / 6 VERIFIED. No FALSIFIED. No PARTIAL.**

---

## 1. `discovery_settings` ownership — **VERIFIED**

Migration `migrations/0031_discovery_settings_ownership.sql` is fail-closed and the
storage/service layer is owner-scoped. Reproduced on two fresh databases built for
this audit by applying `migrations/0000..0030` then the 0031 file in a single
transaction (exactly how drizzle applies it).

**Scenario A — one user (`cf_fa2_one`):** seeded 1 user + the ownerless singleton
row (`custom_keywords = {ownerA-secret-kw,baz}`), then ran 0031.

```
psql .../cf_fa2_one -v ON_ERROR_STOP=1 --single-transaction -f migrations/0031_discovery_settings_ownership.sql
  ALTER TABLE / DO / ALTER TABLE / CREATE INDEX   → exit 0
select id,user_id,custom_keywords from discovery_settings;
  1 | 1 | {ownerA-secret-kw,baz}        ← row preserved, attributed to the sole user
\d discovery_settings → user_id integer NOT NULL; UNIQUE (user_id)
```

**Scenario B — two users (`cf_fa2_two`):** seeded 2 users + the singleton row
(`custom_keywords = {pre-existing-kw}`, `monitored_x_accounts = {@acct}`), then 0031.

```
ERROR: discovery_settings ownership backfill aborted: expected exactly one user to
       attribute the existing settings row, found 2. Refusing to assign arbitrarily,
       orphan, or delete.
→ transaction rolled back: user_id column ABSENT, settings row still
  {pre-existing-kw} / {@acct}, users still 2.  No arbitrary assignment, no data loss.
```

**Cross-owner read/write (live server on `cf_fa2_app`):** registered two owners
A (id 1) and B (id 2) over the real HTTP API.

| assertion | observed |
|---|---|
| A writes `[ownerA_kw]` | 200, `{id:1,userId:1,customKeywords:["ownerA_kw…"]}` |
| B reads | 200, `{id:2,userId:2,customKeywords:[]}` — **distinct row, does not see A's keyword** |
| B writes `[ownerB_kw]` | 200 |
| A re-reads | `{id:1,userId:1,customKeywords:["ownerA_kw…"]}` — **intact, B's keyword not visible** |
| A spoofs `{userId:B, id:B}` in body | 200, stays `userId:1/id:1`; B's row untouched |
| anonymous GET / PUT | 401 / 401 |

Cross-owner read **and** overwrite are both blocked; the blind spot (every owner
resolving to row id 1) is gone.

## 2. Human activation routing — **VERIFIED**

Mount order corrected in `server/index.ts` (activation router before the CRUD
router whose catch-all `GET /:id` shadowed the literal route). Reproduced at the
real HTTP boundary against the running server:

| request | observed |
|---|---|
| `GET /api/policy-candidates/activated-ids` | **200** `{"activatedCandidateIds":[],"activatedCandidateActors":{}}` — shape only the activation router emits (pre-fix: 400 `Invalid candidate id`) |
| real candidate (created via `POST /api/experiments` → `POST /api/experiments/:id/policy-candidate`, id 1) `GET /api/policy-candidates/1` | **200**, the candidate |
| `GET /api/policy-candidates/999999999` | **404** `Policy candidate not found` |
| `GET /api/policy-candidates/not-a-number` | 400 (still the `:id` catch-all's own behaviour — unchanged) |
| anonymous `GET …/activated-ids` | 401 |

Learning UI: `e2e/policy-activation-routing.e2e.spec.ts` run against the live server
(the spec deliberately leaves `/activated-ids` **un-stubbed**) → **6/6 passed**,
including "Governance queue renders **Activate** (no ErrorState) when the live
/activated-ids returns 200" and "an activated candidate shows **Roll Back**". The
activation-state `ErrorState` ("Couldn't load activation state") is absent.

## 3. DB pool resilience — **VERIFIED**

`server/db.ts` now registers `pool.on("error", …)`. Reproduced against the live
server (pid from `dist/index.cjs`, started on `cf_fa2_app`):

```
-- killed the server's idle-in-pool backends
select pg_terminate_backend(pid) from pg_stat_activity
  where datname='cf_fa2_app' and state='idle' and pid<>pg_backend_pid();
→ 12 backends terminated
```

Observed:

* 12 server log lines `[db] recoverable pool error (connection lost, pool will
  reconnect): code=57P01 severity=FATAL terminating connection due to administrator command`
* process **stayed alive** — same PID, `/api/health` → 200 immediately after
* pool **reconnected**: `POST /api/auth/register` → 200 after the kill, and new
  `idle` backends reappeared in `pg_stat_activity`
* **no** `Unhandled 'error' event` and no process exit.

Genuine startup/config failures still fail loudly (each on a clean port):

| case | observed |
|---|---|
| `DATABASE_URL` unset | exit 1 — `Error: DATABASE_URL must be set` (server/db.ts) |
| nonexistent role | exit 1 — `error: role "nosuchrole" does not exist` `code: '28000'` |
| nonexistent database | exit 1 — `error: database "no_such_db_xyz" does not exist` `code: '3D000'` |

(Note: the local Postgres cluster accepts a wrong password (`trust`), so "wrong
password" is not a usable failure case here; the two above are.)

## 4. Calendar contrast — **VERIFIED**

Re-measured independently with Playwright against the running server (fixed clock
June 2026, both themes), compositing fg/bg up the ancestor chain and reading the
real computed styles of `[data-testid="text-calendar-day"]`:

| element | theme | measured | claimed |
|---|---|---|---|
| adjacent-month numeral | light | **7.00** (`rgb(89,89,89)` on `rgb(255,255,255)`), opacity **1** | 7.00 |
| adjacent-month numeral | dark | **7.57** (`rgb(166,166,166)` on `rgb(20,20,20)`), opacity **1** | 7.57 |
| today numeral | dark | **15.55** (`rgb(242,242,242)` on `rgb(26,26,26)`) | 15.55 |
| today numeral | light | 17.18 | — |
| in-month worst | light / dark | 17.18 / 15.55 | — |

The "before" numbers were reproduced independently (no cell is dimmed by opacity
now, so they cannot be read off the DOM): from the theme variables
(`--muted-foreground: 0 0% 35%` light / `0 0% 65%` dark, `--background` 100% / 8%,
`--primary: 217 91% 48%`, `--card` 10%) plus the old `opacity-40`:
light adjacent **1.886→1.89**, dark adjacent **2.229→2.23**, dark today **3.213→3.21**
— all three match the claimed pre-fix values.

Axe run with the **full rule set** (no rule exclusions) on the Calendar tab:
**0 violations** in both light and dark (`e2e/calendar-contrast.e2e.spec.ts` →
5/5 passed). Side-note claim checked: `text-primary` literal appears **83×** in
`client/src` (reported "82"), i.e. the dark `--primary`-as-text exposure is real and
was reported, not fixed.

## 5. Autonomy timezone — **VERIFIED**

Ran the 20-test DB suite `server/content/autonomy/autonomy.dbtest.ts` under a UTC and
a non-UTC database session (`TEST_DATABASE_URL="…/cf_fa2_tz?options=-c%20timezone%3D…"`):

| session `TimeZone` | **pre-fix** (`b34c357^` controller, restored in a throwaway copy) | **post-fix** (origin/main) |
|---|---|---|
| `UTC` | 20/20 | **20/20** |
| `Asia/Kolkata` (+05:30) | **17/20** — fails: *policy churn*, *rollback … immutable event*, *repeated autonomous rollbacks … circuit breaker* | **20/20** |
| `America/New_York` (−04:00) | 20/20 | 20/20 |

The claimed "Asia/Kolkata 17/20 → 20/20" reproduces exactly, failure set included.
Machine check: node process TZ `Asia/Calcutta`; the cluster's default session TZ is
`Asia/Kolkata`; both `UTC` and `Asia/Kolkata` boots confirmed via
`current_setting('TimeZone')`.

## 6. Test isolation — **VERIFIED**

Poisoned the reused database with exactly the failure mode described: a
`connected_accounts` row for `platform='threads'` whose `access_token` is
`enc:v1:…` under a **foreign** AES-256-GCM key (a stand-in for "a prior run's key").

| run | result |
|---|---|
| **pre-fix** tree (`b07d148^` `threads.test.ts`, no guard) vs poisoned DB | **7/10** — 3 fail with `Failed to decrypt stored accessToken. ENCRYPTION_KEY may have rotated.` |
| **origin/main** tree vs the *same* poisoned DB | **10/10**, and the row is gone (purge in `before()` → `count=0`) |
| `test:db` preflight guard on a re-poisoned DB | `[test-db-guard] cleared 1 stale connected_accounts row(s) before run` |

`npm run test:unit` × 3 (reused DB, `DATABASE_URL=…/cf_fa2_app`):

```
run 1: tests 816 | suites 221 | pass 816 | fail 0
run 2: tests 816 | suites 221 | pass 816 | fail 0
run 3: tests 816 | suites 221 | pass 816 | fail 0
```

Documentation nit (not functional): the commit body says "test:unit 774/774 x3"
while the same message's integrated-tree line says "unit 816/816"; the measured
number is **816/816**, matching the integrated-tree line.

---

## Summary

| # | Fix | Verdict |
|---|---|---|
| 1 | `discovery_settings` ownership + fail-closed 0031 | VERIFIED |
| 2 | Human activation routing (`activated-ids`) + Learning UI | VERIFIED |
| 3 | DB pool `'error'` resilience (57P01) + loud startup failures | VERIFIED |
| 4 | Calendar contrast (both themes) + axe full rule set | VERIFIED |
| 5 | Autonomy timezone (UTC & Asia/Kolkata) | VERIFIED |
| 6 | Test isolation (poisoned `connected_accounts`) | VERIFIED |

No claim was falsified. The only defects found were two non-functional
inconsistencies in the fix commit's own description: the `test:unit` count is
quoted as both 774 and 816 (measured 816), and the "82 places" using dark
`--primary` as text is 83.
