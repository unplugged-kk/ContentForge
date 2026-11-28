# Bugs

Open items have evidence from 2026-11-28. Older defects that pull request 7 claims to have fixed are not listed as open. Confirm in the code before you reopen one. The pre-merge list is [`product-discovery/PRODUCT_CURRENT_STATE.md`](product-discovery/PRODUCT_CURRENT_STATE.md).

## BUG-1 Unit CI exits 1 with zero reported failures

- Severity. High. `main` does not have a green unit gate.
- Where. [Actions run 46132320299](https://github.com/unplugged-kk/ContentForge/actions/runs/46132320299), job Unit Tests, commit `ae8ced2`.
- What the log shows. `# pass 1296`, `# fail 0`, `# cancelled 9`, then `Process completed with exit code 1`. Cancelled tests include `server/content/videoRepurpose.test.ts` with `Promise resolution is still pending but the event loop has already resolved`, `failureType: cancelledByParent`.
- Status. Open. Not reproduced locally in the governance session.
- Next. Reproduce that file under `npm run test:unit` and find the promise that never settles.

## BUG-2 Database CI, five failures

- Severity. High.
- Where. Same Actions run, job DB Integration Tests.
- Counts. `# pass 384`, `# fail 5`.
- Seen errors. `ENCRYPTION_KEY or SESSION_SECRET must be set to encrypt secrets at rest` in legacy route isolation and YouTube OAuth tests. Also `not ok 5 - legacy NULL-attributed rows remain visible (documented bridge)` under owner isolation.
- Status. Open. Not re-run here.
- Next. See whether CI sets `ENCRYPTION_KEY` or `SESSION_SECRET` for the db job. Then look at the NULL-owner assertion separately.

## BUG-3 Playwright e2e on main

- Severity. High for the gate, mixed causes.
- Where. Same run, job E2E Tests. A pass/fail total was not copied from the log.
- Seen errors. `No API key for provider "default". Set AI_API_KEY.` `ENCRYPTION_KEY must be set in production`. `Research produced no usable evidence (no_sourced_evidence)`. `{"message":"Internal server error"}` in the secret-exposure spec.
- Status. Open. Some lines may be missing CI env rather than product regressions. That split is not proven.

## BUG-4 Live e2e, 20 of 193 checks failed

- Severity. Medium until someone separates missing fixtures from product failures.
- Where. Same run, job Live E2E. Summary line: `173 passed, 20 failed (193 checks)`.
- Seen error. `publication failed: xQuick credentials missing` on the publication worker and on a scheduler tick.
- Status. Open. Do not add real xQuick keys to make the job green unless the owner asks.

## Not a bug, do not "fix" by deleting

- `site/postiz-*.ts` untracked. Dead variant, owner decision to delete.
- Local `main` behind `origin/main`. Fast-forward after fetch.
- Node 20 deprecation warning on GitHub Actions runners. Warning only.
