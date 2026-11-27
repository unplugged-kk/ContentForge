# ContentForge — Execution Backlog

**Updated:** 2026-11-27  
**Source:** `docs/product-discovery/EXECUTION_ROADMAP.md`

| ID | Wave | Title | Priority | Status | Depends On | Verification Target |
|---|---|---|---|---|---|---|
| **INC-01** | Wave 1 | Hermetic unit suite (no live DB) + CI `test:unit` & `test:db` jobs + `migration-guard.yml` untracked-file check | P0 | **NEXT** | — | `npm run test:unit` passes with unset `DATABASE_URL`; `npx tsc --noEmit`; CI workflow lint/validation |
| **INC-02** | Wave 1 | Owner-strict fail-closed social credentials + `ALLOW_TRUSTED_AUTOMATION` gate + approval actor recording | P0 | TODO | INC-01 | Unit tests for all 5 social transports + `automation.test.ts` + `artifact.test.ts` |
| **INC-03** | Wave 1 | Selective Tier-A safety ports from `run60` (`7e4a6f8`, `e8c01f4`, `75f4e99`, `5627fd9`–`5cf7af6`, `897b935`) | P0 | TODO | INC-01, INC-02 | All ported unit suites + `npm run test:unit` + `npx tsc --noEmit` |
| **INC-04** | Wave 2 | Fix 5 broken vertical-slice UI seams + Copy Text / Copy Thread / Export Markdown with Citations | P0 | TODO | INC-01 | Client lib unit tests + `npx tsc --noEmit` + `npm run build` |
| **INC-05** | Wave 2 | Fix Settings X/xQuick/LinkedIn onboarding copy + align `site/home.ts` & `site/agent.ts` with shipped reality | P1 | TODO | INC-02 | `server/site.test.ts` + `npm run test:unit` + `npm run build` |
| **INC-06** | Wave 3 | Upgrade deterministic `draftSynthesis` + hybrid `server/story/synthesis.ts` + co-primary `StoryInput` (`first_hand`/`researched`/`hybrid`) | P1 | TODO | INC-04 | `server/story/synthesis.test.ts` + `inputSchema.test.ts` + `policy.test.ts` |
| **INC-07** | Wave 3 | `claim_evidence_v1` in `artifacts.attribution` + deterministic claim/number/paraphrase check + Review Audit drawer + Golden Eval suite + Multi-format reuse test | P1 | TODO | INC-06 | `claimCheck.test.ts` + `goldenEval.test.ts` + `artifactAttribution.test.ts` + `npm run build` |
| **INC-08** | Wave 3 | Manual publish logging (`POST /api/artifacts/:id/log-manual-publish`) + Weekly cohort digest (`weeklyDigest.ts`) + real approved human-edit exemplars in `assembleContext` | P1 | TODO | INC-04, INC-07 | `weeklyDigest.test.ts` + `context.test.ts` + `npm run test:unit` |
| **INC-09** | Wave 4 | Repair Drizzle D8 snapshot chain (`migrations/meta/`) & verify `db:generate` + fresh/upgrade `db:migrate` | P0/P1 | TODO | INC-01 | `npm run db:generate` empty diff + trivial column test + fresh DB migrate |
| **INC-10** | Wave 4 | Pilot onboarding, backup/restore, security/privacy runbook & 5-session founder validation scorecard (`PILOT_RUNBOOK.md`) | P1 | TODO | INC-01..08 | Doc reconciliation + full final verification pass |

---

## Explicitly Deferred (Do Not Pull Into M2)

- `P1-1`: Enabling Jev flags (`JEV_RESEARCH_GATE`, `JEV_OPPORTUNITY_SCORE`, `JEV_CONTENT_STRATEGY`, `JEV_CONTENT_GATE`) — awaits M2 golden dataset.
- `P1-2`: Legacy shadow cut-over (JC-01/02/03) — awaits human-labelled dataset.
- `P1-3`: MCP Server over 29 tools — deferred until external assistant demand is validated.
- `P2-1`..`P3-4`: Opportunity Radar, Competitor Intel, Quote Cards/Infographics, Facebook/Newsletter/Blog adapters, Autonomous Calendar, Multi-tenant SaaS/Billing.
- `run56-intel-bridge`, `run57-idea-pool`, `f421c23`, `70583fa` — founder-specific/legacy autopilot code.
