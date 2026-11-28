# ContentForge — Executable Productization Roadmap

**Date:** 2026-11-27  
**Branch:** `work/productization-mvp` (from `origin/main` @ `0dca955`)  
**Principle:** Small, verifiable increments. Zero migrations in Waves 1–3; D8 isolated in Wave 4. Every increment reviewed independently by Wayfinder before moving to the next.

---

## Wave 1 — P0 Engineering Gates, Security Isolation & Safety Floor

### INC-01: Hermetic Unit Suite + CI Unit/DB Gates + Migration Guard Fix
- **User value:** Prevents silent regressions across 1,072+ unit tests and 388+ DB tests.
- **Technical changes:**
  - Port `run44` (`24cb12f`) cleanly: add `server/testing/unitCredentialStub.ts`, make `server/testing/testIsolation.ts` gracefully decline `ECONNREFUSED` in unit runs, and wire a syntactically valid unroutable `DATABASE_URL` in `package.json` `test:unit` (preserving `hermeticEnv.ts` and `test-db-guard.ts`).
  - Add `unit` and `db` jobs (ephemeral Postgres + `db:migrate`) to `.github/workflows/e2e.yml`.
  - Fix `.github/workflows/migration-guard.yml` to detect untracked generated files via `git status --porcelain -- migrations`.
- **Dependencies:** None.
- **Risks:** Accidental DB purge if `test:db` points at non-disposable DB (mitigated by localhost/name guard).
- **Acceptance criteria & tests:** `npm run test:unit` passes with `DATABASE_URL` unset in the shell; `npx tsc --noEmit` passes; workflow YAML valid.
- **Owner actions:** Set required GitHub branch protection checks after draft PR review.
- **Complexity:** S.

### INC-02: Owner-Strict Credential Isolation + `trusted` Automation Lock + Security Hygiene
- **User value:** Eliminates cross-owner publishing leakage and guarantees human approval is never bypassed in pilot deployments.
- **Technical changes:**
  - Fail closed in `server/social/{x,threads,instagram,linkedin,youtube}.ts` when `ownerUserId != null` and no owner-scoped `connected_accounts` row exists, unless explicit `ALLOW_ENV_CHANNEL_FALLBACK=1` (with optional `SINGLE_OPERATOR_OWNER_ID` match) is set. Keep unscoped `getConnectedAccount(platform)` unavailable on authenticated owner paths.
  - Gate `approvalMode: "trusted"` and `publicationConfig.mode: "on_approval"` in `server/content/automation.ts` behind `ALLOW_TRUSTED_AUTOMATION=1` (default OFF → HTTP 403 / domain error).
  - Record approval actor (`"human"` vs `"automation_trusted"`) in approval learning signal payload (`server/content/artifact.ts`).
  - Add unit tests proving cross-owner fallback refusal and `trusted` rejection when flag is off.
- **Dependencies:** INC-01.
- **Risks:** Existing DB tests (`visualPublication.dbtest.ts`, `reconcile.dbtest.ts`) inject `XQUIK_API_KEY` directly — explicitly opt those fixture tests into `ALLOW_ENV_CHANNEL_FALLBACK=1` inside test setup only.
- **Acceptance criteria & tests:** Unit tests pass for all 5 social transports + `automation.test.ts` + `artifact.test.ts`.
- **Complexity:** M.

### INC-03: Selective Tier-A Safety Ports from `run60`
- **User value:** Prevents killed opportunities from minting artifacts, prevents silent mid-word 280-char X truncation, prevents partial-thread republish duplicates, and prevents past-dated schedules.
- **Technical changes:**
  - Port `7e4a6f8`: killed-opportunity guard in `server/content/artifact.ts` (+ tests).
  - Port `e8c01f4` (minus OCI scripts): `server/social/xTextLimits.ts`, `server/content/postStatus.ts`, pre-publish `validateXText` in `server/content/adapters.ts`, D23 draft-not-scheduled in `server/autopilot.ts`.
  - Port `75f4e99`: `server/content/unitFit.ts` (word-safe budget fitting) wired into canonical generation/thread utils & legacy writers (+ tests).
  - Port `5627fd9` + `8b62870` + `5cf7af6`: `partialPublish.ts`, row-level live-unit retry block (409), and full-row pass in `tryPublishPostById` (+ tests).
  - Port `897b935`: `server/content/scheduleTime.ts` & `server/content/postBody.ts` for future-only scheduling & ISO Date normalization (+ tests).
- **Dependencies:** INC-01, INC-02.
- **Risks:** Merge conflicts with `main` changes in `adapters.ts`, `x.ts`, `routes.ts` — port cleanly by inspection, never wholesale merge.
- **Acceptance criteria & tests:** All ported unit tests pass + full `npm run test:unit` + `npx tsc --noEmit`.
- **Complexity:** M.

---

## Wave 2 — Core Vertical Slice UI Unblock, Export-First & Truthful Surface (Zero Migrations)

### INC-04: Fix the 5 Broken Vertical-Slice UI Seams + First-Class Export/Copy UX
- **User value:** Users can reopen past research, see real source conflicts, keep provenance from Source → Create, edit `x_thread` revisions without corruption, and Copy/Export approved posts with citations without any channel credentials.
- **Technical changes:**
  - `client/src/pages/sources.tsx` + `discover-tab.tsx`: lift `selectedJobId`, pass `initialJobId` so clicking "View Findings" loads that job; fix direct-URL provider routing to always include `web`.
  - `discover-tab.tsx` + `source-detail-modal.tsx`: align conflict rendering to backend `ResearchConflict` (`{ topic, claims: [{ canonicalUrl, text, provider }] }`) and surface research summary/freshness/conflicts cleanly.
  - `discover-tab.tsx` + `create-studio.tsx`: pass `researchJobId` + `evidenceIds` from Source → Create so Story keeps `provenance: "researched"`.
  - `artifact-review-view.tsx`: fix `x_thread` editing to edit/save `{ units: string[] }` instead of corrupting with `{ text }`; add **Copy Text**, **Copy Numbered Thread**, and **Export Markdown (with Citations)** buttons with `data-testid`s.
  - Pure helper tests in `client/src/lib/` for thread export, Markdown citation export, and conflict matching.
- **Dependencies:** INC-01.
- **Acceptance criteria & tests:** Unit tests pass, `npx tsc --noEmit` & `npm run build` pass, no regressions to existing Playwright selectors.
- **Complexity:** M.

### INC-05: Truthful Settings Channel Onboarding & Marketing Site Copy
- **User value:** Eliminates misleading X Bearer Token / LinkedIn-shows-Threads instructions in Settings and aligns public landing pages with actual shipped capabilities.
- **Technical changes:**
  - `client/src/pages/settings.tsx`: replace `platform === "x"` binary ternary with typed `PLATFORM_CONNECT_CONFIG` map (`x` → xQuick API Key instructions, `threads` → `"Access Token"` keeping `e2e/settings-labels.e2e.spec.ts` green, `linkedin`, `instagram`, `youtube`).
  - `site/home.ts` & `site/agent.ts`: remove unbuilt quote card, visual QA, and per-topic/per-hook analytics claims; state human approval is enforced by default (and locked in pilot mode); preserve MCP "planned" wording (`server/site.test.ts`).
- **Dependencies:** INC-02.
- **Acceptance criteria & tests:** `server/site.test.ts` + full `npm run test:unit` + `npm run build` pass.
- **Complexity:** S.

---

## Wave 3 — Real Research Synthesis, Claim Grounding, Creator Notes & Learning Memory (Zero Migrations)

### INC-06: Structured Research Synthesis Brief + Co-Primary `StoryInput` (`first_hand` | `researched` | `hybrid`)
- **User value:** Transforms URL clipping into a readable brief (verified facts, source conflicts, open questions, candidate angles) and gives both DevRel leads and SRE founders a first-class way to supply their own proof points without fabrication.
- **Technical changes:**
  - Upgrade deterministic `draftSynthesis` (`server/research/intelligence.ts`) to carry titled excerpts, source attributions, and conflicts instead of bare URLs (stays Tier-4 deterministic).
  - Add `server/story/synthesis.ts` (`structuredStoryBriefSchema`, `synthesizeStructuredBrief`) with `safeJsonParse`, strict `evidenceId` intersection against real job evidence, and deterministic fallback.
  - Add `server/story/inputSchema.ts` (`StoryInput` union: `first_hand` | `researched` | `hybrid`) and update `server/content/policy.ts` grounding rules forbidding metrics/anecdotes outside `proofPoints` + `evidence`.
  - Expose optional "Your notes / proof points" input in `CreateStudio` and render the structured synthesis brief in `DiscoverTab`.
- **Dependencies:** INC-04.
- **Acceptance criteria & tests:** `server/story/synthesis.test.ts` (valid brief, fabricated ID rejection, malformed JSON fallback, prompt-injection resistance) + `server/story/inputSchema.test.ts` + `npm run test:unit`.
- **Complexity:** M.

### INC-07: Claim-to-Evidence Tracing (`claim_evidence_v1`), Paraphrase/Quality Audit & Review Drawer
- **User value:** Every factual claim and metric in a draft is traced to evidence or flagged `[UNVERIFIED]` right beside the editor before human approval.
- **Technical changes:**
  - Extend `attributionSchema` in `server/content/artifact.ts` with `claim_evidence_v1` (backward-compatible union alongside `research_evidence`).
  - Add deterministic `server/intelligence/quality/claimCheck.ts`: verifies returned `evidenceIds`, flags uncited numbers/percentages/dates not found in evidence or creator `proofPoints`, and computes source-paraphrase similarity (`paraphraseOverlap`) + cliché/hedging/length warnings.
  - Wire into `server/content/generation.ts` (and optional structured `{ payload, claims }` parsing in `server/content/model.ts` while remaining backward-compatible with bare `{ text }` / `{ units }`).
  - Render Evidence, Claim Audit badges, and Quality Warnings panel inside `ArtifactReviewView` (works even with Jev flags OFF).
  - Build a deterministic offline golden-set evaluation test (`server/intelligence/quality/goldenEval.test.ts`) covering strong posts vs. negative examples (hallucinated numbers, fabricated war stories, AI slop, over-limit threads, paraphrase-only copies).
- **Dependencies:** INC-06.
- **Acceptance criteria & tests:** Claim verification unit tests + golden-set eval suite + vertical-slice multi-format reuse test (X + Threads from one ResearchJob without re-research).
- **Complexity:** L.

### INC-08: Actionable Learning Loop — Manual Publish Log, Weekly Cohort Digest & Real Human-Edit Exemplars
- **User value:** Export-first users can log published URLs + metrics and get an honest weekly learning digest (channel × format × topic × hook, sample size, missingness), while approved human edits actively improve future voice quality.
- **Technical changes:**
  - Add `POST /api/artifacts/:id/log-manual-publish` (`server/content/routes.ts`) creating `Schedule` + `Publication` + `Result` (`source: "manual"`) for approved exported artifacts.
  - Add `server/content/learning/weeklyDigest.ts` computing comparable `(channel, format, topicTag, hookType)` cohorts with explicit `sampleSize`, `missingCount`, and non-causal experiment suggestion.
  - Upgrade `server/content/context.ts` (`MAX_TOTAL_CONTEXT_CHARS` 2000 → 3200) and `learningSummaryForContext` to inject 2–3 real approved `human_edit` exemplars (≤280 chars each) instead of raw `approval=4; edit=2` counts.
- **Dependencies:** INC-04, INC-07.
- **Acceptance criteria & tests:** Unit tests for weekly digest (missingness, small-sample caution, timezone boundaries, duplicate metrics) + context exemplar budget/ordering tests.
- **Complexity:** M.

---

## Wave 4 — Migration Generation Integrity (D8), Pilot Operations & Readiness

### INC-09: Repair Drizzle D8 Snapshot Integrity & Verify Fresh + Upgrade Paths
- **User value:** Restores trustworthy `npm run db:generate` so future schema changes are diff-checked automatically.
- **Technical changes:**
  - Diagnose exact Drizzle snapshot chain (`0000`–`0035`) in an isolated scratch test; repair duplicate `0016`–`0019` IDs and bring `migrations/meta/` into parity with `shared/schema.ts` @ `0035_auth0_subject` without altering applied migration tags/order.
  - Prove: (1) `db:generate` on unchanged schema produces zero diff/untracked files, (2) trivial column add produces exactly 1 migration, (3) `db:migrate` applies cleanly on a fresh DB.
- **Dependencies:** INC-01 (and disposable Postgres access).
- **Complexity:** M–L (timeboxed; isolated commit).

### INC-10: Pilot Operations, Onboarding & Founder Validation Pack
- **User value:** Any operator can onboard, run a demo dataset, back up/restore safely, and run a disciplined 5-session founder validation trial.
- **Technical changes:**
  - Document pilot onboarding checklist, backup/restore procedure, security/privacy/deletion notes, incident runbook, and 5-session founder validation scorecard (`docs/product-discovery/PILOT_RUNBOOK.md`).
  - Reconcile `docs/HANDOVER.md`, `docs/CAPABILITY_MATRIX.md`, and `docs/product-discovery/{STATUS,DECISIONS,BACKLOG}.md`.
- **Dependencies:** Waves 1–3.
- **Complexity:** S.
