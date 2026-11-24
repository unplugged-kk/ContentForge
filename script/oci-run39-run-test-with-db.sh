#!/usr/bin/env bash
# Run a ContentForge test file with a reachable DATABASE_URL.
#
# B47: the .env value points at the compose host `postgres`, which does not
# resolve from the host. Rewrite it to 127.0.0.1:5432 (where contentforge-db is
# published). Never echo the URL — it contains credentials.
set -euo pipefail
cd /home/ubuntu/git/ContentForge

FILE="${1:?usage: run-test-with-db.sh <test-file> [more...]}"
shift || true

export DATABASE_URL="$(
  grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed 's|@postgres:5432|@127.0.0.1:5432|'
)"
export NODE_ENV=test
export CONTENTFORGE_E2E_SERVER=1

echo "DATABASE_URL host: $(printf '%s' "$DATABASE_URL" | sed 's|.*@|@|; s|/.*||')  (value not printed)"
exec node --import tsx --test "$FILE" "$@"
