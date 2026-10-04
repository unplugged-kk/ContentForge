# HANDOVER — fix pass + E2E programme

Written 2026-10-04. Branch: **`main`**. Everything below is on `main` and pushed
unless a line says otherwise.

If you only read one section, read **§3 What is NOT done** and **§5 How to run
anything** — those are what you need to continue.

---

## 1. Where things stand

| | |
|---|---|
| Branch | `main` (deploy from here — the VPS pulls it) |
| Head at handover | `ae0dc8a` (plus the docs/CI commit that carries this file) |
| VPS | `ubuntu@129.159.224.196`, `/home/ubuntu/git/ContentForge`, last deployed `39f2980` — **behind `main`; pull and `make deploy-vps`** |
| Railway | gone. `prod-migrate.yml`, `deploy.yml`, `railway.toml` deleted; its two repo secrets deleted |
| CI on main | `Migration Guard` green · `E2E Tests` (Playwright) green · `Live E2E` present but **`continue-on-error`** (see §3) |

Unit suite: **1029 passed, 0 failed, 1 skipped** (`npm run test:unit`, against a
DIRECT database — see §5). `npm run check` (tsc) clean. Playwright in the CI
shape: **275 passed, 1 flaky, 2 skipped, 0 failed**.

## 2. What is done and verified

Findings are from `docs/LOCAL_E2E_ACCEPTANCE_REPORT.md` (F-numbers); its addendum
records the earlier work.

- **F1** unknown `/api/*` now returns **404 JSON** (was 200 HTML). Verified live.
- **F2** `GET /api/provider-media/:token` was unreachable — the auth gate answered
  401 before the route could check its grant. The token is the credential, so the
  prefix is public; tests prove the surface did not widen beyond that one route.
- **F3** asset bytes were process memory. Now content-addressed on the
  `contentforge_uploads` volume. **Verified live**: after a restart a durable asset
  refines *succeeded* while an in-memory-era asset still failed with
  `asset "local:…" is unavailable`.
- **F4** added an owner-authenticated byte route (`GET /api/visual-assets/:id/content`)
  and rendered it. **Verified live**: 200 `image/jpeg`, 443,177 bytes, `file(1)`
  confirms JPEG 1376×768; unauthenticated 401 with no bytes; non-owned 404.
- **F5** a dead-lettered generation now nudges its owning run through the same
  idempotent advance the scheduler uses; only terminal failures nudge.
- **F6** evidence samples up to 4 windows spread across a long body (was ~1% of a
  38k-char talk).
- **F7** VTT rolling captions merge on word-aligned overlap (two-word floor), so
  the duplicated-phrase failure is emitted once and ordinary prose is not corrupted.
- **F8** Nano Banana (Gemini image) provider — the images path that did not exist.
  **Verified live** through the product path.
- **F11** the Gemini video key is out of the URL (`x-goog-api-key`); the native
  vs gateway split is documented as deliberate (the gateway cannot express
  `file_data.file_uri`).
- **F12** dead routing tasks pruned. **F13** `b64_json` handled. **F15** intake
  returns `lang`/`cueCount`/`transcriptSource`. **F9** env template extended.
- **A1 / pool test** the 996/997 was an environment artifact: the local `.env`
  `DATABASE_URL` is a **Neon pooler**, where `pg_terminate_backend` is not 1:1.
  The test now prefers `TEST_DATABASE_URL` and skips loudly when pooled.
- **E2E-1** the red Playwright job: 3 specs targeted **removed surfaces**
  (`/ideas`, `/references`, `/discover` are read-only views / redirects now) and
  were rewritten; the rest was **parallel-load contention** (workers capped, plus
  a shared-user state leak from `security-secret-exposure` fixed by pinning
  `/api/accounts`). Full suite green.
- **E2E-2 (partial)** `script/e2e-live.mjs` could not run at all — see below.

Deferred deliberately, with reasons in the report: **C4/F16** (the body parser
sits before CSRF because `auditLog` hashes `req.rawBody`; reordering would empty
that hash for a cosmetic error-code gain) and **F14's remaining ~150 legacy
handlers** (the publish/media paths are fixed; the rest is recorded).

## 3. What is NOT done — continue here

### 3a. The live harness — two stale phases (top priority)

`script/e2e-live.mjs` now authenticates, seeds the right owner, and runs the
pipeline. It stops at:

1. **Queue-transient phase** — times out waiting for a transient failure
   (`first attempt fails transiently and a retry is durably scheduled`). Its
   premise is the fixture's flaky feed; check `flaky.xml` in
   `e2e/fixture/rss-fixture.mjs` and how the phase switches to it
   (search the harness for `flaky-long` / `setActiveFeed`).
2. **Artifact approval** — `draft → in_review → approved, with the payload
   validated by the registry` reports `readiness=undefined`, so the next step
   (`POST /api/schedules pins the approved revision`) gets
   `409: Artifact 1 is "draft"`. The approval response shape has drifted; compare
   the harness's expectation against the current artifact review route.

Then remove `continue-on-error: true` from the `live` job in
`.github/workflows/e2e.yml` so it starts protecting the suite.

### 3b. E2E-3 — lifecycle gaps (not started)

- UI intake → persisted source (only the button/dialog is asserted today).
- Media durability across restart (the F3 fix) as an E2E assertion.
- Run failure when its generation dead-letters (the F5 fix).
- A valid provider-media grant succeeds; a reused one does not (the F2 fix).

### 3c. E2E-4 — VPS smoke suite (not started)

Read-only checks after a deploy: `/api/health` + `/api/ready` 200; the host
listens only on loopback (`ss` shows `127.0.0.1` for 3000/5432 — this is the
check that caught the stale `.env` port bug); the running commit matches `main`;
the tunnel routes. Plus `make e2e` / `make e2e-live` / `make e2e-vps` targets.

### 3d. Known, non-blocking

- `e2e/agent-publish.e2e.spec.ts` is **flaky** (Playwright retries it; CI passes).
- `insights`, `settings-labels`, `full-product-audit` and `discovery-ownership`
  were load-flaky, not broken — all pass in isolation. The worker cap fixed the
  full-suite runs; keep an eye on it if a suite ever gets slower.

## 4. Credentials and environment facts that cost time

- **`DATABASE_URL` in the local `.env` is NOT the compose database.** It points at
  a **Neon pooler** (`…-pooler…neon.tech`). Consequence: any script that sources
  `.env` talks to the cloud database, and pool-dependent tests misbehave there.
  Run unit/DB tests against a direct database:
  `DATABASE_URL=postgresql://cfuser:cfpass@127.0.0.1:5432/contentforge`.
  The docker compose app overrides `DATABASE_URL` to its own service, so the app
  itself is unaffected.
- **Dory owns host port 80** on this machine, so the E2E fixture container cannot
  publish there. Use `E2E_LIVE_FIXTURE_PORT=8088` (and the SSRF knob described
  below is set automatically by the harness for non-80/443 ports).
- **macOS `say` has no voice data** for "Samantha" here (it writes a header-only
  4096-byte AIFF), so the live speech check skips loudly with that reason. Install
  the voice to exercise it.
- **Paid media**: `CONTENTFORGE_ALLOW_PAID_MEDIA` (+ `GEMINI_IMAGE_MODEL`) is set
  locally only. It is deliberately OFF on the VPS, so image generation ships
  there but makes no paid calls until you enable it.
- The VPS `.env` previously had `POSTGRES_PORT=127.0.0.1:5432` (old doc advice),
  which broke the compose render; it is now `5432` / `APP_PORT=3000`.

## 5. How to run anything

```bash
# unit + typecheck (direct DB, not the Neon pooler from .env)
DATABASE_URL=postgresql://cfuser:cfpass@127.0.0.1:5432/contentforge \
TEST_DATABASE_URL=postgresql://cfuser:cfpass@127.0.0.1:5432/contentforge \
  npm run test:unit && npm run check

# Playwright, in the CI shape (no .env, ephemeral DB, production bundle)
docker compose -f docker-compose.e2e.yml up -d --wait
npm run build
DOTENV_CONFIG_PATH=/dev/null CI=true \
  DATABASE_URL=postgresql://e2e:e2e@127.0.0.1:5433/contentforge_e2e \
  SESSION_SECRET=ci-e2e-session-secret-not-for-production \
  npx playwright test --reporter=line
docker compose -f docker-compose.e2e.yml down -v

# the live harness (needs the disposable DB name it guards on)
docker compose -f docker-compose.e2e.yml up -d --wait
docker compose -f docker-compose.e2e.yml exec -T postgres createdb -U e2e cf_e2e_live
E2E_LIVE_DATABASE_URL=postgresql://e2e:e2e@127.0.0.1:5433/cf_e2e_live \
E2E_LIVE_FIXTURE_PORT=8088 node script/e2e-live.mjs

# local app / VPS
make up        # local (http://localhost:3000)
make deploy-vps  # on the VPS: git pull --ff-only origin main, then up
```

## 6. New knobs added in this pass

- `SSRF_ADDITIONAL_ALLOWED_PORTS` — **additive** to the guard's `[80, 443]`,
  default unchanged, mirroring `RESEARCH_ALLOWED_HOSTS`. Exists so the E2E
  fixture can use a non-privileged port. Never set it in production.
- `E2E_LIVE_FIXTURE_PORT` — fixture host port for the harness (default 80).
- `VISUAL_ASSET_DIR` — where asset bytes live (default `uploads/visual-assets`).

## 7. Suggested next prompt

> Read `docs/HANDOVER.md` first. Finish E2E-2: fix the two stale phases in
> `script/e2e-live.mjs` (the queue-transient premise and the artifact
> approval/readiness contract), get the harness green locally with
> `E2E_LIVE_FIXTURE_PORT=8088`, then remove `continue-on-error` from the `live`
> job. Then do E2E-3 (the four lifecycle gaps) and E2E-4 (the VPS smoke suite +
> `make e2e` targets). Verify each fix by running it, not by reading it.
