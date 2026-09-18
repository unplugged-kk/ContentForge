/**
 * Phase 23 — presentation mapping for the agent workspace.
 *
 * Durable truth stays on the server (AgentRun / AgentToolCall / domain rows).
 * This module only reduces AG-UI events into view models and compiles a
 * fixture-backend tool plan from natural-language intent. It is not a second
 * agent runtime or tool registry.
 */

export type WorkspacePlanStep = {
  tool: string;
  arguments: Record<string, unknown>;
};

export type AgentUiEvent = {
  type: string;
  timestamp?: string;
  runId?: number | string | null;
  payload?: Record<string, unknown>;
};

export type ToolCallView = {
  id: string;
  name: string;
  status: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  refs: Record<string, unknown>;
  summary: string;
  errorClass: string | null;
  errorMessage: string | null;
  renderer: ToolRendererId;
};

export type ToolRendererId =
  | "research_topic"
  | "create_story"
  | "find_opportunities"
  | "repurpose_story"
  | "generate_artifact"
  | "generate_image"
  | "generate_video"
  | "approve_artifact"
  | "schedule_publication"
  | "publish_now"
  | "get_publication_status"
  | "generic";

export type ClassifiedError = {
  class:
    | "retryable"
    | "permission_denied"
    | "not_found"
    | "conflict"
    | "validation_error"
    | "unknown"
    | "failed";
  message: string;
  retrySafe: boolean;
};

export type AgentWorkspaceView = {
  runId: number | null;
  status: string;
  objective: string;
  backendId: string;
  activity: string[];
  toolCalls: ToolCallView[];
  refs: Record<string, unknown>;
  messages: string[];
  error: ClassifiedError | null;
  waitingForApproval: boolean;
};

export type CapabilityRow = {
  group: string;
  available: boolean;
  approvalRequired: boolean;
  status: string;
};

const PRIVILEGED_TOOLS = new Set(["approve_artifact", "publish_now"]);

export function selectToolRenderer(toolName: string): ToolRendererId {
  switch (toolName) {
    case "research_topic":
    case "research_url":
    case "get_research_job":
      return "research_topic";
    case "create_story":
    case "get_story":
      return "create_story";
    case "find_opportunities":
      return "find_opportunities";
    case "repurpose_story":
      return "repurpose_story";
    case "generate_artifact":
      return "generate_artifact";
    case "generate_image":
      return "generate_image";
    case "generate_video":
      return "generate_video";
    case "approve_artifact":
      return "approve_artifact";
    case "schedule_publication":
      return "schedule_publication";
    case "publish_now":
      return "publish_now";
    case "get_publication_status":
      return "get_publication_status";
    default:
      return "generic";
  }
}

export function classifyAgentError(input: {
  status?: string | number;
  errorClass?: string | null;
  failureClass?: string | null;
  message?: string | null;
  envelopeStatus?: string | null;
}): ClassifiedError {
  const envelope = (input.envelopeStatus ?? "").toLowerCase();
  const failure = (input.failureClass ?? input.errorClass ?? "").toLowerCase();
  const message = (input.message ?? "request failed").trim() || "request failed";
  const http = typeof input.status === "number" ? input.status : Number(input.status);

  if (envelope === "denied" || http === 401 || http === 403 || /denied|privilege|authorization/i.test(message)) {
    return { class: "permission_denied", message, retrySafe: false };
  }
  if (envelope === "not_found" || http === 404) {
    return { class: "not_found", message, retrySafe: false };
  }
  if (envelope === "conflict" || http === 409 || /stale revision|not complete/i.test(message)) {
    return { class: "conflict", message, retrySafe: false };
  }
  if (envelope === "invalid" || http === 400 || http === 422) {
    return { class: "validation_error", message, retrySafe: false };
  }
  if (envelope === "retryable" || failure === "transient" || http === 429 || (http >= 500 && http < 600)) {
    return { class: "retryable", message, retrySafe: true };
  }
  if (envelope === "failed" || failure === "permanent") {
    return { class: "failed", message, retrySafe: false };
  }
  return { class: "unknown", message, retrySafe: false };
}

export function mapCapabilities(
  tools: Array<{
    name: string;
    access?: string;
    requiresApproval?: boolean;
    capabilityStatus?: string;
  }>,
): CapabilityRow[] {
  const groups: Array<{ group: string; match: (name: string) => boolean }> = [
    { group: "Research", match: (name) => name.startsWith("research") || name === "get_research_job" },
    { group: "Generation", match: (name) => name === "generate_artifact" || name === "repurpose_story" || name === "find_opportunities" },
    { group: "Image", match: (name) => name === "generate_image" },
    { group: "Video", match: (name) => name === "generate_video" },
    { group: "Publishing", match: (name) => name === "publish_now" || name === "schedule_publication" || name === "approve_artifact" },
    { group: "Analytics", match: (name) => name === "get_analytics" },
  ];
  return groups.map(({ group, match }) => {
    const hits = tools.filter((tool) => match(tool.name));
    const approvalRequired = hits.some((tool) => tool.requiresApproval || tool.access === "privileged");
    const available = hits.some((tool) => tool.capabilityStatus !== "unavailable");
    const status = hits.some((tool) => tool.capabilityStatus === "partial")
      ? "partial"
      : hits.some((tool) => tool.capabilityStatus === "implemented")
        ? "available"
        : hits.length
          ? "unavailable"
          : "unavailable";
    return { group, available, approvalRequired, status };
  });
}

export function titleFromObjective(objective: string): string {
  const cleaned = objective.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled story";
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}

export function matchStoryId(objective: string): number | null {
  const match = objective.match(/\bstory\s+#?(\d+)\b/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function inferTargets(
  objective: string,
): Array<{ format: string; channel: string; generate: boolean; count?: number }> {
  const text = objective.toLowerCase();
  const targets: Array<{ format: string; channel: string; generate: boolean; count?: number }> = [];
  const countNear = (patterns: RegExp[], fallback = 1): number => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const n = Number(match[1]);
        if (Number.isInteger(n) && n > 0) return Math.min(n, 10);
      }
    }
    return fallback;
  };
  const wantsThread = /\bthread\b/.test(text);
  const wantsX = /\bx\b|\btwitter\b|\btweet\b/.test(text) || /\bx post\b/.test(text);
  const wantsLinkedIn = /\blinkedin\b/.test(text);
  const wantsInstagram = /\binstagram\b|\breel\b/.test(text);
  if (wantsX || (!wantsLinkedIn && !wantsInstagram && /\bpost\b|\bcontent\b|\bopportunit/.test(text))) {
    targets.push({
      format: "x_post",
      channel: "x",
      generate: true,
      count: countNear([/(\d+)\s+x posts?/, /(\d+)\s+tweets?/, /(\d+)\s+posts?/]),
    });
  }
  if (wantsThread) {
    targets.push({
      format: "x_thread",
      channel: "x",
      generate: true,
      count: countNear([/(\d+)\s+threads?/], 1),
    });
  }
  if (wantsLinkedIn) {
    targets.push({
      format: "linkedin_post",
      channel: "linkedin",
      generate: true,
      count: countNear([/(\d+)\s+linkedin/], 1),
    });
  }
  if (wantsInstagram) {
    targets.push({
      format: "image",
      channel: "instagram",
      generate: true,
      count: countNear([/(\d+)\s+instagram/, /(\d+)\s+images?/], 1),
    });
  }
  if (targets.length === 0 && /\bvariant/.test(text)) {
    targets.push({ format: "x_post", channel: "x", generate: true });
  }
  return targets;
}

export function compileWorkspaceIntent(objective: string): WorkspacePlanStep[] {
  const text = objective.toLowerCase();
  const storyId = matchStoryId(objective);
  const wantsImage = /\bimage\b|\bvisual\b/.test(text);
  const wantsVideo = /\bvideo\b/.test(text);
  const wantsResearch = /\bresearch\b|\bsources\b|\bthis week\b/.test(text);
  const wantsContent =
    /\bpost\b|\bcontent\b|\bopportunit|\bprepare\b|\bvariant|\bstory\b|\blinkedin\b|\binstagram\b|\bx post\b/.test(
      text,
    );
  const steps: WorkspacePlanStep[] = [];

  if (storyId && !wantsResearch) {
    steps.push({ tool: "get_story", arguments: { storyId } });
  } else if (wantsResearch || (wantsContent && !storyId && !wantsImage && !wantsVideo)) {
    steps.push({ tool: "research_topic", arguments: { query: objective } });
    steps.push({
      tool: "create_story",
      arguments: {
        researchJobId: "$researchJobId",
        title: titleFromObjective(objective),
        insightBody: "$insightBody",
      },
    });
  }

  const targets = inferTargets(objective);
  if ((storyId || steps.some((step) => step.tool === "create_story")) && targets.length > 0) {
    steps.push({
      tool: "repurpose_story",
      arguments: {
        storyId: storyId ?? "$storyId",
        targets,
      },
    });
  }

  if (wantsImage) {
    steps.push({ tool: "generate_image", arguments: { subject: objective } });
  }
  if (wantsVideo) {
    steps.push({ tool: "generate_video", arguments: { subject: objective } });
  }
  if (steps.length === 0) {
    steps.push({ tool: "research_topic", arguments: { query: objective } });
  }
  return steps.filter((step) => !PRIVILEGED_TOOLS.has(step.tool));
}

export function collectRefs(
  history: Array<{ refs?: Record<string, unknown> | null; resourceRefs?: Record<string, unknown> | null; result?: unknown }>,
): Record<string, unknown> {
  const refs: Record<string, unknown> = {};
  for (const item of history) {
    Object.assign(refs, item.resourceRefs ?? {}, item.refs ?? {});
    const result = item.result as { refs?: Record<string, unknown> } | undefined;
    if (result?.refs && typeof result.refs === "object") Object.assign(refs, result.refs);
  }
  return refs;
}

export function resolvePlanArguments(
  args: Record<string, unknown>,
  refs: Record<string, unknown>,
  objective = "",
): Record<string, unknown> {
  const resolve = (value: unknown): unknown => {
    if (value === "$researchJobId") return asPositiveId(refs.researchJobId);
    if (value === "$storyId") return asPositiveId(refs.storyId);
    if (value === "$opportunityId") {
      if (asPositiveId(refs.opportunityId)) return asPositiveId(refs.opportunityId);
      const ids = refs.opportunityIds;
      if (Array.isArray(ids) && asPositiveId(ids[0])) return asPositiveId(ids[0]);
      return undefined;
    }
    if (value === "$artifactId") return asPositiveId(refs.artifactId);
    if (value === "$insightBody") {
      const excerpt = typeof refs.insightBody === "string" ? refs.insightBody : objective;
      return excerpt.trim().slice(0, 8000) || objective.slice(0, 8000) || "Operator intent";
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        out[key] = resolve(nested);
      }
      return out;
    }
    return value;
  };
  return resolve(args) as Record<string, unknown>;
}

function asPositiveId(value: unknown): number | undefined {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function emptyWorkspaceView(): AgentWorkspaceView {
  return {
    runId: null,
    status: "idle",
    objective: "",
    backendId: "",
    activity: [],
    toolCalls: [],
    refs: {},
    messages: [],
    error: null,
    waitingForApproval: false,
  };
}

export function reduceAgentEvents(events: AgentUiEvent[], prev: AgentWorkspaceView = emptyWorkspaceView()): AgentWorkspaceView {
  const view: AgentWorkspaceView = {
    ...prev,
    activity: [],
    toolCalls: [],
    refs: {},
    messages: [...prev.messages],
    error: null,
    waitingForApproval: false,
  };
  const tools = new Map<string, ToolCallView>();

  for (const event of events) {
    const payload = event.payload ?? {};
    const type = event.type;
    if (type === "RUN_STARTED") {
      view.status = "running";
      view.runId = toId(event.runId ?? payload.runId) ?? view.runId;
      view.backendId = typeof payload.backendId === "string" ? payload.backendId : view.backendId;
      view.activity.push("Run started");
    } else if (type === "TEXT_MESSAGE_CONTENT" || type === "TEXT_MESSAGE_END") {
      const content = typeof payload.delta === "string" ? payload.delta : typeof payload.content === "string" ? payload.content : "";
      if (content) view.messages.push(content);
    } else if (type === "TOOL_CALL_START") {
      const id = String(payload.toolCallId ?? tools.size + 1);
      const name = String(payload.toolCallName ?? "unknown");
      tools.set(id, {
        id,
        name,
        status: "running",
        arguments: {},
        result: null,
        refs: {},
        summary: activityForTool(name, "running"),
        errorClass: null,
        errorMessage: null,
        renderer: selectToolRenderer(name),
      });
      view.activity.push(activityForTool(name, "running"));
    } else if (type === "TOOL_CALL_ARGS") {
      const id = String(payload.toolCallId ?? "");
      const current = tools.get(id);
      if (current) {
        const delta = payload.delta;
        current.arguments =
          delta && typeof delta === "object" && !Array.isArray(delta)
            ? (delta as Record<string, unknown>)
            : typeof delta === "string"
              ? safeRecord(delta)
              : current.arguments;
      }
    } else if (type === "TOOL_CALL_RESULT") {
      const id = String(payload.toolCallId ?? "");
      const current = tools.get(id);
      const result = asRecord(payload.result);
      const status = String(payload.status ?? result.status ?? "completed");
      const refs = asRecord(result.refs) ?? asRecord(payload.refs);
      if (current) {
        current.status = status;
        current.result = result;
        current.refs = refs;
        current.summary = typeof result.summary === "string" ? result.summary : activityForTool(current.name, status);
        current.errorClass = typeof result.failureClass === "string" ? result.failureClass : null;
        current.errorMessage = typeof result.error === "string" ? result.error : null;
        Object.assign(view.refs, refs);
        view.activity.push(activityForTool(current.name, status, result));
        if (result.status === "denied") {
          view.waitingForApproval = current.name === "approve_artifact" || current.name === "publish_now";
          view.error = classifyAgentError({
            envelopeStatus: "denied",
            message: current.errorMessage ?? `${current.name} requires authorization`,
          });
        } else if (result.status === "failed" || result.status === "invalid" || result.status === "not_found" || result.status === "conflict") {
          view.error = classifyAgentError({
            envelopeStatus: String(result.status),
            failureClass: current.errorClass,
            message: current.errorMessage ?? current.summary,
          });
        }
      }
    } else if (type === "RUN_FINISHED") {
      view.status = String(payload.result ?? "completed");
      view.activity.push("Run completed");
    } else if (type === "RUN_ERROR") {
      view.status = "failed";
      view.error = classifyAgentError({
        failureClass: typeof payload.failureClass === "string" ? payload.failureClass : null,
        message: typeof payload.message === "string" ? payload.message : "agent run failed",
      });
      view.activity.push("Run failed");
    }
  }

  view.toolCalls = Array.from(tools.values());
  if (view.toolCalls.some((call) => call.name === "approve_artifact" && call.status === "denied")) {
    view.waitingForApproval = true;
  }
  return view;
}

function activityForTool(name: string, status: string, result?: Record<string, unknown>): string {
  if (name === "research_topic" || name === "research_url" || name === "get_research_job") {
    if (status === "running" || status === "queued" || status === "in_progress") return "Researching…";
    const sources = Number((result?.data as { sourceCount?: number } | undefined)?.sourceCount);
    if (Number.isFinite(sources) && sources > 0) return `Found ${sources} sources`;
    return "Research complete";
  }
  if (name === "create_story") return status === "running" ? "Creating story…" : "Created story";
  if (name === "find_opportunities" || name === "repurpose_story") {
    const count = Array.isArray((result?.refs as { opportunityIds?: unknown[] } | undefined)?.opportunityIds)
      ? ((result?.refs as { opportunityIds: unknown[] }).opportunityIds.length)
      : Number((result?.data as { opportunities?: unknown[] } | undefined)?.opportunities?.length);
    if (Number.isFinite(count) && count > 0) return `Found ${count} opportunities`;
    return status === "running" ? "Finding opportunities…" : "Opportunities updated";
  }
  if (name === "generate_artifact") return status === "running" || status === "queued" ? "Generating artifacts…" : "Artifact generated";
  if (name === "generate_image") return status === "running" || status === "queued" ? "Generating image…" : "Image generated";
  if (name === "generate_video") return status === "running" || status === "queued" ? "Generating video…" : "Video requested";
  if (name === "approve_artifact") {
    if (status === "denied") return "Waiting for approval";
    return status === "completed" || status === "success" ? "Approval granted" : "Waiting for approval";
  }
  if (name === "schedule_publication") return "Scheduling…";
  if (name === "publish_now") return status === "denied" ? "Publishing requires authorization" : "Publishing…";
  return `${name} ${status}`;
}

export function toAguiProtocolEvents(events: AgentUiEvent[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const event of events) {
    const payload = event.payload ?? {};
    const runId = String(event.runId ?? payload.runId ?? "");
    const threadId = String(payload.threadId ?? runId);
    if (event.type === "RUN_STARTED") {
      out.push({ type: "RUN_STARTED", threadId, runId });
    } else if (event.type === "STEP_STARTED") {
      out.push({ type: "STEP_STARTED", stepName: payload.stepName ?? `step-${payload.step}` });
    } else if (event.type === "STEP_FINISHED") {
      out.push({ type: "STEP_FINISHED", stepName: payload.stepName ?? `step-${payload.step}` });
    } else if (event.type === "TOOL_CALL_START") {
      out.push({
        type: "TOOL_CALL_START",
        toolCallId: String(payload.toolCallId ?? ""),
        toolCallName: String(payload.toolCallName ?? ""),
      });
    } else if (event.type === "TOOL_CALL_ARGS") {
      const delta =
        typeof payload.delta === "string" ? payload.delta : JSON.stringify(payload.delta ?? {});
      out.push({ type: "TOOL_CALL_ARGS", toolCallId: String(payload.toolCallId ?? ""), delta });
    } else if (event.type === "TOOL_CALL_RESULT") {
      out.push({ type: "TOOL_CALL_END", toolCallId: String(payload.toolCallId ?? "") });
      out.push({
        type: "TOOL_CALL_RESULT",
        toolCallId: String(payload.toolCallId ?? ""),
        content: JSON.stringify(payload.result ?? {}),
        role: "tool",
      });
    } else if (event.type === "RUN_FINISHED") {
      out.push({ type: "RUN_FINISHED", threadId, runId, result: payload.result ?? "completed" });
    } else if (event.type === "RUN_ERROR") {
      out.push({
        type: "RUN_ERROR",
        message: payload.message ?? "agent run failed",
        code: payload.failureClass ?? "unknown",
      });
    }
  }
  return out;
}

export function formatSse(events: Array<Record<string, unknown>>): string {
  return events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

export function parseSseBlock(raw: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const blocks = raw.split("\n\n");
  for (const block of blocks) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    try {
      const parsed = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") events.push(parsed);
    } catch {
      /* ignore malformed frames */
    }
  }
  return events;
}

export function protocolEventToUi(event: Record<string, unknown>): AgentUiEvent {
  const type = String(event.type ?? "RAW");
  if (type === "TOOL_CALL_RESULT") {
    let result: Record<string, unknown> = {};
    if (typeof event.content === "string") {
      try {
        const parsed = JSON.parse(event.content) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          result = parsed as Record<string, unknown>;
        }
      } catch {
        result = { summary: event.content };
      }
    } else if (event.result && typeof event.result === "object") {
      result = event.result as Record<string, unknown>;
    }
    return {
      type: "TOOL_CALL_RESULT",
      runId: toId(event.runId),
      payload: { toolCallId: event.toolCallId, result, status: result.status },
    };
  }
  if (type === "TOOL_CALL_ARGS") {
    return {
      type: "TOOL_CALL_ARGS",
      runId: toId(event.runId),
      payload: { toolCallId: event.toolCallId, delta: event.delta },
    };
  }
  return {
    type,
    runId: toId(event.runId),
    payload: event,
  };
}

function toId(value: unknown): number | null {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function safeRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}
