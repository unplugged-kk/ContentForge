# Phase 33.7 — PostgreSQL pool error handling

**Date:** 2026-09-26
**Base:** `main` @ `63d6158`
**Branch:** `phase-33.7-db-resilience`
**Scope:** Postgres pool error handling only. Files owned/changed: `server/db.ts`,
`server/db.pool.test.ts` (new), this report.
**Defect:** CRITICAL — an idle-client pool error kills the whole server process.

---

## 1. Defect and root cause

`server/db.ts:9` created the pool with **no `'error'` listener**:

```ts
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

`pg.Pool` extends `EventEmitter` and forwards an *idle* client's error verbatim
(`pg-pool/index.js` → `client.on('error', idleListener)`). With no listener,
Node's default behaviour for an `'error'` event applies — it is rethrown. A
backend that PostgreSQL terminates (admin command, `57P01`) therefore produced:

```
Unhandled 'error' event on BoundPool instance
  error: terminating connection due to administrator command
    code: '57P01', severity: 'FATAL', routine: 'ProcessInterrupts'
```

and terminated the process. This is not theoretical: it was observed live, and
is exactly reproducible (below).

The pool is the process-wide data path (`server/index.ts` imports it, builds the
session store on it, and runs `migrate(db, …)` through it), so this is a
single-point-of-failure crash.

---

## 2. Reproduction

**Live, standalone** — a `pg.Pool` configured exactly like `server/db.ts:9` (no
listener), whose idle backend is terminated from another session:

```
$ DATABASE_URL=… node repro.mjs
victim backend pid 14919
terminated; waiting for idle-client error...
# exit code 1 ↓
node:events:487
      throw er; // Unhandled 'error' event
      ^
error: terminating connection due to administrator command
    at Client._handleErrorMessage (…/pg/lib/client.js:433:12)
Emitted 'error' event on BoundPool instance at:
    at Client.idleListener (…/pg-pool/index.js:62:10)
  { severity: 'FATAL', code: '57P01', routine: 'ProcessInterrupts' }
```

The backend is terminated exactly as an administrator command does, from a
separate connection:

```sql
SELECT pg_terminate_backend($1);   -- $1 = the idle client's pg_backend_pid()
```

**In the regression test** the same mechanism is pinned two ways: a control
child process using a bare `pg.Pool` with no `'error'` listener must die with
`Unhandled 'error' event` (fails pre-fix), and a child importing the real
`server/db.ts` must survive the same recoverable error (fails pre-fix, passes
now).

---

## 3. Fix

A single listener, added in `server/db.ts` immediately after the pool is
created (module scope is synchronous, so nothing can emit before it is
attached). No new abstraction, connection layer, or pool factory was added —
`new Pool({ connectionString })` is unchanged.

```ts
pool.on("error", (error) => {
  const summary = describePoolError(error);         // credential-free
  const detail  = formatPoolError(summary);

  if (classifyPoolError(error) === "fatal") {
    console.error(`[db] fatal pool error (configuration/authorization): ${detail}`);
    const escalated = new Error(`fatal database pool error: ${detail}`); // sanitized re-throw
    if (summary.code) escalated.code = summary.code;
    setImmediate(() => { throw escalated; });        // loud, but never leaks credentials
    return;
  }
  console.error(`[db] recoverable pool error (connection lost, pool will reconnect): ${detail}`);
});
```

The listener also exports two testable helpers, `classifyPoolError` and
`redactDbCredentials` / `describePoolError`.

---

## 4. Recoverable vs fatal — how the two are distinguished

Two independent signals, both explicit:

**Signal 1 — source (authoritative).** The `'error'` event is raised by
pg-pool's `idleListener`, i.e. **only for clients that were idle in an
already-established pool**. It can therefore only describe a connection that was
previously working and has since been lost — by construction a post-startup,
recoverable event. Genuine startup/configuration failures never travel this
path: they surface as the rejection of the first *awaited* connection attempt
(`server/index.ts` runs `await pool.query(…)` and `await migrate(db, …)` during
bootstrap), which fails the boot loudly on its own. They remain fatal and
visible.

**Signal 2 — SQLSTATE / errno (defensive, inside the listener).** If a
configuration fault ever *did* reach this path, it must not be swallowed:

| Class | Codes | Verdict | Why |
|---|---|---|---|
| Configuration / authorization | `28P01` invalid_password, `28000` role missing, `3D000` database missing, `42501` insufficient_privilege | **fatal** | Not transient — a retry can never succeed |
| Transient connection | SQLSTATE classes `08` connection_exception, `53` insufficient_resources, `57` operator_intervention, `58` system_error | recoverable | Pool drops the dead client and redials |
| Socket-level | `ECONNRESET`, `ECONNABORTED`, `EPIPE`, `ETIMEDOUT`, `EPROTO`, `EHOSTUNREACH`, `ENETUNREACH`, `ENETDOWN`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN` | recoverable | Lost socket; next acquire reconnects |
| Anything unrecognised / no code | — | recoverable | An unnamed error must never take down a running server |

Fatal handling is "log, then re-raise asynchronously" so it surfaces as an
uncaught exception (stack + non-zero exit) rather than being silently absorbed.
The re-raised error is a **new sanitized** `Error` (the raw driver error's
`client.connectionParameters` is never allowed to reach the log/stack).

> Note: PostgreSQL's own `severity` field on the `57P01` message is `FATAL`.
> That is Postgres' severity, not our classification — it is logged as-is for
> operators but does **not** make the process fatal. The classifier keys on
> SQLSTATE (`57*` → recoverable).

---

## 5. Reconnection semantics (existing pg configuration unchanged)

`pg.Pool` already guarantees recovery: when an idle client dies it is removed
from the pool and a fresh backend is dialled on the next acquire. The fix does
not touch pool options, so this is preserved and now exercised by the test —
after an admin-terminated idle connection the next `pool.query("SELECT 1")`
succeeds, and a subsequent query confirms the new connection is reusable.

---

## 6. Credential safety

`redactDbCredentials()` is applied to every message before logging:
`postgresql://user:password@host` → `postgresql://[redacted]@host`,
`password=…` → `password=[redacted]`, and the configured `DATABASE_URL` is
replaced if it appears verbatim. Three tests assert no password reaches the log
or the `describePoolError` summary.

---

## 7. Evidence

**Regression test** — `server/db.pool.test.ts` (35 tests, all pass; fails
pre-fix: the listener-count assertion, the "survives" child, and the live test):

| Group | Proves |
|---|---|
| `classifyPoolError` (15) | every recoverable code → recoverable; every config code → fatal |
| `credential redaction` (3) | no password in log/summary |
| `pool 'error' listener` (3) | a listener exists (the defect); a recoverable emit neither throws nor leaks; process continues |
| `reproduction` (2) | **control**: bare `pg.Pool` dies with `Unhandled 'error' event`; **fixed**: `server/db.ts` survives |
| `startup/config` (2) | missing `DATABASE_URL` → loud import failure; a config code reaching the listener escalates (not `SWALLOWED`) |
| `live PostgreSQL` (1) | `pg_terminate_backend` on the pool's idle backend → `57P01` observed, process alive, pool reconnects |

**Live server run** — real dev server on `PORT=4603`, `NODE_ENV=development`,
`DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e`:

```
ready_before=200
app_pool_backend_pid=21217
target_exists 1 terminate_ok true
--- after termination ---
server_npm_alive=yes
health_after=200
ready_after=200
[stderr] [db] recoverable pool error (connection lost, pool will reconnect):
         code=57P01 severity=FATAL terminating connection due to administrator command
```

The server logged one recoverable line and kept serving; `/api/ready` (which
runs `SELECT 1` through the same pool) returned 200, confirming reconnection.

**Verification**

| Command | Result |
|---|---|
| `npm run check` (`tsc`) | clean |
| `node --import tsx --test server/db.pool.test.ts` | **35 passed** |
| `npm run test:unit` | **797 passed / 3 failed** of 800 |

The 3 `test:unit` failures are all in `server/content/threads.test.ts`
(Threads Graph adapter contract). They are **pre-existing and unrelated**: the
same file fails identically with `server/db.ts` stashed back to its
`main` version, and it touches no pool code.

---

## 8. Deliberately out of scope

- No new DB abstraction, pool factory, or connection layer was introduced —
  `server/db.ts` still creates exactly one `new Pool({ connectionString })`.
- Pool tuning (timeouts, `max`, keep-alive) was **not** changed; the existing
  configuration was preserved so reconnection semantics are unchanged.
- Other pools in the tree (e.g. `pg-boss`, `connect-pg-simple`) were not
  modified.
