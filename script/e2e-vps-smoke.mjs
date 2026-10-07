#!/usr/bin/env node
/**
 * Read-only deployment smoke.
 *
 * Run on the host that is serving ContentForge. It does not deploy, migrate,
 * or write. A missing stack is a failure, not a skip.
 *
 *   make e2e-vps
 *   CONTENTFORGE_SMOKE_BASE=http://127.0.0.1:3000 node script/e2e-vps-smoke.mjs
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

const base = (process.env.CONTENTFORGE_SMOKE_BASE ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const appPort = process.env.APP_PORT || new URL(base).port || "3000";
const pgPort = String(process.env.POSTGRES_PORT ?? "5432");
const publicUrl = process.env.CONTENTFORGE_PUBLIC_URL?.trim()
  || (process.env.PUBLIC_HOSTNAME ? `https://${process.env.PUBLIC_HOSTNAME}` : "");

const failures = [];

function note(ok, label, detail) {
  console.log(`  ${ok ? "✔" : "✖"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${label}: ${detail ?? "failed"}`);
}

async function get(url) {
  const res = await fetch(url, { redirect: "manual" });
  const text = await res.text();
  return { status: res.status, text };
}

function command(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: "utf8", timeout: 10_000 }).trim();
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim().split("\n")[0] : "";
    command.lastError = stderr || (error instanceof Error ? error.message.split("\n")[0] : String(error));
    return null;
  }
}

console.log(`ContentForge VPS smoke — ${base}`);

try {
  const health = await get(`${base}/api/health`);
  note(health.status === 200, "GET /api/health", String(health.status));
} catch (error) {
  note(false, "GET /api/health", error instanceof Error ? error.message : String(error));
}

try {
  const ready = await get(`${base}/api/ready`);
  note(ready.status === 200, "GET /api/ready", String(ready.status));
} catch (error) {
  note(false, "GET /api/ready", error instanceof Error ? error.message : String(error));
}

function noteListeners(port, lines) {
  const listening = lines.filter((line) => line.includes("LISTEN") && line.includes(`:${port}`));
  if (listening.length === 0) {
    note(false, `port ${port} listens`, "no listener");
    return;
  }
  const exposed = listening.filter((line) => !line.includes(`127.0.0.1:${port}`) && !line.includes(`[::1]:${port}`));
  note(exposed.length === 0, `port ${port} is loopback only`, exposed[0]?.trim() ?? listening[0].trim());
}

const ss = command("ss", ["-ltnp"]);
if (ss !== null) {
  for (const port of [appPort, pgPort]) {
    noteListeners(port, ss.split("\n").filter((line) => !line.startsWith("State")));
  }
} else {
  console.log(`  ℹ ss unavailable (${command.lastError || "not installed"}); using lsof`);
  for (const port of [appPort, pgPort]) {
    const listed = command("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    if (listed === null) {
      note(false, `port ${port} listens`, command.lastError || "lsof failed");
      continue;
    }
    noteListeners(port, listed.split("\n"));
  }
}

const head = command("git", ["rev-parse", "HEAD"]);
const origin = command("git", ["rev-parse", "origin/main"]);
if (!head || !origin) {
  note(false, "checkout matches origin/main", "git rev-parse failed");
} else {
  note(head === origin, "checkout matches origin/main", head === origin ? head.slice(0, 12) : `${head.slice(0, 12)} vs ${origin.slice(0, 12)}`);
}

if (publicUrl) {
  try {
    const tunnel = await get(`${publicUrl.replace(/\/+$/, "")}/api/health`);
    note(tunnel.status === 200, `tunnel ${publicUrl}/api/health`, String(tunnel.status));
  } catch (error) {
    note(false, `tunnel ${publicUrl}/api/health`, error instanceof Error ? error.message : String(error));
  }
} else {
  console.log("  ℹ tunnel — PUBLIC_HOSTNAME / CONTENTFORGE_PUBLIC_URL unset, not checked");
}

if (failures.length > 0) {
  console.error(`\nVPS smoke failed (${failures.length})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\nVPS smoke passed");
