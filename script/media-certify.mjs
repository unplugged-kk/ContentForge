#!/usr/bin/env node
/**
 * Phase 27.3 REAL PAID PROVIDER CERTIFICATION — manual / opt-in only.
 *
 * Requires:
 *   CONTENTFORGE_REAL_MEDIA_E2E=1
 *   CONTENTFORGE_MEDIA_CERTIFICATION=1
 *   FAL_KEY + ELEVENLABS_API_KEY in .env
 *
 * Hard budget: exactly ONE ElevenLabs TTS call and ONE fal video call.
 * Re-runs reuse durable ContentForge generations / refuse via budget file.
 *
 * Usage:
 *   CONTENTFORGE_REAL_MEDIA_E2E=1 CONTENTFORGE_MEDIA_CERTIFICATION=1 npm run test:media:certify
 */
import "dotenv/config";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_URL = process.env.E2E_LIVE_DATABASE_URL ?? "postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live";
const APP_PORT = Number(process.env.MEDIA_CERT_APP_PORT ?? 5030);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const EVIDENCE_PATH = path.join(ROOT, ".scratch", "media-cert-evidence.json");
const BUDGET_PATH = process.env.MEDIA_CERT_BUDGET_PATH
  ?? path.join(ROOT, ".scratch", "media-cert-budget.json");

const ELEVENLABS_CERT_KEY = "phase27.3-elevenlabs-certification-v1";
const FAL_CERT_KEY = "phase27.3-fal-certification-v1";
const CERT_TEXT =
  "ContentForge provider certification test. This audio confirms that ElevenLabs generation, storage, validation, and provenance work correctly.";
const FAL_PROMPT = "A single red cube on a white table, simple, static camera.";
const FAL_MODEL = process.env.FAL_MODEL_ID?.trim() || "fal-ai/wan/v2.2-a14b/text-to-video";

let app = null;
let cookie = null;
let csrf = null;

function assert(value, message) {
  if (!value) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(1_000);
  }
  throw new Error(`timeout after ${timeoutMs}ms`);
}

async function http(method, requestPath, body) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  const response = await fetch(`${BASE}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.getSetCookie?.()[0];
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

function readBudget() {
  if (!existsSync(BUDGET_PATH)) return { elevenlabsCalls: 0, falCalls: 0 };
  try {
    return JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
  } catch {
    return { elevenlabsCalls: 0, falCalls: 0 };
  }
}

function readEvidence() {
  if (!existsSync(EVIDENCE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeEvidence(evidence) {
  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
}

function preflight() {
  console.log("════════════════════════════════════════════════════════");
  console.log("REAL PAID PROVIDER TEST — Phase 27.3 media certification");
  console.log("════════════════════════════════════════════════════════");

  assert(process.env.CONTENTFORGE_REAL_MEDIA_E2E === "1", "CONTENTFORGE_REAL_MEDIA_E2E=1 required");
  assert(process.env.CONTENTFORGE_MEDIA_CERTIFICATION === "1", "CONTENTFORGE_MEDIA_CERTIFICATION=1 required");
  assert(/127\.0\.0\.1:5433\/cf_e2e_live/.test(DB_URL), "REFUSING: must use isolated cf_e2e_live DB");

  const falKey = (process.env.FAL_KEY || process.env.FAL_API_KEY || "").trim();
  const elKey = (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY || process.env.XI_API_KEY || "").trim();
  assert(falKey, "BLOCKED — credential unavailable: FAL_KEY");
  assert(elKey, "BLOCKED — credential unavailable: ELEVENLABS_API_KEY");

  assert(CERT_TEXT.length <= 200, `ElevenLabs text length ${CERT_TEXT.length} > 200`);
  assert(!process.env.MEDIA_CERT_REGENERATE, "regenerate flag must not be set");

  const budget = readBudget();
  const evidence = readEvidence();

  console.log("Safety envelope:");
  console.log("  ElevenLabs");
  console.log("    provider: elevenlabs");
  console.log("    model: (discovered or ELEVENLABS_MODEL_ID)");
  console.log("    voice: (discovered or ELEVENLABS_VOICE_ID)");
  console.log(`    text length: ${CERT_TEXT.length} (<=200)`);
  console.log("    calls allowed: 1");
  console.log(`    certification key: ${ELEVENLABS_CERT_KEY}`);
  console.log(`    calls already used: ${budget.elevenlabsCalls ?? 0}`);
  console.log("  fal.ai");
  console.log("    provider: fal");
  console.log(`    model: ${FAL_MODEL}`);
  console.log("    resolution: 480p");
  console.log("    duration target: <=2s (17 frames @ 16fps)");
  console.log("    calls allowed: 1");
  console.log(`    certification key: ${FAL_CERT_KEY}`);
  console.log(`    calls already used: ${budget.falCalls ?? 0}`);
  console.log("  secrets: not printed");

  return { budget, evidence };
}

async function discoverElevenLabsDefaults() {
  const key = (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY || process.env.XI_API_KEY || "").trim();
  const [modelsRes, voicesRes] = await Promise.all([
    fetch("https://api.elevenlabs.io/v1/models", {
      headers: { "xi-api-key": key, Accept: "application/json" },
    }),
    fetch("https://api.elevenlabs.io/v2/voices?page_size=20", {
      headers: { "xi-api-key": key, Accept: "application/json" },
    }),
  ]);
  assert(modelsRes.ok, `ElevenLabs models HTTP ${modelsRes.status}`);
  assert(voicesRes.ok, `ElevenLabs voices HTTP ${voicesRes.status}`);
  const models = await modelsRes.json();
  const voicesJson = await voicesRes.json();
  const preferred = ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_flash_v2", "eleven_turbo_v2"];
  const tts = (Array.isArray(models) ? models : []).filter((m) => m.can_do_text_to_speech && m.model_id);
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim()
    || preferred.find((id) => tts.some((m) => m.model_id === id))
    || tts[0]?.model_id;
  assert(modelId, "no TTS model available");
  const voices = voicesJson.voices ?? [];
  const voice = process.env.ELEVENLABS_VOICE_ID?.trim()
    ? { voice_id: process.env.ELEVENLABS_VOICE_ID.trim(), name: process.env.ELEVENLABS_VOICE_NAME || "pinned" }
    : (voices.find((v) => v.voice_id && v.category !== "cloned") ?? voices.find((v) => v.voice_id));
  assert(voice?.voice_id, "no usable ElevenLabs voice");
  return { modelId, voiceId: voice.voice_id, voiceName: voice.name ?? voice.voice_id };
}

async function startApp(elDefaults) {
  const output = createWriteStream(`/tmp/contentforge-media-cert-${process.pid}.log`, { flags: "a" });
  app = spawn("node", ["--import", "tsx", "server/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(APP_PORT),
      DATABASE_URL: DB_URL,
      SESSION_SECRET: "media-cert-secret",
      SESSION_COOKIE_SECURE: "0",
      CONTENTFORGE_E2E_SERVER: "1",
      DISABLE_CRON: "1",
      CONTENT_SCHEDULER_ENABLED: "0",
      CONTENTFORGE_REAL_MEDIA_E2E: "1",
      CONTENTFORGE_MEDIA_CERTIFICATION: "1",
      MEDIA_CERT_BUDGET_PATH: BUDGET_PATH,
      ELEVENLABS_VOICE_ID: elDefaults.voiceId,
      ELEVENLABS_VOICE_NAME: elDefaults.voiceName,
      ELEVENLABS_MODEL_ID: elDefaults.modelId,
      FAL_MODEL_ID: FAL_MODEL,
      MACOS_SAY_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.pipe(output);
  app.stderr.pipe(output);
  await waitFor(async () => {
    try {
      return (await fetch(`${BASE}/api/csrf-token`)).ok;
    } catch {
      return false;
    }
  }, 60_000);
  cookie = null;
  csrf = null;
  const response = await http("GET", "/api/csrf-token");
  csrf = response.body?.csrfToken;
}

async function killApp() {
  if (!app) return;
  const child = app;
  app = null;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGKILL");
  });
}

async function certifyElevenLabs(elDefaults, evidence) {
  if (evidence.elevenlabs?.status === "PASS" && evidence.elevenlabs?.generationId) {
    console.log("ElevenLabs: prior successful certification evidence found — skipping paid call");
    // Still verify generation is readable if app is up.
    const existing = await http("GET", `/api/audio/generations/${evidence.elevenlabs.generationId}`);
    if (existing.status === 200 && existing.body?.status === "ready") {
      return evidence.elevenlabs;
    }
    console.log("ElevenLabs: prior evidence generation not ready in this DB — will not resubmit paid call");
    console.log("  (budget/evidence say already certified; reconcile manually if needed)");
    return evidence.elevenlabs;
  }

  const budget = readBudget();
  assert((budget.elevenlabsCalls ?? 0) < 1, "ElevenLabs certification budget already exhausted");

  console.log("\n→ ElevenLabs: submitting ONE short TTS request…");
  const payload = {
    providerId: "elevenlabs",
    model: elDefaults.modelId,
    intent: {
      subject: CERT_TEXT,
      text: CERT_TEXT,
      language: "en",
      certificationKey: ELEVENLABS_CERT_KEY,
      modelPreference: elDefaults.modelId,
      voice: {
        providerId: "elevenlabs",
        providerVoiceId: elDefaults.voiceId,
        displayName: elDefaults.voiceName,
      },
      providerVoiceId: elDefaults.voiceId,
    },
  };

  const accepted = await http("POST", "/api/audio/generations", payload);
  assert(
    accepted.status === 201 || accepted.status === 200,
    `ElevenLabs submit ${accepted.status}: ${JSON.stringify(accepted.body)}`,
  );
  const generationId = accepted.body.id;
  console.log(`  generationId=${generationId} created=${accepted.status === 201}`);

  const completed = await waitFor(async () => {
    const response = await http("GET", `/api/audio/generations/${generationId}`);
    if (response.status !== 200) return false;
    if (response.body.status === "failed" || response.body.status === "unknown") {
      throw new Error(`ElevenLabs generation ${generationId} ended ${response.body.status}: ${response.body.error ?? ""}`);
    }
    return response.body.status === "ready" ? response.body : false;
  }, 180_000);

  const asset = completed.assets?.[0];
  assert(asset?.mime === "audio/mpeg" || asset?.mime === "audio/mp3", `unexpected mime ${asset?.mime}`);
  assert(asset?.byteSize > 500, "audio bytes missing");
  assert(asset?.durationMs > 0, "duration missing");
  assert(/^[a-f0-9]{64}$/.test(asset?.contentHash ?? ""), "content hash missing");

  const result = {
    status: "PASS",
    providerId: "elevenlabs",
    modelId: elDefaults.modelId,
    voiceId: elDefaults.voiceId,
    voiceName: elDefaults.voiceName,
    generationId,
    audioAssetId: asset.id,
    mime: asset.mime,
    bytes: asset.byteSize,
    durationMs: asset.durationMs,
    sampleRate: asset.sampleRate,
    channels: asset.channels,
    contentHash: asset.contentHash,
    storageKey: asset.storageKey,
    callsUsed: 1,
    certificationKey: ELEVENLABS_CERT_KEY,
  };
  console.log("  ✓ ElevenLabs certified:", JSON.stringify({
    generationId,
    audioAssetId: asset.id,
    bytes: asset.byteSize,
    durationMs: asset.durationMs,
    contentHash: asset.contentHash?.slice(0, 16) + "…",
  }));
  return result;
}

async function certifyFal(evidence) {
  if (evidence.fal?.status === "PASS" && evidence.fal?.generationId) {
    console.log("fal.ai: prior successful certification evidence found — skipping paid call");
    const existing = await http("GET", `/api/video-generations/${evidence.fal.generationId}`);
    if (existing.status === 200 && existing.body?.status === "ready") {
      return evidence.fal;
    }
    console.log("fal.ai: prior evidence not ready in this DB — will not resubmit paid call");
    return evidence.fal;
  }

  const budget = readBudget();
  assert((budget.falCalls ?? 0) < 1, "fal certification budget already exhausted");

  console.log("\n→ fal.ai: submitting ONE short 480p T2V request…");
  const payload = {
    providerId: "fal",
    model: FAL_MODEL,
    intent: {
      subject: FAL_PROMPT,
      prompt: FAL_PROMPT,
      certificationKey: FAL_CERT_KEY,
      modelPreference: FAL_MODEL,
      resolution: "480p",
      numFrames: 17,
      framesPerSecond: 16,
      aspectRatio: "16:9",
    },
  };

  const accepted = await http("POST", "/api/video-generations", payload);
  assert(
    accepted.status === 201 || accepted.status === 200,
    `fal submit ${accepted.status}: ${JSON.stringify(accepted.body)}`,
  );
  const generationId = accepted.body.id;
  console.log(`  generationId=${generationId} created=${accepted.status === 201}`);

  const completed = await waitFor(async () => {
    const response = await http("GET", `/api/video-generations/${generationId}`);
    if (response.status !== 200) return false;
    if (response.body.status === "failed") {
      throw new Error(`fal generation ${generationId} failed: ${response.body.error ?? ""}`);
    }
    // unknown may still reconcile — keep waiting within budget
    return response.body.status === "ready" ? response.body : false;
  }, 12 * 60_000);

  const assets = completed.assets ?? [];
  const asset = assets[0];
  assert(asset?.mime === "video/mp4", `unexpected mime ${asset?.mime}`);
  assert(asset?.byteSize > 1_000, "video bytes missing");
  assert(/^[a-f0-9]{64}$/.test(asset?.contentHash ?? ""), "content hash missing");

  const result = {
    status: "PASS",
    providerId: "fal",
    modelId: FAL_MODEL,
    generationId,
    videoAssetId: asset.id,
    providerJobId: completed.externalJobId ?? completed.providerJobId ?? null,
    mime: asset.mime,
    bytes: asset.byteSize,
    durationMs: asset.durationMs,
    width: asset.width,
    height: asset.height,
    contentHash: asset.contentHash,
    storageKey: asset.storageKey,
    resolution: "480p",
    numFrames: 17,
    framesPerSecond: 16,
    callsUsed: 1,
    certificationKey: FAL_CERT_KEY,
  };
  console.log("  ✓ fal.ai certified:", JSON.stringify({
    generationId,
    videoAssetId: asset.id,
    bytes: asset.byteSize,
    durationMs: asset.durationMs,
    dims: `${asset.width}x${asset.height}`,
    contentHash: asset.contentHash?.slice(0, 16) + "…",
  }));
  return result;
}

async function main() {
  const { evidence } = preflight();
  console.log("\nDiscovering ElevenLabs model/voice (GET only — no TTS spend)…");
  const elDefaults = await discoverElevenLabsDefaults();
  console.log(`  model=${elDefaults.modelId} voice=${elDefaults.voiceName} (${elDefaults.voiceId.slice(0, 8)}…)`);

  // Ensure e2e DB is up
  try {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    await client.end();
  } catch (error) {
    console.error("E2E database not reachable. Start with: npm run e2e:db:up");
    throw error;
  }

  await startApp(elDefaults);
  try {
    const audioProviders = await http("GET", "/api/media/providers?modality=audio");
    assert(audioProviders.status === 200, "audio provider discovery failed");
    assert(!JSON.stringify(audioProviders.body).match(/sk-|Key |xi-api/i), "discovery leaked secret-shaped data");

    const eleven = await certifyElevenLabs(elDefaults, evidence);
    const fal = await certifyFal({ ...evidence, elevenlabs: eleven });

    const out = {
      phase: "27.3",
      completedAt: new Date().toISOString(),
      elevenlabs: eleven,
      fal,
      budget: readBudget(),
      note: "Exactly one paid call per provider when status=PASS and callsUsed=1",
    };
    writeEvidence(out);
    console.log("\n════════════════════════════════════════════════════════");
    console.log("CERTIFICATION COMPLETE");
    console.log(`Evidence written to ${EVIDENCE_PATH}`);
    console.log(JSON.stringify({
      elevenlabs: { status: eleven.status, generationId: eleven.generationId, callsUsed: eleven.callsUsed },
      fal: { status: fal.status, generationId: fal.generationId, callsUsed: fal.callsUsed },
      budget: out.budget,
    }, null, 2));
  } finally {
    await killApp();
  }
}

main().catch((error) => {
  console.error("\nCERTIFICATION FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
