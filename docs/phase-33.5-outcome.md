# ContentForge — Phase 33.5 Final Blocker Remediation: Outcome

**Date:** 2026-09-26
**Base:** `main` @ `0763fcf` (== `origin/main`)
**Wave:** five parallel workers, four writers + one read-only, disjoint file ownership
**Decision:** **FINAL NO-GO**

---

## 1. Worker results

| Worker | Branch | Outcome |
|---|---|---|
| Security | `phase-33.5-security` | **committed** `b52fba1` — auth boundary certification spec |
| Discovery ownership | `phase-33.5-discovery-ownership` | **committed** `908dfdc` — leak proven + reproduced; **fix BLOCKED on a schema decision** |
| Accessibility | `phase-33.5-accessibility` | **work done, NOT committed, NOT integrated** — hit turn limit before reporting |
| Audit completeness | `phase-33.5-audit-completeness` | **incomplete** — report drafted but uncommitted |
| Test integrity | `phase-33.5-test-integrity` | **incomplete** — hit turn limit mid-investigation |

Three of five workers completed. **Nothing was merged into `main`**, because two of the three
results are unverified and the third is blocked on a decision.

---

## 2. Blocker 1 — discovery_settings cross-owner leak: CONFIRMED

The HIGH finding was **reproduced live**, not merely read:

- Two real users against the production build; both share `discovery_settings` row `id: 1`.
- A `PUT {"customKeywords": ["AONLY_9016"]}` → **B reads `AONLY_9016`** (cross-owner read).
- B `PUT {"customKeywords": ["BFROM_9016"]}` → **A reads `BFROM_9016`** (cross-owner overwrite).
- Anonymous GET/PUT already correctly return **401** — the gate is not the problem here.

**Trace:** `shared/schema.ts:309-317` (table has no `user_id`) → `server/storage.ts:114-115,
492-506` → `server/routes.ts:2183-2191`. No cache; the client never calls the endpoint; the
owner is discarded at the route and is unrecoverable downstream. The leak is total.

**Why the worker stopped instead of fixing it** — and it was right to: the table holds a single
**live singleton row**, so adding a nullable `user_id` with owner-scoped reads necessarily
orphans or reassigns existing data. That is the destructive case the brief forbade acting on
unilaterally.

**Migration required (written, NOT applied):**
```sql
ALTER TABLE "discovery_settings" ADD COLUMN "user_id" integer;
CREATE UNIQUE INDEX "discovery_settings_user_uq" ON "discovery_settings" ("user_id");
```

**Coordinator decision needed — the backfill policy.** ContentForge is a **single-operator**
product with one live row and one real user, so the honest options are:

1. **Backfill the existing singleton to the sole owner** (recommended) — preserves the live
   settings, makes the row owner-scoped, and is correct for a single-operator deployment.
2. **Fan out to all owners** — duplicates the row per user; meaningless here.
3. **Orphan it** (`user_id NULL`) — loses the operator's live settings. Rejected.

Option 1 requires knowing the sole owner's id at migration time, which is a data question, not a
code question — hence a written migration plus a documented backfill, not a blind apply.

---

## 3. Blocker 2 — accessibility: work done, unverified

The worker's own last message was "All green" for the three HIGH defects (dialog focus
restoration, 12 unlabelled `/settings` controls, Calendar contrast), with changes staged in
`client/src/components/ui/{dialog,alert-dialog,sheet}.tsx`, `client/src/pages/{settings,calendar}.tsx`
and a report. **It then hit its turn limit before committing.** So:

- The changes are **uncommitted and unverified by anyone else**.
- **Nothing was integrated.** Unverified work must not enter `main`, which is the rule this whole
  programme exists to enforce.
- The defects therefore remain **OPEN** in `main` and must be treated as such.

---

## 4. Blocker 3 — incomplete verification

`audit-completeness` (functionality, scheduler, autonomy, recovery, performance, findings
reconciliation) and `test-integrity` both failed to finish. The dimensions the previous audit
left unverified are **still unverified**, plus the test-isolation defect remains open.

This is the second wave in which long-running workers hit their turn limit — the audit and
verification tasks are simply longer than one agent run. That is a process finding worth acting
on: these should be split into smaller scopes next time.

---

## 5. What is true of `main` right now

```
main == origin/main == 0763fcf
```
- The auth-gate case bypass **is fixed** (`ea86cca`) and now additionally **certified** by an
  independent spec (`b52fba1`, not yet merged).
- `discovery_settings` cross-owner read/write is **open**.
- Three HIGH accessibility defects are **open**.
- The test-isolation defect is **open**.
- Functionality / scheduler / autonomy / recovery / performance remain **unverified** by this
  audit cycle.
- The deploy trigger is **unchanged** (`replit`), as instructed.
- The four pre-existing E2E failures remain, classified as non-blocking.

---

## 6. Decision

**FINAL NO-GO.**

Three of the four conditions required for a GO are not met: an owner-isolation blocker is
confirmed and open, critical accessibility defects are open, and the independent audit is
incomplete. The security boundary is fixed and certified on a branch but not landed.

**Minimum to reach a GO:**

1. Land the discovery fix: apply the column + index migration with the **single-owner backfill**,
   scope the storage reads/writes with the existing `forUser` pattern, and enable the two
   `fixme` cross-owner tests.
2. Land and verify the accessibility fixes, including the axe-invisible ones (role-based
   assertions, not axe alone).
3. Finish test isolation so the shared-database poisoning cannot recur.
4. Complete the functionality / scheduler / autonomy / recovery / performance audits.
5. Then run a **fresh independent audit against the resulting pushed tree** — the fixes above are
   authored by the same wave that found the problems, which is exactly the situation the audit
   rule exists to catch.
