# ContentForge — Local Development Makefile

.PHONY: db db-stop db-logs dev install

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
