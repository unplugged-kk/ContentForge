import { Router } from "express";
import { z } from "zod";
import { getUserId } from "../middleware/userContext";
import type { AgentRuntime } from "./runtime";
import type { AgentToolRegistry } from "./registry";
import type { DatabaseAgentStorage } from "./storage";
import type { AgentBackendPort } from "./types";
import { reconstructAguiEvents } from "./events";
import { parseGrants } from "./policy";
import { agentBackendConfig } from "./backends";
import { timeplusConfig } from "./timeplus";
import { stripOverrideKeys } from "./sanitize";

export interface AgentRouteDeps {
  runtime: AgentRuntime;
  registry: AgentToolRegistry;
  storage: DatabaseAgentStorage;
  backend: AgentBackendPort;
}

const createRunBody = z.object({
  objective: z.string().trim().min(1).max(8000),
  backendId: z.enum(["fixture", "openai-compatible", "agui-remote"]).optional(),
  plan: z
    .array(
      z.object({
        tool: z.string().trim().min(1).max(80),
        arguments: z.record(z.unknown()).default({}),
      }),
    )
    .max(16)
    .optional(),
  grants: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
  idempotencyKey: z.string().trim().min(1).max(300).optional(),
  execute: z.boolean().optional(),
});

const executeToolBody = z.object({
  tool: z.string().trim().min(1).max(80),
  arguments: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(1).max(300).optional(),
  grants: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
});

function ownerId(req: { userId?: number }): number {
  return getUserId(req as never) ?? 1;
}

export function createAgentRouter(deps: AgentRouteDeps): Router {
  const router = Router();

  router.get("/runtime", (_req, res) => {
    const backend = agentBackendConfig();
    const timeplus = timeplusConfig();
    return res.json({
      available: true,
      backend: {
        id: deps.backend.id,
        capabilities: deps.backend.capabilities,
        configuredId: backend.id,
        model: backend.model,
        hasBaseUrl: Boolean(backend.baseUrl),
        hasAguiUrl: Boolean(backend.aguiUrl),
      },
      timeplus: {
        configured: timeplus.enabled,
        role: "telemetry",
        systemOfRecord: false,
      },
      maxSteps: 16,
    });
  });

  router.get("/tools", (_req, res) => {
    return res.json({ tools: deps.registry.describe() });
  });

  router.post("/runs", async (req, res, next) => {
    const parsed = createRunBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
      });
    }
    try {
      const body = parsed.data;
      const { run, created } = await deps.runtime.createAndRun({
        ownerId: ownerId(req),
        objective: body.objective,
        backendId: body.backendId ?? deps.backend.id,
        providerSnapshot: {
          backendId: body.backendId ?? deps.backend.id,
          ...(body.plan ? { plan: body.plan } : {}),
          ...(body.grants ? { grants: body.grants } : {}),
        },
        idempotencyKey: body.idempotencyKey,
        execute: body.execute !== false,
      });
      return res.status(created ? 201 : 200).json(serializeRun(run));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/runs/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid agent run id" });
    }
    const run = await deps.storage.getRunForOwner(id, ownerId(req));
    if (!run) return res.status(404).json({ message: "Agent run not found" });
    const calls = await deps.storage.listToolCalls(run.id);
    return res.json({
      ...serializeRun(run),
      toolCalls: calls.map(serializeToolCall),
    });
  });

  router.get("/runs/:id/events", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid agent run id" });
    }
    const run = await deps.storage.getRunForOwner(id, ownerId(req));
    if (!run) return res.status(404).json({ message: "Agent run not found" });
    const calls = await deps.storage.listToolCalls(run.id);
    return res.json({ events: reconstructAguiEvents(run, calls) });
  });

  router.post("/runs/:id/resume", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid agent run id" });
    }
    try {
      const existing = await deps.storage.getRunForOwner(id, ownerId(req));
      if (!existing) return res.status(404).json({ message: "Agent run not found" });
      const run = await deps.runtime.advance(existing.id, existing.userId);
      return res.json(serializeRun(run));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/runs/:id/tools", async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid agent run id" });
    }
    const parsed = executeToolBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
      });
    }
    try {
      const run = await deps.storage.getRunForOwner(id, ownerId(req));
      if (!run) return res.status(404).json({ message: "Agent run not found" });
      const grants = parseGrants(parsed.data.grants ?? (run.providerSnapshot as { grants?: unknown }).grants);
      const result = await deps.runtime.executeTool(
        run,
        {
          name: parsed.data.tool,
          arguments: stripOverrideKeys(parsed.data.arguments),
          idempotencyKey: parsed.data.idempotencyKey,
        },
        grants,
      );
      return res.status(result.reused ? 200 : 201).json({
        reused: result.reused,
        toolCall: serializeToolCall(result.call),
        result: result.envelope,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function serializeRun(run: {
  id: number;
  userId: number;
  backendId: string;
  objective: string;
  status: string;
  currentStep: number;
  attempt: number;
  idempotencyKey: string;
  correlationId: string;
  errorClass: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}) {
  return {
    id: run.id,
    backendId: run.backendId,
    objective: run.objective,
    status: run.status,
    currentStep: run.currentStep,
    attempt: run.attempt,
    idempotencyKey: run.idempotencyKey,
    correlationId: run.correlationId,
    errorClass: run.errorClass,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function serializeToolCall(call: {
  id: number;
  agentRunId: number;
  toolName: string;
  status: string;
  idempotencyKey: string;
  inputHash: string;
  result: unknown;
  resourceRefs: unknown;
  errorClass: string | null;
  errorMessage: string | null;
}) {
  return {
    id: call.id,
    agentRunId: call.agentRunId,
    toolName: call.toolName,
    status: call.status,
    idempotencyKey: call.idempotencyKey,
    inputHash: call.inputHash,
    result: call.result,
    resourceRefs: call.resourceRefs,
    errorClass: call.errorClass,
    errorMessage: call.errorMessage,
  };
}

export async function createDefaultAgentRouter(): Promise<Router> {
  const { getAgentRuntime, agentStorage, agentRegistry, getAgentBackend } = await import("./service");
  return createAgentRouter({
    runtime: getAgentRuntime(),
    registry: agentRegistry,
    storage: agentStorage,
    backend: getAgentBackend(),
  });
}
