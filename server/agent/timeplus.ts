import { envelope, denied } from "./envelope";
import type { DatabaseAgentStorage } from "./storage";
import type { ExternalToolProviderPort, ToolDefinition, ToolEnvelope, ToolExecutionContext } from "./types";
import { z } from "zod";
import { createDisabledExternalProvider, createHttpMcpExternalProvider } from "./external";

const emptySchema = z.object({}).strict();

const SEMANTIC_TOOLS = [
  "get_agent_run_metrics",
  "get_tool_latency",
  "get_generation_throughput",
  "get_publication_failures",
  "get_provider_health",
  "get_recent_agent_errors",
  "get_content_performance_summary",
] as const;

export function timeplusConfig(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  url: string | null;
} {
  const url = env.TIMEPLUS_MCP_URL?.trim() || null;
  const enabled = env.TIMEPLUS_ENABLED === "1" || Boolean(url);
  return { enabled: enabled && Boolean(url), url };
}

export function createTimeplusProvider(env: NodeJS.ProcessEnv = process.env): ExternalToolProviderPort {
  const config = timeplusConfig(env);
  if (!config.enabled || !config.url) return createDisabledExternalProvider("timeplus");
  return createHttpMcpExternalProvider({ id: "timeplus", url: config.url });
}

export function createTimeplusSemanticTools(options: {
  storage: DatabaseAgentStorage;
  provider: ExternalToolProviderPort;
  allowAdminSql?: boolean;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = SEMANTIC_TOOLS.map((name) => ({
    name,
    description: `Read-only operational metric: ${name}. Timeplus is telemetry only.`,
    inputSchema: emptySchema,
    access: "read",
    ownerScoped: true,
    idempotent: true,
    async: false,
    requiresApproval: false,
    capabilityStatus: options.provider.configured ? "partial" : "unavailable",
    execute: (input, ctx) => executeSemantic(name, input, ctx, options),
  }));

  if (options.allowAdminSql) {
    tools.push({
      name: "timeplus_run_sql",
      description: "Administrative Timeplus SQL. Not advertised to the content agent.",
      inputSchema: z.object({ sql: z.string().trim().min(1).max(2000) }),
      access: "privileged",
      ownerScoped: true,
      idempotent: true,
      async: false,
      requiresApproval: true,
      capabilityStatus: options.provider.configured ? "partial" : "unavailable",
      execute: async (input, ctx) => {
        if (!ctx.grants.has("timeplus_run_sql")) {
          return denied("timeplus_run_sql", "Administrative Timeplus SQL requires an explicit grant");
        }
        if (!options.provider.configured) {
          return envelope({
            tool: "timeplus_run_sql",
            status: "unknown",
            summary: "Timeplus is not configured",
            capability: "unavailable",
          });
        }
        return options.provider.invoke("run_sql", { sql: String(input.sql) }, ctx);
      },
    });
  }
  return tools;
}

async function executeSemantic(
  name: string,
  _input: Record<string, unknown>,
  ctx: ToolExecutionContext,
  options: { storage: DatabaseAgentStorage; provider: ExternalToolProviderPort },
): Promise<ToolEnvelope> {
  const local = await localMetrics(name, ctx, options.storage);
  if (!options.provider.configured) {
    return envelope({
      tool: name,
      status: "success",
      summary: "ContentForge local operational metrics (Timeplus not configured)",
      data: { source: "contentforge", ...local },
      capability: "unavailable",
    });
  }
  const remote = await options.provider.invoke(name, { ownerIdHintForbidden: true, metric: name }, ctx);
  if (remote.status === "success") {
    return envelope({
      tool: name,
      status: "success",
      summary: "Timeplus observation",
      data: { source: "timeplus", remote: remote.data, localFallback: local },
      capability: "partial",
    });
  }
  return envelope({
    tool: name,
    status: "success",
    summary: "Timeplus unavailable; ContentForge local metrics returned",
    data: { source: "contentforge", timeplus: remote, ...local },
    capability: "partial",
  });
}

async function localMetrics(
  name: string,
  ctx: ToolExecutionContext,
  storage: DatabaseAgentStorage,
): Promise<Record<string, unknown>> {
  const rows = await storage.listRecentToolCalls(ctx.ownerId, 50);
  const completed = rows.filter((row) => row.status === "completed");
  const failed = rows.filter((row) => row.status === "failed" || row.status === "denied");
  const durations = completed
    .filter((row) => row.startedAt && row.finishedAt)
    .map((row) => row.finishedAt!.getTime() - row.startedAt!.getTime());
  const avgLatency = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;
  return {
    tool: name,
    sampleSize: rows.length,
    completed: completed.length,
    failed: failed.length,
    avgLatencyMs: avgLatency,
    recentErrors: failed.slice(0, 5).map((row) => ({
      toolName: row.toolName,
      errorClass: row.errorClass,
      errorMessage: row.errorMessage,
    })),
  };
}
