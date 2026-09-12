/**
 * Provider bootstrap — the single place where built-in providers are registered.
 *
 * One ResearchEngine, many interchangeable providers. Adding a provider is a
 * registration here (plus its own config seam); the engine, the job contract and
 * the API never change.
 */

import { hasProvider, registerProvider } from "./registry";
import { createRssProvider, RSS_PROVIDER_ID } from "./providers/rss";
import { loadRssProviderConfig } from "./providers/rssConfig";
import {
  createRedditProvider,
  loadRedditProviderConfig,
  REDDIT_PROVIDER_ID,
} from "./providers/reddit";
import {
  createYoutubeProvider,
  loadYoutubeProviderConfig,
  YOUTUBE_PROVIDER_ID,
} from "./providers/youtube";
import { createHnProvider, HN_PROVIDER_ID, loadHnProviderConfig } from "./providers/hn";
import { createWebProvider, loadWebProviderConfig, WEB_PROVIDER_ID } from "./providers/web";

/** Idempotent: registers the built-in provider set once. */
export function registerBuiltinProviders(): void {
  if (!hasProvider(RSS_PROVIDER_ID)) {
    registerProvider(createRssProvider({ loadConfig: loadRssProviderConfig }));
  }
  if (!hasProvider(REDDIT_PROVIDER_ID)) {
    registerProvider(createRedditProvider({ loadConfig: loadRedditProviderConfig }));
  }
  if (!hasProvider(YOUTUBE_PROVIDER_ID)) {
    registerProvider(createYoutubeProvider({ loadConfig: loadYoutubeProviderConfig }));
  }
  if (!hasProvider(HN_PROVIDER_ID)) {
    registerProvider(createHnProvider({ loadConfig: loadHnProviderConfig }));
  }
  if (!hasProvider(WEB_PROVIDER_ID)) {
    registerProvider(createWebProvider({ loadConfig: loadWebProviderConfig }));
  }
}
