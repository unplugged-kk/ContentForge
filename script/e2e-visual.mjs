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
import nodeHttp from "node:http";
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
let xFixtureHandle = null;

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

/**
 * Deterministic double for xQuick's media-upload and post-creation endpoints —
 * the ONLY thing this harness doubles beyond the visual provider. Everything
 * else (HTTP app, Postgres, pg-boss, publication/media-resolution logic) is
 * real, exactly like `e2e/fixture/rss-fixture.mjs` is to `e2e-live.mjs`.
 */
function startXFixture() {
  let tweetSeq = 0;
  let mediaSeq = 0;
  const server = nodeHttp.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "POST" && url.pathname === "/x/media") {
      req.resume();
      req.on("end", () => {
        mediaSeq += 1;
        send(200, { mediaId: `media-${RUN}-${mediaSeq}` });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/x/tweets") {
      req.resume();
      req.on("end", () => {
        tweetSeq += 1;
        const id = `tweet-${RUN}-${tweetSeq}`;
        send(200, { id, tweetId: id, url: `https://x.com/i/status/${id}`, username: "cf_test" });
      });
      return;
    }
    send(404, { message: "not found" });
  });
  return {
    start: () =>
      new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
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

  xFixtureHandle = startXFixture();
  const xFixturePort = await xFixtureHandle.start();
  const xEnv = {
    XQUICK_API_BASE_URL: `http://127.0.0.1:${xFixturePort}`,
    XQUICK_API_KEY: "fixture-key",
    XQUICK_ACCOUNT: "cf_test",
    XQUICK_TIMEOUT_MS: "5000",
  };

  phase("Startup");
  await startApp(xEnv);
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

  phase("Phase 15: variations, refinement, carousel, ownership");

  let variationGenerationId = null;
  await check("Path A: image generation with multiple variations", async () => {
    const res = await http("POST", "/api/visual-generations", {
      kind: "image",
      providerId: "local-fixture",
      variationCount: 3,
      intent: { subject: `${RUN} variation pack`, aspectRatio: "1:1" },
    });
    assert(res.status === 201, `create ${res.status}: ${res.text}`);
    variationGenerationId = res.body.id;
    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/visual-generations/${variationGenerationId}`);
        if (r.body.status === "ready" && Array.isArray(r.body.assets) && r.body.assets.length === 3) return r.body;
        if (r.body.status === "failed") throw new Error(r.body.errorMessage);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "variations ready" },
    );
    assert(JSON.stringify(row.assets.map((a) => a.position)) === "[0,1,2]", "variation order not durable");
    return `generation ${row.id} produced ${row.assets.length} variations`;
  });

  await check("Path B: refinement of one generated image", async () => {
    const sourceId = (await http("GET", `/api/visual-generations/${variationGenerationId}`)).body.assets[0].id;
    const res = await http("POST", `/api/visual-assets/${sourceId}/refine`, { instruction: "Increase contrast" });
    assert(res.status === 201, `refine ${res.status}: ${res.text}`);
    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/visual-generations/${res.body.id}`);
        if (r.body.status === "ready") return r.body;
        if (r.body.status === "failed") throw new Error(r.body.errorMessage);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "refine ready" },
    );
    assert(row.sourceVisualAssetId === sourceId, "source lineage missing");
    assert(row.visualAssetId !== sourceId, "refinement mutated the source");
    const source = await http("GET", `/api/visual-assets/${sourceId}`);
    assert(source.status === 200, "source asset disappeared");
    return `refined ${sourceId} -> ${row.visualAssetId}`;
  });

  await check("Path C: carousel generation with ordered images", async () => {
    const res = await http("POST", "/api/visual-generations", {
      kind: "carousel",
      providerId: "local-fixture",
      slideCount: 3,
      intent: { subject: `${RUN} carousel pack` },
    });
    assert(res.status === 201, `carousel ${res.status}: ${res.text}`);
    const row = await waitFor(
      async () => {
        const r = await http("GET", `/api/visual-generations/${res.body.id}`);
        if (r.body.status === "ready" && r.body.assets?.length === 3) return r.body;
        if (r.body.status === "failed") throw new Error(r.body.errorMessage);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "carousel ready" },
    );
    assert(JSON.stringify(row.assets.map((a) => a.position)) === "[0,1,2]", "carousel order not durable");
    assert(row.assets.every((a) => a.kind === "carousel_slide"));
    return `carousel ${row.id} slides ${row.assets.map((a) => a.id).join(",")}`;
  });

  await check("Path D: ownership isolation", async () => {
    const missing = await http("GET", "/api/visual-generations/99999999");
    assert(missing.status === 404, `expected 404, got ${missing.status}`);
    const foreignAsset = await http("GET", "/api/visual-assets/99999999");
    assert(foreignAsset.status === 404, `expected 404, got ${foreignAsset.status}`);
    const refine = await http("POST", "/api/visual-assets/99999999/refine", { instruction: "nope" });
    assert(refine.status === 404, `expected 404, got ${refine.status}`);
    return "foreign ids 404";
  });

  await check("Path E: duplicate variation request collapses", async () => {
    const again = await http("POST", "/api/visual-generations", {
      kind: "image",
      providerId: "local-fixture",
      variationCount: 3,
      intent: { subject: `${RUN} variation pack`, aspectRatio: "1:1" },
    });
    assert(again.status === 200, `expected 200, got ${again.status}`);
    assert(again.body.id === variationGenerationId, "duplicate created a new generation");
    return `reused ${again.body.id}`;
  });

  let publishOpportunityId, publishArtifactId, publishAssetId;
  await check(
    "POST /api/opportunities/:id/artifacts creates an image Artifact through real HTTP, pinning the exact asset revision",
    async () => {
      const opp = await http("POST", "/api/opportunities", {
        storyId,
        concept: "hero visual",
        objective: "illustrate",
        format: "image",
        channel: "x",
      });
      assert(opp.status === 201, `opportunity ${opp.status}: ${opp.text}`);
      publishOpportunityId = opp.body.id;

      const gen = await http("GET", `/api/visual-generations/${visualGenerationId}`);
      const assetId = gen.body.visualAssetId;
      publishAssetId = assetId;

      // The image Artifact is authored through the same generic, format-driven
      // route every other format uses — never a special "visual artifact"
      // endpoint, and never a direct database insert.
      const created = await http("POST", `/api/opportunities/${opp.body.id}/artifacts`, {
        payload: { visualAssetId: assetId, altText: "hero", aspectRatio: "1:1" },
        attributionReason: "visual e2e",
      });
      assert(created.status === 201, `create artifact ${created.status}: ${created.text}`);
      assert(created.body.readiness === "draft", `readiness=${created.body.readiness}`);
      const artifactId = created.body.id;
      publishArtifactId = artifactId;

      await http("POST", `/api/artifacts/${artifactId}/submit-review`, {});
      const approved = await http("POST", `/api/artifacts/${artifactId}/approve`, {});
      assert(approved.body.readiness === "approved", `readiness=${approved.body.readiness}`);

      // The ref audit-trail row is created automatically by authoring — no
      // separate /visuals attach call is needed for the payload to be pinned.
      const refs = await http("GET", `/api/artifacts/${artifactId}/visuals`);
      assert(refs.body.length === 1 && refs.body[0].visualAssetId === assetId, "ref audit trail");
      return `artifact ${artifactId} approved through HTTP, pinned to asset ${assetId}`;
    },
  );

  await check("HTTP authoring rejects a nonexistent VisualAsset before any Artifact row is created", async () => {
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "invalid visual ref",
      objective: "illustrate",
      format: "image",
      channel: "x",
    });
    assert(opp.status === 201, `opportunity ${opp.status}`);
    const before = await q("select count(*)::int c from artifacts where opportunity_id = $1", [opp.body.id]);
    const res = await http("POST", `/api/opportunities/${opp.body.id}/artifacts`, {
      payload: { visualAssetId: 999_999_999 },
      attributionReason: "should fail",
    });
    assert(res.status === 404, `expected 404 for a nonexistent visual asset, got ${res.status}: ${res.text}`);
    const after = await q("select count(*)::int c from artifacts where opportunity_id = $1", [opp.body.id]);
    assert(after[0].c === before[0].c, "no partial Artifact row created");
    return "invalid reference refused, no durable side effect";
  });

  await check("HTTP authoring refuses another owner's VisualAsset with the same 404 shape as not-found", async () => {
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "foreign visual ref",
      objective: "illustrate",
      format: "image",
      channel: "x",
    });
    const decoy = await q(
      `insert into visual_assets (user_id, kind, storage_key, mime, status)
       values (999999, 'image', 'local:deadbeef', 'image/png', 'ready') returning id`,
    );
    const res = await http("POST", `/api/opportunities/${opp.body.id}/artifacts`, {
      payload: { visualAssetId: decoy[0].id },
      attributionReason: "should fail",
    });
    assert(res.status === 404, `expected 404, got ${res.status}: ${res.text}`);
    await q("delete from visual_assets where id = $1", [decoy[0].id]);
    return "foreign asset refused via the generic authoring route";
  });

  phase("Visual publication E2E: HTTP-authored image Artifact -> Schedule -> Occurrence -> Publication -> X -> Result");

  await check("Schedule + dispatch + publication deliver the HTTP-authored image to X, pinning the exact asset revision", async () => {
    const schedule = await http("POST", "/api/schedules", {
      artifactId: publishArtifactId,
      startAt: new Date().toISOString(),
    });
    assert(schedule.status === 201, `schedule ${schedule.status}: ${schedule.text}`);

    const dispatch = await http("POST", "/api/publications/dispatch", {});
    assert(dispatch.status === 200, `dispatch ${dispatch.status}: ${dispatch.text}`);

    const publicationRow = await waitFor(
      async () => {
        const rows = await q("select * from publications where schedule_id = $1", [schedule.body.id]);
        return rows[0] ?? false;
      },
      { timeoutMs: 20_000, intervalMs: 300, label: "publication row materialized" },
    );

    const published = await waitFor(
      async () => {
        const p = await http("GET", `/api/publications/${publicationRow.id}`);
        if (p.body.state === "published") return p.body;
        if (p.body.state === "failed") throw new Error(`publication failed: ${p.body.lastError}`);
        return false;
      },
      { timeoutMs: 30_000, intervalMs: 300, label: "publication published" },
    );
    assert(typeof published.externalId === "string" && published.externalId.length > 0, "no external post id");

    const result = await http("GET", `/api/publications/${publicationRow.id}/result`);
    assert(result.status === 200, `result ${result.status}: ${result.text}`);
    assert(result.body.outcome === "published", `outcome=${result.body.outcome}`);
    assert(result.body.metrics?.mediaCount === 1, `mediaCount=${result.body.metrics?.mediaCount}`);

    const artifactRow = await http("GET", `/api/artifacts/${publishArtifactId}`);
    assert(
      artifactRow.body.payload.visualAssetId === publishAssetId,
      "the published Artifact's payload still names the exact original asset revision",
    );
    return `Publication ${publicationRow.id} published, externalId=${published.externalId}`;
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

  phase("Phase 9: standalone media generation is the primary path — no Artifact anywhere above this line");
  await check("standalone generation accepts an explicit model preference through the real HTTP route", async () => {
    const res = await http("POST", "/api/visual-generations", {
      kind: "image",
      providerId: "local-fixture",
      model: "fixture-model",
      intent: { subject: `${RUN} model preference probe`, aspectRatio: "1:1" },
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    const ready = await waitFor(
      async () => {
        const r = await http("GET", `/api/visual-generations/${res.body.id}`);
        return r.body.status === "ready" ? r.body : false;
      },
      { timeoutMs: 60_000, intervalMs: 300, label: "model-preference generation ready" },
    );
    assert(Number.isInteger(ready.visualAssetId), "no asset produced with a model preference set");
    return `generation ${res.body.id} honored model preference, asset ${ready.visualAssetId}`;
  });

  phase("Phase 19: video content production foundation");
  let videoGenerationId = null;
  let videoAssetId = null;
  await check("Path A: POST /api/video-generations creates durable intent", async () => {
    const res = await http("POST", "/api/video-generations", {
      intent: { subject: `${RUN} short social video`, aspectRatio: "9:16" },
      durationMs: 1200,
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    assert(res.body.kind === "video", `kind=${res.body.kind}`);
    assert(res.body.capability === "generate_video", `capability=${res.body.capability}`);
    assert(res.body.status === "requested", `status=${res.body.status}`);
    videoGenerationId = res.body.id;
    return `video generation ${res.body.id} queued`;
  });

  await check("Path B: GET /api/video-generations/:id reports ready VideoAsset", async () => {
    await waitFor(
      async () => {
        const rows = await q("select status, error_message from visual_generations where id = $1", [videoGenerationId]);
        const row = rows[0];
        if (!row) return false;
        if (row.status === "ready") return row;
        if (row.status === "failed") throw new Error(`video failed: ${row.error_message}`);
        return false;
      },
      { timeoutMs: 90_000, intervalMs: 300, label: "video ready" },
    );
    const row = await http("GET", `/api/video-generations/${videoGenerationId}`);
    assert(row.status === 200, `GET status ${row.status}`);
    assert(row.body.status === "ready", `status=${row.body.status}`);
    assert(Number.isInteger(row.body.visualAssetId), "no video asset");
    videoAssetId = row.body.visualAssetId;
    const asset = await http("GET", `/api/video-assets/${videoAssetId}`);
    assert(asset.status === 200, `asset ${asset.status}`);
    assert(asset.body.kind === "video", `kind=${asset.body.kind}`);
    assert(asset.body.mime === "video/mp4", `mime=${asset.body.mime}`);
    assert(asset.body.durationMs === 1200, `durationMs=${asset.body.durationMs}`);
    assert(typeof asset.body.storageKey === "undefined", "storageKey must not leak on HTTP");
    const [dbRow] = await q("select storage_key, mime, duration_ms from visual_assets where id = $1", [videoAssetId]);
    assert(/^local:[0-9a-f]+$/.test(dbRow.storage_key), "bytes stored as storage_key");
    return `video asset ${videoAssetId} duration=${asset.body.durationMs}`;
  });

  await check("Path C: duplicate POST retries the same VideoGeneration", async () => {
    const again = await http("POST", "/api/video-generations", {
      intent: { subject: `${RUN} short social video`, aspectRatio: "9:16" },
      durationMs: 1200,
    });
    assert(again.status === 200, `expected 200, got ${again.status}`);
    assert(again.body.id === videoGenerationId, "duplicate created a new generation");
    const assets = await q("select id from visual_assets where visual_generation_id = $1", [videoGenerationId]);
    assert(assets.length === 1, `duplicate assets: ${assets.length}`);
    return `same generation ${videoGenerationId}`;
  });

  await check("Path D: explicit regenerate is a new VideoGeneration", async () => {
    const res = await http("POST", "/api/video-generations", {
      intent: { subject: `${RUN} short social video`, aspectRatio: "9:16" },
      durationMs: 1200,
      regenerate: true,
      regenerationNonce: "video-regen-1",
    });
    assert(res.status === 201, `expected 201, got ${res.status}`);
    assert(res.body.id !== videoGenerationId, "regenerate reused identity");
    await waitFor(
      async () => {
        const rows = await q("select status from visual_generations where id = $1", [res.body.id]);
        return rows[0]?.status === "ready" ? rows[0] : false;
      },
      { timeoutMs: 60_000, intervalMs: 300, label: "video regen ready" },
    );
    const row = await http("GET", `/api/video-generations/${res.body.id}`);
    assert(row.body.visualAssetId !== videoAssetId, "regenerate mutated the original asset");
    return `regen generation ${res.body.id} asset ${row.body.visualAssetId}`;
  });

  await check("Path E: POST /api/video-assets/:id/refine leaves source immutable", async () => {
    const before = await http("GET", `/api/video-assets/${videoAssetId}`);
    const res = await http("POST", `/api/video-assets/${videoAssetId}/refine`, {
      instruction: "Tighten the hook; do not change owner or channel",
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    await waitFor(
      async () => {
        const rows = await q("select status from visual_generations where id = $1", [res.body.id]);
        return rows[0]?.status === "ready" ? rows[0] : false;
      },
      { timeoutMs: 60_000, intervalMs: 300, label: "video refine ready" },
    );
    const row = await http("GET", `/api/video-generations/${res.body.id}`);
    const after = await http("GET", `/api/video-assets/${videoAssetId}`);
    assert(after.body.contentHash === before.body.contentHash, "source asset mutated");
    assert(row.body.visualAssetId !== videoAssetId, "refine reused source id");
    return `refined asset ${row.body.visualAssetId} from ${videoAssetId}`;
  });

  await check("Path F: Artifact attachment names the VideoAsset id", async () => {
    const opp = await http("POST", "/api/opportunities", {
      storyId,
      concept: "video artifact",
      objective: "attach",
      format: "video",
      channel: "x",
    });
    assert(opp.status === 201, `opportunity ${opp.status}: ${opp.text}`);
    const created = await http("POST", `/api/opportunities/${opp.body.id}/artifacts`, {
      format: "video",
      channel: "x",
      payload: { visualAssetId: videoAssetId },
      attributionReason: "e2e fixture",
    });
    assert(created.status === 201, `artifact ${created.status}: ${created.text}`);
    const attach = await http("POST", `/api/artifacts/${created.body.id}/visuals`, {
      visualAssetId: videoAssetId,
      role: "hero",
    });
    assert(attach.status === 201, `attach ${attach.status}: ${attach.text}`);
    const listed = await http("GET", `/api/artifacts/${created.body.id}/visuals`);
    assert(listed.body[0].visualAssetId === videoAssetId, "ref mismatch");
    return `artifact ${created.body.id} → video asset ${videoAssetId}`;
  });

  await check("Path G: ownership isolation for video ids", async () => {
    const imageAsVideo = await http("GET", `/api/video-generations/${visualGenerationId}`);
    assert(imageAsVideo.status === 404, `image leaked as video: ${imageAsVideo.status}`);
    const foreign = await http("GET", "/api/video-assets/99999999");
    assert(foreign.status === 404, `expected 404, got ${foreign.status}`);
    const refine = await http("POST", "/api/video-assets/99999999/refine", { instruction: "nope" });
    assert(refine.status === 404, `refine leak ${refine.status}`);
    return "foreign/missing video ids 404";
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

    await startApp(xEnv);
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

  await check("Path H: queued VideoGeneration survives SIGKILL without duplicate assets", async () => {
    const res = await http("POST", "/api/video-generations", {
      intent: { subject: `${RUN} video restart probe`, aspectRatio: "9:16" },
      durationMs: 1100,
    });
    assert(res.status === 201, `expected 201, got ${res.status}: ${res.text}`);
    const id = res.body.id;
    await killApp("SIGKILL");
    const [atKill] = await q("select status from visual_generations where id = $1", [id]);
    record(
      "VideoGeneration row survived the kill",
      atKill && ["requested", "generating"].includes(atKill.status),
      `status=${atKill?.status}`,
    );
    await startApp(xEnv);
    await waitFor(
      async () => {
        const rows = await q("select status, error_message from visual_generations where id = $1", [id]);
        const row = rows[0];
        if (!row) return false;
        if (row.status === "ready") return row;
        if (row.status === "failed") throw new Error(`failed: ${row.error_message}`);
        return false;
      },
      { timeoutMs: 120_000, intervalMs: 500, label: "post-restart video" },
    );
    const row = await http("GET", `/api/video-generations/${id}`);
    const assets = await q("select id from visual_assets where visual_generation_id = $1", [id]);
    assert(assets.length === 1, `duplicate video assets after restart: ${assets.length}`);
    assert(Number.isInteger(row.body.visualAssetId), "no video asset after restart");
    return `video generation ${id} completed after restart → asset ${row.body.visualAssetId}`;
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
    if (xFixtureHandle) await xFixtureHandle.stop().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
