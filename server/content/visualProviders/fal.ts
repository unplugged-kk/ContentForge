/**
 * fal.ai video adapter — providerId `fal`, modelId separate (e.g. Wan T2V).
 *
 * Uses the queue HTTP API (submit/status/result) without @fal-ai/client so the
 * durable VisualGeneration identity can poll/reconcile the same requestId.
 * Paid generate() is gated by mediaCertification spend guards.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { JobFailure } from "../../jobs/failures";
import {
  assertFalCertificationRequest,
  assertPaidMediaAllowed,
  FAL_CERT_KEY,
  MEDIA_CERT_MAX_FAL_DURATION_MS,
  recordFalCertificationCall,
} from "../mediaCertification";
import {
  looksLikeMp4,
  type VisualGenerationRequest,
  type VisualProviderHealth,
  type VisualProviderPort,
} from "../visual";

export const FAL_PROVIDER_ID = "fal";
/** Lowest practical short Wan 2.2 T2V endpoint for certification. */
export const FAL_DEFAULT_MODEL_ID = "fal-ai/wan/v2.2-a14b/text-to-video";
export const FAL_QUEUE_BASE = "https://queue.fal.run";

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

function falRequestIdPath(generationId: number, env: NodeJS.ProcessEnv): string {
  const root = env.FAL_REQUEST_ID_DIR?.trim()
    || join(process.cwd(), ".scratch", "fal-request-ids");
  return join(root, `cfvg-${generationId}.json`);
}

type PersistedFalRequest = {
  requestId: string;
  statusUrl?: string | null;
  responseUrl?: string | null;
};

/** fal status/result live under the app namespace, not the full model endpoint path. */
export function falQueueAppBase(modelId: string): string {
  const parts = modelId.split("/").filter(Boolean);
  if (parts.length >= 2) return `${FAL_QUEUE_BASE}/${parts[0]}/${parts[1]}`;
  return `${FAL_QUEUE_BASE}/${modelId}`;
}

function loadPersistedFalRequest(generationId: number | undefined, env: NodeJS.ProcessEnv): PersistedFalRequest | null {
  if (!generationId) return null;
  const path = falRequestIdPath(generationId, env);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedFalRequest;
    if (typeof parsed.requestId !== "string" || !parsed.requestId) return null;
    return {
      requestId: parsed.requestId,
      statusUrl: typeof parsed.statusUrl === "string" ? parsed.statusUrl : null,
      responseUrl: typeof parsed.responseUrl === "string" ? parsed.responseUrl : null,
    };
  } catch {
    return null;
  }
}

function persistFalRequest(
  generationId: number | undefined,
  data: PersistedFalRequest,
  env: NodeJS.ProcessEnv,
): void {
  if (!generationId) return;
  const path = falRequestIdPath(generationId, env);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({
    ...data,
    generationId,
    providerId: FAL_PROVIDER_ID,
  }, null, 2)}\n`);
  renameSync(tmp, path);
}

function loadPersistedFalRequestId(generationId: number | undefined, env: NodeJS.ProcessEnv): string | null {
  return loadPersistedFalRequest(generationId, env)?.requestId ?? null;
}

function persistFalRequestId(generationId: number | undefined, requestId: string, env: NodeJS.ProcessEnv): void {
  persistFalRequest(generationId, { requestId }, env);
}

export function falApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.FAL_KEY?.trim() || env.FAL_API_KEY?.trim() || "";
  return key || null;
}

export function falConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(falApiKey(env));
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function mapHttpFailure(status: number, bodyText: string): never {
  const safe = bodyText.slice(0, 200).replace(/Key\s+\S+|api[_-]?key/gi, "[redacted]");
  if (status === 429) throw JobFailure.rateLimited(`fal rate limited: ${safe}`);
  if (status === 401 || status === 403) {
    throw JobFailure.permanent(`fal configuration error (${status})`);
  }
  if (status === 402 || /quota|credit|payment|balance/i.test(safe)) {
    throw JobFailure.permanent(`fal quota: ${safe}`);
  }
  if (status >= 500) throw JobFailure.transient(`fal upstream ${status}`);
  throw JobFailure.permanent(`fal rejected request (${status}): ${safe}`);
}

function resolveVideoUrl(data: JsonRecord): string | null {
  const video = data.video;
  if (typeof video === "string" && /^https?:\/\//i.test(video)) return video;
  if (video && typeof video === "object") {
    const url = (video as JsonRecord).url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

export interface FalProviderOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  pollBudgetMs?: number;
  pollIntervalMs?: number;
  models?: string[];
}

export function createFalProvider(options: FalProviderOptions = {}): VisualProviderPort {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollBudgetMs = options.pollBudgetMs ?? 10 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const models = options.models ?? [
    env.FAL_MODEL_ID?.trim() || FAL_DEFAULT_MODEL_ID,
  ];

  return {
    providerId: FAL_PROVIDER_ID,
    providerVersion: "fal-v1",
    capabilities: ["generate_video"],
    modalities: ["video"],
    models,
    modelCatalog: models.map((id) => ({
      id,
      displayName: id,
      modalities: ["video"] as const,
      capabilities: ["generate_video"] as const,
      limits: {
        minFrames: 17,
        maxFrames: 161,
        maxDurationMs: Math.round((161 / 16) * 1000),
        resolution: "480p",
      },
      defaults: {
        resolution: "480p",
        num_frames: 17,
        frames_per_second: 16,
        aspect_ratio: "16:9",
      },
    })),
    capabilityDeclaration: {
      textToVideo: true,
      imageToVideo: false,
      videoToVideo: false,
      audioGeneration: false,
      aspectRatios: ["16:9", "9:16", "1:1"],
      formats: ["mp4"],
      maxDurationMs: Math.round((161 / 16) * 1000),
      supportsAsync: true,
      supportsWebhook: false,
      supportsPolling: true,
    },
    synchronous: false,
    async health(): Promise<VisualProviderHealth> {
      const configured = falConfigured(env);
      let reachable = false;
      if (configured) {
        try {
          // Lightweight authenticated probe against queue platform root.
          const key = falApiKey(env)!;
          const res = await fetchImpl("https://api.fal.ai/v1/models?limit=1", {
            method: "GET",
            headers: authHeaders(key),
            signal: AbortSignal.timeout(8_000),
          });
          reachable = res.ok || res.status === 401 || res.status === 403 || res.status === 404;
        } catch {
          reachable = false;
        }
      }
      return {
        providerId: FAL_PROVIDER_ID,
        registered: true,
        capabilities: ["generate_video"],
        modalities: ["video"],
        synchronous: false,
        transportConfigured: configured,
        reachable: configured ? reachable : false,
        capable: true,
        processingReady: configured && reachable,
        reason: !configured
          ? "FAL_KEY is not configured"
          : !reachable
            ? "fal API unreachable"
            : null,
      };
    },
    async generate(request: VisualGenerationRequest) {
      assertPaidMediaAllowed(FAL_PROVIDER_ID, env);
      const key = falApiKey(env);
      if (!key) throw JobFailure.permanent("FAL_KEY is not configured");

      const snapshot = asRecord(request.snapshot);
      const intent = asRecord(snapshot.intent);
      const renderIntent = asRecord(snapshot.renderIntent);
      const modelId = request.model
        ?? (typeof intent.modelPreference === "string" ? intent.modelPreference : null)
        ?? models[0]
        ?? FAL_DEFAULT_MODEL_ID;

      const prompt = String(
        intent.prompt
          ?? intent.subject
          ?? renderIntent.brief
          ?? renderIntent.title
          ?? "",
      ).trim();
      if (!prompt) throw JobFailure.permanent("fal prompt/subject is required");

      const numFrames = typeof intent.numFrames === "number"
        ? intent.numFrames
        : typeof intent.num_frames === "number"
          ? intent.num_frames
          : 17;
      const framesPerSecond = typeof intent.framesPerSecond === "number"
        ? intent.framesPerSecond
        : typeof intent.frames_per_second === "number"
          ? intent.frames_per_second
          : 16;
      const resolution = String(intent.resolution ?? "480p");
      const aspectRatio = String(intent.aspectRatio ?? intent.aspect_ratio ?? "16:9");
      const certKey = typeof intent.certificationKey === "string"
        ? intent.certificationKey
        : FAL_CERT_KEY;
      const priorPersisted = loadPersistedFalRequest(request.generationId, env);
      const priorRequestId = typeof intent.externalJobId === "string"
        ? intent.externalJobId
        : typeof snapshot.externalJobId === "string"
          ? snapshot.externalJobId
          : priorPersisted?.requestId ?? null;

      // Certification limits always apply when cert flags are set. Reconcile of
      // an already-submitted request skips the budget consume below.
      if (!priorRequestId) {
        assertFalCertificationRequest({
          resolution,
          numFrames,
          framesPerSecond,
          regenerate: Boolean(intent.regenerate),
          certKey,
        }, env);
      } else {
        assertPaidMediaAllowed(FAL_PROVIDER_ID, env);
      }

      const startedAt = Date.now();
      let requestId = priorRequestId;
      let statusUrl = priorPersisted?.statusUrl
        ?? (requestId ? `${falQueueAppBase(modelId)}/requests/${encodeURIComponent(requestId)}/status` : null);
      let responseUrl = priorPersisted?.responseUrl
        ?? (requestId ? `${falQueueAppBase(modelId)}/requests/${encodeURIComponent(requestId)}` : null);

      if (!requestId) {
        // Consume budget before submit so a lost response cannot be retried as
        // a second paid job. Reconciliation uses the persisted requestId when known.
        recordFalCertificationCall(certKey, env);
        const submitRes = await fetchImpl(`${FAL_QUEUE_BASE}/${modelId}`, {
          method: "POST",
          headers: authHeaders(key),
          body: JSON.stringify({
            prompt,
            num_frames: numFrames,
            frames_per_second: framesPerSecond,
            resolution,
            aspect_ratio: aspectRatio,
            enable_prompt_expansion: false,
            enable_safety_checker: true,
            num_interpolated_frames: 0,
            interpolator_model: "none",
            video_quality: "low",
            video_write_mode: "small",
            acceleration: "regular",
          }),
          signal: AbortSignal.timeout(30_000),
        }).catch((error: unknown) => {
          throw JobFailure.transient(
            `fal submit ambiguous after budget consume: ${error instanceof Error ? error.message : "network"}`,
          );
        });

        const submitText = await submitRes.text();
        if (!submitRes.ok) mapHttpFailure(submitRes.status, submitText);
        let submitJson: JsonRecord = {};
        try {
          submitJson = JSON.parse(submitText) as JsonRecord;
        } catch {
          throw JobFailure.transient("fal submit returned non-JSON after budget consume");
        }
        requestId = typeof submitJson.request_id === "string" ? submitJson.request_id : null;
        if (!requestId) {
          throw JobFailure.transient("fal submit succeeded without request_id; reconcile required");
        }
        statusUrl = typeof submitJson.status_url === "string"
          ? submitJson.status_url
          : `${falQueueAppBase(modelId)}/requests/${encodeURIComponent(requestId)}/status`;
        responseUrl = typeof submitJson.response_url === "string"
          ? submitJson.response_url
          : `${falQueueAppBase(modelId)}/requests/${encodeURIComponent(requestId)}`;
        persistFalRequest(request.generationId, { requestId, statusUrl, responseUrl }, env);
      }

      const deadline = Date.now() + pollBudgetMs;
      for (;;) {
        const statusRes = await fetchImpl(statusUrl!, {
          method: "GET",
          headers: authHeaders(key),
          signal: AbortSignal.timeout(20_000),
        }).catch((error: unknown) => {
          throw JobFailure.transient(
            `fal status unknown for ${requestId}: ${error instanceof Error ? error.message : "network"}`,
          );
        });
        const statusText = await statusRes.text();
        if (statusRes.status === 404) {
          throw JobFailure.transient(`fal request ${requestId} not found yet; reconciling`);
        }
        // Queue status often returns 202 while IN_QUEUE / IN_PROGRESS.
        if (!statusRes.ok && statusRes.status !== 202) {
          mapHttpFailure(statusRes.status, statusText);
        }
        let statusJson: JsonRecord = {};
        try {
          statusJson = JSON.parse(statusText) as JsonRecord;
        } catch {
          throw JobFailure.transient(`fal status non-JSON for ${requestId}`);
        }
        if (typeof statusJson.status_url === "string") statusUrl = statusJson.status_url;
        if (typeof statusJson.response_url === "string") responseUrl = statusJson.response_url;
        persistFalRequest(request.generationId, {
          requestId: requestId!,
          statusUrl,
          responseUrl,
        }, env);
        const status = String(statusJson.status ?? "");
        if (status === "COMPLETED") break;
        if (status === "FAILED" || status === "CANCELLED") {
          throw JobFailure.permanent(`fal request ${requestId} ${status.toLowerCase()}`);
        }
        if (Date.now() >= deadline) {
          throw JobFailure.transient(`fal request ${requestId} still ${status || "pending"}; reconciling`);
        }
        await sleep(pollIntervalMs);
      }

      const resultRes = await fetchImpl(responseUrl!, {
        method: "GET",
        headers: authHeaders(key),
        signal: AbortSignal.timeout(30_000),
      });
      const resultText = await resultRes.text();
      if (!resultRes.ok) mapHttpFailure(resultRes.status, resultText);
      const resultJson = JSON.parse(resultText) as JsonRecord;
      const videoUrl = resolveVideoUrl(resultJson);
      if (!videoUrl) {
        throw JobFailure.permanent(`fal request ${requestId} completed without a video URL`);
      }

      const downloadStarted = Date.now();
      const mediaRes = await fetchImpl(videoUrl, {
        method: "GET",
        signal: AbortSignal.timeout(120_000),
      });
      if (!mediaRes.ok) {
        throw JobFailure.transient(`fal video download failed (${mediaRes.status}) for ${requestId}`);
      }
      const bytes = Buffer.from(await mediaRes.arrayBuffer());
      if (!looksLikeMp4(bytes)) {
        throw JobFailure.permanent(`fal video for ${requestId} is not a valid MP4`);
      }

      const durationMs = Math.round((numFrames / Math.max(1, framesPerSecond)) * 1000);
      const width = resolution === "720p" ? 1280 : resolution === "580p" ? 1024 : 854;
      const height = Math.round(width * (aspectRatio === "9:16" ? 16 / 9 : aspectRatio === "1:1" ? 1 : 9 / 16));

      return {
        bytes,
        mime: "video/mp4",
        width: aspectRatio === "9:16" ? height : width,
        height: aspectRatio === "9:16" ? width : height,
        durationMs,
        container: "mp4",
        codec: "h264",
        frameRate: framesPerSecond,
        altText: prompt.slice(0, 200),
        provider: FAL_PROVIDER_ID,
        providerVersion: "fal-v1",
        model: modelId,
        cost: null,
        usage: {
          externalJobId: requestId,
          requestId,
          processingMs: Date.now() - startedAt,
          downloadMs: Date.now() - downloadStarted,
          resolution,
          numFrames,
          framesPerSecond,
          aspectRatio,
          outputIdentity: `cfvg-fal-${request.generationId ?? requestId}`,
          certificationKey: certKey,
        },
      };
    },
  };
}
