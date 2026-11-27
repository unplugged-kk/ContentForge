# ContentForge — Agreed Product Strategy

**Date:** 2026-11-27  
**Status:** **AGREED** between Wayfinder (Strategy & Challenger) and Poteto mode (Engineering & Execution)  
**Milestone:** M1 — Product Clarity

---

## 1. Strategic Thesis

ContentForge already has a deep, domain-agnostic backend (`ResearchJob → Story → Opportunity → GenerationPolicy → Immutable Artifact → Approval → Schedule → Publication → Result → PerformanceSignals`). Its bottleneck is **not missing features, agents, or channels** — it is the gap between raw backend primitives and one dependable, high-trust editorial experience that demonstrably beats pasting URLs into ChatGPT or Claude.

**We will prove one complete, evidence-backed vertical slice before expanding surface area.**

---

## 2. Primary User & Primary Problem

- **Primary User (Initial Testable Hypothesis — not proven market):** Hands-on technical creators, DevTools/Infra founders, Principal/Staff SREs, and technical DevRel leads who publish 1–5×/week on X (and optionally Threads/LinkedIn) where **factual accuracy and authentic voice carry high reputational stakes**.
- **Primary Problem:** Writing technical posts from changelogs, incidents, and industry discussions either consumes 2–4 hours manually, or devolves into generic, hallucination-prone AI slop when pasted into general chat tools — with zero provenance, broken thread formatting, and zero memory of what worked.

---

## 3. One-Sentence Product Promise

> **Turn credible technical sources and your own first-hand notes into an original, claim-checked X post or thread in your real voice — ready to inspect against its evidence, approve, export or publish safely, and learn from every week.**

---

## 4. Real Differentiation (Why Not Just ChatGPT/Claude?)

1. **Cross-Source Research Brief with Conflicts & Unknowns:** Combines multiple permitted public sources (`hn`, `rss`, `web`, `reddit`, `youtube`, `video`), explicitly separating verified evidence excerpts, source conflicts, and unanswered questions.
2. **Co-Primary Creator Notes Without Fabrication:** Treats the creator's first-hand observations and proof points (`first_hand` | `researched` | `hybrid`) as explicit inputs distinct from external evidence — forbidding invented anecdotes or metrics.
3. **Inline Claim-to-Evidence Audit Before Approval:** Maps draft claims to real `evidenceIds` (stored in `artifacts.attribution`), flags unsupported factual claims/numbers/boilerplate, and enforces word-safe platform geometry (`unitFit` + `validateXText`).
4. **Immutable Revisions, Mandatory Human Approval & Safe Delivery:** Every edit creates a tracked revision; pilot mode locks out unattended `trusted` auto-approval; **Export-First** (Copy Text / Copy Thread / Export Markdown + Citations) works with zero social credentials, while optional channel publishing is owner-isolated and duplicate-safe.
5. **Compounding Editorial Memory:** Injects 2–3 real approved human-edited exemplars into future drafts and produces an honest weekly cohort digest (by channel, format, topic, hook — with explicit sample size and missingness) so Post #5 is measurably better than Post #1.

---

## 5. The 12-Step Core Vertical Slice (First Release Target)

1. **Discover / Seed:** Enter a technical topic, public URL, or first-hand notes/changelog (`first_hand` | `researched` | `hybrid`).
2. **Research:** Fetch, dedupe, window-filter, and persist permitted sources with provenance, freshness, and SSRF protection.
3. **Synthesise:** Produce a readable structured brief separating sourced findings (linked to `evidenceId`), conflicts, and open questions (deterministic baseline + schema-validated hybrid LLM synthesis with fabricated-ID rejection).
4. **Opportunity:** Create a channel-validated Opportunity (`x_post`, `x_thread`, or `threads_post`) from the Story without re-running research (and support creating a second format from the same research).
5. **Incorporate Creator Expertise:** Attach explicit user observation/proof points + profile + 2–3 real approved human-edited voice exemplars.
6. **Generate Original Content:** Produce copy using frozen `GenerationPolicy` + word-safe `unitFit` X budget rules (no mid-word 280-char cuts).
7. **Verify Claims & Quality:** Run `claim_evidence_v1` mapping + deterministic uncited-number / paraphrase / boilerplate / length checks (independent of disabled Jev flags).
8. **Audit Evidence & Warnings:** Display source excerpts, conflicts, claim support badges, and quality warnings right beside the draft in `ArtifactReviewView`.
9. **Edit & Approve Exact Revision:** Support format-safe editing (including `x_thread` per-unit edits) producing immutable `supersedes_id` revisions, followed by explicit human approval (`approval_required`; `trusted` gated off).
10. **Deliver Safely (Export-First Default + Optional Isolated Publish):** Copy Text, Copy Numbered Thread, or Export Markdown with Citations (zero credentials needed); optionally schedule (future-only) or publish through owner-isolated, fixture-tested X/Threads adapters.
11. **Capture Results:** Log published URL (`POST /api/artifacts/:id/log-manual-publish`) and enter or sync metrics (`POST /api/learning/publications/:id/observations`) preserving `observed` vs `not_available` missingness.
12. **Learn:** Generate an honest weekly cohort digest (channel × format × topic × hook, sample size, missingness, one low-risk next experiment) and feed approved human edits back as voice exemplars.

---

## 6. First Release Scope (M2) vs. Explicitly Deferred (Non-Goals)

| In Scope (M2 Pilot-Ready) | Explicitly Deferred (M3+ Non-Goals) |
|---|---|
| P0 CI gates (`test:unit` + `test:db`), unit DB decoupling, `migration-guard.yml` untracked check, D8 snapshot repair | Turning on Jev flags (`JEV_*` remain OFF until M2 produces a labelled golden set) |
| Tier A `run60` safety ports (`7e4a6f8`, `e8c01f4`, `5627fd9`–`5cf7af6`, `75f4e99`, `897b935`) | Founder-hardcoded autopilot heuristics (`f421c23`, `70583fa`, `run56`, `run57`) |
| Owner-strict fail-closed social credentials + `trusted` automation kill switch + SSRF/secret hygiene | General multi-tenant SaaS, orgs/workspaces, billing/metering |
| Fix 5 broken UI seams + Copy/Export + truthful Settings + truthful marketing site copy | MCP server (`P1-3`), CopilotKit expansion, Agent Reach scraping |
| Structured Story brief + `StoryInput` (`first_hand`/`researched`/`hybrid`) + `claim_evidence_v1` + review audit UI | Predictive viral scoring (`viral_scores` auto-decisions), Experiments/Autonomy auto-activation |
| Manual publish log + topic/hook weekly digest + approved human-edited exemplars in context | Facebook/Newsletter/Blog adapters, Video Factory, quote cards/carousels/asset library |
| Pilot onboarding, demo dataset, backup/restore, and founder validation scorecard | Live unverified external social writes (gated on owner authorization + terms check) |

---

## 7. Success Metrics & Validation Plan

### Technical Acceptance (Autonomous — M2)
- CI runs `check`, `build`, `test:unit`, `test:db`, `playwright`, `e2e-live`, and strict `migration-guard` on disposable infrastructure with zero live external calls.
- Automated integration test proves the full vertical slice including second-format reuse without re-research, adversarial inputs (missing/duplicate/conflicting/stale sources, prompt injection, malformed model JSON, cross-owner isolation), and zero unapproved publishes.
- Marketing copy and Settings UX match shipped reality 100%.

### Commercial & Product Validation (Owner + Real Users — M3, Cannot Be Automated)
- **5-Session Founder Benchmark:** Score 5 real technical topics on hands-on time (target ≤10 min, stretch ≤5 min), edit ratio, factual accuracy (0 unflagged hallucinations), and usability without rewrite.
- **Controlled Pilot (3–5 Technical Creators / DevRel Leads):** Export-first or isolated instances; measure weekly repeat usage over 4 weeks, qualitative draft-value rating vs. raw Claude/ChatGPT, and willingness to pay before building multi-tenancy or MCP.

---

## 8. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Cross-owner credential leakage if a 2nd user logs in | Fail-closed owner credential lookup (disable env fallback unless explicit single-operator opt-in); two-owner DB isolation test. |
| Broken Drizzle D8 blocks schema changes | Deliver Waves 1–3 with **zero schema migrations** (reusing existing JSONB columns); repair D8 cleanly in an isolated Wave 4 commit. |
| xQuick third-party X proxy terms/outage risk | Make **Export-First** the zero-dependency pilot default; mark live X writes `NOT VERIFIED` until owner verifies xQuick terms and authorizes live test. |
| Playwright E2E regression when cleaning UI bloat | Preserve all mounted routes; only adjust UI disclosures in lockstep with Playwright spec updates. |
| False sense of commercial validation from passing tests | Explicitly separate "Technically verified" from "Verified live" and "Awaiting real-user validation" in every report. |
