# LOCAL / VPS Deployment — ContentForge

Operational runbook for the ContentForge deployment (OCI VPS + Docker Compose + Cloudflare Tunnel).
Verified against the live deployment on 2026-09-28.

Public URL: **https://contentforge.kishorekumarbehera.com**
Host: `ubuntu@129.159.224.196` (`hermes-nic`) · Repo: `/home/ubuntu/git/ContentForge` · Branch: **`main`**

**Deployment is always from `main`.** There is no deploy branch and no Railway —
pushing `main` deploys nothing by itself; the VPS pulls `main` and runs
`make deploy-vps`. The database is the `postgres` service in this stack, on the
`contentforge_pg_data` volume.

---

## 1. Topology

```
Internet → Cloudflare (DNS + WAF) → Cloudflare Tunnel → OCI VPS → Docker Compose
                                                                   ├─ contentforge-app   (127.0.0.1:3000 → :5000)
                                                                   ├─ contentforge-db    (127.0.0.1:5432, private)
                                                                   └─ contentforge-tunnel (cloudflared, outbound only)
```

- **One application process** runs web + pg-boss workers + schedulers. **Never add a second "worker"
  container** — it would double-run the schedulers and the queue consumers.
- DB migrations run **on boot** (`server/index.ts` `migrate()`).
- **Cloudflare is ingress only.** The app must not depend on Cloudflare APIs.
- Ports are **loopback-only**; nothing is exposed publicly except via the tunnel.

---

## 2. Prerequisites

- Docker 24+ and Docker Compose v2 on the host.
- The domain/zone in Cloudflare, and a **remotely-managed tunnel** with a published route to `http://app:5000`.
- A `.env` next to `docker-compose.yml` (gitignored) with the required secrets — see §4.

---

## 3. Files that matter

| File | Role |
|---|---|
| `docker-compose.yml` | the stack (base); `cloudflared` behind the `tunnel` profile; **every published port binds to loopback** |
| `docker-compose.local.yml` | local overlay — plain HTTP, `TRUST_PROXY=0` (`make up`) |
| `docker-compose.vps.yml` | VPS overlay — Secure cookie, `TRUST_PROXY=1`, tunnel (`make vps`) |
| `Makefile` | `make up` · `make vps` · `make deploy-vps` · `make backup` · `make restore` |
| `.env` | all config/secrets (gitignored; never committed) |
| `Dockerfile` | multi-stage build (builder runs `npm run build` → `dist/`) |
| `.dockerignore` | keeps `.env`, `node_modules`, `dist`, `.scratch`, `uploads`, docs/agent dirs out of the build |
| `migrations/` | copied into the image; applied on boot |

---

## 4. Required `.env` (names only — values are host-local)

| Key | Purpose |
|---|---|
| `DATABASE_URL` | overridden by Compose to the `postgres` service; set for local/CLI use |
| `SESSION_SECRET` | session signing (fail-closed in production) |
| `ENCRYPTION_KEY` | at-rest encryption of provider tokens; **keep stable** |
| `POSTGRES_USER/PASSWORD/DB` | DB credentials |
| `POSTGRES_PORT`, `APP_PORT` | host ports only; the **loopback binding lives in `docker-compose.yml`**, so `5432`/`3000` are fine |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_TEXT_MODEL`, `AI_TEXT_PREMIUM_MODEL`, `AI_VISION_MODEL`, `AI_IMAGE_MODEL` | AI provider |
| `XQUIK_API_KEY`, `XQUIK_ACCOUNT` | X publishing (xQuick) |
| `CLOUDFLARE_*`, `TUNNEL_TOKEN` | Cloudflare management + tunnel credential |

### Where that file lives (read this before a first deploy on a new machine)

`.env` is **gitignored**, so a fresh clone — a new server, a second machine, or
after `git clean -xfd` — has **none**, and `docker compose` then fails with a raw
`env file … not found`. Two supported placements:

```bash
# A — beside the compose file (default)
cp .env.example .env      # then fill in the real values

# B — outside the working tree (recommended on a server: a re-clone cannot lose it)
mkdir -p ~/.contentos
cp .env.example ~/.contentos/contentforge.env   # then fill in the real values
CONTENTFORGE_ENV_FILE=$HOME/.contentos/contentforge.env make vps
```

Use an **absolute** path for `CONTENTFORGE_ENV_FILE` — compose does not expand
`~`. `make up` / `make vps` check for the file first and print this guidance
instead of a stack trace. The value is never printed.

---

## 5. Day-2 operations

```bash
ssh ubuntu@129.159.224.196
cd /home/ubuntu/git/ContentForge

# start / apply .env changes (recreates changed services)
make vps

# status + logs
make ps
make logs

# restart one service without touching data
docker compose restart app

# stop (keeps volumes)
docker compose down

# DESTRUCTIVE — wipes ALL data and volumes (irreversible)
docker compose down -v
```

**Health / verification**
```bash
curl -s http://127.0.0.1:3000/api/ready      # {"status":"ready","checks":{"database":"up"}}
curl -s https://contentforge.kishorekumarbehera.com/api/health
docker compose --profile tunnel ps           # all services healthy
```

---

## 6. Backup & restore

**Database**
```bash
# backup  (reads POSTGRES_USER/POSTGRES_DB from inside the container)
make backup
# restore
make restore FILE=backups/contentforge-YYYYMMDD-HHMMSS.sql
```

**Uploaded / generated media** (named volumes)
```bash
docker run --rm -v contentforge_uploads:/data -v "$PWD":/out alpine \
  tar czf /out/uploads-$(date +%F).tgz -C /data .
```

**Restore check**: restore into a scratch DB/volume and compare counts before trusting a backup.

---

## 7. Upgrade

```bash
cd /home/ubuntu/git/ContentForge
make deploy-vps     # git pull --ff-only origin main → build → up (migrations run on boot)
make ps             # verify healthy
```
Back up the DB first (§6). Roll back by checking out the previous commit/digest and rebuilding.

---

## 8. Credential rotation

- Rotate the **Cloudflare API token** and the **AI key** by editing `.env` and `up -d`.
- **`ENCRYPTION_KEY` must stay stable** — changing it makes stored provider tokens unreadable.

---

## 9. Security notes / known gaps

- `.env` is excluded from the image (`.dockerignore`) and from git (`*.env`). Keep it that way.
- **Registration is open** on a public URL — anyone can sign up; consider a registration lock.
- `docker-compose.vps.yml` sets `SESSION_COOKIE_SECURE=1` and `TRUST_PROXY=1`, so the session cookie is
  `Secure` and Express trusts the tunnel's forwarded headers. (These were unset on the first VPS deploy;
  the overlay now makes them the default.)
- See `docs/DOGFOODING.md` and `docs/DOGFOODING_REPORT_TEMPLATE.md` for the dogfooding procedure.

---

## 10. Verified (2026-09-28)

- ✅ `docker compose --profile tunnel up -d` brings the stack up; `/api/ready` 200.
- ✅ **Restart safety**: `restart app` and `--force-recreate app` both return to healthy; marker files in
  `contentforge_uploads` / `contentforge_scratch` survive recreation; DB data intact.
- ✅ Tunnel connected; `https://contentforge.kishorekumarbehera.com/api/health` → 200.
- ⏳ **VPS reboot** not exercised (shared host — do it deliberately, not casually).
