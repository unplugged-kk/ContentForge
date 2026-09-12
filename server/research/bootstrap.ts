/**
 * Provider bootstrap.
 *
 * Registers the built-in providers once. Registration itself performs no
 * network or database I/O (the RSS config loader is lazy), so it is safe to
 * call from server startup or a test setup.
 */

import { hasProvider, registerProvider } from "./registry";
import { RSS_PROVIDER_ID, createRssProvider } from "./providers/rss";
import { loadRssProviderConfig } from "./providers/rssConfig";

/** Idempotent: safe to call more than once. */
export function registerBuiltinProviders(): void {
  if (!hasProvider(RSS_PROVIDER_ID)) {
    registerProvider(createRssProvider({ loadConfig: loadRssProviderConfig }));
  }
}
