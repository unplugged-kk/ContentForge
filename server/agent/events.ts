import type { AgentEvent, AgentRun, AgentToolCall } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function runStarted(run: AgentRun): AgentEvent {
  return {
    type: "RUN_STARTED",
    timestamp: nowIso(),
    runId: run.id,
    payload: {
      threadId: String(run.id),
      runId: String(run.id),
      backendId: run.backendId,
      ownerId: run.userId,
    },
  };
}

export function stepStarted(run: AgentRun, step: number): AgentEvent {
  return {
    type: "STEP_STARTED",
    timestamp: nowIso(),
    runId: run.id,
    payload: { stepName: `step-${step}`, step },
  };
}

export function toolCallStarted(run: AgentRun, call: AgentToolCall): AgentEvent {
  return {
    type: "TOOL_CALL_START",
    timestamp: nowIso(),
    runId: run.id,
    payload: { toolCallId: String(call.id), toolCallName: call.toolName },
  };
}

export function toolCallArgs(run: AgentRun, call: AgentToolCall): AgentEvent {
  return {
    type: "TOOL_CALL_ARGS",
    timestamp: nowIso(),
    runId: run.id,
    payload: { toolCallId: String(call.id), delta: call.input },
  };
}

export function toolCallResult(run: AgentRun, call: AgentToolCall): AgentEvent {
  return {
    type: "TOOL_CALL_RESULT",
    timestamp: nowIso(),
    runId: run.id,
    payload: {
      toolCallId: String(call.id),
      result: call.result,
      status: call.status,
    },
  };
}

export function stepFinished(run: AgentRun, step: number): AgentEvent {
  return {
    type: "STEP_FINISHED",
    timestamp: nowIso(),
    runId: run.id,
    payload: { step },
  };
}

export function runFinished(run: AgentRun): AgentEvent {
  return {
    type: "RUN_FINISHED",
    timestamp: nowIso(),
    runId: run.id,
    payload: { result: run.status },
  };
}

export function runFailed(run: AgentRun): AgentEvent {
  return {
    type: "RUN_ERROR",
    timestamp: nowIso(),
    runId: run.id,
    payload: { message: run.errorMessage ?? "agent run failed", failureClass: run.errorClass },
  };
}

export function reconstructAguiEvents(run: AgentRun, calls: AgentToolCall[]): AgentEvent[] {
  const events: AgentEvent[] = [runStarted(run)];
  let step = 0;
  for (const call of calls) {
    step += 1;
    events.push(stepStarted(run, step));
    events.push(toolCallStarted(run, call));
    events.push(toolCallArgs(run, call));
    events.push(toolCallResult(run, call));
    events.push(stepFinished(run, step));
  }
  if (run.status === "failed") events.push(runFailed(run));
  else if (run.status === "completed" || run.status === "cancelled") events.push(runFinished(run));
  return events;
}

export function emitAgentLog(
  type: string,
  fields: Record<string, unknown>,
): void {
  const scrubbed = { ...fields };
  for (const key of Object.keys(scrubbed)) {
    if (/token|password|secret|authorization|apikey/i.test(key)) {
      scrubbed[key] = "[redacted]";
    }
  }
  console.log(
    JSON.stringify({
      source: "agent",
      type,
      timestamp: nowIso(),
      ...scrubbed,
    }),
  );
}
