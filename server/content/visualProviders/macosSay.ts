import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { JobFailure } from "../../jobs/failures";
import type { MediaVoiceDescriptor, VisualGenerationRequest, VisualProviderPort } from "../visual";

type JsonRecord = Record<string, unknown>;
const execFileAsync = promisify(execFile);
export const MACOS_SAY_PROVIDER_ID = "macos-say";
export const MACOS_SAY_MODEL_ID = "macos-say/v1";
const SAY_PATH = "/usr/bin/say";
const DEFAULT_VOICES = ["Samantha", "Daniel"] as const;

export function macosSayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MACOS_SAY_ENABLED === "true";
}

function configuredVoices(env: NodeJS.ProcessEnv): MediaVoiceDescriptor[] {
  const names = (env.MACOS_SAY_VOICES ?? DEFAULT_VOICES.join(","))
    .split(",")
    .map((voice) => voice.trim())
    .filter(Boolean);
  return names.map((providerVoiceId) => ({
    providerVoiceId,
    displayName: providerVoiceId,
    locale: providerVoiceId === "Daniel" ? "en-GB" : "en-US",
    language: "en",
  }));
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function boundedRate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(500, Math.max(80, Math.round(value)))
    : 175;
}

async function probeWav(path: string): Promise<{ durationMs: number; sampleRate: number; channels: number; codec: string }> {
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
    throw JobFailure.permanent("macOS Say produced audio with invalid probe metadata");
  }
  return { durationMs, sampleRate, channels, codec: stream?.codec_name ?? "pcm_s16le" };
}

export function createMacosSayProvider(
  env: NodeJS.ProcessEnv = process.env,
): VisualProviderPort {
  const voices = configuredVoices(env);
  const allowedVoices = new Set(voices.map((voice) => voice.providerVoiceId));
  return {
    providerId: MACOS_SAY_PROVIDER_ID,
    providerVersion: "macos-say-v1",
    capabilities: ["generate_audio"],
    modalities: ["audio"],
    models: [MACOS_SAY_MODEL_ID],
    modelCatalog: [{
      id: MACOS_SAY_MODEL_ID,
      displayName: "macOS Speech Synthesis",
      modalities: ["audio"],
      capabilities: ["generate_audio"],
      limits: { maxCharacters: 5_000, maxDurationMs: 1_800_000 },
      defaults: { format: "wav", sampleRate: 24_000, channels: 1 },
    }],
    voices,
    capabilityDeclaration: {
      audioGeneration: true,
      formats: ["wav"],
      supportsAsync: false,
      supportsStreaming: false,
      supportsSSML: false,
      supportsVoiceCloning: false,
    },
    synchronous: true,
    async health() {
      const configured = macosSayConfigured(env);
      let reachable = false;
      try {
        const [, , voiceList] = await Promise.all([
          access(SAY_PATH),
          execFileAsync("ffmpeg", ["-version"], { timeout: 5_000 }),
          execFileAsync(SAY_PATH, ["-v", "?"], { timeout: 5_000, maxBuffer: 2 * 1024 * 1024 }),
        ]);
        reachable = process.platform === "darwin"
          && voices.some((voice) => voiceList.stdout.includes(voice.providerVoiceId));
      } catch {
        reachable = false;
      }
      return {
        providerId: MACOS_SAY_PROVIDER_ID,
        registered: true,
        capabilities: ["generate_audio"],
        modalities: ["audio"],
        synchronous: true,
        transportConfigured: configured,
        reachable,
        capable: true,
        processingReady: configured && reachable,
        reason: !configured
          ? "MACOS_SAY_ENABLED is not true"
          : !reachable
            ? "macOS say or ffmpeg is unavailable"
            : null,
      };
    },
    async generate(request: VisualGenerationRequest) {
      if (!macosSayConfigured(env)) {
        throw JobFailure.permanent("macOS Say provider is not configured");
      }
      const snapshot = asRecord(request.snapshot);
      const intent = asRecord(snapshot.intent);
      const text = String(intent.text ?? intent.subject ?? "").trim();
      if (!text || text.length > 5_000) {
        throw JobFailure.permanent("macOS Say text must contain 1 to 5000 characters");
      }
      const voiceRecord = asRecord(intent.voice);
      const providerVoiceId = String(
        voiceRecord.providerVoiceId ?? intent.providerVoiceId ?? voices[0]?.providerVoiceId ?? "",
      );
      if (!allowedVoices.has(providerVoiceId)) {
        throw JobFailure.permanent(`macOS Say voice "${providerVoiceId}" is not configured`);
      }
      const startedAt = Date.now();
      const directory = await mkdtemp(join(tmpdir(), "contentforge-say-"));
      const aiffPath = join(directory, "speech.aiff");
      const wavPath = join(directory, "speech.wav");
      try {
        await execFileAsync(SAY_PATH, [
          "-v", providerVoiceId,
          "-r", String(boundedRate(intent.speakingRate)),
          "-o", aiffPath,
          text,
        ], { timeout: 5 * 60_000, maxBuffer: 1024 * 1024 });
        await execFileAsync("ffmpeg", [
          "-v", "error", "-y", "-i", aiffPath,
          "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", wavPath,
        ], { timeout: 5 * 60_000, maxBuffer: 2 * 1024 * 1024 });
        const [bytes, media] = await Promise.all([readFile(wavPath), probeWav(wavPath)]);
        return {
          bytes,
          mime: "audio/wav",
          width: null,
          height: null,
          durationMs: media.durationMs,
          container: "wav",
          codec: media.codec,
          frameRate: null,
          sampleRate: media.sampleRate,
          channels: media.channels,
          altText: `Speech audio generated with ${providerVoiceId}`,
          provider: MACOS_SAY_PROVIDER_ID,
          providerVersion: "macos-say-v1",
          model: request.model ?? MACOS_SAY_MODEL_ID,
          cost: null,
          usage: {
            characters: text.length,
            processingMs: Date.now() - startedAt,
            providerVoiceId,
            locale: voices.find((voice) => voice.providerVoiceId === providerVoiceId)?.locale ?? null,
            outputIdentity: `cfag-${request.generationId ?? "direct"}`,
          },
        };
      } catch (error) {
        if (error instanceof JobFailure) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        const message = error instanceof Error ? error.message : String(error);
        throw code === "ENOENT"
          ? JobFailure.permanent(`macOS Say configuration error: ${message}`)
          : JobFailure.transient(`macOS Say generation failed: ${message}`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
