# Phase 33.7 — Autonomy time semantics (date / window / budget / cooldown)

**Scope:** `server/content/autonomy/` date, window, budget and cooldown
calculations only. **Worktree:** `/Users/kishore/git/cf-design/337tz` (branch
`phase-33.7-autonomy-timezone`, from `main` @ `63d6158`).
**Env:** `DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`,
`E2E_PORT=4606`. Local Postgres session default `TimeZone` is `Asia/Kolkata`;
the Node process is also `Asia/Kolkata` (offset −330) on this machine.

No change to `server/content/policyActivation/routes.ts`, `server/index.ts` or
`server/db.ts`.

---

## 1. The exact timezone dependency

The controller's gates mixed **two different time frames**:

1. **Storage frame (database session).** Every model timestamp is a PostgreSQL
   `timestamp WITHOUT time zone` with default `CURRENT_TIMESTAMP`
   (`shared/schema.ts`, e.g. `policy_activations.created_at`, line 2269). A
   `timestamptz` cast to `timestamp` uses the **session** `TimeZone`, so the
   column stores **session-local wall clock**.
2. **Read frame (Node driver).** `pg-types`' `parseTimestamp` (OID 1114)
   *appends `Z`* and parses the bare string as **UTC** — so a value written at
   `14:07` IST is read back as `14:07Z`, i.e. 5.5 h *in the future*.

Before the fix the cooldown gate did
`elapsedMs = Date.now() - new Date(createdAt).getTime()`. Under a non-UTC
session that produced a **negative** elapsed time, so
`cooldownElapsed(.., cooldownMinutes = 0, ..)` returned `false`, the controller
reported `COOLDOWN_ACTIVE`, and the genuine `POLICY_CHURN` /
oscillation / rollback outcomes were masked. The daily/weekly budget queries
(`gte(policyActivations.createdAt, new Date(now - N))`) had the same
frame-mixing problem (correct only while the app process zone equals the session
zone).

**Measured (this worktree, `autonomy_configs.created_at`):**

| session `TimeZone` | stored `created_at::text` | JS read-back | `Date.now() − createdAt` | DB `now() − created_at` |
|---|---|---|---|---|
| `UTC` | `2026-09-26 08:37:53` | `…T08:37:53Z` | `+2 ms` ✅ | `2 ms` |
| `Asia/Kolkata` (+05:30) | `2026-09-26 14:07:53` | `…T14:07:53Z` | `−19 799 998 ms` ❌ | `2 ms` |
| `America/New_York` (−04:00) | `2026-09-26 04:37:53` | `…T04:37:53Z` | `+14 400 001 ms` ❌ | `2 ms` |

A **positive** offset stores a wall clock *ahead* of UTC → negative elapsed →
cooldown falsely active. A **negative** offset stores a wall clock *behind* UTC
→ positive elapsed → gates accidentally pass. That is why the confirming defect
named `Asia/Kolkata` specifically.

---

## 2. Authoritative-timezone decision

**The authoritative timezone for autonomy date/window/budget/cooldown semantics
is UTC** — `AUTONOMY_TIMEZONE` in `server/content/autonomy/time.ts`.

Why UTC:

1. Autonomy windows are specified as **absolute, rolling epoch-millisecond
   windows** ("last 24 h", "last 7 d") with no calendar or timezone arithmetic
   (Phase 29.4 deep audit: *"rolling 24h/7d windows via epoch-millisecond
   comparisons"*). UTC is their natural frame.
2. The rest of the server expresses "since N" cut-offs as absolute instants
   (`new Date(Date.now() − N)`), and `toISOString()` / UTC is the app-wide
   convention.
3. In a UTC session every `timestamp` column holds UTC wall clock — the
   documented production configuration (Railway default UTC; Phase 33.6 audit).

**We did not force the whole database to UTC.** `server/db.ts` pins no session
timezone (evidence: `server/db.ts` is a bare `new Pool({ connectionString })`),
so a pool-level `SET timezone=UTC` would be an *unenforced deployment
convention*, not a code invariant. Instead the fix makes the controller
**independent of the session timezone** by evaluating every time comparison
against the **database clock in the database's own frame**:

- window counts: `created_at >= (now() - make_interval(mins => $window))::timestamp`
- cooldown: `round(extract(epoch from (now() - created_at)) * 1000)::bigint`

Both sides of each comparison are rendered by Postgres in the same session
frame, so the result is byte-identical for a `UTC`, `Asia/Kolkata` or
`America/New_York` session. The database clock (not `Date.now()`) anchors the
"now" for a server-authoritative controller. Choosing UTC is the documented
contract; being timezone-independent is the fix.

Known limit (documented, unchanged by this work): because the columns are naive
`timestamp`, the invariant holds only while **writes and reads share one session
timezone**. A deployment with mixed session timezones would need the schema
migrated to `timestamp with time zone` (out of scope here). Production is UTC.

### Determinism

Daily and weekly budgets remain **rolling durations**
(`DAILY_WINDOW_MINUTES = 1440`, `WEEKLY_WINDOW_MINUTES = 10080`) — consistent
with the existing application semantics. Duration windows are absolute and
therefore DST-agnostic; the explicit `startOfDay` / `startOfWeek`
(`AUTONOMY_TIMEZONE` = UTC, DST-correct via `Intl`) define the calendar
boundaries and are recorded on budget decisions via
`autonomyWindowBoundaries(now)` so "which day/week" is auditable.

---

## 3. Changes

| File | Change |
|---|---|
| `server/content/autonomy/time.ts` **(new)** | Authoritative-time module: `AUTONOMY_TIMEZONE = "UTC"`, `DAILY/WEEKLY/ROLLBACK_WINDOW_MINUTES`, pure injectable-`now` helpers `windowStartMs`, `withinWindow`, `cooldownElapsed`/`cooldownElapsedMs`, and DST-correct `startOfDay`/`startOfWeek`/`autonomyWindowBoundaries`. |
| `server/content/autonomy/controller.ts` | Budget counts + cooldown elapsed + rollback-oscillation window now computed in SQL in the session frame; `cooldownElapsed` re-exported from `time.ts` (back-compat). Removed the `gte(col, new Date(...))` comparisons. |
| `server/content/autonomy/time.test.ts` **(new)** | Unit tests: UTC, +05:30, −05:00, date boundary, week boundary, DST (23 h / 25 h days). |
| `server/content/autonomy/autonomyTimezone.dbtest.ts` **(new)** | Runs cooldown / churn / daily-budget / rollback scenarios under session `TimeZone` = UTC, `Asia/Kolkata`, `America/New_York`, and asserts the pre-fix JS skew vs the SQL elapsed. |

---

## 4. Results

### `autonomy.dbtest.ts` — before vs after, by session timezone

| session `TimeZone` | **before** | **after** |
|---|---|---|
| `UTC` | **20/20 pass** | **20/20 pass** |
| `Asia/Kolkata` (+05:30) | **17/20** — 3 fail (`policy churn` → got `COOLDOWN_ACTIVE`; `rollback … immutable event`; `repeated autonomous rollbacks … circuit breaker` → got `NO_PRIOR_REVISION`) | **20/20 pass** |
| `America/New_York` (−04:00) | 20/20 (offset sign hides the bug) | **20/20 pass** |

### Suites (this worktree, this machine)

| Suite | Command | Result |
|---|---|---|
| Unit/static (autonomy time/controller/scheduler + agent denial) | `NODE_ENV=test node --import tsx --test server/content/autonomy/{time,controller,scheduler}.test.ts server/agent/autonomyDenial.test.ts` | **50/50 pass** |
| Dbtests (session = system `Asia/Kolkata`) | `… --test --test-concurrency=1 server/content/autonomy/{autonomy,autonomyTimezone,scheduler}.dbtest.ts` | **56/56 pass** |
| Dbtests (session `timezone=UTC`) | as above with `TEST_DATABASE_URL="$DATABASE_URL?options=-c%20timezone%3DUTC"` | **56/56 pass** |
| `autonomyTimezone.dbtest.ts` alone | 3 zones × {cooldown, churn, daily budget, rollback} + skew proof | **13/13 pass** |
| Full server unit suite | `DATABASE_URL=… NODE_ENV=test node --import tsx --test "server/**/*.test.ts"` | **693/693 pass** |

### Reproduce

```bash
export DATABASE_URL="postgresql://e2e@127.0.0.1:5433/contentforge_e2e"
enc() { printf -- '-c timezone=%s' "$1" | sed 's/ /%20/g; s/=/ %3D/; s/ //g'; }

# before (git stash the phase-33.7 changes): UTC 20/20, Asia/Kolkata 17/20
# after:
for z in UTC Asia/Kolkata America/New_York; do
  TEST_DATABASE_URL="$DATABASE_URL?options=$(enc "$z")" NODE_ENV=test \
    node --import tsx --test --test-concurrency=1 \
    server/content/autonomy/autonomy.dbtest.ts
done
```

---

## 5. Accepted assumptions

- Windows stay rolling durations (existing product/audit semantics); no
  calendar bucketing was introduced for budgets.
- The `timestamp WITHOUT time zone` schema and `server/db.ts` are unchanged;
  the module is now correct under any single session timezone and documents UTC
  as the authoritative/expected deployment zone.
