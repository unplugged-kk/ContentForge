# Ticket: Design the scheduler architecture

Type: `wayfinder:grilling` (HITL) | Status: closed
Blocked by: 03 (domain model) — satisfied, closed 2026-09-10.

## Question

Decide the generic workflow scheduler: BullMQ vs. pg-boss (locked: durable
queue, scheduler only enqueues), covering scheduled/recurring research,
generation, and publishing workflows; retry handling with failure classes;
timezone-aware execution; draft/review/published states; duplicate-publication
prevention (idempotency keys); scheduled-vs-published tracking; observability
and retryability of the whole chain. Generic workflow capability — never a
hard-coded "tweet every morning".

# Ticket: Design the scheduler architecture

Type: `wayfinder:grilling` (HITL) | Status: closed
Blocked by: 03 (domain model) — satisfied, closed 2026-09-10.

## Question

Decide the generic workflow scheduler: BullMQ vs. pg-boss (locked: durable
queue, scheduler only enqueues), covering scheduled/recurring research,
generation, and publishing workflows; retry handling with failure classes;
timezone-aware execution; draft/review/published states; duplicate-publication
prevention (idempotency keys); scheduled-vs-published tracking; observability
and retryability of the whole chain. Generic workflow capability — never a
hard-coded "tweet every morning".

## Resolution

Locked 2026-09-10 via HITL grilling (2 rounds, all recommendations accepted).
Consistent with 03 (Schedule as series + occurrences, Publication pins exact
revision, single-flight lease), 04 (budget-bounded initiations become job
payloads), 05 (scheduler sees only approved Artifacts via Publications).
Evidence-driven: Postgres-only compose (no Redis), posts-per-day throughput,
one-person ops. No code written.

### 1. Final Schedule boundary

Schedule = scheduling intent, nothing else. `{artifact_id (pinned revision),
channel, format, rrule/cron, timezone (IANA), count (1 = one-shot),
status: active → paused | exhausted | cancelled, actor (for implicit manual
schedules)}`. Knows nothing of ResearchJob/Story/Opportunity/prompts/
providers/adapters. Recurrence rule changes affect future occurrences only.

### 2. Final Occurrence boundary

One concrete firing: `{schedule_id, occurrence_time (UTC instant),
status: pending → enqueued → superseded | cancelled}`. Materialized
just-in-time via idempotent upsert on `(schedule_id, occurrence_time)`, plus a
short lookahead window pre-materialized for observability. Materialized rows
are immutable except forward status moves. History is never recomputed:
exhausted/cancelled schedules leave their occurrences as audit trail.
Each occurrence binds at most one live Publication chain (cancelled chains may
be succeeded by exactly one replacement — history preserved, §12).

### 3. Publication relationship

Publication = durable distribution intent binding `(occurrence × exact
artifact_id × channel)`. Carries NO Schedule-less existence: manual "publish
now" creates an implicit one-shot Schedule (actor recorded) + immediate
Occurrence — every Publication traces to a Schedule, audit uniform.
Lifecycle: `scheduled → queued → publishing (leased) → published |
publish_outcome_unknown | failed | cancelled`. Result written once per
Publication; metrics append after.

### 4. Approved-artifact gating (invariant, locked)

ONLY `readiness=approved` Artifact revisions can be referenced by a Schedule,
enforced at Schedule creation AND re-checked at enqueue (approval revoked
between scheduling and firing → Publication cancelled, policy/human class).
The pinned `artifact_id` never floats: a new revision requires a new
Publication. In-review/rejected Artifacts are unreachable by construction —
no schedule row can point at them.

### 5. Queue architecture

Split locked: scheduler (node-cron RETAINED as trigger-only timers, §14)
materializes Occurrences + Publication rows (DB-first) and enqueues durable
jobs; workers consume, execute, update durable state. NOTHING executes inline
in a trigger ever again — today's execute-inline crons are the retired
failure mode. One generic envelope for all kinds:
`{job_kind: research|generation|publish|analytics|maintenance,
idempotency_key, payload_ref, attempt}` with identical durability, retry
classes, and observability. DB-first-then-enqueue ordering (§10-B) makes
enqueue itself safe to repeat.

### 6. BullMQ vs pg-boss decision: pg-boss, locked (not deferred)

pg-boss in the already-deployed Postgres 16. Reasons: zero new infrastructure
(no Redis in compose, none wanted for a one-person VPS); throughput is
posts-per-day; needs map cleanly (delayed/singleton/dead-letter/retention/
SKIP-LOCKED fetch, throttle for rate limits). BullMQ rejected: richer
semantics, unjustified operational cost. Revisit ONLY if multi-process
throughput or sub-second rate-limit precision outgrows pg-boss. pg-boss
mappings: singletonKey = idempotency_key (enqueue dedupe); delay + retry with
exp backoff (transient); deadLetter queue (permanent exhaustion + operator
requeue); retention/archive (audit); throttle (X rate limits, honoring
Retry-After as reschedule, not attempt).

### 7. Idempotency strategy

Authoritative key: `Publication.idempotency_key =
(schedule_id, occurrence_time, artifact_id)`, UNIQUE constraint in Postgres —
the database, never application check-then-act, is the arbiter. Same key
propagates as pg-boss singletonKey and end-to-end correlation ID (§13).
Duplicate enqueue (scheduler retry, restart, double manual click) collapses to
one queue job AND one Publication row via upsert. Provider-side: no exactly-
once claim — X offers no post idempotency, so external duplicates are
prevented by single-flight lease + unknown-state discipline, not by provider
guarantee.

### 8. Publishing lease strategy

Single-flight via columns `(locked_by, locked_at, lease_expires_at)` acquired
by one atomic `UPDATE … WHERE status=queued AND (lease free OR expired)
RETURNING`. Bounded TTL (e.g. 10 min) exceeding the maximum provider-call
timeout — no renewal, no heartbeats. Second worker seeing an active lease
backs off (never steals). Expiry self-heals crashes; reclaim goes through the
`provider_called` flag (§10-D): set immediately BEFORE provider invocation, so
reclaim distinguishes "died before any external effect" (safe retry) from
"died possibly after" (unknown path).

### 9. Retry / DLQ strategy

- TRANSIENT (network/timeout/5xx/infra): 3 attempts, exp backoff (≈5/30/120
  min, today's delays kept as queue config), then DLQ.
- RATE_LIMITED: reschedule honoring Retry-After — NOT counted as an attempt.
- PERMANENT (malformed/unsupported/invalid config): terminal + DLQ
  immediately, no retries.
- POLICY/HUMAN (provider rejection, revoked approval, user cancel):
  `failed` terminal, NEVER auto-retried, surfaced to operator.
DLQ rows carry payload + error + history + operator requeue action (requeue =
new attempt on same Publication, audit intact). Silent give-up (today's
default-off retry with no DLQ) is explicitly retired.

### 10. Crash / recovery semantics (A–H walked)

- A (crash before enqueue): nothing durable except possibly the Occurrence;
  next tick upserts + enqueues. No dup possible.
- B (enqueued, crash before local state): impossible to strand — ORDER IS
  DB-FIRST (Occurrence + Publication rows committed) THEN enqueue; re-enqueue
  after restart collapses on singletonKey + row upsert.
- C (worker dies pre-lease): no lease exists; queue redelivers after
  visibility timeout; another worker acquires atomically. No dup.
- D (dies holding lease, pre/post-call ambiguous): lease expires; reclaim
  reads `provider_called` — false → safe retry as new attempt; true/missing →
  `publish_outcome_unknown`, never blind retry. The flag is the load-bearing
  detail that makes reclaim sound.
- E/F (provider accepted, timeout/crash before record): unknown state +
  reconcile-first recovery (provider lookup in account/recent window keyed by
  correlation), then mark published or requeue exactly once.
- G (retry after uncertain): FORBIDDEN to auto-retry; reconcile-or-human only.
- H (two workers, same job): atomic lease serializes; loser backs off. Queue
  redelivery + unique key make double-execution impossible at the DB layer.
Net: at-most-once external intent with explicit, queryable uncertainty —
`publish_outcome_unknown` is a first-class terminal-for-automation state, not
a euphemism for failed.

### 11. Timezone / DST semantics

Per-Schedule IANA timezone (IST the configured default, never the
architectural identity); occurrences materialize as UTC instants computed in
schedule tz; server tz irrelevant. DST: non-existent local times shift forward,
ambiguous times take the first occurrence, resolution recorded on the
Occurrence row. Retires global CRON_TZ dependence.

### 12. Cancellation / rescheduling semantics (forward-only)

Cancel Schedule → future + materialized-unexecuted occurrences `cancelled`;
queued-unleased Publications → `cancelled`; leased/publishing runs to
completion with Result recorded normally (no mid-call kill — recall is
impossible anyway); published/Results immutable. Revision replaced → old
queued Publication `cancelled (superseded)` + new Publication for the new
revision (pinned-revision rule holds; history shows both). Reschedule =
cancel-forward + new Schedule, never edits to executed rows.

### 13. Observability / correlation model

`Publication.idempotency_key` IS the end-to-end correlation ID — stamped on
Occurrence, queue payload, every worker log line, and Result. Attached:
pg-boss job id, attempt number, lease holder/history, provider `external_id`.
Chain queryable as Schedule → Occurrence → Publication → attempts → Result
with zero additional trace infrastructure. Minimum alert set (deferred detail,
locked existence): DLQ growth, `publish_outcome_unknown` age, scheduled-but-
unexecuted past SLA, published-without-Result.

### 14. Existing-code mapping (locked; 08 may refine, not relitigate)

- node-cron trigger layer: REFACTOR → timers only, bodies reduced to
  materialize + enqueue. DISABLE_* flags KEEP, generalized per job_kind.
- Per-minute publish full-scan loop: REPLACE (materializer + pg-boss).
- Hand-rolled retry/backoff ([5,30,120]×3, default-off): REPLACE (queue
  config + DLQ); delays kept as initial transient policy.
- CRON_TZ global: GENERALIZE → per-schedule tz (§11).
- scheduler.ts cron table: GENERALIZE → job_kind trigger registry.
- `tryPublishPostById` execution body: REFACTOR → publish-worker handler
  (lease acquire → eligibility re-check → provider call with
  `provider_called` flag → Result write), minus status-string state machine.
- `assertEligibleForXPublish`: GENERALIZE → per-channel adapter policy
  invoked at worker time (07 owns contents).
- Analytics-sync cron: GENERALIZE → maintenance job_kind.
- `status/retryCount/lastRetryAt/errorMessage` on posts: schema retires with
  the posts split (05 §11); no parallel status tracking during migration —
  new tables are source of truth from cutover.

### 15. Remaining fog / intentionally deferred

pg-boss tuning numbers (pool size, timeouts, retention windows); exact
lookahead depth; throttle limits per channel; reconcile-window mechanics per
adapter (07); partial-thread resume protocol (07; correlation key provided
here); DLQ/unknown-state UI surfacing (approval/UX fog from 03); cutover
mechanics (parallel-run vs flag-flip); multi-worker deployment topology.
None block 07.

### 16. Consequences for tickets 07–10

- 07 (publishing): receives lease + idempotency + unknown-state + correlation
  contracts; owns adapter contents — eligibility gates, provider call,
  reconcile lookups, partial-thread resume, attribution verification.
- 08 (classification): §14 is directional input; verdicts per area still open.
- 09 (Video Factory): unaffected — scheduling never sees video_script
  internals; ProductionRequest export stays an Artifact-level concern.
- 10 (acceptance): Phase B provability now includes killing the worker mid-
  publish and showing exactly one external post + `published` (or explicit
  unknown), plus scheduler-restart with zero double-enqueue.
