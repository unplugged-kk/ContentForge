/**
 * ElevenLabs TTS adapter — providerId `elevenlabs`, modelId separate.
 *
 * Paid generate() is gated by mediaCertification spend guards. Unit tests mock
 * fetchImpl and never hit the network.
 */

import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { JobFailure } from "../../jobs/failures";
import {
  assertElevenLabsCertificationRequest,
  assertPaidMediaAllowed,
  ELEVENLABS_CERT_KEY,
  recordElevenLabsCertificationCall,
} from "../mediaCertification";
import type {
  MediaVoiceDescriptor,
  VisualGenerationRequest,
  VisualProviderHealth,
  VisualProviderPort,
} from "../visual";

const execFileAsync = promisify(execFile);

export const ELEVENLABS_PROVIDER_ID = "elevenlabs";
export const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_flash_v2_5";
export const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

export function elevenLabsApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.ELEVENLABS_API_KEY?.trim()
    || env.ELEVEN_API_KEY?.trim()
    || env.XI_API_KEY?.trim()
    || "";
  return key || null;
}

export function elevenLabsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(elevenLabsApiKey(env));
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function mapHttpFailure(status: number, bodyText: string): never {
  const safe = bodyText.slice(0, 200).replace(/xi-api-key|api[_-]?key|bearer\s+\S+/gi, "[redacted]");
  if (status === 429) throw JobFailure.rateLimited(`ElevenLabs rate limited: ${safe}`);
  if (status === 401 || status === 403) {
    throw JobFailure.permanent(`ElevenLabs configuration error (${status})`);
  }
  if (status === 402 || /quota|credit|payment/i.test(safe)) {
    throw Object.assign(JobFailure.permanent(`ElevenLabs quota: ${safe}`), { failureClass: "quota" as const });
  }
  if (status >= 500) throw JobFailure.transient(`ElevenLabs upstream ${status}`);
  throw JobFailure.permanent(`ElevenLabs rejected request (${status}): ${safe}`);
}

async function probeMp3(bytes: Buffer): Promise<{
  durationMs: number;
  sampleRate: number;
  channels: number;
  codec: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "contentforge-el-"));
  const path = join(directory, "speech.mp3");
  try {
    await writeFile(path, bytes);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,sample_rate,channels:format=duration",
      "-of", "json",
      path,
    ], { timeout: 15_000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    const durationMs = Math.round(Number(parsed.format?.duration) * 1000);
    const sampleRate = Number(stream?.sample_rate);
    const channels = Number(stream?.channels);
    if (!Number.isInteger(durationMs) || durationMs <= 0 || !Number.isInteger(sampleRate) || !Number.isInteger(channels)) {
      throw JobFailure.permanent("ElevenLabs produced audio with invalid probe metadata");
    }
    return {
      durationMs,
      sampleRate,
      channels,
      codec: stream?.codec_name ?? "mp3",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export interface ElevenLabsProviderOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  /** Override catalog for tests. */
  models?: string[];
  voices?: MediaVoiceDescriptor[];
}

export function createElevenLabsProvider(
  options: ElevenLabsProviderOptions = {},
): VisualProviderPort {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const models = options.models ?? [
    env.ELEVENLABS_MODEL_ID?.trim() || ELEVENLABS_DEFAULT_MODEL_ID,
  ];
  const voiceCache: MediaVoiceDescriptor[] = options.voices
    ? [...options.voices]
    : (env.ELEVENLABS_VOICE_ID?.trim()
      ? [{
        providerVoiceId: env.ELEVENLABS_VOICE_ID.trim(),
        displayName: env.ELEVENLABS_VOICE_NAME?.trim() || "Configured voice",
        language: "en",
      }]
      : []);

  return {
    providerId: ELEVENLABS_PROVIDER_ID,
    providerVersion: "elevenlabs-v1",
    capabilities: ["generate_audio"],
    modalities: ["audio"],
    models,
    modelCatalog: models.map((id) => ({
      id,
      displayName: id,
      modalities: ["audio"] as const,
      capabilities: ["generate_audio"] as const,
      defaults: { format: "mp3", outputFormat: "mp3_44100_128" },
    })),
    get voices() {
      return voiceCache;
    },
    capabilityDeclaration: {
      audioGeneration: true,
      formats: ["mp3"],
      supportsAsync: false,
      supportsStreaming: false,
      supportsSSML: false,
      supportsVoiceCloning: false,
    },
    synchronous: true,
    async health(): Promise<VisualProviderHealth> {
      const configured = elevenLabsConfigured(env);
      let reachable = false;
      if (configured) {
        try {
          const key = elevenLabsApiKey(env)!;
          const res = await fetchImpl(`${ELEVENLABS_API_BASE}/v1/user`, {
            method: "GET",
            headers: { "xi-api-key": key, Accept: "application/json" },
            signal: AbortSignal.timeout(8_000),
          });
          reachable = res.ok || res.status === 401 || res.status === 403;
          // Cheap voice catalog refresh for discovery — never generates speech.
          if (res.ok && voiceCache.length === 0) {
            try {
              const voicesRes = await fetchImpl(`${ELEVENLABS_API_BASE}/v2/voices?page_size=20`, {
                headers: { "xi-api-key": key, Accept: "application/json" },
                signal: AbortSignal.timeout(8_000),
              });
              if (voicesRes.ok) {
                const voicesJson = await voicesRes.json() as {
                  voices?: Array<{ voice_id?: string; name?: string; category?: string }>;
                };
                for (const voice of voicesJson.voices ?? []) {
                  if (!voice.voice_id || voice.category === "cloned") continue;
                  voiceCache.push({
                    providerVoiceId: voice.voice_id,
                    displayName: voice.name ?? voice.voice_id,
                    language: "en",
                  });
                  if (voiceCache.length >= 5) break;
                }
              }
            } catch {
              // Voice discovery failure does not flip health to unhealthy.
            }
          }
        } catch {
          reachable = false;
        }
      }
      return {
        providerId: ELEVENLABS_PROVIDER_ID,
        registered: true,
        capabilities: ["generate_audio"],
        modalities: ["audio"],
        synchronous: true,
        transportConfigured: configured,
        reachable,
        capable: true,
        processingReady: configured && reachable,
        reason: !configured
          ? "ELEVENLABS_API_KEY is not configured"
          : !reachable
            ? "ElevenLabs API unreachable"
            : null,
      };
    },
    async generate(request: VisualGenerationRequest) {
      assertPaidMediaAllowed(ELEVENLABS_PROVIDER_ID, env);
      const key = elevenLabsApiKey(env);
      if (!key) throw JobFailure.permanent("ElevenLabs API key is not configured");

      const snapshot = asRecord(request.snapshot);
      const intent = asRecord(snapshot.intent);
      const text = String(intent.text ?? intent.subject ?? "").trim();
      const voiceRecord = asRecord(intent.voice);
      const providerVoiceId = String(
        voiceRecord.providerVoiceId
          ?? intent.providerVoiceId
          ?? env.ELEVENLABS_VOICE_ID?.trim()
          ?? voiceCache[0]?.providerVoiceId
          ?? "",
      );
      const modelId = request.model
        ?? (typeof intent.modelPreference === "string" ? intent.modelPreference : null)
        ?? models[0]
        ?? ELEVENLABS_DEFAULT_MODEL_ID;
      const certKey = typeof intent.certificationKey === "string"
        ? intent.certificationKey
        : ELEVENLABS_CERT_KEY;

      assertElevenLabsCertificationRequest({
        text,
        regenerate: Boolean(intent.regenerate),
        certKey,
      }, env);

      if (!text) throw JobFailure.permanent("ElevenLabs text is required");
      if (!providerVoiceId) throw JobFailure.permanent("ElevenLabs voice is not configured");
      if (voiceCache.length > 0
        && !voiceCache.some((voice) => voice.providerVoiceId === providerVoiceId)) {
        throw JobFailure.permanent(`ElevenLabs voice "${providerVoiceId}" is not configured`);
      }

      const startedAt = Date.now();
      // Record budget BEFORE the paid call so a crash after submit still
      // consumes the slot and cannot silently retry another paid request.
      recordElevenLabsCertificationCall(certKey, env);

      const url = `${ELEVENLABS_API_BASE}/v1/text-to-speech/${encodeURIComponent(providerVoiceId)}`
        + `?output_format=mp3_44100_128`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: modelId,
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        throw JobFailure.transient(
          `ElevenLabs request ambiguous after budget consume: ${error instanceof Error ? error.message : "network"}`,
        );
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        mapHttpFailure(response.status, bodyText);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 100) {
        throw JobFailure.permanent("ElevenLabs returned empty audio");
      }
      const media = await probeMp3(bytes);
      const characterCost = response.headers.get("character-cost");
      const requestId = response.headers.get("request-id")
        || response.headers.get("x-request-id");
      const traceId = response.headers.get("x-trace-id");

      return {
        bytes,
        mime: "audio/mpeg",
        width: null,
        height: null,
        durationMs: media.durationMs,
        container: "mp3",
        codec: media.codec,
        sampleRate: media.sampleRate,
        channels: media.channels,
        altText: `Speech audio generated with ElevenLabs ${providerVoiceId}`,
        provider: ELEVENLABS_PROVIDER_ID,
        providerVersion: "elevenlabs-v1",
        model: modelId,
        cost: characterCost,
        usage: {
          characters: text.length,
          characterCost: characterCost ? Number(characterCost) : null,
          processingMs: Date.now() - startedAt,
          providerVoiceId,
          requestId: requestId ?? null,
          traceId: traceId ?? null,
          outputIdentity: `cfag-${request.generationId ?? "direct"}`,
          certificationKey: certKey,
        },
      };
    },
  };
}

/** Discover one cheap TTS model + one non-cloned voice for certification. */
export async function discoverElevenLabsCertificationDefaults(options: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
} = {}): Promise<{ modelId: string; voiceId: string; voiceName: string }> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const key = elevenLabsApiKey(env);
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");

  const [modelsRes, voicesRes] = await Promise.all([
    fetchImpl(`${ELEVENLABS_API_BASE}/v1/models`, {
      headers: { "xi-api-key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }),
    fetchImpl(`${ELEVENLABS_API_BASE}/v2/voices?page_size=20`, {
      headers: { "xi-api-key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }),
  ]);
  if (!modelsRes.ok) throw new Error(`ElevenLabs models HTTP ${modelsRes.status}`);
  if (!voicesRes.ok) throw new Error(`ElevenLabs voices HTTP ${voicesRes.status}`);

  const modelsJson = await modelsRes.json() as Array<{
    model_id?: string;
    name?: string;
    can_do_text_to_speech?: boolean;
  }>;
  const preferred = ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_flash_v2", "eleven_turbo_v2"];
  const ttsModels = modelsJson.filter((model) => model.can_do_text_to_speech && model.model_id);
  const modelId = preferred.find((id) => ttsModels.some((model) => model.model_id === id))
    ?? ttsModels[0]?.model_id
    ?? ELEVENLABS_DEFAULT_MODEL_ID;

  const voicesJson = await voicesRes.json() as {
    voices?: Array<{ voice_id?: string; name?: string; category?: string }>;
  };
  const voices = voicesJson.voices ?? [];
  const voice = voices.find((row) => row.voice_id && row.category !== "cloned")
    ?? voices.find((row) => row.voice_id);
  if (!voice?.voice_id) throw new Error("ElevenLabs returned no usable voice");

  return {
    modelId,
    voiceId: voice.voice_id,
    voiceName: voice.name ?? voice.voice_id,
  };
}
