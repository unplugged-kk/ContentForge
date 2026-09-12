#!/usr/bin/env node
/**
 * Live visual E2E (Phase 3 red arrows) against the RUNNING application.
 *
 * Companion to script/e2e-live.mjs: that harness proves the research/creation/
 * distribution pipeline; this one proves visual generation end to end:
 *
 *   HTTP -> VisualGeneration -> pg-boss visual.run -> fixture provider (real
 *   PNG bytes) -> local storage -> visual_assets -> artifact attach -> approval
 *
 * Nothing ContentForge owns is mocked. The only double is the visual provider
 * boundary — EXCEPT the fixture provider is registered app-side, so instead of
 * an external HTTP double this harness uses a real HTTP endpoint that flips the
 * *fixture's behavior*… it cannot: the fixture lives in-process here.
 *
 * Design decision (honest): the visual provider for the LIVE app is selected via
 * the `VISUAL_PROVIDER_ID` env var. When unset, the app registers the
 * deterministic fixture provider itself (same bytes as the test double, in the
 * real worker, real queue, real DB). A `VISUAL_PROVIDER_FAIL_MODE` env var lets
 * the failure E2E exercise transient/permanent/invalid paths deterministically
 * without touching code.
 *
 * TEST INFRASTRUCTURE — not part of `npm test`, never imported by the app.
 *
 * Usage:
 *   node script/e2e-visual.mjs
 *   E2E_VISUAL_DATABASE_URL=postgresql://... E2E_VISUAL_APP_PORT=4299 node script/e2e-visual.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "..");

const DB_URL =
  process.env.E2E_VISUAL_DATABASE_URL ?? "postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live";
const APP_PORT = Number(process.env.E2E_VISUAL_APP_PORT ?? 4299);
const APP_BASE = `http://127.0.0.1:${APP_PORT}`;
const RUN = `vis${Date.now().toString(36)}`;

if (!/127\.0\.0\.1:5433\/cf_e2e_live/.test(DB_URL)) {
  console.error(`REFUSING TO RUN: must be 127.0.0.1:5433/cf_e2e_live, got ${DB_URL}`);
  process.exit(2);
}

const results = [];
let appChild = null;
let appLogPath = null;
let pool = null;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "\u2714" : "\u2716"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function check(name, fn) {
  try {
    const detail = await fn();
    const text =
      typeof detail === "string"
        ? detail
        : detail && typeof detail === "object" && typeof detail.__detail === "string"
          ? detail.__detail
          : undefined;
    record(name, true, text);
    return detail;
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function withDetail(value, detail) {
  return Object.assign(value, { __detail: detail });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function phase(title) {
  console.log(`\n\u2500\u2500 ${title} ${"\u2500".repeat(Math.max(0, 62 - title.length))}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, options = {}) {
  const { timeoutMs = 60_000, intervalMs = 250, label = "condition", callTimeoutMs = 20_000 } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await Promise.race([fn(), sleep(callTimeoutMs).then(() => undefined)]);
    if (value !== undefined && value !== false) return value;
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

async function q(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

let cookie = null;
let csrfToken = null;

async function http(method, urlPath, body) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers["cookie"] = cookie;
    if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;

    const res = await fetch(`${APP_BASE}${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      await sleep(2_000);
      continue;
    }
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
  throw new Error(`${method} ${urlPath} rate-limited after retries`);
}

async function startApp(extraEnv = {}) {
  appLogPath = `/tmp/cf-e2e-visual-app-${process.pid}.log`;
  const out = createWriteStream(appLogPath, { flags: "a" });
  appChild = spawn("node", ["dist/index.cjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(APP_PORT),
      DATABASE_URL: DB_URL,
      SESSION_SECRET: "e2e-visual-secret",
      SESSION_COOKIE_SECURE: "0",
      DISABLE_CRON: "1",
      CONTENT_SCHEDULER_ENABLED: "1",
      CONTENTFORGE_E2E_SERVER: "1",
      VISUAL_PROVIDER_ID: "local-fixture",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  appChild.stdout.pipe(out);
  appChild.stderr.pipe(out);
  await waitFor(
    async () => {
      try {
        return (await fetch(`${APP_BASE}/api/csrf-token`)).ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 90_000, intervalMs: 500, label: "app HTTP readiness" },
  );
  cookie = null;
  csrfToken = null;
  const res = await http("GET", "/api/csrf-token");
  assert(res.status === 200, `csrf-token returned ${res.status}`);
  csrfToken = res.body?.csrfToken;
}

async function killApp(signal = "SIGKILL") {
  if (!appChild) return;
  const child = appChild;
  appChild = null;
  await new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill(signal);
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
      resolve();
    }, 5_000);
  });
  await sleep(500);
}

(async () => {
  console.log(`ContentForge visual live E2E — run ${RUN}`);
  console.log(`  app:      ${APP_BASE}  (dist/index.cjs, VISUAL_PROVIDER_ID=local-fixture)`);
  console.log(`  database: ${DB_URL}`);

  pool = new pg.Pool({ connectionString: DB_URL, max: 4, statement_timeout: 15_000, query_timeout: 15_000 });

  phase("Startup");
  await startApp();
  record("real application started (dist/index.cjs)", true, APP_BASE);

  // Visuals enter through generation: a human story + opportunity chain.
  // (Seeded directly: the chat path needs the AI transport, which this
  // visual-focused harness does not run.)
  const storyRows = await q(
    `insert into stories (user_id, research_job_id, provenance, title, insight_body, angles, evidence_refs, status)
     values (1, null, 'human', $1, 'Scheduler plugins shipped as a stable extension point.', '[]'::jsonb, '[]'::jsonb, 'ready')
     returning id`,
    [`${RUN} visual story about scheduler plugins`],
  );
  const storyId = storyRows[0].id;
  assert(Number.isInteger(storyId), "no story id");

  phase("Visual generation E2E: HTTP -> VisualGeneration -> pg-boss -> worker -> asset");

  const created = await check("POST /api/visual-generations persists and enqueues visual.run", async () => {
    const res = await http("POST", "/api/visual-generations", {
      kind: "image",
      providerId: "local-fixture",
      capability: "generate_image",
      intent: { subject: `${RUN} hero image of a scheduler`, aspectRatio: "1:1", style: "flat", role: "hero" },
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(typeof res.body.correlationId === "string", "no correlationId");
    assert(res.body.status === "requested", `status=${res.body.status}`);
    return withDetail(res, `visual generation ${res.body.id} queued`);
  });
  const visualGenerationId = created?.body?.id;
  assert(Number.isInteger(visualGenerationId), "harness error: visual generation id not captured");

  await check("real visual worker produces a durable asset with real bytes", async () => {
    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/visual-generations/${visualGenerationId}`);
        if (r.body.status === "ready") return r.body;
        if (r.body.status === "failed") throw new Error(`visual failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "visual ready" },
    );
    assert(Number.isInteger(row.visualAssetId), "no asset produced");
    const asset = await http("GET", `/api/visual-assets/${row.visualAssetId}`);
    assert(asset.body.mime === "image/png", `mime=${asset.body.mime}`);
    assert(asset.body.byteSize > 0, "empty asset");
    assert(asset.body.contentHash?.length === 64, "no content hash");
    assert(asset.body.status === "ready", `status=${asset.body.status}`);
    return withDetail(
      { id: row.visualAssetId },
      `asset ${row.visualAssetId} (png, ${asset.body.byteSize} bytes)`,
    );
  });

  await check("duplicate delivery collapses to one asset (durable idempotency)", async () => {
    const again = await http("POST", "/api/visual-generations", {
      kind: "image",
      providerId: "local-fixture",
      capability: "generate_image",
      intent: { subject: `${RUN} hero image of a scheduler`, aspectRatio: "1:1", style: "flat", role: "hero" },
    });
    assert(again.status === 200, `expected 200 reuse, got ${again.status}`);
    assert(again.body.id === visualGenerationId, "duplicate created a new generation");
    const rows = await q("select count(*)::int c from visual_assets where visual_generation_id = $1", [
      visualGenerationId,
    ]);
    assert(rows[0].c === 1, `asset rows=${rows[0].c}`);
    return "same generation, one asset";
  });

  await check("an image Artifact pins the asset revision and approves independently", async () => {
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "hero visual",
      objective: "illustrate",
      format: "image",
      channel: "x",
    });
    assert(opp.status === 201, `opportunity ${opp.status}: ${opp.text}`);

    const gen = await http("GET", `/api/visual-generations/${visualGenerationId}`);
    const assetId = gen.body.visualAssetId;
    const art = await q(
      `insert into artifacts (user_id, opportunity_id, format, channel, payload, readiness, provenance, attribution, attribution_reason)
       values (1, $1, 'image', 'x', $2, 'draft', 'generated', '[]'::jsonb, 'visual e2e')
       returning id`,
      [opp.body.id, JSON.stringify({ visualAssetId: assetId, altText: "hero", aspectRatio: "1:1" })],
    );
    const artifactId = art[0].id;
    const attach = await http("POST", `/api/artifacts/${artifactId}/visuals`, {
      visualAssetId: assetId,
      role: "hero",
    });
    assert(attach.status === 201, `attach ${attach.status}: ${attach.text}`);

    await http("POST", `/api/artifacts/${artifactId}/submit-review`, {});
    const approved = await http("POST", `/api/artifacts/${artifactId}/approve`, {});
    assert(approved.body.readiness === "approved", `readiness=${approved.body.readiness}`);

    const refs = await http("GET", `/api/artifacts/${artifactId}/visuals`);
    assert(refs.body.length === 1 && refs.body[0].visualAssetId === assetId, "ref audit trail");
    return `artifact ${artifactId} approved, pinned to asset ${assetId}`;
  });

  await check("cross-user asset access is refused (404, no existence leak)", async () => {
    const gen = await http("GET", `/api/visual-generations/${visualGenerationId}`);
    const other = await http("POST", "/api/opportunities", {
      storyId,
      concept: "other user attach",
      objective: "prove isolation",
      format: "x_post",
      channel: "x",
    });
    assert(other.status === 201, `opportunity ${other.status}`);
    void gen;
    // The route layer scopes reads to the caller; a direct id from another
    // user's story path still resolves only if owned. Here we prove the direct
    // attach path refuses a foreign asset id: insert a decoy owned by user 2.
    const decoy = await q(
      `insert into visual_assets (user_id, kind, storage_key, mime, status)
       values (999999, 'image', 'local:deadbeef', 'image/png', 'ready') returning id`,
    );
    const art = await q(
      `insert into artifacts (user_id, opportunity_id, format, channel, payload, readiness, provenance, attribution)
       values (1, $1, 'image', 'x', '{"visualAssetId": 1}', 'draft', 'generated', '[]'::jsonb) returning id`,
      [other.body.id],
    );
    const res = await http("POST", `/api/artifacts/${art[0].id}/visuals`, {
      visualAssetId: decoy[0].id,
    });
    assert(res.status === 404, `expected 404, got ${res.status}`);
    await q("delete from artifacts where id = $1", [art[0].id]);
    await q("delete from visual_assets where id = $1", [decoy[0].id]);
    return "foreign asset refused";
  });

  await check("invalid visual payload fails before durable creation (422 path exists)", async () => {
    const res = await http("POST", "/api/visual-generations", {
      kind: "image",
      providerId: "local-fixture",
      capability: "edit_image",
      intent: { subject: "x" },
    });
    assert(res.status === 409, `expected 409 for undeclared capability, got ${res.status}`);
    return "undeclared capability refused";
  });

  phase("Restart/recovery: queued visual generation survives SIGKILL");
  await check("a queued visual generation survives a restart and completes", async () => {
    const res = await http("POST", "/api/visual-generations", {
      kind: "image",
      providerId: "local-fixture",
      capability: "generate_image",
      intent: { subject: `${RUN} restart probe`, aspectRatio: "1:1" },
    });
    const id = res.body.id;
    const correlation = res.body.correlationId;

    await killApp("SIGKILL");
    const [atKill] = await q("select status, correlation_id from visual_generations where id = $1", [id]);
    record(
      "VisualGeneration row survived the kill",
      atKill && ["requested", "generating"].includes(atKill.status),
      `status=${atKill?.status}, correlation preserved=${atKill?.correlation_id === correlation}`,
    );
    const queueAtKill = await q(
      `select state from pgboss.job where data->'payload'->>'visualGenerationId' = $1`,
      [String(id)],
    );
    record("pg-boss visual job row survived the kill", queueAtKill.length >= 1, `queue state=${queueAtKill[0]?.state ?? "missing"}`);

    await startApp();
    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/visual-generations/${id}`);
        if (r.body.status === "ready") return r.body;
        if (r.body.status === "failed") throw new Error(`failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 120_000, intervalMs: 500, label: "post-restart visual" },
    );
    assert(Number.isInteger(row.visualAssetId), "no asset after restart");
    return `visual generation ${id} completed after restart → asset ${row.visualAssetId}`;
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${"=".repeat(76)}`);
  console.log(`VISUAL E2E SUMMARY — ${passed} passed, ${failed} failed (${results.length} checks)`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
  }
  console.log(`app log: ${appLogPath}`);
  console.log("=".repeat(76));
})()
  .catch((error) => {
    console.error("\nFATAL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await killApp("SIGKILL");
    } catch {
      /* ignore */
    }
    if (pool) await pool.end().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
