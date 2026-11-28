# Rollback

Confirm which machine and which database you are on before any of these. The app database, the Playwright database on port 5433, and the local test database on port 5434 are different. Do not restore a dump onto a database you have not identified.

## A bad commit that is not pushed

`git revert` the commit on a branch, or reset only if the owner asked and the commit is still local to you. Do not reset `main`.

## A bad commit that is on origin/main

Open a revert pull request. Do not force-push `main`. Pull request 7 is already merged. Reverting it is an owner decision because it also reverts the security fixes.

## A failed deploy

The VPS path is `make deploy-vps`, which fast-forwards `main` and starts the Compose stack. To go back, check out the previous known commit on the server only after the owner names that commit, then redeploy. Cloudflare Tunnel is the ingress. There is no Railway app in the Makefile. The Railway paragraph in [`DB_MIGRATION_WORKFLOW.md`](DB_MIGRATION_WORKFLOW.md) is stale.

## A bad migration

Do not edit a migration file that has already run. Add a new migration that reverses the change, and review it. If the database is the local Compose volume, `make backup` writes `backups/<timestamp>.sql` before you restore. `make restore FILE=backups/<file>.sql` loads that dump into the Compose Postgres. Take the backup first. A restore overwrites data in the database you pipe it into.

The 2026-11-11 handover asked for one restore drill before external pilots. This session did not run one.

## A bad env var

Put the previous value back in the gitignored env file and restart the process. Do not commit the file. Production boot will refuse to start if `ENCRYPTION_KEY` is missing. That is intentional.

## A broken channel or a stuck job

Publication code records `unknown` instead of retrying a call that might have succeeded. Use the reconcile path already in `server/content/`. Do not delete rows to "unstick" a job. Do not point test commands at the database that holds live channel tokens.

## Auth0

Account linking and logout rollback steps are in [`AUTH0.md`](AUTH0.md). Follow that page rather than copying them here.
