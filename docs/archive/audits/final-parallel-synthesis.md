# ContentForge — Final Parallel Synthesis

**Phase:** 8 (Coordinator Synthesis)
**Date:** 2026-09-26
**Inputs:** five parallel workers (§1) plus the coordinator's own verification
**Decision authority:** the coordinator. Nothing below was accepted because a worker recommended it.

---

## 1. Wave 1 results

| Worker | Branch | Mode | Outcome |
|---|---|---|---|
| 33.2 IA/UX/a11y | `phase-33.2-ia-ux-a11y` | read-only verify | 7 of 8 items VERIFIED, **1 GAP** |
| 33.3 visual/perf | `phase-33.3-visual-design-performance` | read-only verify | every claimed number reproduced; **6 genuine findings** |
| 33.4 test stability | `phase-33.4-test-stability` | writer | **incomplete** — hit turn limit with uncommitted, unverified work |
| 34 pre-audit | `phase-34-preaudit` | read-only | matrix delivered, ~110 findings registered |
| security | `phase-security-verification` | read-only | **SECURITY ISSUE REMAINS** — 2 gaps |

**The wave was worth running, and the most important result is a correction to the coordinator's own work.** The security verifier contradicted a claim I had already made to the captain. It was right and I was wrong (§2).

---

## 2. Decision table

| ID | Origin | Files | Problem | Evidence | Decision |
|---|---|---|---|---|---|
| **S1** | security | `.git` object DB | The coordinator reported the leaked `.env.orig-backup` blob as purged ("0 reachable objects"). **It was still in the pack at blob `a32bcae…`.** It survived every prune because the **integration worktree's git index still staged the path**, and git never prunes an object referenced by an index. `git fsck --unreachable` reported nothing because the object is packed, and my `rev-list --all --objects` check only covers *reachable* objects. | `git cat-file -e a32bcae…` → present; `--indexed-objects` → 1 | **ACCEPT.** Fixed by the coordinator (§3). |
| **S2** | security | `.gitignore` | Only the exact filename `.env` was ignored; `.env.*`, `*.env`, and backups were not. **This gap is the root cause of the entire incident.** | `git check-ignore` on `.env.orig-backup` → not ignored | **ACCEPT.** Fixed (§3). |
| **A1** | 33.3 | `pages/schedule.tsx:49-71` | Radix `Tabs` with **no `<TabsContent>`**, so every trigger's `aria-controls` points at a non-existent id → axe **`aria-valid-attr-value`, impact critical** on `/schedule`, both themes. | full-rule axe run | **ACCEPT** → remediation worker `fix-a`. |
| **A2** | 33.3 | `pages/queue.tsx:483` → `ui/alert.tsx:39` | `h1 → h5` heading skip on `/schedule`. | outline dump | **ACCEPT** → `fix-a`. |
| **A3** | 33.2 | `pages/today.tsx:98-111` | **The same publication is listed twice on `/today`** — once as a failure and once as an unknown outcome. The server stores unknown as `state:"failed"` + `outcome:"unknown"`; the failure read filters on state only and does not exclude unknown rows. | browser: `card-attention-failed-3` **and** `card-attention-unknown-3` for one id | **ACCEPT** → `fix-b`. |
| **A4** | 33.3 | `components/create/create-studio.tsx:432` | `h1 → h3` heading skip on `/create`. | outline dump | **ACCEPT** → `fix-b`. |
| **D1** | 33.3 | `docs/design-final-acceptance.md`, `docs/design-integration-gap-report.md` | **The coordinator's own documentation overstates two claims.** (a) "axe violations = 0" is true only for the **rule subset** the spec runs; the full rule set finds **6** violations (A1 above is one). (b) The "residual 49 literals / 45 sub-12px are dead routes + brand colours" rationale is only ~60% true — **19 literals and 17 sub-12px classes ship in live chunks** (`create-*`, `insights-*`, `x-post-preview-*`). | worker's own compile + chunk inspection | **ACCEPT the correction.** Documentation must be fixed to say "0 violations for the rules the spec runs", not "0 violations". The residual literals are **DEFER** (cosmetic, now honestly counted). |
| **D2** | 33.3 | `client/src/**` | Sub-24px targets (WCAG 2.5.8 AA): `/create` 7 chips @20px, `/sources` one 149×16, `/settings` 3 help links @16px. | measured | **DEFER.** Real but low-impact; the 44×44 coarse-pointer tier on the shell was already applied. Recorded, not fixed in this cycle. |
| **D3** | 33.3 | `--primary` as text | Reported as 3.68:1 light / 3.04:1 dark; the verifier could **only reproduce the dark failure** (light is 5.40:1). | re-measured | **ACCEPT the correction.** The light figure in the gap report is wrong; dark is the real defect, and the one confirmed site already uses `--info`. `--primary-text` stays **DEFER**. |
| **D4** | 33.3 | bundle | `/create` chunk 647 KB and `/insights` 497 KB exceed Vite's 500 KB warning. New information — not in the known-gaps list. | build output | **DEFER**, recorded as new debt. |
| **V1** | 33.2 | `lib/legacy-route-mapping.ts` | The brief and the coordinator's docs say **20** legacy paths; the file contains **18** and the unit test deep-equals 18. | unit test | **ACCEPT the correction.** Documentation count is wrong; nothing is missing. |
| **T1** | 33.4 | test harness | Pre-existing failures, portability, `DATABASE_URL` prerequisite, rate-limit contention, hardcoded ports. | baseline numbers | **ACCEPT** — continuation worker, with the requirement that the `rateLimit.ts` change be proven production-inert or reverted. |

---

## 3. Coordinator fixes applied directly

Three items crossed worker boundaries or were the coordinator's own error, so they were fixed in
`main` rather than delegated:

**(1) The leaked object is now genuinely gone.** The integration worktree's index was cleared
(`git rm --cached .env.orig-backup`), reflogs expired including unreachable, `repack -a -d
--unpack-unreachable=now`, then `prune --expire=now`.

Verified after: `git cat-file -e a32bcae…` → **absent**; reachable via
`--all --reflog --indexed-objects` → **0**; the leaked file's distinctive header text → **0
occurrences** in the entire object database; the live key prefix `sk-or-v1-` → **0 occurrences**.

**(2) `.gitignore` closed.** The family is ignored now, with templates re-included:
`.env`, `.env.*`, `*.env`, `*.env.local`, `*.env.*.local`, `!.env.example`, `!.env.*.example`.
Verified: `.env.orig-backup`, `.env.local`, `.env.production`, `backup.env` are ignored;
`.env.example` is **not** ignored and remains tracked.

**(3) The stray file on disk removed** (`cf-design/integration/.env.orig-backup`) so it cannot
recur.

Committed as `4320f47`.

**A note on why this was missed the first time.** I verified the purge with
`git rev-list --all --objects | grep` and `git fsck --unreachable`. Both are the natural checks
and both gave a clean answer — the first only sees *reachable* objects, and `fsck` does not
report packed unreachable objects. The conclusion was stated with more confidence than the
evidence supported. An independent verifier with a different method (hashing the actual file and
testing that specific object) found it immediately. That is the argument for independent
verification, not just more verification.

---

## 4. Accepted for integration

| Item | State |
|---|---|
| S1 leaked object purged | **already in `main`** (`4320f47`) |
| S2 `.gitignore` family | **already in `main`** (`4320f47`) |
| A1 `/schedule` dangling `aria-controls` | in flight (`fix-a`) |
| A2 `/schedule` heading skip | in flight (`fix-a`) |
| A3 `/today` duplicate listing | in flight (`fix-b`) |
| A4 `/create` heading skip | in flight (`fix-b`) |
| T1 test stability | in flight (33.4 continuation) |
| D1 documentation corrections | coordinator, after integration |

## 5. Rejected or deferred

| Item | Decision | Reason |
|---|---|---|
| Fix the 19 live-chunk literals and 17 sub-12px classes now | **DEFER** | Cosmetic; they render correctly. Counting them honestly is the required change, not fixing them. |
| Sub-24px targets (D2) | **DEFER** | Low impact; recorded. |
| `--primary-text` token (D3) | **DEFER** | Unchanged position; the one confirmed site is fixed. |
| `/create` + `/insights` chunk sizes (D4) | **DEFER** | New debt, needs its own decision. |
| Re-running 33.2/33.3 as implementation | **REJECTED** | Their content is already on `main`; verification was the correct action. |
| Any change to `server/**` production paths | **REJECTED** | The design landing changed 0 production server files; that must stay true. `rateLimit.ts` is the single exception and is gated on being provably E2E-only. |

---

## 6. Integration and sequencing

Files are disjoint across the three in-flight writers (`schedule.tsx`+`queue.tsx`;
`today.tsx`+`create-studio.tsx`; test/harness), so integration is a set of independent merges
with no conflict resolution required.

**Sequential and untouched by this wave:** integration, integrated verification, the credential
gate, pushing `main`, and the Phase 34 verdict.

---

*Feeds `docs/final-integration-gap-report.md` and `docs/final-design-landing-report.md`.*
