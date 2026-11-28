# ContentForge — Reconstructed Actual Product State

> 2026-11-28. Baseline audit of `origin/main` at `0dca955`, before pull request 7. Rows that say Missing or Unsafe were the input to productization. Many of those rows are what INC-01 through INC-10 and `341ef67` claim to have changed. Do not treat this file as the current product. See [`../STATUS.md`](../STATUS.md).

**Date:** 2026-11-27  
**Baseline Audited:** `origin/main` @ `0dca9550d161d08a7ec82b34488ce4a022db81e0`  
**Audit Method:** Direct code inspection by Wayfinder (`a349d42b-b4fd-4e81-9608-066701151677`) and Poteto mode (`06a2e6f4-c012-4cbb-89ac-1b14ddace8e0`), plus fresh local execution of `npx tsc --noEmit` and `npm run test:unit`.

> **Truthfulness rule:** Historical 2026-11-11 test numbers (1,072 unit / 388 DB) are **not** treated as current verification. Fresh checks performed today: `npx tsc --noEmit` **PASS (exit 0)**; `npm run test:unit` (clean shell without `DATABASE_URL`) **FAIL (15+ files crash on `server/db.ts:6`)**.

---

## 1. Capability Classification Matrix

Allowed classifications: **Verified working** · **Implemented but not verified end to end** · **Partially implemented** · **Documented only** · **Disabled or shadow mode** · **Missing** · **Unsafe or unreliable**.

### A. Product & User Experience

| Capability | Classification | Code Evidence | Concrete Gap / Defect |
|---|---|---|---|
| Canonical navigation shell (`/today`, `/create`, `/sources`, `/agent`, `/schedule`, `/insights`, `/settings`) | Implemented but not verified end to end | `client/src/App.tsx:149-180` | Competes with 19 legacy compatibility redirects, 9 `/create` modes (`create.tsx:33-44`), 7 `/sources` views (`sources.tsx:104-236`), and a 1,980-line `learning-view.tsx`. |
| Reopen past Research Job in Discover | **Unsafe or unreliable** (broken) | `client/src/pages/sources.tsx:242`, `research-tab.tsx:151` | `SourcesPage` drops `jobId` in `<ResearchTab onSelectJob={() => setActiveView("discover")} />`. |
| Source conflict display in UI | **Unsafe or unreliable** (broken) | `discover-tab.tsx:474,522`, `source-detail-modal.tsx:136` vs `server/research/intelligence.ts:378-383` | Frontend reads `sourceUrlA`/`claimA` while backend emits `claims[].canonicalUrl`/`claims[].text`. Conflict badges never render. |
| Source → Create provenance handoff | **Unsafe or unreliable** (broken) | `discover-tab.tsx:493-495` → `create-studio.tsx:174-184` | Clicking "Create Content" from a source card creates a `provenance: "human"` story with `researchJobId: null` and empty `evidenceRefs`. |
| `x_thread` inline revision editing | **Unsafe or unreliable** (broken) | `artifact-review-view.tsx:150-154` vs `payloadSchemas.ts:176-178` | Edits write `{ ...payload, text: draftText }` instead of `{ units: string[] }`, corrupting or failing thread updates. |
| Approved Artifact Copy / Export (without channel credentials) | **Missing** | `artifact-review-view.tsx:610-649`, `server/content/routes.ts` | Only `Publish Now`, `Schedule`, and `Create another version` exist. No Copy Text, Copy Thread, or Export Markdown with Citations. |
| Channel connect onboarding UX in Settings | **Unsafe or unreliable** | `client/src/pages/settings.tsx:420-424,695-711` | Connect modal asks for X Developer Portal Bearer Token (adapter actually uses xQuick) and shows Meta Threads instructions for LinkedIn. |
| Public marketing site accuracy | **Unsafe or unreliable** (drifted copy) | `site/home.ts:20,144,239,259`, `site/agent.ts:50,77,152` | Claims unbuilt quote cards, visual QA, per-topic/per-hook analytics, and unconditional human approval (omitting `trusted` auto-approval). |

### B. Research Intelligence

| Capability | Classification | Code Evidence | Concrete Gap / Defect |
|---|---|---|---|
| Multi-provider fan-out (`rss`, `reddit`, `hn`, `web`, `youtube` metadata, `video` transcripts) | Implemented but not verified end to end | `server/research/engine.ts:246-418`, `server/research/providers/*` | Solid backend foundation; `last30days` is opt-in (`LAST30DAYS_ENABLED=1`). |
| Dedupe, time-window filter, provenance metadata, freshness, access-class allowlist | Implemented but not verified end to end | `server/research/engine.ts:318-418`, `server/research/intelligence.ts:448-536` | Backend computes `freshnessLabel`, `sourceClass`, `clusters`, `novelty`, but `DiscoverTab` renders almost none of `/analysis`. |
| Evidence extraction (`deriveEvidence`) | Partially implemented | `server/research/engine-core.ts:133-222` | Mechanical 400-char window clipping (`kind: "excerpt"`), up to 4 per source; sufficient as raw excerpt anchors, not structured claims. |
| Readable research synthesis (facts vs opinions vs inference vs open questions) | **Partially implemented** (stub) | `server/research/intelligence.ts:538-560`, `server/content/automation.ts:947-966` | `draftSynthesis` outputs bare `"provider: canonicalUrl"` strings + 1-line boilerplate; `synthesizeStory` glues 5 raw excerpts. |
| Jev `research_triage` & `research_depth` gates | Disabled or shadow mode | `server/decision/policies.ts:151-161` | Default OFF; zero labelled golden sets exist. |
| Agent Reach | **Documented only** | `server/research/routes.ts:259-265` | Hardcoded inert record (`available: false`); never registered or dispatched; scraping banned for account safety. |

### C. Creator Intelligence

| Capability | Classification | Code Evidence | Concrete Gap / Defect |
|---|---|---|---|
| Profile, favorite vault notes, style profiles context assembly | Implemented but not verified end to end | `server/content/context.ts:232-342` | Bounded to 2,000 chars total (`MAX_CHARS_PER_SOURCE = 500`), prefixed with `DATA, not instructions`. |
| Personal expertise profile (`buildExpertiseProfile`) | Partially implemented | `server/intelligence/expertise/profile.ts:103-136` | Token-frequency bag over `user_profile` + published titles; only wired to flag-off Jev strategy decision. |
| First-hand creator notes / war-story proof points alongside research | **Missing** | `create-studio.tsx:461-469`, `discover-tab.tsx:166-179` | Backend supports `authorStatement` (`engine.ts:394-396`) and `provenance: "human"`, but UI exposes no structured creator-notes / proof-points input. |
| Voice learning from approved human edits | **Missing** | `server/content/learning/summary.ts:178-201` | Edits only increment signal counts (`approval=4; edit=2`), never feeding real edited exemplars into generation context. |

### D. Content Creation & Quality

| Capability | Classification | Code Evidence | Concrete Gap / Defect |
|---|---|---|---|
| Story → Opportunity → frozen GenerationPolicy → immutable Artifact revisions | Implemented but not verified end to end | `server/story/service.ts`, `server/content/{opportunity,policy,generation,artifact}.ts`, `migrations/0007_dusty_preak.sql` | Strong core state machine; immutable trigger enforces revision lineage. |
| Killed Opportunity check at `createArtifact` boundary | **Unsafe or unreliable** | `server/content/artifact.ts:120-252` | Checked in `generation.ts:225` but bypassed by direct `createArtifact` on `origin/main` (fixed on divergent `run48` `7e4a6f8`). |
| Lexical quality signals & `quality_gate` | Disabled or shadow mode | `server/intelligence/quality/signals.ts:155-218`, `server/content/qualityGate.ts:110-113` | Checks cliché regexes, hedging, repetition, length only; flag OFF; never rendered in `ArtifactReviewView`. |
| Claim-to-evidence tracing & unsupported claim warnings | **Missing** | `server/content/generation.ts:368-377`, `server/content/model.ts:23-27`, `artifact-review-view.tsx` | All job `evidenceIds` are dumped flat onto `artifact.attribution`; zero per-claim mapping or hallucination/uncited-number checks. |
| Word-safe X unit fitting & pre-publish X length validation | **Missing** (on `main`) | `server/content/adapters.ts:322-395`, `server/routes.ts` | Silent mid-word `slice(0, 280)` truncation exists on `main`; fixed only on divergent `run58`/`run60` (`e8c01f4`, `75f4e99`). |

### E. Distribution & Publishing Safety

| Capability | Classification | Code Evidence | Concrete Gap / Defect |
|---|---|---|---|
| Approval state machine (`draft → in_review → approved|rejected`), single-flight leases, `providerCalled` no-blind-retry, `unknown` reconciliation | Implemented but not verified end to end | `server/content/artifact.ts`, `server/content/publication.ts:148-327` | Hard execution invariants enforced in code. |
| Trusted unattended auto-approval (`settleTrustedArtifact`) | Implemented but not verified end to end | `server/content/automation.ts:1155-1252` | Defaults to `approval_required` + `none`, but callers can still enable `trusted` without an operator kill-switch, and `approvedBy` actor is not persisted on `artifacts`. |
| X / Threads / LinkedIn / Instagram / YouTube adapters | Implemented but not verified end to end | `server/content/adapters.ts`, `server/social/{x,threads,instagram,linkedin,youtube}.ts` | Live delivery **NOT VERIFIED**. X delegates to third-party **xQuick** (`server/social/x.ts:108-143`); commercial terms unverified. |
| Partial-thread record & duplicate-retry block on legacy X path | **Missing** (on `main`) | `server/social/x.ts:488-535` | Fixed only on divergent `run50`–`run52` (`5627fd9`, `8b62870`, `5cf7af6`). |
| Multi-owner credential isolation | **Unsafe or unreliable** | `server/storage.ts:661-664`, `server/social/{x,threads,instagram,linkedin,youtube}.ts` | All 5 social transports retain unscoped `getConnectedAccount(platform)` + deployment env token fallbacks, allowing User #2 to silently inherit founder credentials. |

### F. Measurement & Learning

| Capability | Classification | Code Evidence | Concrete Gap / Defect |
|---|---|---|---|
| `performance_signals` with explicit `observed` vs `not_available` missingness | Implemented but not verified end to end | `server/content/learning/refresh.ts:65-160`, `server/decision/outcomes.ts:41-52` | Strong honest-missingness foundation. |
| Channel × format observations/proposals & explicit metric ingestion API | Implemented but not verified end to end | `server/content/learning/proposals.ts:90-240`, `server/content/learning/routes.ts:136-165` | `POST /api/learning/publications/:id/observations` already exists, but no manual publish-URL logger exists for exported artifacts. |
| Per-topic / per-hook aggregation & weekly editorial digest | **Missing** | `server/content/learning/summary.ts:129-201` | Aggregates only by channel, format, and `storyId`. |
| `viral_scores` predicted-vs-actual join & upstream Jev outcome attachment | **Missing** / **Partially implemented** | `server/decision/outcomes.ts:69` | `viral_scores` never joined; `attachPublicationOutcome` only matches rows carrying `publicationId`. |

### G. Engineering, CI & Security

| Capability | Classification | Code Evidence | Concrete Gap / Defect |
|---|---|---|---|
| TypeScript compilation (`npx tsc --noEmit`) | **Verified working** | Executed 2026-11-27 on `0dca955` | Exit 0, zero diagnostics. |
| Hermetic `npm run test:unit` without live Postgres | **Unsafe or unreliable** | Executed 2026-11-27 on `0dca955`; `server/db.ts:6` | Fails on 15+ files when `DATABASE_URL` is unset; `testIsolation.ts` throws on `ECONNREFUSED`. |
| CI gating for `test:unit` and `test:db` | **Missing** | `.github/workflows/e2e.yml`, `.github/workflows/migration-guard.yml` | Neither workflow invokes `npm run test:unit` or `npm run test:db`. |
| Drizzle migration generation & drift guard (D8) | **Unsafe or unreliable** | `migrations/meta/_journal.json` (36 entries) vs 21 snapshots (`0016`–`0019` duplicate id `7b2d1e7c`, missing `0002` & `0022`–`0035`); `migration-guard.yml:32` | `git diff --quiet -- migrations` misses new untracked SQL files; `db:generate` broken. |
| HTTP Auth gate, CSRF, Helmet CSP, Rate limits, Fail-closed `requireOwnerId` | **Verified working** (static code audit) | `server/middleware/{authGate,csrf,rateLimit,security,userContext}.ts` | Solid HTTP perimeter. |
| SSRF & prompt-injection boundaries | Partially implemented | `server/security/ssrf.ts`, `server/content/policy.ts:408`, `server/routes.ts:1044,1075,1482,1505,2904,2973` | Core `web.ts` and `/api/vault/extract-url` use `ssrf.ts`; legacy GitHub/ArXiv/oEmbed/ingest routes still use raw `fetch` or lack data delimiters. |
| Token encryption at rest & public Git secret hygiene | Partially implemented | `server/middleware/crypto.ts:49-91`, git history scan 2026-11-27 | AES-256-GCM active; falls back to `scrypt(SESSION_SECRET)` if `ENCRYPTION_KEY` missing. Local `.git` has 0 tracked secret patterns and `.env.orig-backup` pack objects are gone; remote GitHub secret scanning not independently verified. |
