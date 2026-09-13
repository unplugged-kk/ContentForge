#!/usr/bin/env node
/**
 * Live end-to-end verification of the RUNNING ContentForge application.
 *
 * Unlike the unit and DB-integration suites, this harness never imports
 * application code. It:
 *   1. starts a deterministic RSS fixture in Docker on host port 80,
 *   2. starts the real production bundle (`dist/index.cjs`) as a child process,
 *   3. drives the real HTTP API (CSRF + session cookie, like a browser),
 *   4. asserts durable state directly in PostgreSQL (public schema + pg-boss),
 *   5. restarts the process mid-flight to prove recovery,
 *   6. exercises retry/DLQ through real pg-boss state.
 *
 * Nothing in the research execution path is mocked: real Express, real pg-boss
 * worker, real provider registry, real RSS provider, real engine, real Postgres.
 *
 * TEST INFRASTRUCTURE — not part of `npm test`, never imported by the app.
 *
 * Usage:
 *   node script/e2e-live.mjs
 *   E2E_LIVE_DATABASE_URL=postgresql://... E2E_LIVE_APP_PORT=4199 node script/e2e-live.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "..");

// ── Config ────────────────────────────────────────────────────────────────────
const DB_URL =
  process.env.E2E_LIVE_DATABASE_URL ?? "postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live";
const APP_PORT = Number(process.env.E2E_LIVE_APP_PORT ?? 4199);
const APP_BASE = `http://127.0.0.1:${APP_PORT}`;
const FIXTURE_CONTAINER = "cf-rss-fixture";
const FIXTURE_IMAGE = "node:24-alpine";
const FIXTURE_BASE = "http://localhost";
const RUN = `live${Date.now().toString(36)}`;

// Safety guard: never touch anything but the disposable local E2E database.
if (!/127\.0\.0\.1:5433\/cf_e2e_live/.test(DB_URL)) {
  console.error(`REFUSING TO RUN: E2E database must be 127.0.0.1:5433/cf_e2e_live, got ${DB_URL}`);
  process.exit(2);
}

// ── Tiny test harness ─────────────────────────────────────────────────────────
const results = [];
let appChild = null;
let appLogPath = null;
let pool = null;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "\u2714" : "\u2716"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

/** Informational only — never affects the exit code (used for the optional external smoke). */
function inform(label, detail) {
  console.log(`  \u2139 ${label}${detail ? ` — ${detail}` : ""}`);
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

/** Attach a human-readable detail line to an object returned from a `check` callback. */
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
  const {
    timeoutMs = 60_000,
    intervalMs = 250,
    label = "condition",
    callTimeoutMs = 20_000,
  } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Race each call so a stalled database surfaces as a timeout rather than
    // hanging the whole wait (the environment's Docker was observed to stall).
    const value = await Promise.race([
      fn(),
      sleep(callTimeoutMs).then(() => undefined),
    ]);
    if (value !== undefined && value !== false) return value;
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

// ── Database ──────────────────────────────────────────────────────────────────
async function q(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

// ── HTTP client (session cookie + CSRF, like a browser) ───────────────────────
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

async function bootstrapSession() {
  const res = await http("GET", "/api/csrf-token");
  assert(res.status === 200, `csrf-token returned ${res.status}`);
  csrfToken = res.body?.csrfToken;
  assert(typeof csrfToken === "string" && csrfToken.length > 0, "empty CSRF token");
}

// ── App process lifecycle ─────────────────────────────────────────────────────
async function startApp() {
  appLogPath = `/tmp/cf-e2e-live-app-${process.pid}.log`;
  const out = createWriteStream(appLogPath, { flags: "a" });

  appChild = spawn("node", ["dist/index.cjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(APP_PORT),
      DATABASE_URL: DB_URL,
      SESSION_SECRET: "e2e-live-secret",
      SESSION_COOKIE_SECURE: "0",
      DISABLE_CRON: "1",
      // ...but the durable content scheduler is enabled explicitly, so the real
      // periodic tick (not just the HTTP dispatch endpoint) is exercised.
      CONTENT_SCHEDULER_ENABLED: "1",
      CONTENTFORGE_E2E_SERVER: "1",
      // External boundaries are doubled at the transport level only: the model
      // gateway (AI_BASE_URL) and xQuick (XQUICK_API_BASE_URL) point at the
      // deterministic local fixture. ContentForge's own code runs unmodified.
      AI_BASE_URL: `${FIXTURE_BASE}/v1`,
      AI_API_KEY: "fixture-key",
      OPENAI_API_KEY: "fixture-key",
      XQUICK_API_BASE_URL: FIXTURE_BASE,
      XQUICK_API_KEY: "fixture-key",
      XQUICK_ACCOUNT: "cf_e2e",
      // Phase 2: point the real providers at the deterministic fixture. The
      // operator allowlist is what lets the SSRF-guarded providers reach it; it
      // is default-off in production and never derived from request input.
      REDDIT_BASE_URL: `${FIXTURE_BASE}/reddit`,
      YOUTUBE_BASE_URL: `${FIXTURE_BASE}/youtube`,
      HN_BASE_URL: `${FIXTURE_BASE}/hn`,
      RESEARCH_ALLOWED_HOSTS: "localhost",
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
  await bootstrapSession();
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
        /* already gone */
      }
      resolve();
    }, 5_000);
  });
  await sleep(500);
}

// ── Docker fixture ────────────────────────────────────────────────────────────
function docker(args) {
  return spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });
}

function startFixture() {
  docker(["rm", "-f", FIXTURE_CONTAINER]);
  const script = readFileSync(path.join(ROOT, "e2e/fixture/rss-fixture.mjs"), "utf8");
  const b64 = Buffer.from(script, "utf8").toString("base64");
  const start = docker([
    "run", "-d", "--rm", "--name", FIXTURE_CONTAINER,
    "-p", "80:80",
    "-e", `FIXTURE_RUN=${RUN}`,
    "-e", `SCRIPT_B64=${b64}`,
    FIXTURE_IMAGE,
    "sh", "-c", 'echo "$SCRIPT_B64" | base64 -d > /app.mjs && node /app.mjs',
  ]);
  if (start.status !== 0) throw new Error(`fixture start failed: ${start.stderr || start.stdout}`);
}

function stopFixture() {
  docker(["rm", "-f", FIXTURE_CONTAINER]);
}

async function fixtureGet(p) {
  const res = await fetch(`${FIXTURE_BASE}${p}`);
  return { status: res.status, text: await res.text() };
}

async function fixturePost(p, body) {
  const res = await fetch(`${FIXTURE_BASE}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

// ── Domain helpers ────────────────────────────────────────────────────────────
/**
 * One active RSS source pointing at the fixture. Seeded sources are removed so
 * no research run touches the public internet (deterministic E2E).
 */
async function setActiveFeed(feedUrl) {
  await q("delete from rss_sources");
  await q(
    "insert into rss_sources (user_id, name, feed_url, is_active) values (1, $1, $2, true)",
    [`${RUN}-feed`, feedUrl],
  );
}

const researchJobRow = async (id) =>
  (await q("select * from research_jobs where id = $1", [id]))[0];

/** Wait for a terminal state; a failed job surfaces immediately with its reason. */
const waitJobTerminal = (jobId, options) =>
  waitFor(
    async () => {
      const row = await researchJobRow(jobId);
      if (!row) return false;
      if (row.status === "complete") return row;
      if (row.status === "failed") {
        throw new Error(`job ${jobId} failed (${row.error_class}): ${row.error_message}`);
      }
      return false;
    },
    options,
  );

/**
 * pg-boss v10 exposes one partitioned `pgboss.job` table for every queue; the
 * dead-letter queue is a queue named `<jobType>.dlq` (`pgboss.queue`).
 */
const queueJobFor = (jobId) =>
  q(`select id, name, state, retry_count, retry_limit, start_after, data->>'correlationId' corr
       from pgboss.job where data->'payload'->>'jobId' = $1`, [String(jobId)]);

const deadLetterJobs = () =>
  q(`select id, name, state, data->'envelope'->>'correlationId' corr
       from pgboss.job where name like '%.dlq'`);

function createResearchJob(body) {
  return http("POST", "/api/research/jobs", { providerIds: ["rss"], ...body });
}

// ══════════════════════════════════════════════════════════════════════════════
const observed = {};

(async () => {
  console.log(`ContentForge live E2E — run ${RUN}`);
  console.log(`  app:      ${APP_BASE}  (dist/index.cjs)`);
  console.log(`  database: ${DB_URL}`);
  console.log(`  fixture:  docker ${FIXTURE_IMAGE} -> host :80`);

  pool = new pg.Pool({
    connectionString: DB_URL,
    max: 4,
    statement_timeout: 15_000,
    query_timeout: 15_000,
  });

  // ── Startup ─────────────────────────────────────────────────────────────────
  phase("Startup");
  startFixture();
  await waitFor(
    async () => {
      try {
        return (await fixtureGet("/health")).status === 200;
      } catch {
        return false;
      }
    },
    { timeoutMs: 60_000, intervalMs: 300, label: "fixture readiness" },
  );
  record("deterministic RSS fixture reachable on host port 80", true, FIXTURE_BASE);

  await startApp();
  record("real application started (dist/index.cjs)", true, appLogPath.replace(/^.*\//, ""));
  record("real HTTP API reachable", true, APP_BASE);

  const tables = await q(
    "select count(*)::int c from information_schema.tables where table_schema='public'",
  );
  record("startup migrations applied", tables[0].c >= 32, `${tables[0].c} public tables`);

  await setActiveFeed(`${FIXTURE_BASE}/feed.xml`);
  const seeded = await q("select count(*)::int c from rss_sources");
  record("research config isolated to the fixture feed", seeded[0].c === 1, "1 active source");

  // ── 1. RESEARCH E2E ─────────────────────────────────────────────────────────
  phase("Research E2E: HTTP -> ResearchJob -> pg-boss -> worker -> RSS -> Postgres");
  const researchKey = `research:directed:${RUN}-main`;
  const created = await check("POST /api/research/jobs returns 201 with a job id", async () => {
    const res = await createResearchJob({ kind: "directed", query: "kubernetes", idempotencyKey: researchKey });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(Number.isInteger(res.body.id), "response has no integer id");
    assert(typeof res.body.correlationId === "string", "response has no correlationId");
    assert(res.body.status === "queued", `expected queued, got ${res.body.status}`);
    return withDetail(res, `job ${res.body.id}`);
  });
  const researchJobId = created?.body?.id;
  assert(Number.isInteger(researchJobId), "harness error: research job id was not captured");
  observed.researchJobId = researchJobId;
  observed.correlationId = created?.body?.correlationId;

  await check("ResearchJob persisted durably in queued state", async () => {
    const row = await researchJobRow(researchJobId);
    assert(row, "research_jobs row missing");
    assert(["queued", "running"].includes(row.status), `unexpected status ${row.status}`);
    assert(row.correlation_id === observed.correlationId, "correlation id mismatch");
    return `status=${row.status}`;
  });

  await check("pg-boss received the research.run job", async () => {
    const rows = await waitFor(
      async () => {
        const r = await queueJobFor(researchJobId);
        return r.length > 0 ? r : false;
      },
      { timeoutMs: 20_000, intervalMs: 200, label: "queue row" },
    );
    return `queue job ${rows[0].id} state=${rows[0].state}`;
  });

  await check("worker executes research.run and the job reaches complete", async () => {
    const row = await waitFor(
      async () => {
        const r = await researchJobRow(researchJobId);
        if (r?.status === "complete") return r;
        if (r?.status === "failed") throw new Error(`job failed: ${r.error_message}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "research completion" },
    );
    assert(row.started_at && row.finished_at, "timestamps not set");
    assert(row.error_class === null, `unexpected error_class ${row.error_class}`);
    return `complete in ${new Date(row.finished_at) - new Date(row.started_at)}ms`;
  });

  await check("GET /api/research/jobs/:id returns the completed job", async () => {
    const res = await http("GET", `/api/research/jobs/${researchJobId}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.status === "complete", `status=${res.body.status}`);
    assert(res.body.sourceCount >= 1 && res.body.evidenceCount >= 1, "missing counts");
    return `sources=${res.body.sourceCount} evidence=${res.body.evidenceCount}`;
  });

  await check("RSS provider produced NormalizedSources persisted to research_sources", async () => {
    const res = await http("GET", `/api/research/jobs/${researchJobId}/sources`);
    assert(res.body.length === 3, `expected 3 fixture sources, got ${res.body.length}`);
    for (const s of res.body) {
      assert(s.provider === "rss" && s.backend === "rss-parser", "wrong provider/backend");
      assert(s.retrievalMethod === "feed", `retrievalMethod=${s.retrievalMethod}`);
      assert(String(s.canonicalUrl).startsWith("https://fixture.contentforge.test/"), "bad url");
    }
    const db = await q("select count(*)::int c from research_sources where job_id = $1", [researchJobId]);
    assert(db[0].c === 3, `db source count=${db[0].c}`);
    return "3 sources (provider=rss, backend=rss-parser, method=feed)";
  });

  await check("engine (not the provider) derived Evidence into research_evidence", async () => {
    const res = await http("GET", `/api/research/jobs/${researchJobId}/evidence`);
    assert(res.body.length === 3, `expected 3 evidence rows, got ${res.body.length}`);
    for (const e of res.body) {
      assert(e.origin === "sourced", `origin=${e.origin}`);
      assert(e.sourceId !== null, "evidence has no source reference");
      assert(String(e.excerptHash).length === 64, "bad excerpt hash");
    }
    return "3 sourced evidence rows, each linked to a source";
  });

  // ── 2. TRANSIENT (started early so the real backoff can elapse) ─────────────
  phase("Queue: transient failure -> retry scheduled (started early)");
  // The first fetch returns an item with an over-long native id, so provider
  // collection succeeds but persistence fails — the engine classifies that as
  // transient and pg-boss schedules a real retry.
  await setActiveFeed(`${FIXTURE_BASE}/flaky-long.xml`);
  await fixtureGet("/reset");
  const transientJob = await createResearchJob({
    kind: "directed",
    query: "kubernetes",
    idempotencyKey: `${RUN}-transient`,
  });
  const transientJobId = transientJob.body.id;
  observed.transientJobId = transientJobId;
  await check("first attempt fails transiently and a retry is durably scheduled", async () => {
    const row = await waitFor(
      async () => {
        const r = await researchJobRow(transientJobId);
        return r?.status === "failed" ? r : false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "transient failure" },
    );
    assert(row.error_class === "transient", `error_class=${row.error_class}`);
    const queue = await queueJobFor(transientJobId);
    assert(queue.length >= 1, "no queue row for the transient job");
    // pg-boss parks a thrown job in `retry` with a future start_after; retry_count
    // is only incremented when the retry actually starts.
    assert(queue[0].state === "retry", `queue state=${queue[0].state}`);
    return `error_class=transient; queue state=retry until ${new Date(queue[0].start_after).toISOString()}`;
  });
  // Let the later retry succeed deterministically.
  await setActiveFeed(`${FIXTURE_BASE}/feed.xml`);

  // ── 3. STORY E2E ────────────────────────────────────────────────────────────
  phase("Story E2E: completed ResearchJob -> POST /api/stories -> Postgres");
  const before = {
    jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
    sources: (await q("select count(*)::int c from research_sources"))[0].c,
    evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
  };

  const storyRes = await check("POST /api/stories returns 201 for a completed ResearchJob", async () => {
    const res = await http("POST", "/api/stories", {
      researchJobId,
      title: "Kubernetes scheduling is becoming an extension point",
      insightBody:
        "Scheduler plugins shipped as a stable extension point; control-plane capacity and cost signals are the practical follow-ons.",
      angles: ["Platform teams can own placement policy", "Cost is the next scheduling input"],
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.body.researchJobId === researchJobId, "wrong researchJobId");
    assert(res.body.status === "draft" && res.body.provenance === "researched", "wrong lifecycle");
    assert(res.body.interpretationMarked === true, "interpretation not marked");
    return withDetail(res, `story ${res.body.id}`);
  });
  const storyId = storyRes?.body?.id;
  assert(Number.isInteger(storyId), "harness error: story id was not captured");
  observed.storyId = storyId;

  await check("Story persisted with the correct researchJobId", async () => {
    const rows = await q("select * from stories where id = $1", [storyId]);
    assert(rows.length === 1, "story row missing");
    assert(rows[0].research_job_id === researchJobId, "research_job_id mismatch");
    assert(rows[0].evidence_refs.length >= 1, "no evidence refs");
    return `${rows[0].evidence_refs.length} evidence refs`;
  });

  await check("Story evidence refs resolve only to that ResearchJob's evidence", async () => {
    const [story] = await q("select evidence_refs from stories where id = $1", [storyId]);
    const valid = new Set(
      (await q("select id from research_evidence where job_id = $1", [researchJobId])).map((r) => r.id),
    );
    for (const ref of story.evidence_refs) {
      assert(valid.has(ref), `evidence ref ${ref} does not belong to job ${researchJobId}`);
    }
    return "all refs belong to this job";
  });

  await check("deriving a Story created no new research, source, or evidence", async () => {
    const after = {
      jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
      sources: (await q("select count(*)::int c from research_sources"))[0].c,
      evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
    };
    assert(after.jobs === before.jobs, `research_jobs ${before.jobs} -> ${after.jobs}`);
    assert(after.sources === before.sources, `sources ${before.sources} -> ${after.sources}`);
    assert(after.evidence === before.evidence, `evidence ${before.evidence} -> ${after.evidence}`);
    return "counts unchanged (no re-research)";
  });

  await check("GET /api/stories/:id returns the persisted Story", async () => {
    const res = await http("GET", `/api/stories/${storyId}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.id === storyId && res.body.researchJobId === researchJobId, "round-trip mismatch");
    return "round-trip ok";
  });

  // ── 3b. GOLDEN PATH ─────────────────────────────────────────────────────────
  phase("Golden path: Opportunity → GenerationJob → Artifact → approval → Schedule → Publication → Result");
  const researchBeforeGolden = {
    jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
    sources: (await q("select count(*)::int c from research_sources"))[0].c,
    evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
  };

  const opportunityRes = await check("POST /api/opportunities creates a direction from the Story", async () => {
    const res = await http("POST", "/api/opportunities", {
      storyId,
      concept: "scheduling is now a policy surface",
      objective: "educate platform engineers",
      angle: "placement decisions moved out of the scheduler binary",
      format: "x_post",
      channel: "x",
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.body.storyId === storyId, "wrong storyId");
    assert(res.body.status === "proposed", `status=${res.body.status}`);
    return withDetail(res, `opportunity ${res.body.id} (${res.body.format}×${res.body.channel})`);
  });
  const opportunityId = opportunityRes?.body?.id;
  assert(Number.isInteger(opportunityId), "harness error: opportunity id not captured");

  await check("POST /api/opportunities/:id/select selects it and marks the Story used", async () => {
    const res = await http("POST", `/api/opportunities/${opportunityId}/select`, {});
    assert(res.status === 200 && res.body.status === "selected", `${res.status}/${res.body?.status}`);
    const storyRes = await http("GET", `/api/stories/${storyId}`);
    assert(storyRes.body.status === "used", `story status=${storyRes.body.status}`);
    return "selected; Story marked used (informational, still reusable)";
  });

  const generationRes = await check("POST /api/generation-jobs persists and enqueues generation.run", async () => {
    const res = await http("POST", "/api/generation-jobs", { opportunityId });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.body.status === "queued", `status=${res.body.status}`);
    assert(typeof res.body.correlationId === "string", "no correlationId");
    assert(res.body.policySnapshot?.systemPrompt, "policy snapshot is not frozen");
    return withDetail(res, `generation job ${res.body.id} queued`);
  });
  const generationJobId = generationRes?.body?.id;
  observed.generationJobId = generationJobId;
  observed.goldenPolicyId = generationRes?.body?.policyId ?? null;
  assert(Number.isInteger(generationJobId), "harness error: generation job id not captured");

  const artifactCreated = await check("real generation worker produces an Artifact", async () => {
    const row = await waitFor(
      async () => {
        const res = await http("GET", `/api/generation-jobs/${generationJobId}`);
        if (res.body.status === "succeeded") return res.body;
        if (res.body.status === "failed") throw new Error(`generation failed: ${res.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "generation success" },
    );
    assert(Number.isInteger(row.artifactId), "no artifact produced");
    return withDetail({ id: row.artifactId, model: row.model }, `artifact ${row.artifactId} (model ${row.model})`);
  });
  const artifactId = artifactCreated?.id;
  observed.artifactId = artifactId;
  assert(Number.isInteger(artifactId), "harness error: artifact id not captured");

  await check("draft → in_review → approved, with the payload validated by the registry", async () => {
    const draft = await http("GET", `/api/artifacts/${artifactId}`);
    assert(draft.body.readiness === "draft", `readiness=${draft.body.readiness}`);
    assert(draft.body.format === "x_post", `format=${draft.body.format}`);
    assert(typeof draft.body.payload.text === "string" && draft.body.payload.text.length > 0, "no payload text");
    assert(Array.isArray(draft.body.attribution) && draft.body.attribution.length >= 1, "no attribution");

    const submit = await http("POST", `/api/artifacts/${artifactId}/submit-review`, {});
    assert(submit.body.readiness === "in_review", `readiness=${submit.body.readiness}`);
    const approve = await http("POST", `/api/artifacts/${artifactId}/approve`, {});
    assert(approve.body.readiness === "approved", `readiness=${approve.body.readiness}`);
    assert(approve.body.approvedAt, "no approvedAt");
    return "approved";
  });

  const scheduleRes = await check("POST /api/schedules pins the approved revision", async () => {
    const res = await http("POST", "/api/schedules", { artifactId });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.body.artifactId === artifactId, "wrong artifactId");
    return withDetail(res, `schedule ${res.body.id} (count ${res.body.count})`);
  });
  const scheduleId = scheduleRes?.body?.id;
  assert(Number.isInteger(scheduleId), "harness error: schedule id not captured");

  const publicationRes = await check("scheduler dispatch materializes an Occurrence and enqueues a Publication", async () => {
    const res = await http("POST", "/api/publications/dispatch", {});
    assert(res.status === 200, `dispatch returned ${res.status}: ${res.text}`);
    const mine = (res.body.publications ?? []).find((p) => p.scheduleId === scheduleId);
    assert(mine, "no Publication was created for this Schedule");
    assert(mine.artifactId === artifactId, "publication not pinned to the revision");
    return withDetail({ id: mine.id }, `publication ${mine.id} (occurrence ${mine.occurrenceId})`);
  });
  const publicationId = publicationRes?.id;
  observed.publicationId = publicationId;
  assert(Number.isInteger(publicationId), "harness error: publication id not captured");

  await check("publication worker publishes through the X adapter and records a Result", async () => {
    const row = await waitFor(
      async () => {
        const res = await http("GET", `/api/publications/${publicationId}`);
        if (res.body.state === "published") return res.body;
        if (res.body.state === "failed") throw new Error(`publication failed: ${res.body.lastError}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "publication" },
    );
    assert(row.externalId, "no external id recorded");
    assert(row.result && row.result.outcome === "published", "no published Result");
    assert(String(row.result.externalUrl).includes("x.com"), "no external URL");
    return `${row.externalId} → ${row.result.externalUrl}`;
  });

  await check("exactly one Result is durable per Publication", async () => {
    const res = await http("GET", `/api/publications/${publicationId}/result`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const rows = await q("select count(*)::int c from results where publication_id = $1", [publicationId]);
    assert(rows[0].c === 1, `result rows=${rows[0].c}`);
    return "1 result row";
  });

  await check("the whole golden path created no new research (format change never re-researches)", async () => {
    const after = {
      jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
      sources: (await q("select count(*)::int c from research_sources"))[0].c,
      evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
    };
    assert(after.jobs === researchBeforeGolden.jobs, `research_jobs ${researchBeforeGolden.jobs} → ${after.jobs}`);
    assert(after.sources === researchBeforeGolden.sources, "sources changed");
    assert(after.evidence === researchBeforeGolden.evidence, "evidence changed");
    return "research_jobs / research_sources / research_evidence unchanged";
  });

  // ── 4. FAILURE PATHS ────────────────────────────────────────────────────────
  phase("Failure paths over real HTTP");
  await check("POST /api/stories -> 400 on invalid input", async () => {
    const res = await http("POST", "/api/stories", { researchJobId, insightBody: "no title" });
    assert(res.status === 400, `expected 400, got ${res.status}`);
    return "400";
  });

  await check("POST /api/stories -> 404 for a missing ResearchJob", async () => {
    const res = await http("POST", "/api/stories", {
      researchJobId: 2_000_000_000,
      title: "x",
      insightBody: "y",
    });
    assert(res.status === 404, `expected 404, got ${res.status}`);
    return "404";
  });

  await setActiveFeed(`${FIXTURE_BASE}/slow.xml?delay=6000`);
  const slowJob = await createResearchJob({
    kind: "directed",
    query: "kubernetes",
    idempotencyKey: `${RUN}-slow`,
  });
  await check("POST /api/stories -> 409 for an incomplete ResearchJob", async () => {
    const row = await researchJobRow(slowJob.body.id);
    assert(["queued", "running"].includes(row.status), `status=${row.status}`);
    const res = await http("POST", "/api/stories", {
      researchJobId: slowJob.body.id,
      title: "x",
      insightBody: "y",
    });
    assert(res.status === 409, `expected 409, got ${res.status}: ${res.text}`);
    return `409 (job ${row.status})`;
  });
  await waitJobTerminal(slowJob.body.id, {
    timeoutMs: 60_000,
    intervalMs: 300,
    label: "slow job completion",
  });
  await setActiveFeed(`${FIXTURE_BASE}/feed.xml`);

  await check("POST /api/stories -> 422 for a complete job with no evidence", async () => {
    // Defensive branch: the engine never completes a job without evidence, so a
    // complete/no-evidence row is seeded directly to exercise the real route.
    const rows = await q(
      `insert into research_jobs (user_id, correlation_id, idempotency_key, kind, query, status, provider_ids, finished_at)
       values (1, $1, $2, 'directed', 'seeded', 'complete', '{rss}', now()) returning id`,
      [`${RUN}-noev-corr`, `${RUN}-noev-idem`],
    );
    const res = await http("POST", "/api/stories", {
      researchJobId: rows[0].id,
      title: "x",
      insightBody: "y",
    });
    assert(res.status === 422, `expected 422, got ${res.status}: ${res.text}`);
    return "422";
  });

  // ── 5. PERMANENT -> DLQ ─────────────────────────────────────────────────────
  phase("Queue: permanent failure -> DLQ (real pg-boss state)");
  await setActiveFeed(`${FIXTURE_BASE}/empty.xml`);
  const permJob = await createResearchJob({
    kind: "autonomous",
    query: "kubernetes",
    idempotencyKey: `${RUN}-permanent`,
  });
  await check("permanent failure marks the ResearchJob failed", async () => {
    const row = await waitFor(
      async () => {
        const r = await researchJobRow(permJob.body.id);
        return r?.status === "failed" ? r : false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "permanent failure" },
    );
    observed.permanentJobId = row.id;
    return `failed (${row.error_class})`;
  });

  await check("terminal failure reaches the dead-letter queue", async () => {
    const [permRow] = await q("select correlation_id from research_jobs where id = $1", [
      observed.permanentJobId,
    ]);
    const found = await waitFor(
      async () => {
        const rows = await deadLetterJobs();
        const match = rows.find((r) => r.corr === permRow.correlation_id);
        return match ? rows : false;
      },
      { timeoutMs: 60_000, intervalMs: 500, label: "DLQ record" },
    );
    const queues = await q("select name from pgboss.queue where name like '%.dlq'");
    assert(queues.length >= 1, "no DLQ queue registered");
    return `${queues[0].name} has the failed job (correlation ${permRow.correlation_id.slice(0, 8)}…)`;
  });

  await check("POST /api/stories -> 409 for a failed ResearchJob", async () => {
    const res = await http("POST", "/api/stories", {
      researchJobId: observed.permanentJobId,
      title: "x",
      insightBody: "y",
    });
    assert(res.status === 409, `expected 409, got ${res.status}`);
    return "409";
  });

  // ── 6. RESTART / RECOVERY ───────────────────────────────────────────────────
  phase("Restart/recovery: durable state survives a process kill");
  await setActiveFeed(`${FIXTURE_BASE}/slow.xml?delay=8000`);
  const restartJob = await createResearchJob({
    kind: "directed",
    query: "kubernetes",
    idempotencyKey: `${RUN}-restart`,
  });
  const restartJobId = restartJob.body.id;
  observed.restartJobId = restartJobId;

  const preKillRow = await researchJobRow(restartJobId);
  await killApp("SIGKILL");
  const atKill = await researchJobRow(restartJobId);
  record(
    "process killed; durable ResearchJob row survived",
    atKill && ["queued", "running"].includes(atKill.status),
    `status before=${preKillRow.status} at kill=${atKill?.status}`,
  );
  const queueAtKill = await queueJobFor(restartJobId);
  record(
    "pg-boss job row survived the kill",
    queueAtKill.length >= 1,
    `queue state=${queueAtKill[0]?.state ?? "missing"}`,
  );
  observed.stateAtKill = atKill?.status;
  observed.queueStateAtKill = queueAtKill[0]?.state;

  await startApp();
  // Re-isolate config: startup re-runs the seed, which re-adds the public catalog.
  await setActiveFeed(`${FIXTURE_BASE}/feed.xml`);
  record("application restarted", true, APP_BASE);

  await check("durable ResearchJob readable over HTTP after restart", async () => {
    const res = await http("GET", `/api/research/jobs/${restartJobId}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.correlationId === restartJob.body.correlationId, "correlation lost on restart");
    return `status=${res.body.status}, correlationId preserved`;
  });

  await check("Story created earlier still readable after restart", async () => {
    const res = await http("GET", `/api/stories/${storyId}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.id === storyId, "story changed across restart");
    return "story survived restart";
  });

  const recovered = await check("in-flight job continues/reconciles after restart", async () => {
    let path_ = "pg-boss re-delivered the surviving job";
    let row = await waitFor(
      async () => {
        const r = await researchJobRow(restartJobId);
        return r?.status === "complete" ? r : false;
      },
      { timeoutMs: 45_000, intervalMs: 500, label: "automatic recovery" },
    ).catch(() => undefined);

    if (!row) {
      path_ = "re-enqueued via durable idempotency (same ResearchJob id)";
      const again = await http("POST", "/api/research/jobs", {
        kind: "directed",
        query: "kubernetes",
        providerIds: ["rss"],
        idempotencyKey: `${RUN}-restart`,
      });
      assert(again.body.id === restartJobId, `idempotency produced new job ${again.body.id}`);
      row = await waitFor(
        async () => {
          const r = await researchJobRow(restartJobId);
          return r?.status === "complete" ? r : false;
        },
        { timeoutMs: 90_000, intervalMs: 500, label: "recovery completion" },
      ).catch(() => undefined);
    }

    if (!row) {
      // pg-boss may have parked the orphaned job until its retry delay elapses.
      path_ = "completed by the scheduled pg-boss retry after the orphaned lease expired";
      row = await waitFor(
        async () => {
          const r = await researchJobRow(restartJobId);
          return r?.status === "complete" ? r : false;
        },
        { timeoutMs: 6 * 60_000, intervalMs: 2_000, label: "scheduled retry recovery" },
      );
    }
    assert(row.status === "complete", `final status ${row.status}`);
    return path_;
  });
  observed.restartRecoveryPath = recovered;

  await check("the restarted worker runs generation.run for a brand-new job", async () => {
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "post-restart generation",
      objective: "prove the restarted worker registers generation.run",
      format: "x_post",
      channel: "x",
    });
    assert(opp.status === 201, `opportunity ${opp.status}: ${opp.text}`);
    const gen = await http("POST", "/api/generation-jobs", { opportunityId: opp.body.id });
    assert(gen.status === 201, `generation ${gen.status}: ${gen.text}`);
    const row = await waitFor(
      async () => {
        const res = await http("GET", `/api/generation-jobs/${gen.body.id}`);
        if (res.body.status === "succeeded") return res.body;
        if (res.body.status === "failed") throw new Error(`failed: ${res.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "post-restart generation" },
    );
    assert(Number.isInteger(row.artifactId), "no artifact after restart");
    return `artifact ${row.artifactId} produced by the restarted worker`;
  });

  // ── 6b. CREATION INTELLIGENCE (CannerAI parity phase 1) ─────────────────────
  phase("Creation intelligence: Voice / Template / Policy → multi-format, chat-to-post, failure");
  const researchBeforeCreation = {
    jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
    sources: (await q("select count(*)::int c from research_sources"))[0].c,
    evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
  };

  const voiceRes = await check("POST /api/voices persists a reusable voice", async () => {
    const res = await http("POST", "/api/voices", {
      name: `${RUN} direct`,
      tone: "technical, direct, no hype",
      doRules: ["lead with the point"],
      dontRules: ["no hype", "no emoji"],
      vocabulary: ["p99"],
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.body.id > 0, "no voice id");
    return withDetail({ id: res.body.id }, `voice ${res.body.id}`);
  });
  const voiceId = voiceRes?.id;
  assert(Number.isInteger(voiceId), "harness error: voice id not captured");

  const templateRes = await check("POST /api/templates persists a reusable structure", async () => {
    const res = await http("POST", "/api/templates", {
      name: `${RUN} hook-insight-takeaway`,
      description: "Hook → Insight → Takeaway",
      supportedFormats: ["x_post"],
      supportedChannels: ["x"],
      structure: [{ name: "hook" }, { name: "insight" }, { name: "takeaway" }],
      constraints: { maxCharacters: 240 },
      instructions: "Keep it tight; no filler.",
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    return withDetail({ id: res.body.id }, `template ${res.body.id}`);
  });
  const templateId = templateRes?.id;
  assert(Number.isInteger(templateId), "harness error: template id not captured");

  await check("a voice resolves to a distinct policy revision and reaches the prompt", async () => {
    const res = await http("POST", "/api/generation-jobs", { opportunityId, voiceId });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.body.policyId, "job does not pin a policy revision");
    assert(/no hype/.test(String(res.body.policySnapshot.systemPrompt)), "voice rules reached the prompt");
    assert(res.body.policyId && res.body.policyId !== observed.goldenPolicyId, "a different voice must be a different policy revision");

    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/generation-jobs/${res.body.id}`);
        if (r.body.status === "succeeded") return r.body;
        if (r.body.status === "failed") throw new Error(`failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "voiced generation" },
    );
    const art = await http("GET", `/api/artifacts/${row.artifactId}`);
    assert(art.body.readiness === "draft", `readiness=${art.body.readiness}`);
    observed.voiceJobId = res.body.id;
    return withDetail({ id: res.body.id }, `job ${res.body.id} → artifact ${row.artifactId} (policy ${res.body.policyId})`);
  });

  await check("a template flows into the policy and constrains the generation", async () => {
    const res = await http("POST", "/api/generation-jobs", { opportunityId, templateId });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(/hook → insight → takeaway/.test(String(res.body.policySnapshot.systemPrompt)), "template structure missing from the prompt");
    assert(/no filler/.test(String(res.body.policySnapshot.systemPrompt)), "template instructions missing from the prompt");
    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/generation-jobs/${res.body.id}`);
        if (r.body.status === "succeeded") return r.body;
        if (r.body.status === "failed") throw new Error(`failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "templated generation" },
    );
    observed.templateJobId = res.body.id;
    return withDetail({ id: res.body.id }, `job ${res.body.id} → artifact ${row.artifactId} (template ${templateId})`);
  });

  const threadArtifact = await check("the same Story produces an x_thread Artifact (multi-format)", async () => {
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "turn the story into a thread",
      objective: "educate",
      format: "x_thread",
      channel: "x",
    });
    assert(opp.status === 201, `opportunity ${opp.status}: ${opp.text}`);
    assert(opp.body.format === "x_thread", "wrong format");
    const gen = await http("POST", "/api/generation-jobs", { opportunityId: opp.body.id });
    assert(gen.status === 201, `generation ${gen.status}: ${gen.text}`);
    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/generation-jobs/${gen.body.id}`);
        if (r.body.status === "succeeded") return r.body;
        if (r.body.status === "failed") throw new Error(`failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "thread generation" },
    );
    const art = await http("GET", `/api/artifacts/${row.artifactId}`);
    assert(art.body.format === "x_thread", `format=${art.body.format}`);
    assert(Array.isArray(art.body.payload.units) && art.body.payload.units.length >= 1, "thread payload shape");
    return withDetail({ id: row.artifactId }, `artifact ${row.artifactId} (x_thread, ${art.body.payload.units.length} units)`);
  });
  observed.threadArtifactId = threadArtifact?.id;

  await check("every derivation reused the same research (no re-research)", async () => {
    const after = {
      jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
      sources: (await q("select count(*)::int c from research_sources"))[0].c,
      evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
    };
    assert(after.jobs === researchBeforeCreation.jobs && after.sources === researchBeforeCreation.sources && after.evidence === researchBeforeCreation.evidence, `research rows changed: ${JSON.stringify(after)} vs ${JSON.stringify(researchBeforeCreation)}`);
    const policies = await q("select count(*)::int c from generation_policies");
    assert(policies[0].c >= 3, `expected >=3 policy revisions, got ${policies[0].c}`);
    return `research unchanged; ${policies[0].c} policy revisions`;
  });

  await check("chat-to-post becomes a normal Story → Opportunity → GenerationJob → Artifact", async () => {
    const res = await http("POST", "/api/generation/chat", {
      message: "write a post explaining that Kubernetes scheduling is now a platform-owned policy surface",
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.body.storyCreated === true, "chat should create a human Story");
    assert(res.body.opportunity?.id > 0, "no opportunity");
    assert(res.body.generationJobId > 0, "no generation job");
    assert(/[0-9a-f-]{8}/.test(String(res.body.correlationId)), "no correlation id");

    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/generation-jobs/${res.body.generationJobId}`);
        if (r.body.status === "succeeded") return r.body;
        if (r.body.status === "failed") throw new Error(`failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "chat generation" },
    );
    const art = await http("GET", `/api/artifacts/${row.artifactId}`);
    assert(art.body.opportunityId === res.body.opportunity.id, "artifact not from the chat opportunity");
    // A human Story has no evidence → attribution is explicit, never faked.
    assert(Array.isArray(art.body.attribution) && art.body.attribution.length === 0, "human Story should carry no evidence attribution");
    assert(Boolean(art.body.attributionReason), "no attribution reason");
    return `chat → story ${res.body.storyId} → opportunity ${res.body.opportunity.id} → artifact ${row.artifactId}`;
  });

  await check("an invalid model payload fails validation terminally with no Artifact", async () => {
    await fixturePost("/control/invalid-next", {});
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "invalid payload probe",
      objective: "prove validation",
      format: "x_thread",
      channel: "x",
    });
    assert(opp.status === 201, `opportunity ${opp.status}: ${opp.text}`);
    const gen = await http("POST", "/api/generation-jobs", { opportunityId: opp.body.id });
    assert(gen.status === 201, `generation ${gen.status}: ${gen.text}`);

    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/generation-jobs/${gen.body.id}`);
        if (r.body.status === "failed") return r.body;
        if (r.body.status === "succeeded") throw new Error("expected a validation failure but the job succeeded");
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "validation failure" },
    );
    assert(row.errorClass === "permanent", `errorClass=${row.errorClass}`);
    assert(/payload|units/i.test(String(row.errorMessage)), `unexpected message: ${row.errorMessage}`);
    assert(row.artifactId === null, "no artifact may be created from an invalid payload");
    return `permanent validation failure (${String(row.errorMessage).slice(0, 60)}…)`;
  });

  await check("a queued GenerationJob survives a process restart and completes", async () => {
    await fixturePost("/control/model-delay", { ms: 6000 });
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "restart-survival probe",
      objective: "prove recovery",
      format: "x_post",
      channel: "x",
    });
    const gen = await http("POST", "/api/generation-jobs", { opportunityId: opp.body.id });
    const jobId = gen.body.id;
    const correlation = gen.body.correlationId;
    await fixturePost("/control/model-delay", { ms: 0 });

    await killApp("SIGKILL");
    const [atKill] = await q("select status, correlation_id from generation_jobs where id = $1", [jobId]);
    record(
      "GenerationJob row survived the kill",
      atKill && ["queued", "running"].includes(atKill.status),
      `status=${atKill?.status}, correlation preserved=${atKill?.correlation_id === correlation}`,
    );

    await startApp();
    await setActiveFeed(`${FIXTURE_BASE}/feed.xml`);
    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/generation-jobs/${jobId}`);
        if (r.body.status === "succeeded") return r.body;
        if (r.body.status === "failed") throw new Error(`failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 120_000, intervalMs: 500, label: "post-restart generation job" },
    );
    assert(Number.isInteger(row.artifactId), "no artifact after restart");
    return `job ${jobId} completed after restart → artifact ${row.artifactId}`;
  });

  // ── 6c. PHASE 1.5 RED ARROWS ────────────────────────────────────────────────
  phase("Phase 1.5: artifact revisions, version pinning, chat idempotency, scheduler tick");

  const revisionChain = await check("generate → approve rev1 → human-edit rev2 (rev1 untouched, rev2 unapproved)", async () => {
    // A fresh Opportunity so the first artifact of this chain has no predecessor.
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "revision workflow probe",
      objective: "prove artifact revisions",
      format: "x_post",
      channel: "x",
    });
    assert(opp.status === 201, `opportunity ${opp.status}: ${opp.text}`);

    const gen = await http("POST", "/api/generation-jobs", { opportunityId: opp.body.id, voiceId });
    assert(gen.status === 201, `generation ${gen.status}: ${gen.text}`);
    const done = await waitFor(
      async () => {
        const r = await http("GET", `/api/generation-jobs/${gen.body.id}`);
        if (r.body.status === "succeeded") return r.body;
        if (r.body.status === "failed") throw new Error(`failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "revision generation" },
    );
    const v1 = done.artifactId;

    await http("POST", `/api/artifacts/${v1}/submit-review`, {});
    const approved = await http("POST", `/api/artifacts/${v1}/approve`, {});
    assert(approved.body.readiness === "approved", `rev1 readiness=${approved.body.readiness}`);
    const payloadV1 = JSON.stringify(approved.body.payload);

    const rev = await http("POST", `/api/artifacts/${v1}/revise`, {
      baseArtifactId: v1,
      payload: { text: "A hand-edited post body." },
      attributionReason: "human edit",
    });
    assert(rev.status === 201, `revise ${rev.status}: ${rev.text}`);
    assert(rev.body.supersedesId === v1, "supersedes_id must point at revision 1");
    assert(rev.body.readiness === "draft", "approval must not be carried to the new revision");
    assert(rev.body.provenance === "human_edit", `provenance=${rev.body.provenance}`);

    const v1After = await http("GET", `/api/artifacts/${v1}`);
    assert(v1After.body.readiness === "approved", "revision 1 must stay approved");
    assert(JSON.stringify(v1After.body.payload) === payloadV1, "revision 1 content must be immutable");

    const history = await http("GET", `/api/artifacts/${rev.body.id}/history`);
    assert(Array.isArray(history.body) && history.body.length === 2, `history length ${history.body?.length}`);
    assert(history.body[0].id === v1 && history.body[1].id === rev.body.id, "history chain order");

    const stale = await http("POST", `/api/artifacts/${v1}/revise`, {
      baseArtifactId: v1 + 999_999,
      payload: { text: "stale" },
    });
    assert(stale.status === 409, `a stale base must be 409, got ${stale.status}`);

    return withDetail({ v1, v2: rev.body.id }, `rev1 ${v1} approved → rev2 ${rev.body.id} draft (chain of 2)`);
  });
  const revisionV1 = revisionChain?.v1;
  const revisionV2 = revisionChain?.v2;

  await check("the real periodic scheduler tick enqueues and publishes revision 2", async () => {
    await http("POST", `/api/artifacts/${revisionV2}/submit-review`, {});
    const approved = await http("POST", `/api/artifacts/${revisionV2}/approve`, {});
    assert(approved.body.readiness === "approved", `rev2 readiness=${approved.body.readiness}`);

    const sched = await http("POST", "/api/schedules", { artifactId: revisionV2 });
    assert(sched.status === 201, `schedule ${sched.status}: ${sched.text}`);

    // Deliberately NOT calling /publications/dispatch: the cron tick must do it.
    const publication = await waitFor(
      async () => {
        const rows = await q("select id from publications where schedule_id = $1", [sched.body.id]);
        return rows.length > 0 ? rows[0] : false;
      },
      { timeoutMs: 120_000, intervalMs: 2_000, label: "content scheduler cron tick" },
    );

    const published = await waitFor(
      async () => {
        const res = await http("GET", `/api/publications/${publication.id}`);
        if (res.body.state === "published") return res.body;
        if (res.body.state === "failed") throw new Error(`publication failed: ${res.body.lastError}`);
        return false;
      },
      { timeoutMs: 60_000, intervalMs: 500, label: "publication run" },
    );
    assert(published.artifactId === revisionV2, "publication must pin revision 2");
    assert(published.artifactId !== revisionV1, "the old revision must not be the one published");
    assert(published.result?.outcome === "published", "no published Result");
    return `cron tick → publication ${publication.id} → published (revision ${revisionV2})`;
  });

  await check("a template revision does not change an existing GenerationJob's snapshot", async () => {
    const before = await http("GET", `/api/generation-jobs/${observed.templateJobId}`);
    const snapshotBefore = JSON.stringify(before.body.policySnapshot);

    const revised = await http("POST", `/api/templates/${templateId}/revise`, {
      instructions: "even tighter",
      constraints: { maxCharacters: 200 },
    });
    assert(revised.status === 201, `revise ${revised.status}: ${revised.text}`);
    assert(revised.body.version === 2, `version=${revised.body.version}`);
    assert(revised.body.templateKey, "revision must keep the template key");

    const after = await http("GET", `/api/generation-jobs/${observed.templateJobId}`);
    assert(
      JSON.stringify(after.body.policySnapshot) === snapshotBefore,
      "editing a template must not change an existing job's frozen request",
    );

    const revisions = await http("GET", `/api/templates/${templateId}/revisions`);
    assert(revisions.body.length === 2, `expected 2 template revisions, got ${revisions.body.length}`);
    const archived = await http("POST", `/api/templates/${revised.body.id}/archive`, {});
    assert(archived.body.status === "archived", "archive is a lifecycle flag");
    return `template v2 created and archived; job ${observed.templateJobId} snapshot unchanged`;
  });

  await check("a voice revision does not change an existing GenerationJob's snapshot", async () => {
    const before = await http("GET", `/api/generation-jobs/${observed.voiceJobId}`);
    const snapshotBefore = JSON.stringify(before.body.policySnapshot);

    const revised = await http("POST", `/api/voices/${voiceId}/revise`, {
      tone: "warmer, more reflective",
    });
    assert(revised.status === 201, `revise ${revised.status}: ${revised.text}`);
    assert(revised.body.version === 2, `version=${revised.body.version}`);

    const after = await http("GET", `/api/generation-jobs/${observed.voiceJobId}`);
    assert(
      JSON.stringify(after.body.policySnapshot) === snapshotBefore,
      "editing a voice must not change an existing job's frozen request",
    );
    return `voice v2 created; job ${observed.voiceJobId} snapshot unchanged`;
  });

  await check("a duplicate chat request is idempotent; an explicit regeneration is not", async () => {
    const key = `${RUN}-chat-idem`;
    const first = await http("POST", "/api/generation/chat", {
      message: "write about scheduler plugins",
      idempotencyKey: key,
    });
    assert(first.status === 201, `chat ${first.status}: ${first.text}`);
    assert(first.body.reused === false, "first request is not a reuse");

    const duplicate = await http("POST", "/api/generation/chat", {
      message: "write about scheduler plugins",
      idempotencyKey: key,
    });
    assert(duplicate.body.reused === true, "the duplicate must be reported as reused");
    assert(duplicate.body.opportunity.id === first.body.opportunity.id, "duplicate created a new Opportunity");
    assert(duplicate.body.generationJobId === first.body.generationJobId, "duplicate created a new GenerationJob");

    const regen = await http("POST", "/api/generation/chat", {
      message: "write about scheduler plugins",
      idempotencyKey: key,
      regenerate: true,
    });
    assert(regen.body.opportunity.id === first.body.opportunity.id, "regeneration must stay on the same Opportunity");
    assert(regen.body.generationJobId !== first.body.generationJobId, "regeneration must create a new GenerationJob");

    const jobs = await q("select count(*)::int c from generation_jobs where opportunity_id = $1", [
      first.body.opportunity.id,
    ]);
    assert(jobs[0].c === 2, `expected 2 jobs for the chat opportunity, got ${jobs[0].c}`);
    return `idempotent (job ${first.body.generationJobId}) then regenerated (job ${regen.body.generationJobId})`;
  });

  // ── Phase 4: recurrence — durable, bounded catch-up, restart-safe ───────────
  phase("Phase 4: recurring Schedule -> bounded catch-up -> restart-safe -> Result, no regeneration");

  const recurringArtifact = await check("one approved Artifact revision pinned for the whole recurring series", async () => {
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "recurrence probe",
      objective: "prove bounded catch-up",
      format: "x_post",
      channel: "x",
    });
    assert(opp.status === 201, `opportunity ${opp.status}: ${opp.text}`);
    const gen = await http("POST", "/api/generation-jobs", { opportunityId: opp.body.id });
    assert(gen.status === 201, `generation ${gen.status}: ${gen.text}`);
    const done = await waitFor(
      async () => {
        const r = await http("GET", `/api/generation-jobs/${gen.body.id}`);
        if (r.body.status === "succeeded") return r.body;
        if (r.body.status === "failed") throw new Error(`failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "recurrence-probe generation" },
    );
    await http("POST", `/api/artifacts/${done.artifactId}/submit-review`, {});
    const approved = await http("POST", `/api/artifacts/${done.artifactId}/approve`, {});
    assert(approved.body.readiness === "approved", `readiness=${approved.body.readiness}`);
    return withDetail({ id: done.artifactId, payload: approved.body.payload }, `artifact ${done.artifactId} approved`);
  });
  const recurringArtifactId = recurringArtifact?.id;
  observed.recurringArtifactId = recurringArtifactId;

  await check("POST /api/schedules rejects malformed recurrence and never persists a row", async () => {
    const res = await http("POST", "/api/schedules", {
      artifactId: recurringArtifactId,
      recurrence: "daily",
      count: 3,
    });
    assert(res.status === 400, `expected 400, got ${res.status}: ${res.text}`);
    const rows = await q("select count(*)::int c from schedules where artifact_id = $1", [recurringArtifactId]);
    assert(rows[0].c === 0, "an invalid recurring schedule must never be persisted");
    return "400, nothing persisted";
  });

  const recurringScheduleRes = await check(
    "POST /api/schedules persists a 3-slot hourly series, 5 hours in the past (simulated long-offline start)",
    async () => {
      const startAt = new Date(Date.now() - 5 * 3_600_000).toISOString();
      const res = await http("POST", "/api/schedules", {
        artifactId: recurringArtifactId,
        recurrence: "every:1h",
        count: 3,
        startAt,
      });
      assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
      assert(res.body.recurrence === "every:1h", `recurrence=${res.body.recurrence}`);
      assert(res.body.count === 3, `count=${res.body.count}`);
      return withDetail(res, `schedule ${res.body.id}, all 3 slots already due`);
    },
  );
  const recurringScheduleId = recurringScheduleRes?.body?.id;
  assert(Number.isInteger(recurringScheduleId), "harness error: recurring schedule id not captured");

  await check(
    "bounded catch-up: 3 overdue slots, one dispatch tick materializes exactly one, not all three",
    async () => {
      const before = await q("select count(*)::int c from schedule_occurrences where schedule_id = $1", [
        recurringScheduleId,
      ]);
      assert(before[0].c === 0, "no occurrence should exist before the first tick");

      const res = await http("POST", "/api/publications/dispatch", {});
      assert(res.status === 200, `dispatch returned ${res.status}: ${res.text}`);

      const after1 = await q(
        "select occurrence_time from schedule_occurrences where schedule_id = $1 order by occurrence_time",
        [recurringScheduleId],
      );
      assert(after1.length === 1, `expected exactly 1 occurrence after one tick, got ${after1.length}`);
      return "1 of 3 overdue slots materialized";
    },
  );

  // ── restart mid-series: the durable cursor (count of occurrences already
  // materialized) must survive the process kill with no in-memory state ──────
  await killApp("SIGKILL");
  await startApp();
  await setActiveFeed(`${FIXTURE_BASE}/feed.xml`);

  await check("after restart: a second tick catches up slot 2 of 3, still not slot 3", async () => {
    const res = await http("POST", "/api/publications/dispatch", {});
    assert(res.status === 200, `dispatch returned ${res.status}: ${res.text}`);
    const rows = await q(
      "select occurrence_time from schedule_occurrences where schedule_id = $1 order by occurrence_time",
      [recurringScheduleId],
    );
    assert(rows.length === 2, `expected exactly 2 occurrences after restart + 2nd tick, got ${rows.length}`);
    const deltaMs = new Date(rows[1].occurrence_time).getTime() - new Date(rows[0].occurrence_time).getTime();
    assert(deltaMs === 3_600_000, `expected a 1h gap between slots, got ${deltaMs}ms`);
    return "recurrence cursor (derived from durable row count) survived the restart";
  });

  await check("concurrent dispatch ticks on the recurring schedule never double-materialize a slot", async () => {
    const [r1, r2, r3] = await Promise.all([
      http("POST", "/api/publications/dispatch", {}),
      http("POST", "/api/publications/dispatch", {}),
      http("POST", "/api/publications/dispatch", {}),
    ]);
    assert([r1, r2, r3].every((r) => r.status === 200), "all concurrent ticks must succeed (idempotent)");
    const rows = await q("select id from schedule_occurrences where schedule_id = $1", [recurringScheduleId]);
    assert(rows.length === 3, `expected exactly 3 occurrences (series bounded by count), got ${rows.length}`);
    const sched = await http("GET", `/api/schedules/${recurringScheduleId}`).catch(() => null);
    if (sched && sched.status === 200) {
      assert(sched.body.status === "exhausted", `expected exhausted, got ${sched.body.status}`);
    } else {
      const row = await q("select status from schedules where id = $1", [recurringScheduleId]);
      assert(row[0].status === "exhausted", `expected exhausted, got ${row[0].status}`);
    }
    return "3/3 slots, series exhausted, one unique row per slot under concurrent ticks";
  });

  await check("every occurrence publishes the SAME pinned Artifact revision — no regeneration per slot", async () => {
    const pubs = await q(
      "select artifact_id from publications where schedule_id = $1",
      [recurringScheduleId],
    );
    assert(pubs.length === 3, `expected 3 publications, got ${pubs.length}`);
    for (const row of pubs) {
      assert(row.artifact_id === recurringArtifactId, "recurrence must never regenerate/re-point content");
    }
    const results_ = await waitFor(
      async () => {
        const rows = await q(
          "select r.outcome from publications p join results r on r.publication_id = p.id where p.schedule_id = $1",
          [recurringScheduleId],
        );
        return rows.length === 3 ? rows : false;
      },
      { timeoutMs: 90_000, intervalMs: 500, label: "3 recurring publications reaching a Result" },
    );
    assert(results_.every((r) => r.outcome === "published"), "every recurring slot must reach a published Result");

    const researchCounts = await q("select count(*)::int c from research_jobs");
    return `3 Publications -> 3 Results, all pinned to artifact ${recurringArtifactId} (research_jobs=${researchCounts[0].c}, unchanged by recurrence)`;
  });

  // ── 6d. PHASE 2 RED ARROWS (research intelligence expansion) ────────────────
  phase("Phase 2: mixed-provider research, capability surface, SSRF boundary, no re-research");

  await check("GET /api/research/providers exposes the capability/access surface", async () => {
    const res = await http("GET", "/api/research/providers");
    assert(res.status === 200, `providers ${res.status}`);
    const byId = new Map((res.body.providers ?? []).map((p) => [p.id, p]));
    for (const id of ["rss", "reddit", "youtube", "hn", "web"]) {
      assert(byId.has(id), `provider "${id}" is not registered`);
      assert(byId.get(id).accessClass === "open", `${id} access class`);
    }
    const youtube = byId.get("youtube");
    assert(
      youtube.capabilities.length === 1 && youtube.capabilities[0] === "discover",
      `youtube is metadata-only (no fetch), got ${JSON.stringify(youtube.capabilities)}`,
    );
    const web = byId.get("web");
    assert(web.capabilities.includes("search") && web.capabilities.includes("fetch"), "web capabilities");
    return `5 providers: ${Array.from(byId.keys()).join(", ")}`;
  });

  const mixed = await check("a mixed-provider directed job yields ONE ResearchJob with aggregated evidence", async () => {
    const before = {
      jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
      sources: (await q("select count(*)::int c from research_sources"))[0].c,
      evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
    };
    const res = await http("POST", "/api/research/jobs", {
      kind: "directed",
      query: "kubernetes",
      providerIds: ["rss", "reddit", "hn", "web"],
      idempotencyKey: `${RUN}-mixed`,
      providerConfig: {
        reddit: { subreddits: ["kubernetes"] },
        web: { urls: [`${FIXTURE_BASE}/web/doc.html`] },
      },
    });
    assert(res.status === 201, `create ${res.status}: ${res.text}`);
    const jobId = res.body.id;

    const done = await waitFor(
      async () => {
        const r = await http("GET", `/api/research/jobs/${jobId}`);
        if (r.body.status === "complete") return r.body;
        if (r.body.status === "failed") throw new Error(`research failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "mixed research" },
    );

    const sources = await q("select provider, count(*)::int c from research_sources where job_id = $1 group by provider order by provider", [jobId]);
    const providers = sources.map((r) => r.provider);
    for (const id of ["rss", "reddit", "hn", "web"]) {
      assert(providers.includes(id), `no source from provider "${id}" (got ${providers.join(",")})`);
    }
    assert(done.sourceCount >= 5, `expected >=5 sources, got ${done.sourceCount}`);
    assert(done.evidenceCount >= 5, `expected >=5 evidence rows, got ${done.evidenceCount}`);

    const after = {
      jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
      sources: (await q("select count(*)::int c from research_sources"))[0].c,
      evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
    };
    assert(after.jobs === before.jobs + 1, `expected exactly one new ResearchJob (${before.jobs} -> ${after.jobs})`);

    observed.mixedJobId = jobId;
    return withDetail(
      { id: jobId },
      `job ${jobId}: ${done.sourceCount} sources from ${providers.join("+")}, ${done.evidenceCount} evidence`,
    );
  });
  const mixedJobId = mixed?.id;

  await check("an autonomous job discovers across providers (youtube discover path)", async () => {
    const res = await http("POST", "/api/research/jobs", {
      kind: "autonomous",
      query: "kubernetes platform engineering",
      providerIds: ["rss", "youtube"],
      idempotencyKey: `${RUN}-autonomous`,
      providerConfig: { youtube: { channelIds: ["fixture-channel"] } },
    });
    assert(res.status === 201, `create ${res.status}: ${res.text}`);
    const done = await waitFor(
      async () => {
        const r = await http("GET", `/api/research/jobs/${res.body.id}`);
        if (r.body.status === "complete") return r.body;
        if (r.body.status === "failed") throw new Error(`research failed: ${r.body.errorMessage}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "autonomous research" },
    );
    const sources = await q("select provider from research_sources where job_id = $1", [res.body.id]);
    const providers = sources.map((r) => r.provider);
    assert(providers.includes("youtube"), `no youtube source (got ${providers.join(",")})`);
    assert(providers.includes("rss"), "no rss source");
    return `job ${res.body.id}: ${done.sourceCount} sources (${providers.join("+")})`;
  });

  await check("the SSRF boundary refuses a metadata URL in the live app, with no fabricated evidence", async () => {
    const res = await http("POST", "/api/research/jobs", {
      kind: "directed",
      query: "metadata probe",
      providerIds: ["web"],
      idempotencyKey: `${RUN}-ssrf`,
      providerConfig: { web: { urls: ["http://169.254.169.254/latest/meta-data/"] } },
    });
    assert(res.status === 201, `create ${res.status}: ${res.text}`);
    const jobId = res.body.id;

    const failed = await waitFor(
      async () => {
        const r = await http("GET", `/api/research/jobs/${jobId}`);
        if (r.body.status === "failed") return r.body;
        if (r.body.status === "complete") throw new Error("a blocked URL must not complete successfully");
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "ssrf refusal" },
    );
    assert(failed.errorClass === "permanent", `expected a permanent failure, got ${failed.errorClass}`);
    const rows = await q("select count(*)::int c from research_sources where job_id = $1", [jobId]);
    assert(rows[0].c === 0, `no source may be fabricated for a blocked URL (got ${rows[0].c})`);
    const evidence = await q("select count(*)::int c from research_evidence where job_id = $1", [jobId]);
    assert(evidence[0].c === 0, `no evidence may be fabricated for a blocked URL (got ${evidence[0].c})`);
    return "blocked at the boundary → permanent failure, 0 sources, 0 evidence";
  });

  await check("GET /api/research/jobs lists recent research (owner scoped)", async () => {
    const res = await http("GET", "/api/research/jobs?limit=10");
    assert(res.status === 200, `list ${res.status}`);
    assert(Array.isArray(res.body), "expected an array");
    assert(res.body.length > 0, "expected at least one job");
    assert(res.body.every((j) => typeof j.id === "number" && typeof j.status === "string"), "job shape");
    return `${res.body.length} recent job(s)`;
  });

  await check("the mixed research becomes a Story, then two formats, with NO re-research", async () => {
    const before = {
      jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
      sources: (await q("select count(*)::int c from research_sources"))[0].c,
      evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
    };

    const story = await http("POST", "/api/stories", {
      researchJobId: mixedJobId,
      title: "Platform-owned scheduling: what Reddit, HN and the web agree on",
      insightBody: "Scheduler plugins are stable, cost is the next scheduling input.",
      angles: ["Platform teams own placement policy", "Cost as a scheduling signal"],
    });
    assert(story.status === 201, `story ${story.status}: ${story.text}`);
    const storyId = story.body.id;

    const post = await http("POST", "/api/opportunities", {
      storyId,
      concept: "short post",
      objective: "educate",
      format: "x_post",
      channel: "x",
    });
    const thread = await http("POST", "/api/opportunities", {
      storyId,
      concept: "thread",
      objective: "educate",
      format: "x_thread",
      channel: "x",
    });
    assert(post.status === 201 && thread.status === 201, "opportunities created");

    for (const opp of [post.body.id, thread.body.id]) {
      const gen = await http("POST", "/api/generation-jobs", { opportunityId: opp });
      assert(gen.status === 201, `generation ${gen.status}: ${gen.text}`);
      await waitFor(
        async () => {
          const r = await http("GET", `/api/generation-jobs/${gen.body.id}`);
          if (r.body.status === "succeeded") return r.body;
          if (r.body.status === "failed") throw new Error(`generation failed: ${r.body.errorMessage}`);
          return false;
        },
        { timeoutMs: 90_000, intervalMs: 300, label: "generation" },
      );
    }

    const after = {
      jobs: (await q("select count(*)::int c from research_jobs"))[0].c,
      sources: (await q("select count(*)::int c from research_sources"))[0].c,
      evidence: (await q("select count(*)::int c from research_evidence"))[0].c,
    };
    assert(
      after.jobs === before.jobs && after.sources === before.sources && after.evidence === before.evidence,
      `deriving content must not re-run research: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    );
    return `mixed research → story ${storyId} → x_post + x_thread, research unchanged`;
  });

  // ── 7. TRANSIENT RETRY SUCCESS (awaited) ────────────────────────────────────
  phase("Queue: transient retry -> eventual success on the same ResearchJob");
  await check("the real pg-boss retry succeeds on the same ResearchJob", async () => {
    try {
      const row = await waitFor(
        async () => {
          const r = await researchJobRow(transientJobId);
          return r?.status === "complete" ? r : false;
        },
        // Generous: the pg-boss backoff is ~5-7 min, and this machine has been
        // observed to freeze the app process for several minutes at a time.
        { timeoutMs: 25 * 60_000, intervalMs: 2_000, label: "transient retry success" },
      );
      const evidence = await q(
        "select count(*)::int c from research_evidence where job_id = $1",
        [transientJobId],
      );
      assert(evidence[0].c >= 1, "no evidence after retry");
      return `same ResearchJob ${row.id} completed on retry with ${evidence[0].c} evidence rows`;
    } catch (error) {
      const queue = await queueJobFor(transientJobId).catch(() => []);
      throw new Error(
        `${error.message}; queue state=${queue[0]?.state ?? "missing"} start_after=${queue[0]?.start_after?.toISOString?.() ?? "?"}`,
      );
    }
  });

  // ── 8. OBSERVABILITY ────────────────────────────────────────────────────────
  phase("Observability: end-to-end correlation");
  await check("HTTP -> ResearchJob -> pg-boss -> worker share one correlation id", async () => {
    const [job] = await q("select id, correlation_id from research_jobs where id = $1", [researchJobId]);
    const queue = await queueJobFor(researchJobId);
    const sources = (await q("select count(*)::int c from research_sources where job_id = $1", [researchJobId]))[0].c;
    const evidence = (await q("select count(*)::int c from research_evidence where job_id = $1", [researchJobId]))[0].c;
    const logs = readFileSync(appLogPath, "utf8");
    assert(logs.includes(observed.correlationId), "correlation id absent from app logs");
    assert(queue[0]?.corr === observed.correlationId, "queue envelope correlation mismatch");

    console.log(`
  POST /api/research/jobs
        |
        +-- ResearchJob:    ${job.id}
        +-- correlationId:  ${job.correlation_id}
        |
        v
  pg-boss            (queue job ${queue[0].id}, state ${queue[0].state})
        |
        v
  research.run       (real worker)
        |
        v
  RSS provider        (fixture feed over real HTTP)
        |
        v
  ResearchEngine
        |
        +-- research_sources:  ${sources}
        +-- research_evidence: ${evidence}
        |
        v
  ResearchJob: complete
        |
        v
  Story ${storyId}   (researchJobId ${researchJobId}, no re-research)`);
    return "correlation id present in HTTP response, DB row, queue envelope, and app logs";
  });

  // ── 9. EXTERNAL SMOKE (optional, non-gating) ────────────────────────────────
  phase("External smoke (optional, non-gating)");
  try {
    const external = "https://hnrss.org/newest?points=100";
    await setActiveFeed(external);
    const res = await http("POST", "/api/research/jobs", {
      kind: "autonomous",
      query: "engineering",
      providerIds: ["rss"],
      idempotencyKey: `${RUN}-external`,
    });
    const row = await waitFor(
      async () => {
        const r = await researchJobRow(res.body.id);
        return r && !["queued", "running"].includes(r.status) ? r : false;
      },
      { timeoutMs: 120_000, intervalMs: 1_000, label: "external research" },
    );
    if (row.status === "complete") {
      const sources = await q("select count(*)::int c from research_sources where job_id = $1", [row.id]);
      inform("real external RSS (hnrss.org)", `complete, ${sources[0].c} sources persisted`);
    } else {
      inform("real external RSS (hnrss.org)", `status=${row.status} (${row.error_class}): ${(row.error_message ?? "").slice(0, 140)}`);
    }
  } catch (error) {
    inform("real external RSS (hnrss.org)", `unavailable in this environment: ${error.message}`);
  }
  await setActiveFeed(`${FIXTURE_BASE}/feed.xml`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${"=".repeat(76)}`);
  console.log(`LIVE E2E SUMMARY — ${passed} passed, ${failed} failed (${results.length} checks)`);
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
    stopFixture();
    if (pool) await pool.end().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
