export type ProviderCandidate = {
  id: number;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  transport: "chat_completions" | "responses";
  enabled: boolean;
  isDefault: boolean;
  headers: Record<string, string>;
};

export type ModelRouteCandidate = {
  purpose: string;
  providerId: number;
  model: string | null;
  priority: number;
  enabled: boolean;
  allowFallback: boolean;
  fallbackProviderId: number | null;
  fallbackModel: string | null;
};

export type ProviderSelection = {
  provider: ProviderCandidate;
  model: string;
  fallbackUsed: boolean;
  reason: string;
};

export function selectProvider(input: {
  purpose: string;
  providers: ProviderCandidate[];
  routes: ModelRouteCandidate[];
}): ProviderSelection | { error: string } {
  const enabled = input.providers.filter((provider) => provider.enabled);
  const byId = new Map(enabled.map((provider) => [provider.id, provider]));
  const routes = input.routes
    .filter((route) => route.enabled && route.purpose === input.purpose)
    .sort((a, b) => a.priority - b.priority);

  for (const route of routes) {
    const primary = byId.get(route.providerId);
    if (primary) {
      return {
        provider: primary,
        model: route.model?.trim() || primary.model,
        fallbackUsed: false,
        reason: "route",
      };
    }
    if (!route.allowFallback || route.fallbackProviderId == null) {
      return { error: `provider ${route.providerId} is disabled and fallback is not allowed for ${input.purpose}` };
    }
    const fallback = byId.get(route.fallbackProviderId);
    if (!fallback) {
      return { error: `fallback provider ${route.fallbackProviderId} is unavailable for ${input.purpose}` };
    }
    return {
      provider: fallback,
      model: route.fallbackModel?.trim() || fallback.model,
      fallbackUsed: true,
      reason: "fallback",
    };
  }

  const fallbackProvider = enabled.find((provider) => provider.isDefault) ?? enabled[0];
  if (!fallbackProvider) return { error: "no enabled provider" };
  return {
    provider: fallbackProvider,
    model: fallbackProvider.model,
    fallbackUsed: false,
    reason: fallbackProvider.isDefault ? "default" : "first-enabled",
  };
}
