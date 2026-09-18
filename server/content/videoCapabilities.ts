/**
 * Truthful video capability reporting (Phase 27.1).
 *
 * GET /api/video/capabilities must not collapse "process is up" into
 * operational. Health distinguishes configured / reachable / API route /
 * processing-ready / reason.
 */

import {
  HYPERFRAMES_CLOUD_PROVIDER_ID,
  LOCAL_VIDEO_FIXTURE_ID,
  VIDEO_FACTORY_PROVIDER_ID,
  hyperframesCloudConfigured,
  videoFactoryConfigured,
} from "./videoProviders";
import { getVisualProvider, listVisualProviders, type VisualProviderHealth } from "./visual";
import {
  LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
  OPENSHORTS_PROVIDER_ID,
  getVideoRepurposingProvider,
  listVideoRepurposingProviders,
  openshortsConfigured,
  type VideoRepurposeHealth,
} from "./videoRepurpose";

export interface VideoCapabilityReport {
  provider: string;
  capability: string;
  configured: boolean;
  reachable: boolean;
  llm_ready?: boolean;
  processing_ready: boolean;
  verified: boolean;
  reason: string | null;
  status: string;
}

function statusFrom(report: {
  configured: boolean;
  reachable: boolean;
  processing_ready: boolean;
  registered: boolean;
}): string {
  if (!report.registered && !report.configured) return "unconfigured";
  if (!report.configured) return "unconfigured";
  if (!report.reachable) return "blocked";
  if (!report.processing_ready) return "architecturally-ready";
  return "implemented";
}

async function visualRow(
  providerId: string,
  capability: string,
  configured: boolean,
  fallbackReason: string,
): Promise<VideoCapabilityReport> {
  const registered = listVisualProviders().some((p) => p.providerId === providerId);
  if (!registered) {
    return {
      provider: providerId,
      capability,
      configured,
      reachable: false,
      processing_ready: false,
      verified: false,
      reason: configured ? fallbackReason : `${providerId} is not configured`,
      status: configured ? "architecturally-ready" : "unconfigured",
    };
  }
  let health: VisualProviderHealth;
  try {
    const provider = getVisualProvider(providerId);
    if (!provider.health) {
      throw new Error("no health");
    }
    health = await provider.health();
  } catch {
    health = {
      providerId,
      registered: true,
      capabilities: [capability as never],
      synchronous: false,
      transportConfigured: configured,
      reachable: false,
      processingReady: false,
      reason: fallbackReason,
    };
  }
  const reachable = Boolean(health.reachable);
  const processingReady = Boolean(health.processingReady);
  return {
    provider: providerId,
    capability,
    configured,
    reachable,
    processing_ready: processingReady,
    verified: processingReady && providerId === LOCAL_VIDEO_FIXTURE_ID,
    reason: health.reason ?? (processingReady ? null : fallbackReason),
    status: statusFrom({ configured, reachable, processing_ready: processingReady, registered: true }),
  };
}

async function repurposeRow(
  providerId: string,
  configured: boolean,
  fallbackReason: string,
): Promise<VideoCapabilityReport> {
  const registered = listVideoRepurposingProviders().some((p) => p.providerId === providerId);
  if (!registered || !getVideoRepurposingProvider(providerId).health) {
    return {
      provider: providerId,
      capability: "repurpose_video",
      configured,
      reachable: providerId === LOCAL_VIDEO_REPURPOSE_FIXTURE_ID && registered,
      processing_ready: providerId === LOCAL_VIDEO_REPURPOSE_FIXTURE_ID && registered,
      verified: providerId === LOCAL_VIDEO_REPURPOSE_FIXTURE_ID && registered,
      reason: registered && providerId === LOCAL_VIDEO_REPURPOSE_FIXTURE_ID ? null : configured ? fallbackReason : `${providerId} is not configured`,
      status: providerId === LOCAL_VIDEO_REPURPOSE_FIXTURE_ID && registered
        ? "implemented"
        : configured
          ? "architecturally-ready"
          : "unconfigured",
    };
  }
  let health: VideoRepurposeHealth;
  try {
    health = await getVideoRepurposingProvider(providerId).health!();
  } catch {
    health = { configured, reachable: false, processingReady: false, reason: fallbackReason };
  }
  const reachable = Boolean(health.reachable);
  const processingReady = Boolean(health.processingReady);
  return {
    provider: providerId,
    capability: "repurpose_video",
    configured: health.configured ?? configured,
    reachable,
    llm_ready: Boolean(health.llmReady),
    processing_ready: processingReady,
    verified: processingReady && providerId === LOCAL_VIDEO_REPURPOSE_FIXTURE_ID,
    reason: health.reason ?? (processingReady ? null : fallbackReason),
    status: statusFrom({
      configured: health.configured ?? configured,
      reachable,
      processing_ready: processingReady,
      registered: true,
    }),
  };
}

export async function reportVideoCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  production: VideoCapabilityReport[];
  repurposing: VideoCapabilityReport[];
  notes: string[];
}> {
  const production = await Promise.all([
    visualRow(
      VIDEO_FACTORY_PROVIDER_ID,
      "generate_video",
      videoFactoryConfigured(env),
      "Video Factory runner is not processing-ready",
    ),
    visualRow(
      HYPERFRAMES_CLOUD_PROVIDER_ID,
      "generate_video",
      hyperframesCloudConfigured(env),
      "HyperFrames Cloud is deferred; no subscription and HeyGen v3 is not implemented",
    ),
    visualRow(
      LOCAL_VIDEO_FIXTURE_ID,
      "generate_video",
      true,
      "fixture only",
    ),
  ]);
  if (production[2]) {
    production[2].reachable = listVisualProviders().some((p) => p.providerId === LOCAL_VIDEO_FIXTURE_ID);
    production[2].processing_ready = production[2].reachable;
    production[2].verified = production[2].reachable;
    production[2].reason = production[2].reachable ? "local-video-fixture is not a production renderer" : "fixture not registered";
    production[2].status = production[2].reachable ? "implemented" : "not-registered";
  }

  const repurposing = await Promise.all([
    repurposeRow(
      OPENSHORTS_PROVIDER_ID,
      openshortsConfigured(env),
      "OpenShorts is not processing-ready",
    ),
    repurposeRow(LOCAL_VIDEO_REPURPOSE_FIXTURE_ID, true, "fixture only"),
  ]);

  return {
    production,
    repurposing,
    notes: [
      "ContentForge is the control plane; Video Factory / HyperFrames / OpenShorts are workers",
      "OpenShorts publish_clip / POST /api/social/post is never called",
      "YouTube Shorts and TikTok publishing remain deferred",
      "HyperFrames Cloud is deferred; local rendering is via Video Factory + npx hyperframes render",
      "GET /health 200 is not sufficient to claim processing_ready",
    ],
  };
}
