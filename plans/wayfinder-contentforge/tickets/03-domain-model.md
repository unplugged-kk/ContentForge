# Ticket: Lock the core domain model and state machines

Type: `wayfinder:grilling` (HITL) | Status: closed
Blocked by: 01, 02 (needs inventories first) — satisfied, findings recorded.

## Question

Decide the canonical entities and their state machines, keeping Research Job,
Story/Insight, Content Generation Job, Content Artifact, Publication,
Publication Schedule, and Publication Result distinct (never collapsed into one
"post" record). For each: key fields, ownership/links across the chain
(Research → Story → Opportunities → Artifacts → Schedules → Publications →
Results), states (including draft/review/published and scheduled vs. actually
published), and the reuse rule (same research/story yields N formats without
re-research). Use `/grilling` + `/domain-modeling`.

## Resolution

Locked 2026-09-10 via HITL grilling (2 rounds, all recommendations accepted).
Adversarial review applied: no mixed readiness/distribution state, no mutable
post-approval content, no mandatory-research provenance, no X-shaped core.

### 1. Entities (all 8 distinct — none merged)

| Entity | Meaning | Key fields |
|---|---|---|
| ResearchJob | One directed or autonomous research run. Owns evidence. | id, kind (directed/autonomous/human_input), topic/query, idempotency_key, status, evidence_refs, started/finished_at |
| Story | Reusable insight synthesized from research (or human input). The unit of reuse. | id, research_job_id NULLABLE, provenance (researched/human/imported), title, insight_body, interpretation_marked, evidence_refs (IDs only), status |
| Opportunity | One (story × format × channel) candidate with its own score/lifecycle. | id, story_id, format, channel, score, score_breakdown, status (proposed/selected/killed), kill_reason |
| GenerationJob | One LLM run producing content for an Opportunity under a format policy. | id, opportunity_id, policy_snapshot (frozen), idempotency_key (opportunity + policy hash), attempt, status, model, cost |
| Artifact | Immutable content revision produced by a GenerationJob. | id, generation_job_id, opportunity_id, format, channel, payload_ref, supersedes_id NULLABLE, readiness (draft/in_review/approved/rejected), approved_at |
| Schedule | Intent to publish: recurrence series + materialized occurrences. One-shots are count=1 series. | id, artifact_id, channel, rrule/cron, timezone, count, status |
| Publication | One execution attempt binding (schedule occurrence × exact artifact revision). | id, schedule_id, occurrence_time, artifact_id (pinned revision), idempotency_key (schedule + occurrence + artifact revision), lease (publishing + row lock), status, attempt, last_error |
| Result | Outcome + analytics for one Publication. | id, publication_id UNIQUE, external_id, external_url, published_at, metrics snapshots, source |

Ownership flows strictly downward: ResearchJob → Story → Opportunity →
GenerationJob → Artifact → Schedule → Publication → Result. Children hold FKs to
parents; nothing points upward except `supersedes_id` (Artifact → prior Artifact).

### 2. State machines and transition rules

- ResearchJob: `queued → running → complete | failed`. Failed → retry as new
  attempt (same idempotency_key resumes, never duplicates evidence). Complete is
  terminal and its evidence is immutable.
- Story: `draft → ready → used | archived`. `used` means ≥1 Opportunity
  selected (informational, not terminal — a used Story keeps spawning formats).
  No `killed` on Story; killing happens at Opportunity level.
- Opportunity: `proposed → selected | killed` (kill_reason required).
  Terminal both ways; re-selection creates a new Opportunity, never reopens.
- GenerationJob: `queued → running → succeeded | failed`. Failed: retry
  transient with backoff, terminal on bad input, DLQ on exhaustion (mechanics in
  ticket 06). Each retry is a new attempt under the same idempotency_key.
- Artifact readiness ONLY: `draft → in_review → approved | rejected`.
  Rejected → new GenerationJob → new Artifact row (never edit). Approved is
  frozen: approving revision N never approves N+1.
- Schedule: `active → paused | exhausted | cancelled`. Occurrences materialize
  per firing; each occurrence binds at most one Publication attempt chain.
- Publication distribution ONLY: `scheduled → queued → publishing → published |
  failed | cancelled`. `publishing` is a single-flight lease (row lock); second
  claimant blocks, never double-publishes. Transient/rate-limited → retry with
  backoff; policy rejection → failed terminal + policy flag, never retry.
- Result: written once per Publication (`publication_id` UNIQUE — at most one
  Result per attempt), metrics snapshots append thereafter.

Hard separations (adversarial locks):
- Readiness lives ONLY on Artifact; distribution lives ONLY on Publication/
  Schedule. No entity carries both (this is the exact `posts.status` collapse
  being removed). The scheduler sees only Publications of approved Artifacts —
  an unreviewed Artifact is unreachable by construction.
- Scheduled ≠ published: Schedule/Occurrence is intent; Publication is attempt;
  Result is proof (`external_id` present). "Scheduled but never published" and
  "published but unrecorded" are both queryable states, closing the
  27-night-silent-stall class of failure.
- Evidence lives ONLY on ResearchJob (immutable once complete). Story holds
  evidence ID references + its own interpretation explicitly marked generated.
  Artifacts carry only minimal policy-required attribution snippets. Nothing
  copies raw evidence downstream (no stale duplicates); nothing publishes
  without resolving its references (no dangling attribution).

### 3. Reuse rule (locked)

One ResearchJob → N Stories; one Story → N Opportunities (one per format ×
channel); each Opportunity → its own GenerationJob → Artifact chain. Research
never re-runs for a new format; generation is cheap and format policies differ.
Per-format chain (not one-Artifact-N-renderings) because platform constraints
(char limits, thread shapes, CTA placement) differ at generation time, not just
at publish time.

### 4. Generic core vs. platform metadata

Core entities carry only: `format` (string, e.g. `x_post`, `x_thread`,
`threads_post`), `channel` (string), `payload_ref` (opaque pointer), and
`policy_snapshot` (frozen JSON). ALL platform specifics — 280-char slicing,
thread numbering, finisher CTA, xQuick payloads, per-platform eligibility gates
— live in channel adapters + format policies, never in core columns. No
X-shaped field (no `tweetCount`, no `thread_position`) on any core entity;
X-thread payload shape is one format's payload schema. The
`assertEligibleForXPublish` pattern (status gate + invoker role) is cloned per
platform as adapter policy, not core logic.

### 5. Legacy conceptual mapping (verdicts stay in ticket 08)

- `posts` = Artifact + Publication + Schedule collapsed → must SPLIT along the
  readiness/distribution line. `tweets` (postId, position, content) = payload of
  an `x_thread` Artifact, i.e. format-specific payload storage, not an entity.
- `ideas` / `discovered_ideas` = pre-story signals → feed Opportunity proposal,
  never become Stories directly (a signal becomes a Story only via synthesis
  with provenance).
- `analytics` = proto-Result, evolves into Result (needs unique
  per-publication identity it lacks today).
- `targetPlatform` string + per-platform `externalIds`/`externalUrls` records
  already point the right way and are absorbed into Artifact.channel /
  Result.external_id.

### 6. Phase B vs. fog (locked scope cut)

Locked here: entities, ownership, states, transitions, idempotency placement,
reuse rule, legacy mapping. Deliberately fog (tickets 04–07, 10 sharpen):
autonomous ranking thresholds, non-X format policies, Result metric detail,
cost-accounting depth, approval UX placement. Ticket 08 owns per-area
KEEP/REFACTOR/GENERALIZE/REPLACE/REMOVE/DEFER verdicts; ticket 06 owns queue
choice (BullMQ vs pg-boss) and retry numbers; ticket 09 owns the
ProductionRequest sketch (an Artifact + format policy exported across the
boundary — Artifacts are the unit Video Factory will consume).
