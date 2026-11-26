# ContentForge - AI pair-review brief

**Audience:** Claude / ChatGPT / any reviewing agent. **Owner:** Kishore (SRE / DevOps infra lead, solo operator).
**Branch:** `collab/ai-pair-review` (docs only, no code changes). Branch from `main @ 0dca955`.

## 1. Your job
Review the vision, what is built, and the gaps. Then propose a **concrete, ordered plan to make ContentForge a product** (not just a personal tool). Be critical: say what to cut, what is risky, what is missing.

Write suggestions to `docs/collab/REVIEW_<yourname>.md` and commit on this branch (or a sub-branch). Do not edit other docs without saying so. Do not widen the status vocabulary (IMPLEMENTED / PARTIALLY IMPLEMENTED / VERIFIED LIVE / NOT VERIFIED / DEFERRED / BLOCKED) - claim nothing you did not observe.

## 2. Original vision
Source: `docs/spec_contentforge_reimagined.md`.
- Personal social growth engine for one SRE, max 5 minutes/day, aimed at a second income stream via X Ads Revenue Sharing (5M impressions / 90 days + 500 followers).
- Features envisioned: targeted engagement hub (track influencers, fast AI comments), comment/discussion mining, War Story Composer (bullets to thread), daily morning briefing (3-post pack, approve in under 2 min), installable PWA, AI cost tracking with per-task model choice via OpenRouter.

## 3. Vision as it evolved (what the code is now)
Per `docs/HANDOVER.md` section 1: a **single-operator, AI-native content intelligence and growth system**, domain-agnostic (the vertical is configuration). Cycle:

`Discover > Research > Understand > Opportunities > Create > Repurpose > Approve > Distribute > Measure > Learn`

Design rules: truthful status vocabulary; intelligence != decision != execution (Jev makes typed, logged decisions, execution re-validates); approval is always a human gate. X and Threads are output channels, not the core.

## 4. What exists (summary, evidence in the linked docs)
- Research providers (RSS, Reddit, YouTube, HN, web, transcripts), engine with dedupe/evidence/ranking, triage decision.
- Opportunity creation; scoring and strategy exist but are flag-gated off by default (`JEV_*`).
- Jev decision layer (`JEV_DECISION_MAP.md`), content pipeline with gates, publishing to X/Threads, Auth0 login, public marketing site (in progress).
- Stack: React/Vite/Tailwind/shadcn, Express + TypeScript, Drizzle + Postgres, node-cron, OpenAI SDK via OpenRouter.
- Full row-by-row status: `docs/CAPABILITY_MATRIX.md`.

## 5. Known gaps (starting list, challenge it)
- Test suites do not run in CI (`docs/ROADMAP.md` P0-1); migration generation broken (P0-2).
- Measure and Learn stages of the lifecycle are the weakest (see HANDOVER section 3).
- Competitor monitoring / audience question mining: not built. Agent Reach live scraping ruled out for ban risk.
- X API compliance and cost risk: `docs/X_API_COMPLIANCE_AND_RISK.md`.
- Single-operator assumption: multi-tenancy, billing, onboarding not designed.
- Marketing site is mid-flight, ~47% of its visual target.
- No clean full Playwright run recorded.

## 6. Questions we want answered
1. Is the X-monetisation goal still the right wedge, or should the product target another buyer?
2. Who is the customer (creators, DevRel, SRE teams, agencies)? What is the one-sentence pitch?
3. What is the minimum path from today to a paying second user?
4. Which existing modules are over-built relative to that path; which missing ones block it?
5. Architecture risks for multi-tenant (Jev, flags, secrets, channel tokens).
6. Ordered roadmap: next 2 weeks, 2 months, 6 months.

## 7. Read order
1. This file  2. `docs/HANDOVER.md` (esp. section 9, next task)  3. `CURRENT_ARCHITECTURE.md`  4. `docs/CAPABILITY_MATRIX.md`  5. `docs/ROADMAP.md`  6. `JEV_DECISION_MAP.md`  7. `docs/spec_contentforge_reimagined.md`  8. `docs/README.md` marks which docs are HISTORICAL - do not trust those.

## 8. Working agreement
Reviewers do not run the live X provider or billable models. Tests: `npm run test:unit`, `npm run test:db` (never raw `node --test`). Use full repo-relative paths (many duplicate filenames).
