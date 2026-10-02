# ContentForge — agent notes

The navigation rules for this repo live in **`AGENTS.md`**. Read it first:

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
