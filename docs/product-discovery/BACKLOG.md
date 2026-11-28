# ContentForge — Execution Backlog

**Updated:** 2026-11-27  
**Branch:** `work/productization-mvp`  
**Source:** `docs/product-discovery/EXECUTION_ROADMAP.md`

| ID | Wave | Title | Priority | Status | Commit(s) | Verification |
|---|---|---|---|---|---|---|
| **INC-01** | Wave 1 | Hermetic unit suite (no live DB) + CI `test:unit` & `test:db` jobs + `migration-guard.yml` untracked-file check | P0 | **DONE** | `bc2c1e4` | `npm run test:unit` DB-free PASS; `tsc` PASS; CI workflow jobs added (remote CI run pending push) |
| **INC-02** | Wave 1 | Owner-strict fail-closed social credentials + `ALLOW_TRUSTED_AUTOMATION` gate + approval actor recording | P0 | **DONE** | `c0d0eaf` | `envFallback.test.ts` + all 5 social transports + `automation.test.ts` + `artifact.test.ts` PASS |
| **INC-03** | Wave 1 | Selective Tier-A safety ports from `run60` (`7e4a6f8`, `e8c01f4`, `75f4e99`, `5627fd9`–`5cf7af6`, `897b935`) | P0 | **DONE** | `22618b5`, `5269b5c` | `unitFit.test.ts`, `adapters.xLength.test.ts`, `scheduleTime.test.ts`, `partialPublish.test.ts`, `draftOnly.census.test.ts` PASS |
| **INC-04** | Wave 2 | Fix 5 broken vertical-slice UI seams + Copy Text / Copy Thread / Export Markdown with `/sources` Citations | P0 | **DONE** | `0bfa154`, `9ad2e8c`, `5aa5bf8` | `artifact-export.test.ts` PASS; `tsc` PASS; `npm run build` PASS |
| **INC-05** | Wave 2 | Fix Settings X/xQuick/LinkedIn onboarding copy + align `site/home.ts` & `site/agent.ts` with shipped reality | P1 | **DONE** | `0bfa154`, `9ad2e8c` | `server/site.test.ts` PASS; `npm run build` PASS |
| **INC-06** | Wave 3 | Upgrade deterministic `draftSynthesis` + hybrid `server/story/synthesis.ts` + co-primary `StoryInput` (`first_hand`/`researched`/`hybrid`) wired to `POST /api/stories`, `POST /api/stories/synthesize-brief`, and automation | P1 | **DONE** | `5269b5c`, `5aa5bf8` | `synthesis.test.ts`, `inputSchema.test.ts`, `story/routes.test.ts`, `automation.test.ts` PASS |
| **INC-07** | Wave 3 | `claim_evidence_v1` in `artifacts.attribution` + deterministic claim/number/first-person/paraphrase check + Review Audit drawer + Golden Eval suite + Multi-format reuse test | P1 | **DONE** | `5269b5c`, `5aa5bf8` | `claimCheck.test.ts`, `goldenEval.test.ts`, `verticalSliceMultiFormat.test.ts` PASS |
| **INC-08** | Wave 3 | Manual publish logging (`POST /api/artifacts/:id/log-manual-publish`) + scheduler `manual:` guard + Weekly cohort digest (`weeklyDigest.ts`) + real approved human-edit exemplars in `assembleContext` | P1 | **DONE** | `9ad2e8c`, `1e0c5c2` | `manualPublish.test.ts`, `weeklyDigest.test.ts`, `context.test.ts` PASS |
| **INC-09** | Wave 4 | Repair Drizzle D8 snapshot chain (`migrations/meta/0017..0020` + `0035_snapshot.json`) without altering applied SQL | P0/P1 | **DONE** | `ab81f35` | `drizzle-kit check` PASS; `drizzle-kit generate` 0-diff + temp-column probe PASS; 0 SQL files touched (disposable DB `db:migrate` verified in CI upon push) |
| **INC-10** | Wave 4 | Pilot onboarding, backup/restore, security/privacy runbook & 5-session founder validation scorecard (`PILOT_RUNBOOK.md`) + doc reconciliation | P1 | **DONE** | *(final doc commit)* | Reconciled with `LOCAL_VPS_DEPLOYMENT.md`, `DOGFOODING.md`, `STATUS.md`, `DECISIONS.md` |

---

## Remaining Follow-Ups (updated 2026-11-28)

Items 2 through 6 below were claimed done in `341ef67`. That commit message is the evidence. They were not re-tested in the governance session. Item 1 ran on the merge and failed. See [`../BUGS.md`](../BUGS.md).

1. **CI on `origin/main`:** Actions run 46132320299 failed Unit Tests, DB Integration Tests, E2E Tests, and Live E2E. Migration Guard run 46132320278 succeeded. This is workstream CF-CI, not "waiting for a push".
2. **Legacy `userId: null` schedule binding:** `341ef67` says it binds those rows to the authenticated owner on `POST /api/schedules`, with `schedulingOwnership.test.ts`.
3. **Human-edit revision re-audit:** `341ef67` says `createHumanEditRevision` re-runs `auditArtifactClaims`.
4. **Gateway `{ payload, claims }` hint:** `341ef67` says the prompt asks for that shape when research evidence is supplied, and `unwrapModelOutput` stays compatible.
5. **Per-user offboarding:** `341ef67` adds `server/user/offboard.ts` and `script/offboard-user.ts`, dry-run by default. A production restore drill is still an owner action.
6. **`style_profiles_user_active_idx`:** `341ef67` says it is declared in `shared/schema.ts` and `0035_snapshot.json` with no change to applied SQL.

---

## Explicitly Deferred (Do Not Pull Into M2)

- `P1-1`: Enabling Jev flags (`JEV_RESEARCH_GATE`, `JEV_OPPORTUNITY_SCORE`, `JEV_CONTENT_STRATEGY`, `JEV_CONTENT_GATE`) — awaits M2/M3 golden dataset.
- `P1-2`: Legacy shadow cut-over (JC-01/02/03) — awaits human-labelled dataset.
- `P1-3`: MCP Server over 29 tools — deferred until external assistant demand is validated.
- `P2-1`..`P3-4`: Opportunity Radar, Competitor Intel, Quote Cards/Infographics, Facebook/Newsletter/Blog adapters, Autonomous Calendar, Multi-tenant SaaS/Billing.
- `run56-intel-bridge`, `run57-idea-pool`, `f421c23`, `70583fa` — founder-specific/legacy autopilot code.
