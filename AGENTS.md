# Working in ContentForge

Navigation rules for coding agents. Keep this file short — it is injected into
every session, so every line here costs tokens.

## Read these first

- **`CURRENT_ARCHITECTURE.md`** — the authoritative architecture doc (dated,
  "as built, not as documented"). Read it before any architecture question.
- **`docs/README.md`** — the index of every other doc, each tagged `CURRENT`
  or `HISTORICAL`. Anything tagged HISTORICAL describes a past phase and may
  contradict the code. Do not treat it as current.
- **`docs/archive/`** — frozen history (pre-June plans, phase reports). Open
  only to answer "what did we do in phase N".

## Use the graph before grepping

This repo is indexed. Prefer graph lookups over `grep`/`read_file` — they
return exact `file:line` spans and cost a fraction of the tokens.

- **graft** (works today, no key): `graft ask "<question>" --source`,
  `graft skeleton <file>`, `graft callers <symbol>`, `graft grep "<literal>"`.
  MCP equivalents: `graft_find_code`, `graft_file_api`, `graft_trace_calls`,
  `graft_find_all`, `graft_repo_map`. If `graft/` is missing, run `make graph`.
- **code-review-graph** (must be built once per clone): call
  `build_or_update_graph_tool`, then `embed_graph_tool`, before trusting
  `semantic_search_nodes`. Until then its index is stale and keyword-only.
  **It does NOT auto-update via hooks** — rebuild it after large changes, or
  run `make graph`.
- **graphify is not maintained here.** `graphify-out/` is stale and
  gitignored. Ignore it.

`make orient` prints the repo map plus the doc index — one cheap call to get
your bearings in a fresh session.

## Filenames are ambiguous — always use full paths

This tree has 14 `index.ts`, 13 `routes.ts`, 6 `storage.ts`, 5 `service.ts`,
and 5 `http.ts`. A bare filename tells you nothing. When reading, grepping, or
discussing a file, use the repo-relative path (`server/content/storage.ts`, not
`storage.ts`), and read a file once — a file you have already read stays in
context.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
