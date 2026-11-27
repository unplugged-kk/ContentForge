# ContentForge — Agent Sync

**Last updated:** 2026-11-27  
**Current collaboration branch:** collab/ai-pair-review  
**Latest goal document:** PRODUCTIZATION_GOAL.md  
**Reviewed main baseline:** 0dca9550d161d08a7ec82b34488ce4a022db81e0  
**Goal document commit:** 05ab95a5795a35966915581e357ae228d59c170a

## ChatGPT review snapshot

### Observed repository facts
- GitHub reports default branch main at 0dca9550d161d08a7ec82b34488ce4a022db81e0, last main commit 2026-11-11.
- GitHub reports repository visibility public.
- collab/ai-pair-review is four commits ahead of main, zero behind; compared changes are documentation-only.
- No open PR was returned by repository PR search at review time; recheck before work.
- feat/copilotkit-agent-layer is 26 commits behind main and has no unique commits ahead in comparison.
- run56-intel-bridge, run57-idea-pool and run58-word-safe-unit-fit each diverge (12 ahead / 23 behind).
- run60-schedule-must-be-future diverges (13 ahead / 23 behind).
- Old run branches contain candidate work in post formatting, schedule validation, unit-fit, partial publishing/retry handling, analytics, pillar weights and autopilot. They require individual review; do not merge wholesale.

### Documented capability state (not freshly verified)
- Research providers/engine, evidence, Stories, Opportunities, generation, immutable Artifact revisions, approval, scheduling, publication lifecycle, adapters, results and learning primitives exist.
- Adapters for X, Threads, Instagram, LinkedIn and YouTube are documented; current live delivery for each is not verified here.
- Per-topic/per-hook learning and predicted-vs-actual joins are documented as missing.
- Agent Reach is inert/not dispatched.
- MCP client exists; MCP server does not.
- Jev has a decision ledger; runtime flag state in JEV_DECISION_MAP.md is a dated snapshot and must be rechecked.
- Trusted automation can approve without a person; pilot must use explicit human review/approval and disable trusted auto-approval.

### Verification state
- 2026-11-11 docs record 1,072 unit and 388 DB tests passing locally, TypeScript/build success and marketing routes returning 200.
- Full Playwright rerun was not cleanly verified in that pass.
- Current CI workflows run Playwright and a durable fixture/live-E2E harness, but do not invoke npm run test:unit or npm run test:db.
- Migration guard checks tracked diffs only and may miss untracked generated files; duplicate Drizzle snapshot IDs and db:generate reliability need safe reproduction.
- No current Actions run result was available to this review.
- Do not run unit/DB tests against any database with real connected accounts; the test guard may purge connected_accounts.

## Required next actions for the autonomous agent

1. Read docs/collab/README.md and PRODUCTIZATION_GOAL.md.
2. Revalidate the full current repository/working-tree/branch/PR state locally.
3. Audit local agent skill directories and installed skills. The ChatGPT review could not inspect the user's local .agent/skills tree.
4. Audit and disposition the divergent run56/run57/run58/run60 branches individually.
5. Audit public Git history for secrets without printing secret values.
6. Create/update PRODUCTIZATION_STATUS.md, PRODUCTIZATION_BACKLOG.md, PRODUCTIZATION_DECISIONS.md, PRODUCTIZATION_VERIFICATION.md and SKILL_INVENTORY.md.
7. Start the highest-priority safe engineering gate and continue through the goal's phases.
8. Keep application work on work/productization-mvp from latest origin/main; keep collaboration docs on collab/ai-pair-review.
9. Maintain one draft PR; do not merge or deploy.
10. Continue without routine owner questions. Record owner-only external actions under BLOCKED_OWNER_ACTIONS and proceed with safe work.

## BLOCKED_OWNER_ACTIONS

At snapshot time, no owner-only action has been requested. The following actions must remain gated if they become necessary:
- Real public X/Threads/LinkedIn/YouTube posts or replies.
- Paid provider/model/media calls outside existing approved budgets.
- Production credentials, OAuth console changes or account linking.
- Production database migrations, destructive data operations or deployments.
- Customer private data or shared customer account access.
- Legal/compliance decisions or changes to platform terms interpretation.
- GitHub branch protection changes and PR merge.

## Review reconciliation

| Finding | Disposition | Reason / next action |
|---|---|---|
| CI lacks unit and DB test jobs | ACCEPTED | Add isolated CI jobs using safe npm scripts and ephemeral Postgres. |
| Migration generation may be broken; guard may miss untracked files | ACCEPTED / REVALIDATE | Reproduce in scratch worktree; fix only with fresh-install and upgrade proof. |
| Research-to-content pipeline is substantial | ACCEPTED / REVALIDATE | Test end-to-end usefulness and claim provenance, not merely component existence. |
| Measure/Learn is weakest | ACCEPTED | Prioritise reliable metadata joins and useful weekly evidence-backed insight. |
| Build multi-tenant SaaS immediately | REJECTED FOR NOW | First prove a controlled single-operator/pilot workflow; no shared customer secrets/data until isolation is proven. |
| Build MCP, Agent Reach scraping, more channels and advanced media now | DEFERRED | Not required for first useful workflow; Agent Reach scraping has account/terms risk. |
| Enable all Jev flags | REJECTED | Validate one decision at a time against a labelled baseline with rollback. |
| Use old run branches as source of truth | REJECTED | They diverge from main; inspect and port individual changes only. |

## Agent update template

After each autonomous work session, replace/update the status sections above and include:

- Date and current branch/HEAD.
- Main baseline and draft PR URL.
- Tasks completed and commits.
- Tasks in progress and next task.
- CI run links and exact test totals.
- Review findings and dispositions.
- Skills/subagents used and why.
- BLOCKED_OWNER_ACTIONS (only actionable owner dependencies).
- Risks, NOT VERIFIED items and any regression.

Do not overwrite historical reviewer reports. Git commits and PRs are the handoff; agents do not notify each other automatically.
