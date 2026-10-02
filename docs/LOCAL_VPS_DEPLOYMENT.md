# LOCAL / VPS Deployment — ContentForge

Operational runbook for the ContentForge deployment (OCI VPS + Docker Compose + Cloudflare Tunnel).
Verified against the live deployment on 2026-09-28.

Public URL: **https://contentforge.kishorekumarbehera.com**
Host: `ubuntu@129.159.224.196` (`hermes-nic`) · Repo: `/home/ubuntu/git/ContentForge` · Branch: `deploy/vps-dogfooding`

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
| `docker-compose.yml` | the stack; `cloudflared` is behind the `tunnel` profile |
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
| `POSTGRES_PORT`, `APP_PORT` | **set to `127.0.0.1:5432` / `127.0.0.1:3000`** so ports bind to loopback only |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_TEXT_MODEL`, `AI_TEXT_PREMIUM_MODEL`, `AI_VISION_MODEL`, `AI_IMAGE_MODEL` | AI provider |
| `XQUIK_API_KEY`, `XQUIK_ACCOUNT` | X publishing (xQuick) |
| `CLOUDFLARE_*`, `TUNNEL_TOKEN` | Cloudflare management + tunnel credential |

---

## 5. Day-2 operations

```bash
ssh ubuntu@129.159.224.196
cd /home/ubuntu/git/ContentForge

# start / apply .env changes (recreates changed services)
docker compose --profile tunnel up -d

# status + logs
docker compose --profile tunnel ps
docker compose logs -f app

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
# backup
docker exec contentforge-db pg_dump -U cfuser -d contentforge > backup-$(date +%F).sql
# restore
cat backup-YYYY-MM-DD.sql | docker exec -i contentforge-db psql -U cfuser -d contentforge
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
git fetch origin && git checkout deploy/vps-dogfooding && git pull
docker compose --profile tunnel build        # rebuild the app image
docker compose --profile tunnel up -d        # migrations run on boot
docker compose --profile tunnel ps           # verify healthy
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
- Session cookie is not `Secure` behind the tunnel (`SESSION_COOKIE_SECURE=0`); Express `trust proxy` is
  not configured. Login works, but harden before wider use.
- See `docs/DOGFOODING.md` and `docs/DOGFOODING_REPORT_TEMPLATE.md` for the dogfooding procedure.

---

## 10. Verified (2026-09-28)

- ✅ `docker compose --profile tunnel up -d` brings the stack up; `/api/ready` 200.
- ✅ **Restart safety**: `restart app` and `--force-recreate app` both return to healthy; marker files in
  `contentforge_uploads` / `contentforge_scratch` survive recreation; DB data intact.
- ✅ Tunnel connected; `https://contentforge.kishorekumarbehera.com/api/health` → 200.
- ⏳ **VPS reboot** not exercised (shared host — do it deliberately, not casually).
