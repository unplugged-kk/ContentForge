# ContentForge — Productization Status

> 2026-11-28. This page is the milestone log for `work/productization-mvp`. That branch merged to `origin/main` at `ae8ced2` in pull request 7. CI on that commit failed. Current truth is [`../STATUS.md`](../STATUS.md) and [`../ACTIVE_WORK.md`](../ACTIVE_WORK.md). The "not yet pushed" owner actions below are stale. Branch protection, a restore drill, xQuick terms, and the founder sessions are still owner actions.

**Last Updated:** 2026-11-27  
**Active Branch:** `work/productization-mvp` (11 commits ahead of `origin/main` @ `0dca9550d161d08a7ec82b34488ce4a022db81e0`; `main` untouched)  
**Collaboration Branch Read:** `origin/collab/ai-pair-review` @ `c569ca3e073797ed61d4cb94cf2966154d8128c9` (read via `git show`, not merged)  
**Current Milestone:** **M1 — Product Clarity COMPLETE · M2 — Technical Implementation COMPLETE (local unit/build/typecheck/drizzle verified; CI Actions, DB integration suite, live publishing & M3 user validation remain owner-gated)**

---

## Milestone Progress

| Milestone / Increment | Status | Commit | Wayfinder Review |
|---|---|---|---|
| **M1 — Phases 0–5 (Discovery, Collaboration, State, Q1–Q27, Strategy, Roadmap)** | **DONE** | `cda1221` | Jointly authored (2 cross-exam rounds) |
| **INC-01 — Hermetic DB-free unit suite + CI unit/DB jobs + migration-guard fix** | **DONE** | `bc2c1e4` | Wave 1: **PASS WITH MINOR NOTES** (findings resolved) |
| **INC-02 — Fail-closed owner credentials + `ALLOW_TRUSTED_AUTOMATION` + approval actor** | **DONE** | `c0d0eaf` | Wave 1: **PASS WITH MINOR NOTES** (findings resolved) |
| **INC-03 — Selective Tier-A safety ports from `origin/run60-schedule-must-be-future`** | **DONE** | `22618b5` | Wave 1: **PASS WITH MINOR NOTES** (3 of 4 Medium resolved in `5269b5c`) |
| **INC-04 — 5 vertical-slice UI fixes + Export Markdown / Copy Text / Copy Thread** | **DONE** | `0bfa154` | Wave 2: **PASS WITH MINOR NOTES** (all 3 Medium resolved in `9ad2e8c`) |
| **INC-05 — Settings X/xQuick/LinkedIn copy + truthful `site/{home,agent}.ts`** | **DONE** | `0bfa154` | Wave 2: **PASS WITH MINOR NOTES** (all 3 residual lines resolved in `9ad2e8c`) |
| **INC-06 — Source-attributed `draftSynthesis` + hybrid `story/synthesis.ts` + `StoryInput`** | **DONE** | `5269b5c`, `5aa5bf8` | Wave 3: **PASS WITH MINOR NOTES** (all 4 Medium resolved in `5aa5bf8`) |
| **INC-07 — `claim_evidence_v1` + `claimCheck.ts` + Golden Eval + Review Audit UI + Multi-format test** | **DONE** | `5269b5c`, `5aa5bf8` | Wave 3: **PASS WITH MINOR NOTES** (all 4 Medium resolved in `5aa5bf8`) |
| **INC-08 — Manual publish logging + Weekly cohort digest + Approved voice exemplars** | **DONE** | `9ad2e8c`, `1e0c5c2` | INC-08: **PASS WITH MINOR NOTES** (1 Medium + 2 Low resolved in `1e0c5c2`) |
| **INC-09 — Drizzle D8 snapshot chain repair (`migrations/meta/0017..0020` + `0035`)** | **DONE** | `ab81f35` | Final Acceptance: **PASS** (0 SQL bytes changed, 73/73 tables matched) |
| **INC-10 — Pilot Operations Runbook (`PILOT_RUNBOOK.md`) & Doc Reconciliation** | **DONE** | *(HEAD)* | Final Acceptance: **PASS WITH MINOR NOTES** |

---

## Fresh Verification Log (Observed Today on `work/productization-mvp`)

| Timestamp | Commit | Command | Measured Result | Environment |
|---|---|---|---|---|
| 2026-11-27 | `origin/main` (`0dca955`) | `npm run test:unit` (unset `DATABASE_URL`) | **FAIL** (baseline: 15+ files failed at `server/db.ts:6`) | Local hermetic shell |
| 2026-11-27 | `origin/main` (`0dca955`) | Local Git secret-pattern & `.env.orig-backup` pack audit | **PASS (local)** — 0 live keys, 0 reachable `.env*` objects | Local `.git` |
| 2026-11-27 | `bc2c1e4` | `npm run test:unit` (DB-free hermetic) | **PASS** (1,173 passed / 0 failed / 2 skipped) | Local hermetic shell |
| 2026-11-27 | `5269b5c` | `npx tsc --noEmit` · `npm run test:unit` · `npm run build` | **PASS** (1,263 passed / 0 failed / 2 skipped; build exit 0) | Local workspace |
| 2026-11-27 | `9ad2e8c` | `npx tsc --noEmit` · `npm run test:unit` · `npm run build` | **PASS** (1,280 passed / 0 failed / 2 skipped; build exit 0) | Local workspace |
| 2026-11-27 | `5aa5bf8` | `npx tsc --noEmit` · `npm run test:unit` · `npm run build` | **PASS** (1,287 passed / 0 failed / 2 skipped; build exit 0) | Local workspace |
| 2026-11-27 | `ab81f35` | `npx drizzle-kit check` & `npx drizzle-kit generate` (unchanged + temp column probe) | **PASS** (`Everything's fine`; `No schema changes`; single clean `ALTER TABLE` on probe; 0 bytes changed in `migrations/*.sql`) | Local workspace |
| 2026-11-27 | `ab81f35` | `npx tsc --noEmit` · `npm run test:unit` · `npm run build` | **PASS** (1,289 passed / 0 failed / 2 skipped across 338 suites; build exit 0) | Local workspace |

### Explicitly NOT Verified Locally (Honest Gaps)
- **`npm run test:db` (PostgreSQL integration suite):** Not executed locally because Docker socket (`/Users/kishore/.dory/dory.sock`) is blocked in the sandbox and no pre-authorized disposable test database was created against local `127.0.0.1:5432`. Wired into `.github/workflows/e2e.yml` (`db` job with ephemeral `postgres:16-alpine` + `db:migrate`) for CI execution upon push.
- **GitHub Actions workflow execution (`e2e.yml`, `migration-guard.yml`):** Not triggered remotely (`gh` CLI blocked by sandbox `403`, branch not yet pushed/PR'd).
- **Playwright E2E browser run (`e2e/*.spec.ts`):** Not executed against a live Postgres+app container in this session.
- **Live external publishing (X/xQuick, Threads, LinkedIn, Instagram, YouTube) & paid LLM synthesis (`STORY_LLM_SYNTHESIS=1`):** Deliberately NOT executed (forbidden without explicit owner authorization).
- **Backup/restore drill on a real VPS database dump:** Documented in `PILOT_RUNBOOK.md`; not executed against production.

---

## Owner-Only / Blocked Actions (Required Next Steps from Owner)

1. **Push branch & open Draft PR:** Push `work/productization-mvp` to `origin` and open a single Draft PR against `main` so GitHub Actions executes `Unit Tests`, `DB Integration Tests` (against ephemeral Postgres + `db:migrate`), `E2E Tests`, `Live E2E`, and `Schema/Migration Consistency`.
2. **Verify GitHub Repository Security & Branch Protection:** Confirm GitHub Secret Scanning + Push Protection are enabled on the public repo and mark `Unit Tests`, `DB Integration Tests`, and `Schema/Migration Consistency` as required branch-protection checks.
3. **Run local/CI `npm run test:db` and 1 VPS restore drill:** Confirm all DB integration tests pass against a disposable PostgreSQL instance (and inspect the one benign reverse-direction index `style_profiles_user_active_idx` noted in `DEC-12`), plus run one `make backup` → disposable restore drill before onboarding external pilots.
4. **Approve commercial channel terms (if enabling live X publishing):** Review `xquik.com` commercial terms vs. official X API v2 before enabling non-founder X keys.
5. **Run M3 Real-World Validation:** Execute the 5-session founder Export-First benchmark (`PILOT_RUNBOOK.md` §6), then recruit 3–5 external technical creators before making any commercial or PMF claims.
6. **Clean up untracked `site/postiz-*.ts` files (owner discretion):** 5 pre-existing untracked files (`site/postiz-{agent,home,layout,render,styles}.ts`) were deliberately preserved untouched per `docs/HANDOVER.md` §2.
