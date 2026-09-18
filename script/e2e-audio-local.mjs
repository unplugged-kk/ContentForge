#!/usr/bin/env node
/**
 * Phase 27.3 live HTTP: text → shared VisualGeneration pipeline → real macOS
 * speech synthesis → validated WAV → AssetStoragePort → audio-kind VisualAsset.
 */
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_URL = process.env.E2E_LIVE_DATABASE_URL ?? "postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live";
const APP_PORT = Number(process.env.AUDIO_E2E_PORT ?? 5028);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const RUN = `audio27${Date.now().toString(36)}`;
let app = null;
let cookie = null;
let csrf = null;

if (!/127\.0\.0\.1:5433\/cf_e2e_live/.test(DB_URL)) {
  throw new Error("REFUSING TO RUN: use the isolated cf_e2e_live database");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value, message) {
  if (!value) throw new Error(message);
}

async function waitFor(fn, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(500);
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
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function startApp() {
  const output = createWriteStream(`/tmp/contentforge-audio-e2e-${process.pid}.log`, { flags: "a" });
  app = spawn("node", ["--import", "tsx", "server/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(APP_PORT),
      DATABASE_URL: DB_URL,
      SESSION_SECRET: "audio-e2e-secret",
      SESSION_COOKIE_SECURE: "0",
      CONTENTFORGE_E2E_SERVER: "1",
      DISABLE_CRON: "1",
      CONTENT_SCHEDULER_ENABLED: "0",
      MACOS_SAY_ENABLED: "true",
      MACOS_SAY_VOICES: "Samantha,Daniel",
      AUDIO_PROVIDER_ID: "macos-say",
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
  });
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

async function main() {
  await startApp();
  const providers = await http("GET", "/api/media/providers?modality=audio");
  assert(providers.status === 200, `provider discovery ${providers.status}`);
  const say = providers.body.providers.find((provider) => provider.id === "macos-say");
  assert(say?.configured && say?.reachable && say?.capable && say?.processing_ready, "macos-say is not processing-ready");
  assert(!JSON.stringify(providers.body).match(/API_KEY|secret/i), "provider discovery leaked secret-shaped data");

  const payload = {
    providerId: "macos-say",
    model: "macos-say/v1",
    intent: {
      subject: `${RUN} ContentForge generates real local speech and preserves provider-neutral identity.`,
      text: `${RUN} ContentForge generates real local speech and preserves provider-neutral identity.`,
      language: "en",
      speakingRate: 180,
      voice: { providerId: "macos-say", providerVoiceId: "Samantha", displayName: "Samantha" },
    },
  };
  const accepted = await http("POST", "/api/audio/generations", payload);
  assert(accepted.status === 201, `audio submit ${accepted.status}: ${JSON.stringify(accepted.body)}`);
  const generationId = accepted.body.id;

  // Crash after durable accept. pg-boss redelivers the same generation id.
  await killApp();
  await startApp();
  const completed = await waitFor(async () => {
    const response = await http("GET", `/api/audio/generations/${generationId}`);
    return response.status === 200 && response.body.status === "ready" ? response.body : false;
  }, 120_000);
  const asset = completed.assets?.[0];
  assert(asset?.mime === "audio/wav", "missing real WAV AudioAsset");
  assert(asset?.byteSize > 1_000, "audio bytes were not imported");
  assert(asset?.durationMs > 0, "audio duration missing");
  assert(asset?.sampleRate === 24_000, "audio sample rate missing");
  assert(asset?.channels === 1, "audio channels missing");
  assert(/^[a-f0-9]{64}$/.test(asset?.contentHash ?? ""), "audio content hash missing");

  const duplicate = await http("POST", "/api/audio/generations", payload);
  assert(duplicate.status === 200 && duplicate.body.id === generationId, "idempotency created a second generation");
  console.log(JSON.stringify({
    status: "PASS",
    provider: "macos-say",
    model: "macos-say/v1",
    voice: "Samantha",
    generationId,
    audioAssetId: asset.id,
    bytes: asset.byteSize,
    durationMs: asset.durationMs,
    sampleRate: asset.sampleRate,
    channels: asset.channels,
    contentHash: asset.contentHash,
    restart: "PASS",
    idempotency: "PASS",
  }, null, 2));
}

try {
  await main();
} finally {
  await killApp();
}
