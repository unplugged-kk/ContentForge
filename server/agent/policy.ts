import { denied } from "./envelope";
import type { ToolDefinition, ToolEnvelope, ToolExecutionContext } from "./types";

export const PRIVILEGED_TOOLS = new Set(["approve_artifact", "publish_now"]);
export const ADMIN_TIMEPLUS_SQL = "timeplus_run_sql";

export function grantName(toolName: string): string {
  return toolName;
}

export function authorizeTool(
  definition: ToolDefinition,
  ctx: ToolExecutionContext,
): ToolEnvelope | null {
  if (!definition.requiresApproval && definition.access !== "privileged") {
    return null;
  }
  if (ctx.grants.has(grantName(definition.name))) {
    return null;
  }
  return denied(
    definition.name,
    `Tool "${definition.name}" is privileged; explicit authorization grant is required`,
  );
}

export function parseGrants(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}
