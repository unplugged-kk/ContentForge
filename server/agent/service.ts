import { db } from "../db";
import { researchStorage } from "../research/service";
import { RESEARCH_RUN_JOB_TYPE } from "../research/job";
import { storyStorage } from "../story/service";
import {
  contentStorage,
  generationDeps,
  visualAssetStorage,
  styleServiceDeps,
  GENERATION_RUN_JOB_TYPE,
  PUBLICATION_RUN_JOB_TYPE,
  VISUAL_RUN_JOB_TYPE,
  VIDEO_REPURPOSE_JOB_TYPE,
  STYLE_ANALYZE_JOB_TYPE,
  registerContentJobs,
} from "../content/service";
import { AgentToolRegistry } from "./registry";
import { DatabaseAgentStorage } from "./storage";
import { createContentForgeTools } from "./tools";
import { createTimeplusProvider, createTimeplusSemanticTools } from "./timeplus";
import { createAgentBackend } from "./backends";
import { AgentRuntime } from "./runtime";
import type { AgentBackendPort } from "./types";
import type { GenerationJob } from "@shared/schema";
import type { VisualGeneration } from "@shared/schema";
import type { Publication } from "@shared/schema";

export const agentStorage = new DatabaseAgentStorage(db);

export const agentRegistry = new AgentToolRegistry();

let backend: AgentBackendPort | null = null;
let runtime: AgentRuntime | null = null;
let toolsRegistered = false;

function researchPort() {
  return {
    claimJob: (input: Parameters<typeof researchStorage.claimJob>[0]) => researchStorage.claimJob(input),
    getJob: (jobId: number) => researchStorage.getJob(jobId),
    listSources: (jobId: number) => researchStorage.listSources(jobId),
    listEvidence: (jobId: number) => researchStorage.listEvidence(jobId),
    getAnalysis: (jobId: number) => researchStorage.getAnalysis(jobId),
    enqueueResearchRun: async (job: { id: number; correlationId: string; idempotencyKey: string }) => {
      const { getJobRuntime } = await import("../jobs/bootstrap");
      await getJobRuntime().enqueue({
        jobType: RESEARCH_RUN_JOB_TYPE,
        payload: { jobId: job.id },
        correlationId: job.correlationId,
        idempotencyKey: job.idempotencyKey,
      });
    },
  };
}

async function enqueueGeneration(job: GenerationJob): Promise<boolean> {
  const { getJobRuntime } = await import("../jobs/bootstrap");
  const result = await getJobRuntime().enqueue({
    jobType: GENERATION_RUN_JOB_TYPE,
    payload: { generationJobId: job.id },
    correlationId: job.correlationId,
    idempotencyKey: job.idempotencyKey,
  });
  return !result.deduplicated;
}

async function enqueueVisual(generation: VisualGeneration): Promise<boolean> {
  const { getJobRuntime } = await import("../jobs/bootstrap");
  const result = await getJobRuntime().enqueue({
    jobType: VISUAL_RUN_JOB_TYPE,
    payload: { visualGenerationId: generation.id },
    correlationId: generation.correlationId,
    idempotencyKey: generation.idempotencyKey,
  });
  return !result.deduplicated;
}

async function enqueueVideoRepurpose(job: { id: number; correlationId: string; idempotencyKey: string }): Promise<boolean> {
  const { getJobRuntime } = await import("../jobs/bootstrap");
  const result = await getJobRuntime().enqueue({
    jobType: VIDEO_REPURPOSE_JOB_TYPE,
    payload: { videoRepurposingJobId: job.id },
    correlationId: job.correlationId,
    idempotencyKey: job.idempotencyKey,
  });
  return !result.deduplicated;
}

async function enqueuePublication(publication: Publication): Promise<boolean> {
  const { getJobRuntime } = await import("../jobs/bootstrap");
  const result = await getJobRuntime().enqueue({
    jobType: PUBLICATION_RUN_JOB_TYPE,
    payload: { publicationId: publication.id },
    correlationId: publication.correlationId,
    idempotencyKey: publication.idempotencyKey,
  });
  return !result.deduplicated;
}

async function enqueueStyleAnalysis(analysis: { id: number; correlationId: string; idempotencyKey: string }): Promise<boolean> {
  const { getJobRuntime } = await import("../jobs/bootstrap");
  const result = await getJobRuntime().enqueue({
    jobType: STYLE_ANALYZE_JOB_TYPE,
    payload: { styleAnalysisId: analysis.id },
    correlationId: analysis.correlationId,
    idempotencyKey: analysis.idempotencyKey,
  });
  return !result.deduplicated;
}

export function registerAgentTools(): void {
  if (toolsRegistered) return;
  registerContentJobs();
  const storyDeps = {
    stories: storyStorage,
    research: {
      getJob: (jobId: number) => researchStorage.getJob(jobId),
      listEvidenceIds: (jobId: number) => researchStorage.listEvidenceIds(jobId),
    },
  };
  const opportunityDeps = { opportunities: contentStorage, stories: storyStorage };
  for (const tool of createContentForgeTools({
    research: researchPort(),
    stories: storyDeps,
    opportunities: opportunityDeps,
    generation: generationDeps,
    repurpose: { opportunities: opportunityDeps, generation: generationDeps, plans: contentStorage },
    content: contentStorage,
    visualStorage: visualAssetStorage,
    enqueueGeneration,
    enqueueVisual,
    enqueueVideoRepurpose,
    enqueuePublication,
    style: styleServiceDeps,
    enqueueStyleAnalysis,
  })) {
    agentRegistry.register(tool);
  }
  const timeplus = createTimeplusProvider();
  for (const tool of createTimeplusSemanticTools({
    storage: agentStorage,
    provider: timeplus,
    allowAdminSql: process.env.AGENT_ADMIN_TIMEPLUS_SQL === "1",
  })) {
    agentRegistry.register(tool);
  }
  toolsRegistered = true;
}

export function getAgentBackend(): AgentBackendPort {
  if (!backend) backend = createAgentBackend();
  return backend;
}

export function getAgentRuntime(): AgentRuntime {
  registerAgentTools();
  if (!runtime) {
    runtime = new AgentRuntime({
      storage: agentStorage,
      registry: agentRegistry,
      backend: getAgentBackend(),
    });
  }
  return runtime;
}

/** Test-only: replace the backend without changing ContentForge domain code. */
export function setAgentBackendForTests(next: AgentBackendPort): void {
  backend = next;
  runtime = new AgentRuntime({
    storage: agentStorage,
    registry: agentRegistry,
    backend: next,
  });
}
