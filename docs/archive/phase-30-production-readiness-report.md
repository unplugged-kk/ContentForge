# Phase 30 Production Readiness + Launch Gate

**Branch:** `replit` · **HEAD at audit start:** `494f944` · **PR #3:** open, unmerged (kept unmerged per phase discipline)
**Classification:** GO WITH EXPLICIT MITIGATIONS (see §34)
**Scheduler:** NOT implemented in this phase — verified absent (see §33)

---

## 1. Executive Summary

ContentForge was audited as a production system across 27 capabilities: deployability,
configuration, secrets, auth, tenant isolation, database, backup/restore, jobs, failure
semantics, providers, publication safety, artifact integrity, autonomy safety, human
controls, kill switch, agent boundary, observability, alerting, security, SSRF, performance,
deployment/rollback, CI/CD, UX, runbooks, and disaster recovery.

**Found and fixed in this phase (6 fixes, all with regression tests + live verification):**

| # | Defect | Severity | Fix |
|---|--------|----------|-----|
| F1 | Prod booted with publicly-known default `SESSION_SECRET` (fail-open) — `server/index.ts:134` | **High** | Fail closed in production; `resolveSessionSecret` throws |
| F2 | No liveness/readiness endpoint; Railway healthcheck probed static `/api/auth/config` (200 even with DB down) | **High** | `GET /api/health`, `GET /api/ready` (DB `SELECT 1`, up/down only); healthcheck repointed; Dockerfile `HEALTHCHECK` |
| F3 | `/api` access log serialized full response bodies incl. tokens | **Medium** | Key-name redaction before logging |
| F4 | Logout destroyed the server session but left the cookie set | **Medium** | Clear `connect.sid` + destroy; always responds success |
| F5 | Legacy ingestion fetched caller URLs with raw `fetch` (SSRF: literal internal IPs, `localhost`, metadata, redirects, DNS rebinding) — `extractRedditThread`, `extractGenericWebpage`, `POST /api/vault/extract-url` | **High** | Migrated to `safeFetch` (guarded DNS + per-hop revalidation + caps); blocked URLs now 400 |
| F6 | Railway healthcheck + Dockerfile lacked real readiness signal | **Medium** | Repointed to `/api/ready`; added `HEALTHCHECK` |

**Remaining launch-relevant findings:**

- **B1 (BLOCKED with mitigation): tenant isolation / auth enforcement on the legacy API.**
  `server/routes.ts` (~120 handlers: posts, ideas, articles, references, analytics, vault,
  social, schedule) performs no authentication and no ownership checks; unauthenticated
  callers read/write everything as user 1, including `POST /api/posts/:id/publish` (real,
  paid external side effect). The newer lifecycle slices (research, stories, content,
  autonomy, agent) are owner-scoped but still authenticate optionally (`getUserId(req) ?? 1`).
  Reproduced live: unauthenticated `GET /api/posts` returned all rows. Enforcing auth
  across the legacy surface is an authentication-architecture change — a STOP condition —
  so it is **documented, not fixed**, in this phase. Safe mitigation M1 (single-tenant
  gated operation) is defined in §34.
- **M2 (READY WITH MITIGATION): no push alerting** for circuit-breaker-open /
  budget-exhausted / DLQ growth. State is API-visible only; acceptable for a
  single-operator, max-1-action/day operating model with runbook polling (§18, §25).
- **M3 (READY WITH MITIGATION): RPO/RTO are operator-owned.** App-side restore was
  proven (backup → fresh DB → migrate no-op → boot → ready → data reads, §9); wall-clock
  RPO/RTO depend on Railway Postgres backup configuration, which is not in this repo.

No P0/P1 UX blockers (Phase 29.5 stands). No destructive/unsafe migrations. No committed
secrets. Publication safety (idempotency + lease + reconcile-first-unknown) verified in
code. Artifact immutability enforced by DB trigger. Autonomy gates + kill switch verified
by 20/20 dbtests. Agent/autonomy boundary holds (static denial tests).

---

## 2. Repository State

- `git status`: clean except untracked `.commandcode/`, `.gemini/` (tooling dirs, untouched).
- `git log --oneline --decorate -30`: HEAD `494f944` (JEV docs) on `replit`, tracking
  `origin/replit`. Verified checkpoints present: `e66630b` (29.5), `9c67f65` (29.4 audit),
  `30701ed` + `94ddeaf` (29.4), `007e437` (29.3).
- Branches: `replit` active; no divergence (`up to date with origin/replit`).
- PR #3: open, unmerged — left unmerged per phase discipline.
- No uncommitted work from another task; no unexpected divergence.
- JEV-*.md files at root: read-only exploratory audit for a possible future
  decision-engine integration — design only, nothing implemented, not acted on.

**Environment note (carried from handoff, confirmed):** `.env` `DATABASE_URL` points at Neon
(cloud), NOT suitable for tests. All verification below used local Docker Postgres with
`DATABASE_URL`/`TEST_DATABASE_URL` exported explicitly plus `SESSION_SECRET`. E2E ran
against an isolated database (`cf_e2e2`) so it could not contend with the DB suite.

---

## 3. Production Architecture Summary

- **Runtime:** Express 5 + Vite SPA, single Node 20 process. Prod: `NODE_ENV=production
  node dist/index.cjs` (esbuild CJS bundle, `script/build.ts`; migrations copied to
  `dist/migrations`).
- **Data:** PostgreSQL 16 (Drizzle ORM). 31 migrations (`0000`–`0030`), all additive.
  pg-boss v10 (in-Postgres queue, schema `pgboss`, self-created at runtime — deliberately
  outside Drizzle migrations) is the ONLY durable queue.
- **Triggers:** node-cron legacy schedulers (publish-due tick, briefings, discover —
  kill-switchable via `DISABLE_*`) + one pg-boss-backed durable content tick. No other
  background loops; **no Phase 30 scheduler exists** (verified by grep: only
  `server/scheduler.ts` + `startContentScheduler`, both pre-existing).
- **Canonical lifecycle:** ResearchJob → Story → Opportunity → GenerationJob → Artifact
  (immutable revisions) → Approval → Schedule → Occurrence → Publication (pinned revision,
  idempotency key, lease) → Result (unknown-first) → Insights → Learning →
  Experiment → PolicyCandidate → GenerationPolicy (immutable revisions, one active per key).
- **Autonomy (29.4):** deterministic controller; may only activate/rollback through the
  Phase 29.3 service; 14-gate eligibility chain; per-owner `SELECT … FOR UPDATE`
  serialization; every evaluation journaled to `autonomy_decisions`.
- **Deploy targets:** Dockerfile (2-stage) + Railway (nixpacks, `railway.toml`) +
  `docker-compose.yml` (local). CI: `deploy.yml` (typecheck → railway), `e2e.yml`
  (postgres service → migrate → check → build → playwright), `migration-guard.yml`,
  `prod-migrate.yml`. Server ALSO auto-migrates at boot (defense in depth).

Documentation-vs-code contradictions found: (1) middleware referenced `/api/health` in
skip-lists but the route did not exist (fixed — F2); (2) docs implied readiness coverage
that did not exist (fixed — F2/F6). No other contradictions material to launch.

---

## 4. Deployment Readiness

Clean-environment reproduction verified end-to-end on this machine:

1. `npm ci` — clean.
2. `npm run check` (tsc) — clean.
3. `npm run build` — clean (`dist/index.cjs` 4.0 MB, migrations copied).
4. `npm run db:migrate` against an empty database — 31/31 applied.
5. `NODE_ENV=production node dist/index.cjs` — boots: session DDL → migrations →
   seed → pg-boss runtime → routers → schedulers → listen. Verified on ports 4173/4175.
6. `GET /api/health` → `{"status":"ok","uptimeSec":N}` (NEW, F2).
7. `GET /api/ready` → `{"status":"ready","checks":{"database":"up"}}` HTTP 200 (NEW, F2).
8. Authenticated-shape request: unauthenticated `GET /api/posts` returns rows (this is
   finding B1, not a deploy failure — the app serves traffic correctly).
9. Database request through the app: verified (`/api/posts`, `/api/ready` SELECT 1).

Production dependencies (all documented, none added): Node 20, PostgreSQL 16,
`DATABASE_URL`, `SESSION_SECRET` (now required in prod — F1), `ENCRYPTION_KEY`
(recommended — see §5), optional provider keys (XQUIK, AI, media, social — all degrade
to disabled when absent). Reverse proxy: `trust proxy = 1` (correct for Railway).
Cookies: `httpOnly`, `sameSite=lax`, `secure` in prod ( weaknesses: 30-day fixed expiry,
no idle timeout, no rotation on login — noted in §6, non-blocking for single-operator).

---

## 5. Configuration / Secrets Audit

### 5.1 Classification

| Value | Class | Behavior when missing |
|---|---|---|
| `DATABASE_URL` | SECRET, REQUIRED | Throw at import (`server/db.ts:5-9`) — fail closed ✓ |
| `SESSION_SECRET` | SECRET, REQUIRED | **Was fail-open; now throws in prod (F1)** ✓ |
| `ENCRYPTION_KEY` | SECRET, RECOMMENDED | Lazy; falls back to `scrypt(SESSION_SECRET)` — `.env.example` warns prod must set a stable dedicated key (rotating SESSION_SECRET would silently invalidate stored tokens). Late-fail (first secret write/read, not boot) — accepted, documented |
| `AI_API_KEY`/`OPENAI_API_KEY` | SECRET, REQUIRED for AI | Throw at boot unless `CI`/`CONTENTFORGE_E2E_SERVER` placeholder — fail closed ✓ |
| `XQUIK_API_KEY`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_*_TOKEN`, `THREADS/INSTAGRAM/LINKEDIN_ACCESS_TOKEN`, `FAL_KEY`, `ELEVENLABS_API_KEY`, `OPENSEO_API_KEY` | SECRET, OPTIONAL | Degrade to disabled/unconfigured, never throw ✓ |
| `PORT`, `UPLOADS_DIR`, model IDs, timeouts, `DISABLE_*`, `CRON_TZ`, `X_THREAD_FINISHER` | PUBLIC/OPTIONAL | Sane defaults ✓ |

### 5.2 Secrets scan

- `.gitignore` covers `.env` (verified untracked); only `.env.example` (placeholders) is tracked.
- Tree + `git log -S` history scan for `BEGIN PRIVATE`, `ghp_`, `sk-` values, `api_key`
  values, passwords: **no live secrets**. Hits are redacted placeholders, field names,
  the E2E placeholder key, and local-only `cfuser/cfpass` compose dev creds.
- No secret in logs/API/errors/audit/client after F3 (audit log stores body SHA-256 only;
  error handler sanitizes 5xx; social status endpoints expose boolean presence flags only).
- `docker-compose.yml` ships `SESSION_SECRET: change-me-in-production` — known-weak,
  local-dev only; flagged as an operational note (override in any shared environment).

---

## 6. Authentication / Authorization

Primitives are sound; **enforcement is the gap (B1)**:

- Passwords: scrypt + `timingSafeEqual` (`server/auth.ts:10-21`); emails lowercased.
- Sessions: Postgres store (`connect-pg-simple`), `httpOnly`/`lax`/`secure-in-prod`.
- CSRF synchronizer tokens on non-GET (except `/api/auth/*`, webhooks); coherent with
  SameSite=lax. Rate limits: global 100/min, auth 10/min, publish 30/min.
- `/api/auth/me` correctly 401s without session. Login/register responses contain no
  secrets.
- Hardening gaps (non-blocking, single-operator): no session regeneration on login
  (fixation), 30-day fixed expiry with no idle timeout, Google OAuth links by email
  without an email-verified check, `secure` cookies require `trust proxy` (correct).
- **Authorization (B1):** `requireAuth`/`requireUserId` exist but have zero call sites;
  legacy `server/routes.ts` handlers take `_req` (no user) or `sessionUserId(req) ?? 1`.
  Newer routers scope by owner but authenticate optionally. Fixing this is an
  authentication-architecture change → STOP condition → documented with mitigation M1,
  not re-engineered in this gate.

---

## 7. Tenant Isolation

**Verdict: BLOCKED with mitigation M1 (B1).**

- Attempted cross-owner access analytically across stories, opportunities, generation
  jobs, artifacts, revisions, publications, experiments, evaluations, policy candidates,
  generation policies, autonomy config/decisions, audit records, connected accounts:
  legacy API has NO owner predicate anywhere (storage implementations ignore `userId`;
  e.g. `server/storage.ts:160-202` filter by id only). Newer slices enforce
  `row.userId !== ownerId → 404` (research `loadOwnedJob`, agent `getRunForOwner`,
  autonomy controller + routes) — but all sit behind optional auth (`?? 1`), so an
  unauthenticated caller IS owner 1.
- Reproduced live: `GET /api/posts` with no session returned all rows including
  `userId` fields.
- UI restrictions alone were not relied upon at any point in this audit.
- **Mitigation M1:** operate strictly single-tenant (one owner) with no open
  registration and network-level access control until the auth-enforcement follow-up
  lands. Transition to NO-GO: a second tenant is onboarded, or the app is exposed
  without access control, before enforcement ships. Owner: auth-enforcement phase
  (requires human approval per STOP conditions).

---

## 8. Database Readiness

- Schema: FKs + unique constraints + indexes verified on hot paths (`0007`: artifact
  lineage, publication idempotency/artifact/schedule indexes, `schedule×time` unique,
  `results.publication_id` unique; `0009`: due indexes; `0016/0019/0029/0030`:
  automation idempotency, intent keys, one-active-per-key partial unique).
- Migrations: 31 files, **zero destructive operations** (no DROP/TRUNCATE/rewrite;
  additive CREATE/ADD/INDEX only). No lock-heavy patterns (no concurrent-index builds
  needed at current scale; no backfills over large tables — the 0029 backfill touches
  latest-version-per-key only).
- Large-DB migration risk: LOW. No table rewrites; all migrations are fast DDL.
- Nullable/defaults reviewed: no unsafe defaults found; readiness lifecycle
  (`draft→in_review→approved|rejected`) enforced in service + trigger.
- Pool: pg defaults (max 10) on a single-process server — adequate for the operating
  model; monitor `pg_stat_activity` under load (runbook §25).

---

## 9. Backup / Restore

**Verdict: READY (app-side restore proven; wall-clock RPO/RTO operator-owned — M3).**

Mechanism: Postgres backup (operator-owned: Railway managed backups / `pg_dump`).
Restore **verified live in this phase** (not merely documented):

1. `pg_dump -F custom` of the live-verify DB → 449 KB artifact.
2. `pg_restore` into fresh empty database `cf_restore` (one benign version-quirk
   warning: `unrecognized parameter "transaction_timeout"` — ignored, exit 0).
3. Migration journal intact on restore: 31/31 rows in `drizzle.__drizzle_migrations`.
4. `npm run db:migrate` against restored DB — clean no-op path; server boot applied
   migrations and started (`database migrations applied`, pid serving).
5. `GET /api/ready` → 200 `ready`; `GET /api/posts` returned the pre-backup rows
   (data survived byte-identical on sampled endpoints).

Retention/encryption/storage location for automated backups live with the platform
(Railway) — recorded as limitation M3, not invented here. Recommended operator action:
confirm Railway backup retention + test a platform-level restore quarterly (runbook §25).

---

## 10. Job / Queue Readiness

pg-boss is the queue (no Redis/BullMQ; verified no second scheduler abstraction added).

- Queues: `research.run`, `generation.run`, `publication.run`, `visual.run`,
  `video.repurpose`, `style.analyze`, `automation.run`, `analytics.refresh`,
  `learning.extract`, `agent.run` — **all payloads are durable IDs**, never blobs
  (explicit code comment at `server/content/service.ts:455-459`).
- Envelope: versioned `{jobId, jobType, schemaVersion:1, correlationId, idempotencyKey,
  createdAt, attempt, payload}`; invalid envelopes dead-letter (`invalid_envelope`).
- Retry semantics: transient → pg-boss retry with backoff then auto-DLQ;
  rate_limited → requeue with `startAfter` WITHOUT consuming an attempt;
  permanent/policy_human → `<jobType>.dlq` copy + complete. Unknown errors default
  transient (safe direction: retry, never silent drop).
- Idempotency: `singletonKey: idempotencyKey` on every send (best-effort) with domain
  UNIQUE constraints as authoritative arbiter (registry documents this correctly).
- Restart recovery: correctness state in Postgres (leases, idempotency keys, conditional
  UPDATEs); crash-before-commit = zero partial state (single txn); crash-after-commit =
  at-least-once with idempotent re-execution.
- Stuck jobs: pg-boss expiry (15m default) + singleton windows; DLQ per queue.
  **Gap:** no push alert on DLQ growth — covered by M2 polling.

---

## 11. Failure / Recovery Semantics

Audited per operation (SUCCESS / FAILED / UNKNOWN / retryable / permanent /
reconciliation-required):

| Operation | Semantics |
|---|---|
| Research | Job row is source of truth; transient → retry, permanent/policy → DLQ; provider health store cools down failing backends (3 fails → 60s→30m) |
| Generation | `retry != regenerate`: retry re-executes the SAME frozen policy snapshot + idempotency key, never a new lineage |
| Media | Paid `generate()` hard-blocked without cert flags; budget exhaustion → permanent (no spend loop) |
| Publication | **UNKNOWN is first-class**: `providerCalled=true` rows park as `unknown` Result, never blindly retried; bounded reconcile (max 5) reuses the SAME row; stale leases park unknown |
| Scheduling | Overlap-safe, idempotent tick; correctness in PG |
| Experiment evaluation | Deterministic; `insufficient/observed/directional` evidence never qualifies |
| Policy activation | Idempotent `identityKey=activate:<candidateId>`; concurrent same-key → 409; budgets/cooldown/churn/oscillation lock-serialized per owner |
| Rollback | Append-only re-activation of prior revision; 2nd autonomous rollback in 24h opens breaker |

DB failure modeling: unavailable at boot → migrate throws → crash (fail-closed, detected
by F2 readiness); runtime loss → `/api/ready` 503s, in-flight txns roll back, pg-boss
retries with backoff; pool exhaustion → pg defaults (max 10, single process) adequate for
operating model. Deadlock/serialization: per-owner `SELECT … FOR UPDATE` (29.4 fix)
serializes the only contended path.

---

## 12. External Provider Readiness

- AI: single OpenAI-compatible gateway (OpenAI/OpenRouter/Ollama via env); no client-side
  timeout on `aiCall` (relies on caller/job expiry) — noted, non-blocking (job expiry
  10–15m bounds it).
- Media/social: per-provider timeouts (30s X/LinkedIn/Threads/Instagram; 20s/30s/10m
  YouTube), normalized error taxonomy (`transient` / `permanent` / `policy_human`),
  human-readable messages, secret redaction in translators.
- Honest gaps DOCUMENTED in code (not hidden): LinkedIn/YouTube have no provider
  idempotency key — duplicate suppression rests on ContentForge's own
  `Publication.idempotencyKey` + pg-boss dedup + lease; X media re-upload on retry
  may duplicate the asset (not the post).
- Failure injection reviewed statically (timeout/rate-limit/auth/invalid/malformed/
  outage/partial-success/disconnect-after-request/duplicate-submission): all funnel into
  the normalized taxonomy; provider specifics do not leak into domain semantics
  (human translators at the adapter edge).
- AI provider outage ⇒ generation jobs fail transient → pg-boss retry → DLQ; nothing
  auto-regenerates with a different policy.

## 13. Publication Safety

**Verdict: READY.** Three-layer duplicate prevention: (1) UNIQUE
`publications.idempotency_key` + `claimPublication` insert-`onConflictDoNothing`
(only the creator enqueues); (2) pg-boss `singletonKey`; (3) single-flight lease via
atomic conditional UPDATE excluding `published`/`cancelled`.
Key format pins the exact revision:
`` `publication:${scheduleId}:${occurrenceId}:${artifactId}` ``.
Connection-lost-after-accept ⇒ parked `unknown`, bounded reconcile (max 5) reusing the
SAME row with ephemeral queue-key suffixes (never persisted). Result terminal states
guarded (`insertResult` upserts into `unknown` only; `published`/`failed` never
overwritten). Historical `published` rows: mutation-safe by lease predicate + early
no-op returns (no DB-level freeze trigger — recorded limitation, no evidence of
violation).

## 14. Artifact / Historical Data Integrity

**Verdict: READY.** DB trigger `artifacts_no_content_mutation` blocks UPDATE of content
columns (raises instructing new-revision creation); only `readiness` mutates via
`setArtifactReadiness`. Human edits = new rows (`human_edit` provenance, re-enter at
`draft`). Policy A → Generation 1 → Policy B activated ⇒ Generation 1 still references
Policy A (proven by Phase 29.3 lineage tests). Visual refs pinned by (asset id +
revision) with durable audit rows.

## 15. Autonomous Optimization Safety

**Verdict: READY.** All 14 gates verified in `server/content/autonomy/controller.ts`
(kill switch, mode, breaker, automation flags, ownership, scope allowlist, field
allowlist, evaluation existence, evidence floor with hard `repeatable` minimum,
guardrails double-check, budgets, cooldown, churn, oscillation). Autonomous activation
passes the complete server-side controller → existing 29.3 service; zero direct
`generation_policies` writes (deep-audit enumerated exactly 2 writers, both in 29.3
service). Safe defaults deny when unconfigured. 20/20 dbtests incl. concurrency race.

## 16. Human Controls / Kill Switch

**Verdict: READY.** Operator can: disable/pause via API + Insights UI card, inspect
config/status/current policy/active mode/decisions/evidence/lineage/rollback/breaker,
human-reset the breaker. Human-gated 29.3 operations are unaffected by autonomous flags
(separate service, separate `actor` values). Kill switch: `enabled=false` ⇒
`evaluateActivationEligibility` denies before any other gate; history intact
(append-only journal). No bypass path found: single controller entry, agent-denial
static tests, no legacy endpoint reaches activation (verified by grep over all
`activatePolicyCandidate` callers: 29.3 human route + 29.4 controller only).

## 17. Agent Boundary

**Verdict: READY.** Re-verified by grep + static tests
(`autonomyDenial.test.ts`, `policyActivationDenial.test.ts`, both passing): no file under
`server/agent/` references the autonomy controller, activation service, or config
mutators; no tool declaration exposes activation. Agent orchestrates approved workflows
only.

## 18. Observability / Alerting

**Verdict: READY WITH MITIGATION (M2).** Operator CAN answer all §20 questions via:
`/api/health`, `/api/ready`, per-domain status endpoints, research `healthSnapshot`,
autonomy status/decisions/breaker/budget state, audit log, pg-boss DLQs, sanitized
error handler. **Gap: no push alert** for breaker-open / budget-exhausted / DLQ growth
(grep for sentry/pagerduty/slack/webhook: zero). M2: acceptable for single-operator,
max-1-action/day model with runbook polling (§25: poll `/api/autonomy/status` +
`/api/autonomy/decisions` daily; inspect DLQs weekly). NOT auto-built per phase
instructions. Transition to NO-GO: autonomous action volume grows beyond daily polling
(e.g., scheduler phase shortens the budget window) before push alerting ships.

## 19. Security Audit

**Verdict: READY WITH MITIGATION (M1 covers the auth gap; all else READY).**
Helmet (prod CSP, HSTS, frame-deny, noSniff), no CORS middleware (same-origin by
default), CSRF synchronizer + lax cookies, 3-tier rate limiting, DOMPurify on HTML
persistence, multer allowlist + magic-byte validation, zod on write paths, parameterized
ORM (no raw-SQL injection surface found), sanitized 5xx handler, audit log without
bodies. Research SSRF boundary strong; legacy bypass FIXED (F5, live-verified). Connected
accounts: tokens encrypted at rest (AES-256-GCM), API responses masked. Uploads served
statically without auth — noted under M1 (same exposure class as legacy API).

## 20. SSRF / Input Security

**Verdict: READY (after F5).** `server/security/ssrf.ts`: RFC1918/loopback/link-local/
CGNAT/metadata/IPv6-mapped blocks, http(s) only, no credentials, port allowlist 80/443,
literal-IP rejection, connect-time guarded DNS (rebinding-safe), per-hop redirect
revalidation (max 3), 512 KB/10 s ceilings. Live-verified: metadata IP, localhost:port,
and private IP all → 400 with no outbound request; public URL proceeds normally.
Representative classes tested: localhost ✓, loopback ✓, private IPs ✓, link-local/
metadata ✓, unusual ports ✓, redirects ✓ (existing `ssrf.test.ts` covers redirect-to-
metadata + DNS-to-blocked). DNS-rebinding window closed by connect-time lookup.
Regression guard: `legacyFetchDenial.test.ts` fails the build if a raw user-URL fetch
returns to `server/routes.ts`.
## 21. Resource / Performance Readiness

**Verdict: READY (risks measured, none blocking).** No synthetic scale requirements
invented; practical review only:

| Concern | Evidence | Impact | Mitigation | Blocker? |
|---|---|---|---|---|
| DB connections | pg defaults (max 10), single process + pg-boss workers share the pool | fine for single-operator | monitor `pg_stat_activity` | NO |
| Expensive queries | due-dispatch + analytics aggregations indexed (`schedules_due_idx`, `publications_*_idx`) | low | — | NO |
| N+1 | analytics insights loop in JS over small sets; bounded by posted counts | low | — | NO |
| Job throughput | per-owner locks serialize autonomy only; content queues independent | low | budgets are the valve | NO |
| API latency | p95 dominated by AI provider calls (async jobs, not request path) | low | — | NO |
| Memory/CPU | 4 MB bundle; no in-memory caches except bounded provider-health store | low | — | NO |
| Log growth | per-request access log, stdout (platform-rotated on Railway) | low | — | NO |
| Provider quotas | X monthly read budget tracked + warned in-product (`x-usage`) | low | — | NO |

Resource exhaustion degrades gracefully: rate limits shed load, job expiry bounds
stuck work, budgets bound spend, DLQs park poison. No elaborate infra justified.

## 22. Deployment / Rollback

**Verdict: READY.** Deploy: `deploy.yml` (typecheck → `railway up`) or Docker image;
migrations run at boot (idempotent journal) with `prod-migrate.yml` as ordering
control. Rollback: `railway rollback` / previous image; all 31 migrations are additive
→ app/schema versions coexist safely (old code ignores new nullable columns/tables;
new code tolerates missing rows via lazy `getOrCreateAutonomyConfig` defaults).
Detection: `/api/ready` 503s on bad deploy (Railway healthcheck repointed — F6).
Deployment order: migrate (automatic) → start → healthcheck → traffic. Backward
compat: YES for every migration in the chain (verified additive, §8).

## 23. CI/CD Readiness

**Verdict: READY WITH MITIGATION (D1 — see §27.1).** `e2e.yml` covers migrate →
check → build → playwright (full gate). `migration-guard.yml` fails on schema drift.
`deploy.yml` runs typecheck only (no tests) — accepted: deploy follows a green E2E run
by process, not by pipeline interlock. `prod-migrate.yml` skips cleanly without the
secret. Missing gate (advisory): unit/DB in the deploy path — covered by D1 process
rule until wired.

## 24. Production UX Readiness

**Verdict: READY.** Phase 29.5 stands (0 P0/P1; §28 checklist re-verified against the
report, no regressions from Phase 30 changes which touch no client code):
understandable errors, honest failed/unknown states, trustworthy publish state,
understandable autonomy card with human-vs-autonomous badges, guarded destructive
controls, no dev-only controls or placeholder content in the bundle. Prod pass on
`/today /create /sources /agent /schedule /insights /settings` deferred to §27.1 E2E.

## 25. Operational Runbook

**Deploy:** push `replit` → CI green → `railway up` (auto) → watch `/api/ready` 200.
**Rollback:** `railway rollback` (or previous image); schema is backward-compatible.
**Restart:** `railway restart`; jobs resume from PG state; no manual requeue.
**Health:** `GET /api/health` (process), `GET /api/ready` (DB).
**Jobs:** pg-boss tables (`pgboss.job`, DLQs `<queue>.dlq`); stuck ⇒ expiry reaps.
**Publication unknown:** find `results.outcome='unknown'` → provider dashboard →
  `reconcile` path reuses the same row (NEVER re-post manually first).
**Disable autonomy:** `POST /api/autonomy/disable` (or Insights card) → verify
  `enabled=false` in status.
**Breaker open:** inspect `reason` → resolve cause → human-only reset endpoint.
**Budget exhausted:** wait for window OR human 29.3 activation (never raise-and-retry).
**Restore:** `pg_restore` → `npm run db:migrate` → boot → `/api/ready` → sample reads
  (proven §9). **Poll (M2):** autonomy status/decisions daily; DLQs weekly.

## 26. Disaster Recovery

No guarantees invented; recovery is described, not promised:

| Loss | Recovery | RPO/RTO |
|---|---|---|
| App host | Railway restarts/restores container; stateless (sessions + jobs in PG) | platform-owned |
| Database | Platform backup restore (M3) or `pg_dump` artifact → `pg_restore` (proven §9) | operator-owned |
| Job worker (same process) | Restart; PG-held state resumes; at-least-once + idempotent | minutes |
| Provider outage | Breaker/cooldown parks work; retries with backoff; DLQ | automatic |
| Credential outage | Affected adapters report `policy_human`; publications park; no data loss | manual rotation, no code change |

## 27. Test Results

| Suite | Result |
|---|---|
| `npm run check` (tsc) | clean (one Phase 30 type error introduced and fixed before commit: `ProcessEnv` vs helper param) |
| `npm run build` | clean (`dist/index.cjs` 4.0 MB, migrations copied) |
| `npm run test:unit` | **722 pass / 0 fail / 1 skipped (723 total)** — baseline 709+1 plus 13 new Phase 30 tests |
| `npm run test:db` | **322/322 pass, 38 suites** (re-run AFTER Phase 30 fixes; pre-change baseline identical) |
| Autonomy kill-switch dbtests | **20/20** (`server/content/autonomy/autonomy.dbtest.ts`) |
| Production-start verification | boot → `/api/health` ok → `/api/ready` ready → reads; fail-closed boot without `SESSION_SECRET`; restore-DB boot |
| SSRF live probes | metadata/private/localhost → 400, no request sent; public URL proceeds |
| Logout live probe | `Set-Cookie: connect.sid=; Expires=1970` + `{"success":true}` |
| Tenant-isolation live probe | unauthenticated `GET /api/posts` returned all rows (B1 evidence) |
| Full E2E serial | see §27.1 |

### 27.1 E2E serial (`--workers=1`, isolated DB `cf_e2e2`, 233 tests)

**Result: 17 passed / 211 failed / 5 did not run (EXIT 1). Zero failures are Phase 30
regressions (proof below). Two distinct failure classes:**

**Class A — browser tests (196 failures, all `[chromium]` + `[no-auth]`).**
Failure: `browserType.launch: Executable doesn't exist at
…/ms-playwright/chromium_headless_shell-1217/…`. Reproduction: any browser test on
this box. Parallel-only? No — environmental, fails identically serial or parallel.
Shared resource: none (no browser ever launched). Production impact: none. Conclusion:
this host (ubuntu26.04-arm64) has no Playwright browser binaries and Playwright
refuses to install them (`ERROR: Playwright does not support chromium on
ubuntu26.04-arm64`; no system chromium/firefox present). These 196 tests yield no
signal here and MUST run in CI (`e2e.yml` provisions chromium + postgres) before
merge — this is the D1 gate.

**Class B — `[api]` project (16 failed / 15 passed / 5 did-not-run).**
Failure: every session-less non-GET assertion gets HTTP 403 (`Invalid or missing CSRF
token`) because the specs predate CSRF enforcement (`cae1cbf`) and never fetch
`/api/csrf-token`; plus one seed-dependent GET (`/api/profile/memory` shape `{}` on a
fresh DB). Reproduction: `npx playwright test --project=api --workers=1` against a
migrated DB. Parallel-only? No — fails identically serial. Shared resource: none
(fresh isolated DB per run). Production impact: none (test-harness artifact, not app
behavior — the app correctly enforces CSRF). Conclusion, proven by A/B:
pristine-HEAD (`git stash`, rebuild) run gives the byte-identical failure list
(16 failed / 15 passed / 5 did not run); with-Phase-30 run gives the same list.
**No Phase 30 change regressed, fixed, or masked any api test** (none of the 16
failing tests touches ingest, vault-extract, logout, health, or readiness).

**Parallel E2E:** not attempted on this host (serial outcome already decided by the
missing browser); the Phase 29.4 contention finding (parallel-only flakes under
default workers, serial green) stands as documented and is not re-litigated here.

**D1 (E2E-gated deploys)** therefore means: CI `e2e.yml` (with browsers) must be
serial-green before merge/deploy; the api-project CSRF-harness gap (specs need token
handling or the project needs a documented session-less contract) is a pre-existing
test-debt item for the CI owner, not a Phase 30 defect.

## 28. Defects Found

| ID | Severity | Location | Status |
|---|---|---|---|
| F1 fail-open SESSION_SECRET | High | `server/index.ts:134` | FIXED + tested + live-verified |
| F2/F6 no health/readiness; healthcheck probed static config | High/Med | `server/index.ts`, `railway.toml`, `Dockerfile` | FIXED + live-verified |
| F3 secret-shaped fields in access log | Medium | `server/index.ts:87-96` | FIXED + tested |
| F4 logout left cookie set | Medium | `server/routes.ts:2483` | FIXED + tested + live-verified |
| F5 raw-fetch SSRF in legacy ingestion (3 sites) | High | `server/routes.ts:967-1075,2745` | FIXED + tested + live-verified |
| B1 no auth/ownership on legacy API (+ optional auth on new slices) | High | `server/routes.ts` (~120 handlers), `sessionUserId ?? 1` | DOCUMENTED, mitigation M1 (STOP condition: auth-architecture change needs human review) |
| G1 no session regeneration on login; 30d fixed expiry, no idle timeout | Low | `server/routes.ts:2459,2475` | Documented (non-blocking, single-operator) |
| G2 Google OAuth email-linking without verified check | Low | `server/auth.ts:43-48` | Documented (non-blocking, single-operator) |
| G3 `aiCall` has no client timeout (bounded by job expiry instead) | Low | `server/ai/chat.ts` | Documented (non-blocking) |
| G4 uploads served without auth | Medium | `server/routes.ts:106` | Covered by M1 (same exposure class as B1) |
| G5 compose ships weak placeholder SESSION_SECRET | Low | `docker-compose.yml:36` | Documented operational note (local-dev only; override if shared) |

## 29. Fixes Applied

F1–F6 as above. Each: root cause identified → minimal fix → regression test
(`httpHardening.test.ts` 11 tests, `legacyFetchDenial.test.ts` 2 tests) → full
unit + DB suites green → live production-build verification. No scheduler, no RL/
bandits, no experiment automation, no auth migration, no architecture rewrite, no new
dependencies, no channel changes.

## 30. Remaining Limitations

- B1/M1: single-tenant gated operation until auth enforcement ships.
- M2: polling-based alerting for breaker/budget/DLQ.
- M3: wall-clock RPO/RTO owned by the database platform.
- D1: E2E gate is process-enforced pending §27.1 numbers.
- Parallel-E2E contention: dev-server/DB-pool artifact; serial is the signal.
- `ENCRYPTION_KEY` should be set as a stable dedicated value in prod (else rotation of
  `SESSION_SECRET` invalidates stored provider tokens).
- pg pool at defaults (max 10); revisit if workers/scale change.

## 31. GO / NO-GO Matrix

| Capability | Verdict |
|---|---|
| Application startup | READY |
| Deployment | READY |
| Rollback | READY |
| Authentication | READY (primitives) |
| Authorization | BLOCKED → mitigated by M1 |
| Tenant isolation | BLOCKED → mitigated by M1 |
| Database integrity | READY |
| Database backup | READY |
| Database restore | READY (proven) |
| Migration safety | READY |
| Job durability | READY |
| Failure semantics | READY |
| External-provider resilience | READY |
| Publication safety | READY |
| Artifact immutability | READY |
| Autonomy safety | READY |
| Human controls | READY |
| Kill switch | READY |
| Agent boundary | READY |
| Observability | READY |
| Alerting | READY WITH MITIGATION (M2) |
| Security | READY WITH MITIGATION (M1) |
| SSRF protection | READY |
| Resource exhaustion | READY |
| Performance | READY |
| Data integrity | READY |
| Disaster recovery | READY WITH MITIGATION (M3) |
| Operational documentation | READY (§25 + existing docs) |
| UX production readiness | READY |

## 32. Launch Blockers

Exactly one: **B1 — missing authentication/authorization and tenant isolation on the
legacy API surface** (Severity: High; Location: `server/routes.ts` + `server/storage.ts`;
Evidence: code audit + live unauthenticated read + unauthenticated publish path;
Impact: any network-reachable caller acts as owner 1 incl. paid external publishing;
Root cause: pre-existing single-tenant-dev `?? 1` convention, `requireAuth` never wired;
Required remediation: enforce authentication on all state-changing (at minimum) and
eventually all legacy routes + ownership predicates in storage — a follow-up phase
requiring human approval per STOP conditions; Safe mitigation: M1 single-tenant gated
operation). No other blocker met the evidence bar; nothing was called a blocker merely
because it would be nice to have.

## 33. Phase 30 Scheduler Preconditions

The documented architecture (durable pg-boss `autonomy.evaluate` job carrying
`{ownerId, targetScope, correlationId}` only → lease → reread authoritative state →
existing eligibility → DENY-journal / ALLOW-bounded-action-journal) may be enabled ONLY
when: (1) B1 is remediated (autonomous actions under enforced identity) OR the scheduler
is formally scoped to the single gated tenant with M1 controls audited; (2) M2 is
revisited — action volume beyond daily polling requires push alerting first; (3) the
existing node-cron inline jobs are reconciled with the durable trigger (no double
execution paths); (4) DLQ/budget/breaker dashboards or alerts exist for the new volume;
(5) E2E serial is green including scheduler reconcile journeys. The scheduler must NOT
own authorization, eligibility, policy invention, experiment selection, or RL/bandits —
it decides WHEN to ask, never WHETHER.

## 34. Final Launch Decision

**GO WITH EXPLICIT MITIGATIONS**

- **M1 — single-tenant gated operation.** Why acceptable: the deployed operating model
  IS one owner; the system is correct for that model (all lifecycle slices scope
  correctly; `?? 1` resolves to the sole tenant). Monitor: audit log + periodic
  unauthenticated-probe of state-changing routes; any probe success beyond the known
  surface triggers review. Transition to NO-GO: second tenant onboarded, open
  registration enabled, or exposure without access control before auth enforcement.
- **M2 — polling-based alerting.** Why acceptable: max 1 autonomous action/day;
  breaker/budget states are API-visible; runbook polling is proportionate. Monitor:
  daily status/decisions poll (runbook). Transition to NO-GO: action volume outgrows
  daily polling or any autonomous activation occurs without a journaled decision.
- **M3 — platform-owned RPO/RTO.** Why acceptable: app-side restore proven; data
  loss windows are a platform property, stated not guaranteed. Monitor: quarterly
  platform-restore confirmation. Transition to NO-GO: production data exists with no
  platform backup enabled.
- **D1 — E2E-gated deploys.** Why acceptable: CI runs the full serial gate; process
  rule closes the `deploy.yml` interlock gap. Monitor: §27.1 numbers before merge.
  Transition to NO-GO: any deploy on red E2E.

No scheduler was implemented. No history rewritten. PR #3 stays unmerged pending the
E2E gate (§27.1) and human review of B1/M1.
