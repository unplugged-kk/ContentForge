/**
 * Provider config resolution.
 *
 * Generic seam: the research job resolves a config slice for every provider id
 * it is about to run, without knowing what any provider reads. Providers that
 * own configuration expose `resolveConfig`; providers without one get `{}`.
 */

import { getProvider, hasProvider } from "./registry";

export type ProviderConfigMap = Record<string, Record<string, unknown>>;

export async function resolveProviderConfigs(
  providerIds: readonly string[],
  ctx: { userId?: number | null },
): Promise<ProviderConfigMap> {
  const configs: ProviderConfigMap = {};
  for (const providerId of providerIds) {
    if (!hasProvider(providerId)) continue;
    const definition = getProvider(providerId);
    configs[providerId] = definition.resolveConfig
      ? await definition.resolveConfig(ctx)
      : {};
  }
  return configs;
}
