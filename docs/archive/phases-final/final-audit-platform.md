# Final Independent Production Audit — Auditor C (PLATFORM)

Functionality · Scheduler · Autonomy · Recovery. **READ-ONLY** audit of a fresh
checkout of pushed `origin/main`.

| | |
|---|---|
| Worktree | `/Users/kishore/git/cf-design/fa3` (detached) |
| Base revision audited | `origin/main` = `d60e55ed1dce34b98bf1f94a197c14861b70f5d2` |
| Build | `npm run build` → exit 0 (`dist/index.cjs` 4.1 MB, `dist/public` emitted) |
| Live server | `node dist/index.cjs`, `E2E_PORT=4803`, production build, `DISABLE_CRON=1` |
| DB (shared) | `postgresql://e2e@127.0.0.1:5433/contentforge_e2e` |
| DB (isolated) | `postgresql://e2e@127.0.0.1:5433/contentforge_e2e_auditc` (fresh; server auto-migrated) |
| Prior reports | Treated as **UNVERIFIED**; only the items below are asserted, each with its evidence type. |

Evidence legend: **BY EXECUTION** = ran it (live HTTP, real Postgres, or the real
suite) and observed the result. **BY READING** = source inspection only. **NOT RUN**
= not exercised.

---

## 0. Verdict summary

| Area | Verdict | Evidence |
|---|---|---|
| Canonical content loop (Schedule→Occurrence→Publication→Result) | **HOLDS** | BY EXECUTION (live server + real worker) |
| Canonical autonomy loop (Activation→Rollback) | **HOLDS** | BY EXECUTION (live HTTP + dbtest) |
| No false publication success | **HOLDS** | BY EXECUTION + BY READING |
| Scheduler safety (durability, idempotency, lease, concurrency, kill switch, reread) | **HOLDS** | BY EXECUTION (23/23 dbtest) |
| Boundary **Scheduler = WHEN / Controller = WHETHER** (scheduler never mutates policy/autonomy) | **HOLDS** | BY READING + BY EXECUTION (unit tests) |
| Recovery (crash, pool loss, retry, DLQ, restart, lease, unknown state) | **HOLDS** | BY EXECUTION |
| No path to duplicate activation | **HOLDS** | BY EXECUTION (concurrency + idempotency suites) |
| `GET /api/policy-candidates/activated-ids` → 400 | **FALSIFIED (fixed)** | BY EXECUTION |
| Process survives a recoverable pool error | **FALSIFIED (fixed)** | BY EXECUTION |
| Content *pipeline* stages Research→Story→Opportunity→Generation | **NOT RUN** | no AI/provider credentials |

**No product defect was FALSIFIED or found BROKEN by this audit.** Two test-only,
environmental failures were observed and explained (§6.1).

---

## 1. The canonical loop — which stages I actually executed

### Content loop — `Artifact → review → approval → rejection → Schedule → Occurrence → Publication → Result`

Executed **BY EXECUTION** against the live server on `:4803`. Story/Opportunity/
Artifact rows were seeded directly in Postgres (the Research→Story→Opportunity→
Generation *engines* need AI/provider credentials and were **NOT RUN**); every
lifecycle transition from Artifact onward was driven through the real HTTP API and
the real `publication.run` worker:

| Stage | Executed? | How observed |
|---|---|---|
| Story, Opportunity | seeded (not pipeline) | SQL insert |
| Artifact (created) | ✅ | SQL insert, `readiness=draft` |
| review | ✅ BY EXECUTION | `POST /api/artifacts/990/submit-review` → `in_review` (HTTP 200) |
| approval | ✅ BY EXECUTION | `POST /api/artifacts/990/approve` → `approved` (HTTP 200) |
| rejection | ✅ BY EXECUTION | `POST /api/artifacts/991/submit-review` then `/reject` → `rejected` (HTTP 200) |
| rejected cannot schedule/publish | ✅ BY EXECUTION | `POST /api/schedules {991}` → **409**; `POST /api/artifacts/991/publications` → **409** |
| Schedule | ✅ BY EXECUTION | `POST /api/artifacts/973/publications` created `schedule 767` |
| Occurrence | ✅ BY EXECUTION | `dispatchDueOccurrences` materialized `occurrence 717` (`HTTP 207` body) |
| Publication | ✅ BY EXECUTION | `publication 2216` created then claimed/run by the worker |
| Result | ✅ BY EXECUTION | `result 547` = `outcome:"failed"`, `errorClass:"policy_human"` |
| Publication (multi-target, partial) | ✅ BY EXECUTION | one request, `x` + `bogus_channel` → mixed 207 outcomes (§2) |

### Autonomy loop — `Activation → Rollback`

Executed **BY EXECUTION** over the live HTTP API (owner 14), after seeding a
completed experiment + evaluation + `approved_for_future` candidate:

- `POST /api/policy-candidates/866/activate` → **201**, created `generation_policy 921 v191`, `actor:"human"`.
- `POST /api/policy-candidates/866/activate` **again** → **200**, `alreadyActivated:true`, *same* activation id (idempotent — no second revision).
- `GET /api/policy-candidates/activated-ids` → `[866]`, actor `human`.
- Second candidate 867 on the same scope: activate → **201**, `v192`, `previousPolicyId=921`.
- `POST /api/policy-candidates/867/rollback` → **200**, reactivated `v191`, archived `v192`, recorded `action:"rollback"`.
- `GET /api/policies/history?policyKey=pol:x_post:x` → `activate(v191) → activate(v192) → rollback(v191)`; `GET /api/policies/active` → `v191 active`. `activated-ids` drops 867, keeps 866.

`Learn → Experiment → Evaluation → Policy Candidate` were seeded for this probe; the
*engines* that produce them were exercised inside `autonomy.dbtest.ts` /
`policyActivation.dbtest.ts` (20/20 and 15/15, §6) — see §7 for the untested seeds.

---

## 2. No false publication success — the key result

**Verdict: HOLDS. I could not construct a case where the UI or API reports success
for something that did not publish.**

Attack 1 — multi-target HTTP 207 envelope **BY EXECUTION**. Real request:

```
POST /api/artifacts/973/publications  {"targets":[{"channel":"x"},{"channel":"bogus_channel"}]}
→ HTTP 207
{"artifactId":973,"outcomes":[
  {"channel":"x","status":"created","scheduleId":767,"publicationId":2216,"created":true,"error":null},
  {"channel":"bogus_channel","status":"invalid","scheduleId":null,"publicationId":null,"created":false,
   "error":"channel \"bogus_channel\" has no registered adapter"}]}
```

The envelope statuses are **`created` / `reused` / `invalid`** — they describe
*scheduling acceptance*, never delivery. The `x` target above was only "created",
yet its real execution (`GET /api/publications/2216`) ended:

```
state:"failed", providerCalled:false,
lastError:"xQuick credentials missing: …",
result:{ outcome:"failed", errorClass:"policy_human", externalId:null }
```

No false success — a scheduled-and-then-failed target reports failure.

Attack 2 — unknown / partial outcomes **BY EXECUTION** (`reconcile.dbtest.ts`, 6/6):
- *"publish attempt that never resolves becomes `unknown`, not falsely published"* ✅
- *"confirmed-not-published: re-queues the SAME Publication and the retried publish reaches exactly one final Result"* ✅
- *"still unknown after reconciliation: leaves the Publication unknown, bounded, survives restart-equivalent recovery"* ✅
- *"concurrency: two reconciliation passes racing the same Publication produce exactly one final outcome"* ✅

The three-valued adapter contract (`PublishOutcome`: `ok` / classified failure /
`providerCalled && !ok` = unknown) is the guard; `runPublication` never retries an
invoked-but-unconfirmed transport, and records an `outcome:"unknown"` Result instead
(`server/content/publication.ts:280-311`).

Attack 3 — "published" source audit **BY READING**. Every write of
`publications.state="published"` / `results.outcome="published"` is reachable only
from `recordPublished()` (`server/content/publication.ts:335-382`), called after an
adapter returns `ok:true` — from the normal path *and* from provider reconciliation.

Attack 4 — UI/agent reporting **BY EXECUTION + READING**:
- Client maps the 207 envelope in `client/src/lib/publication-feedback.ts`: all
  `created`/`reused` → *"Publication scheduled … delivery has not been confirmed
  yet."*; `failed` → destructive; `unknown` → *"needs verification"*; mixed → *"results
  are mixed"*; empty → *"result unavailable"*. It never renders "Published
  successfully" for a mere `created`. Verified by `publication-feedback.test.ts`
  (passing) and by reading the component (`artifact-review-view.tsx:249-266`).
- Agent tool `publish_now` returns `status:"queued"`, never `published`
  (`server/agent/tools.ts:1402-1441`); `get_publication_status` returns the true state.

---

## 3. Scheduler safety

**Verdict: HOLDS.** `server/content/autonomy/scheduler.dbtest.ts` — **23/23 pass on
the isolated DB**, against the real pg-boss runtime and the real controller.

| Claim | Evidence |
|---|---|
| Durability | *"creates durable work visible in the pg-boss schema"* ✅ (job row present in `pgboss_sched.job`) |
| Idempotency (enqueue dedupe) | *"duplicate enqueue within the window collapses to one job"* ✅ (`deduplicated:true`, `queueJobId:null`) |
| Concurrency (single activation) | *"10 simultaneous same-owner same-scope triggers yield at most one activation"* ✅; *"10 executions across different owners activate independently"* ✅ |
| Kill switch stops work | *"kill switch denies without activation"* ✅ (+ `disableAutonomy` reread test) |
| Mode / automation flag / breaker / evidence floor / guardrail | each ⇒ denies without activation ✅ |
| Budget + cooldown across separate scheduled jobs | *"daily budget is enforced…"* ✅; *"cooldown cannot be bypassed by a second scheduled job"* ✅ |
| Cross-owner denial | *"cross-owner execution is denied"* ✅ |
| Authoritative reread (already-enqueued state change) | *"state changed after enqueue controls execution (reread proof)"* ✅ — kill switch flipped **after** enqueue ⇒ `DISABLED`, 0 activations |
| Stale / scope-moved candidate | completes quietly without activation ✅ |
| Payload hygiene | *"malformed payloads are rejected, never executed"* ✅ (strict schema rejects a smuggled policy object) |
| Controller is the decider | *"sweep executes an eligible candidate through the controller"* ✅ |

**Lease**: Publications use a Postgres compare-and-set single-flight lease
(`acquirePublicationLease`, `DEFAULT_LEASE_MS = 5 min`); two workers can never both
publish the same row (`publication.ts:218-222`). Job-claim concurrency is pg-boss's
own; occurrence claim is `pending → enqueued` CAS (`scheduling.ts:259-271`).

**Boundary — Scheduler = WHEN / Controller = WHETHER. HOLDS.**
- `server/content/autonomy/scheduler.ts` and `findDueAutonomyPairs` are **select +
  enqueue only**; they never read evaluations and never write policy/autonomy rows
  (BY READING).
- `server/content/service.ts` content-scheduler tick dispatches occurrences/
  publications/automation runs; it writes no `generation_policies`,
  `policy_candidates`, `policy_activations`, `autonomy_configs`, or
  `autonomy_decisions` (BY READING).
- Only `policyActivation/activation.ts` mutates active policy revisions — one code
  path for human and autonomous actors (BY READING; enforced by
  `server/agent/autonomyDenial.test.ts` + `policyActivationDenial.test.ts`, which
  pass in the 95/95 unit run).
- Correctness state is in Postgres, not process memory: *"restart recovers a pending
  job without loss"* ✅.

---

## 4. Recovery

**Verdict: HOLDS.** All BY EXECUTION against real Postgres / real pg-boss:

| Scenario | Evidence |
|---|---|
| Job runtime retry + backoff | `server/jobs/runtime.dbtest.ts` **8/8** — *"retries a transient failure and succeeds on a later attempt"* ✅ |
| Dead-letter (DLQ) | *"dead-letters a permanent failure without consuming retries"* ✅; *"dead-letters an unparseable envelope"* ✅ |
| Duplicate-delivery / enqueue dedupe | *"deduplicates a second enqueue with the same idempotency key"* ✅ |
| Graceful shutdown | *"shuts down gracefully"* ✅ |
| Worker/process restart | scheduler *"restart recovers a pending job without loss"* ✅ (stops the runtime, starts a fresh one, pending job still activates) |
| Lease recovery / crash mid-flight | reconcile *"still unknown … bounded, survives restart-equivalent recovery"* ✅; `reconcileStalePublications` parks a lease-expired row as an `unknown` Result, bounded by durable `MAX_RECONCILE_ATTEMPTS=5` |
| Unknown state | reconcile 6/6 (§2) — never assumed success, never blind-retried |
| DB connection loss | live test, §5.2 |
| Duplicate activation | see below |

**Duplicate activation: none found.** Three independent guards, each BY EXECUTION:
1. `activatePolicyCandidate` is idempotent on `identityKey = activate:<candidateId>`
   (`ON CONFLICT DO NOTHING`) — observed: 2nd `POST …/activate` → 200 `alreadyActivated:true`.
2. Single-active-revision partial unique index `generation_policies_one_active_per_key_uq`;
   `policyActivation.dbtest.ts` *"resolves two concurrent activations for the same scope
   deterministically (one wins, one gets a clean conflict)"* ✅ + *"rollback is idempotent"* ✅.
3. The controller serializes per-owner decisions behind `SELECT … FOR UPDATE` on
   `autonomy_configs`; `autonomy.dbtest.ts` *"budget race: two concurrent activations
   for DIFFERENT scopes under the SAME owner never both succeed past a budget of 1"* ✅
   and scheduler *"…yield at most one activation"* ✅.

---

## 5. Functional defects

### 5.1 `GET /api/policy-candidates/activated-ids` (Phase 33.7) — **FIXED (FALSIFIED)**

BY EXECUTION on the live server:

```
GET /api/policy-candidates/activated-ids   →  HTTP 200
{"activatedCandidateIds":[866],"activatedCandidateActors":{"866":"human"}}
```

Routing is correct in both directions: `GET /api/policy-candidates/866` → 200 (CRUD,
not shadowed); `GET /api/policy-candidates/notanid` → 400 *"Invalid candidate id"*;
unauthenticated → 401. The literal route is registered **before** the CRUD catch-all
(`server/index.ts:252-261`) and the activation router has no `GET /:id`
(`server/content/policyActivation/routes.ts:58-67`). **The 400 no longer reproduces.**

### 5.2 Process survives a recoverable pool error (Phase 33.7) — **FIXED (FALSIFIED)**

BY EXECUTION on an isolated DB + server (`:4804`):

1. Warmed the pool, then from a separate session terminated every other backend on
   the DB (`pg_terminate_backend`, 4 killed → SQLSTATE `57P01`).
2. Server stayed up: `GET /api/health` → **200**, `GET /api/ready` → **200** (forces a
   fresh acquire), protected route → **401** (gate intact).
3. Worker log: `[db] recoverable pool error (connection lost, pool will reconnect):
   code=57P01 severity=FATAL …` — classified **recoverable** despite the Postgres
   `severity=FATAL` label, because `db.ts` keys off SQLSTATE class `57`
   (`server/db.ts:104-120,160-181`). **The process did not crash.**

### 5.3 No new functional defect found.

---

## 6. Test execution ledger (isolated DB)

Run with `NODE_ENV=test DATABASE_URL=…_auditc TEST_DATABASE_URL=…_auditc`, `--test-concurrency=1`:

| Suite | Result |
|---|---|
| `server/content/autonomy/scheduler.dbtest.ts` | **23 / 23 pass** |
| `server/content/reconcile.dbtest.ts` | **6 / 6 pass** |
| `server/jobs/runtime.dbtest.ts` | **8 / 8 pass** |
| `server/content/autonomy/autonomy.dbtest.ts` | **20 / 20 pass** |
| `server/content/policyActivation/policyActivation.dbtest.ts` | **15 / 15 pass** |
| `server/content/distribution.dbtest.ts` | **10 / 10 pass** |
| Unit set (jobs envelope/registry/failures, autonomy controller/scheduler/time, agent autonomy+activation denial, client publication-feedback + today-schedule-state) | **95 / 95 pass** |

### 6.1 Test-only observation (not a product defect)

On the **shared** `contentforge_e2e` database, the same `scheduler.dbtest.ts` run
scored **21 / 23**: *"kill switch denies without activation"* and *"daily budget is
enforced…"* timed out. Diagnosis: the failing sweep logged `candidates: 0`
immediately after its own seed — another process running the same suite against the
same DB had deleted the owner range in its best-effort `after()` cleanup (the suite's
owner range `970_000 + Date.now()%20_000 …+3_100` is not collision-proof across
concurrent runs, and this host was concurrently running sibling audit servers on
`:4801` / `:4802` against the same database). On the isolated DB both tests pass in
isolation **and** in the full suite. This is a **cross-run test-isolation weakness**,
not a runtime correctness defect; it does not change any verdict in §0.

---

## 7. Explicitly NOT verified

- **Content pipeline stages Research → Story → Opportunity → Generation**: not run —
  they require live AI/provider credentials. I verified the *downstream* stages
  (Artifact onward) by execution, and Story/Opportunity were seeded directly.
- **Real provider-side success** (an actual X/LinkedIn/Threads/Instagram/YouTube post
  being created): not run — no provider credentials. Only the failure (`policy_human`)
  and unknown/reconciliation paths were exercised. Consequently the claim "an adapter
  that returns `ok:true` truly published" rests on BY READING, not on a live provider.
- **The Learn/Experiment/Evaluation *generation* engines** (`learning.dbtest.ts`,
  `experiments.dbtest.ts`): not run in this session (their *consumers* — candidates,
  activation, rollback, evaluation gates — were executed). Same for the media/video
  and style suites.
- **Long-run soak** (multi-hour cron cadence, catch-up across many missed slots): not
  run; catch-up is bounded one-slot-per-tick by design (`scheduling.ts:26-33`).

---

## 8. Reproduce

```bash
# build + isolated live server
npm run build
DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e_auditc \
NODE_ENV=production PORT=4804 SESSION_SECRET=<local> SESSION_COOKIE_SECURE=0 \
DISABLE_CRON=1 node dist/index.cjs

# evidence suites (isolated DB)
NODE_ENV=test \
DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e_auditc \
TEST_DATABASE_URL=postgresql://e2e@127.0.0.1:5433/contentforge_e2e_auditc \
node --import tsx --test --test-concurrency=1 \
  server/content/autonomy/scheduler.dbtest.ts \
  server/content/reconcile.dbtest.ts \
  server/jobs/runtime.dbtest.ts \
  server/content/autonomy/autonomy.dbtest.ts \
  server/content/policyActivation/policyActivation.dbtest.ts \
  server/content/distribution.dbtest.ts
```

---

## 9. Bottom line

- **False-success result: none observed.** A target that the HTTP 207 envelope
  accepted as `created` can (and did) end `failed`; the UI labels acceptance as
  *"scheduled … not confirmed"*, and "published" is written only from a confirmed
  adapter outcome.
- **FALSIFIED (both fixed on this tree):** `activated-ids` 400; pool-error crash.
- **BROKEN:** none found in scope.
- **Unverified:** provider-side real success; Research/Generation engines; long soak.
- Base revision: `d60e55ed1dce34b98bf1f94a197c14861b70f5d2`.
