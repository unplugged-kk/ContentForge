#!/usr/bin/env node
/** Resume ContentForge import of an already-completed OpenShorts job. */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_URL = "postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live";
const APP_PORT = 5028;
const APP_BASE = `http://127.0.0.1:${APP_PORT}`;
const EMAIL = process.env.RESUME_EMAIL ?? "os27mu6zjrmz@example.com";
const SOURCE_ID = Number(process.env.RESUME_SOURCE_ID ?? 665);
const JOB_ID = Number(process.env.RESUME_JOB_ID ?? 7);

let appChild = null;
let cookie = null;
let csrfToken = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, urlPath, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  const res = await fetch(`${APP_BASE}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) cookie = setCookies[0].split(";")[0];
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, body: json, text };
}

async function startApp() {
  const out = createWriteStream(`/tmp/cf-openshorts-resume-${process.pid}.log`, { flags: "a" });
  appChild = spawn("node", ["--import", "tsx", "server/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(APP_PORT),
      DATABASE_URL: DB_URL,
      SESSION_SECRET: "e2e-openshorts-secret",
      SESSION_COOKIE_SECURE: "0",
      DISABLE_CRON: "1",
      CONTENT_SCHEDULER_ENABLED: "0",
      OPENSHORTS_API_URL: "http://127.0.0.1:8000",
      OPENSHORTS_LLM_PROBE_URL: "http://127.0.0.1:11434/v1/models",
      VIDEO_REPURPOSE_POLL_BUDGET_MS: "600000",
      CONTENTFORGE_E2E_SERVER: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  appChild.stdout.pipe(out);
  appChild.stderr.pipe(out);
  for (let i = 0; i < 90; i += 1) {
    try {
      if ((await fetch(`${APP_BASE}/api/csrf-token`)).ok) return;
    } catch {
      /* wait */
    }
    await sleep(400);
  }
  throw new Error("app did not start");
}

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL });
  await startApp();
  let csrf = await http("GET", "/api/csrf-token");
  csrfToken = csrf.body?.csrfToken;
  const login = await http("POST", "/api/auth/login", { email: EMAIL, password: "password1" });
  console.log("login", login.status, login.text?.slice(0, 200));
  csrf = await http("GET", "/api/csrf-token");
  csrfToken = csrf.body?.csrfToken;
  const resume = await http("POST", "/api/video/repurposing", {
    sourceVisualAssetId: SOURCE_ID,
    clipCount: 3,
    providerId: "openshorts",
  });
  console.log("resume", resume.status, JSON.stringify(resume.body));
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const r = await http("GET", `/api/video/repurposing/${JOB_ID}`);
    console.log("job", r.body?.status, r.body?.assetIds, r.body?.errorMessage);
    if (r.body?.status === "ready" || r.body?.status === "partial") {
      const assets = await http("GET", `/api/video/repurposing/${JOB_ID}/assets`);
      console.log("assets", JSON.stringify(assets.body, null, 2).slice(0, 4000));
      const rows = await pool.query(
        "select id, storage_key, content_hash, byte_size, duration_ms, width, height, provenance, metadata from visual_assets where id = any($1::int[])",
        [assets.body.assets.map((a) => a.id)],
      );
      console.log("db", JSON.stringify(rows.rows, null, 2));
      await pool.end();
      return;
    }
    if (r.body?.status === "failed") throw new Error(r.body.errorMessage ?? r.text);
    await sleep(5000);
  }
  throw new Error("import did not finish");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (appChild) {
      appChild.kill("SIGKILL");
    }
  });
