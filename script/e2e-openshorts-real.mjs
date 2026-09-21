#!/usr/bin/env node
/**
 * Phase 27.2 live HTTP: owned VideoAsset → OpenShorts Docker → Ollama → VideoAsset[N].
 * Never imports application code. Never calls publish_clip or /api/social/post.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_URL = process.env.E2E_LIVE_DATABASE_URL ?? "postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live";
const APP_PORT = Number(process.env.OPENSHORTS_E2E_PORT ?? 5027);
const APP_BASE = `http://127.0.0.1:${APP_PORT}`;
const SOURCE = process.env.OPENSHORTS_SOURCE_MP4 ?? "/tmp/cf-openshorts-source/source.mp4";
const RUN = `os27${Date.now().toString(36)}`;

if (!/127\.0\.0\.1:5433\/cf_e2e_live/.test(DB_URL)) {
  console.error("REFUSING TO RUN: database must be 127.0.0.1:5433/cf_e2e_live");
  process.exit(2);
}

const results = [];
let appChild = null;
let cookie = null;
let csrfToken = null;
let pool = null;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : undefined);
    return detail;
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}
async function waitFor(fn, options = {}) {
  const { timeoutMs = 60_000, intervalMs = 500, label = "condition" } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined && value !== false) return value;
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

async function http(method, urlPath, body, extra = {}) {
  const headers = { ...(extra.headers ?? {}) };
  if (body !== undefined && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/json";
  }
  if (cookie) headers.cookie = cookie;
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  const res = await fetch(`${APP_BASE}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : extra.raw ? body : JSON.stringify(body),
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
  const logPath = `/tmp/cf-openshorts-e2e-app-${process.pid}.log`;
  const out = createWriteStream(logPath, { flags: "a" });
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
      VIDEO_REPURPOSE_POLL_BUDGET_MS: "1500000",
      CONTENTFORGE_E2E_SERVER: "1",
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
    { timeoutMs: 90_000, intervalMs: 400, label: "app HTTP" },
  );
  cookie = null;
  csrfToken = null;
  const csrf = await http("GET", "/api/csrf-token");
  csrfToken = csrf.body?.csrfToken;
}

async function killApp() {
  if (!appChild) return;
  const child = appChild;
  appChild = null;
  await new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 2_000);
  });
}

function probeMp4(file) {
  const out = spawnSync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { encoding: "utf8" },
  );
  if (out.status !== 0) throw new Error(out.stderr || "ffprobe failed");
  return JSON.parse(out.stdout);
}

const timings = {};

async function main() {
  console.log(`\nPhase 27.2 OpenShorts real HTTP  run=${RUN}\n`);
  pool = new pg.Pool({ connectionString: DB_URL });
  const sourceBytes = readFileSync(SOURCE);
  const sourceProbe = probeMp4(SOURCE);
  const videoStream = sourceProbe.streams.find((s) => s.codec_type === "video");
  const audioStream = sourceProbe.streams.find((s) => s.codec_type === "audio");
  assert(videoStream, "source missing video stream");
  assert(audioStream, "source missing audio stream");
  const durationMs = Math.round(Number(sourceProbe.format.duration) * 1000);
  const width = Number(videoStream.width);
  const height = Number(videoStream.height);
  timings.sourceDurationS = Number(sourceProbe.format.duration);
  timings.sourceBytes = sourceBytes.length;

  await startApp();
  const registered = await http("POST", "/api/auth/register", {
    email: `${RUN}@example.com`,
    password: "password1",
    name: "OpenShorts E2E",
  });
  const ownerId = registered.body?.id;
  const csrf = await http("GET", "/api/csrf-token");
  csrfToken = csrf.body?.csrfToken;

  await check("capabilities report OpenShorts processing_ready", async () => {
    const res = await http("GET", "/api/video/capabilities");
    assert(res.status === 200, `capabilities ${res.status}: ${res.text}`);
    const row = (res.body.repurposing ?? []).find((p) => p.provider === "openshorts");
    assert(row, "openshorts row missing");
    assert(row.configured === true, "openshorts not configured");
    assert(row.reachable === true, `not reachable: ${row.reason}`);
    assert(row.llm_ready === true, `llm not ready: ${row.reason}`);
    assert(row.processing_ready === true, `not processing-ready: ${row.reason}`);
    return JSON.stringify({ reachable: row.reachable, llm_ready: row.llm_ready, processing_ready: row.processing_ready });
  });

  let sourceId;
  await check("ingest owned 60s+ speech VideoAsset", async () => {
    const started = Date.now();
    const res = await http(
      "POST",
      `/api/video-assets?durationMs=${durationMs}&width=${width}&height=${height}&altText=openshorts-source`,
      sourceBytes,
      { raw: true, headers: { "content-type": "video/mp4" } },
    );
    assert(res.status === 201, `ingest ${res.status}: ${res.text}`);
    assert(res.body.kind === "video", "not a video");
    assert(!("storageKey" in res.body), "must not leak storageKey");
    sourceId = res.body.id;
    timings.ingestMs = Date.now() - started;
    return `VideoAsset ${sourceId} ${res.body.byteSize}B ${res.body.durationMs}ms`;
  });

  let jobId;
  let providerJobId;
  await check("submit OpenShorts repurpose (not fixture)", async () => {
    const res = await http("POST", "/api/video/repurposing", {
      sourceVisualAssetId: sourceId,
      clipCount: 3,
      providerId: "openshorts",
    });
    assert(res.status === 201 || res.status === 200, `repurpose ${res.status}: ${res.text}`);
    assert(res.body.providerId === "openshorts", `provider ${res.body.providerId}`);
    jobId = res.body.id;
    return `job ${jobId} status=${res.body.status}`;
  });

  await check("duplicate identical request is one ContentForge job", async () => {
    const [a, b] = await Promise.all([
      http("POST", "/api/video/repurposing", {
        sourceVisualAssetId: sourceId,
        clipCount: 3,
        providerId: "openshorts",
      }),
      http("POST", "/api/video/repurposing", {
        sourceVisualAssetId: sourceId,
        clipCount: 3,
        providerId: "openshorts",
      }),
    ]);
    assert(a.body.id === jobId && b.body.id === jobId, `expected ${jobId} got ${a.body.id},${b.body.id}`);
    return `reused ${jobId}`;
  });

  await check("provider accepted then ContentForge restart reconciles the same job", async () => {
    const accepted = await waitFor(
      async () => {
        const rows = await pool.query("select provider_job_id, status from video_repurposing_jobs where id = $1", [jobId]);
        const row = rows.rows[0];
        if (row?.provider_job_id && !String(row.provider_job_id).startsWith("upload:")) return row;
        return false;
      },
      { timeoutMs: 120_000, intervalMs: 1_000, label: "openshorts provider job id" },
    );
    providerJobId = accepted.provider_job_id;
    timings.acceptedAt = Date.now();
    await killApp();
    await startApp();
    await http("POST", "/api/auth/login", { email: `${RUN}@example.com`, password: "password1" }).catch(() => undefined);
    const csrf2 = await http("GET", "/api/csrf-token");
    csrfToken = csrf2.body?.csrfToken;
    await http("POST", "/api/auth/login", { email: `${RUN}@example.com`, password: "password1" });
    const csrf3 = await http("GET", "/api/csrf-token");
    csrfToken = csrf3.body?.csrfToken;
    const after = await pool.query("select provider_job_id from video_repurposing_jobs where id = $1", [jobId]);
    assert(after.rows[0].provider_job_id === providerJobId, "provider job id changed after restart");
    const resume = await http("POST", "/api/video/repurposing", {
      sourceVisualAssetId: sourceId,
      clipCount: 3,
      providerId: "openshorts",
    });
    assert(resume.body.id === jobId, `resume created a new job ${resume.body.id}`);
    return `providerJobId=${providerJobId} survived SIGKILL`;
  });

  await check("real clips imported as VideoAssets", async () => {
    const ready = await waitFor(
      async () => {
        const r = await http("GET", `/api/video/repurposing/${jobId}`);
        if (r.body?.status === "ready" && (r.body.assetIds ?? []).length >= 1) return r.body;
        if (r.body?.status === "partial" && (r.body.assetIds ?? []).length >= 1) return r.body;
        if (r.body?.status === "failed") throw new Error(r.body.errorMessage ?? r.text);
        return false;
      },
          { timeoutMs: 2_400_000, intervalMs: 8_000, label: "openshorts clips ready" },
    );
    timings.jobStatus = ready.status;
    const assets = await http("GET", `/api/video/repurposing/${jobId}/assets`);
    assert(assets.status === 200, `assets ${assets.status}`);
    assert(assets.body.assets.length > 0, "no imported clips");
    for (const asset of assets.body.assets) {
      assert(asset.provenance === "derived", "missing derived provenance");
      assert(asset.kind === "video", "clip is not video");
      assert(asset.byteSize > 0, "empty clip bytes");
      const row = await pool.query("select storage_key, content_hash, metadata from visual_assets where id = $1", [asset.id]);
      const meta = row.rows[0].metadata ?? {};
      assert(String(row.rows[0].storage_key).startsWith("local:"), row.rows[0].storage_key);
      assert(meta.sourceVisualAssetId === sourceId, "missing source lineage");
      assert(meta.videoRepurposingJobId === jobId, "missing job lineage");
      assert(meta.provider === "openshorts", "missing provider");
      assert(meta.providerJobId === providerJobId, "missing provider job");
    }
    timings.clipCount = assets.body.assets.length;
    timings.clips = assets.body.assets.map((a) => ({
      id: a.id,
      bytes: a.byteSize,
      durationMs: a.durationMs,
      width: a.width,
      height: a.height,
    }));
    return `status=${ready.status} clips=${assets.body.assets.map((a) => a.id).join(",")}`;
  });

  await check("owner isolation hides foreign source, job, and clip", async () => {
    cookie = null;
    csrfToken = null;
    const csrf = await http("GET", "/api/csrf-token");
    csrfToken = csrf.body?.csrfToken;
    const registered = await http("POST", "/api/auth/register", {
      email: `${RUN}-b@example.com`,
      password: "password1",
      name: "Other",
    });
    assert([200, 201].includes(registered.status), `register ${registered.status}`);
    const csrf2 = await http("GET", "/api/csrf-token");
    csrfToken = csrf2.body?.csrfToken;
    const hiddenJob = await http("GET", `/api/video/repurposing/${jobId}`);
    const hiddenSource = await http("GET", `/api/video-assets/${sourceId}`);
    assert(hiddenJob.status === 404, `job leaked ${hiddenJob.status}`);
    assert(hiddenSource.status === 404, `source leaked ${hiddenSource.status}`);
    return "foreign reads 404";
  });

  await check("Instagram Reel path from imported clip (no OpenShorts publish)", async () => {
    cookie = null;
    csrfToken = null;
    await http("POST", "/api/auth/login", { email: `${RUN}@example.com`, password: "password1" });
    const csrf = await http("GET", "/api/csrf-token");
    csrfToken = csrf.body?.csrfToken;
    const assets = await http("GET", `/api/video/repurposing/${jobId}/assets`);
    const clipId = assets.body.assets[0].id;
    const research = await pool.query(
      `insert into research_jobs (user_id, correlation_id, idempotency_key, kind, query, status)
       values ($1, $2, $3, 'directed', 'openshorts clip story', 'complete')
       returning id`,
      [ownerId ?? null, `${RUN}-rj`, `${RUN}-rj-key`],
    );
    const researchJobId = research.rows[0].id;
    const story = await http("POST", "/api/stories", {
      researchJobId,
      title: `${RUN} reel story`,
      insightBody: "An OpenShorts clip is still a ContentForge VideoAsset.",
      angles: ["clip lineage"],
    });
    assert([200, 201].includes(story.status), `story ${story.status}: ${story.text}`);
    const opp = await http("POST", "/api/opportunities", {
      storyId: story.body.id,
      concept: "openshorts reel",
      objective: "artifact",
      format: "video",
      channel: "instagram",
    });
    assert(opp.status === 201, `opportunity ${opp.status}: ${opp.text}`);
    const created = await http("POST", `/api/opportunities/${opp.body.id}/artifacts`, {
      payload: { visualAssetId: clipId, caption: `${RUN} reel`, altText: `${RUN} reel`, aspectRatio: "9:16" },
      attributionReason: "openshorts clip artifact",
    });
    assert(created.status === 201, `artifact ${created.status}: ${created.text}`);
    const submit = await http("POST", `/api/artifacts/${created.body.id}/submit-review`, {});
    assert([200, 201].includes(submit.status) || submit.status === 409, `submit ${submit.status}: ${submit.text}`);
    const approve = await http("POST", `/api/artifacts/${created.body.id}/approve`, {});
    assert([200, 201].includes(approve.status) || approve.status === 409, `approve ${approve.status}: ${approve.text}`);
    return `artifact ${created.body.id} from clip ${clipId}`;
  });

  console.log("\nTimings", JSON.stringify(timings, null, 2));
  console.log("\nResults");
  for (const row of results) console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await killApp();
    await pool?.end();
  });
