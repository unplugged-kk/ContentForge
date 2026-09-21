import {
  protocolEventToUi,
  type AgentUiEvent,
} from "@shared/agent-ui";

const AGUI_EVENT_TYPES = [
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "STEP_STARTED",
  "STEP_FINISHED",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "STATE_SNAPSHOT",
  "STATE_DELTA",
];

export function subscribeAgentStream(
  runId: number,
  onEvent: (event: AgentUiEvent) => void,
  onError?: (error: Error) => void,
): () => void {
  const source = new EventSource(`/api/agent/runs/${runId}/stream`, { withCredentials: true });
  const handle = (type: string) => (ev: Event) => {
    const message = ev as MessageEvent<string>;
    try {
      const parsed = JSON.parse(message.data) as Record<string, unknown>;
      onEvent(protocolEventToUi({ type, ...parsed, runId }));
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  for (const type of AGUI_EVENT_TYPES) {
    source.addEventListener(type, handle(type));
  }
  source.onerror = () => {
    onError?.(new Error("AG-UI stream disconnected"));
  };
  return () => source.close();
}
