# ContentForge — Makefile
#
# Two stacks, two commands:
#
#   make up          local (your machine)     → http://localhost:3000
#   make vps         VPS (real deployment)    → behind Cloudflare Tunnel
#   make deploy-vps  on the VPS: pull main, then deploy
#
# Both layer an overlay on the single docker-compose.yml base:
#   docker-compose.local.yml   local values — plain HTTP, proxy trust off
#   docker-compose.vps.yml     TLS behind the tunnel — Secure cookie, proxy trust on
#
# There is no Railway. The database is the `postgres` service in this stack, on
# the `contentforge_pg_data` volume; the application migrates it on boot.

# Operator overlays that live outside git load automatically when present, so `make up` never drops them.
# Example: ~/.contentos/compose/contentforge.video-factory.yml mounts the Video Factory exchange folder (data only).
COMPOSE_EXTRA := $(foreach f,$(sort $(wildcard $(HOME)/.contentos/compose/contentforge.*.yml)),-f $(f))

# The stack is configured by ONE env file. By default that is `.env` beside this
# file — and it is GITIGNORED, so a fresh clone, a new machine, or a
# `git clean -xfd` has none, and compose then fails with a bare
# "env file ... not found". Point at one kept outside the working tree instead
# (recommended on a server, so a re-clone cannot lose it):
#   CONTENTFORGE_ENV_FILE=$HOME/.contentos/contentforge.env make vps
# Use an ABSOLUTE path: compose does not expand `~`.
ENV_FILE ?= $(if $(CONTENTFORGE_ENV_FILE),$(CONTENTFORGE_ENV_FILE),.env)
export CONTENTFORGE_ENV_FILE := $(ENV_FILE)

COMPOSE_LOCAL := docker compose -f docker-compose.yml -f docker-compose.local.yml $(COMPOSE_EXTRA)
COMPOSE_VPS   := docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile tunnel

.PHONY: help up vps deploy-vps down ps logs backup restore check-env \
        db db-stop db-logs dev install start graph orient

# Explain the failure and the fix, instead of a compose stack trace.
check-env:
	@test -f "$(ENV_FILE)" || { \
		echo "No env file at: $(ENV_FILE)"; \
		echo ""; \
		echo "  The stack needs one, and it is gitignored — a fresh clone or a new"; \
		echo "  machine never has it. Either:"; \
		echo "    cp .env.example .env      # then fill in the values"; \
		echo "  or keep it outside the repo and point at it:"; \
		echo "    CONTENTFORGE_ENV_FILE=\$$HOME/.contentos/contentforge.env make vps"; \
		exit 1; \
	}

help: ## list the targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ---------- deployment ----------

up: check-env ## local stack: build and start
	@$(COMPOSE_LOCAL) up -d --build
	@echo "ContentForge (local) → http://localhost:$${APP_PORT:-3000}"

vps: check-env ## VPS stack: build and start with the Cloudflare tunnel
	@$(COMPOSE_VPS) up -d --build
	@echo "ContentForge (VPS) → https://$${PUBLIC_HOSTNAME:-$$(sed -n 's/^PUBLIC_HOSTNAME=//p' $(ENV_FILE) 2>/dev/null | head -1)} (via tunnel)"

deploy-vps: ## on the VPS: pull main, then deploy
	@git pull --ff-only origin main
	@$(MAKE) vps

down: ## stop the local stack (keeps the database volume)
	@$(COMPOSE_LOCAL) down

ps: ## show the stack's status (local and VPS)
	@docker compose -f docker-compose.yml ps

logs: ## follow the app logs (local and VPS)
	@docker compose -f docker-compose.yml logs -f app

# ---------- operations ----------

backup: ## dump the database to backups/<timestamp>.sql
	@mkdir -p backups
	@docker compose -f docker-compose.yml exec -T postgres \
		sh -c 'pg_dump -U "$$POSTGRES_USER" "$$POSTGRES_DB"' \
		> backups/contentforge-$$(date +%Y%m%d-%H%M%S).sql
	@echo "wrote $$(ls -t backups/*.sql | head -1)"

restore: ## restore a dump: make restore FILE=backups/x.sql
	@test -n "$(FILE)" || { echo "usage: make restore FILE=backups/x.sql"; exit 1; }
	@docker compose -f docker-compose.yml exec -T postgres \
		sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"' < $(FILE)

# ---------- development ----------

install: ## install npm dependencies
	npm install

dev: ## start the dev server (assumes the database is running)
	@npm run dev

start: db ## database + dev server
	@sleep 2
	@npm run dev

# ---------- local database only ----------

db: ## start just the database
	@docker compose up -d --wait
	@echo "Database ready at postgresql://cfuser:cfpass@localhost:5432/contentforge"

db-stop: ## stop the database
	@docker compose down

db-logs: ## follow the database logs
	@docker compose logs -f postgres

# ---------- repo context ----------

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
