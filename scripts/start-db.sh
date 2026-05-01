#!/bin/bash
set -e

# ContentForge Local DB Bootstrap Script
# Usage: ./scripts/start-db.sh

echo "=== ContentForge Local Database ==="

# Check if Docker daemon is reachable
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon not running. Attempting to start Docker Desktop..."
  
  # Try to open Docker Desktop on macOS
  if [ -d "/Applications/Docker.app" ]; then
    open -a Docker
    echo "Waiting for Docker Desktop to start (this may take 30-60s)..."
    
    # Wait up to 60 seconds for Docker to be ready
    for i in {1..60}; do
      if docker info >/dev/null 2>&1; then
        echo "Docker is ready!"
        break
      fi
      sleep 1
      if [ $i -eq 60 ]; then
        echo "ERROR: Docker Desktop did not start in time."
        echo "Please start Docker Desktop manually and rerun this script."
        exit 1
      fi
    done
  else
    echo "ERROR: Docker Desktop not found at /Applications/Docker.app"
    echo "Please install Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
  fi
fi

echo "Starting PostgreSQL container..."
docker compose up -d --wait

echo ""
echo "Database is ready!"
echo "  URL: postgresql://cfuser:cfpass@localhost:5432/contentforge"
echo ""
echo "Add this to your .env file:"
echo '  DATABASE_URL=postgresql://cfuser:cfpass@localhost:5432/contentforge'
echo ""
echo "Stop with: docker compose down"
