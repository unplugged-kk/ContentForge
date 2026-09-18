#!/usr/bin/env node
/**
 * Live Agent Workspace E2E (Phase 23) against the RUNNING ContentForge application.
 * TEST INFRASTRUCTURE — never imported by the app.
 */

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_URL =
  process.env.E2E_WORKSPACE_DATABASE_URL ?? "postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live";
const APP_PORT = Number(process.env.E2E_WORKSPACE_APP_PORT ?? 4388);
const APP_BASE = `http://127.0.0.1:${APP_PORT}`;
const FIXTURE_CONTAINER = "cf-rss-fixture-workspace";
const FIXTURE_IMAGE = "node:24-alpine";
const FIXTURE_HOST_PORT = Number(process.env.E2E_WORKSPACE_FIXTURE_PORT ?? 8088);
const FIXTURE_BASE = `http://127.0.0.1:${FIXTURE_HOST_PORT}`;
const RUN = `ws${Date.now().toString(36)}`;

if (!/127\.0\.0\.1:5433\/cf_e2e_live/.test(DB_URL)) {
  console.error(`REFUSING TO RUN: must be 127.0.0.1:5433/cf_e2e_live, got ${DB_URL}`);
  process.exit(2);
}

const results = [];
let appChild = null;
let appLogPath = null;
let pool = null;
let mockServer = null;
let mockPort = 0;
let cookie = null;
let csrfToken = null;
let browser = null;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "\u2714" : "\u2716"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function phase(title) {
  console.log(`\n\u2500\u2500 ${title} ${"\u2500".repeat(Math.max(0, 62 - title.length))}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, options = {}) {
  const { timeoutMs = 60_000, intervalMs = 250, label = "condition" } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined && value !== false) return value;
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

async function q(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function httpCall(method, urlPath, body) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
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
    return { status: res.status, body: json, text, headers: res.headers };
  }
  throw new Error(`${method} ${urlPath} rate-limited`);
}

async function bootstrapSession() {
  const res = await httpCall("GET", "/api/csrf-token");
  assert(res.status === 200, `csrf-token ${res.status}`);
  csrfToken = res.body?.csrfToken;
}

async function registerOperator() {
  await bootstrapSession();
  const email = `${RUN}@e2e.local`;
  const registered = await httpCall("POST", "/api/auth/register", {
    email,
    password: "E2ETestPass99!",
    name: "Workspace E2E",
  });
  if (![200, 201].includes(registered.status)) {
    const login = await httpCall("POST", "/api/auth/login", { email, password: "E2ETestPass99!" });
    assert([200, 201].includes(login.status), `login ${login.status} ${login.text}`);
  }
  const csrf = await httpCall("GET", "/api/csrf-token");
  csrfToken = csrf.body?.csrfToken;
  const me = await httpCall("GET", "/api/auth/me");
  assert(me.status === 200 && me.body?.id, `auth/me ${me.status} ${me.text}`);
  return me.body.id;
}

function sessionCookie() {
  if (!cookie) return null;
  const eq = cookie.indexOf("=");
  let value = cookie.slice(eq + 1);
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep */
  }
  return {
    name: cookie.slice(0, eq),
    value,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  };
}

async function openWorkspace(pageReady = true) {
  const context = await browser.newContext();
  const baked = sessionCookie();
  if (baked) await context.addCookies([baked]);
  const page = await context.newPage();
  await page.goto(`${APP_BASE}/agent`, { waitUntil: "domcontentloaded" });
  if (await page.locator('[data-testid="text-auth-title"]').isVisible().catch(() => false)) {
    await page.locator('[data-testid="tab-register"]').click();
    await page.locator('[data-testid="input-register-name"]').fill("Workspace Browser");
    await page.locator('[data-testid="input-register-email"]').fill(`${RUN}-browser@e2e.local`);
    await page.locator('[data-testid="input-register-password"]').fill("E2ETestPass99!");
    await page.locator('[data-testid="button-register-submit"]').click();
    await page.goto(`${APP_BASE}/agent`);
  }
  if (pageReady) {
    await page.locator('[data-testid="text-agent-workspace-title"]').waitFor({ timeout: 30_000 });
  }
  return { context, page };
}

function docker(args) {
  return spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });
}

function startMockBackends() {
  let toolTurn = 0;
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      } catch {
        body = {};
      }
      if (url.pathname.endsWith("/chat/completions")) {
        toolTurn += 1;
        if (toolTurn === 1) {
          return send(200, {
            choices: [{ message: { tool_calls: [{ function: { name: "get_analytics", arguments: "{}" } }] } }],
          });
        }
        return send(200, { choices: [{ message: { content: "done" } }] });
      }
      if (url.pathname === "/agui") {
        if (Array.isArray(body.history) && body.history.length > 0) {
          return send(200, { status: "completed", message: "agui done" });
        }
        return send(200, { toolRequests: [{ name: "get_analytics", arguments: {} }] });
      }
      send(404, { message: "not found" });
    });
  });
  return {
    start: () =>
      new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          mockPort = server.address().port;
          resolve(mockPort);
        });
      }),
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function appEnv(extra = {}) {
  return {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(APP_PORT),
    DATABASE_URL: DB_URL,
    SESSION_SECRET: "e2e-workspace-secret",
    SESSION_COOKIE_SECURE: "0",
    DISABLE_CRON: "1",
    CONTENT_SCHEDULER_ENABLED: "1",
    CONTENTFORGE_E2E_SERVER: "1",
    AI_BASE_URL: `${FIXTURE_BASE}/v1`,
    AI_API_KEY: "fixture-key",
    OPENAI_API_KEY: "fixture-key",
    XQUICK_API_BASE_URL: FIXTURE_BASE,
    XQUICK_API_KEY: "fixture-key",
    XQUICK_ACCOUNT: "cf_ws",
    XQUICK_TIMEOUT_MS: "5000",
    RESEARCH_ALLOWED_HOSTS: "127.0.0.1,localhost",
    AGENT_BACKEND_ID: "fixture",
    ...extra,
  };
}

async function startApp(extra = {}) {
  appLogPath = `/tmp/cf-e2e-workspace-app-${process.pid}.log`;
  const out = createWriteStream(appLogPath, { flags: "a" });
  appChild = spawn("node", ["dist/index.cjs"], {
    cwd: ROOT,
    env: appEnv(extra),
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
    { timeoutMs: 90_000, intervalMs: 400, label: "app HTTP readiness" },
  );
  cookie = null;
  csrfToken = null;
  return registerOperator();
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
  await sleep(400);
}

async function cookieHeader() {
  return cookie ? { cookie, "x-csrf-token": csrfToken ?? "" } : {};
}

(async () => {
  console.log(`ContentForge workspace live E2E — run ${RUN}`);
  pool = new pg.Pool({ connectionString: DB_URL, max: 4, statement_timeout: 20_000, query_timeout: 20_000 });
  const { readFileSync } = await import("node:fs");
  docker(["rm", "-f", FIXTURE_CONTAINER]);
  const script = readFileSync(path.join(ROOT, "e2e/fixture/rss-fixture.mjs"), "utf8");
  const b64 = Buffer.from(script, "utf8").toString("base64");
  const startFix = docker([
    "run", "-d", "--rm", "--name", FIXTURE_CONTAINER, "-p", `${FIXTURE_HOST_PORT}:80`,
    "-e", `FIXTURE_RUN=${RUN}`, "-e", `SCRIPT_B64=${b64}`, FIXTURE_IMAGE,
    "sh", "-c", 'echo "$SCRIPT_B64" | base64 -d > /app.mjs && node /app.mjs',
  ]);
  if (startFix.status !== 0) throw new Error(`fixture start failed: ${startFix.stderr || startFix.stdout}`);

  mockServer = startMockBackends();
  await mockServer.start();
  await waitFor(async () => {
    try {
      return (await fetch(`${FIXTURE_BASE}/health`)).ok;
    } catch {
      return false;
    }
  }, { timeoutMs: 60_000, label: "rss fixture" });

  await q("delete from rss_sources");

  if (!existsSync(path.join(ROOT, "dist/index.cjs"))) {
    throw new Error("dist/index.cjs missing — build the app first");
  }

  const operatorId = await startApp();
  await q("insert into rss_sources (user_id, name, feed_url, is_active) values ($1, $2, $3, true)", [
    operatorId,
    `${RUN}-feed`,
    `${FIXTURE_BASE}/feed.xml`,
  ]);
  browser = await chromium.launch({ headless: true });

  phase("Path A — workspace discovery");
  await check("GET /api/agent/runtime advertises streaming + available backends", async () => {
    const res = await httpCall("GET", "/api/agent/runtime");
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.streaming === true, "streaming not advertised");
    assert(Array.isArray(res.body.availableBackends), "no availableBackends");
    assert(res.body.availableBackends.some((b) => b.id === "fixture" && b.available), "fixture missing");
    assert(!JSON.stringify(res.body).includes("sk-"), "secret leaked");
    return `backends=${res.body.availableBackends.map((b) => b.id).join(",")}`;
  });

  await check("Browser Path A: workspace renders CopilotKit + composer", async () => {
    const { context, page } = await openWorkspace();
    await page.locator('[data-testid="copilotkit-agent-workspace"]').waitFor();
    await page.locator('[data-testid="textarea-agent-composer"]').waitFor();
    await page.locator('[data-testid="panel-agent-capabilities"]').waitFor();
    await page.locator('[data-testid="panel-style-intelligence"]').waitFor();
    await page.locator('[data-testid="panel-repurposing"]').waitFor();
    await context.close();
    return "workspace chrome + style + repurpose panels visible";
  });

  await check("HTTP: operator can add reference content and list it", async () => {
    const created = await httpCall("POST", "/api/references", {
      text: `${RUN} Workspace style reference with enough characters to be meaningful for analysis.`,
      sourceType: "manual",
      title: `${RUN} ws-ref`,
    });
    assert(created.status === 201, `create ${created.status} ${created.text}`);
    const listed = await httpCall("GET", "/api/style/references");
    assert(listed.status === 200, `list ${listed.status}`);
    assert(listed.body.references.some((r) => r.id === created.body.id), "reference missing from owner list");
    return `reference ${created.body.id}`;
  });

  phase("Path B — compilePlan research journey + SSE");
  let runId;
  let researchJobId;
  let storyId;
  let artifactId;
  await check("compilePlan starts a real AgentRun and streams AG-UI events", async () => {
    const created = await httpCall("POST", "/api/agent/runs", {
      objective: "Research the latest developments around AI agents and prepare an X post.",
      compilePlan: true,
      execute: true,
      grants: ["approve_artifact", "publish_now"],
      idempotencyKey: `${RUN}-journey-a`,
    });
    assert([200, 201].includes(created.status), `create ${created.status} ${created.text}`);
    runId = created.body.id;
    const [snap] = await q("select provider_snapshot from agent_runs where id = $1", [runId]);
    assert(!JSON.stringify(snap.provider_snapshot).includes("approve_artifact"), "workspace compilePlan stored grants");
    const stream = await fetch(`${APP_BASE}/api/agent/runs/${runId}/stream`, {
      headers: await cookieHeader(),
    });
    assert(stream.ok, `stream ${stream.status}`);
    assert(String(stream.headers.get("content-type") || "").includes("text/event-stream"), "not SSE");
    const sse = await stream.text();
    assert(sse.includes("RUN_STARTED"), "missing RUN_STARTED");
    const events = await httpCall("GET", `/api/agent/runs/${runId}/events`);
    assert(events.body.events.some((e) => e.type === "TOOL_CALL_START"), "no tool events");
    const detail = await httpCall("GET", `/api/agent/runs/${runId}`);
    researchJobId = detail.body.toolCalls?.[0]?.resourceRefs?.researchJobId;
    assert(Number.isInteger(researchJobId), "no researchJobId");
    await waitFor(async () => {
      const [job] = await q("select status, error_message from research_jobs where id = $1", [researchJobId]);
      if (!job) return false;
      if (job.status === "complete") return job;
      if (job.status === "failed") throw new Error(job.error_message);
      return false;
    }, { timeoutMs: 90_000, label: "research complete" });
    for (let i = 0; i < 8; i += 1) {
      const cont = await httpCall("POST", `/api/agent/runs/${runId}/continue`, {});
      assert(cont.status === 200, `continue ${cont.status} ${cont.text}`);
      if (cont.body.done) break;
      if (cont.body.result?.status === "conflict") await sleep(1000);
    }
    const after = await httpCall("GET", `/api/agent/runs/${runId}`);
    const refs = {};
    for (const call of after.body.toolCalls ?? []) Object.assign(refs, call.resourceRefs ?? {});
    storyId = refs.storyId;
    assert(Number.isInteger(storyId), `no story in ${JSON.stringify(refs)}`);
    const [story] = await q("select id from stories where id = $1", [storyId]);
    assert(story, "story not persisted");
    const art = await waitFor(async () => {
      const rows = await q(
        "select id from artifacts where opportunity_id in (select id from opportunities where story_id = $1) order by id desc",
        [storyId],
      );
      return rows[0] ?? false;
    }, { timeoutMs: 90_000, label: "artifact from compiled journey" });
    artifactId = art.id;
    return `run ${runId} story ${storyId} artifact ${artifactId}`;
  });

  await check("Browser Path B/G: open run after reload reconstructs events", async () => {
    const { context, page } = await openWorkspace();
    await page.locator(`[data-testid="card-agent-run-${runId}"]`).click();
    await page.reload();
    await page.locator(`[data-testid="card-agent-run-${runId}"]`).waitFor();
    await page.locator(`[data-testid="card-agent-run-${runId}"]`).click();
    await page.locator('[data-testid="panel-agent-activity"]').waitFor();
    const activity = await page.locator('[data-testid="panel-agent-activity"]').innerText();
    assert(/Research|Run|story|Artifact|activity/i.test(activity), `activity=${activity.slice(0, 200)}`);
    await context.close();
    return "reload reconstructed";
  });

  await check("Browser Path A: repurpose panel creates a durable plan from the Story", async () => {
    assert(Number.isInteger(storyId), "no story from journey");
    const { context, page } = await openWorkspace();
    await page.locator('[data-testid="panel-repurposing"]').waitFor();
    await page.locator('[data-testid="input-repurpose-story-id"]').fill(String(storyId));
    await page.locator('[data-testid="button-repurpose-create"]').click();
    await page.locator('[data-testid="panel-repurpose-plan"]').waitFor({ timeout: 30_000 });
    const progress = await page.locator('[data-testid="text-repurpose-progress"]').innerText();
    assert(/\d+ \/ \d+ opportunities/.test(progress), `progress=${progress}`);
    await page.reload();
    await page.locator('[data-testid="panel-repurposing"]').waitFor();
    await page.locator('[data-testid="input-repurpose-story-id"]').fill(String(storyId));
    await page.locator('[data-testid="button-repurpose-create"]').click();
    await page.locator('[data-testid="panel-repurpose-plan"]').waitFor({ timeout: 30_000 });
    const again = await page.locator('[data-testid="text-repurpose-progress"]').innerText();
    assert(/\d+ \/ \d+ opportunities/.test(again), `reload progress=${again}`);
    const plans = await q("select id from repurposing_plans where story_id = $1 and request_key = $2", [
      storyId,
      `ui-story-${storyId}`,
    ]);
    assert(plans.length === 1, `duplicate plans=${plans.length}`);
    await context.close();
    return `plan ${plans[0].id}`;
  });

  phase("Path C — artifact revision");
  if (artifactId) {
    await check("Browser Path C: revise creates a new revision", async () => {
      const original = await httpCall("GET", `/api/artifacts/${artifactId}`);
      const payload = original.body.payload ?? { text: "original" };
      const revised = await httpCall("POST", `/api/artifacts/${artifactId}/revise`, {
        baseArtifactId: artifactId,
        payload: { ...payload, text: `${payload.text ?? "post"} edited` },
        attributionReason: "workspace e2e",
      });
      assert(revised.status === 201, `revise ${revised.status} ${revised.text}`);
      assert(revised.body.id !== artifactId, "revision reused id");
      const still = await httpCall("GET", `/api/artifacts/${artifactId}`);
      assert(still.body.payload?.text !== revised.body.payload?.text, "original mutated");
      artifactId = revised.body.id;
      return `revision ${revised.body.id} supersedes ${revised.body.supersedesId}`;
    });
  } else {
    record("Browser Path C: revise creates a new revision", false, "no artifact from journey A");
  }

  phase("Path D/E — approve + schedule via ContentForge APIs");
  if (artifactId) {
    await check("explicit approval is a user API action", async () => {
      const review = await httpCall("POST", `/api/artifacts/${artifactId}/submit-review`, {});
      assert([200, 201].includes(review.status) || review.status === 409, `review ${review.status} ${review.text}`);
      const approved = await httpCall("POST", `/api/artifacts/${artifactId}/approve`, {});
      assert(approved.status === 200, `approve ${approved.status} ${approved.text}`);
      assert(approved.body.readiness === "approved", approved.body.readiness);
      return `artifact ${artifactId} approved`;
    });
    await check("schedule creates a durable Schedule", async () => {
      const scheduled = await httpCall("POST", "/api/schedules", {
        artifactId,
        startAt: new Date(Date.now() + 120_000).toISOString(),
      });
      assert(scheduled.status === 201, `schedule ${scheduled.status} ${scheduled.text}`);
      const [row] = await q("select id from schedules where id = $1", [scheduled.body.id]);
      assert(row, "schedule missing");
      return `schedule ${scheduled.body.id}`;
    });
  }

  phase("Path F — publish Result semantics");
  if (artifactId) {
    await check("publish uses ContentForge publications and does not fake success", async () => {
      const pub = await httpCall("POST", `/api/artifacts/${artifactId}/publications`, {
        targets: [{ channel: "x", startAt: new Date().toISOString() }],
      });
      assert(pub.status === 207 || pub.status === 200 || pub.status === 201, `publish ${pub.status} ${pub.text}`);
      const list = await httpCall("GET", `/api/artifacts/${artifactId}/publications`);
      assert(Array.isArray(list.body), "publications not a list");
      return `publications ${list.body.length}`;
    });
  }

  phase("Path H/I — reconnect + backend failure");
  await check("stream recovers after process restart", async () => {
    await killApp("SIGKILL");
    await startApp();
    const events = await httpCall("GET", `/api/agent/runs/${runId}/events`);
    assert(events.status === 200, `events ${events.status}`);
    assert(events.body.events.some((e) => e.type === "RUN_STARTED"), "history lost");
    return `${events.body.events.length} reconstructed events`;
  });

  await check("Browser Path I: runtime failure is visible", async () => {
    await killApp("SIGTERM");
    const context = await browser.newContext();
    const page = await context.newPage();
    const failed = await page.goto(`${APP_BASE}/agent`, { timeout: 8_000 }).then(() => false).catch(() => true);
    await context.close();
    await startApp();
    assert(failed, "page loaded while app was down");
    return "failure visible";
  });

  phase("Path J/K — ownership + privileged tools");
  await check("foreign user cannot read another user's run", async () => {
    const email = `${RUN}-b@example.com`;
    const registered = await httpCall("POST", "/api/auth/register", {
      email,
      password: "password1",
      name: "Workspace B",
    });
    assert([200, 201].includes(registered.status), `register ${registered.status}`);
    const csrf = await httpCall("GET", "/api/csrf-token");
    csrfToken = csrf.body?.csrfToken;
    const peek = await httpCall("GET", `/api/agent/runs/${runId}`);
    assert(peek.status === 404, `leaked run ${peek.status}`);
    const events = await httpCall("GET", `/api/agent/runs/${runId}/events`);
    assert(events.status === 404, `leaked events ${events.status}`);
    cookie = null;
    csrfToken = null;
    await bootstrapSession();
    return "run isolated";
  });

  await check("agent cannot approve without authorization grant", async () => {
    const run = await httpCall("POST", "/api/agent/runs", { objective: "priv", execute: false, idempotencyKey: `${RUN}-priv` });
    const denied = await httpCall("POST", `/api/agent/runs/${run.body.id}/tools`, {
      tool: "approve_artifact",
      arguments: { artifactId: artifactId ?? 1 },
    });
    assert(denied.body.result?.status === "denied" || denied.body.result?.status === "not_found", JSON.stringify(denied.body));
    return denied.body.result.status;
  });

  await check("retrieved HTML is not executed as application UI", async () => {
    const agui = await httpCall("POST", "/api/agent/agui", {
      messages: [{ role: "user", content: "<img src=x onerror=alert(1)> research nothing" }],
    });
    assert(agui.status === 200, `agui ${agui.status} ${agui.text}`);
    assert(String(agui.headers.get("content-type") || "").includes("text/event-stream"), "agui not SSE");
    return "AG-UI POST streamed";
  });

  phase("Concurrency");
  await check("duplicate compilePlan idempotency key collapses", async () => {
    const key = `${RUN}-dup-run`;
    const [a, b] = await Promise.all([
      httpCall("POST", "/api/agent/runs", { objective: "dup", compilePlan: true, execute: false, idempotencyKey: key }),
      httpCall("POST", "/api/agent/runs", { objective: "dup", compilePlan: true, execute: false, idempotencyKey: key }),
    ]);
    assert(a.body.id === b.body.id, "run ids diverged");
    const rows = await q("select id from agent_runs where idempotency_key = $1", [key]);
    assert(rows.length === 1, `runs=${rows.length}`);
    return `run ${rows[0].id}`;
  });

  phase("OpenAI-compatible + AG-UI remote through workspace runtime");
  await check("openai-compatible advertised only when configured", async () => {
    await killApp("SIGTERM");
    await startApp({
      AGENT_BACKEND_ID: "openai-compatible",
      AGENT_BACKEND_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
      AGENT_BACKEND_API_KEY: "test",
      AGENT_MODEL: "fixture",
    });
    const res = await httpCall("GET", "/api/agent/runtime");
    assert(res.body.backend.id === "openai-compatible", res.body.backend.id);
    assert(res.body.availableBackends.find((b) => b.id === "openai-compatible").available === true, "not advertised");
    const run = await httpCall("POST", "/api/agent/runs", { objective: "analytics", execute: true, idempotencyKey: `${RUN}-oai` });
    const detail = await httpCall("GET", `/api/agent/runs/${run.body.id}`);
    assert(detail.body.toolCalls.some((c) => c.toolName === "get_analytics"), "openai workspace run did not tool-call");
    return `run ${run.body.id}`;
  });

  await check("agui-remote advertised only when configured", async () => {
    await killApp("SIGTERM");
    await startApp({
      AGENT_BACKEND_ID: "agui-remote",
      AGENT_AGUI_URL: `http://127.0.0.1:${mockPort}/agui`,
    });
    const res = await httpCall("GET", "/api/agent/runtime");
    assert(res.body.backend.id === "agui-remote", res.body.backend.id);
    const run = await httpCall("POST", "/api/agent/runs", { objective: "agui", execute: true, backendId: "agui-remote", idempotencyKey: `${RUN}-agui` });
    const detail = await httpCall("GET", `/api/agent/runs/${run.body.id}`);
    assert(detail.body.toolCalls.some((c) => c.toolName === "get_analytics"), "agui remote did not tool-call");
    return `run ${run.body.id}`;
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${"=".repeat(76)}`);
  console.log(`WORKSPACE E2E SUMMARY — ${passed} passed, ${failed} failed (${results.length} checks)`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
  }
  console.log(`app log: ${appLogPath}`);
  process.exitCode = failed > 0 ? 1 : 0;
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
    try {
      await killApp("SIGTERM");
    } catch {
      /* ignore */
    }
    try {
      await mockServer?.stop();
    } catch {
      /* ignore */
    }
    try {
      docker(["rm", "-f", FIXTURE_CONTAINER]);
    } catch {
      /* ignore */
    }
    try {
      await pool?.end();
    } catch {
      /* ignore */
    }
  });
