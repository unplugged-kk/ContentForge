# ContentForge — Local Deployment Report

**Date:** 2026-09-26
**Commit:** `5bfd70b` (== `origin/main`) + the deployment changes in this commit
**Verdict:** **LOCAL STACK OPERATIONAL** — verified by execution, not by inspection
**Development freeze:** in effect. This phase added no product capability.

---

## Environment

| Item | Value |
|---|---|
| Container runtime | `docker` 29.6.1 via **Dory** (Docker-compatible macOS daemon, not Docker Desktop) |
| Compose | v5.5.1 |
| PostgreSQL | `postgres:16-alpine`, container `contentforge-db` |
| Application | built from the repo `Dockerfile`, container `contentforge-app`, single process |
| App URL | `http://localhost:3000` (host) → `5000` (container) |
| Local database | `postgresql://cfuser@postgres:5432/contentforge`, named volume `contentforge_pg_data` |

**The application cannot reach production from here.** The resolved compose config overrides
`DATABASE_URL` to the local `postgres` service, taking precedence over the production value in
`.env`. Verified in `docker compose config` output, not assumed.

## Docker Compose Services

```
app        Up (healthy)
postgres   Up (healthy)
```

Two services, deliberately. **There is no separate worker container**, because there is no separate
worker: `server/index.ts:175` runs the migrations and `:270-271` starts the schedulers in the same
process. A second "worker" service would run a second scheduler against the same queue, which this
application does not support. Documented rather than invented.

### What was wrong with the previous `docker-compose.yml`

It **could not boot**. It set `SESSION_SECRET: change-me-in-production`, and the application
refuses to start on a development default (fail-closed since Phase 30). Postgres would come up and
the app would exit. It also wired no `.env`, set no `ENCRYPTION_KEY`, had no application
healthcheck, no log bounding, and hardcoded the database password.

### What changed

- `env_file: .env` — real credentials come from the gitignored local file.
- A **fail-closed preflight** that names the missing variable and refuses to start, instead of a
  crash loop. Dev-default `SESSION_SECRET` is rejected with the exact command to generate one.
- Named volume for durable storage; `restart: unless-stopped` on both services.
- Application healthcheck on `/api/ready`, which reflects real database connectivity.
- Bounded `json-file` logging (20 MB × 5 for the app) so a multi-day run cannot fill the disk.
- **No automatic reset anywhere.** `down -v` stays deliberate.

## Environment Variables Required

| Variable | Status in the local `.env` | Consequence |
|---|---|---|
| `SESSION_SECRET` | present (29 chars) | required; the app refuses to boot on a dev default |
| `DATABASE_URL` | present, overridden by compose | points at the local service |
| `ENCRYPTION_KEY` | **ABSENT** | the server derives one from `SESSION_SECRET`. Works, but changing `SESSION_SECRET` later makes every stored provider token unreadable. **Set a dedicated one for a multi-day run.** |
| `AI_API_KEY` | present | real AI generation is possible locally |
| `XQUIK_API_KEY` | **ABSENT** | **real publishing to X is not configured.** Publishing cannot be end-to-end verified until it is. |

No secret value was read, printed, logged or written to any file. No credential backup file was
created.

## Database

- **Migrations ran automatically** on a fresh volume: **68 tables, 32 applied migrations**.
- Demo seeding is **disabled** (`[db] demo data seed disabled`), so nothing is fabricated — the
  empty surfaces you see are genuinely empty.
- No destructive operation runs at startup.

## Worker

The job runtime and both schedulers start with the app:

```
[jobs] job runtime started
[scheduler] Started — publish/retry * * * * *, auto-post 05:30 IST, autofill 06:30 IST,
            discover 06:00 IST, sat article 13:00 IST, sun recap 19:30 IST, analytics 08:30 IST
            (timezone: Asia/Kolkata)
[content-scheduler] started (every minute)
```

## Health / Readiness

| Probe | Result |
|---|---|
| `/api/health` | **200** `{"status":"ok","uptimeSec":…}` |
| `/api/ready` | **200** `{"status":"ready","checks":{"database":"up"}}` |
| `/api/ready` with PostgreSQL **stopped** | **503** |
| `/api/ready` after PostgreSQL restarted | **200** |

**Readiness is honest.** It returned 503 rather than a falsely permissive 200 when its dependency
was gone, and the application recovered on its own once the database returned.

## Browser Verification

**Not yet performed.** The stack is serving and the auth boundary was verified through it
(`/api/artifacts`, `/API/artifacts`, `/API/research/jobs` → **401** anonymously), and registration
succeeded through the real HTTP surface (**200**), which proves the full route stack. I did not
drive the seven canonical destinations in a browser in this pass. **Do that first when you open
it** — see `docs/DOGFOODING.md`.

## Real Provider Verification

**Not performed, and not claimed.** `XQUIK_API_KEY` is absent from the local `.env`, so real
publishing is not configured. `AI_API_KEY` is present, so generation *should* work, but I did not
spend a paid call to confirm it. Add the publishing credential and this becomes verifiable.

## Restart / Recovery

| Test | Result |
|---|---|
| `docker compose restart app` | data preserved (`users` unchanged), `/api/ready` 200 |
| PostgreSQL stopped | app container stayed up; `/api/ready` 503 |
| PostgreSQL restarted | `/api/ready` back to 200 without intervention |
| Data after all of the above | preserved; nothing reseeded or recreated |

**Not proven:** that an in-flight queued job survives a restart. `stories` remained 0 because my
probe's session/CSRF handling returned 401 on the create call, so the persistence probe exercised
`users` only. I am recording that rather than claiming more than I measured.

## Persistence

Confirmed: a registered operator account survived an application restart, and the database volume
survived a full stop/start of the Postgres container. Artifact, revision, schedule, publication and
learning persistence were **not** individually exercised in this pass — the data needed to test
them was not created.

## Known Limitations

1. Browser UI verification of the seven canonical destinations — **not done here**.
2. Real publishing — **not configured** (`XQUIK_API_KEY` absent).
3. `ENCRYPTION_KEY` not set — derived from `SESSION_SECRET`; set a dedicated one before relying on
   stored provider tokens across days.
4. Queue durability across a restart — not proven.
5. The seven known non-blocking debt items from the final audit stand; none blocks local operation.

## Dogfooding Instructions

See `docs/DOGFOODING.md` (how to use it for 3–7 days) and
`docs/DOGFOODING_REPORT_TEMPLATE.md` (what to record). The short version: **use it naturally with
real content, record what gets in your way, and do not fix things as you find them.**

## Commands to Start

```sh
cd /Users/kishore/git/ContentForge
docker compose up --build -d     # first run builds the image (a few minutes)
docker compose ps                # wait until app and postgres both show "healthy"
open http://localhost:3000
```

## Commands to Stop

```sh
docker compose stop              # stop containers, keep everything
docker compose down              # remove containers, KEEP the database volume
```

## Commands to Inspect Logs

```sh
docker compose logs -f app       # application, scheduler and job runtime
docker compose logs -f postgres  # database
docker compose ps                # current status and health
```

## Commands to Rebuild

```sh
docker compose up --build -d     # after pulling new code; preserves the volume
```

## Commands to Reset LOCAL environment ONLY

> **DESTROYS ALL LOCAL DATA.** Every story, artifact, revision, schedule, publication, learning
> record and queued job in the local volume is gone permanently. There is no undo.

```sh
docker compose down -v           # removes containers AND the named volume
docker compose up --build -d     # starts from a completely empty database
```

Nothing in this stack performs that reset automatically.
