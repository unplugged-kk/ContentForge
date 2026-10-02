# Phase 33.7 — Test isolation

**Branch:** `phase-33.7-test-isolation` (from `main` @ `63d6158`)
**Scope:** test-isolation infrastructure only. No production code, no assertions
removed, no tests disabled, no encryption checks weakened.

## Confirmed defect

`server/content/threads.test.ts` (unit) and `server/content/threads.dbtest.ts`
(db) fail deterministically on a **reused** test database with:

```
[storage] failed to decrypt accessToken: Unsupported state or unable to authenticate data
Error: Failed to decrypt stored accessToken. ENCRYPTION_KEY may have rotated.
```

Reproduced on this tree: **`test:unit` 771/774**, **`test:db` 324/352** on the
reused database vs **344/352** on a freshly migrated one — a deterministic loss,
not a flake.

## Root cause (exact chain)

1. A `connected_accounts` row (`platform = 'threads'`) left behind by an earlier
   run carries an `enc:v1:` `accessToken` encrypted under **that run's**
   `ENCRYPTION_KEY`.
2. Threads account resolution goes through the shared `storage` singleton:
   `server/social/threads.ts#getThreadsConfig` →
   `storage.getConnectedAccountForOwner("threads", ownerId)` or
   `storage.getConnectedAccount("threads")` (server/storage.ts:647–663).
3. Those return through `decryptConnectedAccount` → `safeDecrypt`
   (`server/storage.ts:50–58`), which throws
   `Failed to decrypt stored accessToken…` when the row was written under a
   different key.
4. The throw happens **before** the env-token fallback
   (`const token = account?.accessToken?.trim() || envToken`), so even with
   `THREADS_ACCESS_TOKEN` set the stale DB row wins.
5. `server/content/threads.test.ts` reaches this path because its adapter
   `publish()` calls carry no `ownerUserId`, so resolution falls back to the
   unowned global account — the pure unit test therefore reads the shared DB.

## Why the rows survive

Cleanup today is best-effort inside each suite's `after()` hook
(e.g. `threads.dbtest.ts:230` deletes `connected_accounts` where
`platform = 'threads'`). That hook is skipped whenever a run is interrupted —
crash, timeout, `SIGINT` — or when a suite aborts before it fires, and it only
covers an exiting suite that is well-behaved. Nothing guards the **entry** of a
suite, so a row left by any previous run is read before the current run has a
chance to clean it. Verified: interrupting/aborting the Threads suite leaves the
row, and the next run fails at first account lookup.

## Isolation model chosen

**Run-scoped reset of the encrypted-credential store, plus owner/platform-scoped
in-suite cleanup, with a pinned per-run encryption key.**

* `script/test-db-guard.ts` — preflight for `npm run test:db`. Pins
  `ENCRYPTION_KEY` and clears `connected_accounts` before any suite runs, so a
  row encrypted under a rotated key **structurally cannot** be read by the run.
* `server/testing/testIsolation.ts` — shared helpers: `pinTestEncryptionKey()`
  (one stable key per run), `purgeStaleConnectedAccounts({ platform, ownerIds })`
  (deterministic cleanup), and `isTestDatabaseUrl()` (refuses to touch a
  non-local, non-test database — never real credentials).
* `server/content/threads.test.ts` — pins the run key and purges the
  `platform = 'threads'` rows in a file-level `before()`, so the unit suite is
  independent of any prior run.
* `package.json#test:db` now runs the guard before the suites.

**Why this and not the alternatives**

* *Isolated database/owner per run* (fresh DB or schema + migrations, or a new
  owner id per run) is the heaviest option: it re-runs migrations (seconds) or
  rewrites every suite's owner constants, and the app's `storage` singleton is
  bound to `DATABASE_URL`, so a schema swap is not transparently isolated. It
  also does not, by itself, guarantee a consistent key.
* *Owner/platform-scoped cleanup alone* is not sufficient: the owner of a stale
  row may belong to a suite that no longer runs, or to an interrupted run, so no
  fixed owner list is complete. Scoping is used where the owner set is known
  (the Threads unit suite); the run-level guard covers the rest.
* The chosen model is O(1) — one `DELETE` on a tiny table, single-digit
  milliseconds — and makes a reused database score exactly like a fresh one.

## Encryption key consistency

`pinTestEncryptionKey()` sets `ENCRYPTION_KEY` to the canonical 32-byte test key
only when unset, so every suite process in a run uses one key while an explicit
key (CI/`SESSION_SECRET` fallback) still wins. Because the run also clears the
store first, a key mismatch with a prior run can no longer cause a failure.

## Evidence

Environment: `DATABASE_URL`/`TEST_DATABASE_URL` = the local `contentforge_e2e`,
`CI=true`, `SESSION_SECRET=…`, `ENCRYPTION_KEY=AAAA…=` (canonical key). A stale
row encrypted under a **different** key was re-inserted before **every** run
below to prove it cannot poison a new run.

| Suite | Before (reused DB, poison present) | After — 3 consecutive runs |
| --- | --- | --- |
| `npm run test:unit` | 771/774 (3 fails, all Threads / `Failed to decrypt`) | **774/774**, **774/774**, **774/774** (0 decrypt errors) |
| `npm run test:db` | 324/352 | **344/352**, **344/352**, **344/352** |

`344/352` equals the freshly-migrated baseline, and `threads.dbtest.ts`
contributes **zero** failures in all three post-fix runs. The guard logged
`cleared 1 stale connected_accounts row(s) before run` each time.

## Remaining non-passes (8, identical on fresh and reused DBs)

Unchanged by this work — all present on a freshly migrated database too, so none
is attributable to isolation of the Threads/credential path:

| Suite | Count | Classification |
| --- | --- | --- |
| `server/content/autonomy/autonomy.dbtest.ts` | 3 | **test** — stateful assertions observe pre-existing autonomy state (`COOLDOWN_ACTIVE` vs `POLICY_CHURN`, `NO_PRIOR_REVISION` vs `CIRCUIT_OPENED_OSCILLATION`). Deterministic; production impact: none (autonomy engine untouched). |
| `server/content/visualPublication.dbtest.ts` | 1 | **test** — concurrency/lease assertion ("exactly one published Result") is timing-sensitive. Production impact: none observed. |
| `server/research/verticalSlice.dbtest.ts` | 4 | **test / reproduction** — each fails with `SyntaxError: Unexpected token '<', "<!DOCTYPE"`: the harness route returns an HTML 404 instead of JSON. Endpoint reachability issue in the harness, independent of the DB; other research suites (`engine`, `providers`) pass. Production impact: none observed. |

Serial E2E (`E2E_PORT=4605`): **not affected.** The change touches only the
`test:db`/`test:unit` processes and only the local test database; no production
or runtime code was modified and the guard never runs during Playwright. The
full serial E2E was not executed here (it requires a production build and a
`webServer` on `E2E_PORT`), which is out of scope for a test-isolation change.

## Files

* `server/testing/testIsolation.ts` (new) — helpers.
* `script/test-db-guard.ts` (new) — `test:db` preflight.
* `package.json` — `test:db` runs the guard first.
* `server/content/threads.test.ts` — pin run key + `before()` purge of Threads rows.
