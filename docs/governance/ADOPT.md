# Adopt this register in another repository

Use this when an agent opens a repo other than ContentForge. Keep that repo's architecture docs. Add the register beside them. Do not copy ContentForge's product description across.

## Before you edit

1. `git status` and `git worktree list`. If the tree is dirty, do not stage those files.
2. Read that repo's `AGENTS.md` or `CLAUDE.md` if it exists. Its safety rules win over this page when they conflict.
3. Create a branch from the remote default branch. Do not commit on `main`.

## Add only what is missing

| If the repo has | Do this |
|---|---|
| A status page that is still true | Add a row table as `ACTIVE_WORK.md` and link it from the status page. |
| No status page | Write a short `STATUS.md` from `git log -1`, `git status`, and the latest CI you actually opened. |
| An agents file | Add ten lines: run sync before work, update status and the register before you stop, and name the real file paths. |
| Nothing | Copy the headings from ContentForge `docs/ACTIVE_WORK.md` and fill only rows you verified. |

## Commands

Copy `script/agent-context.sh` and change the repo name and the doc paths if they differ. Wire `make status`, `make sync`, and `make handover` only when the Makefile is clean or the owner asked you to edit it.

## Rules

- One row per initiative. Status is one of: in progress, blocked, merged, deferred, inactive, not reconciled.
- Every row has a next action a person can do without asking what was meant.
- A merged pull request with red CI is "merged, CI red", not done.
- Do not mark another agent's work complete because a plan said it would be.
- Do not put secrets, tokens, or `.env` values in the register.
- Link to the other repo's docs. Do not paste them.
