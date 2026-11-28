# ContentForge — Agent Collaboration Protocol

**Date:** 2026-11-27  
**Team:** Wayfinder (Strategy, Intelligence & Independent Challenger) + Poteto mode (Engineering & Execution Lead)  
**Shared Knowledge Base:** Git repository (`work/productization-mvp`), `docs/product-discovery/*`, `origin/collab/ai-pair-review:docs/collab/*`, `plans/wayfinder-contentforge/MAP.md`, and `graft` code graph.

---

## 1. Verified Communication Mechanism

Both agents operate as **real, independent Cursor subagents** orchestrated via the native `Task` tool, communicating through structured handoff artifacts committed to Git rather than ungrounded chat memory:

1. **Wayfinder Subagent** (`Task`, `generalPurpose` loaded with `/Users/kishore/.agents/skills/wayfinder/SKILL.md`, `plans/wayfinder-contentforge/MAP.md`, and product docs): Runs independent codebase + UX discovery, challenges product scope and technical proposals, and performs independent acceptance review after every implementation wave.
2. **Poteto-mode Subagent** (`Task`, `subagent_type: "poteto-agent"`, executing `/Users/kishore/.agents/skills/poteto-mode/SKILL.md` and leaf `principle-*` skills): Performs technical audits, names data shapes, executes bounded TDD increments, runs verification suites, and pushes back with concrete codebase/E2E/DB constraints.
3. **Coordinator + Shared Knowledge Base**: Synthesizes both positions, verifies contested claims directly against source files or test runs, and records every resolved decision and open uncertainty in `docs/product-discovery/DECISIONS.md`, `STATUS.md`, and `BACKLOG.md`.

*(Honesty note: Neither `wayfinder` nor `poteto-mode` exists as an external networked daemon or CLI, and `claude-mem` worker returned 404/offline Chroma. Real separation of judgment is achieved via independent subagent invocations with separate contexts + Git-versioned shared records.)*

---

## 2. Role Split

| Responsibility | Wayfinder (Strategy & Challenger) | Poteto Mode (Engineering & Execution) |
|---|---|---|
| Product direction & UX truth | Audits real user journeys, challenges distractions, enforces differentiation bar | Validates technical feasibility, names exact data shapes, flags E2E/schema constraints |
| Scope & prioritization | Cuts premature abstractions (MCP, Jev flags, multi-tenancy, Experiments UI) | Sequences verifiable units, prevents breaking existing tests or DB triggers |
| Implementation | Never writes production code directly (plan/review/challenge only) | Owns code changes, tests, commits, typechecks, and verification scripts |
| Acceptance & review | Independently reviews every completed increment against product acceptance criteria | Resolves critical/high review findings or escalates justified disagreements with evidence |

---

## 3. Recorded Cross-Agent Debates & Resolutions (M1 Discovery Rounds)

During Phase 1–4, Wayfinder and Poteto mode ran **two full independent rounds** — Round 1 (independent code/UX audits) and Round 2 (direct point-by-point response to each other's 8 + 6 challenges). Every real disagreement was verified in source and resolved below:

| # | Contested Question | Wayfinder Position | Poteto Mode Position | Source Evidence Verified | Final Agreed Decision |
|---|---|---|---|---|---|
| **D-01** | **Where does LLM synthesis live?** | Research lacks real synthesis (`draftSynthesis` is 5 URLs); build evidence-backed brief separating facts, opinions, inference, open questions. | Keep `server/research/intelligence.ts` strictly deterministic (Tier 4); improve deterministic brief AND add schema-validated hybrid `server/story/synthesis.ts` (fabricated `evidenceId` rejection + deterministic fallback). | `server/research/intelligence.ts:538-560`, `CURRENT_ARCHITECTURE.md:94-96`, `server/content/automation.ts:947-966`. | **Agreed (Poteto boundary + Wayfinder quality bar):** Keep `research/intelligence.ts` deterministic (upgrade from bare URLs to titled excerpts + conflict summary); put hybrid structured brief synthesis at `server/story/synthesis.ts` with strict `evidenceId` validation and deterministic fallback. |
| **D-02** | **Where does claim-to-evidence tracing live?** | Generation must map claims to `evidenceIds` and surface unsupported claims in `ArtifactReviewView`. | Do **not** alter `payloadSchemas.ts` (immutable DB trigger `0007_dusty_preak.sql:150-166` + channel adapters expect `{ text }` / `{ units }`) or add columns before D8 is fixed. Store `claim_evidence_v1` in existing `artifacts.attribution` JSONB. | `migrations/0007_dusty_preak.sql:150-166`, `server/artifacts/payloadSchemas.ts:172-196`, `shared/schema.ts:1173`, `server/content/artifact.ts:96-100`. | **Agreed (Poteto data shape):** Keep `payload` pure; extend `artifacts.attribution` JSONB with `claim_evidence_v1` + deterministic uncited-number/claim check + review UI drawer. Zero DB migration needed. |
| **D-03** | **Execution order: P0 CI/D8 first vs. UI fixes first?** | P0 CI (`test:unit` + `test:db`) + unit DB decoupling + `migration-guard.yml` fix MUST land first; timebox D8 so it doesn't stall M2. | Initially proposed Wave 1 UI fixes → Wave 2 intelligence → Wave 3 CI/D8, while also warning in Round 1 that `test:unit` fails without `DATABASE_URL` and CI gates nothing. | `.github/workflows/e2e.yml`, `.github/workflows/migration-guard.yml:32`, fresh `npm run test:unit` failure (`server/db.ts:6`). | **Agreed (Wayfinder + `PRODUCTIZATION_GOAL.md` order):** **Wave 0/1 = P0 Engineering Gates & Safety Floor** (unit DB decoupling, CI unit/DB jobs, `migration-guard.yml` fix, owner credential fail-closed, Tier A `run60` safety fixes, `trusted` gate) FIRST; **Wave 2 = M2 UI fixes + Export + Copy**; **Wave 3 = Synthesis + Claim Tracing + Learning Exemplars**; **Wave 4 = D8 baseline + UI de-emphasis**. |
| **D-04** | **Divergent `run60` branch salvage: all 9 commits vs. selective?** | Split into Tier A (canonical/shared-transport safety) vs Tier B (don't sink time into legacy `/api/posts` maintenance or `fdb0b58` analytics logs). Strip `script/oci-run*`. | Proposed porting 9 fixes (`24cb12f`, `e8c01f4`, `2b11460`, `7e4a6f8`, `5627fd9`, `8b62870`, `5cf7af6`, `75f4e99`, `897b935`, `fdb0b58`) and skipping `f421c23`, `70583fa`, `run56`, `run57`. | `git log origin/main..origin/run60-schedule-must-be-future`, `server/content/adapters.ts:23` (imports `../social/x`). | **Agreed (Tier A first):** Port Tier A (`24cb12f`, `7e4a6f8`, `e8c01f4`, `5627fd9`+`8b62870`+`5cf7af6`, `75f4e99` wired into canonical generation/adapters, `897b935` if clean on `/api/posts` for `/today` safety). Strip all `script/oci-*`. Defer `fdb0b58`, `run56`, `run57`, `f421c23`, `70583fa`. |
| **D-05** | **UI bloat: delete legacy modes vs. preserve Playwright specs?** | Collapse 9 Create modes, 7 Source views, Experiments/Autonomy, and legacy routes out of pilot UI. | Deleting routes/modes breaks `e2e/canonical-ia.e2e.spec.ts:55-64`, `e2e/routes.e2e.spec.ts:16-35`, `e2e/learning-proposals.e2e.spec.ts`, and `e2e/experiments.e2e.spec.ts`. Freeze backend flags off; de-emphasize UI behind disclosures ONLY in lockstep with Playwright updates. | `e2e/canonical-ia.e2e.spec.ts:15-64`, `e2e/routes.e2e.spec.ts:16-35`. | **Agreed (Poteto E2E constraint):** Never silently break Playwright. Freeze Jev/MCP/Autonomy/Experiments flags off; keep routes mounted; de-emphasize secondary UI behind clean collapsible sections with lockstep E2E updates in Wave 4. |
| **D-06** | **Delivery mode: Export-First vs. Live X Publish?** | Round 2 pushed for live verified X publish with per-owner OAuth as Step 12. | Export-first (Copy Text / Copy Thread / Export Markdown + Citations + Manual Publish Log) delivers immediate pilot value with zero X/xQuick credential or terms risk; live external publish is owner-gated and cannot be executed autonomously. | `server/social/x.ts:108-143` (xQuick proxy), `artifact-review-view.tsx:610-649` (no export button), `PRODUCTIZATION_GOAL.md` §8. | **Agreed (Export-First default + Safe Optional Channel Path):** Export-first is the primary pilot delivery path (zero credentials, zero terms risk). Owner-isolated X/Threads publishing remains supported and fixture-tested, with live write strictly awaiting owner authorization + xQuick terms verification. |
| **D-07** | **Env credential fallbacks: delete vs. explicit single-operator opt-in?** | Strip unscoped `getConnectedAccount(platform)` and deployment env fallbacks so User #2 can never publish to founder's account. | `visualPublication.dbtest.ts:156-165` and `reconcile.dbtest.ts:128-136` inject `XQUIK_API_KEY`/`XQUIK_ACCOUNT` directly. Fail closed for any authenticated `ownerUserId` unless explicit `ALLOW_ENV_CHANNEL_FALLBACK=1` + matching `SINGLE_OPERATOR_OWNER_ID` (or unowned test context). | `server/social/{x,threads,instagram,linkedin,youtube}.ts`, `server/content/visualPublication.dbtest.ts:156-165`. | **Agreed (Poteto fail-closed gate):** Fail closed by default for all owner-scoped calls when no `connected_accounts` row exists for that owner; allow env fallback ONLY under explicit opt-in (`ALLOW_ENV_CHANNEL_FALLBACK=1` with single-operator owner match) and prove isolation with a two-owner test. |

---

## 4. Continuous Implementation Loop Protocol (Phase 6)

For every engineering increment in `EXECUTION_ROADMAP.md`:

1. **Select** the highest-priority incomplete increment from `BACKLOG.md`.
2. **Design & Implement (Poteto mode):** Name data shapes first, write focused unit/integration tests, make minimal clean edits.
3. **Verify locally:** Run `npx tsc --noEmit`, `npm run test:unit`, targeted tests, and `npm run build` (plus `npm run test:db` where disposable Postgres is available). Record exact observed results — never infer pass status.
4. **Independent Review (Wayfinder):** Run a fresh Wayfinder review against the actual `git diff` and test output to verify acceptance criteria, security boundaries, and absence of scope creep.
5. **Resolve & Commit:** Fix any critical/high findings, update [`../STATUS.md`](../STATUS.md), [`../ACTIVE_WORK.md`](../ACTIVE_WORK.md), and [`../HANDOVER.md`](../HANDOVER.md), and commit on a branch from current `origin/main`. `work/productization-mvp` merged in pull request 7. Do not keep committing on it as if it were the open line.

## 5. Session rule (2026-11-28)

Before new work, run `script/agent-context.sh sync` and read [`../STATUS.md`](../STATUS.md) and [`../ACTIVE_WORK.md`](../ACTIVE_WORK.md). Before stopping, update those files and [`../HANDOVER.md`](../HANDOVER.md).

Wayfinder reviews claims against git, the diff, and Actions logs. Poteto mode makes the code and test changes. A review that only restates `STATUS.md` does not count. If the two disagree, write the evidence and the resolution into `DECISIONS.md`. Do not say they communicated unless a subagent call or a committed review record exists.

The register for other repositories is [`../PROJECTS_INDEX.md`](../PROJECTS_INDEX.md). Adopt it with [`../governance/ADOPT.md`](../governance/ADOPT.md). Do not edit a dirty tree in another repo from a ContentForge session.

On 2026-11-28 a fresh reviewer subagent checked the new status pages against `git` and Actions run 46132320299. The author then corrected the SHA wording, the sync warning sentence, the topic-escape note, and the Playwright and live-e2e counts. That is a recorded review, not a claim that the two roles talked in chat.
