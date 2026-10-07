import { emitAgentLog } from "../agent/events";
import { providerStorage } from "./provider-storage";
import { selectProvider, type ProviderSelection } from "./select-provider";

export type ResolvedAgentProvider = {
  providerId: number;
  providerName: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  transport: "chat_completions" | "responses";
  headers: Record<string, string>;
  fallbackUsed: boolean;
  reason: string;
};

let missingTableLogged = false;

export async function resolveAgentProvider(input: { ownerId: number; purpose?: string }): Promise<ResolvedAgentProvider | null> {
  try {
    const purpose = input.purpose ?? "agent";
    const rows = await providerStorage.list(input.ownerId);
    const routes = await providerStorage.listRoutes(input.ownerId);
    const selected = selectProvider({
      purpose,
      providers: providerStorage.candidates(rows),
      routes: providerStorage.routeCandidates(routes),
    });
    if ("error" in selected) return null;
    return toResolved(selected);
  } catch (error) {
    const message = error instanceof Error ? error.message : "provider resolve failed";
    if (/ai_providers|does not exist|42P01/i.test(message)) {
      if (!missingTableLogged) {
        missingTableLogged = true;
        emitAgentLog("provider_registry_unavailable", { message: "ai_providers table is missing" });
      }
      return null;
    }
    emitAgentLog("provider_resolve_failed", { message });
    return null;
  }
}

function toResolved(selected: ProviderSelection): ResolvedAgentProvider {
  return {
    providerId: selected.provider.id,
    providerName: selected.provider.name,
    baseUrl: selected.provider.baseUrl,
    apiKey: selected.provider.apiKey,
    model: selected.model,
    transport: selected.provider.transport,
    headers: selected.provider.headers,
    fallbackUsed: selected.fallbackUsed,
    reason: selected.reason,
  };
}
