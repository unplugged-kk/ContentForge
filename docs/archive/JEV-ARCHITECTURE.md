# JEV Architecture — proposed integration (design only, not implemented)

## DecisionEngine facade

```text
Application service (autopilot, discover, agent, ingest)
  → DecisionEngine.choose/score/classify/gate/route(state, questions, thresholds)
  → Jev (typed decision + confidence)
  → Application executes deterministically (existing tools/adapters/validators)
```

```ts
// Proposed interface (illustrative — do not implement yet)
interface DecisionEngine {
  choose<T extends string>(state: unknown, q: { question: string; choices: T[]; threshold?: number }): Promise<{ choice: T; confidence: number }>;
  score(state: unknown, q: { question: string; range?: [number, number] }): Promise<{ value: number; confidence: number }>;
  gate(state: unknown, q: { question: string; threshold: number }): Promise<{ pass: boolean; confidence: number }>;
  route(state: unknown, q: { question: string; routes: string[] }): Promise<{ route: string; confidence: number }>;
  evaluate(state: unknown, questions: BoundedQuestion[]): Promise<TypedDecision[]>; // shared-state batch
}
```

## Request/response flow
1. Service assembles minimal state (idea title/desc/angles/pillar/timeliness — never secrets/tokens).
2. Engine validates schema, checks cache (`hash(state+question)`), calls Jev.
3. On confidence ≥ threshold → typed decision; below → deterministic fallback (existing heuristic); on Jev outage → fallback + `fallback:true` telemetry.
4. Decision + confidence + fallback flag logged alongside existing `ai_usage_log` pattern (extend with `decision`, `confidence`, `fallback` columns or a `jev_decisions` table mirroring `autonomy_decisions`).
5. Deterministic safety gates AFTER Jev for anything with side effects (privileged-tool grants, artifact approval, publish eligibility, autonomy controller untouched).

## Tier 1 example schemas

### JC-01 viral scoring (SS-1 content state)
STATE: `{ content, platform, pillar, author_context }`. Questions: 8× score (hook/value/emotion/share/unique/readability/cta/timeliness, 1-10) + Noul (publish-worthy?). Threshold ~0.7 for auto-surface; below → human review queue. Side effects: none (advisory).

### JC-02 discover triage (SS-2 idea state)
STATE per raw item: `{ title, summary, source_type, points, comments }` + batch context (pillars, breaking topics). Questions: score relevance 0-1, score novelty 0-1, choice pillar, choice content-type, Noul promote-to-top-20? Threshold high for auto-promote; middle band → human discover review.

### JC-03 agent routing
STATE: `{ objective_text, available_tools[30], story_id?, history }`. Question: choice of plan (tool sequence) + targets + window preset. Threshold high; low confidence → ask clarifying question instead of running tools. Privileged tools still require explicit grants after routing.

## Cross-cutting
- **Confidence:** per-question thresholds; low → fallback or human queue, never silent auto-execute.
- **Fallbacks:** JC-01→last score/hide; JC-02→current prompt path; JC-03→current regex compiler; JC-09→regex classifier; all fallbacks logged.
- **Telemetry:** decision, confidence, latency, cost, fallback flag, downstream outcome (engagement, publish success) for calibration.
- **Caching:** scoring decisions cached by content hash; routing cached per (objective hash); discover per (batch, item).
- **Testing:** golden sets per candidate (viral pairs, discover batches with human ranks, intent utterances → expected plans, failure messages → expected disposition); shadow-run Jev beside current path before cutover; A/B on drafts/day and engagement.
- **Human approval:** publish, privileged tools, brand-memory writes, and policy activation keep existing human/deterministic gates; Jev is advisory there.
- **Security:** Jev state is untrusted-data-safe (titles/URLs treated as data, mirroring `retrievedContentIsData` and style-analyzer DATA-only prompt); no credentials, no session data, no raw user tables.
- **Failure handling:** Jev unavailable → deterministic safe behavior (no auto-publish, no auto-retry escalation, queue for human); ambiguous → middle-band human review, never random choice.
