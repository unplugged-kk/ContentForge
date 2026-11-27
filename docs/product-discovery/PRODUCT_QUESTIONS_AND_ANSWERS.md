# ContentForge — Product Questions & Answers (Q1–Q27)

**Date:** 2026-11-27  
**Participants:** Wayfinder (Strategy & Challenger) + Poteto mode (Engineering & Execution)  
**Baseline:** `origin/main` @ `0dca955`  

Every answer cites direct source files, distinguishes verified facts from unknowns, and records both agents' independent assessments.

---

## Product Identity (Q1–Q6)

### Q1. What problem is ContentForge solving?
- **Wayfinder:** Technical practitioners either spend 2–4 hours researching, fact-checking, and writing original posts, or paste links into ChatGPT/Claude and spend just as long stripping out generic slop, unverified claims, and bad platform formatting.
- **Poteto mode:** The codebase already implements a channel-agnostic evidence → Story → Opportunity → immutable Artifact → approval → publication state machine (`server/research/`, `server/story/`, `server/content/`), while legacy `server/routes.ts` and `docs/spec_contentforge_reimagined.md` reflect an older X-monetization tool.
- **Evidence:** `server/research/engine.ts`, `server/story/service.ts`, `server/content/artifact.ts`, `docs/spec_contentforge_reimagined.md`.
- **Final conclusion:** ContentForge solves **turning credible technical sources + the creator's own notes into verifiable, voice-authentic, platform-ready posts with minimal fact-checking burden and closed-loop learning**.
- **Confidence:** High (architecture & product alignment).
- **Remaining uncertainty:** Whether external buyers feel this pain acutely enough to pay vs. using Claude/ChatGPT + Notion manually.

### Q2. Who has the strongest reason to use it?
- **Wayfinder:** Reconciling the SRE founder spec (`docs/spec_contentforge_reimagined.md`) and ChatGPT's DevRel lead hypothesis (`REVIEW_ChatGPT.md` §5.2): **Technical Builder-Operators (DevTools/Infra Founders, Staff/Principal Engineers, and hands-on DevRel Leads)** who publish 1–5×/week where factual errors cost real credibility.
- **Poteto mode:** Technically, supporting both DevRel (changelog + external sources) and SRE/Founder (first-hand war stories) only requires a typed `StoryInput` union (`first_hand` | `researched` | `hybrid`) over the existing `stories` table — zero schema bloat.
- **Evidence:** `shared/schema.ts:825-839`, `REVIEW_ChatGPT.md` §5.2, `docs/spec_contentforge_reimagined.md:5-26`.
- **Final conclusion:** Target **hands-on technical creators / DevRel leads / infra builders** as the testable ICP hypothesis, benchmarked first on the founder's own workflow and then 3–5 design partners.
- **Confidence:** Medium (strong hypothesis, **not** market-validated).
- **Remaining uncertainty:** Willingness to pay, preferred primary workflow (changelog-led vs. war-story-led), and procurement constraints.

### Q3. What makes it meaningfully different from generic AI writing tools?
- **Wayfinder:** Four concrete differentiators — **none of which are fully wired yet**: (1) cross-source synthesis with explicit conflicts, (2) inline claim-to-evidence tracing blocking hallucinated numbers/citations, (3) strict separation of external evidence vs. the creator's real notes + approved human-edit voice exemplars, and (4) immutable revisions + human approval + safe export/publishing + performance memory.
- **Poteto mode:** Today, the differentiation is mostly **structural potential** (`research_evidence`, immutable `artifacts` trigger, `performance_signals` missingness), not user-visible reality, because `draftSynthesis` prints URLs and `ArtifactReviewView` shows zero evidence or claim warnings.
- **Evidence:** `server/research/intelligence.ts:538-560`, `server/content/generation.ts:368-377`, `client/src/components/create/artifact-review-view.tsx:473-510`.
- **Final conclusion:** Differentiation exists in the domain model, **not yet in the user experience**. Shipping synthesis, claim tracing, creator-note grounding, and edit-exemplar memory is what creates real distance from raw ChatGPT/Claude.
- **Confidence:** High.
- **Remaining uncertainty:** Whether users perceive measurable time savings and lower edit burden once shipped.

### Q4. What is the smallest valuable product experience?
- **Wayfinder:** One 12-step vertical slice: Topic/URL + creator notes → multi-source research → structured brief (facts, conflicts, angles) → Story/Opportunity → voice-matched X post/thread → claim & quality audit → side-by-side edit & human approval → Copy/Export (or optional approved publish) → log URL/metrics → weekly cohort learning note.
- **Poteto mode:** Achievable entirely on canonical tables (`research_*`, `stories`, `opportunities`, `artifacts`, `publications`, `results`, `performance_signals`) with zero new tables or DB migrations before D8 is fixed.
- **Evidence:** `server/research/verticalSlice.dbtest.ts`, `server/content/visualPublication.dbtest.ts`, `client/src/pages/{sources,create}.tsx`.
- **Final conclusion:** **One source-backed, claim-audited, voice-matched post/thread per session, export-ready with zero channel credentials required.**
- **Confidence:** High.
- **Remaining uncertainty:** Exact time-to-publish vs. the founder's 5-minute daily target.

### Q5. Which existing features support that experience?
- **Wayfinder:** Canonical research providers (`rss`, `hn`, `web`, `reddit`, `youtube`, `video`), `Stories`, `Opportunities`, frozen `GenerationPolicy`, immutable `Artifact` revisions, `ArtifactReviewView`, `formatProfiles`, `performance_signals` missingness, and `POST /api/learning/publications/:id/observations`.
- **Poteto mode:** Plus `server/security/ssrf.ts`, `authGate.ts`, `csrf.ts`, `rateLimit.ts`, `server/content/publication.ts` leases/reconcile, and `server/testing/hermeticEnv.ts`.
- **Evidence:** `CURRENT_ARCHITECTURE.md:45-65`, `server/content/learning/routes.ts:136-165`.
- **Final conclusion:** Reuse ~80% of the canonical backend; fix the 5 broken UI seams and fill the 4 genuine product gaps (synthesis, claim tracing, export, learning exemplars/digest).
- **Confidence:** High.
- **Remaining uncertainty:** None on code existence; runtime E2E verification pending.

### Q6. Which features are distractions?
- **Wayfinder:** 8 legacy `/create` modes (`Hooks`, `Carousel`, `Images`, `Articles`, `Templates`, `Formatter`, `Canned Responses`, `Chat → Post`), YouTube legacy page, `/agent` 29-tool chat shell, MCP server, 10 Jev flags, Experiments/Autonomy UI (`learning-view.tsx`), Agent Reach stub, Video Factory, multi-brand/multi-tenant billing, and Postiz-style marketing clone work.
- **Poteto mode:** Agree on freezing all of those off, with one hard engineering constraint: do **not** delete mounted routes or DOM elements asserted by `e2e/canonical-ia.e2e.spec.ts` and `e2e/routes.e2e.spec.ts` without lockstep Playwright spec updates.
- **Evidence:** `client/src/pages/create.tsx:33-44`, `e2e/canonical-ia.e2e.spec.ts:15-64`, `e2e/routes.e2e.spec.ts:16-35`, `JEV_DECISION_MAP.md:19-34`.
- **Final conclusion:** Freeze all distractions at zero engineering investment; de-emphasize secondary UI behind collapsible sections with lockstep E2E updates after the core spine works.
- **Confidence:** High.
- **Remaining uncertainty:** None.

---

## Research Intelligence (Q7–Q12)

### Q7. Can ContentForge reliably discover what is worth talking about?
- **Wayfinder:** Partially. Manual topic/URL research across `rss`, `hn`, `web`, `reddit`, `youtube`, and `video` works in backend code, but there is no working proactive Opportunity Radar UI, and `DiscoverTab` hardcodes `availableProviders.slice(0, 4)` even for direct URLs (`discover-tab.tsx:162-164`).
- **Poteto mode:** Provider fan-out, dedupe, window filtering, and descriptive scoring (`research-analysis-v1`) are implemented in `server/research/engine.ts` and `intelligence.ts`, but live external provider reliability varies by upstream rate limits and isn't verified in CI (hermetic fixtures only).
- **Evidence:** `server/research/engine.ts:246-418`, `client/src/components/sources/discover-tab.tsx:157-182`.
- **Final conclusion:** **Directed discovery (topic/URL → multi-source research) is solid once the URL provider routing and UI history bugs are fixed.** Autonomous proactive discovery ("radar") is incomplete and deferred until after M2.
- **Confidence:** High.
- **Remaining uncertainty:** Live upstream reliability of Reddit/YouTube/web scraping across diverse technical URLs.

### Q8. Can it explain why a topic matters?
- **Wayfinder:** **No.** `draftSynthesis` (`server/research/intelligence.ts:538-560`) emits bare URLs and a 1-line boilerplate string. `DiscoverTab` does not even render `analysis.synthesis` or `clusters`.
- **Poteto mode:** Confirmed. Neither deterministic synthesis nor any LLM brief step currently explains significance or implications.
- **Evidence:** `server/research/intelligence.ts:538-560`, `server/content/automation.ts:947-966`.
- **Final conclusion:** **Missing today.** Must be built in Wave 3 (`server/story/synthesis.ts` + improved deterministic `draftSynthesis` + UI brief card).
- **Confidence:** High.
- **Remaining uncertainty:** Quality of synthesized "why it matters" briefs across diverse technical changelogs until benchmarked on real inputs.

### Q9. Can it distinguish facts, interpretations, and speculation?
- **Wayfinder:** **In the data model yes (`origin`, `interpretationMarked`), in actual output NO.** Every extracted clip is just `kind: "excerpt"` (`engine-core.ts:176-206`), and `draftSynthesis` puts URLs in `facts` and boilerplate in `interpretation`.
- **Poteto mode:** Confirmed. Structured separation of `verifiedFacts` (with `evidenceIds`), `sourceOpinions`, `inference`, and `openQuestions` must be built at the Story synthesis boundary with strict `evidenceId` validation.
- **Evidence:** `server/research/engine-core.ts:133-206`, `server/research/intelligence.ts:538-560`, `server/story/service.ts:28-39`.
- **Final conclusion:** **Partially modeled, not delivered.** Wave 3 synthesis + `claim_evidence_v1` closes this gap.
- **Confidence:** High.
- **Remaining uncertainty:** Precision of automated fact-vs-opinion classification on ambiguous blog posts (human review remains mandatory).

### Q10. Can it identify missing perspectives?
- **Wayfinder:** **No.** `detectConflicts` (`intelligence.ts:348-388`) only checks simple polarity/date regexes on overlapping titles, and UI conflict rendering is broken due to a schema mismatch (`sourceUrlA` vs `claims[].canonicalUrl`). There is no open-questions or missing-perspective extractor.
- **Poteto mode:** Confirmed. `noveltyAgainst` checks overlap with prior jobs, not missing perspectives. Adding `openQuestions` to `structuredStoryBriefSchema` + fixing the UI conflict schema mismatch delivers the first real version.
- **Evidence:** `server/research/intelligence.ts:348-418`, `discover-tab.tsx:474,522`, `source-detail-modal.tsx:136`.
- **Final conclusion:** **Missing today.** Fix conflict rendering in Wave 2 and add explicit `openQuestions` / coverage-gap detection in Wave 3.
- **Confidence:** High.
- **Remaining uncertainty:** Depth of perspective-gap detection in deterministic fallback mode (stronger with LLM synthesis).

### Q11. Can it combine multiple sources into useful insights?
- **Wayfinder:** **Not usefully yet.** Multi-source fetching and Jaccard clustering exist (`intelligence.ts`), but synthesis never merges converging/conflicting excerpts into an insight — and clicking "Create Content" from a source card severs `researchJobId` entirely (`discover-tab.tsx:493-495`).
- **Poteto mode:** Confirmed. Multi-source storage (`research_sources`, `research_evidence`) is ready; only the synthesis layer and UI handoff are missing/broken.
- **Evidence:** `server/research/intelligence.ts:290-346,538-560`, `client/src/components/sources/discover-tab.tsx:493-495`.
- **Final conclusion:** **Infrastructure exists; synthesis output does not.** High-leverage Wave 2 + Wave 3 deliverable.
- **Confidence:** High.
- **Remaining uncertainty:** None on code state.

### Q12. Can it connect those insights to the creator's actual expertise?
- **Wayfinder:** **Weakly.** `buildExpertiseProfile` (`server/intelligence/expertise/profile.ts`) is a keyword bag feeding a disabled Jev decision. `CreateStudio` has no dedicated "My notes / war story / proof points" field alongside research evidence.
- **Poteto mode:** `assembleContext` (`server/content/context.ts:232-342`) already injects `user_profile` + up to 5 favorite `context_vault` items + style profiles, and `engine.ts:394-396` accepts `authorStatement`, but `CreateStudio` and `DiscoverTab` don't wire creator notes cleanly into `StoryInput`.
- **Evidence:** `server/content/context.ts:232-342`, `server/intelligence/expertise/profile.ts:103-136`, `server/research/engine.ts:394-396`.
- **Final conclusion:** **Partially implemented.** Wave 3 adds co-primary `StoryInput` (`first_hand` | `researched` | `hybrid`) with explicit `observation` + `proofPoints` kept strictly distinct from external `research_evidence`.
- **Confidence:** High.
- **Remaining uncertainty:** How consistently real users populate `proofPoints` vs. wanting voice-only polish.

---

## Content Quality (Q13–Q17)

### Q13. Can it create content that is original rather than merely paraphrased?
- **Wayfinder:** **Not reliably verified.** Without creator proof points or synthesis angles, prompting an LLM with 8 raw 400-char excerpts (`policy.ts:421-424`) encourages paraphrase. No near-duplicate / similarity check against source excerpts or past posts exists.
- **Poteto mode:** Confirmed. Adding a deterministic n-gram / Jaccard overlap check against source excerpts and recent owner artifacts inside quality signals is cheap, offline, and testable.
- **Evidence:** `server/content/policy.ts:388-463`, `server/intelligence/quality/signals.ts:155-218`.
- **Final conclusion:** **Unproven and unguarded today.** Add source-paraphrase similarity warning + require creator `observation`/`proofPoints` or explicit angle synthesis.
- **Confidence:** High.
- **Remaining uncertainty:** Subjective editorial originality must be scored on a 5-topic founder benchmark.

### Q14. Can it sound natural without fabricating personal experience?
- **Wayfinder:** **Not guaranteed.** `policy.ts` does not explicitly forbid inventing first-person anecdotes, outages, or metrics absent from `proofPoints`/`evidence`.
- **Poteto mode:** Adding explicit prompt grounding rules ("never invent metrics, benchmarks, or first-person experiences outside `proofPoints` and `evidence`") + deterministic first-person/metric grounding checks + injecting 2–3 real approved human-edited exemplars directly addresses both naturalness and anti-fabrication.
- **Evidence:** `server/content/policy.ts:408-438`, `server/intelligence/quality/signals.ts`.
- **Final conclusion:** **Partially implemented (prompt only, no anti-fabrication check).** Strengthen prompt rules, add deterministic unsupported-claim/anecdote flags, and use real human-edited exemplars in Wave 3.
- **Confidence:** High.
- **Remaining uncertainty:** Edge cases where subtle fabricated experience evades heuristic checks (human review remains mandatory).

### Q15. Can every important factual claim be traced to evidence?
- **Wayfinder:** **No.** `generation.ts:368-377` attaches all job `evidenceIds` as a flat array; `model.ts` outputs raw text; `ArtifactReviewView` renders zero evidence excerpts or citations.
- **Poteto mode:** Structurally solvable with zero DB migrations via `claim_evidence_v1` in `artifacts.attribution` JSONB + boundary validation that strips fabricated `evidenceIds` + UI evidence audit panel.
- **Evidence:** `server/content/generation.ts:368-377`, `server/content/model.ts:23-27`, `client/src/components/create/artifact-review-view.tsx`.
- **Final conclusion:** **Missing today; clear zero-migration design agreed for Wave 3.**
- **Confidence:** High.
- **Remaining uncertainty:** Recall of claim extraction across informal thread prose (requires golden-set tests).

### Q16. Can it identify weak, unsupported, or contradictory claims?
- **Wayfinder:** **No.** `quality/signals.ts` checks clichés, hedging, and length — not factual support or contradictions — and `JEV_CONTENT_GATE` is off.
- **Poteto mode:** Deterministic numeric/date/quote grounding against supplied `evidence` + `proofPoints`, combined with `claim_evidence_v1` `unsupportedCount` and surfaced conflicts, gives an honest, offline-testable warning layer surfaced directly in `ArtifactReviewView` (even with Jev OFF).
- **Evidence:** `server/intelligence/quality/signals.ts:155-218`, `server/content/qualityGate.ts:110-113`.
- **Final conclusion:** **Missing today.** Build deterministic claim-grounding + quality warning panel directly on review (decoupled from disabled Jev flags).
- **Confidence:** High.
- **Remaining uncertainty:** Semantic contradictions beyond regex/number checks require human inspection or model-assisted advisory critique.

### Q17. Can it adapt content to X and Threads without losing the underlying idea?
- **Wayfinder:** **Backend yes (`repurposing.ts` + `formatProfiles.ts`), UI & X-fitting NO.** `origin/main` still suffers mid-word `slice(0, 280)` cuts, `ArtifactReviewView` corrupts `x_thread` edits, and the UI doesn't expose multi-format repurposing from one Story without re-research.
- **Poteto mode:** Porting `unitFit.ts` (`75f4e99`) + `validateXText` (`e8c01f4`), fixing `x_thread` editing in `ArtifactReviewView`, and writing an integration test proving X + Threads artifacts derive from one `ResearchJob`/`Story` without re-researching closes this cleanly.
- **Evidence:** `server/content/repurposing.ts:425-626`, `server/content/formatProfiles.ts`, `client/src/components/create/artifact-review-view.tsx:150-154`, `plans/wayfinder-contentforge/MAP.md:14-17`.
- **Final conclusion:** **Partially implemented.** Fix X length/word-safe fitting, fix `x_thread` UI editing, and verify multi-format reuse in automated tests.
- **Confidence:** High.
- **Remaining uncertainty:** Live Threads API formatting edge cases (fixture-tested only until owner authorizes live credentials).

---

## Growth & Learning (Q18–Q22)

### Q18. Can it identify relevant creators and conversations in the chosen niche?
- **Wayfinder:** **No.** Competitor monitoring / influencer tracking / audience question mining are unbuilt (`CAPABILITY_MATRIX.md:38`), and `agent-reach` is inert.
- **Poteto mode:** Confirmed. Legacy `discovered_ideas` / RSS / HN / Reddit fetch discussions, not a creator graph or real-time X reply stream.
- **Evidence:** `docs/CAPABILITY_MATRIX.md:37-38`, `server/research/routes.ts:259-265`.
- **Final conclusion:** **Missing (and deliberately deferred past M2).** Do not build X scraping or reply-bot features (account ban & ToS risk).
- **Confidence:** High.
- **Remaining uncertainty:** Whether pilot users even need creator tracking once research-to-draft works.

### Q19. Can it analyse what performs well and what does not?
- **Wayfinder:** **Only by `(channel, format)`, not by topic, pillar, or hook.**
- **Poteto mode:** `performance_signals` and `computeAnalyticsSummary` (`summary.ts:37-175`) accurately track observed vs. unavailable metrics, and `proposals.ts` computes channel/format deltas (min sample 3, Δ ≥ 15%), but topic/hook metadata is missing.
- **Evidence:** `server/content/learning/summary.ts:100-175`, `server/content/learning/proposals.ts:90-240`.
- **Final conclusion:** **Partially implemented.** Add `topicTag`/`hookType` metadata + manual publish logging + weekly cohort digest in Wave 3.
- **Confidence:** High.
- **Remaining uncertainty:** Metric availability for export-first users depends on lightweight manual metric entry (or read-only API where authorized).

### Q20. Can it distinguish correlation from causation?
- **Wayfinder:** **Not at pilot sample sizes — and it must never pretend to.** `experimentation/*` has deterministic hash assignment for A/B tests, which is meaningless at 1–5 posts/week.
- **Poteto mode:** Confirmed. `proposals.ts` requires N ≥ 3 per bucket (still too small for causal claims). Weekly digests must explicitly print `sampleSize`, `missingCount`, and cautious observational wording.
- **Evidence:** `server/content/learning/proposals.ts:42-48`, `server/content/experimentation/`.
- **Final conclusion:** **No causal inference at pilot scale.** Enforce explicit sample-size reporting and non-causal language in weekly insights.
- **Confidence:** High.
- **Remaining uncertainty:** Minimum cohort size needed before any automated recommendation beats operator intuition.

### Q21. Can it learn from actual post performance?
- **Wayfinder:** **Not meaningfully yet.** `learningSummaryForContext` (`summary.ts:178-201`) passes only raw counts (`approval=4; edit=2`) to generation.
- **Poteto mode:** Replacing count-only context with 2–3 real approved human-edited exemplars (prioritizing those with positive observed metrics) + weekly cohort digest makes Post #5 genuinely better than Post #1 with zero schema migrations.
- **Evidence:** `server/content/learning/summary.ts:178-201`, `server/content/context.ts:79-123`.
- **Final conclusion:** **Partially implemented (storage yes, actionable feedback loop no).** High-value Wave 3 upgrade.
- **Confidence:** High.
- **Remaining uncertainty:** Measurable lift in draft acceptance rate requires real multi-week operator usage.

### Q22. Can it recommend the next content opportunity based on evidence?
- **Wayfinder:** **Not reliably yet.** `opportunity_score` and `content_strategy` are flag-off Jev decisions, and `CreateStudio` never shows ranked opportunities.
- **Poteto mode:** Deterministic weekly digest can surface one evidence-backed low-risk experiment suggestion (e.g., which `hookType`/`topicTag` cohort had highest observed engagement with sample count), while keeping Jev flags off until golden sets exist.
- **Evidence:** `JEV_DECISION_MAP.md:22-23,31-34`, `client/src/components/create/create-studio.tsx:187-197`.
- **Final conclusion:** **Partially implemented (backend exists, unwired/uncalibrated).** Start with deterministic weekly digest recommendations; defer Jev opportunity auto-ranking to M3.
- **Confidence:** High.
- **Remaining uncertainty:** Calibration data from real usage.

---

## Product Readiness (Q23–Q27)

### Q23. Is the current system secure?
- **Wayfinder:** **Single-operator perimeter is strong; multi-user credential isolation is NOT safe.** Also xQuick proxy routing contradicts Settings UX and compliance docs.
- **Poteto mode:** Auth gate, CSRF, Helmet, rate limits, `requireOwnerId`, and core `ssrf.ts` are well-implemented. **Blockers to fix now:** (1) owner-strict fail-closed social credentials (remove silent env fallback for authenticated other owners), (2) legacy raw `fetch` SSRF/delimiter cleanup, (3) `ENCRYPTION_KEY` fail-closed check in production, (4) verify GitHub secret scanning on the public repo.
- **Evidence:** `server/middleware/{authGate,csrf,rateLimit,security,userContext}.ts`, `server/social/{x,threads,instagram,linkedin,youtube}.ts`, `server/security/ssrf.ts`, `server/routes.ts:1044,1075,1482,1505,2904,2973`.
- **Final conclusion:** **Safe for isolated single-operator local/export use; UNSAFE for shared multi-user publishing until credential fallbacks are closed.**
- **Confidence:** High.
- **Remaining uncertainty:** Remote GitHub commit-history secret scan via `gitleaks`/GitHub Secret Scanning (owner-side check).

### Q24. Is the core workflow dependable?
- **Wayfinder:** **No — not today.** Five concrete UI bugs break Research reload, conflict visibility, Source→Create provenance, `x_thread` editing, and approved export.
- **Poteto mode:** Plus `npm run test:unit` fails without `DATABASE_URL`, CI does not run `test:unit` or `test:db`, `migration-guard.yml` misses untracked SQL files, and `run60` safety fixes (`7e4a6f8`, `e8c01f4`, `5627fd9`–`5cf7af6`, `75f4e99`) are not on `main`.
- **Evidence:** Fresh `npm run test:unit` run 2026-11-27, `.github/workflows/{e2e,migration-guard}.yml`, UI files cited in `PRODUCT_CURRENT_STATE.md`.
- **Final conclusion:** **Not yet dependable.** Wave 1 (P0 gates + safety fixes) and Wave 2 (5 UI bugs + Export) make the core workflow dependable.
- **Confidence:** High.
- **Remaining uncertainty:** Full Playwright + live Postgres DB suite pass rate on this machine (blocked by Docker socket in sandbox; verify in CI + isolated DB).

### Q25. Can an individual creator use it without engineering assistance?
- **Wayfinder:** **No.** Confusing 9-mode `/create` bar, broken Settings X/LinkedIn instructions, no Export button, no guided onboarding/demo dataset, and no visible evidence/synthesis brief.
- **Poteto mode:** Confirmed. Even an engineer hits silent provenance loss and broken thread editing today.
- **Evidence:** `client/src/pages/{create,sources,settings}.tsx`, `client/src/components/create/artifact-review-view.tsx`.
- **Final conclusion:** **Not yet.** Requires Wave 2 UI fixes + Export + honest Settings + concise onboarding/demo runbook.
- **Confidence:** High.
- **Remaining uncertainty:** Real usability testing with a non-author user.

### Q26. What is missing before a controlled pilot?
- **Wayfinder:** (1) P0 CI gates + safety fixes, (2) 5 UI vertical-slice fixes + Copy/Export, (3) real research synthesis + claim-to-evidence warnings + creator notes input, (4) owner-strict credential isolation + `trusted` auto-approval lock, (5) truthful marketing copy, (6) manual publish log + weekly digest + edit exemplars, (7) backup/restore & onboarding runbook.
- **Poteto mode:** Confirmed — and Waves 1–3 can ship **all core value with zero risky schema migrations**, followed by Wave 4 D8 snapshot repair + UI de-emphasis.
- **Evidence:** `PRODUCT_CURRENT_STATE.md`, `PRODUCTIZATION_GOAL.md` §5–§10.
- **Final conclusion:** Concrete, bounded 4-wave engineering plan defined in `EXECUTION_ROADMAP.md`.
- **Confidence:** High.
- **Remaining uncertainty:** Whether pilot users require live OAuth publishing immediately or accept export-first.

### Q27. What must be validated with real users before commercial claims are made?
- **Wayfinder:** (1) Draft acceptance/edit rate vs. writing from scratch or raw Claude/ChatGPT, (2) actual hands-on time per post (testing the 5-min/10-min goal), (3) repeat weekly usage over ≥4 weeks, (4) willingness to pay & renewal, (5) whether export-first suffices or direct OAuth publishing is a dealbreaker.
- **Poteto mode:** Confirmed. No automated test, build, or agent run can prove product-market fit, retention, or revenue.
- **Evidence:** `REVIEW_ChatGPT.md` §14, `PRODUCTIZATION_GOAL.md` §11.
- **Final conclusion:** Technical completion = **pilot-ready** (M2), **never** commercially validated (M3). Deliver a founder validation scorecard & measurement template rather than fabricating commercial proof.
- **Confidence:** High.
- **Remaining uncertainty:** Everything commercial — awaiting real human users.
