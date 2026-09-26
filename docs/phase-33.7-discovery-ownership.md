# Phase 33.7 — `discovery_settings` ownership

**Branch:** `phase-33.7-discovery-ownership` (from `main` @ `63d6158`)
**Scope:** the `discovery_settings` tenancy defect only.
**Verdict:** fixed, with a fail-closed backfill migration. Cross-owner read/write
is closed; the existing singleton row is attributed only when the target
database has exactly one user, otherwise the migration aborts.

---

## 1. Defect

`discovery_settings` was a global singleton with **no owner column**. Every
authenticated user resolved to the same row (`id: 1`), so owner B could read —
and overwrite — owner A's discovery keywords.

### Every read/write path (pre-fix `file:line`)

| Path | Location | Behaviour |
|---|---|---|
| Table definition | `shared/schema.ts:309` (`discoverySettings = pgTable("discovery_settings", …)`) | no `user_id` column |
| Read (storage) | `server/storage.ts:492` `getDiscoverySettings()` | `db.select().from(discoverySettings).limit(1)` — **unscoped** |
| Create-on-miss (storage) | `server/storage.ts:495` | `db.insert(discoverySettings).values({})` — no owner |
| Write (storage) | `server/storage.ts:499` `updateDiscoverySettings(settings)` | `.where(eq(discoverySettings.id, existing.id))` — writes whatever the unscoped read returned |
| Read (route) | `server/routes.ts:2183` `GET /api/discover/settings` | `storage.getDiscoverySettings()` — no owner passed |
| Write (route) | `server/routes.ts:2188` `PUT /api/discover/settings` | `storage.updateDiscoverySettings(req.body)` — no owner passed |

### Live reproduction (pre-fix build)

Two owners registered over HTTP against the **unfixed** server; A writes private
keywords, B reads/writes them:

```
owner A PUT  -> status 200 row id=1 keywords=["OWNER_A_PRIVATE"]
owner B GET  -> status 200 row id=1 keywords=["OWNER_A_PRIVATE"]   <-- A's data leaked to B
owner B PUT  -> status 200 row id=1 keywords=["OWNER_B_OVERWROTE"] <-- B overwrote A
owner A GET  -> status 200 row id=1 keywords=["OWNER_B_OVERWROTE"] <-- A now sees B's value
same row for both owners: true
CROSS-OWNER READ LEAK:   true
CROSS-OWNER OVERWRITE:   true
DEFECT REPRODUCED
```

---

## 2. Fix

Scoped with the **existing** `forUser` / `requireOwnerId` primitives
(`server/middleware/userContext.ts`) — no new tenancy abstraction.

- **`shared/schema.ts:313`** — `userId: integer("user_id").notNull()` plus a
  one-row-per-owner unique index `discovery_settings_user_id_uq`.
- **`server/storage.ts:497`** — `getDiscoverySettings(userId)` reads
  `.where(forUser(discoverySettings, userId))` and creates the row **for the
  caller**. `updateDiscoverySettings(userId, settings)` scopes both the
  `WHERE` (`id = existing.id AND user_id = userId`) and strips `id`/`userId`
  from the body so a client cannot re-attribute or re-key the row.
- **`server/routes.ts:2186`** — `GET`/`PUT /api/discover/settings` pass
  `requireOwnerId(req)`; the `/api` authGate rejects anonymous requests first.

Post-fix manual check (same script, fixed build):

```
owner A PUT  -> row id=1 userId=1 keywords=["OWNER_A_PRIVATE"]
owner B GET  -> row id=2 userId=2 keywords=[]            <-- B has its own row
owner B PUT  -> row id=2 keywords=["OWNER_B_OVERWROTE"]
owner A GET  -> row id=1 keywords=["OWNER_A_PRIVATE"]    <-- untouched
DEFECT NOT REPRODUCED
```

---

## 3. Migration — `migrations/0031_discovery_settings_ownership.sql`

1. `ALTER TABLE discovery_settings ADD COLUMN user_id integer` (nullable first).
2. **Fail-closed `DO` guard + backfill:**
   - `0` settings rows → fresh install, nothing to attribute, proceed;
   - `> 1` settings rows → abort (not the expected singleton shape);
   - `settings rows == 1` but `users != 1` → **abort** — never assign
     arbitrarily, orphan, or delete;
   - exactly one user → set `user_id` to that user.
3. `SET NOT NULL`, then the unique index.

Drizzle wraps every pending migration in a single transaction, so an abort rolls
back the `ADD COLUMN` too — the database is left exactly as it was.

A journal entry (`migrations/meta/_journal.json`, `idx: 31`) was added so the
runtime `migrate()` (used at server startup, `server/index.ts:175`) applies it.
Confirmed: after a fresh boot the database reports **32** applied migrations and
`discovery_settings.user_id` is `NOT NULL` with index
`discovery_settings_user_id_uq` present.

> Note: `drizzle-kit generate` is broken in this repo by a **pre-existing**
> snapshot-id collision at `migrations/meta/0016..0019_snapshot.json` (and
> snapshots stop at `0021` while the journal runs to `0030`). This predates this
> phase; the migration was authored by hand to match the recent
> journal-only convention (`0022`–`0030` have no snapshots either).

---

## 4. Fail-closed evidence (fresh database `cf_337_fresh`)

Applied committed migrations `0000`–`0030`, seeded a singleton settings row, then
ran `0031` in a single transaction:

**Scenario A — exactly one user → succeeds, singleton preserved and attributed**

```
sole user id   = 1
row before     = {keep_me}
0031 result    = SUCCESS
user_id column = 1
row owner      = 1
row payload    = {keep_me}
SCENARIO A: PASS
```

**Scenario B — multiple users → aborts safely, no data loss**

```
users          = 2
row before     = {keep_me}
0031 result    = ABORTED
guard message  = aborted: expected exactly one user to attribute the existing
                 settings row, found 2. Refusing to assign arbitrarily, orphan,
                 or delete.
user_id column = 0   (rolled back)
row count      = 1   (intact)
row payload    = {keep_me}
users intact   = 2
SCENARIO B: PASS
```

Also exercised: a **fresh install** (0 rows / 0 users) applies cleanly — the
guard returns early rather than aborting a brand-new database.

---

## 5. Tests — `e2e/discovery-ownership.e2e.spec.ts`

6/6 pass (`--project=chromium`, `E2E_PORT=4601`):

| Test | Asserts |
|---|---|
| cross-owner read/overwrite blocked | A's keywords invisible to B; B's write leaves A's row/id untouched; distinct row ids |
| spoofed `userId`/`id` | body cannot re-attribute the row — owner/id stay A's |
| anonymous | `GET` and `PUT /api/discover/settings` → **401** |
| migration Scenario A | one user → succeeds, row attributed, payload preserved |
| migration Scenario B | multiple users → throws `expected exactly one user`; no column, row and users intact (rollback) |

The migration tests run in an isolated throwaway schema (`cf337_discovery_mig`)
on the same database, so they never touch `public`.

> Harness note: inside one Playwright worker, two `request.newContext()`
> instances collapsed to a single cookie jar (both ended up authenticated as the
> second registrant), which masked the bug. The spec therefore uses global
> `fetch` with an explicit per-owner `Cookie` header taken from each
> registration response.

---

## 6. Not touched

- The 319-user shared `contentforge_e2e` database was **never** used as a
  backfill source and was read-only by this phase.
- `server/index.ts` shows an unrelated uncommitted working-tree change from a
  concurrent session and is deliberately excluded from this commit.
