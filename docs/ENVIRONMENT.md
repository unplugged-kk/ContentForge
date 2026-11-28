# Environment

Values live in a gitignored env file, never in git. The example names are in `.env.example`. [`product-discovery/ENVIRONMENT_INVENTORY.md`](product-discovery/ENVIRONMENT_INVENTORY.md) (2026-11-27) lists local agent tools. It does not list secret values. Do not add any.

## Where the file is

Compose reads `ENV_FILE`, defaulting to `.env` beside the Makefile. On a server, point `CONTENTFORGE_ENV_FILE` at an absolute path outside the clone, for example under `~/.contentos/`. `make up` and `make vps` refuse to start when that file is missing.

## Required to boot the app

Set these yourself. The example file shows placeholders, not working secrets.

- `NODE_ENV`
- `DATABASE_URL`
- `SESSION_SECRET`
- `ENCRYPTION_KEY` in production. Boot refuses to derive it from `SESSION_SECRET`. That refusal is visible in the failed e2e log on Actions run 46132320299.

## Optional product flags

Leave these unset or off unless the owner asked.

- `ALLOW_TRUSTED_AUTOMATION` and `ALLOW_ENV_CHANNEL_FALLBACK` (see [`CONSTRAINTS.md`](CONSTRAINTS.md)).
- `JEV_*` decision flags. Default off.
- `LAST30DAYS_ENABLED` for the optional research provider.
- `STORY_LLM_SYNTHESIS` for paid synthesis. Do not turn it on in an agent session.
- `CONTENTFORGE_ALLOW_PAID_MEDIA`. Off on the VPS by the 2026-11-11 handover.
- `AI_API_KEY` and provider base URLs for the model gateway. E2E on `ae8ced2` failed with "No API key for provider default".
- `XQUIK_API_KEY` and `XQUIK_ACCOUNT` only when the owner has accepted xQuick terms and asked for a live or fixture X write. Live e2e failed when they were absent.
- Video Factory and speech keys (`VIDEO_FACTORY_*`, `MACOS_SAY_ENABLED`, `ELEVENLABS_*`, `FAL_KEY`) are optional media paths. Do not spend them from an agent session.

## Tests

`npm run test:unit` sets its own unused `DATABASE_URL` and loads `server/testing/hermeticEnv.ts`. It does not need your `.env`.

`npm run test:db` needs `TEST_DATABASE_URL` on a local disposable Postgres, plus `ENCRYPTION_KEY` or `SESSION_SECRET` for tests that encrypt tokens. Pointing it at a database you care about is forbidden. The guard tries to refuse non-local names. The uncommitted `make test-db` target uses port 5434 and does not read `.env`.

Playwright's `make e2e` uses `docker-compose.e2e.yml` on port 5433 and `DOTENV_CONFIG_PATH=/dev/null`.

## Accounts the owner must configure

Auth0 tenant (see [`AUTH0.md`](AUTH0.md)), Google OAuth if that sign-in is used, Postgres, and the model provider. Social apps only if publishing is turned on. Agents do not create those accounts and do not copy their secrets into docs or commits.
