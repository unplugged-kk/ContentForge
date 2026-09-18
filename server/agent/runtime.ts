import { randomUUID } from "node:crypto";
import type { AgentRun, AgentToolCall } from "@shared/schema";
import type { AgentBackendPort, AgentToolRequest, ToolEnvelope, ToolExecutionContext } from "./types";
import { AgentToolRegistry, unknownToolEnvelope } from "./registry";
import { authorizeTool, parseGrants } from "./policy";
import { DatabaseAgentStorage } from "./storage";
import { hashInput, stripOverrideKeys, toolIdempotencyKey } from "./sanitize";
import { emitAgentLog } from "./events";
import { envelope } from "./envelope";

const MAX_STEPS = 16;

export interface AgentRuntimeOptions {
  storage: DatabaseAgentStorage;
  registry: AgentToolRegistry;
  backend: AgentBackendPort;
}

export class AgentRuntime {
  constructor(private readonly options: AgentRuntimeOptions) {}

  private async waitForToolCall(id: number): Promise<AgentToolCall> {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const calls = await this.options.storage.listToolCallsById(id);
      const current = calls[0];
      if (current && (current.status === "completed" || current.status === "denied" || current.status === "failed")) {
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const latest = (await this.options.storage.listToolCallsById(id))[0];
    if (!latest) throw new Error("Agent tool call disappeared");
    return latest;
  }

  async executeTool(
    run: AgentRun,
    request: AgentToolRequest,
    grants: ReadonlySet<string>,
  ): Promise<{ call: AgentToolCall; envelope: ToolEnvelope; reused: boolean }> {
    const definition = this.options.registry.get(request.name);
    const cleaned = stripOverrideKeys(request.arguments);
    const inputHash = hashInput({ tool: request.name, arguments: cleaned });
    const idempotencyKey =
      request.idempotencyKey?.trim() || toolIdempotencyKey(run.id, request.name, inputHash);

    const { call, created } = await this.options.storage.claimToolCall({
      userId: run.userId,
      agentRunId: run.id,
      toolName: request.name,
      idempotencyKey,
      inputHash,
      input: cleaned,
    });

    if (!created) {
      const settled = await this.waitForToolCall(call.id);
      return {
        call: settled,
        envelope: ((settled.result as unknown) as ToolEnvelope) ?? envelope({
          tool: request.name,
          status: settled.status === "denied" ? "denied" : "success",
          summary: "reused durable tool result",
          refs: (settled.resourceRefs as Record<string, unknown>) ?? {},
        }),
        reused: true,
      };
    }

    const ctx: ToolExecutionContext = {
      ownerId: run.userId,
      agentRunId: run.id,
      toolCallId: call.id,
      idempotencyKey,
      grants,
    };

    await this.options.storage.markToolRunning(call.id);
    emitAgentLog("agent.tool.started", {
      agentRunId: run.id,
      toolCallId: call.id,
      tool: request.name,
      ownerId: run.userId,
    });

    let result: ToolEnvelope;
    if (!definition) {
      result = unknownToolEnvelope(request.name);
    } else {
      const blocked = authorizeTool(definition, ctx);
      if (blocked) {
        result = blocked;
      } else {
        const parsed = definition.inputSchema.safeParse(cleaned);
        if (!parsed.success) {
          result = envelope({
            tool: definition.name,
            status: "invalid",
            summary: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
            failureClass: "permanent",
            error: "invalid tool arguments",
          });
        } else {
          try {
            result = await definition.execute(parsed.data as Record<string, unknown>, ctx);
          } catch (error) {
            result = envelope({
              tool: definition.name,
              status: "failed",
              summary: error instanceof Error ? error.message : String(error),
              failureClass: "transient",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    const terminal =
      result.status === "denied"
        ? "denied"
        : result.status === "failed" || result.status === "invalid" || result.status === "not_found"
          ? "failed"
          : "completed";
    const saved = await this.options.storage.completeToolCall(
      call.id,
      terminal,
      result as unknown as Record<string, unknown>,
      result.refs,
      result.failureClass ?? null,
      result.error ?? null,
    );
    emitAgentLog(terminal === "completed" ? "agent.tool.completed" : "agent.tool.failed", {
      agentRunId: run.id,
      toolCallId: call.id,
      tool: request.name,
      status: result.status,
      failureClass: result.failureClass,
    });
    return { call: saved ?? call, envelope: result, reused: false };
  }

  async advance(runId: number, ownerId: number): Promise<AgentRun> {
    const run = await this.options.storage.getRunForOwner(runId, ownerId);
    if (!run) throw new Error("Agent run not found");
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return run;
    }
    if (run.cancellationRequested) {
      return (await this.options.storage.markRunStatus(run.id, "cancelled", { finishedAt: new Date() })) ?? run;
    }

    const grants = parseGrants((run.providerSnapshot as { grants?: unknown }).grants);
    await this.options.storage.markRunRunning(run.id, run.attempt);
    emitAgentLog("agent.run.started", {
      agentRunId: run.id,
      backendId: run.backendId,
      ownerId: run.userId,
    });

    let step = run.currentStep;
    while (step < MAX_STEPS) {
      const latest = await this.options.storage.getRun(run.id);
      if (!latest) break;
      if (latest.cancellationRequested) {
        return (await this.options.storage.markRunStatus(run.id, "cancelled", { finishedAt: new Date() })) ?? latest;
      }
      const history = await this.options.storage.listToolCalls(run.id);
      const backendResult = await this.options.backend.run({
        ownerId: run.userId,
        objective: run.objective,
        agentRunId: run.id,
        correlationId: run.correlationId,
        tools: this.options.registry.list().map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: { type: "object" },
        })),
        history: history.map((call) => ({
          toolName: call.toolName,
          status: call.status,
          summary: typeof (call.result as { summary?: string }).summary === "string"
            ? (call.result as { summary: string }).summary
            : undefined,
          refs: (call.resourceRefs as Record<string, unknown>) ?? {},
        })),
        providerSnapshot: run.providerSnapshot as Record<string, unknown>,
      });

      if (backendResult.status === "completed") {
        const finished = await this.options.storage.markRunStatus(run.id, "completed", {
          currentStep: step,
          finishedAt: new Date(),
        });
        emitAgentLog("agent.run.completed", { agentRunId: run.id, steps: step });
        return finished ?? latest;
      }
      if (backendResult.status === "failed") {
        const failed = await this.options.storage.markRunStatus(run.id, "failed", {
          currentStep: step,
          errorClass: backendResult.failureClass ?? "permanent",
          errorMessage: backendResult.message ?? "backend failed",
          finishedAt: new Date(),
        });
        emitAgentLog("agent.run.failed", {
          agentRunId: run.id,
          failureClass: backendResult.failureClass,
        });
        return failed ?? latest;
      }

      const requests = backendResult.toolRequests ?? [];
      if (requests.length === 0) {
        const finished = await this.options.storage.markRunStatus(run.id, "completed", {
          currentStep: step,
          finishedAt: new Date(),
        });
        return finished ?? latest;
      }

      for (const request of requests) {
        await this.executeTool(latest, request, grants);
        step += 1;
        await this.options.storage.bumpStep(run.id, step);
        if (step >= MAX_STEPS) break;
      }
    }

    return (
      (await this.options.storage.markRunStatus(run.id, "failed", {
        currentStep: step,
        errorClass: "permanent",
        errorMessage: `exceeded ${MAX_STEPS} tool steps`,
        finishedAt: new Date(),
      })) ?? run
    );
  }

  async createAndRun(input: {
    ownerId: number;
    objective: string;
    backendId: string;
    providerSnapshot: Record<string, unknown>;
    idempotencyKey?: string;
    execute?: boolean;
  }): Promise<{ run: AgentRun; created: boolean }> {
    const idempotencyKey = input.idempotencyKey?.trim() || `agent-run:${input.ownerId}:${randomUUID()}`;
    const { run, created } = await this.options.storage.claimRun({
      userId: input.ownerId,
      backendId: input.backendId,
      providerSnapshot: input.providerSnapshot,
      objective: input.objective,
      idempotencyKey,
      correlationId: randomUUID(),
    });
    if (input.execute === false) return { run, created };
    const advanced = await this.advance(run.id, input.ownerId);
    return { run: advanced, created };
  }
}

export { MAX_STEPS };
