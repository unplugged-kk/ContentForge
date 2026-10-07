import { useEffect, useMemo, useRef } from "react";
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { HttpAgent } from "@ag-ui/client";
import { getCsrfToken } from "@/lib/csrf";

const BUTTON_LABELS: Record<string, string> = {
  "copilot-add-menu-button": "Add",
  "copilot-send-button": "Send message",
  "copilot-start-transcribe-button": "Start voice input",
  "copilot-cancel-transcribe-button": "Cancel voice input",
  "copilot-finish-transcribe-button": "Finish voice input",
  "copilot-close-button": "Close",
  "copilot-copy-button": "Copy",
  "copilot-edit-button": "Edit",
  "copilot-read-aloud-button": "Read aloud",
  "copilot-regenerate-button": "Regenerate",
  "copilot-scroll-to-bottom": "Scroll to bottom",
  "copilot-thumbs-down-button": "Thumbs down",
  "copilot-thumbs-up-button": "Thumbs up",
  "copilot-user-copy-button": "Copy message",
  "copilot-inspector-button": "Inspector",
  "copilot-chat-toggle": "Toggle chat",
  "copilot-threads-drawer-launcher": "Threads",
};

function labelUnnamedButtons(root: ParentNode) {
  for (const button of root.querySelectorAll("button")) {
    if (button.getAttribute("aria-label")?.trim()) continue;
    if (button.getAttribute("aria-labelledby")?.trim()) continue;
    if (button.innerText.trim()) continue;
    const testId = button.getAttribute("data-testid") ?? "";
    const label =
      BUTTON_LABELS[testId] ??
      (testId ? testId.replace(/^copilot-/, "").replace(/-button$/, "").replaceAll("-", " ") : "Chat action");
    button.setAttribute("aria-label", label);
  }
}

export function CopilotPanel() {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = panelRef.current;
    if (!root) return;
    labelUnnamedButtons(root);
    const observer = new MutationObserver(() => labelUnnamedButtons(root));
    observer.observe(root, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  const agent = useMemo(
    () =>
      new HttpAgent({
        agentId: "contentforge",
        url: "/api/agent/agui",
        fetch: async (url, init) => {
          const headers = new Headers(init.headers);
          const csrf = await getCsrfToken();
          if (csrf) headers.set("X-CSRF-Token", csrf);
          return fetch(url, { ...init, headers, credentials: "include" });
        },
      }),
    [],
  );

  return (
    <div ref={panelRef} className="rounded-lg border bg-card" data-testid="copilotkit-agent-workspace">
      <CopilotKitProvider agentId="contentforge" credentials="include" selfManagedAgents={{ contentforge: agent }}>
        <CopilotChat />
      </CopilotKitProvider>
    </div>
  );
}
