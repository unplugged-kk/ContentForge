import type { ToolDefinition, ToolEnvelope } from "./types";

export class AgentToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Duplicate agent tool name "${definition.name}"`);
    }
    this.tools.set(definition.name, definition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  names(): string[] {
    return Array.from(this.tools.keys()).sort();
  }

  toOpenAiTools(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return this.list().map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchemaHint(tool),
      },
    }));
  }

  describe(): Array<{
    name: string;
    description: string;
    access: string;
    ownerScoped: boolean;
    idempotent: boolean;
    async: boolean;
    requiresApproval: boolean;
    capabilityStatus: string;
    parameters: Record<string, unknown>;
  }> {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      access: tool.access,
      ownerScoped: tool.ownerScoped,
      idempotent: tool.idempotent,
      async: tool.async,
      requiresApproval: tool.requiresApproval,
      capabilityStatus: tool.capabilityStatus,
      parameters: zodToJsonSchemaHint(tool),
    }));
  }
}

function zodToJsonSchemaHint(tool: ToolDefinition): Record<string, unknown> {
  const shape = (tool.inputSchema as { shape?: Record<string, unknown> }).shape;
  if (!shape) {
    return { type: "object", additionalProperties: false };
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, schema] of Object.entries(shape)) {
    properties[key] = { type: inferZodType(schema) };
    if (!isOptionalZod(schema)) required.push(key);
  }
  return { type: "object", additionalProperties: false, properties, required };
}

function inferZodType(schema: unknown): string {
  const typeName = (schema as { _def?: { typeName?: string } })?._def?.typeName ?? "";
  if (typeName.includes("Number")) return "number";
  if (typeName.includes("Boolean")) return "boolean";
  if (typeName.includes("Array")) return "array";
  if (typeName.includes("Object")) return "object";
  return "string";
}

function isOptionalZod(schema: unknown): boolean {
  const typeName = (schema as { _def?: { typeName?: string } })?._def?.typeName ?? "";
  return typeName.includes("Optional") || typeName.includes("Default");
}

export function unknownToolEnvelope(name: string): ToolEnvelope {
  return {
    status: "invalid",
    tool: name,
    summary: `Unknown tool "${name}"`,
    refs: {},
    failureClass: "permanent",
    error: `Unknown tool "${name}"`,
  };
}
