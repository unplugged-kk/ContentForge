import type { ExternalToolDescriptor, ExternalToolProviderPort, ToolEnvelope, ToolExecutionContext } from "./types";
import { envelope } from "./envelope";

export function createHttpMcpExternalProvider(options: {
  id: string;
  url: string;
  timeoutMs?: number;
}): ExternalToolProviderPort {
  return {
    id: options.id,
    configured: true,
    listTools(): ExternalToolDescriptor[] {
      return [];
    },
    async invoke(name, args, ctx): Promise<ToolEnvelope> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
      try {
        const response = await fetch(options.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ctx.toolCallId,
            method: "tools/call",
            params: { name, arguments: args },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          return envelope({
            tool: name,
            status: "retryable",
            summary: `MCP provider HTTP ${response.status}`,
            failureClass: "transient",
            error: `MCP HTTP ${response.status}`,
          });
        }
        const json = (await response.json()) as { result?: unknown; error?: { message?: string } };
        if (json.error) {
          return envelope({
            tool: name,
            status: "failed",
            summary: json.error.message ?? "MCP error",
            failureClass: "permanent",
            error: json.error.message,
          });
        }
        return envelope({
          tool: name,
          status: "success",
          summary: "MCP tool result",
          data: { result: json.result, source: options.id },
          capability: "external",
        });
      } catch (error) {
        return envelope({
          tool: name,
          status: "retryable",
          summary: error instanceof Error ? error.message : String(error),
          failureClass: "transient",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createDisabledExternalProvider(id: string): ExternalToolProviderPort {
  return {
    id,
    configured: false,
    listTools: () => [],
    async invoke(name): Promise<ToolEnvelope> {
      return envelope({
        tool: name,
        status: "unknown",
        summary: `${id} is not configured`,
        capability: "unavailable",
        failureClass: "permanent",
        error: `${id.toUpperCase()} endpoint is not configured`,
      });
    },
  };
}
