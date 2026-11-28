# Active work

This is the register. Read it before starting, and update the row you touched before you stop. `script/agent-context.sh status` prints the table.

A row is current only when its evidence was checked. "Not reconciled" means the git facts were read and the product state was not.

Last verified: 2026-11-28.

| Workstream | Status | Owner | Next action |
|---|---|---|---|
| CF-CI CI on origin/main | Blocked | Unassigned | Fix the unit hang in `server/content/videoRepurpose.test.ts` and the five DB failures. Run 46132320299. |
| CF-PROD Productization | Merged, CI red | No active owner | Do not reopen INC-01 to INC-10. CI is CF-CI. |
| CF-M3 Founder pilot | Blocked on owner | Owner | Decide whether red CI blocks the first PILOT_RUNBOOK session. |
| CF-GOV Agent context | In progress | This session | Finish the docs, then an independent review of the claims. |
| CF-DEFER Jev, MCP, Agent Reach, billing | Deferred | Nobody | Leave them. Decision DEC-08. |
| CF-SITE Marketing site visual match | Inactive | Unassigned | Last measured 46% on 2026-11-11. Recheck only if the owner asks. |
| Video Factory | Not reconciled | Unassigned | Read `~/git/video-factory/AGENTS.md` before any edit. |
| Creative Engineering Hub | Not reconciled | Unassigned | Read that repo's AGENTS.md. Adding a catalog row is not an integration. |
| Artha | Not reconciled | Unassigned | Separate the canonical checkout from the Auth0 and beta checkouts. |
| Hermes Mission Control | Not found as a repo | Unassigned | `~/.hermes` is config, plugins, and skills. No git root. |
| AESP / Agent OS | Not found | Unassigned | No matching directory under the home folder at depth 3 on 2026-11-28. |

## CF-CI

- Objective. Unit Tests and DB Integration Tests on `origin/main` exit 0.
- Why. Pull request 7 merged with those jobs red, so `main` does not enforce the suites the productization work added.
- Status. Blocked on the failures below. No one is assigned.
- Branch. Failures are on `origin/main` at `ae8ced2`. Fix them on a new branch from that commit, not on `main`.
- Pull request. [7](https://github.com/unplugged-kk/ContentForge/pull/7), merged 2026-11-28T09:50:10Z.
- Latest commit. `ae8ced249b48b64551d8a1776bdc4cba19eb289d`.
- Done. The jobs exist in `.github/workflows/e2e.yml` and they ran.
- Remaining. Make them pass. E2E and Live E2E also failed in the same run. Treat those after unit and DB, unless one root cause covers them.
- Files. `server/content/videoRepurpose.test.ts` for the unit hang. DB failures name encryption env and a legacy NULL-owner assertion. See [`BUGS.md`](BUGS.md).
- Dependencies. None inside the repo. CI secrets for `ENCRYPTION_KEY` and `SESSION_SECRET` may be missing. That is an owner check if the workflow does not set them.
- Risk. A local `npm run test:unit` can pass while CI cancels hung tests. Do not close CF-CI on a local run alone.
- Next action. Reproduce the `videoRepurpose.test.ts` hang, then the DB encryption failures, on a branch.
- Verified. 2026-11-28, Actions run [46132320299](https://github.com/unplugged-kk/ContentForge/actions/runs/46132320299).

## CF-PROD

- Objective. Research to an approved export, with owner-scoped credentials and a repaired Drizzle snapshot chain.
- Why. That was the M1 and M2 productization milestone.
- Status. Merged. Not verified by CI.
- Owner. Wayfinder and Poteto mode during 2026-11-27. No active owner now.
- Branch. `work/productization-mvp`, merged. Tip of that branch is `2c4e17d`, parent of the merge.
- Pull request. 7.
- Latest commit. `ae8ced2`.
- Done. INC-01 through INC-10, commit `341ef67` (edit re-audit, claim prompt hint, topic escaping, legacy schedule owner, offboarding utility, style-profile index parity), security commits `203a95d` and `b762d54`, CI wiring commit `2c4e17d`.
- Remaining. CF-CI. Owner actions in [`product-discovery/STATUS.md`](product-discovery/STATUS.md) that are still open: branch protection, one restore drill, xQuick terms before live X, M3 sessions.
- Risk. [`product-discovery/PRODUCT_CURRENT_STATE.md`](product-discovery/PRODUCT_CURRENT_STATE.md) describes the pre-merge tree. Rebuilding those "missing" features would duplicate merged work.
- Next action. None on this row. Move to CF-CI.
- Verified. 2026-11-28, `git log origin/main` and `gh pr view 7`.

## CF-M3

- Objective. The founder runs the five-session export-first check in [`product-discovery/PILOT_RUNBOOK.md`](product-discovery/PILOT_RUNBOOK.md).
- Status. Blocked on the owner. Not started in this session.
- Next action. Owner decides if red CI blocks session 1.
- Verified. 2026-11-28, runbook file present. Sessions not executed.

## CF-GOV

- Objective. Any agent can see what is being built, what is done, what is current, and what not to change, without asking the owner.
- Status. In progress on `docs/agent-governance` at `ba2af6e`.
- Done. Discovery of the existing docs, git, pull request 7, and Actions. Register and status written from those records. Commit `ba2af6e`.
- Remaining. Independent review of that commit's claims. Other repositories are indexed, not edited.
- Files. `docs/STATUS.md`, `docs/ACTIVE_WORK.md`, `docs/HANDOVER.md`, `AGENTS.md`, `script/agent-context.sh`.
- Next action. Reviewer checks every status claim against `git` and the Actions run. Then mark this row done or list the misses.
- Verified. 2026-11-28.

## Other repositories

Facts only. Detail and the adopt steps are in [`PROJECTS_INDEX.md`](PROJECTS_INDEX.md). None of these trees were edited.

| Checkout | Branch | Commit | Dirty entries | Date |
|---|---|---|---|---|
| `~/git/video-factory` | `feat/p1-1-lookmap` | `849ea6a` | 2 | 2026-11-20 |
| `~/git/video-factory-phase2-foundation` | `main` | `8709b0b` | 0 | 2026-11-24 |
| `~/git/creative-engineering-hub` | `main` | `ad1e133` | 3 | 2026-11-11 |
| `~/git/artha` | `codex/beta-translations` | `ef6bfbf69` | 4 | 2026-11-18 |
| `~/git/artha-beta` | `release/personal-beta-2026-11-2x` | `15520e799` | 0 | 2026-11-22 |
| `~/git/artha-auth0` | `feat/auth0-integration` | `a4a60b351` | 3 | 2026-11-18 |
