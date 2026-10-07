import { useMemo } from "react";
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { HttpAgent } from "@ag-ui/client";
import { getCsrfToken } from "@/lib/csrf";
import "@copilotkit/react-core/v2/styles.css";

export function CopilotPanel() {
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
    <div className="rounded-lg border bg-card" data-testid="panel-copilotkit">
      <CopilotKitProvider agentId="contentforge" credentials="include" selfManagedAgents={{ contentforge: agent }}>
        <CopilotChat />
      </CopilotKitProvider>
    </div>
  );
}
