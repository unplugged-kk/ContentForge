# Map: ContentForge Content Intelligence and Content Creation

Label: `wayfinder:map` | Workstream: ContentForge only

## Destination

A complete, decision-locked architecture for the ContentForge Content Intelligence
and Content Creation system: domain model, workflow/state model, research
architecture, source/provider abstraction, story/content abstraction, scheduler
architecture, publishing architecture, API boundaries, versioned Video Factory
contract sketch, KEEP/REFACTOR/GENERALIZE/REPLACE/REMOVE/DEFER classification of
existing code, ticket dependency graph, and Phase B acceptance criteria — ending
at the Phase 1 exit test (one generic topic through
research → story → artifact → schedule → publish → result, reusable for a second
format without re-research). No implementation in this map; decisions only.

## Notes

- Domain: domain-agnostic content intelligence. Never hard-code the vertical
  (DevOps/AI/finance/etc. are configurable topics, not identity). X and Threads
  are distribution channels, not the architecture center.
- Locked decisions (do not relitigate): vertical slice is
  Topic → Research → Story → X post → Schedule → Publish → Result with a generic
  data model; scheduler assumes a durable queue (BullMQ or pg-boss, scheduler
  only enqueues); Video Factory output is a versioned ProductionRequest/
  ProductionResult schema sketch only, frozen until ContentForge Phase F.
- Skills every session should consult: `/grilling`, `/domain-modeling`;
  prototypes via `/prototype`; research via `/research` subagents.
- Prior art in repo: `architecture/system-architecture.md`,
  `architecture/data-model.md`, `architecture/workflows.md`,
  `docs/spec_contentforge_reimagined.md`. Generalize, don't rewrite working code.
- Hard boundaries: do NOT touch Video Factory, Mission Control, video rendering,
  or subscription/billing. Video Factory repo must not be modified.

## Decisions so far

<!-- one line per closed ticket: gist + link; map never restates the detail -->

- [Inventory existing X/content machinery](tickets/01-inventory-x-machinery.md) — xQuick X stack works; schema/storage/routes already generic; autopilot hardcodes `"x"` at 4 sites.
- [Inventory scheduler, publish path, and research inputs](tickets/02-inventory-scheduler-publish-research.md) — inline node-cron, double-publish possible, dead discovery settings; durable queue required.
- [Lock the core domain model and state machines](tickets/03-domain-model.md) — 8 distinct entities; readiness on Artifact, distribution on Publication; evidence on ResearchJob; per-format chains; immutable artifact revisions; Schedule as series + occurrences.
- [Design the research architecture](tickets/04-research-architecture.md) — one engine, two initiations; capability-based SourceProvider registry with two-stage fetch; content-addressed evidence + first-class conflicts; origin-tagged facts vs interpretation; small required core, optional rest; ranking hook seam with thresholds left foggy.
- [Design the story/content abstraction](tickets/05-story-content-abstraction.md) — Story/Opportunity/Job/Artifact each own one concern; format × channel separate with validity matrix; JSONB payloads + schema registry; full prompts frozen in policy snapshots; human-edit path without regen; gate Artifacts, selection is policy.
- [Design the scheduler architecture](tickets/06-scheduler-architecture.md) — pg-boss locked (zero new infra); generic job envelope, scheduler enqueues only; JIT occurrences + lookahead; DB-unique idempotency key as correlation ID; bounded lease with provider_called flag; publish_outcome_unknown + reconcile, never blind retry; forward-only cancellation; per-schedule timezones.
- [Design the publishing architecture (X first)](tickets/07-publishing-architecture.md) — Publication → Channel Adapter → Result with X first (xQuick stays transport, never domain); one adapter interface (validate/publish/reconcile/capability), opaque idempotency token; one Publication with per-part IDs + resume-from-gap; adapter classifies into 06's four retry classes; analytics becomes maintenance jobKind; release stays human; zero-core-change channel registration checklist.
- [Classify existing code](tickets/08-classify-existing-code.md) — posts/tweets/articles/ideas collapse REPLACED by the 8 entities (no mapping layer); discovery/scoring/prompts/autopilot GENERALIZED into providers/hooks/policies (craft kept); scheduler + x.ts REFACTORED to trigger-only + adapter layers; gateway/vault/cost-dashboard KEPT; dead config REMOVED; references/carousels/chat DEFERRED; cutover rule: new tables source of truth, no parallel tracking.

## Not yet specified

<!-- in-scope fog: suspected but not yet sharply statable; graduates into tickets -->

- Autonomous discovery ranking: which signals score "interesting", novelty/
  significance thresholds, dedupe semantics — sharpens after the research
  architecture decision lands.
- Multi-format generation policies beyond X (Threads, LinkedIn, article,
  newsletter, video spec): format-specific policy dimensions per format.
- Analytics model: what a PublicationResult carries per channel, snapshot
  cadence, how analytics feeds back into story ranking.
- Cost accounting and provenance depth: per-job cost events vs. lightweight
  logging; how much evidence is preserved per research run.
- Review/approval UX states (draft/review/published) and where humans gate the
  Phase B slice.
- Migration plan from current `posts`/`tweets`/`ideas` tables to the new model.

## Out of scope

<!-- ruled beyond the destination; never graduates unless destination is redrawn -->

- Video Factory implementation or rendering — frozen; this map outputs only the
  ProductionRequest v1 contract sketch. (Video generation lives outside
  ContentForge by design.)
- Mission Control workstream.
- Subscription/billing implementation.
- New source integrations beyond the provider abstraction (abstraction now,
  providers later in Phase D).

## Registered demand (post–Phase B, not designed)

<!-- user-requested CannerAI-parity features, 2026-09-10. Phase B stays X-only
  (post + thread). Each item names its locked home or future phase. Designing
  any of these is out of this map; ticket 10 may reference this list for
  boundary checks. -->

> Mapped separately (2026-09-10, planning only):
> [../contentforge-product/MAP.md](../contentforge-product/MAP.md) is the master
> product map — expanded goal (intelligence + creation + repurposing +
> scheduling + publishing + analytics workspace), 89 classified capabilities,
> CannerAI/Postiz/last30days/Agent-Reach reference matrices, shared primitives,
> phase ordering B–H, and the new architectural decisions the expansion
> requires. It supersedes [../cannerai-parity/MAP.md](../cannerai-parity/MAP.md),
> the earlier CannerAI-parity map, which is retained as its narrower input.
> This section and tickets 01–08 remain unaltered; Phase B stays X-only.

- Inputs (Phase D providers): YouTube-to-post, blog-to-post, discussion/Reddit
  mining, repurpose-any-URL, trending-topics digest — all arrive as
  SourceProviders behind 04 §4 + ingest into references; no new research model.
- Formats (post–Phase B policies): LinkedIn post/article, carousel decks,
  AI graphics, chat-to-post — new payload schemas + versioned policies per
  05/07 registration; carousels/canned/chat stay DEFERRED per 08.
- Channels (Phase C+): LinkedIn native publishing via the 07 §12 registration
  checklist (adapter + schema + policy + gate + error map + analytics mapper);
  zero core changes expected.
- Intelligence loop (already locked, tuning later): Memory & Voice (brand
  profile → policy assembly), custom templates (policy seed corpus), draft
  manager (Artifact readiness states), canned responses (DEFERRED per 08).
- Genuinely new (never in tickets 01–08): Chrome extension posting surface;
  agency multi-brand operation (touches the `user_id` retrofit noted in 08 —
  needs its own design, not assumed).
