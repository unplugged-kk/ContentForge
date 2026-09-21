import type { z } from "zod";
import type { AgentRun, AgentToolCall } from "@shared/schema";

export type AgentBackendId = "fixture" | "openai-compatible" | "agui-remote";

export type AgentRunStatus =
  | "requested"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentToolCallStatus =
  | "requested"
  | "running"
  | "queued"
  | "completed"
  | "denied"
  | "failed";

export type ToolAccess = "read" | "write" | "privileged";

export type ToolEnvelopeStatus =
  | "success"
  | "accepted"
  | "queued"
  | "in_progress"
  | "denied"
  | "not_found"
  | "invalid"
  | "conflict"
  | "retryable"
  | "failed"
  | "unknown";

export interface AgentCapabilities {
  streaming: boolean;
  tools: boolean;
  remote: boolean;
}

export interface AgentToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentToolRequest {
  name: string;
  arguments: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface AgentRunInput {
  ownerId: number;
  objective: string;
  agentRunId: number;
  correlationId: string;
  tools: AgentToolSpec[];
  history: AgentToolCallSummary[];
  providerSnapshot: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface AgentToolCallSummary {
  toolName: string;
  status: string;
  summary?: string;
  refs?: Record<string, unknown>;
}

export interface AgentRunResult {
  status: "completed" | "failed" | "waiting";
  message?: string;
  toolRequests?: AgentToolRequest[];
  failureClass?: string;
}

export interface AgentEvent {
  type: string;
  timestamp: string;
  runId: number;
  payload: Record<string, unknown>;
}

export interface AgentBackendPort {
  id: AgentBackendId;
  capabilities: AgentCapabilities;
  run(input: AgentRunInput): Promise<AgentRunResult>;
  stream?(
    input: AgentRunInput,
    onEvent: (event: AgentEvent) => Promise<void>,
  ): Promise<AgentRunResult>;
}

export interface ToolEnvelope {
  status: ToolEnvelopeStatus;
  tool: string;
  summary: string;
  refs: Record<string, unknown>;
  data?: Record<string, unknown>;
  failureClass?: string;
  error?: string;
  capability?: string;
}

export interface ToolExecutionContext {
  ownerId: number;
  agentRunId: number;
  toolCallId: number;
  idempotencyKey: string;
  grants: ReadonlySet<string>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<Record<string, unknown> | object>;
  access: ToolAccess;
  ownerScoped: boolean;
  idempotent: boolean;
  async: boolean;
  requiresApproval: boolean;
  capabilityStatus: "implemented" | "partial" | "unavailable";
  execute: (input: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolEnvelope>;
}

export interface ExternalToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export interface ExternalToolProviderPort {
  id: string;
  configured: boolean;
  listTools(): ExternalToolDescriptor[];
  invoke(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolEnvelope>;
}

export type { AgentRun, AgentToolCall };
