# Ticket: Design the research architecture

Type: `wayfinder:grilling` (HITL) | Status: closed
Blocked by: 03 (domain model) — satisfied, closed 2026-09-10.

## Question

Decide: (a) directed research vs. autonomous discovery behind one engine;
(b) the extensible SourceProvider abstraction (initial set ~ RSS/Web/Reddit/
YouTube/GitHub/X/papers, never a closed hard-coded list); (c) the structured
research-run output schema — sources, evidence, claims, provenance, entities,
topics, events, timestamps, facts, conflicts, confidence, synthesis,
implications, content angles, novelty/significance, relevance, opportunities —
with source facts strictly separated from generated interpretation. Reusable
research (no repeated research per format) is a hard constraint.

# Ticket: Design the research architecture

Type: `wayfinder:grilling` (HITL) | Status: closed
Blocked by: 03 (domain model) — satisfied, closed 2026-09-10.

## Question

Decide: (a) directed research vs. autonomous discovery behind one engine;
(b) the extensible SourceProvider abstraction (initial set ~ RSS/Web/Reddit/
YouTube/GitHub/X/papers, never a closed hard-coded list); (c) the structured
research-run output schema — sources, evidence, claims, provenance, entities,
topics, events, timestamps, facts, conflicts, confidence, synthesis,
implications, content angles, novelty/significance, relevance, opportunities —
with source facts strictly separated from generated interpretation. Reusable
research (no repeated research per format) is a hard constraint.

## Resolution

Locked 2026-09-10 via HITL grilling (2 rounds, all recommendations accepted).
Respects ticket 03 (evidence on ResearchJob, immutable when complete, Stories
reference by ID). No code written; no new integrations added.

### 1. Final architectural decision

One Research Engine, two initiation strategies, one output shape. Directed
research ("research AI agents") and autonomous discovery ("find what's worth
covering today") are initiations, not systems: they differ only in what seeds
the job and what bounds it. Everything below initiation — collect, normalize,
synthesize, validate, freeze — is shared code producing byte-compatible
ResearchJob output. Follow-up deep-dives are new ResearchJobs with
`parent_job_id`, never mutations of a completed job.

### 2. Research Engine boundary

```
Initiation (directed | autonomous | human_input)
  → Collect (providers, budget-bounded, per-source failures non-fatal)
  → Normalize (provider-native → NormalizedSource, at provider edge)
  → Triage/Rank (RankingHook, replaceable)
  → Deep-fetch shortlist (Stage 2, budget-bounded)
  → Synthesize (model gateway; origin-tagged output)
  → Validate (origin rules, ≥1 sourced claim)
  → Freeze (immutable result + evidence rows; status complete)
```

The engine owns orchestration, budgets, ranking-hook invocation, synthesis
prompts, validation, and freezing. It owns no HTTP scraping, no per-source
parsing, no platform policy. Provider failures degrade to partial results
(valid output), never fail the job unless zero sources survive. Model access
goes exclusively through the existing gateway (`server/ai/config.ts` client +
`MODELS` registry + `aiCall`/`logAiUsage`); the engine adds no second client.

### 3. Directed vs autonomous initiation model

- DirectedInitiation: `{query/topic, depth (scan|standard|deep),
  source_hints[] (optional provider preferences, not requirements),
  budget_caps}`. Depth controls Stage-2 fetch count and synthesis effort, not
  output shape.
- AutonomousInitiation: `{domain_config (topics, NOT hardcoded niches),
  time_window, budget_caps, ranking_context}`. The domain config is the
  vertical-as-configuration: today's hardcoded HN/GitHub/ArXiv queries,
  16-subreddit list, and `NICHE_TECH_TERMS` all dissolve into config entries.
- HumanInputInitiation: `{author_statement}` → a job whose sole evidence item
  is kind `author_statement` (see §8). Preserves the war-story path with no
  special-case downstream logic.
- All three produce the identical canonical output (§7); downstream (Story)
  never branches on initiation kind except reading provenance.

### 4. SourceProvider contract

```ts
Provider = {
  id: string;                       // e.g. "hn", "rss", "youtube" — registry key, not enum
  capabilities: ("discover" | "search" | "fetch")[];
  discover(ctx):   Promise<NormalizedSource[]>;  // browse/seed without query
  search(ctx, q):  Promise<NormalizedSource[]>;  // directed query (optional)
  fetch(ref):      Promise<NormalizedSource>;    // Stage-2 deep-fetch by ref
}
NormalizedSource = {
  provider, kind, canonical_url, title, excerpt_or_body,
  published_at | null, retrieved_at,
  retrieval_metadata: { query_used | null, provider_version },
  metadata: {}  // provider-specific extras (scores, counts); engine treats as opaque
}
```

Rules: engine never parses provider-native shapes (no ArXiv XML regex in the
engine); provider owns everything up through normalized text. Identity for
dedupe starts at `canonical_url` (+ content hash where available), replacing
the current title-prefix-60 in-memory scheme. The provider list is a runtime
registry — adding YouTube/X/papers/full-web means registering a provider, with
zero changes to ResearchJob or the engine. X ingestion stays read-only
(curated accounts/RSS-shaped access); the no-scraping constraint from
`xDeveloperRisk` extends to every provider (official APIs/feeds only). No new
providers are built in this phase; the contract is the deliverable.

### 5. Evidence / provenance model (extends ticket 03)

- Evidence item: `{id, job_id, source_ref, kind
  (excerpt|author_statement), excerpt, excerpt_hash, retrieved_at}`.
  Identity = `(job_id, source_ref, excerpt_hash)` — content-addressed, so two
  jobs quoting the same passage do not collide and re-quoting within a job
  dedupes naturally.
- Source record per source used: `{source_ref, provider, canonical_url,
  retrieved_at, retrieval_metadata}` — provenance is per source, not per job.
- Conflict is a first-class relation, never a merge:
  `{claim_a, claim_b, nature: contradicts | differs | updates, note}`.
  Both claims survive; synthesis may note the disagreement but must not
  silently pick a winner.
- Completed-job evidence rows are immutable (ticket 03); corrections arrive as
  new jobs with `parent_job_id`.

### 6. Facts vs interpretation boundary (hard requirement)

Every unit of research output carries `origin: sourced | generated`, enforced
at validation:
- `sourced` MUST cite ≥1 `evidence_id`. No citation, no sourced status.
- `generated` MUST cite zero evidence directly; it may reference `sourced`
  claim IDs as its basis (synthesis, implications, angles, hypotheses all live
  here by construction).
- A ResearchJob containing zero sourced claims is invalid output and fails
  validation — with the single uniform exception handler: `human_input` jobs
  satisfy this via the `author_statement` evidence item, so the rule has no
  carve-outs.
- This directly retires the current failure mode where one AI JSON blob mixes
  facts, angles, hooks, and scores with no provenance tags.

### 7. Canonical ResearchJob output

Required core (validation rejects without): `job metadata
(kind, initiation params, timestamps, model, cost)`, `sources[]`,
`evidence[] (≥1)`, `claims[] (≥1 sourced, origin-tagged)`, per-source
provenance + `retrieved_at`. Optional sections, present only when warranted
(downstream MUST tolerate absence): `entities, topics, events, conflicts[],
confidence rollup, synthesis, implications, content_angles[],
novelty_significance, relevance, opportunities[]`. No filler sections: an
absent section means "not established", never "N/A".

### 8. Reuse invariant (locked, restated for this ticket)

ONE ResearchJob → ONE frozen result → ONE Story → N Opportunities → N
GenerationJobs → N Artifacts. Format change NEVER re-runs research: it creates
a new Opportunity on the same Story. The frozen result blob + immutable
evidence rows are what make this safe — downstream reads pinned content, not a
live pipeline. `human_input` jobs obey the same invariant via
`author_statement` evidence.

Confidence (locked Round 2): per-claim three-level —
`verified` (multiple independent or primary sources) /
`indicated` (single credible source) /
`speculative` (thin or conflicting basis) — each with a one-line basis note.
Job-level confidence is derived (weakest load-bearing claim), never set
directly. Numeric scores stay inside the RankingHook (fog), not on claims.

### 9. Deliberately foggy (NOT decided here)

Ranking signals, weights, novelty thresholds, dedupe policy beyond
canonical-URL default, budget numbers, Result metric detail, cost-accounting
depth, non-X format policies, approval UX. The locked seam carrying all of
that later: domain/topic config + per-job budget caps + `RankingHook
(score(items, context) → ranked)` interface + replaceable dedupe policy. First
hook implementation generalizes today's viral-score + ×1.5 breaking boost with
the DevOps/X constants moved into config.

### 10. Implications for existing code (direction; verdicts in ticket 08)

- `discoverRefresh.ts`: each inline source block (HN, Reddit, RSS chunk,
  GitHub, ArXiv, Trends) becomes a provider behind §4; the orchestration
  becomes engine code; the "exactly 20 ideas" AI call becomes the first
  RankingHook implementation. Hardcoded queries/fallback ideas retire into
  config or deletion.
- `marketPulse.ts`: niche-term filter + boost logic become domain config +
  hook context; the `xAlgorithmContext` prompt injection becomes a
  channel-specific ranking-context input, not engine core.
- `discovered_ideas` / `ideas`: pre-story signals feeding Opportunity
  proposal (per ticket 03 §5) — the 20-idea bulk insert is triage output, not
  research output.
- `discovery_settings` dead fields (`enabledSources`, `minViralScore`,
  `customKeywords`) and write-only `monitored_accounts` are wired as engine/
  provider config or dropped (ticket 08 decides per item).
- `viral_scores` (per-content) vs idea-level `viralScore`: the former belongs
  to GenerationJob/Artifact evaluation, the latter to the RankingHook —
  currently conflated by name; the model separates them.
- `server/ai/config.ts` gateway: KEPT as the sole model access path; engine
  adds prompts and validation, not clients.
