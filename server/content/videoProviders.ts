/**
 * Video production provider selection (Phase 27).
 *
 * Generation stays on the existing VisualProviderPort. This module only
 * chooses among registered video producers and (optionally) registers
 * HyperFrames Cloud when configured. It does not replace video-factory.contract.v1.
 */

import { JobFailure } from "../jobs/failures";
import {
  getVisualProvider,
  listVisualProviders,
  registerVisualProvider,
  type VisualCapability,
  type VisualGenerationOutput,
  type VisualGenerationRequest,
  type VisualProviderHealth,
  type VisualProviderPort,
} from "./visual";
import { InvalidVisualInputError } from "./visual";

export const HYPERFRAMES_CLOUD_PROVIDER_ID = "hyperframes-cloud";
export const VIDEO_FACTORY_PROVIDER_ID = "video-factory";
export const LOCAL_VIDEO_FIXTURE_ID = "local-video-fixture";

export const PRODUCTION_VIDEO_PROVIDERS = new Set([
  VIDEO_FACTORY_PROVIDER_ID,
  HYPERFRAMES_CLOUD_PROVIDER_ID,
  "fal",
]);

export class VideoProviderUnavailableError extends Error {
  constructor(
    readonly providerId: string,
    readonly reason: string,
  ) {
    super(`Video provider "${providerId}" is unavailable: ${reason}`);
    this.name = "VideoProviderUnavailableError";
  }
}

function isRegistered(providerId: string): boolean {
  return listVisualProviders().some((p) => p.providerId === providerId);
}

/**
 * Deterministic selection. Omitted preference keeps the historical default
 * (`local-video-fixture`) so existing callers stay green. An explicit
 * production preference is never silently downgraded to the fixture.
 */
export function selectVideoProductionProvider(options: {
  preferredProvider?: string | null;
  capability?: VisualCapability;
}): VisualProviderPort {
  const preferred = options.preferredProvider?.trim() || null;
  const providerId = preferred ?? LOCAL_VIDEO_FIXTURE_ID;

  try {
    return getVisualProvider(providerId);
  } catch {
    throw new VideoProviderUnavailableError(providerId, "not registered");
  }
}

export function hyperframesCloudConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.HYPERFRAMES_CLOUD_URL?.trim());
}

export function videoFactoryConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VIDEO_FACTORY_ROOT?.trim());
}

export interface VideoProviderMatrixRow {
  provider: string;
  capability: string;
  configured: boolean;
  verified: boolean;
  status: "implemented" | "architecturally-ready" | "unconfigured" | "not-registered";
}

export function videoProductionProviderMatrix(
  env: NodeJS.ProcessEnv = process.env,
): VideoProviderMatrixRow[] {
  const videoFactoryRegistered = isRegistered(VIDEO_FACTORY_PROVIDER_ID);
  const hyperframesRegistered = isRegistered(HYPERFRAMES_CLOUD_PROVIDER_ID);
  const fixtureRegistered = isRegistered(LOCAL_VIDEO_FIXTURE_ID);
  return [
    {
      provider: VIDEO_FACTORY_PROVIDER_ID,
      capability: "generate_video",
      configured: videoFactoryConfigured(env),
      verified: false,
      status: videoFactoryRegistered
        ? videoFactoryConfigured(env)
          ? "architecturally-ready"
          : "unconfigured"
        : "not-registered",
    },
    {
      provider: HYPERFRAMES_CLOUD_PROVIDER_ID,
      capability: "generate_video",
      configured: hyperframesCloudConfigured(env),
      verified: false,
      status: hyperframesRegistered
        ? "architecturally-ready"
        : hyperframesCloudConfigured(env)
          ? "architecturally-ready"
          : "unconfigured",
    },
    {
      provider: LOCAL_VIDEO_FIXTURE_ID,
      capability: "generate_video",
      configured: fixtureRegistered,
      verified: fixtureRegistered,
      status: fixtureRegistered ? "implemented" : "not-registered",
    },
  ];
}

interface HyperframesCloudOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  backend?: "local" | "cloud" | "lambda" | "cloudrun";
}

/**
 * HyperFrames Cloud adapter. Owns every HyperFrames-specific detail
 * (composition variables, signed URLs, render backends). ContentForge only
 * sees request / status / output bytes. Signed URLs are never stored as
 * asset identity — bytes are imported through AssetStoragePort by the caller.
 */
export function createHyperframesCloudProvider(options: HyperframesCloudOptions): VisualProviderPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const backend = options.backend ?? "cloud";

  async function api(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`);
    return fetchImpl(`${baseUrl}${path}`, { ...init, headers });
  }

  return {
    providerId: HYPERFRAMES_CLOUD_PROVIDER_ID,
    providerVersion: "hyperframes-cloud-1",
    capabilities: ["generate_video"],
    modalities: ["video"],
    synchronous: false,
    async health(): Promise<VisualProviderHealth> {
      let reachable = false;
      try {
        const res = await api("/health", { method: "GET" });
        reachable = res.ok;
      } catch {
        reachable = false;
      }
      return {
        providerId: HYPERFRAMES_CLOUD_PROVIDER_ID,
        registered: true,
        capabilities: ["generate_video"],
        modalities: ["video"],
        synchronous: false,
        transportConfigured: true,
        reachable,
        processingReady: false,
        reason: "HyperFrames Cloud is deferred; local rendering is via Video Factory",
        notes: [
          "HyperFrames Cloud is an additional provider, not a replacement of video-factory.contract.v1",
          `renderBackend=${backend}`,
          "signed URLs are ephemeral; ContentForge imports bytes before declaring a VideoAsset",
          "GET /health 200 is not sufficient to claim processing_ready",
        ],
      };
    },
    async generate(request: VisualGenerationRequest): Promise<VisualGenerationOutput> {
      if (request.capability !== "generate_video" || request.kind !== "video") {
        throw JobFailure.permanent(`hyperframes-cloud does not handle "${request.capability}"`);
      }
      if (!request.generationId) {
        throw JobFailure.permanent("hyperframes-cloud requires a durable VisualGeneration id");
      }
      const snapshot = (request.snapshot && typeof request.snapshot === "object"
        ? (request.snapshot as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const intent = (snapshot.intent && typeof snapshot.intent === "object"
        ? (snapshot.intent as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const renderIntent = (snapshot.renderIntent && typeof snapshot.renderIntent === "object"
        ? (snapshot.renderIntent as Record<string, unknown>)
        : intent) as Record<string, unknown>;

      const identity = `cfvg-${request.generationId}`;
      const statusRes = await api(`/renders/${encodeURIComponent(identity)}`, { method: "GET" });
      let render: Record<string, unknown> | null = null;
      if (statusRes.ok) {
        render = (await statusRes.json()) as Record<string, unknown>;
      } else if (statusRes.status === 404) {
        const submit = await api("/renders", {
          method: "POST",
          body: JSON.stringify({
            identity,
            backend,
            template: typeof intent.template === "string" ? intent.template : undefined,
            variables: safeHyperframesVariables(renderIntent),
          }),
        });
        if (!submit.ok) {
          const text = await submit.text();
          if (submit.status >= 400 && submit.status < 500 && submit.status !== 429) {
            throw JobFailure.permanent(`hyperframes-cloud rejected render: ${text.slice(0, 200)}`);
          }
          throw JobFailure.transient(`hyperframes-cloud submit failed: ${submit.status}`);
        }
        render = (await submit.json()) as Record<string, unknown>;
      } else {
        throw JobFailure.transient(`hyperframes-cloud status ${statusRes.status}`);
      }

      const state = String(render?.status ?? render?.state ?? "unknown").toLowerCase();
      if (state === "unknown" || state === "accepted" || state === "queued" || state === "processing") {
        throw JobFailure.transient(`hyperframes-cloud render ${identity} is ${state}`);
      }
      if (state === "failed" || state === "error") {
        throw JobFailure.permanent(String(render?.error ?? "hyperframes-cloud render failed"));
      }
      if (state !== "ready" && state !== "done" && state !== "completed") {
        throw JobFailure.transient(`hyperframes-cloud render ${identity} is ${state}`);
      }

      const signedUrl = typeof render?.videoUrl === "string" ? render.videoUrl : typeof render?.url === "string" ? render.url : null;
      if (!signedUrl) {
        throw JobFailure.transient(`hyperframes-cloud render ${identity} has no retrievable video URL`);
      }
      const downloaded = await fetchImpl(signedUrl);
      if (!downloaded.ok) {
        throw JobFailure.transient(`hyperframes-cloud download failed: ${downloaded.status}`);
      }
      const bytes = Buffer.from(await downloaded.arrayBuffer());
      if (!bytes.length) {
        throw new InvalidVisualInputError(["hyperframes-cloud returned empty video bytes"]);
      }
      return {
        bytes,
        mime: "video/mp4",
        width: typeof render?.width === "number" ? render.width : null,
        height: typeof render?.height === "number" ? render.height : null,
        durationMs: typeof render?.durationMs === "number" ? render.durationMs : null,
        container: "mp4",
        codec: null,
        frameRate: null,
        altText: typeof renderIntent.title === "string" ? renderIntent.title : "HyperFrames Cloud render",
        provider: HYPERFRAMES_CLOUD_PROVIDER_ID,
        providerVersion: "hyperframes-cloud-1",
        model: null,
        cost: null,
        usage: {
          externalJobId: identity,
          outputIdentity: identity,
          signedUrlEphemeral: true,
        },
      };
    },
  };
}

const SAFE_VARIABLE_KEYS = ["title", "hook", "body", "cta", "brandTheme", "imageUrl", "videoUrl"] as const;

function safeHyperframesVariables(intent: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SAFE_VARIABLE_KEYS) {
    const value = intent[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = value.replace(/[<>]/g, "");
    }
  }
  return out;
}

export function createConfiguredHyperframesCloudProvider(
  env: NodeJS.ProcessEnv = process.env,
): VisualProviderPort | null {
  const baseUrl = env.HYPERFRAMES_CLOUD_URL?.trim();
  if (!baseUrl) return null;
  const backendRaw = env.HYPERFRAMES_CLOUD_BACKEND?.trim();
  const backend =
    backendRaw === "local" || backendRaw === "lambda" || backendRaw === "cloudrun" || backendRaw === "cloud"
      ? backendRaw
      : "cloud";
  return createHyperframesCloudProvider({
    baseUrl,
    apiKey: env.HYPERFRAMES_CLOUD_API_KEY?.trim() || undefined,
    backend,
  });
}

export function registerOptionalHyperframesCloudProvider(env: NodeJS.ProcessEnv = process.env): void {
  if (isRegistered(HYPERFRAMES_CLOUD_PROVIDER_ID)) return;
  const provider = createConfiguredHyperframesCloudProvider(env);
  if (provider) registerVisualProvider(provider);
}
