/**
 * Video Factory VisualProviderPort adapter (Phase 21).
 *
 * Registers as provider id `video-factory` on the existing visual registry.
 * Does not introduce a second media/queue/AI abstraction. TTS, HyperFrames
 * rendering, and the factory dashboard stay in Video Factory.
 *
 * `generate()` is reconcile-first:
 *   1. derive durable job id from VisualGeneration id (never a fresh id on retry)
 *   2. observe transport status
 *   3. submit only when unknown (same job id — filesystem drop is idempotent)
 *   4. in-progress / unknown → JobFailure.transient (same generation)
 *   5. failed → JobFailure.permanent
 *   6. done → read bytes, never persist the factory path; caller stores via AssetStoragePort
 */

import { JobFailure } from "../jobs/failures";
import {
  buildVideoFactoryJobRequest,
  classifyVideoFactoryState,
  VIDEO_FACTORY_CONTRACT_VERSION,
  VIDEO_FACTORY_PROVIDER_ID,
  videoFactoryJobId,
  type VideoFactoryJobRequest,
} from "./videoFactoryContract";
import {
  createFilesystemVideoFactoryTransport,
  videoFactoryRootFromEnv,
  type VideoFactoryTransport,
} from "./videoFactoryTransport";
import type { VisualGenerationOutput, VisualGenerationRequest, VisualProviderHealth, VisualProviderPort } from "./visual";
import { InvalidVisualInputError } from "./visual";

const POLL_MS = 200;
const POLL_BUDGET_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface VideoFactoryProviderOptions {
  transport: VideoFactoryTransport;
  providerId?: string;
  pollBudgetMs?: number;
  dashboardUrl?: string | null;
  fetchImpl?: typeof fetch;
}

function snapshotRecord(snapshot: VisualGenerationRequest["snapshot"]): Record<string, unknown> {
  return snapshot && typeof snapshot === "object" ? (snapshot as Record<string, unknown>) : {};
}

function buildRequest(request: VisualGenerationRequest): VideoFactoryJobRequest {
  if (request.capability === "refine_video") {
    throw JobFailure.permanent("Video Factory does not support refine_video; create a new VideoGeneration to regenerate");
  }
  if (request.capability !== "generate_video" || request.kind !== "video") {
    throw JobFailure.permanent(`Video Factory provider does not handle "${request.capability}"`);
  }
  if (!request.generationId) {
    throw JobFailure.permanent("Video Factory requires a durable VisualGeneration id");
  }
  try {
    return buildVideoFactoryJobRequest({
      generationId: request.generationId,
      snapshot: snapshotRecord(request.snapshot),
    });
  } catch (error) {
    if (error instanceof InvalidVisualInputError) {
      throw JobFailure.permanent(error.message);
    }
    throw error;
  }
}

async function importDone(
  transport: VideoFactoryTransport,
  job: VideoFactoryJobRequest,
): Promise<VisualGenerationOutput> {
  const output = await transport.getOutput(job.jobId);
  if (!output) {
    throw JobFailure.permanent("Video Factory reported done but output is missing or unreadable");
  }
  if (output.jobId !== job.jobId) {
    throw JobFailure.permanent("Video Factory output identity does not match the ContentForge generation");
  }
  return {
    bytes: output.bytes,
    mime: output.mime,
    width: output.width,
    height: output.height,
    durationMs: output.durationMs,
    container: output.container,
    codec: null,
    frameRate: null,
    altText: job.title,
    provider: VIDEO_FACTORY_PROVIDER_ID,
    providerVersion: VIDEO_FACTORY_CONTRACT_VERSION,
    model: null,
    cost: null,
    usage: {
      contractVersion: VIDEO_FACTORY_CONTRACT_VERSION,
      externalJobId: job.jobId,
      outputIdentity: output.outputIdentity,
      externalState: "done",
    },
  };
}

export function createVideoFactoryProvider(options: VideoFactoryProviderOptions): VisualProviderPort {
  const transport = options.transport;
  const providerId = options.providerId ?? VIDEO_FACTORY_PROVIDER_ID;
  const pollBudgetMs = options.pollBudgetMs ?? POLL_BUDGET_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const dashboardUrl = options.dashboardUrl?.trim() || null;

  return {
    providerId,
    providerVersion: VIDEO_FACTORY_CONTRACT_VERSION,
    capabilities: ["generate_video"],
    modalities: ["video"],
    synchronous: false,
    async health(): Promise<VisualProviderHealth> {
      const reachable = transport.configured ? await transport.reachable() : false;
      let runnerUp = false;
      if (reachable && dashboardUrl) {
        try {
          const res = await fetchImpl(dashboardUrl, { method: "GET" });
          runnerUp = res.ok;
        } catch {
          runnerUp = false;
        }
      }
      const processingReady = Boolean(transport.configured && reachable && runnerUp);
      let reason: string | null = null;
      if (!transport.configured) reason = "VIDEO_FACTORY_ROOT is not configured";
      else if (!reachable) reason = "filesystem bridge unreachable";
      else if (!runnerUp) reason = "Video Factory runner is not listening";
      return {
        providerId,
        registered: true,
        capabilities: ["generate_video"],
        modalities: ["video"],
        synchronous: false,
        transportConfigured: transport.configured,
        reachable,
        processingReady,
        reason,
        notes: [
          "Video Factory remains a separate system",
          "Adapter writes a provider-native composition entrypoint; HyperFrames stays in the factory",
          "manifest.json is observational, not generation truth",
          "reachable means the filesystem bridge, not a live HyperFrames render",
          "processingReady requires the factory runner HTTP dashboard",
          transport.kind === "http"
            ? "HTTP transport is not implemented by the current factory"
            : `transport=${transport.kind}`,
        ],
      };
    },
    async generate(request) {
      if (!transport.configured) {
        throw JobFailure.transient("Video Factory transport is not configured");
      }
      const reachable = await transport.reachable();
      if (!reachable) {
        throw JobFailure.transient("Video Factory is unreachable");
      }

      const job = buildRequest(request);
      const expectedId = videoFactoryJobId(request.generationId!);
      if (job.jobId !== expectedId) {
        throw JobFailure.permanent("Video Factory job identity drifted from VisualGeneration id");
      }

      let status = await transport.getStatus(job.jobId);
      const progress = classifyVideoFactoryState(status.state);

      if (progress === "unknown") {
        try {
          await transport.submit(job);
        } catch (error) {
          if (error instanceof InvalidVisualInputError) {
            throw JobFailure.permanent(error.message);
          }
          throw JobFailure.transient(`Video Factory submit failed: ${error instanceof Error ? error.message : "unknown"}`);
        }
        status = await transport.getStatus(job.jobId);
      }

      const deadline = Date.now() + pollBudgetMs;
      for (;;) {
        status = await transport.getStatus(job.jobId);
        const classified = classifyVideoFactoryState(status.state);
        if (classified === "completed") return importDone(transport, job);
        if (classified === "permanent") {
          throw JobFailure.permanent(status.error || `Video Factory job ${job.jobId} failed`);
        }
        if (classified === "unknown") {
          throw JobFailure.transient(`Video Factory job ${job.jobId} state is unknown; reconciling the same identity`);
        }
        if (Date.now() >= deadline) break;
        await sleep(POLL_MS);
      }

      const last = classifyVideoFactoryState(status.state);
      if (last === "completed") return importDone(transport, job);
      if (last === "permanent") {
        throw JobFailure.permanent(status.error || `Video Factory job ${job.jobId} failed`);
      }
      if (last === "unknown") {
        throw JobFailure.transient(`Video Factory job ${job.jobId} state is unknown; reconciling the same identity`);
      }
      throw JobFailure.transient(`Video Factory job ${job.jobId} is ${status.state}`);
    },
  };
}

export function createConfiguredVideoFactoryProvider(
  env: NodeJS.ProcessEnv = process.env,
): VisualProviderPort {
  const root = videoFactoryRootFromEnv(env);
  if (!root) {
    return createVideoFactoryProvider({
      transport: {
        kind: "filesystem",
        configured: false,
        async reachable() {
          return false;
        },
        async submit() {
          throw JobFailure.transient("VIDEO_FACTORY_ROOT is not configured");
        },
        async getStatus(jobId) {
          return {
            contractVersion: VIDEO_FACTORY_CONTRACT_VERSION,
            jobId,
            state: "unknown",
            observational: true,
            error: "VIDEO_FACTORY_ROOT is not configured",
          };
        },
        async getOutput() {
          return null;
        },
      },
    });
  }
  return createVideoFactoryProvider({
    transport: createFilesystemVideoFactoryTransport(root),
    dashboardUrl: env.VIDEO_FACTORY_DASHBOARD_URL?.trim() || "http://127.0.0.1:4300/manifest.json",
  });
}
