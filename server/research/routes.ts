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
import { getUserId } from "../middleware/userContext";
import { hasProvider } from "./registry";
import type { ClaimJobInput, ClaimJobResult } from "./storage";

export interface ResearchApiStorage {
  claimJob(input: ClaimJobInput): Promise<ClaimJobResult>;
  getJob(jobId: number): Promise<ResearchJob | undefined>;
  listSources(jobId: number): Promise<ResearchSource[]>;
  listEvidence(jobId: number): Promise<ResearchEvidence[]>;
}

export interface ResearchApiDeps {
  storage: ResearchApiStorage;
  enqueueResearchRun: (job: ResearchJob) => Promise<void>;
}

const windowSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
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
    providerIds: z.array(z.string().trim().min(1)).min(1).default(["rss"]),
    limit: z.number().int().positive().max(100).optional(),
    window: windowSchema.optional(),
    budget: budgetSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(300).optional(),
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

    const userId = getUserId(req) ?? 1;
    const correlationId = randomUUID();
    const idempotencyKey = body.idempotencyKey ?? `research:${body.kind}:${randomUUID()}`;

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
        limit: body.limit ?? null,
        window: body.window ?? null,
        budget: body.budget ?? null,
        authorStatement: body.authorStatement ?? null,
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

    const job = await deps.storage.getJob(id);
    if (!job) return res.status(404).json({ message: "Research job not found" });

    const [sources, evidence] = await Promise.all([
      deps.storage.listSources(id),
      deps.storage.listEvidence(id),
    ]);
    return res.json(
      serializeJob(job, { sourceCount: sources.length, evidenceCount: evidence.length }),
    );
  });

  router.get("/jobs/:id/sources", async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;

    const job = await deps.storage.getJob(id);
    if (!job) return res.status(404).json({ message: "Research job not found" });
    return res.json(await deps.storage.listSources(id));
  });

  router.get("/jobs/:id/evidence", async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;

    const job = await deps.storage.getJob(id);
    if (!job) return res.status(404).json({ message: "Research job not found" });
    return res.json(await deps.storage.listEvidence(id));
  });

  return router;
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
