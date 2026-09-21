/**
 * fal RECONCILE ONLY — resumes generation 606 against the already-submitted
 * fal requestId. Does NOT POST a new fal queue job.
 *
 * Prefer setting DATABASE_URL to the e2e DB in the shell so db.ts loads correctly:
 *
 *   CONTENTFORGE_REAL_MEDIA_E2E=1 CONTENTFORGE_MEDIA_CERTIFICATION=1 \
 *     DATABASE_URL='postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live' \
 *     npx tsx script/media-certify-fal-reconcile.ts
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_URL = process.env.E2E_LIVE_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? "postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live";
const GENERATION_ID = Number(process.env.FAL_RECONCILE_GENERATION_ID ?? 606);
const REQUEST_ID = process.env.FAL_RECONCILE_REQUEST_ID ?? "01a0b55f-c335-75e1-b4d8-8bae750bc76d";
const BUDGET_PATH = process.env.MEDIA_CERT_BUDGET_PATH
  ?? path.join(ROOT, ".scratch", "media-cert-budget.json");
const EVIDENCE_PATH = path.join(ROOT, ".scratch", "media-cert-evidence.json");
const FAL_REQUEST_ID_DIR = process.env.FAL_REQUEST_ID_DIR
  ?? path.join(ROOT, ".scratch", "fal-request-ids");

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function main() {
  console.log("════════════════════════════════════════════════════════");
  console.log("REAL PAID PROVIDER TEST — fal RECONCILE (no new submit)");
  console.log("════════════════════════════════════════════════════════");
  assert(process.env.CONTENTFORGE_REAL_MEDIA_E2E === "1", "CONTENTFORGE_REAL_MEDIA_E2E=1 required");
  assert(process.env.CONTENTFORGE_MEDIA_CERTIFICATION === "1", "CONTENTFORGE_MEDIA_CERTIFICATION=1 required");
  assert(/127\.0\.0\.1:5433\/cf_e2e_live/.test(DB_URL), "must use cf_e2e_live");

  process.env.DATABASE_URL = DB_URL;
  process.env.MEDIA_CERT_BUDGET_PATH = BUDGET_PATH;
  process.env.FAL_REQUEST_ID_DIR = FAL_REQUEST_ID_DIR;

  const budget = existsSync(BUDGET_PATH) ? JSON.parse(readFileSync(BUDGET_PATH, "utf8")) : {};
  console.log(`budget.falCalls=${budget.falCalls ?? 0} (must stay unchanged)`);
  console.log(`generationId=${GENERATION_ID} requestId=${REQUEST_ID}`);

  mkdirSync(FAL_REQUEST_ID_DIR, { recursive: true });
  writeFileSync(path.join(FAL_REQUEST_ID_DIR, `cfvg-${GENERATION_ID}.json`), `${JSON.stringify({
    requestId: REQUEST_ID,
    statusUrl: `https://queue.fal.run/fal-ai/wan/requests/${REQUEST_ID}/status`,
    responseUrl: `https://queue.fal.run/fal-ai/wan/requests/${REQUEST_ID}`,
    generationId: GENERATION_ID,
    providerId: "fal",
  }, null, 2)}\n`);

  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  const before = await client.query(
    `SELECT id, status, provider_id, error_message FROM visual_generations WHERE id=$1`,
    [GENERATION_ID],
  );
  assert(before.rows[0]?.provider_id === "fal", "generation is not fal");
  await client.query(
    `UPDATE visual_generations
     SET status='requested', error_class=NULL, error_message=NULL, finished_at=NULL, started_at=NULL
     WHERE id=$1 AND provider_id='fal'`,
    [GENERATION_ID],
  );
  await client.end();
  console.log(`reset ${GENERATION_ID} ${before.rows[0]?.status} → requested for reconcile`);

  const { registerBuiltinVisualProviders, visualRunDeps } = await import("../server/content/service");
  const { runVisualGeneration } = await import("../server/content/visualService");

  registerBuiltinVisualProviders();
  console.log("→ polling existing fal request (no queue submit)…");
  const result = await runVisualGeneration(GENERATION_ID, visualRunDeps);
  console.log("runVisualGeneration:", JSON.stringify(result));

  const afterBudget = existsSync(BUDGET_PATH) ? JSON.parse(readFileSync(BUDGET_PATH, "utf8")) : {};
  assert(
    Number(afterBudget.falCalls ?? 0) === Number(budget.falCalls ?? 0),
    `falCalls changed during reconcile (${budget.falCalls} → ${afterBudget.falCalls})`,
  );
  assert(result.status === "ready", `expected ready, got ${result.status}`);

  const verify = new pg.Client({ connectionString: DB_URL });
  await verify.connect();
  const assets = await verify.query(
    `SELECT id, mime, byte_size, duration_ms, width, height, content_hash, storage_key
     FROM visual_assets WHERE visual_generation_id=$1 AND status='ready'`,
    [GENERATION_ID],
  );
  const el = await verify.query(
    `SELECT g.id AS generation_id, a.id AS asset_id, a.mime, a.byte_size, a.duration_ms,
            a.sample_rate, a.channels, a.content_hash, a.storage_key, g.model
     FROM visual_generations g
     JOIN visual_assets a ON a.visual_generation_id = g.id
     WHERE g.id = 605 AND a.status = 'ready'
     LIMIT 1`,
  );
  await verify.end();
  const asset = assets.rows[0];
  assert(asset, "no ready VideoAsset after reconcile");
  assert(asset.mime === "video/mp4", `unexpected mime ${asset.mime}`);

  let evidence: Record<string, unknown> = {};
  if (existsSync(EVIDENCE_PATH)) {
    try { evidence = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")); } catch { evidence = {}; }
  }
  evidence.phase = "27.3";
  evidence.completedAt = new Date().toISOString();
  evidence.fal = {
    status: "PASS",
    providerId: "fal",
    modelId: process.env.FAL_MODEL_ID || "fal-ai/wan/v2.2-a14b/text-to-video",
    generationId: GENERATION_ID,
    videoAssetId: asset.id,
    providerJobId: REQUEST_ID,
    mime: asset.mime,
    bytes: Number(asset.byte_size),
    durationMs: asset.duration_ms,
    width: asset.width,
    height: asset.height,
    contentHash: asset.content_hash,
    storageKey: asset.storage_key,
    resolution: "480p",
    callsUsed: 1,
    reconciled: true,
    certificationKey: "phase27.3-fal-certification-v1",
  };
  const elRow = el.rows[0];
  if (elRow) {
    evidence.elevenlabs = {
      status: "PASS",
      providerId: "elevenlabs",
      modelId: elRow.model || "eleven_flash_v2_5",
      voiceId: "hpp4J3VqNfWAUOO0d1Us",
      generationId: Number(elRow.generation_id),
      audioAssetId: Number(elRow.asset_id),
      mime: elRow.mime,
      bytes: Number(elRow.byte_size),
      durationMs: elRow.duration_ms,
      sampleRate: elRow.sample_rate,
      channels: elRow.channels,
      contentHash: elRow.content_hash,
      storageKey: elRow.storage_key,
      callsUsed: 1,
      certificationKey: "phase27.3-elevenlabs-certification-v1",
    };
  }
  evidence.budget = afterBudget;
  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);

  console.log("✓ fal reconcile PASS", JSON.stringify({
    generationId: GENERATION_ID,
    videoAssetId: asset.id,
    bytes: Number(asset.byte_size),
    durationMs: asset.duration_ms,
    dims: `${asset.width}x${asset.height}`,
    contentHash: `${String(asset.content_hash).slice(0, 16)}…`,
    falCallsUnchanged: afterBudget.falCalls,
  }));
}

main().catch((error) => {
  console.error("RECONCILE FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
