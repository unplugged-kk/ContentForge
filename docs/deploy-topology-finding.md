# ContentForge — Phase 17 Repository Housekeeping: Deployment Topology

**Date:** 2026-09-26
**Outcome:** `origin/HEAD` corrected locally. **Deployment triggers deliberately NOT changed.**
**Action required from the captain:** one repository setting, detailed in §4.

---

## 1. What the brief asked

> If `origin/HEAD` and `deploy.yml` still point to `replit` while MAIN is now canonical: update
> them to `main`, **ONLY if the repository/deployment structure confirms this is the intended
> canonical branch**. Verify deployment configuration after the change. Do not invent
> deployment infrastructure.

Both conditions were found true — `origin/HEAD` → `refs/remotes/origin/replit`, and
`.github/workflows/deploy.yml` triggers only on `replit`. The instruction's own precondition
then had to be tested, and **it does not hold**.

---

## 2. The deployment structure does not confirm `main` as the deploy branch

| Observation | Value |
|---|---|
| `origin/HEAD` | `refs/remotes/origin/replit` |
| `deploy.yml` trigger | `branches: [replit]` → runs `railway up --detach --service ContentForge` |
| `prod-migrate.yml` trigger | `branches: [main, master, replit]` — **`main` is already included** |
| `origin/replit` tip date | **2026-09-21** (phase 30.2 era) |
| local `main` tip date | **2026-09-26** |
| `main` vs `origin/replit` | **divergent** — 35 commits only in `main`, **135 only in `origin/replit`** |
| is `ad1a0d0` (pre-design main) an ancestor of `origin/replit`? | **No** |
| is `origin/replit` an ancestor of `main`? | **No** |

`origin/replit` is not a stale mirror of `main`; it is a **separate lineage** with 135 commits
`main` has never contained — characteristic of a platform-generated history. The two branches
cannot be reconciled by pointing a trigger at one of them.

**Consequence of the change the brief contemplated:** `main` contains phases 31, 32 and 33.1 plus
the entire design programme — far ahead of the `replit` tip. Repointing `deploy.yml` at `main`
would cause **this very push** to fire a live production deployment of that much-newer code.

---

## 3. Why that deploy was not triggered autonomously

Two of the brief's own stop conditions are engaged:

1. **"production lockout risk."** The application is deliberately fail-closed: `server/ai/config.ts`
   refuses to boot without AI credentials, and `SESSION_SECRET` is fail-closed by design. `main`
   adds three phases (31, 32, 33.1) since the deployed lineage. If production is missing any
   environment variable those phases now require, the deployed app would fail its `/api/ready`
   healthcheck rather than degrade. That is a production outage, not a rollback away — it is
   caused by the deploy itself.
2. **"infrastructure access outside the repository."** The deploy step runs
   `railway up` against Railway using `RAILWAY_TOKEN`. That is external infrastructure the
   repository does not govern.

Pointing a workflow trigger at `main` is a one-line change; the *effect* is a production
deployment of three unreleased phases. Those are not the same decision, and the second one is
the captain's.

---

## 4. What was changed, and what the captain must decide

**Changed (safe, local, reversible):**

```
git remote set-head origin main     # origin/HEAD now -> refs/remotes/origin/main
```

This corrects the local symbolic ref so `origin/main` is the default comparison target. It does
**not** change GitHub's default branch; that is a repository setting.

**Deliberately not changed:** `.github/workflows/deploy.yml`.

**What the captain needs to decide — one of two coherent states:**

| Option | Action | Effect |
|---|---|---|
| **A. Promote `main`** | Change the GitHub default branch to `main` **and** set `deploy.yml` to `branches: [main]` | The next push to `main` deploys it. Before doing so, confirm every env var phases 31–33.1 require exists in Railway. |
| **B. Keep `replit` as the deploy branch** | Leave `deploy.yml` as-is; treat `main` as the integration/audit branch only | Production keeps running the older lineage. The 135-commit divergence must then be reconciled deliberately, not by a trigger change. |

Until that choice is made, **pushing `main` does not deploy** — which is the safe default.

---

## 5. One side effect the captain should know about

`prod-migrate.yml` already triggers on `main`, so **pushing `main` runs `npm run db:migrate`
against the production Postgres.**

This was assessed before pushing rather than assumed:

- **All 31 migration files contain zero destructive SQL** — no `DROP TABLE`, `DROP COLUMN`,
  `TRUNCATE`, `DELETE FROM`, or `ALTER COLUMN … DROP`. Every statement is additive
  (`CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, `CREATE INDEX`).
- Drizzle records applied migrations, so already-applied ones are skipped.

So the migration cannot destroy production data. It can, however, apply additive schema for
code that is not deployed (because deploys run from `replit`) — harmless, since older deployed
code ignores new tables and columns, but it means production schema and production code will be
temporarily out of step until the captain resolves §4.

**This trigger is pre-existing configuration, not something introduced here.**
