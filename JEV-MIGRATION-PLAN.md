# JEV Migration Plan — phases (no implementation in this audit)

## Phase 0 — Instrumentation (1-2 days)
- Add `jev_decisions`-style logging (decision, confidence, latency, fallback, outcome) next to `ai_usage_log`; log current heuristic scores (`computeEngagementScore` breakdown, `rankIdeas` order, viral scores) with enough context to build golden sets.
- Files likely: `server/ai/chat.ts`, `server/storage.ts`, `shared/schema.ts` (new table), `server/autopilot.ts` (log-only), `server/routes.ts` viral endpoint (log-only).
- Benefit: baseline metrics. Risk: negligible (log-only). Tests: schema/log tests. Rollback: drop table. Success: p50/p95 latency + token counts per decision point captured for 1 week.

## Phase 1 — Lowest-risk candidate: JC-01 viral scoring (3-5 days)
- Shadow-run Jev 8-dim scores beside `POST /api/viral/score`; compare agreement; cut over advisory UI first, autopilot consumption second.
- Files: `server/routes.ts:2268-2328`, new `server/decision/*` facade, `client` score display (read-only).
- Benefit: sub-second typed scores, cacheable. Risk: low (advisory). Tests: golden content pairs, agreement ≥ human-human baseline. Rollback: flag flip to LLM path. Success: p95 <1s, agreement within noise, zero publish-path changes.

## Phase 2 — Routing: JC-03 agent intent (1 week)
- Golden set of objectives → expected plans; shadow-run; cut over non-privileged routing; privileged grants unchanged.
- Files: `shared/agent-ui.ts:192-381`, `server/agent/*`, tests `agent.test.ts`, `workspace.test.ts`.
- Benefit: fewer mis-routed runs. Risk: med. Tests: routing accuracy + no-privilege-regression suite. Rollback: regex compiler flag. Success: routing accuracy beats regex on held-out set, run-failure rate down.

## Phase 3 — Scoring: JC-02 discover + JC-04/05 pipeline (1-2 weeks)
- Shared-state evaluations (SS-1/SS-2); A/B discover batches; keep LLM generation unchanged.
- Files: `server/discoverRefresh.ts`, `server/autopilot.ts`, `server/marketPulse.ts`.
- Benefit: fewer wasted drafts, explainable ranks. Risk: med. Tests: batch A/B, draft-yield metric. Rollback: prompt-path flag. Success: equal-or-better top-3 engagement with fewer drafts.

## Phase 4 — Gating: JC-06/07/08 memory admission (1 week)
- Noul admission questions on ingest/vault/youtube/style paths; human review band kept.
- Files: routes ingest/vault, `youtubeConnector.ts`, `content/styleAnalyzer.ts`.
- Benefit: cleaner memory. Risk: low-med. Tests: precision/recall on admission goldens. Rollback: accept-all flag. Success: junk admission down, no good-item loss.

## Phase 5 — Autonomous workflows: JC-09/10/11 (experimental, time-boxed)
- Shadow-only failure disposition + scheduler + brand-learning admission; no auto-execute changes without human sign-off.
- Files: `content/adapters.ts`, `visualProviders/openaiImage.ts`, schedule routes, `routes.ts:2590` ai-learn.
- Benefit: fewer retry storms. Risk: med-high. Tests: fault-injection suite. Rollback: regex/static fallbacks. Success: retry cost down with zero silent drops.

Explicit non-goals (never in plan): research intelligence ranking, experiment assignment/evaluation, autonomy eligibility, publish validators, budgets/circuits — Tier 4 stays deterministic.
