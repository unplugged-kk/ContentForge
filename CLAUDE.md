# ContentForge — agent notes

The navigation rules for this repo live in **`AGENTS.md`**. Read it first.

Before any edit, run `script/agent-context.sh sync` and read `docs/STATUS.md` and `docs/ACTIVE_WORK.md`. Before you stop, update those two files and `docs/HANDOVER.md`.

- **`CURRENT_ARCHITECTURE.md`** is the authoritative architecture doc.
- **`docs/README.md`** indexes every other doc, tagged CURRENT or HISTORICAL.
- Use the **graft** graph tools before grepping
  (`graft ask "<q>" --source`, MCP `graft_find_code`).
- **code-review-graph** must be built once per clone
  (`build_or_update_graph_tool` then `embed_graph_tool`); it does not
  auto-update via hooks.
- Filenames are ambiguous here — always use repo-relative paths
  (`server/content/storage.ts`, not `storage.ts`).

`make graph` builds the graphs; `make orient` prints the repo map and doc index.
