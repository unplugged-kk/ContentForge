# ContentForge — Local Development Makefile

.PHONY: db db-stop db-logs dev install graph orient

# Start local PostgreSQL database via Docker
# Requires Docker Desktop to be running
db:
	@echo "Starting ContentForge PostgreSQL database..."
	@docker compose up -d --wait
	@echo "Database ready at postgresql://cfuser:cfpass@localhost:5432/contentforge"

# Stop the database
db-stop:
	@echo "Stopping ContentForge database..."
	@docker compose down

# View database logs
db-logs:
	@docker compose logs -f postgres

# Install npm dependencies
install:
	npm install

# Start the dev server (assumes DB is running)
dev:
	@npm run dev

# Full local setup: start DB + dev server
start: db
	@sleep 2
	@npm run dev

# Rebuild the code context graphs.
# - graft: wiring graph + per-file cards, $0, no key. `graft ask`/`map`/`callers`
#   read it. Safe to re-run; it also self-refreshes when asked a question.
# - code-review-graph: needs an MCP call, so it is not run here. In an agent
#   session, call build_or_update_graph_tool then embed_graph_tool once per
#   clone, otherwise semantic_search_nodes stays stale and keyword-only.
graph:
	@echo "Rebuilding graft graph..."
	@graft build .
	@echo ""
	@echo "code-review-graph: run build_or_update_graph_tool + embed_graph_tool"
	@echo "in your agent session to refresh its index."

# One-call orientation: repo map + canonical doc index.
# Use this at the start of a session instead of grepping around.
orient:
	@graft map . 2>/dev/null | head -40 || echo "(no graft graph — run: make graph)"
	@echo ""
	@echo "===== docs/README.md — where the docs are ====="
	@sed -n '1,45p' docs/README.md 2>/dev/null || echo "(docs/README.md missing)"
