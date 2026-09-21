import type { AgentRun, AgentToolCall } from "@shared/schema";
import {
  collectRefs,
  resolvePlanArguments,
  type WorkspacePlanStep,
} from "@shared/agent-ui";
import { parseGrants } from "./policy";
import type { AgentRuntime } from "./runtime";
import type { DatabaseAgentStorage } from "./storage";
import type { ToolEnvelope } from "./types";

export async function continueWorkspaceRun(
  deps: { runtime: AgentRuntime; storage: DatabaseAgentStorage },
  run: AgentRun,
): Promise<{
  run: AgentRun;
  done: boolean;
  call: AgentToolCall | null;
  envelope: ToolEnvelope | null;
  reused: boolean;
}> {
  const snapshot = (run.providerSnapshot ?? {}) as {
    workspacePlan?: WorkspacePlanStep[];
    plan?: WorkspacePlanStep[];
    grants?: unknown;
  };
  const plan = snapshot.workspacePlan ?? snapshot.plan ?? [];
  const calls = await deps.storage.listToolCalls(run.id);
  const next = plan[calls.length];
  if (!next) {
    const finished =
      run.status === "completed" || run.status === "failed" || run.status === "cancelled"
        ? run
        : (await deps.storage.markRunStatus(run.id, "completed", { finishedAt: new Date() })) ?? run;
    return { run: finished, done: true, call: null, envelope: null, reused: false };
  }

  const refs = collectRefs(calls);
  const args = resolvePlanArguments(next.arguments, refs, run.objective);
  const grants = parseGrants(snapshot.grants);
  const result = await deps.runtime.executeTool(
    run,
    { name: next.tool, arguments: args },
    grants,
  );
  const remaining = plan.length - (calls.length + 1);
  const status = remaining <= 0 ? "completed" : "waiting";
  const updated =
    (await deps.storage.markRunStatus(run.id, status, {
      currentStep: calls.length + 1,
      ...(remaining <= 0 ? { finishedAt: new Date() } : {}),
    })) ?? run;
  return {
    run: updated,
    done: remaining <= 0,
    call: result.call,
    envelope: result.envelope,
    reused: result.reused,
  };
}
