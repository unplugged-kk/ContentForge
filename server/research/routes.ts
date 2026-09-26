/**
 * Research API — the minimum surface for the Phase-B vertical slice.
 *
 * The HTTP layer only persists the ResearchJob and enqueues `research.run`; it
 * never executes research inline. Execution is owned by the queue worker.
 */

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ResearchJob, ResearchEvidence, ResearchSource } from "@shared/schema";
import { getUserId, requireOwnerId } from "../middleware/userContext";
import { hasProvider, listProviders } from "./registry";
import type { ClaimJobInput, ClaimJobResult } from "./storage";
import { RESEARCH_LIMITS, resolveTimeWindow, depthBudget, expandQueries } from "./intelligence";
import { last30daysConfigured } from "./providers/last30days";
import { seoConfigured, unconfiguredSeoHealth } from "./seo";

export interface ResearchApiStorage {
  claimJob(input: ClaimJobInput): Promise<ClaimJobResult>;
  getJob(jobId: number): Promise<ResearchJob | undefined>;
  listJobs(userId: number | null, limit?: number): Promise<ResearchJob[]>;
  listSources(jobId: number): Promise<ResearchSource[]>;
  listEvidence(jobId: number): Promise<ResearchEvidence[]>;
  getAnalysis?(jobId: number): Promise<import("@shared/schema").ResearchAnalysisRow | undefined>;
}

export interface ResearchApiDeps {
  storage: ResearchApiStorage;
  enqueueResearchRun: (job: ResearchJob) => Promise<void>;
}

const windowSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  preset: z.enum(["today", "last_24h", "last_7d", "last_30d", "custom"]).optional(),
  asOf: z.string().datetime().optional(),
});

const budgetSchema = z.object({
  maxCalls: z.number().int().positive().optional(),
  maxFetches: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
});

export const createResearchJobBodySchema = z
  .object({
    kind: z.enum(["directed", "autonomous", "human_input"]).default("directed"),
    query: z.string().trim().min(1).optional(),
    authorStatement: z.string().trim().min(1).optional(),
    providerIds: z.array(z.string().trim().min(1)).min(1).max(RESEARCH_LIMITS.maxProviders).default(["rss"]),
    limit: z.number().int().positive().max(RESEARCH_LIMITS.maxSources).optional(),
    window: windowSchema.optional(),
    windowPreset: z.enum(["today", "last_24h", "last_7d", "last_30d", "custom"]).optional(),
    asOf: z.string().datetime().optional(),
    depth: z.enum(["quick", "standard", "deep"]).optional(),
    seo: z.boolean().optional(),
    budget: budgetSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(300).optional(),
    /**
     * Request-scoped provider config (per provider id), stored durably on the
     * job so execution is reproducible. E.g. `{ web: { urls: ["https://…"] } }`.
     */
    providerConfig: z.record(z.record(z.unknown())).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "human_input" && !value.authorStatement) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["authorStatement"], message: "required for human_input" });
    }
    if (value.kind !== "human_input" && !value.query) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["query"], message: `required for ${value.kind}` });
    }
  });

export type CreateResearchJobBody = z.infer<typeof createResearchJobBodySchema>;

function serializeJob(
  job: ResearchJob,
  counts?: { sourceCount: number; evidenceCount: number },
) {
  return {
    id: job.id,
    correlationId: job.correlationId,
    kind: job.kind,
    query: job.query,
    providerIds: job.providerIds ?? [],
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errorClass: job.errorClass,
    errorMessage: job.errorMessage,
    ...(counts ?? {}),
  };
}

function parseId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: "Invalid research job id" });
    return null;
  }
  return id;
}

export function createResearchRouter(deps: ResearchApiDeps): Router {
  const router = Router();

  router.post("/jobs", async (req, res) => {
    const parsed = createResearchJobBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join(", "),
      });
    }

    const body = parsed.data;
    const unknownProviders = body.providerIds.filter((providerId) => !hasProvider(providerId));
    if (unknownProviders.length > 0) {
      return res.status(400).json({
        message: `Unknown provider(s): ${unknownProviders.join(", ")}`,
      });
    }

    const userId = requireOwnerId(req);
    const correlationId = randomUUID();
    const idempotencyKey = body.idempotencyKey ?? `research:${body.kind}:${randomUUID()}`;
    const window = resolveTimeWindow({
      window: body.window,
      preset: body.windowPreset ?? body.window?.preset,
      asOf: body.asOf ?? body.window?.asOf,
    });
    const depth = body.depth ?? "standard";
    const expansion = body.query ? expandQueries(body.query, depthBudget(depth).maxExpandedQueries) : null;
    const limit = Math.min(body.limit ?? depthBudget(depth).maxSources, RESEARCH_LIMITS.maxSources);

    const { job, created } = await deps.storage.claimJob({
      correlationId,
      idempotencyKey,
      kind: body.kind,
      query: body.query ?? null,
      providerIds: body.providerIds,
      userId,
      initiation: {
        kind: body.kind,
        query: body.query ?? null,
        limit,
        window,
        budget: body.budget ?? null,
        depth,
        seo: body.seo ?? false,
        expansion,
        authorStatement: body.authorStatement ?? null,
        providerConfig: body.providerConfig ?? null,
      },
    });

    // Preserve automatic enqueue-on-create: the worker — not this handler —
    // runs research. A completed job needs no re-enqueue.
    if (job.status !== "complete") {
      try {
        await deps.enqueueResearchRun(job);
      } catch (error) {
        return res.status(503).json({
          message: "Research queue unavailable",
          id: job.id,
          correlationId: job.correlationId,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return res.status(created ? 201 : 200).json(serializeJob(job));
  });

  router.get("/jobs/:id", async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;

    const job = await loadOwnedJob(req, res, deps, id);
    if (!job) return;

    const [sources, evidence] = await Promise.all([
      deps.storage.listSources(id),
      deps.storage.listEvidence(id),
    ]);
    const analysis = deps.storage.getAnalysis ? await deps.storage.getAnalysis(id) : undefined;
    const snapshot = analysis?.snapshot && typeof analysis.snapshot === "object"
      ? (analysis.snapshot as Record<string, unknown>)
      : null;
    return res.json({
      ...serializeJob(job, { sourceCount: sources.length, evidenceCount: evidence.length }),
      quality: snapshot && typeof snapshot.quality === "string" ? snapshot.quality : null,
      summary: snapshot && typeof snapshot.summary === "object" ? snapshot.summary : null,
      window: (job.initiation as Record<string, unknown> | null)?.window ?? null,
    });
  });

  /** Recent research jobs for the caller (their own, plus legacy unowned rows). */
  router.get("/jobs", async (req, res) => {
    const requested = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 50;
    const userId = requireOwnerId(req);
    const jobs = await deps.storage.listJobs(userId, limit);
    return res.json(jobs.map((job) => serializeJob(job)));
  });

  /**
   * Provider capability/access surface: what can be attempted, with which
   * capabilities, and at which access class. No credentials are exposed.
   */
  router.get("/providers", (_req, res) => {
    const providers = listProviders().map((provider) => ({
      id: provider.id,
      version: provider.version,
      contractVersion: provider.contractVersion,
      accessClass: provider.accessClass,
      description: provider.description ?? null,
      backends: provider.backends.map((backend) => ({
        id: backend.id,
        capabilities: backend.capabilities,
        sourceCapabilities: backend.sourceCapabilities ?? [],
      })),
      capabilities: Array.from(
        new Set(provider.backends.flatMap((backend) => backend.capabilities)),
      ).sort(),
    }));
    return res.json({ providers });
  });

  router.get("/capabilities", async (_req, res) => {
    const providers = listProviders().map((provider) => ({
      providerId: provider.id,
      capabilities: Array.from(new Set(provider.backends.flatMap((backend) => backend.capabilities))).sort(),
      accessClass: provider.accessClass,
      configured: true,
      available: provider.accessClass !== "local-agent-only",
      reason: provider.description ?? null,
    }));
    const seo = unconfiguredSeoHealth();
    if (seoConfigured()) {
      seo.configured = true;
      seo.reason = "OPENSEO configured (live availability requires /health)";
    }
    return res.json({
      limits: RESEARCH_LIMITS,
      last30days: {
        providerId: "last30days",
        configured: last30daysConfigured(),
        available: false,
        accessClass: "open",
        reason: last30daysConfigured()
          ? "configured; availability comes from last30days doctor JSON at probe time, not env presence"
          : "not enabled (set LAST30DAYS_ENABLED=1 or LAST30DAYS_SCRIPT)",
      },
      openseo: seo,
      agentReach: {
        providerId: "agent-reach",
        configured: false,
        available: false,
        accessClass: "local-agent-only",
        reason: "design reference for doctor/fallback; not dispatched by hosted ResearchEngine",
      },
      providers,
    });
  });

  router.get("/jobs/:id/sources", async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;

    const job = await loadOwnedJob(req, res, deps, id);
    if (!job) return;
    return res.json(await deps.storage.listSources(id));
  });

  router.get("/jobs/:id/evidence", async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;

    const job = await loadOwnedJob(req, res, deps, id);
    if (!job) return;
    return res.json(await deps.storage.listEvidence(id));
  });

  router.get("/jobs/:id/analysis", async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const job = await loadOwnedJob(req, res, deps, id);
    if (!job) return;
    const analysis = deps.storage.getAnalysis ? await deps.storage.getAnalysis(id) : undefined;
    if (!analysis) return res.status(404).json({ message: "Research analysis not found" });
    return res.json({
      jobId: id,
      analysisVersion: analysis.analysisVersion,
      snapshot: analysis.snapshot,
      createdAt: analysis.createdAt,
    });
  });

  return router;
}

/**
 * Load a job only if it is visible to the caller. A job owned by someone else is
 * reported as 404 (never 403), so the endpoint does not leak existence.
 */
async function loadOwnedJob(
  req: Request,
  res: Response,
  deps: ResearchApiDeps,
  id: number,
): Promise<ResearchJob | undefined> {
  const job = await deps.storage.getJob(id);
  if (!job) {
    res.status(404).json({ message: "Research job not found" });
    return undefined;
  }
  // Same default-user convention as job creation (single-operator today), so
  // anonymous/legacy access keeps working while distinct users stay isolated.
  const userId = requireOwnerId(req);
  if (job.userId !== null && job.userId !== userId) {
    res.status(404).json({ message: "Research job not found" });
    return undefined;
  }
  return job;
}

/** Router wired to the application's engine, storage, and queue. */
export async function createDefaultResearchRouter(): Promise<Router> {
  const [{ researchStorage }, { getJobRuntime }, { RESEARCH_RUN_JOB_TYPE }] = await Promise.all([
    import("./service"),
    import("../jobs/bootstrap"),
    import("./job"),
  ]);

  return createResearchRouter({
    storage: researchStorage,
    enqueueResearchRun: async (job) => {
      await getJobRuntime().enqueue({
        jobType: RESEARCH_RUN_JOB_TYPE,
        payload: { jobId: job.id },
        correlationId: job.correlationId,
        idempotencyKey: job.idempotencyKey,
      });
    },
  });
}
