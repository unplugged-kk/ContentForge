# ContentForge agent collaboration

This is the shared starting point for Cursor, Claude, ChatGPT, Codex, and any other agent with repository access. GitHub is the handoff: instructions live here; work, reviews, verification, and decisions live in commits and pull requests (PRs). A chat is not the record. Agents do not notify each other automatically; start a session on the same repository and point it at this file or the open PR.

## Where we are going

- **Original vision:** A personal content and X growth engine for an SRE, designed to take at most five minutes a day. See the [original spec](../spec_contentforge_reimagined.md) and [review brief](../COLLAB_BRIEF.md).
- **Today:** A single-operator, domain-agnostic pipeline from discovery and sourced research through drafting, approval and distribution. Feedback exists, but Measure and Learn are thin. Use the [handover](../HANDOVER.md), [architecture](../../CURRENT_ARCHITECTURE.md), and [capability matrix](../CAPABILITY_MATRIX.md) for evidence; check claims against the commit you're working on. An approved artifact is required to publish, but `trusted` automation can set that state without a person. Don't use it for the pilot.
- **Recommended next product bet, not a decision to build SaaS:** Test one source-backed technical post per week for a technical DevRel lead. Start with public sources, human review, and manual export; test draft quality, real time saved, paid renewal, and a repeat sale. Defer shared customer publishing, agent connectors, and billing automation until there is evidence for them. See the [independent ChatGPT review](REVIEW_ChatGPT.md).

## Which branch to use

| Branch | What belongs there | How it gets reviewed |
|---|---|---|
| `collab/ai-pair-review` | This playbook, product brief, independent strategy reviews, and agreed next priorities. No application, migration, or CI changes. | For new changes, use `review/<agent>-<topic>` from the latest collaboration branch and open a PR back to it. Each reviewer owns a distinct `docs/collab/REVIEW_<name>.md`; use a topic suffix if needed to avoid overwriting another review. |
| `work/<task>` | One implementation task per branch, based on the latest `origin/main`. | Open a draft PR to `main`. Review the PR's exact head SHA; put code findings in the PR, not in the collaboration branch. If a reviewer cannot post comments but can push, give it a separate `review/<agent>-<task>` branch from the collaboration branch and have it commit a note with the task PR URL and reviewed SHA. |
| `main` | Owner-approved product and engineering changes. | No direct agent pushes, force-pushes, or merges. The owner decides when to merge. `origin/HEAD` currently points to `replit`; explicitly select your base branch rather than relying on the clone default. |

Fetch `origin`, inspect `git status`, confirm the branch and record the SHA before work. Use a separate worktree or clone per agent when you can. If you find unexpected changes or branch divergence, preserve them and stop; don't reset, stash, or overwrite someone else's work. Don't merge the collaboration branch into a code branch just to read its instructions. Read them on GitHub or with `git show origin/collab/ai-pair-review:docs/collab/README.md` after fetching.

For each change, the PR description is the handoff: **goal and non-goals, changed paths, review SHA, checks and results, checks not run, unresolved risks, and the next action.** Put durable product decisions here or in a linked, committed review note. Never commit secrets, `.env` files, cookies, private customer material, or generated output. Never contact live publishing providers or billable models in review or routine testing; use the repo's safe test scripts against disposable infrastructure.

## Next up

1. **Cursor implementation: P0-1 test gates.** Check whether `origin/main` still lacks the unit and DB suites in CI and whether an existing open PR already covers this. If not, take `work/ci-test-gates` from `origin/main` and open a draft PR to `main`. Follow [handover §9](../HANDOVER.md#9-the-exact-next-task) and [ROADMAP P0-1](../ROADMAP.md): run the migrations and `npm run test:unit` / `npm run test:db` against a disposable Postgres service. Report a green run and evidence a failing assertion makes the check red (remove the failing assertion before review). Only the owner enables branch protection if needed. Keep migration generation (P0-2), site polish, and feature work out of this PR.
2. **Independent review: ChatGPT, Codex, or Claude reviews that PR at its head SHA.** Check isolation from production, migration setup, whether failed tests block CI, and what was actually verified. The implementing agent responds in the same PR. After owner approval and merge, link the evidence and record the next action there.
3. **In parallel, founder validation:** Try five source-to-approved-export sessions against the existing workflow. Record hands-on time, unsupported claims, rewrites, and whether the draft actually gets published. Then decide whether to offer the paid pilot described in [the review](REVIEW_ChatGPT.md). Keep customer details out of Git; record only a sanitized summary and the decision.

## Session instructions

Open `unplugged-kk/ContentForge`, select `collab/ai-pair-review` explicitly, and ask the agent to start with `docs/collab/README.md`. The rest of the prompt lives here:

- **Implement:** Follow the first unfinished engineering task in **Next up**, checking open PRs first. Read `AGENTS.md` and `docs/HANDOVER.md` on the implementation base. Keep the diff scoped. Push the task branch and open or update a draft PR to `main` with the handoff above. Do not merge.
- **Review a code PR:** Fetch the named PR head and base. Review the diff at the recorded SHA, starting with blocking findings and file/line references. Separate source inspection from any test you ran. Post on the PR or use the review-branch fallback above. Do not change the code under review.
- **Review product direction:** Read `docs/COLLAB_BRIEF.md` and follow its read order. Compare the existing reviews without replacing them. Write an independent note on `review/<agent>-<topic>` and open a PR to `collab/ai-pair-review`. Record the snapshot, evidence, and proposed decision.

If the agent cannot read the private repo, use a GitHub-connected or local coding session with access. If it can read but not write, switch to an authorized session to make a durable contribution. A plain chat without a connected repository cannot fetch or push. Grant only the access needed; no need to make the repo public or paste its contents into chat.
