# ContentForge status

Verified 2026-11-28 from `git` and GitHub Actions. This file is the current snapshot. If it disagrees with an older doc, trust this file for "where we are" and the older doc for history.

`script/agent-context.sh sync` prints the branch. It warns only when commits since `origin/main` change a product path and this file does not mention that commit.

## Product tip

- `origin/main` is `ae8ced249b48b64551d8a1776bdc4cba19eb289d` (2026-11-28 15:20 +0530).
- That commit is the merge of [pull request 7](https://github.com/unplugged-kk/ContentForge/pull/7), "Productize the research-to-export workflow and close the security gaps".
- The local `main` ref on this machine was still `0dca955` at discovery, 16 commits behind `origin/main`. Fast-forward it after `git fetch`. Do not reset.
- The register was introduced in `ba2af6e` on `docs/agent-governance`, from `ae8ced2`. Later commits on that branch only correct this page and the sync script. `git log origin/main..HEAD` is the docs range. No application source changed.

## Tests

Not re-run in the session that wrote this page.

| Check | Evidence | Result |
|---|---|---|
| `npm run test:unit` recorded by commit `341ef67` | that commit message | 1305 passed, 0 failed, plus a clean `tsc` and `npm run build`. Author's measurement, not repeated here. |
| Unit Tests on `ae8ced2` | [Actions run 46132320299](https://github.com/unplugged-kk/ContentForge/actions/runs/46132320299) | Failed. Reporter: 1296 pass, 0 fail, 9 cancelled, exit 1. Hung promises in `server/content/videoRepurpose.test.ts`. |
| DB Integration Tests, same run | same run | Failed. 384 pass, 5 fail. Failures include missing `ENCRYPTION_KEY` or `SESSION_SECRET`, and "legacy NULL-attributed rows remain visible". |
| E2E Tests, same run | same run | Failed. Playwright line: 4 failed, 273 passed. Log also shows missing `AI_API_KEY`, production `ENCRYPTION_KEY` refusal, and `no_sourced_evidence`. |
| Live E2E, same run | same run | Failed. Summary line: 173 passed, 20 failed. Two of the 20 lines are missing xQuick credentials. Others are timeouts, a trusted-automation 403, a missing likes fixture, and `reading 'id'` errors. Not one cause. |
| Migration Guard on the main push | [Actions run 46132320278](https://github.com/unplugged-kk/ContentForge/actions/runs/46132320278) | Success, about 40 seconds. |

## Working tree at discovery

`site/postiz-*.ts` is committed and still not mounted. It is an older marketing-site variant. The live pages are `site/home.ts` and `site/agent.ts`.

`make test-db` and `docker-compose.test.yml` are committed on this branch. They start a disposable Postgres on `127.0.0.1:5434` and pass a test encryption key into Playwright and live e2e. That key is 32 zero bytes, the same value the test isolation code already pins. It is not a production secret.

`stash@{0}` is still `On phase-33.7-discovery-ownership: phase-33.7 wip`. It was not opened.

## Done, current, blocked

Done means merged, not "CI is green".

- Merged: productization increments INC-01 through INC-10, the six backlog gaps in `341ef67`, and the security commits `203a95d` and `b762d54`. Detail is in [`product-discovery/BACKLOG.md`](product-discovery/BACKLOG.md).
- Current: make the unit and database jobs on `main` green. That is `CF-CI` in [`ACTIVE_WORK.md`](ACTIVE_WORK.md).
- Blocked on the owner: founder pilot sessions in [`product-discovery/PILOT_RUNBOOK.md`](product-discovery/PILOT_RUNBOOK.md), live X publishing, and GitHub branch protection.
- Deferred: Jev flags, MCP server, Agent Reach, multi-tenant billing. Decision `DEC-08`.
- Inactive: marketing-site visual match. Last number on file is 46% on 2026-11-11 in the root [`../HANDOVER.md`](../HANDOVER.md). Not remeasured.

## Next action

Fix `CF-CI`. Do not open a new product feature while unit and database CI fail on `main`.

## Docs that are easy to misread

- [`product-discovery/PRODUCT_CURRENT_STATE.md`](product-discovery/PRODUCT_CURRENT_STATE.md) audits `origin/main` at `0dca955`, before pull request 7. Several "missing" rows were the work that later merged.
- [`archive/HANDOVER-2026-11-11.md`](archive/HANDOVER-2026-11-11.md) and [`ROADMAP.md`](ROADMAP.md) still describe `P0-1` and `P0-2` as the next task. Those two items landed later as INC-01 and INC-09. The later product items in that roadmap stay, unless `DEC-08` defers them.
- [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) was last fully reconciled on 2026-11-11.
- [`DB_MIGRATION_WORKFLOW.md`](DB_MIGRATION_WORKFLOW.md) still mentions Railway. The Makefile says there is no Railway. Workflows in git are only `e2e.yml` and `migration-guard.yml`.
