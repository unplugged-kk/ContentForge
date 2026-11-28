# Handover

Written 2026-11-28. The previous handover is [`archive/HANDOVER-2026-11-11.md`](archive/HANDOVER-2026-11-11.md). The root [`../HANDOVER.md`](../HANDOVER.md) is the 2026-11-11 marketing-site note, not this file.

## What the previous product session left

Pull request 7 merged to `origin/main` at `ae8ced2`. It contains the productization increments, the security fixes, and the CI jobs. Actions run [46132320299](https://github.com/unplugged-kk/ContentForge/actions/runs/46132320299) then failed unit, database, Playwright, and live e2e. Migration Guard run [46132320278](https://github.com/unplugged-kk/ContentForge/actions/runs/46132320278) succeeded.

The Nov 27 status files still say the work lives only on `work/productization-mvp` and that CI has not run. Both statements are stale. Current truth is [`STATUS.md`](STATUS.md).

## What this session did

Inspected git, the doc index, product-discovery records, pull request 7, and the Actions logs. Did not change application code. Did not run the test suites. Did not push.

Added the agent context pages and `script/agent-context.sh` in commit `ba2af6e` on `docs/agent-governance`. Moved the 2026-11-11 handover to `docs/archive/` and left a pointer. Marked pre-merge audits so a new agent does not rebuild finished work. Application code is unchanged from `ae8ced2`.

Left untouched:

- `site/postiz-*.ts` (untracked, unmounted).
- Unstaged `Makefile` test-database targets and untracked `docker-compose.test.yml`.
- `stash@{0}` on `phase-33.7-discovery-ownership`.
- Other repositories. They are listed in [`PROJECTS_INDEX.md`](PROJECTS_INDEX.md).

## Discoveries that change the next task

- `docs/ROADMAP.md` still leads with CI and Drizzle snapshot repair. Those landed as INC-01 (`bc2c1e4`) and INC-09 (`ab81f35`). The open engineering task is that the new CI jobs fail on `main`.
- Unit CI exits 1 even though the reporter says 0 failed. Nine tests were cancelled. The errors are pending promises in `server/content/videoRepurpose.test.ts`.
- Database CI failed 5 tests. Several say `ENCRYPTION_KEY` or `SESSION_SECRET` must be set. One asserts that legacy NULL-owner rows stay visible.
- Live e2e reported 173 passed and 20 failed, including publication failing because xQuick credentials are missing. That may be an expected fixture gap. It was not re-run locally.
- `PRODUCT_CURRENT_STATE.md` is a baseline of `0dca955`. Export, claim checks, owner credential isolation, and the weekly digest were missing there and are in the merge. Confirm in code before calling a row still broken.

## Next session

1. Run `script/agent-context.sh sync`.
2. Continue `CF-CI` in [`ACTIVE_WORK.md`](ACTIVE_WORK.md). Branch from `origin/main`. Do not commit the local Makefile or `docker-compose.test.yml` unless that task is to land them on purpose.
3. Reproduce the unit hang, then the database encryption failures.
4. Update this file, `STATUS.md`, and the CF-CI row with the commands you actually ran.

## Commands

```bash
script/agent-context.sh sync
script/agent-context.sh status
script/agent-context.sh handover
```

`make sync`, `make status`, and `make handover` call the same script. The Makefile on disk also has uncommitted `test-db` targets. Those targets are local only until someone commits them.
