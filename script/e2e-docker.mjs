/**
 * Brings up docker-compose.e2e.yml Postgres, runs db:migrate + check + build + playwright, then tears DB down.
 *
 * Uses DB URL postgresql://e2e:e2e@127.0.0.1:5433/contentforge_e2e (override with E2E_DATABASE_URL).
 * Your shell DATABASE_URL (e.g. Railway) is ignored for child commands so E2E never touches prod.
 *
 * E2E_SKIP_DOCKER=1 — do not run Docker; use DATABASE_URL from the environment (CI service container, etc.).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(root, "docker-compose.e2e.yml");
const defaultE2eDbUrl = "postgresql://e2e:e2e@127.0.0.1:5433/contentforge_e2e";
const skipDocker = process.env.E2E_SKIP_DOCKER === "1";
const dbUrl = skipDocker
  ? process.env.DATABASE_URL
  : (process.env.E2E_DATABASE_URL || defaultE2eDbUrl);

function runDocker(args) {
  const r = spawnSync("docker", args, { stdio: "inherit", cwd: root });
  if (r.error) {
    console.error("[e2e-docker] Docker not available:", r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runNpm(script) {
  const r = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (skipDocker) {
  if (!dbUrl) {
    console.error("[e2e-docker] E2E_SKIP_DOCKER=1 requires DATABASE_URL");
    process.exit(1);
  }
  console.log("[e2e-docker] Using DATABASE_URL from environment (no Docker).");
} else {
  console.log("[e2e-docker] Starting ephemeral Postgres (docker-compose.e2e.yml)…");
  runDocker(["compose", "-f", composeFile, "up", "-d", "--wait"]);
}

try {
  runNpm("db:migrate");
  runNpm("check");
  runNpm("build");
  run("npx", ["playwright", "test", ...process.argv.slice(2)]);
} finally {
  if (!skipDocker) {
    console.log("[e2e-docker] Stopping Postgres and removing volumes…");
    runDocker(["compose", "-f", composeFile, "down", "-v"]);
  }
}
