# Live E2E verification (real running application)

ContentForge is verified at **three** layers. All three are kept:

```
        ┌─────────────────────────────┐
        │  LIVE / SMOKE (this doc)    │  real process, real HTTP, real pg-boss, real Postgres
        ├─────────────────────────────┤
        │  DB INTEGRATION (test:db)   │  real PostgreSQL, in-process wiring
        ├─────────────────────────────┤
        │  UNIT (test:unit)           │  fakes, no I/O
        └─────────────────────────────┘
```

| Layer | Command | Needs |
|---|---|---|
| Unit | `npm run test:unit` | nothing |
| DB integration | `npm run test:db` | `TEST_DATABASE_URL` (real Postgres) |
| Live E2E | `npm run test:e2e:live` | Docker, Postgres, `npm run build` |

## Automated live E2E

```bash
npm run build                                   # produces dist/index.cjs + dist/migrations
node script/e2e-live.mjs                        # or: npm run test:e2e:live
```

`script/e2e-live.mjs` never imports application code. It:

1. starts `e2e/fixture/rss-fixture.mjs` in Docker, publishing **host port 80**;
2. starts the real production bundle (`dist/index.cjs`) as a child process;
3. drives the real HTTP API with a session cookie + `x-csrf-token` (like a browser);
4. asserts durable state in PostgreSQL (public schema **and** `pgboss` schema);
5. kills and restarts the process mid-flight to prove recovery;
6. exercises transient retry and DLQ through real pg-boss state.

Database: `E2E_LIVE_DATABASE_URL` (default `postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live`).
The harness **refuses to run** unless the URL is `127.0.0.1:5433/cf_e2e_live`, so it can never
touch a remote database.

### Why the fixture listens on host port 80

`server/security/ssrf.ts` allows only `http`/`https` on ports **80/443**, and rejects URL
*IP literals* in non-routable ranges. A deterministic local fixture therefore has to be
fetched as a **hostname on port 80** — `http://localhost/...` (a hostname, so the syntax gate
passes; the RSS feed path uses `rss-parser`, not the guarded `safeFetch`). Docker publishes
port 80 without root, so the SSRF guard is never weakened for tests.

Fixture endpoints: `/feed.xml`, `/empty.xml`, `/flaky.xml`, `/flaky-long.xml`,
`/slow.xml?delay=N`, `/reset`, `/stats`, `/health`.

## Manual smoke procedure

Three terminals. This is the shortest path to watching the system work in real time.

**Terminal 1 — deterministic RSS fixture** (host port 80):

```bash
docker rm -f cf-rss-fixture 2>/dev/null
B64=$(base64 -i e2e/fixture/rss-fixture.mjs | tr -d '\n')
docker run -d --rm --name cf-rss-fixture -p 80:80 \
  -e FIXTURE_RUN=manual -e SCRIPT_B64="$B64" node:24-alpine \
  sh -c 'echo "$SCRIPT_B64" | base64 -d > /app.mjs && node /app.mjs'

curl -s http://localhost/health          # -> ok
curl -s http://localhost/feed.xml        # -> deterministic RSS with 3 items
```

**Terminal 2 — the real application** (production bundle):

```bash
export DATABASE_URL="postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live"

node dist/index.cjs                       # or: PORT=4199 npm start
# wait for: "database migrations applied" / "job runtime started" / "serving on port 5000"

# Keep research deterministic: drop the seeded public catalog and point at the fixture.
PGPASSWORD=cfpass psql -h 127.0.0.1 -p 5433 -U cfuser -d cf_e2e_live -c \
  "delete from rss_sources; insert into rss_sources (user_id,name,feed_url,is_active) values (1,'fixture','http://localhost/feed.xml',true);"
```

**Terminal 3 — drive the real API** (CSRF + session cookie):

```bash
BASE=http://127.0.0.1:5000            # or :4199 if you set PORT
JAR=/tmp/cf.jar; rm -f $JAR
TOKEN=$(curl -s -c $JAR $BASE/api/csrf-token | python3 -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])')

# 1. create a research job (HTTP only persists + enqueues; the worker runs it)
RESP=$(curl -s -b $JAR -X POST $BASE/api/research/jobs \
  -H 'content-type: application/json' -H "x-csrf-token: $TOKEN" \
  -d '{"kind":"directed","query":"kubernetes","providerIds":["rss"],"idempotencyKey":"smoke-1"}')
echo "$RESP"
JOB=$(echo "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# 2. watch it complete
curl -s -b $JAR $BASE/api/research/jobs/$JOB                # status -> complete, sourceCount/evidenceCount
curl -s -b $JAR $BASE/api/research/jobs/$JOB/sources        # provider=rss, retrievalMethod=feed
curl -s -b $JAR $BASE/api/research/jobs/$JOB/evidence       # origin=sourced, sourceId set

# 3. derive a Story (no re-research)
curl -s -b $JAR -X POST $BASE/api/stories \
  -H 'content-type: application/json' -H "x-csrf-token: $TOKEN" \
  -d "{\"researchJobId\":$JOB,\"title\":\"Smoke story\",\"insightBody\":\"Synthesis.\"}"
curl -s -b $JAR $BASE/api/stories/1
```

Expected: `POST /api/research/jobs` → `201 queued` → `GET` reaches `complete` with
`sourceCount: 3`, `evidenceCount: 3`; `POST /api/stories` → `201` with `evidenceRefs`
pointing at that job's evidence.

**Cleanup:**

```bash
docker rm -f cf-rss-fixture
```

## Runtime note

`npm run dev` uses `tsx` (ESM) and fails on Node 24 at `server/index.ts`'s `path.join(__dirname, "migrations")`
because `__dirname` is undefined in ESM. This is pre-existing and unrelated to the research/Story
slice. The supported runtime — used by production, Playwright E2E, and this harness — is the
**built CJS bundle**: `npm run build && node dist/index.cjs`.
