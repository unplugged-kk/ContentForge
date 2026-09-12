# Ticket: Design the story/content abstraction

Type: `wayfinder:grilling` (HITL) | Status: closed
Blocked by: 03 (domain model) — satisfied, closed 2026-09-10.

## Question

Decide the reusable intermediate abstraction: Research → Story/Insight →
Content Opportunities → Content Artifacts, where one story serves X post, X
thread, Threads, LinkedIn, article, newsletter, video script, and future
formats. No X-specific fields in the core model. Decide the format-specific
generation policy dimensions (platform, format, tone, audience, length,
language, style, CTA, factuality and attribution requirements) kept separate
from the underlying research. Use `/grilling` + `/domain-modeling`; raise
fidelity with `/prototype` if "what does a Story look like" stalls.

# Ticket: Design the story/content abstraction

Type: `wayfinder:grilling` (HITL) | Status: closed
Blocked by: 03 (domain model) — satisfied, closed 2026-09-10.

## Question

Decide the reusable intermediate abstraction: Research → Story/Insight →
Content Opportunities → Content Artifacts, where one story serves X post, X
thread, Threads, LinkedIn, article, newsletter, video script, and future
formats. No X-specific fields in the core model. Decide the format-specific
generation policy dimensions (platform, format, tone, audience, length,
language, style, CTA, factuality and attribution requirements) kept separate
from the underlying research. Use `/grilling` + `/domain-modeling`; raise
fidelity with `/prototype` if "what does a Story look like" stalls.

## Resolution

Locked 2026-09-10 via HITL grilling (2 rounds, all recommendations accepted).
Consistent with ticket 03 (entity states, immutability, reuse rule) and ticket
04 (origin tags, evidence on ResearchJob). No prototype needed — the Story
shape stayed sharp through grilling. No code written.

### 1. Final entity boundaries

Four layers, each owning exactly one concern: Story owns editorial meaning
(what is worth saying). Opportunity owns selection (why this angle, format,
channel, now). GenerationJob owns execution (how it was made, reproducibly).
Artifact owns content (the immutable thing itself). Nothing leaks across:
Stories carry no prompts, Opportunities carry no content, Jobs carry no
distribution state, Artifacts carry no generation logic. Today's code violates
every one of these (draft prompts built from idea blobs, posts rows mixing
content with schedule state) — the boundaries are the migration target.

### 2. Ownership / relationships

ResearchJob → Story (N, `research_job_id` nullable for human/imported) →
Opportunity (N per Story, `story_id`) → GenerationJob (N per Opportunity,
`opportunity_id`; regens are siblings, not edits) → Artifact (1 per
successful job, `generation_job_id` + `opportunity_id`; human edits add rows
with `generation_job_id` null and `provenance=human_edit`). Artifact →
`supersedes_id` chain for revisions. Downward FKs only (plus supersedes).
Killing an Opportunity never touches its Story; rejecting an Artifact never
touches its Opportunity.

### 3. Story definition

The reusable editorial/intelligence object. Required: `title`,
`insight_body` (generated, origin-tagged per ticket 04), `basis_claim_ids`
(sourced ResearchJob claims this insight rests on — may be empty only for
`provenance=human` with author notes), `angles[]` (generated candidate
framings), `evidence_refs` (IDs, never copies), `provenance`
(researched/human/imported), lifecycle `draft → ready → used | archived` (per
03; `used` is informational, Stories keep spawning formats). A Story is NOT a
promoted idea row: promotion requires a synthesis step attaching claim refs
and origin tags. `discovered_ideas` rows, however rich, never qualify without
that step — this is the adversarial lock against relabeling today's blobs.

### 4. Opportunity definition

A lean selector: `{story_id, format, channel, audience, angle/hook (generated
text), priority/relevance + score_breakdown, proposer: human|autonomous,
status: proposed → selected | killed (+kill_reason)}`. Many per Story
(different angles, formats, channels). Carries no content, no prompt, no model
config. Autonomous proposers and humans share the identical lifecycle —
provenance records who proposed, process treats them the same.

### 5. GenerationJob definition

One reproducible execution: `{opportunity_id, policy_snapshot (FROZEN —
format_policy_ref + version, model, tone/audience/length/language/style/CTA/
factuality/attribution params, full rendered system_prompt_text +
user_prompt_text, input_content_hashes, template_versions),
idempotency_key (opportunity + policy hash, UNIQUE), attempt counter +
attempts[] log, status: queued → running → succeeded | failed, model, cost,
regen link {prior_artifact_id, rejection_reason} when applicable}`. Full
prompts embedded, not referenced — today's unrecorded prompt construction
(brand + voice + template + pulse assembled at call time, then lost) is the
exact failure this fixes. Retries increment the counter on the same row;
success yields exactly one Artifact. Regen after rejection stays on the same
Opportunity (still selected) with feedback embedded — never kill-and-reselect.

### 6. Artifact definition

Generic immutable content: `{generation_job_id (null for human edits),
opportunity_id, format, channel, payload: JSONB (validated at write against
the format's registered schema), readiness: draft → in_review → approved |
rejected, approved_at, supersedes_id, provenance (generated/human_edit),
attribution[] (MANDATORY — possibly empty with explicit reason)}`. Supports X
post, X thread, Threads, LinkedIn, article, newsletter, video_script, and
future formats with zero core changes — new format = new registered payload
schema. Publication pins the exact `artifact_id` (per 03); approving revision
N never approves N+1.

### 7. Format / channel boundary

Separate dimensions, locked. `format` = content shape (`short_text`,
`thread`, `article`, `newsletter`, `video_script`, …); `channel` =
distribution target (`x`, `threads`, `linkedin`, `web`, `video_factory`, …).
Opportunity and Artifact carry both; a config-level validity matrix (e.g.
`video_script → video_factory` only) rejects nonsense pairs. This retires
today's conflation (`postType` implying X, `targetPlatform="x"` hardcoded at 4
sites, articles in a separate table as format-split-at-storage).

### 8. Revision / immutability rules

Any content change = new Artifact row with `supersedes_id` → prior. Two paths:
(a) LLM regen via new GenerationJob (rejection feedback embedded); (b) human
edit (typo fixes, review tweaks) as `provenance=human_edit` row with actor +
note, no GenerationJob, returning to `in_review` — human edits never
self-approve. Approved rows are frozen forever. The supersedes chain gives
full audit (what was reviewed vs what published) with no mutation anywhere.

### 9. Research reuse invariant (locked, restated)

New format from an existing Story MUST NOT trigger new research: it creates a
new Opportunity on the same Story (same ResearchJob, same evidence). Only an
explicit user-initiated ResearchJob (optionally `parent_job_id`-linked)
refreshes intelligence. Example: Research → Story → X post, later Story →
LinkedIn post reuses ResearchJob + Story untouched. The frozen result blob
(04) + origin-tagged Story make this safe rather than hopeful.

### 10. Approval implications

Single architectural gate: Artifact `in_review → approved` requires a human
below automation Level 3. Opportunity selection is policy, not architecture —
autonomous selection may flow straight to generation. Publication-release
gating is ticket 07's scope. Human-edit Artifacts re-enter `in_review`
(uneditable approval). Net: two human touchpoints max in Phase B
(artifact approval, publication release), zero mandatory gates on selection.

### 11. Existing-code mapping (direction; verdicts in ticket 08)

- `posts` + `tweets`: split along readiness/distribution — content columns +
  `tweets` rows become `x_post`/`x_thread` payloads under the schema registry;
  status/scheduledAt/retry columns become Schedule/Publication state. `tweets`
  table retires into payload JSONB.
- `articles`: same treatment as a third payload schema (`article`), unifying
  the two artifact stores into one Artifact table.
- `ideas` / `discovered_ideas`: signals feeding Opportunity proposal
  (rank/score → selection input), never Stories. Columns like
  `contentAngles/suggestedHook/viralScore` inform the proposer; they do not
  transfer as provenance.
- Autopilot draft builders (`generateDraftFromIdea`,
  `generateArticleDraftFromIdea`, rss autopost): become GenerationJob
  executors — same prompt-building craft, but inputs switch from idea blobs to
  (Story + basis claims + frozen policy), outputs write Artifacts with embedded
  policy snapshots instead of posts rows.
- `templates` (pattern + postType + pillar): seed corpus for versioned format
  policies, generalized off postType/pillar keys.
- `viral_scores` (postId/articleId, versioned): per-Artifact evaluation
  records, re-keyed to artifact_id — correctly placed already, just repointed.
- Brand prompt + voice + thread utils: format-policy content (X policy),
  parameterized by channel instead of hardcoded `"x"`.
- `assertEligibleForXPublish`: adapter-level policy (per 03 §4), invoked at
  Publication time, not generation.

### 12. Remaining fog / intentionally deferred

Non-X format payload schemas and policy contents (beyond X); validity-matrix
contents; selection-score weights; approval UX placement and surfacing;
migration mechanics (backfill vs parallel-run vs cutover); cost-accounting
depth on GenerationJobs; whether Opportunities expire (staleness vs Story
freshness). None block tickets 06/07.

### 13. Consequences for tickets 06–10

- 06 (scheduler): operates ONLY on approved Artifact revisions via
  Schedule occurrences → Publications. Needs occurrence materialization,
  lease acquisition, and retry/DLQ mechanics — all inputs locked here.
- 07 (publishing): adapters consume Artifact payloads by format schema +
  attribution blocks; eligibility gates are per-channel policy.
- 08 (classification): §11 is the directional input; per-area verdicts still
  to be set.
- 09 (Video Factory contract): the export unit is a `video_script` Artifact +
  its frozen policy — sketch the request as (artifact_ref, policy_snapshot,
  attribution), nothing more.
- 10 (acceptance): Phase B slice provable as Story → Opportunity
  (x_thread/x) → GenerationJob → approved Artifact → Schedule → Publication →
  Result, then a second Opportunity (different format) off the same Story with
  no new ResearchJob.
