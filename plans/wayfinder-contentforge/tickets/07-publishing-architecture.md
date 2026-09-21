# Ticket: Design the publishing architecture (X first)

Type: `wayfinder:grilling` (HITL) | Status: closed 2026-09-10
Blocked by: 03 (domain model), 05 (story/content abstraction) — satisfied, both closed.

## Question

Decide the publishing side for the Phase B slice: channel-adapter model with X
as the first adapter (generalizing `server/social/x.ts`, honoring
`X_API_COMPLIANCE_AND_RISK.md`), Publication vs. PublicationResult separation,
result recording, and how future channels (Threads, LinkedIn, …) plug in
without core-model changes. Distribution channels stay outside the
architecture's center.

## Resolution

Locked 2026-09-10 via HITL grilling (3 rounds, all recommendations accepted).
Consistent with 03 (Publication pins occurrence × exact revision; Result is proof),
05 (adapters own channel mechanics; eligibility gates are adapter policy), and 06
(lease + DB-unique idempotency key + four retry classes + reconcile-first unknown
handling + maintenance jobKind). No code written; xQuick stays the X transport
without becoming the domain.

### 1. Target shape (locked)

Approved Artifact Revision → Publication → Channel Adapter → PublicationResult,
with X as the first adapter:

Publication → X Publisher Adapter → xQuick / X API

Core owns intent, state, keys, and audit. Adapters own mechanics. Channels stay
outside the architecture's center.

### 2. Adapter contract (Q1)

One interface per adapter: `validate + publish + reconcile + capability probe`.
Core passes the adapter everything it needs — no adapter-side fetching of core
state:

- `payload` (Artifact payload, already schema-validated at write)
- `attribution[]` (mandatory block from the Artifact)
- `idempotency_key` as an OPAQUE token (06's `(schedule_id, occurrence_time,
  artifact_id)` UNIQUE underneath; the adapter never parses it)
- `policy excerpt` (channel-relevant params: limits, tone/CTA rules, timeout
  budget — not the full generation snapshot)

Adapter returns a normalized outcome: `external part IDs + proof data`, or a
classified failure in core's four retry classes (transient / rate_limited /
permanent / policy_human). Splitting validate from publish was rejected — one
surface, clearer test story.

### 3. Publication vs PublicationResult (Q2)

Attempt vs proof, reconcile fills the gap:

- Publication = attempt state (`scheduled → queued → publishing (leased) →
  published | publish_outcome_unknown | failed | cancelled`), per 03/06.
- Result = proof written once per Publication: `external_id(s)`, `external_url(s)`,
  `published_at`, channel, plus appended metrics snapshots (§8).
- Reconcile (provider lookup in account/recent window keyed by correlation)
  writes: found → Result with proof (state `published`); not found →
  `publish_outcome_unknown` persists with reconcile attempt logged, operator or
  later reconcile resolves. Metrics append after proof exists, never before.

Merging attempt and proof into one row was rejected — it re-collapses the 03 split.

### 4. Thread / multi-part atomicity (Q3)

One Publication, per-part records, resume-from-gap:

- A thread is ONE Publication with per-part external IDs stored in order
  (`part_index → external_id`), chained via `reply_to_tweet_id`.
- Partial failure is a first-class queryable state: `failed-partial` (parts
  posted, gap unposted) distinct from `published` and `failed`.
- Retry resumes from the first unposted part using stored per-part IDs;
  reconcile verifies the gap (§11). No delete-and-republish (needs delete
  rights, risks litter); no sub-publication fan-out (more rows, no extra
  information).

### 5. Idempotency + retry classification (Q4)

06's key and lease stand unchanged; the adapter classifies, core enforces:

- Key `(schedule_id, occurrence_time, artifact_id)` UNIQUE in Postgres is the
  arbiter; it propagates as the pg-boss singletonKey and end-to-end correlation
  ID. Including adapter version in the key was rejected (key churn on config
  change).
- The adapter maps provider outcomes to the four classes: 429/Retry-After →
  rate_limited (reschedule, not an attempt); 5xx/timeout → transient;
  duplicate-content/400/validation → permanent terminal; 401/403/policy
  rejection, revoked approval → policy_human terminal, never retried.
- xQuick specifics mapped now: `XQUICK_POST_ID_MISSING` → transient (response
  mapping failure, safe to reconcile); still-pending write action after poll
  exhaustion → `publish_outcome_unknown`, reconcile-first, never blind retry.
  `translateXError` message matching survives as the adapter's classifier input
  but the CLASSES are core's — no classifying by free text outside the adapter.
- Unknown-state reconcile is adapter code (provider lookup mechanics) invoked
  under core's contract: reconcile-or-human only, auto-retry forbidden (06 §10-G).

### 6. X adapter internals (Q5)

Everything X-shaped moves into the X adapter, layered:

- Transport: xQuick POST + reply chaining + 202/write-action polling +
  timeouts + auth headers + endpoint/env config. xQuick is transport detail —
  swappable without touching the contract.
- Channel policy: `assertEligibleForXPublish` (generalized per-channel shape),
  numbering (`threadUtils`), 280-slicing, finisher-CTA append, compliance rules
  (§10).
- Payload assembly: ordered texts from the Artifact payload → numbered units →
  post chain → per-part IDs + URLs.
- Error translation: `translateXError` becomes the adapter's classifier (§5).

Nothing X-shaped stays in core. Wrapping `x.ts` unchanged behind a mapper was
rejected — it carries the posts-status collapse forward. Generation stays clean:
prompts emit unnumbered units (current `brandSystemPrompt` ban stands);
numbering is publish-time mechanics, never baked into immutable Artifacts.

### 7. Hardcoded-X migration rule (Q6)

Every hardcoded `"x"` site takes a channel parameter defaulting to `x`.
Inventory (worse than ticket 01's 4 sites): `rssAutopost`, `youtubeConnector`,
`brandSystemPrompt` default, autopilot ×5, seed ×4, routes ×3, plus
`storage.getConnectedAccount("x")` call sites. Config-driven channels were
rejected — no config home exists and defaults would still lie. The rule:
channel flows from Opportunity → Artifact → Schedule → Publication →
adapter selection; call sites pass it through; `x` is the default, never the
assumption. Ticket 08 assigns per-site verdicts.

### 8. Analytics / Result evolution (Q7)

Analytics becomes a 06 `maintenance` jobKind writing Result metrics snapshots:

- At publish time Result carries proof only (`external_id(s)`, `external_url(s)`,
  `published_at`, channel).
- The maintenance job runs the current `syncPostAnalyticsFromX` logic
  (aggregate `public_metrics` across thread parts) on cadence (daily, 30d window
  retained as initial policy), appending snapshots to Result.
- Fire-and-forget after publish is retired as orphan code — the first sync is
  either part of the publish worker's completion path or the first maintenance
  tick, owned and observable either way. Budget logging (`xquick-api` usage rows)
  is kept.
- Inline-first-sync (blocking publish on metrics) was rejected — slower publish,
  no extra safety. Manual-only refresh was rejected — metrics go stale.

Per-channel metric shape lives in the adapter's analytics mapper; Result stores
snapshots opaquely.

### 9. X articles (Q8)

Zero core treatment. Articles stay gated (`getXArticlePublishCapability` as-is);
the X adapter declares `post + thread` capability only. When article transport
lands, it arrives as a new format payload schema + adapter capability flag —
core unchanged by construction. Modeling articles now was rejected (design
surface for a frozen capability).

### 10. Release gating (Q9)

Release stays human in Phase B: artifact approval (readiness, 05) and
publication release (distribution) are distinct human touchpoints. Schedule
creation is NOT release — a release action (or explicit release flag at
scheduling) authorizes the Publication chain. Manual publish-now goes through
the same gate via an implicit one-shot Schedule (06 §3: every Publication
traces to a Schedule, actor recorded). The adapter never publishes an
unreleased Publication; auto-release on schedule was rejected.

Net Phase-B touchpoints: artifact approval + publication release (05 §10 stands).

### 11. Compliance placement (Q10 in session — second Q10 renumbered)

`X_API_COMPLIANCE_AND_RISK.md` + the `X_COMPLIANCE_RULES` machine table stay as
the human reference; enforcement becomes adapter-level policy invoked by the
worker AFTER lease acquisition (eligibility can change between enqueue and
execution — revoked approval must cancel even a leased Publication, 06 §4).
Core never learns channel law. Gate order in the worker: acquire lease →
re-check eligibility (adapter gate) → provider call with `provider_called`
flag → Result write (06 §14 worker shape stands).

### 12. Future-channel checklist (Q10)

Registering Threads (or LinkedIn, …) requires exactly: (a) adapter interface
impl (validate/publish/reconcile/capability); (b) payload schema registration;
(c) format policy version; (d) eligibility gate (per-channel policy clone);
(e) error→class map; (f) analytics mapper. Proof of no core change: new channel
ships with zero migrations to core tables and zero core code edits — the
validity matrix (05) gains a row, nothing else. Clone-and-edit of the X adapter
was rejected as drift guarantee; per-channel design tickets were rejected as
process drag.

### 13. Partial-thread resume (Q12)

Resume from the stored gap, no pre-verification: the worker reads per-part
external IDs, posts from the first missing index, chains onto the last posted
part. Re-verify-before-resume was rejected (costs reads, races external
deletes anyway). Distinguishing "gap never posted" from "posted then deleted
externally" is reconcile's job: lookup by correlation in the account/recent
window — found externally but missing locally → record and continue the chain;
truly absent → post the gap. Delete-and-republish was rejected (§4).

### 14. Existing-code mapping (direction; verdicts in ticket 08)

- `server/social/x.ts`: SPLIT — transport + mechanics + gate + error map move
  into the X adapter (§6); `Post & Tweet[]` input signature retires (adapter
  takes Artifact payload + attribution + opaque key).
- `shared/xDeveloperRisk.ts`: GENERALIZE — gate shape becomes per-channel
  adapter policy; X rules table stays as the X instance; doc stays human
  reference.
- `server/utils/threadUtils.ts`: MOVE into X adapter mechanics (numbering is
  publish-time, X-specific).
- `translateXError`: MOVE into X adapter as classifier input (§5).
- `syncPostAnalyticsFromX` + `refreshXAnalytics` + daily analytics cron:
  GENERALIZE → maintenance jobKind + per-channel analytics mapper (§8).
- `X_THREAD_FINISHER` env + CTA patterns: X channel-policy config (§6 policy
  excerpt).
- `getXPostingConfigSummary` / capability probe: becomes the X adapter's
  `capability` probe impl.
- `getXArticlePublishCapability`: KEEP gated as-is (§9).

### 15. Remaining fog / deferred

pg-boss tuning; reconcile-window mechanics per adapter; exact lookahead depth;
throttle limits; partial-thread edge cases (account deleted mid-thread, X-side
thread break); DLQ/unknown-state UI surfacing; cutover mechanics. None block 08.

### 16. Consequences for 08–10

- 08 (classification): §7 inventory + §14 mapping are directional inputs;
  per-area verdicts still to be set.
- 09 (Video Factory): unaffected — export unit stays a `video_script` Artifact
  + frozen policy (05 §13); publishing never sees video internals.
- 10 (acceptance): Phase-B provability now includes killing the worker mid-thread
  and showing resume-from-gap with exactly-once external effect, plus a Threads
  registration dry-run proving zero core changes.
