# Constraints

Change these only with the owner's explicit approval, and say why in the commit. A test fixture is not that approval.

## Protected behavior

| What | Why | Approval |
|---|---|---|
| Primary key column types in `shared/schema.ts` | Switching `serial` and `varchar` breaks existing rows. | Owner, plus a migration plan. |
| Applied SQL in `migrations/0000` through `migrations/0035` | Decision `DEC-12`. Rewriting an applied file breaks databases that already ran it. | Owner. Add a new migration instead. |
| Artifact payload shape `{ text }` or `{ units }` | Migration `0007` trigger and the channel adapters. Claim data lives in `artifacts.attribution`. | Owner if the payload schema must change. |
| `npm run test:unit` and `npm run test:db` as the only test entry points | `server/testing/hermeticEnv.ts` strips live provider keys. Raw `node --test` can post to X or call a billed model. | Do not bypass. |
| One app process for web, workers, and schedulers | A second worker double-runs schedules. | Owner before any extra worker service. |
| `ALLOW_TRUSTED_AUTOMATION` default off | Unattended approval contradicts the pilot gate (`DEC-07`). | Owner to turn it on. |
| `ALLOW_ENV_CHANNEL_FALLBACK` default off | A second user must not publish as the founder (`DEC-06`). | Owner, and only with `SINGLE_OPERATOR_OWNER_ID` when one operator is intended. |
| Jev flags default off | No labelled golden set (`DEC-08`). | Owner, after a comparison set exists. |
| Live posts, paid media, paid model calls | Real side effects and spend. | Owner, in the chat, for that run. |
| `site/postiz-*.ts` | Committed, unmounted. Deleting them is a cleanup, not a drive-by. | Owner. |
| `stash@{0}` and the `cf-design/*` worktrees | Old phase work. Several worktrees are marked prunable. | Owner before drop or delete. |

## Safe without a new approval

- Read any doc or source file.
- Run `npm run test:unit`. It is hermetic.
- Run `npm run test:db` only against a local or obviously disposable database. The guard refuses other targets. `make test-db` uses `127.0.0.1:5434`.
- Add a migration as a new file after `drizzle-kit generate`, and review the SQL.
- Update `docs/STATUS.md`, `docs/ACTIVE_WORK.md`, and `docs/HANDOVER.md` when you finish a task.

## Git

Do not commit on `main`. Do not merge or deploy from an agent session unless the owner asked for that merge or deploy. Do not `git push` to `main`. Do not reset, force-push, or clean untracked files.

## Secrets

Do not print `.env`, cookie jars, or tokens. `local.txt` was a live session cookie and is gitignored. API responses must not return raw channel tokens.
