/**
 * Versioned Video Factory integration contract (Phase 21).
 *
 * Transport-neutral: the same request/status/output shapes are used whether
 * ContentForge talks to a co-located filesystem queue or (later) an HTTP
 * factory. This module never reads Video Factory internals, never sees
 * ContentForge credentials, and never treats `manifest.json` as generation truth.
 *
 * Payload choice: **bounded textual job contract** (Option A). Scripts/briefs
 * stay out of pg-boss (`visual.run` still carries only `{ visualGenerationId }`);
 * the worker loads Postgres state and serializes this contract at the provider
 * boundary. Remote object storage is not invented here — the current factory
 * only consumes a job folder.
 */

import { InvalidVisualInputError } from "./visual";

export const VIDEO_FACTORY_CONTRACT_VERSION = "video-factory.contract.v1" as const;
export const VIDEO_FACTORY_PROVIDER_ID = "video-factory";

export const VIDEO_FACTORY_FORMATS = ["9:16", "16:9", "1:1"] as const;
export type VideoFactoryFormat = (typeof VIDEO_FACTORY_FORMATS)[number];

export const VIDEO_FACTORY_RENDER_QUALITIES = ["draft", "medium", "high"] as const;
export type VideoFactoryRenderQuality = (typeof VIDEO_FACTORY_RENDER_QUALITIES)[number];

export const VIDEO_FACTORY_EXTERNAL_STATES = [
  "accepted",
  "building",
  "queued",
  "voicing",
  "voiced",
  "rendering",
  "done",
  "failed",
  "unknown",
] as const;
export type VideoFactoryExternalState = (typeof VIDEO_FACTORY_EXTERNAL_STATES)[number];

const MAX_TITLE = 200;
const MAX_BRIEF = 8_000;
const MAX_SCRIPT = 50_000;
const MAX_STORYBOARD = 50_000;
const MAX_VOICE_ID = 80;

export interface VideoFactoryVoiceSpec {
  enabled: boolean;
  /** Provider-approved identifier only; never a shell argument. */
  id?: string;
}

export interface VideoFactoryRenderSpec {
  /** Allowlisted quality only. Never arbitrary CLI args. */
  quality: VideoFactoryRenderQuality;
}

export interface VideoFactoryJobRequest {
  contractVersion: typeof VIDEO_FACTORY_CONTRACT_VERSION;
  jobId: string;
  title: string;
  format: VideoFactoryFormat;
  brief: string;
  script: string | null;
  storyboard: string | null;
  voice: VideoFactoryVoiceSpec;
  render: VideoFactoryRenderSpec;
  durationMs: number | null;
}

export interface VideoFactoryStatus {
  contractVersion: typeof VIDEO_FACTORY_CONTRACT_VERSION;
  jobId: string;
  /** Known factory state, or `unknown` when observation is insufficient. */
  state: VideoFactoryExternalState;
  /** Observation only — never treated as publication/generation truth. */
  observational: boolean;
  error?: string | null;
}

export interface VideoFactoryOutputRef {
  contractVersion: typeof VIDEO_FACTORY_CONTRACT_VERSION;
  jobId: string;
  /** Durable identity of the bytes (sha256 hex). Not a filesystem path. */
  outputIdentity: string;
  mime: "video/mp4";
  bytes: Buffer;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  container: "mp4";
  byteSize: number;
}

export type VideoFactoryProgressClass = "in_progress" | "completed" | "permanent" | "unknown";

const IN_PROGRESS = new Set<VideoFactoryExternalState>([
  "accepted",
  "building",
  "queued",
  "voicing",
  "voiced",
  "rendering",
]);

/** Map factory observation → ContentForge handling. `done` is not `ready`. */
export function classifyVideoFactoryState(state: VideoFactoryExternalState): VideoFactoryProgressClass {
  if (state === "done") return "completed";
  if (state === "failed") return "permanent";
  if (state === "unknown") return "unknown";
  if (IN_PROGRESS.has(state)) return "in_progress";
  return "unknown";
}

export function videoFactoryJobId(generationId: number): string {
  if (!Number.isInteger(generationId) || generationId <= 0) {
    throw new InvalidVisualInputError(["Video Factory job identity requires a positive VisualGeneration id"]);
  }
  return `cfvg-${generationId}`;
}

export function assertSafeVideoFactoryJobId(jobId: string): string {
  if (typeof jobId !== "string" || !/^cfvg-[1-9][0-9]{0,9}$/.test(jobId)) {
    throw new InvalidVisualInputError([`unsafe Video Factory job id "${String(jobId).slice(0, 60)}"`]);
  }
  if (jobId.includes("..") || jobId.includes("/") || jobId.includes("\\") || jobId.includes("\0")) {
    throw new InvalidVisualInputError(["Video Factory job id must not contain path elements"]);
  }
  return jobId;
}

export function parseVideoFactoryFormat(value: unknown): VideoFactoryFormat {
  if (value === "9:16" || value === "16:9" || value === "1:1") return value;
  if (value === "9x16" || value === "9-16") return "9:16";
  if (value === "16x9" || value === "16-9") return "16:9";
  return "9:16";
}

export function dimensionsForFormat(format: VideoFactoryFormat): { width: number; height: number } {
  if (format === "16:9") return { width: 1920, height: 1080 };
  if (format === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

export function parseVideoFactoryRenderQuality(value: unknown): VideoFactoryRenderQuality {
  if (value === "draft" || value === "medium" || value === "high") return value;
  return "high";
}

/**
 * Render options are a typed allowlist. Arbitrary `renderArgs`, `--output`,
 * shell metacharacters, and Story/AI text must never become a command.
 */
export function validateVideoFactoryRenderSpec(input: unknown): VideoFactoryRenderSpec {
  if (input == null) return { quality: "high" };
  if (Array.isArray(input)) {
    throw new InvalidVisualInputError(["Video Factory renderArgs arrays are not allowed; use render.quality"]);
  }
  if (typeof input === "string") {
    throw new InvalidVisualInputError(["Video Factory render options must be an object, not a command string"]);
  }
  if (typeof input !== "object") {
    throw new InvalidVisualInputError(["Video Factory render options are invalid"]);
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "quality") {
      throw new InvalidVisualInputError([`Video Factory render option "${key}" is not allowlisted`]);
    }
  }
  const quality = record.quality;
  if (quality !== undefined && quality !== "draft" && quality !== "medium" && quality !== "high") {
    throw new InvalidVisualInputError([`Video Factory render quality "${String(quality)}" is not allowlisted`]);
  }
  return { quality: parseVideoFactoryRenderQuality(quality) };
}

export function videoFactoryRenderArgs(spec: VideoFactoryRenderSpec): ["--quality", VideoFactoryRenderQuality] {
  return ["--quality", spec.quality];
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\0/g, "").replace(/\r\n/g, "\n");
  const trimmed = cleaned.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function parseVoice(input: unknown): VideoFactoryVoiceSpec {
  if (input === true) return { enabled: true };
  if (input === false) return { enabled: false };
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const enabled = record.enabled !== false;
    const rawId = typeof record.id === "string" ? record.id.trim() : "";
    if (rawId) {
      if (!/^[a-zA-Z0-9._-]{1,80}$/.test(rawId) || rawId.length > MAX_VOICE_ID) {
        throw new InvalidVisualInputError(["Video Factory voice id is not a provider-approved identifier"]);
      }
      return { enabled, id: rawId };
    }
    return { enabled };
  }
  return { enabled: false };
}

export interface BuildVideoFactoryRequestInput {
  generationId: number;
  snapshot: Record<string, unknown>;
}

/**
 * Build the bounded contract from a frozen VisualGeneration snapshot.
 * ContextAssembly internals, credentials, publication config, and analytics
 * never cross this boundary.
 */
export function buildVideoFactoryJobRequest(input: BuildVideoFactoryRequestInput): VideoFactoryJobRequest {
  const jobId = assertSafeVideoFactoryJobId(videoFactoryJobId(input.generationId));
  const snapshot = input.snapshot ?? {};
  const intent =
    snapshot.intent && typeof snapshot.intent === "object" ? (snapshot.intent as Record<string, unknown>) : {};
  const spec =
    snapshot.spec && typeof snapshot.spec === "object" ? (snapshot.spec as Record<string, unknown>) : {};

  if (intent.renderArgs !== undefined) {
    throw new InvalidVisualInputError(["Video Factory renderArgs are not allowed on the ContentForge contract"]);
  }
  if (typeof intent.jobId === "string" || typeof intent.externalJobId === "string") {
    throw new InvalidVisualInputError(["Video Factory job identity cannot be supplied by intent"]);
  }
  if (typeof intent.callbackUrl === "string" || typeof intent.outputPath === "string") {
    throw new InvalidVisualInputError(["Video Factory contract rejects callback URLs and output paths from intent"]);
  }

  const format = parseVideoFactoryFormat(intent.aspectRatio ?? spec.aspectRatio ?? intent.format);
  const title =
    boundedText(intent.title ?? intent.subject, MAX_TITLE) ??
    `ContentForge video ${jobId}`;
  const brief =
    boundedText(intent.brief ?? intent.subject, MAX_BRIEF) ??
    boundedText(intent.script, MAX_BRIEF);
  const script = boundedText(intent.script, MAX_SCRIPT);
  const storyboard = boundedText(intent.storyboard, MAX_STORYBOARD);

  if (!brief && !script) {
    throw new InvalidVisualInputError([
      "provider blocked by missing renderable project artifact: brief or script is required",
    ]);
  }

  const durationRaw = intent.durationMs ?? snapshot.durationMs;
  const durationMs =
    typeof durationRaw === "number" && Number.isInteger(durationRaw) && durationRaw > 0 ? durationRaw : null;

  return {
    contractVersion: VIDEO_FACTORY_CONTRACT_VERSION,
    jobId,
    title,
    format,
    brief: brief ?? script ?? title,
    script,
    storyboard,
    voice: parseVoice(intent.voice),
    render: validateVideoFactoryRenderSpec(intent.render),
    durationMs,
  };
}

export function parseVideoFactoryJobRequest(raw: unknown): VideoFactoryJobRequest {
  if (!raw || typeof raw !== "object") {
    throw new InvalidVisualInputError(["Video Factory contract must be an object"]);
  }
  const record = raw as Record<string, unknown>;
  if (record.contractVersion !== VIDEO_FACTORY_CONTRACT_VERSION) {
    throw new InvalidVisualInputError([
      `unsupported Video Factory contract version "${String(record.contractVersion ?? "")}"`,
    ]);
  }
  const jobId = assertSafeVideoFactoryJobId(String(record.jobId ?? ""));
  if (typeof record.title !== "string" || !record.title.trim()) {
    throw new InvalidVisualInputError(["Video Factory contract title is required"]);
  }
  const format = parseVideoFactoryFormat(record.format);
  const brief = boundedText(record.brief, MAX_BRIEF);
  if (!brief) throw new InvalidVisualInputError(["Video Factory contract brief is required"]);
  const voiceRaw = record.voice;
  const renderRaw = record.render;
  return {
    contractVersion: VIDEO_FACTORY_CONTRACT_VERSION,
    jobId,
    title: boundedText(record.title, MAX_TITLE) ?? jobId,
    format,
    brief,
    script: boundedText(record.script, MAX_SCRIPT),
    storyboard: boundedText(record.storyboard, MAX_STORYBOARD),
    voice: parseVoice(voiceRaw),
    render: validateVideoFactoryRenderSpec(renderRaw),
    durationMs:
      typeof record.durationMs === "number" && Number.isInteger(record.durationMs) && record.durationMs > 0
        ? record.durationMs
        : null,
  };
}

export function serializeVideoFactoryJobRequest(request: VideoFactoryJobRequest): string {
  const parsed = parseVideoFactoryJobRequest(request);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/** Factory-native `job.json` — only fields the current runner.mjs reads. */
export function videoFactoryNativeJobJson(request: VideoFactoryJobRequest): Record<string, unknown> {
  return {
    title: request.title,
    format: request.format,
    voice: request.voice.enabled,
    renderArgs: videoFactoryRenderArgs(request.render),
  };
}

export function parseExternalState(value: unknown): VideoFactoryExternalState {
  if (typeof value === "string" && (VIDEO_FACTORY_EXTERNAL_STATES as readonly string[]).includes(value)) {
    return value as VideoFactoryExternalState;
  }
  return "unknown";
}
