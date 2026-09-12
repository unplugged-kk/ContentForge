# Phase B — Implementation Notes

Workstream: ContentForge Phase B foundation slice
Started: 2026-09-10 | Status: in progress

## Step 0 — Repository baseline

| Item | Value |
|---|---|
| Branch | `replit` |
| HEAD | `e6e8362 Phase C (b): add user context helpers + Request.userId + sessionUser middleware` |
| Working tree | **not clean** — pre-existing modifications present, left untouched |
| Pre-existing modified (tracked) | `.github/copilot-instructions.md`, `.gitignore`, `AGENTS.md`, `server/storage.ts` |
| Pre-existing untracked | `.adal/ .agents/ .commandcode/ .gemini/ .grok/ .ignore .kimchi/ .kiro/ .scratch/ .windsurf/ Dockerfile GEMINI.md architecture/ docs/spec_contentforge_reimagined.md opencode.json plans/ research/ roadmap/` |

Pre-existing work is **not** reverted, overwritten, or reset. No `reset --hard`,
`checkout .`, or `clean -fd` was used.

### Environment findings (pre-existing, unrelated to this session's changes)

1. **`.env` `DATABASE_URL` points at a remote production Neon database** and is
   unreachable (connection timeout). No local ContentForge DB existed.
   → Development/testing uses an **isolated disposable Postgres 16 on port 5433**
   (`contentforge-dev-db`). The production URL is never used. A guard asserts the
   target contains `localhost:5433` before any DB command.
2. **`node_modules` was installed for the wrong architecture** (`@esbuild/darwin-x64`
   on an arm64 machine), breaking `tsx` and therefore `npm run dev`.
   → Repaired with `npm install --include=dev` (respects the existing lockfile).
   `package.json` / `package-lock.json` are unchanged by this repair.
3. **The shell environment sets `NODE_ENV=production`**, which caused npm to prune
   devDependencies (`drizzle-kit`, `typescript`, `@playwright/test`).
   → Same repair; dev deps restored.
4. **The committed migration chain cannot bootstrap a fresh database.**
   `migrations/0003_spooky_reptil.sql` re-creates `canned_responses` and
   `youtube_channels` (plain `CREATE TABLE`) which `0002` already created with
   `IF NOT EXISTS`. `migrations/meta/` has **no `0002_snapshot.json`**, confirming
   `0002` was hand-written and `0003` was generated — the "branch/squash
   divergence artifact" Ticket 08 identified (`08-classify-existing-code.md`:
   "Migration `0003` replay of `0002` → REMOVE; squash before cutover so ordered
   apply doesn't error on duplicate CREATEs").
   → **Not fixed in this session**: `0002`/`0003` are applied in existing
   environments and Step 2 forbids rewriting applied migrations. Local dev
   bootstraps from `shared/schema.ts` via `drizzle-kit push` (the sanctioned
   `db:push` script). See "Remaining work" — this needs a decision before any
   fresh-environment deploy.

## Step 1 — Architecture reconciliation

Contradiction confirmed by inspection:

| Source | Says |
|---|---|
| `architecture/system-architecture.md` §1–2, `architecture/data-model.md` | Redis + **BullMQ** (pg-boss only as fallback); a `channels` entity as the central config unit; pgvector dedupe |
| Locked Wayfinder Ticket 06 §6 | **pg-boss, locked** ("BullMQ rejected: richer semantics, unjustified operational cost") |
| Locked Ticket 03 §4 / 07 | No channel-specific domain entity; Channel Adapter boundary; `format` × `channel` as generic string columns |

**Decision: the locked architecture wins (as instructed).**

- `architecture/*.md` is treated as **prior art, not specification**.
- **No BullMQ, no Redis** introduced.
- **No `channels` domain table** introduced. Channel remains a string dimension on
  Artifact/Schedule/Publication, per Tickets 03/05/07.
- pg-boss is installed and used for durable jobs.

This is recorded rather than silently resolved. Reconciling the stale documents
(or formally reopening 06) is **not** this session's authority and is listed as
remaining work.

## Scope discipline

In scope: job infrastructure, job envelope, payload-schema registry, SourceProvider
contract + registry + one real provider, NormalizedSource, SSRF boundary, research
engine slice, ResearchJob domain.

Deferred (untouched): last30days, Agent-Reach, YouTube/Reddit/GitHub/ArXiv/Trends
provider migration, autonomous discovery expansion, second brain, voice, templates,
visuals, carousels, LinkedIn/Threads/Bluesky/Mastodon, multi-brand, collaboration,
Chrome extension, notifications, analytics learning loop, Video Factory, billing.

## Progress log

- [x] Step 0 — baseline recorded
- [x] Step 1 — architecture reconciled (locked architecture wins)
- [x] Step 2 — schema/migration safety inspected; pre-existing defect found and documented
- [x] Step 3 — pg-boss foundation (`server/jobs/runtime.ts`)
- [x] Step 4 — generic job envelope (`server/jobs/envelope.ts`)
- [x] Step 5 — payload schema registry (`server/artifacts/payloadSchemas.ts`; `x_post`, `x_thread`)
- [x] Step 6 — SourceProvider contract (`server/research/contracts.ts`)
- [x] Step 7 — provider registry + Tier-1 backend fallback (`server/research/registry.ts`, `health.ts`)
- [x] Step 8 — one real provider: RSS (`server/research/providers/rss.ts`)
- [x] Step 9 — NormalizedSource + shared normalization (`server/research/normalize.ts`)
- [x] Step 10 — research engine slice (`server/research/engine.ts`, `engine-core.ts`)
- [x] Step 11 — SSRF boundary (`server/security/ssrf.ts`)
- [x] Step 12 — ResearchJob domain + additive migration `0005_research_domain.sql`

## Implementation summary

### Queue (pg-boss v10 — Node 20 compatible)

`pg-boss@^10.4.2` was chosen over v12 because the project targets **Node 20**
everywhere (`.nvmrc`, `Dockerfile`, all CI workflows, `engines`); pg-boss v11+
requires Node >= 22. No Redis, no BullMQ.

| Module | Responsibility |
|---|---|
| `server/jobs/envelope.ts` | Versioned, serializable `JobEnvelope`; zod-validated on read |
| `server/jobs/failures.ts` | Four failure classes → `retry` / `reschedule` / `terminal` |
| `server/jobs/registry.ts` | Job type registry (schema + queue config + handler) |
| `server/jobs/logger.ts` | Single-line JSON logs with credential redaction |
| `server/jobs/runtime.ts` | Lifecycle, enqueue, worker dispatch, classification, DLQ, graceful stop |

Retry mapping: transient → throw (pg-boss backoff, then auto-DLQ); rate_limited
→ re-queue after `retryAfterMs` and complete (never consumes an attempt);
permanent / policy_human → copy to DLQ and complete (no retry).

Enqueue dedupe uses pg-boss `singletonKey` + `singletonSeconds`. Note pg-boss
only enforces `singletonKey` under the `short` policy or with a `singleton_on`
window, so the window is always set. **The authoritative idempotency arbiter
remains the domain row's UNIQUE constraint** (Ticket 06 §7), not the queue.

### Research providers

| Module | Responsibility |
|---|---|
| `server/research/contracts.ts` | `discover`/`search`/`fetch` + capability + access class + probe |
| `server/research/normalize.ts` | Canonical URL, content hash, excerpt |
| `server/research/health.ts` | Per `(provider, backend, capability)` state, cooldown, circuit breaking |
| `server/research/registry.ts` | Registration, capability resolution, Tier-1 fallback, diagnostics |
| `server/research/providers/rss.ts` | RSS/Atom discover + SSRF-safe article fetch |
| `server/research/engine-core.ts` | Pure dedupe / evidence / validity |
| `server/research/engine.ts` | Orchestration, partial-failure tolerance, freezing |
| `server/research/storage.ts` | ResearchJob/Source/Evidence persistence |

Access classes are enforced at dispatch: `local-agent-only` providers are
**refused by default**, so browser-session research cannot enter the core.

### ResearchJob domain (migration 0005)

Three additive tables, no destructive statements:
`research_jobs`, `research_sources`, `research_evidence`. Evidence is
content-addressed by `(job_id, source_id, excerpt_hash)`; `research_jobs` carries
UNIQUE `correlation_id` and `idempotency_key`.

### Verification

Three layers, all green:

| Check | Result |
|---|---|
| `npm run test:unit` | **182 passed / 0 failed** (33 suites) |
| `npm run test:db` (real Postgres) | **56 passed / 0 failed / 0 skipped** (7 suites) |
| `npm test` | **182 passed** |
| `npx tsc` | **0 errors** |
| `npm run test:e2e:live` (real running app) | **44 passed / 0 failed** |
| Migrations 0005–0007 | additive only — 0 ALTER/DROP on pre-existing tables |
| Fresh DB migrate | bootstraps to 39 tables / 8 migrations from zero |
| Existing DB migrate | upgrades a 0000–0002 database to the current schema |

## Slice B6 — core content lifecycle (done)

The complete core chain is now real and exercised through the running app:

```
ResearchJob → Story → Opportunity → GenerationJob → Artifact
            → approval → Schedule → Occurrence → Publication → Result
```

| Module | Responsibility |
|---|---|
| `shared/schema.ts` + `migrations/0007_dusty_preak.sql` | 7 additive tables + FKs + indexes; a DB **trigger** makes Artifact content immutable |
| `server/content/storage.ts` | Persistence for all six new entities; conditional-UPDATE lease; idempotent claims |
| `server/content/opportunity.ts` | Story → Opportunity; proposed/selected/killed; format×channel validity |
| `server/content/generation.ts` | Frozen policy, deterministic idempotency key, GenerationJob execution |
| `server/content/model.ts` | Default model adapter over the **existing** `server/ai` gateway (`aiCall`) |
| `server/content/artifact.ts` | Immutable revisions + `draft → in_review → approved \| rejected` |
| `server/content/scheduling.ts` | Schedule (series) → Occurrence; the scheduler owns WHEN, never publishes |
| `server/content/publication.ts` | Single-flight lease, reconcile-first unknown handling, Result |
| `server/content/adapters.ts` | `ChannelAdapter` port + X adapter over the existing `postContentToX`/xQuick |
| `server/content/service.ts` | Composition root + `generation.run` / `publication.run` job types |
| `server/content/routes.ts` | Opportunity/Generation/Artifact/Schedule/Publication API |

Decisions worth recording:

- **Provider-agnostic generation.** The domain depends on `GenerationModelPort`;
  only `model.ts` names a provider, and it wraps the existing gateway. No second
  AI abstraction, no provider-specific billing (`cost` is recorded as null).
- **Artifact immutability is enforced by Postgres**, not by convention: a
  `BEFORE UPDATE` trigger rejects any change to payload/format/channel/parents,
  so revisions must be new rows linked by `supersedes_id`.
- **Publication identity is durable**: `schedule × occurrence × artifact revision`
  is a UNIQUE column, and acquisition is a conditional `UPDATE`, so two workers
  cannot publish the same occurrence twice. A lease holder that died is parked as
  an `unknown` Result (`reconcile_required`) rather than retried blindly — an
  external request that was sent is never assumed successful.
- **One-shot schedules only in Phase B.** Recurrence strings are stored but not
  expanded; RRULE expansion is deliberately future work rather than invented
  interval semantics.
- **No re-research for a new format**: a second format is a second Opportunity on
  the same Story, proven by unchanged research row counts.

## Slice B5 — provider-failure semantics (LOCKED)

**Decision (2026-09-12):** locked Ticket 04 §2 ("provider failures degrade to
partial results and **never fail the job unless zero sources survive**";
restated in `RESEARCH-PROVIDERS.md` §13) says *when* the job fails but not *how*.
The class is now decided:

| Case | Condition | Outcome |
|---|---|---|
| **A** | every attempted provider **failed** | job is **failed** with a recoverable class — `rate_limited` if all were rate limited, else `transient` if all were transient/rate-limited, else `permanent`. Transient/rate-limited runs **retry/reschedule** instead of dead-lettering. |
| **B** | some providers succeeded, some failed | job **completes** (partial research); failed calls are retained on `research_jobs.diagnostics`. |
| **C** | providers ran and produced nothing usable | job is **failed permanent** (`no_sourced_evidence`) — the run succeeded, there is genuinely no evidence. |

Implemented in the pure `summarizeCollection` / `classifyEmptyCollection`
(`server/research/engine-core.ts`), applied by the engine before validity
handling. Case B was already correct; Case A previously collapsed into Case C,
so a recoverable provider outage dead-lettered. `engine.dbtest.ts` now asserts
Case A (transient) and Case C (permanent); `engine-core.test.ts` covers the
classification matrix.

## Slice B2 — vertical integration (done)

API → ResearchJob → pg-boss → `research.run` → RSS SourceProvider →
`NormalizedSource` → research engine → persisted sources/evidence.

| Module | Responsibility |
|---|---|
| `server/jobs/bootstrap.ts` | Owns the single JobRuntime; start/stop lifecycle; job registration |
| `server/research/job.ts` | `research.run` job type; engine-outcome → failure-class mapping |
| `server/research/config.ts` | Generic per-provider config resolution |
| `server/research/providers/rssConfig.ts` | RSS provider config from existing `rss_sources` |
| `server/research/service.ts` | Composition root (storage + engine + executor) |
| `server/research/routes.ts` | `POST /api/research/jobs`, `GET /api/research/jobs/:id[/sources|/evidence]` |

- `server/index.ts` starts the job runtime after migrations/seed and stops it on
  SIGTERM/SIGINT (graceful, in-flight work allowed to finish).
- The HTTP layer only persists the job and enqueues; research never runs inline.
- Idempotency is durable: `research_jobs.idempotency_key` UNIQUE is the arbiter,
  with pg-boss `singletonKey` as a scheduling-level guard.
- `0003_spooky_reptil.sql` was made idempotent (`IF NOT EXISTS`) so the migration
  chain can bootstrap a fresh database. `0003` was never applicable (it replayed
  `0002`'s DDL and rolled back in the same transaction), so this repairs an
  unapplied migration rather than rewriting applied history.

## Slice B3 — `ResearchJob → Story` (done)

The first canonical domain transition after research. A Story is the reusable
unit of editorial meaning (Ticket 05 §3); it references its ResearchJob and that
job's evidence **by ID only** and never copies research content.

```
POST /api/stories (ResearchJob id + synthesis)
→ Story service: load ResearchJob → require `complete` → require ≥1 evidence
→ INSERT stories (research_job_id FK, evidence_refs IDs, lifecycle draft)
→ 201 Story
```

| Module | Responsibility |
|---|---|
| `shared/schema.ts` (`stories`) | Durable Story: FK `research_job_id`, provenance, title, insight body, angles, evidence refs, lifecycle |
| `migrations/0006_classy_hannibal_king.sql` | Additive `stories` table + FK + 2 indexes (generated by `drizzle-kit generate`) |
| `server/story/storage.ts` | `StoryStoragePort` + Drizzle implementation |
| `server/story/service.ts` | `createStoryFromResearch`; rejection taxonomy; evidence-ref validation |
| `server/story/routes.ts` | `POST /api/stories`, `GET /api/stories/:id`; domain → HTTP mapping |
| `server/research/storage.ts` | additive `listEvidenceIds` (ID-only provenance accessor) |

- Story lifecycle is `draft → ready → used | archived` with **no kill state**
  (killing is Opportunity-level). `used` is informational, so Stories keep
  spawning formats. Creation may only be `draft` or `ready`.
- **Multiple Stories per ResearchJob are legitimate** (Ticket 03 §3), so there is
  deliberately **no** idempotency key and **no** one-story-per-job constraint at
  this layer. POST is not idempotent by design.
- The service/route surface exposes **no queue and no provider** — a Story can
  never re-run research (structurally, not by convention).
- `basis_claim_ids` (Ticket 05 §3) is **not** persisted yet: claims are not a
  persisted entity in the research slice, so an ID array here could not be
  validated and would let unverifiable IDs masquerade as provenance. Deferred,
  not invented.
- Story versioning/editing is **not** specified by the locked map; this slice
  implements creation only and introduces no versioning semantics.

## Slice B4 — live E2E verification of the running app (done)

`npm run test:e2e:live` → `script/e2e-live.mjs` (+ `e2e/fixture/rss-fixture.mjs`,
documented in `e2e/LIVE-E2E.md`). It never imports application code: it starts the
real production bundle as a child process, the real pg-boss worker, and a
deterministic RSS fixture published on **host port 80**, then drives the real
HTTP API with a session cookie + CSRF token and asserts durable state in both the
`public` and `pgboss` schemas.

Verified live (33/33): research HTTP → ResearchJob → pg-boss → worker → RSS
provider → NormalizedSource → engine → sources/evidence → complete; Story
derivation with no re-research (job/source/evidence counts unchanged); Story
failure paths 400/404/409 (incomplete and failed)/422; permanent failure → DLQ;
transient failure → real pg-boss retry → eventual success on the *same*
ResearchJob; process kill + restart with durable state and pg-boss re-delivery;
correlation id traceable across HTTP, DB, queue envelope and logs. One optional,
non-gating external smoke against `hnrss.org` completed with 20 real sources.

### Findings recorded by live verification

1. **Runtime command.** `npm run dev` (tsx/ESM) fails on Node 24 at
   `server/index.ts`'s `path.join(__dirname, "migrations")` — `__dirname` is
   undefined in ESM. Pre-existing and unrelated. The supported runtime (production,
   Playwright E2E, and this harness) is the built CJS bundle:
   `npm run build && node dist/index.cjs`.
2. **Deterministic fixtures need port 80.** The SSRF syntax gate allows only
   `http(s)` on 80/443 and rejects URL *IP literals* in non-routable space, so a
   local fixture must be fetched as a hostname on port 80. Docker publishes it
   without root; no SSRF control was weakened.
3. **Provider-transient failures become job-permanent failures.** The RSS provider
   correctly raises `JobFailure.transient` when every feed fails, but the engine's
   partial-failure tolerance (Ticket 04 §2) degrades that to an empty collect →
   `no_sourced_evidence` → a **permanent** ResearchJob failure and a DLQ entry,
   with no retry. The transient retry path is reachable when the failure happens
   *after* collection (e.g. persistence), which is what the live retry test
   exercises. Worth an explicit decision: should "all providers failed
   transiently" fail the job transiently so it retries?
4. **pg-boss v10 mechanics.** `pgboss.job` is one partitioned table for every
   queue (the DLQ is a queue named `<jobType>.dlq`); a thrown job sits in
   `state='retry'` with a future `start_after` and `retry_count` stays 0 until the
   retry actually starts (it becomes 1 while running).
5. **Environment.** This machine intermittently freezes the app process for
   several minutes (observed as 5–12 minute gaps with no logs, delaying worker
   pickup). The harness is hardened with statement/query timeouts and a generous
   retry window; transient stalls are environmental, not application defects —
   the same operations complete in tens of milliseconds when the machine is healthy.

## Notes for the next slice

- Next legitimate slice: **Opportunity** (`Story → Opportunity`). Phase B scope
  stops at Story for now; Opportunity/GenerationJob/Artifact/Schedule/
  Publication are untouched.
- Generic URL research remains **disabled**; the SSRF guard is implemented and
  tested, but nothing exposes arbitrary-URL fetching.
- `architecture/*.md` still contradicts locked Ticket 06 (BullMQ / `channels`);
  it remains prior art until reconciled.
- `migrations/meta/0002_snapshot.json` is still absent; it is historical only
  (generate diffs against the latest snapshot), so no repair was needed.
- `server/storage.ts` per-user isolation is still deferred to Phase C slice (c);
  the `userId` parameter is threaded but not yet used for filtering.

