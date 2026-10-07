# HANDOVER — ContentForge

Written 2026-10-04 for the next agent. Branch: **`main`**, head **`67985c3`**,
pushed. Everything here is on `main` unless a line says otherwise.

**Read this file first, then §1 to get oriented in ~2 minutes.** If you only read
one more section, read **§4 What is pending** — that is the actual work.

---

## 0. What this product is

ContentForge is a **single-operator content intelligence and growth system**. It
finds research, turns it into evidence-backed stories, produces content through a
gated pipeline, publishes it to real platforms, and measures what happened.

There is exactly **one canonical lifecycle**, and nothing may bypass it:

```
Provider / Agent Reach → ResearchJob → Evidence/Story → Opportunity
  → GenerationPolicy → GenerationJob → Immutable Artifact → Approval
  → Schedule/Publication → Result
```

Three rules that shape every decision:

- **Transcript-first.** Never send whole videos to a multimodal model. Deterministic
  local code first, a cheap model for relevance, an expensive model only for
  high-value sections.
- **Truthful status vocabulary.** Never write "implemented / verified / published /
  healthy" unless the behaviour was actually observed. Use IMPLEMENTED /
  PARTIALLY IMPLEMENTED / VERIFIED LIVE / NOT VERIFIED / DEFERRED / BLOCKED.
- **Jev (TypeSafe) decides at boundaries only** — bounded typed questions, not
  continuous supervision. Code composes the scores.

---

## 1. Orient in two minutes (in this order)

```bash
make orient          # repo map + the docs index — one cheap call, start here
cat docs/README.md   # the index of every doc, tagged CURRENT or HISTORICAL
```

Then, depending on what you need:

| Question | Go to |
|---|---|
| How is it built today? | `CURRENT_ARCHITECTURE.md` (authoritative, "as built") |
| How does the decision layer work? | `JEV_DECISION_MAP.md` |
| **What does the pipeline actually look like?** | `docs/architecture/` — see §2 |
| What is broken / fixed? | `docs/LOCAL_E2E_ACCEPTANCE_REPORT.md` (F1–F16 + addendum) |
| How do I deploy? | `docs/LOCAL_VPS_DEPLOYMENT.md` |
| What do I do next? | **§4** of this file |

**Use the graph before grepping.** This repo is indexed:

```bash
graft ask "<question>" --source      # ranked nodes with the code spans inlined
graft skeleton <file>                # every definition + line span, ~10× cheaper than reading
graft callers <symbol>               # who calls this (--direction out for the reverse)
graft map                            # token-budgeted orientation, no LLM
make graph                           # rebuild the graph after big changes ($0)
```

`AGENTS.md` also warns: **filenames here are ambiguous** (14 `index.ts`, 13
`routes.ts`, 6 `storage.ts`). Always use repo-relative paths —
`server/content/storage.ts`, never `storage.ts`.

---

## 2. Archify — how to actually *see* the system

`docs/architecture/` holds diagrams generated with the **archify** skill
(`/Users/kishore/.commandcode/skills/archify`). They answer questions prose is bad
at, and they are the fastest way to load this system into your head.

**Read them** — the specs and the narrated guides are committed:

| Spec | Answers |
|---|---|
| `contentforge-overview.architecture.json` | The whole system: surfaces, services, data, boundaries |
| `contentforge-control-room.workflow.json` | The content lifecycle and its human gates |
| `execution/01-main-entry.sequence.json` | How a request actually enters and flows |
| `execution/02-data-lifecycle.data-flow.json` | How data lands, transforms and is consumed |
| `execution/03-decision-path.workflow.json` | Where Jev sits and what it decides |
| `execution/04-loop-map.workflow.json` | The feedback loops (learning, experimentation) |
| `execution/05-agent-trace.sequence.json` … `09-*` | Agent runs, Jev traces, last30days and the rest |
| `CONTENTFORGE_ARCHITECTURE_README.md`, `UNDERSTANDING_CONTENTFORGE.md`, `WORKFLOW_GUIDE.md` | The narrated versions |

**The generated HTML is deliberately NOT committed** — 18.6 MB of self-contained
files, versus 0.1 MB of specs that regenerate them. Rebuild any of them in one
command:

```bash
cd /Users/kishore/.commandcode/skills/archify

node bin/archify.mjs deliver architecture \
  /Users/kishore/git/ContentForge/docs/architecture/contentforge-overview.architecture.json \
  /Users/kishore/git/ContentForge/docs/architecture/contentforge-overview.architecture.html \
  --quality showcase --json
```

**Authoring a new one** — e.g. a sequence diagram of the live harness, or a
lifecycle of the publication state machine. Follow the skill's own rules:

1. Pick the type from the question — `architecture` (components/boundaries),
   `workflow` (processes, gates, runbooks), `sequence` (call chains),
   `dataflow` (pipelines/lineage), `lifecycle` (state transitions, retries).
2. Read ONE schema in `schemas/`, `schemas/common.schema.json`, and ONE example in
   `examples/`. Use them for **field shape, not facts** — author fresh IDs and
   wording. New workflows use `schema_version: 2`.
3. Write the candidate **first** — the next tool call is the write. One obvious main
   path, sparse labels, ≤12 primary nodes, `meta.quality_profile: "showcase"`. Do not
   pre-plan coordinates in prose, and do not add `via` / `channelX` / `labelAt` until
   a diagnostic asks for one.
4. Validate after every edit and immediately before handoff:
   ```bash
   node bin/archify.mjs validate <type> <candidate.json> --quality showcase --json
   ```
   A showcase pass must report **all 9 artifact checks, 0 composition errors, 0
   warnings**. A 4-check receipt is basic validation, not acceptance.
5. `deliver` is the final acceptance command and it **freezes** the spec — never edit
   it afterwards. A non-zero exit is never success.
6. Keep an existing workflow's fixed geometry on `schema_version: 1`; use v2 for new
   ones.

**Ground every diagram in real code, not vibes:** pull the facts with `graft ask` /
`graft callers` first and cite the `file:line` spans you used. A diagram that asserts
a pipeline the code does not have is worse than no diagram.

---

## 3. What is done and verified

Findings are `F*` from `docs/LOCAL_E2E_ACCEPTANCE_REPORT.md`; its addendum has the
earlier detail. Every row was **observed**, not inferred — the evidence is in the
commit message.

| Fix | Evidence |
|---|---|
| **F1** unknown `/api/*` → 404 JSON | verified live (was 200 HTML) |
| **F2** provider-media reachable by grant token | route + tests; the public surface did not widen |
| **F3** asset bytes are durable on the volume | **verified live by restart**: a durable asset refined successfully, while an in-memory-era asset still failed `asset "local:…" is unavailable` |
| **F4** owner can see their own asset | **verified live**: 200 `image/jpeg`, 443,177 bytes, `file(1)` = JPEG 1376×768; unauth 401, non-owned 404 |
| **F5** a dead generation settles its run (same tick) | reuses the scheduler's idempotent advance; only terminal failures nudge |
| **F6** long sources contribute several excerpts | 4 windows spread across the body, deterministic |
| **F7** rolling captions dedupe properly | the observed duplicated string is emitted once |
| **F8** Nano Banana (Gemini image) provider | **verified live** through the product path |
| **F11** Gemini key out of the URL | `x-goog-api-key`; the native-vs-gateway split is documented as deliberate |
| **F9/F12/F13/F15** env docs, dead tasks pruned, `b64_json`, intake fields | unit-level |
| **Pool test** the 996/997 was an environment artifact | the local `.env` `DATABASE_URL` is a Neon **pooler**; against a direct DB it passes 26/26. It now prefers `TEST_DATABASE_URL` and skips loudly when pooled |
| **E2E-1** the red Playwright job | 3 specs targeted **removed surfaces** (`/ideas`, `/references`, `/discover` are read-only views / redirects); the rest was parallel-load contention (workers capped) plus a shared-user state leak (accounts now pinned). **275 passed, 1 flaky, 0 failed** |
| **E2E-2 (partial)** the live harness could not run *at all* | 4 defects fixed: it never authenticated (it relied on the removed owner-1 fallback), its seeds hardcoded `user_id = 1`, the fixture's dates had **expired** (2026-09-01..03 against a `last_30d` window), and it required host port 80 |

**Deferred on purpose** — do not "fix" these opportunistically:
**C4/F16** — the body parser sits before CSRF because `auditLog` hashes
`req.rawBody`; reordering would empty that hash for a cosmetic error-code gain.
**F14's remaining ~150 legacy handlers** — the publish/media paths are done; the rest
is a file-wide pattern.

---

## 4. What this pass closed, and what is still open

Checked against CI job 112326333110 (workflow run 37480293942, commit `c87fb04`)
and against a local re-run. The two phases below were already green in that CI
job. The one red check was a stale assertion.

### 4a. Live harness

`script/e2e-live.mjs` boots `dist/index.cjs`, points external calls at
`e2e/fixture/rss-fixture.mjs`, and asserts Postgres and pg-boss.

1. Queue-transient. `first attempt fails transiently and a retry is durably scheduled`
   passed in CI and again in the local re-run (`error_class=transient`, queue state
   `retry`).
2. Artifact approval. `draft → in_review → approved` passed. The next schedule step
   did not return 409.
3. The remaining CI failure was `must not advertise unsupported YouTube`.
   `youtube:video` is a registered format profile and a registered adapter. The
   harness now requires that pair (`script/e2e-live.mjs`).

`continue-on-error` is gone from the `live` job in `.github/workflows/e2e.yml`.
A GitHub run of that job after the removal has not been observed.

Reproduce with `make e2e-live`. The harness still refuses any database other than
`postgresql://e2e:e2e@127.0.0.1:5433/cf_e2e_live`. The fixture port is 8088 (§6).

### 4b. Lifecycle checks

- Discover intake. `e2e/research-intake.e2e.spec.ts` fills the query, clicks
  **Start Research**, and waits until a `research_sources` row has canonical URL
  `https://example.com/contentforge-ui-intake`. The Playwright database has no
  feed, so the spec serves one on `localhost:8088` and inserts `rss_sources`.
  RSS search keeps an item only when the query text appears in the item, so the
  feed title is the query. Measured 2026-10-06. Research job 6 status `complete`.
  Playwright `2 passed (5.8s)`.
- Media bytes across SIGKILL (F3), a generation that dead-letters and fails the
  owning run (F5), and a provider-media grant (F2) are checks at the end of
  `script/e2e-live.mjs`. Run `livemuwvwbiz` passed all three. A grant is
  time-bounded. A second fetch in the same process returns 200. After SIGKILL
  the same URL returns 404. It is not single-use. Making it single-use would
  break a provider retry and would contradict `server/content/visualStorage.test.ts`.
- Context vault rows in that harness are inserted for `ownerId`. A reused
  `cf_e2e_live` database registers a new user each run. Inserting them for
  user 1 made the context checks fail on the second run (owner was user 5)
  and pass on the next run.

### 4c. Smoke targets

`make e2e`, `make e2e-live`, and `make e2e-vps` exist.

`make e2e-vps` runs `script/e2e-vps-smoke.mjs`. It does not deploy. On this Mac
on 2026-10-06 it passed against local listeners. `ss` here is a broken
iproute2mac binary, so the script falls back to `lsof`. Ports 3000 and 5432
were `127.0.0.1` via `gvproxy`. `/api/health` and `/api/ready` returned 200.
HEAD matched `origin/main` (`c87fb04`). The tunnel was not checked because
`CONTENTFORGE_PUBLIC_URL` was unset. That Mac run is not VPS verification.
On 2026-10-07 the VPS itself was deployed and checked. See §5.

`make e2e` was re-run on 2026-10-07. 275 passed, 2 flaky, 2 skipped, 0 failed, exit 0.
The flaky specs are `e2e/agent-publish.e2e.spec.ts` and `e2e/dialog-focus.e2e.spec.ts`.
Both passed on retry.

### 4d. Known, non-blocking

- `e2e/agent-publish.e2e.spec.ts` and `e2e/dialog-focus.e2e.spec.ts` were flaky
  on the 2026-10-07 full run. Both passed on retry. The suite exit was 0.
- `insights`, `settings-labels`, `full-product-audit` and `discovery-ownership` were
  load-flaky, not broken — all pass in isolation. The worker cap fixed the full-suite
  run; watch it if a suite gets slower.

---

## 5. State of everything (updated 2026-10-07)

```
branch            main @ c87fb04. Local harness, workflow, and doc edits are
                  uncommitted. origin/main is still c87fb04.
unit suite        1034 passed, 0 failed, 0 skipped, exit 0
                  DATABASE_URL and TEST_DATABASE_URL were the e2e Postgres
                  on 127.0.0.1:5433/contentforge_e2e. A run with neither set
                  exits 1 because server/db.ts throws at import.
tsc               exit 0
Playwright        make e2e: 275 passed, 2 flaky, 2 skipped, 0 failed, exit 0
live harness      livemuxk64c9: 193 passed, 0 failed, exit 0
                  log /tmp/cf-e2e-live-rerun4.log
                  The earlier livemuwxqv7y run (132 passed, 61 failed) happened
                  while the host clock ran ~10 minutes ahead of the Docker
                  Postgres clock. The same checks passed once the clocks matched.
                  waitFor uses a monotonic deadline and reports elapsed time.
CI                continue-on-error is removed in the working tree only.
                  origin/main still has continue-on-error: true on the live job.
                  No GitHub run of the blocking job has been observed.
VPS               VERIFIED 2026-10-07. make deploy-vps on 129.159.224.196
                  fast-forwarded 67985c3 to c87fb04. Loopback /api/health and
                  /api/ready returned 200. ss showed 127.0.0.1:3000 and
                  127.0.0.1:5432. The public URL returned the same uptime as
                  the new process, so the tunnel is the ingress.
Railway           decommissioned: files deleted, repo secrets deleted
docs/architecture unchanged this pass
```

---

## 6. Environment traps (each of these cost real time)

- **Your local `.env` `DATABASE_URL` is NOT the compose database.** It points at a
  **Neon pooler** (`…-pooler…neon.tech`). Anything that sources `.env` talks to the
  cloud DB, and pool-dependent tests misbehave there. Run tests against a direct DB:
  ```bash
  DATABASE_URL=postgresql://cfuser:cfpass@127.0.0.1:5432/contentforge \
  TEST_DATABASE_URL=postgresql://cfuser:cfpass@127.0.0.1:5432/contentforge \
    npm run test:unit
  ```
  The compose app overrides `DATABASE_URL` to its own service, so the running app is
  unaffected.
- **Dory owns host port 80** on this Mac, so the E2E fixture cannot publish there — use
  `E2E_LIVE_FIXTURE_PORT=8088`. CI uses 8088 too.
- **The real `.env` is gitignored**, so a fresh clone has none and compose fails with a
  bare `env file … not found`. Either `cp .env.example .env`, or keep it outside the
  repo: `CONTENTFORGE_ENV_FILE=$HOME/.contentos/contentforge.env make vps` (absolute
  path — compose does not expand `~`). `make up`/`make vps` now preflight this and
  explain it. The real file exists on the VPS — copy it, don't rebuild it.
- **macOS `say` has no voice data here** (it writes a header-only 4096-byte AIFF), so
  the live speech check skips loudly with that reason. Install the voice to run it.
- **Paid media**: `CONTENTFORGE_ALLOW_PAID_MEDIA` (+ `GEMINI_IMAGE_MODEL`) is set
  locally only; deliberate OFF on the VPS, so image generation ships there but makes no
  paid calls until you enable it.

---

## 7. Running and deploying

```bash
# Playwright in the CI shape (no .env, ephemeral DB, production bundle)
docker compose -f docker-compose.e2e.yml up -d --wait
npm run build
DOTENV_CONFIG_PATH=/dev/null CI=true \
  DATABASE_URL=postgresql://e2e:e2e@127.0.0.1:5433/contentforge_e2e \
  SESSION_SECRET=ci-e2e-session-secret-not-for-production \
  npx playwright test --reporter=line
docker compose -f docker-compose.e2e.yml down -v

# local app / VPS
make up            # http://localhost:3000
make deploy-vps    # ON the VPS: git pull --ff-only origin main, then up
make ps | make logs | make backup | make restore FILE=backups/<file>.sql
```

**One app process runs web + workers + schedulers.** Never add a second "worker"
container — it would double-run the schedulers and the queue consumers.

**Deployment is always from `main`.** There is no deploy branch and no Railway. Every
published port is bound to `127.0.0.1`; Cloudflare Tunnel is the only ingress (DNS +
tunnel + ingress only — no Workers/D1/R2 in ContentForge).

Knobs added in this pass: `CONTENTFORGE_ENV_FILE` (env file location),
`E2E_LIVE_FIXTURE_PORT`, `VISUAL_ASSET_DIR`, and — additive only, default still
`[80, 443]` — `SSRF_ADDITIONAL_ALLOWED_PORTS` (never set it in production).

---

## 8. Suggested next prompt

> Read `docs/HANDOVER.md` first. Do not redo the live harness, the unit suite,
> Playwright, or the VPS deploy. Those were measured on 2026-10-07. The open
> work is to commit the local workflow change and watch a GitHub live job that
> no longer has `continue-on-error`. That job is blocking only in the working
> tree. `origin/main` still has `continue-on-error: true`.
