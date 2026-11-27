# ContentForge — Autonomous Productization Goal

**Prepared:** 2026-11-27  
**Repository:** unplugged-kk/ContentForge  
**Reviewed baseline:** origin/main at 0dca9550d161d08a7ec82b34488ce4a022db81e0  
**Collaboration branch:** collab/ai-pair-review  
**Purpose:** Durable goal and operating contract for an autonomous coding agent. This is a proposal and execution brief, not proof of product readiness.

---

## 1. Current-state assessment

This review used GitHub repository metadata, tracked source/document inspection, branch comparisons and the latest collaboration review. It did NOT inspect a local checkout, local .agent/skills directory, deployed service, provider console, production database, GitHub Actions logs or a real external publishing session. The agent MUST revalidate all claims locally before acting.

### 1.1 Repository and branch state

- GitHub reports the default branch as main at 0dca9550d161d08a7ec82b34488ce4a022db81e0, titled “Feat/auth0 migration (#6)”, committed 2026-11-11.
- GitHub metadata reports repository visibility as PUBLIC. Older private-repository assumptions are stale unless the owner changes the setting. Perform a secret-history audit; never print or copy discovered secret values.
- collab/ai-pair-review is four commits ahead of main and zero behind. The compared changes are documentation-only: AGENTS.md, docs/COLLAB_BRIEF.md, docs/collab/README.md and docs/collab/REVIEW_ChatGPT.md. Use this branch for collaboration documents, not application implementation.
- No open PR was returned by the repository PR search at review time. Recheck locally and via GitHub before creating work.
- feat/copilotkit-agent-layer is 26 commits behind main and has no unique commits ahead in the comparison. Treat as historical until proven otherwise.
- run56-intel-bridge, run57-idea-pool and run58-word-safe-unit-fit each diverge from main from an older common base (12 commits ahead, 23 behind). They contain overlapping but non-identical candidate changes around ranking, scheduling, post formatting, publishing status/retry handling, analytics and tests.
- run60-schedule-must-be-future also diverges (13 ahead, 23 behind) and includes candidate changes around schedule-time validation, unit-fit, partial publication, retry gates, X text limits, analytics summaries, pillar weighting and autopilot.
- Branch comparisons are not code reviews. Audit candidate commits and tests individually, port only justified changes onto a fresh branch from current main, and preserve original branches. Never merge an old branch wholesale.

### 1.2 What is already present

The current handover and capability matrix describe a substantial single-operator foundation:

- React/Vite/Tailwind frontend; Express/TypeScript backend; PostgreSQL/Drizzle persistence; pg-boss durable jobs; cron scheduling.
- Research providers for RSS, Reddit, YouTube metadata, Hacker News, web research, video transcripts and optional last30days. YouTube metadata and transcript retrieval are distinct capabilities.
- Research engine with deduplication, time-window filtering, evidence derivation, validation, provenance/conflict handling and descriptive ranking.
- ResearchJob → Story → Opportunity lifecycle.
- Generation policies/jobs, immutable Artifact revisions, review/approval states, schedules, occurrences, publication records, adapters and result capture.
- Adapters are registered for X, Threads, Instagram, LinkedIn and YouTube in the documented code surface. Adapter registration and fixture tests do NOT prove current live account connectivity or successful delivery on every channel.
- Learning observations/proposals, experiments, human-gated policy activation and an autonomy controller exist.
- Jev is a typed, versioned decision layer with a ledger and shadow decisions. Execution retains its own hard validators.
- Auth0, password/Google legacy authentication, CSRF and owner-scoping foundations exist.
- 29 in-app domain tools are documented. An MCP client exists; an MCP server exposing ContentForge tools to external assistants is not implemented.
- A public marketing site and agent pages exist. Historical visual-match scores around 46–47% against a 90% target are documented; the current score was not remeasured.

The architecture and workflow are feature-rich. The main risk is not a shortage of modules. It is the gap between a large technical foundation and a reliable, understandable, repeatable product workflow.

### 1.3 Verification status — old results are not current

The 2026-11-11 handover/capability matrix DOCUMENT a local run with:
- TypeScript check clean.
- 1,072 unit/client tests passing.
- 388 real-Postgres DB tests passing.
- Production build successful.
- Marketing routes and health endpoint returned HTTP 200.
- A full Playwright run was not cleanly re-run after fixes because another process was rebuilding dist concurrently. Two targeted spec files passed 12/12 after fixes.

These are historical documented results, not fresh verification of the current checkout.

Tracked workflows inspected:
- .github/workflows/e2e.yml runs Playwright against ephemeral Postgres and has a separate durable live-E2E harness job using fixture boundaries.
- Neither tracked workflow invokes npm run test:unit or npm run test:db.
- .github/workflows/migration-guard.yml invokes npm run db:generate, then checks git diff --quiet for migrations. That check may miss newly created untracked migration files.
- The roadmap documents duplicate Drizzle snapshot IDs (0016–0019) and unreliable migration generation. Reproduce safely before deciding whether the defect remains.
- No current Actions run result was available from the commit-workflow lookup in this review.

The package scripts for test:unit and test:db invoke script/test-db-guard.ts and load server/testing/hermeticEnv.ts. The guard purges connected_accounts on a local/test database. These suites MUST only run against an explicitly disposable test database. Never use raw node --test because it bypasses the safety preload.

### 1.4 Product and engineering gaps

**Product proof**
- No verified evidence in the inspected repository of paying customers, repeat usage, willingness to pay, retention, customer acquisition or support burden.
- The initial customer hypothesis in the latest review is a hands-on technical DevRel lead at a small infrastructure/developer-tool company. This is a hypothesis, not validated market research.
- Draft usefulness, fact-check burden, edit rate, time saved and the original five-minute daily goal have not been measured in a repeatable trial.
- The marketing site is not proof that the product delivers the core workflow.

**Research and editorial quality**
- Research infrastructure exists, but it must be tested for whether it produces a useful, readable, source-grounded research brief rather than merely storing provider results.
- Important claims in drafts must be traceable to evidence; conflicts visible; source freshness shown; facts separated from inference/opinion.
- Generated content must add original analysis and the user's real expertise. It must not fabricate first-person experience or simply paraphrase sources.
- Preserve provenance through research → Story → Opportunity → Artifact revision → Publication.

**Creation and distribution**
- Pipeline and channel adapters exist, but current live provider delivery is not verified by this review.
- A human review/export experience needs to be demonstrated end-to-end. The trusted automation mode can approve without a person; do not use that mode for the first pilot.
- One-click campaign/batch review and similarity detection are documented as incomplete.
- Do not treat X/Threads/LinkedIn/YouTube adapter registration as proof of production-grade integration.

**Measurement and learning**
- Results and performance signals, observations and proposals exist.
- Per-topic/per-hook aggregation and reliable predicted-versus-actual joins are documented as missing.
- Build useful measurement before predictive scoring: channel, format, topic/pillar, hook/angle, publish time, metric window, freshness and explicit missingness.
- Produce a small weekly evidence-backed insight; do not claim causality from small samples or treat missing analytics as zero.

**Jev and agents**
- Jev exists, but the decision map's runtime flags are a dated snapshot, not a current production observation. Recheck master/per-decision flags, actual consumers, fallbacks and ledger writes.
- Several decisions are documented as disabled or shadow-only. Do not turn on every flag at once.
- Agent Reach is documented as inert/not dispatched. Do not build scraping that risks account bans or violates platform terms.
- MCP server is missing. It is not a prerequisite for the core product and should be deferred unless a real workflow requires it.
- A large skill/subagent catalogue is not itself product value. Inventory local skills and use the smallest useful combination for each task.

**Productisation and operations**
- Current design is single-operator. Auth0 and owner IDs do not prove safe multi-tenant isolation.
- Before shared customer use, verify isolation for connected account tokens, provider credentials, uploaded assets, research, stories, artifacts, jobs, Jev ledger, learning data, cost/usage records, logs and publication side effects.
- Multi-tenant organisations/workspaces, billing/metering, customer onboarding, support process and commercial packaging are not established by this review.
- Backups/restore, deletion/retention, privacy notices, auditability, rate limits, cost caps and incident runbooks need a documented pilot-ready standard.
- Repository visibility is public. Audit all reachable Git history for secrets and ensure local ignored workspaces/cookies are never committed.

### 1.5 Recommended first product

The first offer should be deliberately narrow:

> Turn a public technical changelog, credible source material and an expert's own notes into one source-backed technical post per week that the expert can review, edit and publish.

Initial target hypothesis: a technical DevRel lead or technical creator in developer infrastructure (observability, reliability, cloud, CI/CD, platform engineering). Keep this hypothesis explicit and validate it; do not build a generic multi-tenant SaaS simply because the architecture can be extended.

The first useful workflow:
1. Discover a relevant public topic/source.
2. Research multiple permitted sources.
3. Produce a readable synthesis with citations, conflicts and freshness.
4. Combine it with explicitly supplied expert notes.
5. Generate one high-quality original post.
6. Show claim-level evidence and quality warnings.
7. Let the human edit and approve the exact revision.
8. Export/copy the final content; later use approved channel publishing.
9. Capture a post URL and metrics, then produce a cautious learning note.

X and Threads are distribution channels, not the product's core identity. X monetisation is a founder distribution experiment, not a customer promise.

---

## 2. Autonomous goal

**Goal:** Turn the existing ContentForge repository into a secure, dependable, tested, single-operator/pilot-ready research-led content product by improving and completing the smallest valuable end-to-end workflow. Reuse the existing architecture wherever it is sound. Work continuously and autonomously through safe, verifiable tasks until the technical acceptance criteria below are met.

This is a pilot-ready productization goal, not a claim that product-market fit, paying-customer validation or full self-serve multi-tenancy can be automated. Never claim those real-world outcomes without real users and observed evidence.

### Product definition

ContentForge discovers information from permitted web sources, researches and synthesises it with traceable evidence, identifies worthwhile content opportunities, creates original channel-appropriate content using the user's actual expertise, supports human review and approval, distributes through supported compliant channels, and learns from observed performance.

### Non-goals for this run

Do not build these unless a blocking dependency is demonstrated by a tested core workflow:
- General-purpose multi-tenant SaaS, organisations, teams, billing checkout or agency support.
- MCP server or more external agent surfaces.
- New providers/channels merely to increase feature count.
- Live scraping of X or other platforms against terms or account safety.
- Autonomous replies, likes, follows, DMs, engagement manipulation or unsolicited outreach.
- Fully autonomous public publishing or approval bypass.
- Predictive/viral scoring before reliable outcome data exists.
- Video Factory replacement, advanced video/carousel generation or broad media expansion.
- Large UI redesigns or marketing-site visual cloning unrelated to the core workflow.
- New vector database, knowledge graph, microservices split or orchestration framework without measured need.

---

## 3. Autonomous operating contract

You are authorised to inspect, plan, implement, test, document, commit and push changes on a dedicated work branch. Keep working without asking the owner for routine decisions.

### 3.1 No-intervention rule

Do not ask the owner routine questions. Choose conservative defaults, record assumptions and continue.

If a task requires an unavailable credential, paid external call, owner-only console action, legal/compliance decision, live public post, destructive production operation or customer data:
- Do not perform that action.
- Do not block unrelated work.
- Build and test the safe local/mock path.
- Record the exact missing prerequisite in docs/collab/AGENT_SYNC.md under BLOCKED_OWNER_ACTIONS.
- Continue with the next safe task.
- Do not claim the blocked behaviour is VERIFIED LIVE.

Only stop the entire run if continuing would risk data loss, credential exposure, irreversible production effects or corrupting another agent's work.

### 3.2 Git safety

- Read AGENTS.md, docs/collab/README.md and the latest collaboration sync/review documents before work.
- Fetch origin and inspect git status, branch, HEAD, remotes and upstreams.
- Never reset, clean, stash, force-push, delete branches or overwrite unknown local changes.
- Never work directly on main.
- Use latest origin/main as the implementation base. Do not merge collab/ai-pair-review into the code branch.
- Create or reuse one dedicated branch: work/productization-mvp.
- Keep one coherent draft PR to main for this autonomous programme; use small logical conventional commits. Do not merge it.
- If the branch exists, inspect and preserve its work. If it diverged, diagnose before changing anything.
- Before each iteration, fetch and check for new main commits and reviewer documents. Reconcile safely.
- Commit and push completed, tested increments so progress survives context resets.
- Never include .env, tokens, cookies, credentials, personal data, generated build output, Playwright artifacts or local agent caches.
- Never rewrite Git history.

### 3.3 Git-based handoff

Maintain these files under docs/collab/:
- PRODUCTIZATION_GOAL.md — this goal and acceptance contract; preserve owner-approved changes.
- PRODUCTIZATION_STATUS.md — current phase, completed work, next task and blockers.
- AGENT_SYNC.md — handoff between local agent and ChatGPT.
- PRODUCTIZATION_DECISIONS.md — decisions, assumptions, rejected alternatives and evidence.
- PRODUCTIZATION_VERIFICATION.md — exact commands, environment class, commit SHA, results and timestamps.
- PRODUCTIZATION_BACKLOG.md — ordered tasks with acceptance criteria and dependencies.
- SKILL_INVENTORY.md — actual local skill inventory and the skills used.

When the owner or ChatGPT says "sync":
1. Fetch origin.
2. Read latest collab/ai-pair-review documents and every new REVIEW_*.md.
3. Read AGENT_SYNC.md and PRODUCTIZATION_STATUS.md.
4. Reconcile reviewer findings against code and tests.
5. Mark each ACCEPTED, REJECTED, PARTIALLY_ACCEPTED or NEEDS_OWNER_ACTION, with reason and evidence.
6. Never silently overwrite a reviewer report.
7. Commit reconciliation and continue with the highest-priority safe task.

Do not assume agents notify each other. Git is the shared record.

---

## 4. Phase 0 — Re-orient, inventory and branch triage

Before coding:

1. Run make orient and the repository's graft/code-graph instructions from AGENTS.md. Use repo-relative paths.
2. Inspect actual Git status and all local/remote branches.
3. Read current docs and compare them with source code.
4. Inventory every local agent skill directory that actually exists, including .agent/skills, .agents, .claude, .codex, .commandcode, user-level skill paths and framework-specific registries. Do not assume any path exists.
5. Read complete instructions for skills relevant to product discovery, planning, research, synthesis, writing, humanization, fact checking, TypeScript, architecture, TDD, debugging, browser testing, security, code review and subagent orchestration.
6. Build docs/collab/SKILL_INVENTORY.md. Record exact path, purpose, trigger, dependencies, limitations, safety and ContentForge use case. Identify overlaps. Do not install, delete or edit skills.
7. Use subagents only for independent bounded work. One writer per file. The lead agent owns synthesis and integration.
8. Audit every branch ahead/diverged from main, especially run56-intel-bridge, run57-idea-pool, run58-word-safe-unit-fit and run60-schedule-must-be-future. Compare commit-by-commit, inspect tests and run relevant checks in isolated worktrees. Port only independently justified changes. Never merge an old branch wholesale. Preserve all original branches.
9. Inspect the CopilotKit branch and determine whether it is obsolete, superseded or has uniquely valuable changes. Do not add a second agent runtime without a demonstrated need.
10. Audit repository secret hygiene and Git history using safe scanners. Report file paths and secret classes only; never print values. Because GitHub currently reports the repository public, treat this as a high-priority security check.
11. Reconcile stale/contradictory docs. Check actual CI workflows, migration generation, live E2E, Jev flags, publication automation modes and marketing site. Do not blindly trust the 2026-11-11 handover.

Deliver a current-state audit and ranked backlog before feature work. Then continue; do not wait for owner review unless a destructive/security blocker exists.

---

## 5. Phase 1 — Trustworthy engineering gates

First implementation priority.

1. Add unit and DB suites to CI using isolated ephemeral PostgreSQL.
2. Apply migrations to the ephemeral DB before DB tests.
3. Ensure CI has no production credentials, provider keys or external publishing capability.
4. Use npm scripts that preload hermeticEnv and the DB safety guard. Never bypass those protections.
5. Make CI fail on test failures. Document required check names; do not change owner-controlled branch protection.
6. Reproduce db:generate on a scratch clone/database. Detect tracked modifications AND untracked generated files.
7. Resolve duplicate Drizzle snapshot IDs/journal inconsistencies only with a reproducible tested plan.
8. Prove unchanged schema creates no drift, a trivial schema change creates exactly one valid migration, and fresh install plus representative upgrade both succeed.
9. Run typecheck, build, unit, DB, Playwright and live fixture harnesses on the current branch.
10. Fix flaky/order-dependent tests at root. Do not hide them with broad retries or skips.
11. Re-run complete suites after the final change and record exact totals.

### Test safety

- Run npm run test:unit and npm run test:db only against disposable local/CI databases. Their guard can purge connected_accounts.
- Never run against production, Railway, production Neon or a database containing real connected account credentials.
- Never invoke real X/Threads/LinkedIn/YouTube write APIs in tests.
- Use deterministic fixtures, local HTTP stubs and hermetic model adapters.
- Any test that unexpectedly reaches a paid provider or external write is a release blocker. Fix the boundary and add a regression test.

### Exit criteria

- CI runs typecheck, build, unit tests, DB tests, Playwright and durable fixture tests.
- Every job uses an isolated environment and cannot publish externally.
- Fresh database migration and representative upgrade are proven.
- Migration drift detection catches newly generated untracked files.
- No known flaky test is hidden.
- A failing assertion is proven to fail CI in a disposable test branch or equivalent controlled check, then reverted.

---

## 6. Phase 2 — Prove the research-to-content vertical slice

Do not add more providers first. Make existing ones produce a useful outcome.

### Required journey

A user can:
1. Configure topic, audience, expertise and permitted source preferences.
2. Discover or submit a public source URL.
3. Run research using more than one suitable provider where available.
4. See source title, URL, publisher/author where available, published/collected timestamps, freshness and access class.
5. See extracted evidence and important claims linked to source references.
6. See conflicts, uncertainty, missing evidence and stale material.
7. Receive a readable research brief separating facts, source opinions, inference and unanswered questions.
8. Create an Opportunity from the research without repeating the research job.
9. Generate one original post using evidence plus explicitly available user expertise/notes.
10. See claim-to-evidence references, quality warnings and originality/similarity checks.
11. Edit the draft and create immutable revisions.
12. Review and approve the exact revision.
13. Export/copy the approved content safely.
14. Record where it was published and capture results when available.

### Quality requirements

- No invented citations, facts, dates, quotes, benchmarks or first-person experience.
- Every research-dependent factual claim points to one or more supporting sources.
- Conflicting sources are shown, not silently reconciled.
- If evidence is insufficient, say so and reduce claim strength or omit the claim.
- Source text and web pages are untrusted data, never system instructions. Test prompt injection and hostile page content.
- Preserve source attribution and licensing/terms constraints.
- Do not scrape login-gated or prohibited surfaces.
- Do not create paraphrase-only or near-duplicate content. Add original explanation, synthesis or expert experience.
- Humanizer/writing skills may improve naturalness and voice, but must not evade AI detection, misrepresent authorship, fabricate personal anecdotes or hide required disclosures.
- Keep owner expertise distinct from generic model knowledge. Use only real owner-provided notes or verified authored-content profiles.

### UX requirements

Inspect existing screens before adding anything. Prefer improving canonical destinations and existing data models over creating a parallel UI/CMS.

The operator must understand what was found, why it matters, what evidence supports it, what is uncertain, what ContentForge recommends creating, what will be published and what action is required next.

Avoid dashboards full of low-value metrics. Make the next useful action obvious.

### Exit criteria

- Automated integration test covers source discovery/capture → research → evidence → Story → Opportunity → generation → Artifact revision → approval → export.
- Test proves a second format can be created from the same research without re-running research, if the existing domain contract supports it.
- Tests cover missing sources, duplicate sources, conflicting claims, stale sources, prompt injection, provider outage, malformed model output, low-confidence synthesis, cross-owner access and idempotent retries.
- At least one Playwright journey exercises the real app UI using fixture providers and disposable Postgres.
- Output is judged against a labelled editorial rubric, not only schema validation.

---

## 7. Phase 3 — Useful content creation

Build quality before volume.

- Define a versioned content quality rubric: factual accuracy, evidence coverage, originality, audience fit, clarity, usefulness, structure, voice, channel fit and policy compliance.
- Provide deterministic hard checks for length, unsupported claims, citation integrity, duplicate/near-duplicate content, forbidden content and channel constraints.
- Model evaluation is advisory, not truth.
- Build a small labelled golden set of representative technical briefs and expected content outcomes.
- Include negative examples: weak evidence, generic AI slop, unsupported claims, inaccurate code, fake incident stories, fabricated metrics, clickbait and excessive hype.
- Compare drafts with the user's existing manual workflow and approved historical content where access and rights permit.
- Preserve model/provider/version, prompt/template version, source refs, user edits and artifact revision provenance.
- Make regeneration explicit; retries must not silently regenerate or overwrite an artifact.
- Keep human editing and approval first-class.

**Exit:** Golden-set evaluation runs in CI or a deterministic offline harness; critical factual/citation failures block or are clearly surfaced; voice is measured against real approved owner examples; unsupported claims can be corrected before export.

---

## 8. Phase 4 — Safe distribution and channel readiness

Reuse existing adapters and publication lifecycle.

- Audit X and Threads first; add other channels only if the core workflow needs them.
- For each adapter document exact API surface, scopes, supported media, character limits, rate limits, cost/plan restrictions, terms and failure/reconciliation behaviour.
- Distinguish implemented, fixture-tested, credential-tested and verified-live.
- Preserve exact Artifact revision pinning through scheduling and publication.
- Require explicit human approval of the exact revision before external publication.
- Default pilot configuration: approval_required; publication automation none; manual export enabled.
- Disable trusted auto-approval and autonomous publication for pilot flows.
- Ambiguous outcomes become unknown/reconcile-required; never blindly retry a possibly completed write.
- Make duplicate delivery idempotent.
- Add safe preview/dry-run mode.
- Make connection revocation, token encryption, least-privilege scopes and error handling testable.
- Verify current compliance against official platform documentation at implementation time.

**Live-provider boundary:** The agent may test adapters against mocks, local fixtures and read-only API checks if credentials already exist and calls are free/within existing limits. It MUST NOT publish a real public post, send replies/DMs, follow/like, spend credits, change connected accounts or alter production credentials without explicit owner authorisation. If no safe live write test is possible, mark NOT VERIFIED and document the manual acceptance step.

**Exit:** X and Threads have fixture contract tests and UI preview/export journeys; publication state/retry/duplicate/ambiguous outcomes are tested; unapproved content cannot publish under any flag combination; the autonomous agent makes no real public post.

---

## 9. Phase 5 — Measurement and learning

Implement a small trustworthy feedback loop before prediction.

For each publication/result preserve where available: channel/account reference (never raw token), exact Artifact revision, format, topic/pillar, hook/angle, publish timestamp, metric observation timestamp/window, source/provider/freshness, available metrics and explicit missingness/unavailable reasons.

Build reliable joins between Opportunity/Artifact metadata, Publication, Result and performance_signals.

A weekly insight should answer:
- Which posts performed relatively better within comparable channel/format cohorts?
- What topic, hook or structure did they use?
- How many observations support this?
- What data is missing or stale?
- What is one low-risk experiment worth trying next?

Use observations and proposals. Do not autonomously rewrite strategy or activate policies from small samples.

**Exit:** Tests cover missingness, late metrics, duplicates, deleted posts, timezone boundaries and owner isolation. Predictions are joined to actuals by explicit IDs and comparable windows. No causal claim is made from inadequate samples. Weekly insight is readable, actionable and evidence-backed.

---

## 10. Phase 6 — Pilot readiness, security and operations

This is a controlled single-operator pilot, not a general SaaS launch.

- Define a narrow pilot profile and clear one-sentence promise.
- Provide repeatable onboarding checklist and demo dataset.
- Provide a clean research → approved export workflow without channel credentials.
- Add basic usage/cost visibility and safe limits. Avoid “unlimited AI”.
- Document data sources, retention, deletion/export, privacy and incident handling.
- Verify backup and restore on a disposable environment.
- Verify owner isolation for every resource and background job.
- Verify secrets encryption, redaction, rotation guidance and no token leakage.
- Run dependency/security scans and fix exploitable high/critical issues.
- Audit SSRF, redirects/private IP ranges, uploads, XSS, CSRF, auth, session fixation, rate limits, prompt injection and authorization boundaries.
- Ensure source URLs cannot access internal metadata services or local files.
- Ensure logs/error reports do not contain secrets or unnecessary private source content.
- Provide rollback/deployment runbook, health/readiness checks and actionable operational alerts.
- Rework marketing copy to describe only shipped behaviour. Remove MCP/integration claims that do not exist.
- Ensure public Git history contains no secrets. If found, do not reveal them; record path/class and safe rotation/remediation steps. Do not claim remediation without verification.

**Customer isolation:** Do not place an external pilot customer's connected-account tokens, private documents or unpublished content in the founder's shared single-operator environment. Until tenant isolation is independently proven, use public sources and sanitized/consented notes with manual export, or a dedicated isolated deployment. Do not create multi-tenancy merely to avoid this decision.

**Exit:** No unresolved critical/high exploitable issue in scoped pilot path; backup/restore demonstrated; onboarding/operating/support/deletion/incident runbooks exist; no customer secret/private data committed; marketing promises match verified behaviour.

---

## 11. Final technical acceptance

The technical goal is complete only when all applicable criteria are evidenced on a clean reproducible branch:

1. A new operator can understand the product and complete the core workflow without developer intervention.
2. Product discovers/captures permitted sources, researches them, produces an evidence-backed synthesis and identifies a useful opportunity.
3. It generates original content using explicit user expertise and evidence, with claim provenance and quality warnings.
4. It supports revision, human approval and safe export.
5. X/Threads distribution paths are accurately represented, fixture-tested and safe; live write behaviour is clearly labelled if not authorised.
6. Results attach to the exact publication and Artifact revision, with missingness preserved.
7. Weekly insight is produced from comparable data without overstating causality.
8. Typecheck, build, unit, DB, Playwright and durable live fixture tests pass in CI.
9. Migration generation/drift checks are reliable and fresh-install/upgrade paths pass.
10. Security, owner isolation, secrets, backup/restore, operational and compliance checks pass for the pilot scope.
11. Documentation, onboarding and runbooks match actual behaviour.
12. Remaining gaps are explicitly marked DEFERRED, BLOCKED or NOT VERIFIED with reasons.

Do not claim product-market fit, customer willingness to pay, retention, actual time savings or revenue. These require real users and observed evidence. Create a founder-validation checklist and measurement template; do not fabricate completion.

---

## 12. Continuous execution loop

Repeat until all safe technical acceptance criteria are met:

1. SYNC: fetch origin, inspect status, read latest collaboration reports and decisions.
2. ORIENT: inspect current code graph and relevant source/tests; verify the task still exists.
3. PRIORITISE: select highest-priority incomplete safe task.
4. PLAN: define smallest vertical slice, affected files, risks, tests and rollback.
5. IMPLEMENT: use relevant installed skills and subagents. Follow TDD where appropriate. One writer per file.
6. TEST: run focused tests first, then required broader suites. Use disposable databases and mocked external boundaries.
7. REVIEW: run an independent code-review subagent. Fix critical/high findings and justified medium findings.
8. VERIFY: inspect final diff, rerun required checks, confirm no secrets/generated artifacts/unrelated changes.
9. DOCUMENT: update status, decisions, verification, backlog and handoff.
10. COMMIT/PUSH: create a small conventional commit on work/productization-mvp and push.
11. REPEAT: continue to next safe task without waiting for owner input.

For every task record task ID/objective, baseline and implementation SHA, exact files changed, tests and results, tests not run and why, security/compliance implications, reviewer findings/disposition, remaining risks and next task.

Never mark complete because code was written; skip failing tests; hide flaky tests with broad retries/skips; weaken assertions; add abstractions for hypothetical needs; enable flags without measured evidence/rollback; make real public posts; incur unapproved costs; merge or deploy.

If a phase is blocked by an owner-only action, record it and continue other phases. If all remaining tasks are owner-blocked or require real-world validation, stop and produce an honest final report.

---

## 13. Definition of autonomous completion

At completion, push all work and provide:
- final work branch and draft PR URL,
- baseline and final SHAs,
- phase-by-phase acceptance matrix,
- exact CI run links and test totals,
- security and migration findings,
- branch triage disposition,
- skill inventory and skills actually used,
- key architecture/product decisions,
- known gaps and owner-only actions,
- concise pilot onboarding/demo runbook,
- explicit statement of what was NOT verified.

Keep working through all safe tasks without routine intervention. Do not confuse “the codebase builds” with “the product is ready”, or “pilot-ready” with “commercially validated”.

**North star:** one repeatable workflow that turns credible web research and the user's real expertise into a useful, original, source-backed post that can be reviewed, approved, distributed and learned from. Build that end to end before expanding the product surface.
