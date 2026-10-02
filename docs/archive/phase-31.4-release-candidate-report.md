# Phase 31.4 — Release Candidate Report

**Branch:** `main` · **Decision:** RELEASE CANDIDATE READY

## Repository State

`main`, clean tree. No feature branches required; no untracked production
artifacts (only `.commandcode/`, `.gemini/` tooling dirs). No history
rewrites, no force pushes at any phase.

## Checkpoint Chain

| Checkpoint | Commit | Status |
|---|---|---|
| 29.x architecture (policy/autonomy core) | `94ddeaf` → `9c67f65` | IMPLEMENTED + deep-audited |
| 29.5 UX | `e66630b` | READY FOR GATE |
| 30 readiness | `04af0d3` + `3611a99` | GO WITH MITIGATIONS |
| 30.1 auth remediation | `6abc12c` | BLOCKER FIXED |
| 30.2 re-gate | (+ `3ec6f77` CI env) | GO WITH MITIGATIONS |
| 30.3 post-merge UX | `a62cc19` | UX READY |
| main established | `ee4eb62` → `341c3bc` | byte-identical checkpoint |
| 31 scheduler | `4692675` | IMPLEMENTED |
| 31.1 scheduler audit | `f4d635e` | SCHEDULER READY |
| 31.2 post-scheduler UX | `578849c` | UX READY |
| 31.3 soak | (this release) | SOAK PASSED |

## Documentation Consistency

- `docs/STATUS.md`: header corrected (canonical `main`, PR #3 superseded);
  release-line block added; 1500+ lines of Phase-B history preserved intact.
- 29.4 doc's "scheduler DEFERRED" line is historical record (true then);
  superseded by Phase 31 docs, not edited.
- `.env.example`: documents fail-closed `SESSION_SECRET` requirement.
- All phase reports match implementation (verified by diff-scoped audits;
  no code changed under any report after its verification except
  additive, separately-verified steps).

## Configuration

Production config matches reality: `DATABASE_URL` (fail-closed),
`SESSION_SECRET` (fail-closed, CI + Railway documented),
`ENCRYPTION_KEY` (recommended stable), provider keys optional/degrading,
`DISABLE_CRON` / `DISABLE_AUTONOMY_SCHEDULER` kill-switches documented.
No secrets in repo (scanned 30.0, unchanged since). Railway healthcheck →
`/api/ready`; Dockerfile `HEALTHCHECK` present.

## Build

Final: `tsc` clean, `build` clean, production boot → `/api/ready` 200 +
`/api/health` ok (this phase, fresh boot).

## Tests

Code tree unchanged since Phase 31.1 verification (docs/config-only diffs
after), so results transfer with provenance: unit 740/741 (1 macOS env
skip), DB 346/347 + flake-rerun 9/9, scheduler 10/10 + 23/23, api E2E
37+1skip, CI browsers 231/1-quarantined/3, live batteries green, soak
14-completed/5-activations/DLQ-1 green. No hidden quarantines beyond the
documented Journey E + lease-flake records.

## Known Non-Blocking Issues

R1a/R1b single-tenant posture, M2 polling alerts, M3 platform RPO/RTO, Q1
Journey E harness isolation, UX-32/34/40/41 debt, hourly key granularity,
no scheduler-driven rollback, vendor-default pg-boss retention. All
previously accepted with triggers; none grew teeth in any re-gate.

## Superseded Branch/PR Status

PR #3 (`status-report → replit`, stale Phase-3..22 docs): superseded by
`main`; closed without merge in this phase (reversible, non-destructive).
`replit` retained as history; `main` is canonical. Default-branch pointer
(`origin/HEAD → origin/replit`) left for the owner to flip with deploy
wiring (`deploy.yml` currently triggers on `replit`).

## Release Candidate State

**RELEASE CANDIDATE READY.** Clean, reproducible, documented `main` HEAD.
Nothing new added in this phase (docs/config only). Ready for the final
independent audit (Phase 32).
