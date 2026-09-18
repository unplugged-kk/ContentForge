/**
 * Video repurposing (Phase 27).
 *
 * Distinct from VisualGeneration: an owned VideoAsset is clipped into N short
 * VideoAssets. ContentForge owns intent, lineage, approval, and publishing.
 * OpenShorts (when configured) is a worker. The fixture proves orchestration
 * without merging OpenShorts/Video Factory/HyperFrames source.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { VideoRepurposingJob, VideoRepurposingOutput, VisualAsset } from "@shared/schema";
import { JobFailure, describeError } from "../jobs/failures";
import type { ContentStoragePort, JsonRecord } from "./storage";
import {
  createLocalAssetStorage,
  validateMediaOutput,
  type AssetStoragePort,
} from "./visual";
import { fixtureMp4Bytes } from "./visualFixture";

export const VIDEO_REPURPOSE_LIMITS = {
  maxClipsPerSource: 10,
  maxVideosPerBatch: 10,
  maxSourceDurationMs: 30 * 60 * 1000,
  maxOutputDurationMs: 3 * 60 * 1000,
  maxBytes: 80 * 1024 * 1024,
} as const;

export const LOCAL_VIDEO_REPURPOSE_FIXTURE_ID = "local-video-repurpose-fixture";
export const OPENSHORTS_PROVIDER_ID = "openshorts";

export type VideoRepurposeStatus =
  | "requested"
  | "accepted"
  | "queued"
  | "processing"
  | "ready"
  | "partial"
  | "failed"
  | "unknown";

export type VideoRepurposeFailureClass = "transient" | "rate_limited" | "permanent" | "unknown";

export interface VideoRepurposeClip {
  position: number;
  clipId: string;
  bytes: Buffer;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  startMs: number | null;
  endMs: number | null;
  title: string | null;
  caption: string | null;
  aspectRatio: string | null;
  failed?: boolean;
  errorMessage?: string;
}

export interface VideoRepurposeSubmitResult {
  providerJobId: string;
  status: VideoRepurposeStatus;
}

export interface VideoRepurposeStatusResult {
  providerJobId: string;
  status: VideoRepurposeStatus;
  failureClass?: VideoRepurposeFailureClass;
  errorMessage?: string | null;
  clips: VideoRepurposeClip[];
}

export interface VideoRepurposeRequest {
  semanticId: string;
  source: {
    assetId: number;
    storageKey: string;
    mime: string;
    durationMs: number | null;
    bytes: Buffer;
  };
  clipCount: number;
  snapshot: JsonRecord;
}

export interface VideoRepurposingProviderPort {
  readonly providerId: string;
  readonly providerVersion: string;
  health?(): Promise<{ configured: boolean; reachable: boolean; notes?: string[] }>;
  submit(request: VideoRepurposeRequest): Promise<VideoRepurposeSubmitResult>;
  getStatus(providerJobId: string): Promise<VideoRepurposeStatusResult>;
}

const providers = new Map<string, VideoRepurposingProviderPort>();

export function registerVideoRepurposingProvider(provider: VideoRepurposingProviderPort): void {
  providers.set(provider.providerId, provider);
}

export function getVideoRepurposingProvider(providerId: string): VideoRepurposingProviderPort {
  const found = providers.get(providerId);
  if (!found) throw new VideoRepurposeInputError([`unknown video repurposing provider "${providerId}"`]);
  return found;
}

export function listVideoRepurposingProviders(): VideoRepurposingProviderPort[] {
  return Array.from(providers.values());
}

export function resetVideoRepurposingProviders(): void {
  providers.clear();
}

export function uniquifyMp4(base: Buffer, salt: number): Buffer {
  const extra = Buffer.alloc(16);
  extra.writeUInt32BE(16, 0);
  extra.write("free", 4, "ascii");
  extra.writeUInt32BE(salt >>> 0, 8);
  extra.writeUInt32BE(0xcf270027, 12);
  return Buffer.concat([base, extra]);
}

export function createFixtureVideoRepurposeProvider(
  options: {
    providerId?: string;
    failMode?: "none" | "transient" | "permanent" | "partial" | "unknown";
    failAtIndex?: number;
  } = {},
): VideoRepurposingProviderPort & { calls(): number } {
  const providerId = options.providerId ?? LOCAL_VIDEO_REPURPOSE_FIXTURE_ID;
  const jobs = new Map<string, VideoRepurposeStatusResult>();
  let calls = 0;
  const base = fixtureMp4Bytes();

  function clipsFor(request: VideoRepurposeRequest): VideoRepurposeClip[] {
    const out: VideoRepurposeClip[] = [];
    for (let i = 0; i < request.clipCount; i += 1) {
      if (options.failMode === "partial" && (options.failAtIndex ?? 1) === i) {
        out.push({
          position: i,
          clipId: `${request.semanticId}-clip-${i}`,
          bytes: Buffer.alloc(0),
          mime: "video/mp4",
          width: 1080,
          height: 1920,
          durationMs: 1000,
          startMs: null,
          endMs: null,
          title: `Clip ${i + 1}`,
          caption: null,
          aspectRatio: "9:16",
          failed: true,
          errorMessage: "fixture clip failed",
        });
        continue;
      }
      out.push({
        position: i,
        clipId: `${request.semanticId}-clip-${i}`,
        bytes: uniquifyMp4(base, i + 1),
        mime: "video/mp4",
        width: 1080,
        height: 1920,
        durationMs: 1000,
        startMs: null,
        endMs: null,
        title: `Clip ${i + 1}`,
        caption: null,
        aspectRatio: "9:16",
      });
    }
    return out;
  }

  return {
    providerId,
    providerVersion: "video-repurpose-fixture-1",
    calls: () => calls,
    async health() {
      return { configured: true, reachable: true, notes: ["deterministic fixture; not a clip engine"] };
    },
    async submit(request) {
      calls += 1;
      if (options.failMode === "transient") {
        throw JobFailure.transient("fixture video repurpose unavailable");
      }
      if (options.failMode === "permanent") {
        throw JobFailure.permanent("fixture video repurpose rejected the request");
      }
      if (options.failMode === "unknown") {
        jobs.set(request.semanticId, {
          providerJobId: request.semanticId,
          status: "unknown",
          failureClass: "unknown",
          errorMessage: "fixture side effect is ambiguous",
          clips: [],
        });
        return { providerJobId: request.semanticId, status: "unknown" };
      }
      const clipRows = clipsFor(request);
      const failed = clipRows.filter((c) => c.failed).length;
      const status: VideoRepurposeStatus =
        failed === 0 ? "ready" : failed === clipRows.length ? "failed" : "partial";
      jobs.set(request.semanticId, {
        providerJobId: request.semanticId,
        status,
        clips: clipRows,
      });
      return { providerJobId: request.semanticId, status: "accepted" };
    },
    async getStatus(providerJobId) {
      const existing = jobs.get(providerJobId);
      if (!existing) {
        return { providerJobId, status: "unknown", clips: [], failureClass: "unknown" };
      }
      return existing;
    },
  };
}

export function openshortsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENSHORTS_API_URL?.trim());
}

export function createOpenShortsProvider(options: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): VideoRepurposingProviderPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function api(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`);
    return fetchImpl(`${baseUrl}${path}`, { ...init, headers });
  }

  return {
    providerId: OPENSHORTS_PROVIDER_ID,
    providerVersion: "openshorts-1",
    async health() {
      try {
        const res = await api("/health", { method: "GET" });
        return {
          configured: true,
          reachable: res.ok,
          notes: ["OpenShorts is a clipping worker; ContentForge owns publishing"],
        };
      } catch {
        return { configured: true, reachable: false };
      }
    },
    async submit(request) {
      const res = await api("/process_video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identity: request.semanticId,
          clip_count: request.clipCount,
          aspect_ratio: "9:16",
          mime: request.source.mime,
          duration_ms: request.source.durationMs,
        }),
      });
      if (!res.ok) {
        if (res.status === 429) throw JobFailure.rateLimited("openshorts rate limited");
        if (res.status >= 400 && res.status < 500) throw JobFailure.permanent(`openshorts rejected process_video (${res.status})`);
        throw JobFailure.transient(`openshorts process_video ${res.status}`);
      }
      const body = (await res.json()) as { job_id?: string; status?: string };
      const providerJobId = String(body.job_id ?? request.semanticId);
      return { providerJobId, status: mapOpenShortsStatus(body.status) };
    },
    async getStatus(providerJobId) {
      const res = await api(`/get_job_status?job_id=${encodeURIComponent(providerJobId)}`, { method: "GET" });
      if (res.status === 404) {
        return { providerJobId, status: "unknown", clips: [], failureClass: "unknown" };
      }
      if (!res.ok) throw JobFailure.transient(`openshorts status ${res.status}`);
      const body = (await res.json()) as {
        status?: string;
        clips?: Array<Record<string, unknown>>;
        error?: string;
      };
      const status = mapOpenShortsStatus(body.status);
      const clips: VideoRepurposeClip[] = [];
      for (const [index, clip] of Array.from((body.clips ?? []).entries())) {
        const clipId = String(clip.id ?? clip.clip_id ?? `${providerJobId}-${index}`);
        const failed = Boolean(clip.failed) || String(clip.status ?? "") === "failed";
        let bytes = Buffer.alloc(0);
        if (!failed) {
          const downloadPath = typeof clip.download_path === "string" ? clip.download_path : `/clips/${encodeURIComponent(clipId)}`;
          const file = await api(downloadPath, { method: "GET" });
          if (file.ok) bytes = Buffer.from(await file.arrayBuffer());
        }
        clips.push({
          position: index,
          clipId,
          bytes,
          mime: "video/mp4",
          width: typeof clip.width === "number" ? clip.width : 1080,
          height: typeof clip.height === "number" ? clip.height : 1920,
          durationMs: typeof clip.duration_ms === "number" ? clip.duration_ms : null,
          startMs: typeof clip.start_ms === "number" ? clip.start_ms : null,
          endMs: typeof clip.end_ms === "number" ? clip.end_ms : null,
          title: typeof clip.title === "string" ? clip.title : typeof clip.hook === "string" ? clip.hook : null,
          caption: typeof clip.caption === "string" ? clip.caption : null,
          aspectRatio: typeof clip.aspect_ratio === "string" ? clip.aspect_ratio : "9:16",
          failed,
          errorMessage: failed ? String(clip.error ?? "clip failed") : undefined,
        });
      }
      return {
        providerJobId,
        status,
        errorMessage: body.error ?? null,
        clips,
      };
    },
  };
}

function mapOpenShortsStatus(raw: string | undefined): VideoRepurposeStatus {
  const value = String(raw ?? "unknown").toLowerCase();
  if (value === "accepted") return "accepted";
  if (value === "queued") return "queued";
  if (value === "processing" || value === "running") return "processing";
  if (value === "ready" || value === "done" || value === "completed") return "ready";
  if (value === "partial") return "partial";
  if (value === "failed" || value === "error") return "failed";
  return "unknown";
}

export function createConfiguredOpenShortsProvider(
  env: NodeJS.ProcessEnv = process.env,
): VideoRepurposingProviderPort | null {
  const baseUrl = env.OPENSHORTS_API_URL?.trim();
  if (!baseUrl) return null;
  return createOpenShortsProvider({
    baseUrl,
    apiKey: env.OPENSHORTS_API_KEY?.trim() || undefined,
  });
}

export function registerBuiltinVideoRepurposingProviders(env: NodeJS.ProcessEnv = process.env): void {
  if (!providers.has(LOCAL_VIDEO_REPURPOSE_FIXTURE_ID)) {
    registerVideoRepurposingProvider(
      createFixtureVideoRepurposeProvider({
        failMode: (env.VIDEO_REPURPOSE_FAIL_MODE as "none" | "transient" | "permanent" | "partial" | "unknown" | undefined) ?? "none",
      }),
    );
  }
  const openshorts = createConfiguredOpenShortsProvider(env);
  if (openshorts && !providers.has(OPENSHORTS_PROVIDER_ID)) {
    registerVideoRepurposingProvider(openshorts);
  }
}

export class VideoRepurposeInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid video repurposing request: ${issues.join("; ")}`);
    this.name = "VideoRepurposeInputError";
    this.issues = issues;
  }
}

export const createVideoRepurposingSchema = z.object({
  sourceVisualAssetId: z.number().int().positive(),
  clipCount: z.number().int().min(1).max(VIDEO_REPURPOSE_LIMITS.maxClipsPerSource).optional(),
  providerId: z.string().trim().min(1).max(80).optional(),
  regenerate: z.boolean().optional(),
  regenerationNonce: z.string().trim().min(1).max(100).optional(),
});

export type CreateVideoRepurposingInput = z.input<typeof createVideoRepurposingSchema>;

export interface VideoRepurposeStoragePort {
  claimVideoRepurposingJob(row: {
    userId?: number | null;
    sourceVisualAssetId: number;
    idempotencyKey: string;
    providerId: string;
    providerVersion?: string | null;
    clipCount: number;
    requestSnapshot: JsonRecord;
    correlationId: string;
  }): Promise<{ job: VideoRepurposingJob; created: boolean }>;
  getVideoRepurposingJob(id: number): Promise<VideoRepurposingJob | undefined>;
  getVideoRepurposingJobForOwner(id: number, ownerId: number): Promise<VideoRepurposingJob | undefined>;
  markVideoRepurposingJob(
    id: number,
    patch: {
      status: string;
      attempt?: number;
      providerJobId?: string | null;
      providerVersion?: string | null;
      errorClass?: string | null;
      errorMessage?: string | null;
      startedAt?: Date | null;
      finishedAt?: Date | null;
    },
  ): Promise<void>;
  insertVideoRepurposingOutput(row: {
    jobId: number;
    userId?: number | null;
    position: number;
    visualAssetId?: number | null;
    status: string;
    startMs?: number | null;
    endMs?: number | null;
    durationMs?: number | null;
    title?: string | null;
    caption?: string | null;
    aspectRatio?: string | null;
    providerClipId?: string | null;
    errorMessage?: string | null;
    metadata?: JsonRecord;
  }): Promise<VideoRepurposingOutput>;
  listVideoRepurposingOutputs(jobId: number): Promise<VideoRepurposingOutput[]>;
  getVisualAsset(id: number): Promise<VisualAsset | undefined>;
  insertVisualAsset(row: Parameters<ContentStoragePort["insertVisualAsset"]>[0]): Promise<VisualAsset>;
}

export interface VideoRepurposeDeps {
  content: VideoRepurposeStoragePort;
  storage: AssetStoragePort;
}

export function videoRepurposingIdempotencyKey(input: {
  userId: number;
  sourceVisualAssetId: number;
  providerId: string;
  clipCount: number;
  regenerationNonce?: string | null;
}): string {
  const basis = JSON.stringify({
    u: input.userId,
    s: input.sourceVisualAssetId,
    p: input.providerId,
    n: input.clipCount,
    r: input.regenerationNonce ?? null,
  });
  return `vr:${createHash("sha256").update(basis).digest("hex").slice(0, 48)}`;
}

export function semanticRepurposeId(jobId: number): string {
  return `cfvr-${jobId}`;
}

export function selectVideoRepurposingProvider(preferred?: string | null): VideoRepurposingProviderPort {
  const requested = preferred?.trim() || LOCAL_VIDEO_REPURPOSE_FIXTURE_ID;
  if (requested !== LOCAL_VIDEO_REPURPOSE_FIXTURE_ID && requested !== OPENSHORTS_PROVIDER_ID) {
    throw new VideoRepurposeInputError([`unknown video repurposing provider "${requested}"`]);
  }
  if (requested === OPENSHORTS_PROVIDER_ID && !providers.has(OPENSHORTS_PROVIDER_ID)) {
    throw new VideoRepurposeInputError(["openshorts is not configured"]);
  }
  return getVideoRepurposingProvider(requested);
}

export async function createVideoRepurposingJob(
  userId: number,
  input: CreateVideoRepurposingInput,
  deps: VideoRepurposeDeps,
): Promise<{ job: VideoRepurposingJob; created: boolean }> {
  const parsed = createVideoRepurposingSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new VideoRepurposeInputError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const body = parsed.data;
  const source = await deps.content.getVisualAsset(body.sourceVisualAssetId);
  if (!source || (source.userId !== null && source.userId !== userId)) {
    throw new VideoRepurposeInputError(["source video asset not found"]);
  }
  if (source.kind !== "video" || !source.mime.startsWith("video/")) {
    throw new VideoRepurposeInputError(["source must be a VideoAsset"]);
  }
  if (source.status !== "ready") {
    throw new VideoRepurposeInputError([`source visual asset is "${source.status}", not ready`]);
  }
  if (source.durationMs != null && source.durationMs > VIDEO_REPURPOSE_LIMITS.maxSourceDurationMs) {
    throw new VideoRepurposeInputError([`source duration exceeds ${VIDEO_REPURPOSE_LIMITS.maxSourceDurationMs} ms`]);
  }
  if (source.byteSize != null && source.byteSize > VIDEO_REPURPOSE_LIMITS.maxBytes) {
    throw new VideoRepurposeInputError(["source exceeds max video bytes"]);
  }

  const clipCount = body.clipCount ?? 3;
  const provider = selectVideoRepurposingProvider(body.providerId);
  const regenerationNonce = body.regenerate
    ? (body.regenerationNonce ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
    : null;
  const idempotencyKey = videoRepurposingIdempotencyKey({
    userId,
    sourceVisualAssetId: source.id,
    providerId: provider.providerId,
    clipCount,
    regenerationNonce,
  });
  const snapshot: JsonRecord = {
    sourceVisualAssetId: source.id,
    sourceStorageKey: source.storageKey,
    sourceContentHash: source.contentHash,
    clipCount,
    providerId: provider.providerId,
    format: "9:16",
  };
  return deps.content.claimVideoRepurposingJob({
    userId,
    sourceVisualAssetId: source.id,
    idempotencyKey,
    providerId: provider.providerId,
    providerVersion: provider.providerVersion,
    clipCount,
    requestSnapshot: snapshot,
    correlationId: `${idempotencyKey.slice(0, 24)}-${Date.now().toString(36)}`.slice(0, 100),
  });
}

export interface VideoRepurposeRunResult {
  jobId: number;
  status: VideoRepurposeStatus;
  reused: boolean;
  assetIds: number[];
  failureClass?: VideoRepurposeFailureClass;
  failureMessage?: string;
}

function classifyRepurposeError(error: unknown): VideoRepurposeFailureClass {
  if (error instanceof JobFailure) {
    if (error.failureClass === "rate_limited") return "rate_limited";
    if (error.failureClass === "transient") return "transient";
    return "permanent";
  }
  const message = describeError(error);
  return /timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b|429|rate.?limit/i.test(message)
    ? "transient"
    : "permanent";
}

export async function runVideoRepurposing(
  jobId: number,
  deps: VideoRepurposeDeps,
): Promise<VideoRepurposeRunResult> {
  const job = await deps.content.getVideoRepurposingJob(jobId);
  if (!job) throw JobFailure.permanent(`VideoRepurposingJob ${jobId} not found`);
  const existingOutputs = await deps.content.listVideoRepurposingOutputs(job.id);
  const readyExisting = existingOutputs.filter((o) => o.status === "ready" && o.visualAssetId != null);
  if (job.status === "ready" && readyExisting.length >= job.clipCount) {
    return {
      jobId: job.id,
      status: "ready",
      reused: true,
      assetIds: readyExisting.map((o) => o.visualAssetId!) ,
    };
  }

  const provider = getVideoRepurposingProvider(job.providerId);
  const semanticId = job.providerJobId || semanticRepurposeId(job.id);
  await deps.content.markVideoRepurposingJob(job.id, {
    status: "processing",
    startedAt: new Date(),
    attempt: job.attempt,
  });

  const source = await deps.content.getVisualAsset(job.sourceVisualAssetId);
  if (!source) {
    await deps.content.markVideoRepurposingJob(job.id, {
      status: "failed",
      errorClass: "permanent",
      errorMessage: "source VideoAsset missing",
      finishedAt: new Date(),
    });
    return { jobId: job.id, status: "failed", reused: false, assetIds: [], failureClass: "permanent", failureMessage: "source VideoAsset missing" };
  }

  let statusResult: VideoRepurposeStatusResult;
  try {
    if (job.providerJobId) {
      statusResult = await provider.getStatus(job.providerJobId);
      if (statusResult.status === "unknown") {
        const submitted = await provider.submit({
          semanticId,
          source: {
            assetId: source.id,
            storageKey: source.storageKey,
            mime: source.mime,
            durationMs: source.durationMs,
            bytes: await deps.storage.get(source.storageKey),
          },
          clipCount: job.clipCount,
          snapshot: (job.requestSnapshot ?? {}) as JsonRecord,
        });
        await deps.content.markVideoRepurposingJob(job.id, {
          status: submitted.status === "unknown" ? "unknown" : "accepted",
          providerJobId: submitted.providerJobId,
        });
        if (submitted.status === "unknown") {
          return {
            jobId: job.id,
            status: "unknown",
            reused: false,
            assetIds: readyExisting.map((o) => o.visualAssetId!).filter(Boolean),
            failureClass: "unknown",
            failureMessage: "provider side effect is ambiguous; reconcile the same identity",
          };
        }
        statusResult = await provider.getStatus(submitted.providerJobId);
      }
    } else {
      const submitted = await provider.submit({
        semanticId,
        source: {
          assetId: source.id,
          storageKey: source.storageKey,
          mime: source.mime,
          durationMs: source.durationMs,
          bytes: await deps.storage.get(source.storageKey),
        },
        clipCount: job.clipCount,
        snapshot: (job.requestSnapshot ?? {}) as JsonRecord,
      });
      await deps.content.markVideoRepurposingJob(job.id, {
        status: submitted.status === "unknown" ? "unknown" : "accepted",
        providerJobId: submitted.providerJobId,
        providerVersion: provider.providerVersion,
      });
      if (submitted.status === "unknown") {
        return {
          jobId: job.id,
          status: "unknown",
          reused: false,
          assetIds: [],
          failureClass: "unknown",
          failureMessage: "provider side effect is ambiguous; reconcile the same identity",
        };
      }
      statusResult = await provider.getStatus(submitted.providerJobId);
    }
  } catch (error) {
    const failureClass = classifyRepurposeError(error);
    const message = describeError(error);
    const nextStatus: VideoRepurposeStatus = failureClass === "unknown" ? "unknown" : "failed";
    await deps.content.markVideoRepurposingJob(job.id, {
      status: nextStatus,
      errorClass: failureClass,
      errorMessage: message,
      finishedAt: nextStatus === "failed" ? new Date() : null,
    });
    return {
      jobId: job.id,
      status: nextStatus,
      reused: false,
      assetIds: readyExisting.map((o) => o.visualAssetId!).filter(Boolean),
      failureClass,
      failureMessage: message,
    };
  }

  if (statusResult.status === "accepted" || statusResult.status === "queued" || statusResult.status === "processing") {
    await deps.content.markVideoRepurposingJob(job.id, {
      status: statusResult.status,
      providerJobId: statusResult.providerJobId,
    });
    throw JobFailure.transient(`video repurposing job ${job.id} is ${statusResult.status}`);
  }
  if (statusResult.status === "unknown") {
    await deps.content.markVideoRepurposingJob(job.id, {
      status: "unknown",
      providerJobId: statusResult.providerJobId,
      errorClass: "unknown",
      errorMessage: statusResult.errorMessage ?? "provider state unknown",
    });
    return {
      jobId: job.id,
      status: "unknown",
      reused: false,
      assetIds: readyExisting.map((o) => o.visualAssetId!).filter(Boolean),
      failureClass: "unknown",
      failureMessage: statusResult.errorMessage ?? "provider state unknown",
    };
  }

  const occupied = new Set(readyExisting.map((o) => o.position));
  const importedIds: number[] = readyExisting.map((o) => o.visualAssetId!);
  let importedFailures = 0;

  for (const clip of statusResult.clips) {
    if (occupied.has(clip.position)) continue;
    if (clip.failed || !clip.bytes.length) {
      importedFailures += 1;
      await deps.content.insertVideoRepurposingOutput({
        jobId: job.id,
        userId: job.userId,
        position: clip.position,
        status: "failed",
        providerClipId: clip.clipId,
        errorMessage: clip.errorMessage ?? "clip failed",
        title: clip.title,
        caption: clip.caption,
        aspectRatio: clip.aspectRatio,
        startMs: clip.startMs,
        endMs: clip.endMs,
        durationMs: clip.durationMs,
        metadata: { provider: provider.providerId, providerJobId: statusResult.providerJobId },
      });
      continue;
    }
    try {
      validateMediaOutput(
        {
          bytes: clip.bytes,
          mime: clip.mime,
          width: clip.width,
          height: clip.height,
          durationMs: clip.durationMs,
        },
        {
          maxBytes: VIDEO_REPURPOSE_LIMITS.maxBytes,
          maxDurationMs: VIDEO_REPURPOSE_LIMITS.maxOutputDurationMs,
        },
      );
      const stored = await deps.storage.put(clip.bytes, clip.mime);
      const asset = await deps.content.insertVisualAsset({
        userId: job.userId,
        visualGenerationId: null,
        kind: "video",
        storageKey: stored.storageKey,
        mime: clip.mime,
        width: clip.width,
        height: clip.height,
        durationMs: clip.durationMs,
        container: "mp4",
        codec: null,
        frameRate: null,
        byteSize: stored.byteSize,
        contentHash: stored.contentHash,
        altText: clip.title,
        caption: clip.caption,
        role: "clip",
        metadata: {
          sourceVisualAssetId: source.id,
          videoRepurposingJobId: job.id,
          provider: provider.providerId,
          providerJobId: statusResult.providerJobId,
          providerClipId: clip.clipId,
          startMs: clip.startMs,
          endMs: clip.endMs,
          aspectRatio: clip.aspectRatio,
        },
        provenance: "derived",
        position: clip.position,
      });
      await deps.content.insertVideoRepurposingOutput({
        jobId: job.id,
        userId: job.userId,
        position: clip.position,
        visualAssetId: asset.id,
        status: "ready",
        startMs: clip.startMs,
        endMs: clip.endMs,
        durationMs: clip.durationMs,
        title: clip.title,
        caption: clip.caption,
        aspectRatio: clip.aspectRatio,
        providerClipId: clip.clipId,
        metadata: { provider: provider.providerId, providerJobId: statusResult.providerJobId },
      });
      importedIds.push(asset.id);
      occupied.add(clip.position);
    } catch (error) {
      importedFailures += 1;
      await deps.content.insertVideoRepurposingOutput({
        jobId: job.id,
        userId: job.userId,
        position: clip.position,
        status: "failed",
        providerClipId: clip.clipId,
        errorMessage: describeError(error),
        metadata: { provider: provider.providerId, stage: "import" },
      });
    }
  }

  const outputs = await deps.content.listVideoRepurposingOutputs(job.id);
  const ready = outputs.filter((o) => o.status === "ready" && o.visualAssetId != null);
  const failed = outputs.filter((o) => o.status === "failed");
  const assetIds = ready.map((o) => o.visualAssetId!);

  if (ready.length >= job.clipCount) {
    await deps.content.markVideoRepurposingJob(job.id, {
      status: "ready",
      providerJobId: statusResult.providerJobId,
      errorClass: null,
      errorMessage: null,
      finishedAt: new Date(),
    });
    return { jobId: job.id, status: "ready", reused: false, assetIds };
  }
  if (ready.length > 0) {
    await deps.content.markVideoRepurposingJob(job.id, {
      status: "partial",
      providerJobId: statusResult.providerJobId,
      errorClass: "partial",
      errorMessage: `${failed.length} clip(s) failed`,
      finishedAt: new Date(),
    });
    return {
      jobId: job.id,
      status: "partial",
      reused: false,
      assetIds,
      failureClass: "permanent",
      failureMessage: `${failed.length} clip(s) failed`,
    };
  }
  await deps.content.markVideoRepurposingJob(job.id, {
    status: "failed",
    providerJobId: statusResult.providerJobId,
    errorClass: "permanent",
    errorMessage: statusResult.errorMessage ?? "no clips imported",
    finishedAt: new Date(),
  });
  return {
    jobId: job.id,
    status: "failed",
    reused: false,
    assetIds: [],
    failureClass: "permanent",
    failureMessage: statusResult.errorMessage ?? "no clips imported",
  };
}

export function videoRepurposingProviderMatrix(env: NodeJS.ProcessEnv = process.env): Array<{
  provider: string;
  capability: string;
  configured: boolean;
  verified: boolean;
  status: string;
}> {
  return [
    {
      provider: OPENSHORTS_PROVIDER_ID,
      capability: "repurpose_video",
      configured: openshortsConfigured(env),
      verified: false,
      status: providers.has(OPENSHORTS_PROVIDER_ID)
        ? "architecturally-ready"
        : openshortsConfigured(env)
          ? "architecturally-ready"
          : "unconfigured",
    },
    {
      provider: LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
      capability: "repurpose_video",
      configured: providers.has(LOCAL_VIDEO_REPURPOSE_FIXTURE_ID),
      verified: providers.has(LOCAL_VIDEO_REPURPOSE_FIXTURE_ID),
      status: providers.has(LOCAL_VIDEO_REPURPOSE_FIXTURE_ID) ? "implemented" : "not-registered",
    },
  ];
}

export function defaultVideoRepurposeDeps(content: VideoRepurposeStoragePort): VideoRepurposeDeps {
  return { content, storage: createLocalAssetStorage() };
}
