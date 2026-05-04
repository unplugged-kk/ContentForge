# End-to-end tests (Playwright)

Tests run against a **built** app (`dist/index.cjs` + `server/public/`) and a real **PostgreSQL** database.

## Recommended: Docker Compose E2E database (local)

Use a **throwaway** Postgres so you never point Playwright at Railway or your real dev DB:

```bash
npx playwright install chromium   # once
npm run build:verify:docker       # Docker DB → db:push → check → build → tests → tear down
```

What happens:

1. **`docker-compose.e2e.yml`** starts Postgres on **host port `5433`** (`e2e` / `e2e` / `contentforge_e2e`).
2. **`npm run db:push`** applies the Drizzle schema to that database.
3. **`npm run check`**, **`npm run build`**, **`playwright test`** run with  
   `DATABASE_URL=postgresql://e2e:e2e@127.0.0.1:5433/contentforge_e2e`  
   (your shell `DATABASE_URL` for Railway/dev is **ignored** during this script so E2E cannot hit prod by mistake).
4. **`docker compose … down -v`** removes the container and volume.

Manual lifecycle (same DB URL as above in `DATABASE_URL`):

| Command | Purpose |
|--------|---------|
| `npm run e2e:db:up` | Start E2E Postgres only |
| `DATABASE_URL=postgresql://e2e:e2e@127.0.0.1:5433/contentforge_e2e npm run db:push` | Apply schema |
| `DATABASE_URL=… npm run build:verify` | Build + test against that DB |
| `npm run e2e:db:down` | Stop and delete volume |

Port **5433** avoids clashing with **`docker-compose.yml`** (dev DB on **5432**).

### Environment knobs

| Variable | When |
|----------|------|
| `E2E_DATABASE_URL` | Optional; overrides the default E2E Docker URL (same host/port/user/db pattern). |
| `E2E_SKIP_DOCKER=1` | Do **not** start `docker-compose.e2e.yml`; use **`DATABASE_URL`** from the environment (e.g. GitHub Actions `services:` Postgres). |

## Without Docker (you manage Postgres yourself)

1. Set `DATABASE_URL` to any disposable Postgres.
2. `npm run db:push`
3. `npm run build:verify`

## Other variables

| Variable | Purpose |
|----------|---------|
| `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` | Optional fixed login (otherwise a unique user is registered in setup). |
| `E2E_PORT` | App port for Playwright’s webServer (default `4173`). |
| `PLAYWRIGHT_BASE_URL` | If the app is already running elsewhere. |

Crons are disabled during E2E (`DISABLE_CRON=1` via `npm run e2e:serve`). Session cookies use `SESSION_COOKIE_SECURE=0` for `http://127.0.0.1`.

**OpenAI:** GitHub Actions sets `CI=true`, and Playwright’s webServer sets `CONTENTFORGE_E2E_SERVER=1`, so the server can start **without** `OPENAI_API_KEY`. E2E smoke tests do not call the real AI; production and `npm run dev` still require a real key.

## CI (GitHub Actions)

Workflow: **`.github/workflows/e2e.yml`** (job name **“E2E Tests”**).

- Runs on **every `push`**, **every `pull_request`**, and **`workflow_dispatch`** (manual re-run from the Actions tab).
- Uses a **GitHub Actions service container** Postgres only (`localhost`); **`DATABASE_URL` is hardcoded** in the workflow so it **never** reads Railway or your laptop `.env`.
- A guard step fails the job if `DATABASE_URL` is not `localhost` / `127.0.0.1`.
- **Playwright reporters in CI**: `list`, **`github`** (annotations on the run + Files tab), **HTML**, **JUnit** (`test-results/e2e-junit.xml`).
- After every run (**success or failure**), download artifact **`e2e-report`** for the full HTML report, screenshots, videos, and traces.

### Gate merges / deploys (recommended)

1. In GitHub: **Settings → Branches → Branch protection** for `main` (or your deploy branch).
2. Enable **“Require status checks to pass before merging”**.
3. Add required check: **E2E Tests** (exact name of the job).

Then a green workflow means E2E passed before merge; Railway (if it deploys from that branch after merge) only sees merged code that passed checks.

### Railway and “build after push”

If Railway deploys on **every push** to a branch, it may still start a build **in parallel** with GitHub Actions; it does **not** wait for E2E unless you configure it. Prefer: deploy from **`main` after PR merge** + required **E2E Tests** on PRs, and in Railway turn on **wait for GitHub checks** (or equivalent) if your plan supports it.

### Local parity with CI

`E2E_SKIP_DOCKER=1` with `DATABASE_URL` set to a disposable Postgres matches the CI pattern (no Docker Compose). See `script/e2e-docker.mjs` for the full local Docker flow.
