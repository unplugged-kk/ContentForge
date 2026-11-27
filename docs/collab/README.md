# ContentForge agent collaboration

This is the shared starting point for Cursor, Claude, ChatGPT, Codex and any other agent with repository access. GitHub is the handoff: instructions, work, reviews, verification and decisions live in commits and pull requests (PRs). Chats do not notify agents automatically; each agent must fetch and read the shared documents.

## Where we are going

- **Original vision:** A personal content and X growth engine for an SRE, designed to take at most five minutes a day. See the original spec at docs/spec_contentforge_reimagined.md and the review brief at docs/COLLAB_BRIEF.md.
- **Current foundation:** A single-operator pipeline from discovery and sourced research through drafting, approval and distribution. Measure/Learn remain thin. Use docs/HANDOVER.md, CURRENT_ARCHITECTURE.md and docs/CAPABILITY_MATRIX.md for documented evidence; revalidate against the exact commit.
- **Current product recommendation:** Prove one source-backed technical post per week for a technical DevRel lead/technical creator, using public sources, human review and manual export. This is a hypothesis, not validated demand.
- **Current autonomous execution contract:** Read docs/collab/PRODUCTIZATION_GOAL.md. It defines the product goal, phase gates, safety boundaries, test requirements and continuous execution loop.
- **Current handoff state:** Read docs/collab/AGENT_SYNC.md before doing work or responding to a sync request.
- An approved Artifact is required for publication, but trusted automation can set approval without a person. Do not use that mode for the first pilot.

## Which branch to use

| Branch | What belongs there | How it gets reviewed |
|---|---|---|
| collab/ai-pair-review | This playbook, product brief, strategy reviews, autonomous goal and shared status. No application, migration or CI changes. | Keep reviewer reports distinct. Do not overwrite another review. |
| work/productization-mvp | The continuous productization implementation branch based on latest origin/main. | One coherent draft PR to main. Small conventional commits. Do not merge. |
| work/<task> | A separately scoped implementation task when it is independent of the long-running productization branch. | Draft PR to main, reviewed at exact head SHA. |
| main | Owner-approved product and engineering changes. | No direct agent pushes, force-pushes or merges. Owner decides when to merge. |

Explicitly select origin/main as the code base. Do not rely on origin/HEAD; older collaboration notes recorded it pointing at replit. Do not merge collab/ai-pair-review into a code branch just to read its instructions.

Before work, fetch origin, inspect git status, confirm branch/HEAD/upstream and record the SHA. Use a separate worktree per agent when possible. If unexpected changes or branch divergence exist, preserve them; do not reset, stash, clean or overwrite someone else's work.

For each PR, include goal/non-goals, changed paths, reviewed SHA, checks/results, checks not run, unresolved risks and next action. Never commit secrets, .env files, cookies, private customer material or generated output. Routine tests and reviews must not contact live publishing providers or billable models; use the repository's safe test scripts against disposable infrastructure.

## Next up

1. Read PRODUCTIZATION_GOAL.md and AGENT_SYNC.md.
2. Revalidate the repository, local checkout and all open PRs. The 2026-11-11 handover is a dated snapshot, not a current truth.
3. Inventory the actual local skills and subagents. The ChatGPT review could not inspect the local .agent/skills directory.
4. Audit divergent run56/run57/run58/run60 branches individually; port only justified, tested changes.
5. Start the highest-priority safe task from PRODUCTIZATION_BACKLOG.md. Initial priorities are CI unit/DB test gates, migration-generation integrity, secret-history hygiene, then the research-to-approved-export vertical slice.
6. Keep work on work/productization-mvp from latest origin/main. Maintain one draft PR, commit in small increments and do not merge/deploy.
7. Founder validation, real channel credentials, public publishing, paid provider use and customer private data remain gated owner actions. Record blockers in AGENT_SYNC.md and continue safe work.

## Sync protocol

When the owner or ChatGPT says **sync**:

1. Fetch origin and inspect working-tree/branch state.
2. Read the latest docs/collab/AGENT_SYNC.md, PRODUCTIZATION_STATUS.md, PRODUCTIZATION_GOAL.md and all new REVIEW_*.md files.
3. Reconcile findings against the exact code and tests. Mark each ACCEPTED, REJECTED, PARTIALLY_ACCEPTED or NEEDS_OWNER_ACTION with evidence.
4. Preserve reviewer reports. Write responses in AGENT_SYNC.md or a separate response document.
5. Commit and push the reconciliation, then continue with the highest-priority safe task.

Agents do not notify one another automatically. Git commits and PRs are the shared record. Do not assume a plain chat can fetch or push unless repository access is connected.
