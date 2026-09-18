import { Component, type ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core";

class CopilotKitBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return <div data-testid="copilotkit-agent-workspace" className="h-full">{this.props.children}</div>;
    }
    return this.props.children;
  }
}

/**
 * CopilotKit is the UI/agent interaction layer only. Domain truth stays in
 * ContentForge Agent Runtime via /api/agent/agui (AG-UI).
 */
export function AgentCopilotProvider({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitBoundary>
      <CopilotKit runtimeUrl="/api/agent/agui" agent="contentforge" showDevConsole={false}>
        <div data-testid="copilotkit-agent-workspace" className="h-full">
          {children}
        </div>
      </CopilotKit>
    </CopilotKitBoundary>
  );
}

