/**
 * Provider base URLs.
 *
 * Kept in configuration (env) rather than hardcoded in provider logic, so a
 * deployment — or the deterministic E2E — can point a provider at a different
 * host without changing business logic. Defaults are the real public endpoints.
 */

export interface ProviderUrls {
  reddit: string;
  youtube: string;
  hackerNews: string;
}

function base(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return (trimmed && trimmed.length > 0 ? trimmed : fallback).replace(/\/+$/, "");
}

export function providerUrls(env: NodeJS.ProcessEnv = process.env): ProviderUrls {
  return {
    reddit: base(env.REDDIT_BASE_URL, "https://www.reddit.com"),
    youtube: base(env.YOUTUBE_BASE_URL, "https://www.youtube.com"),
    hackerNews: base(env.HN_BASE_URL, "https://hn.algolia.com"),
  };
}

/** Comma-separated env list → trimmed, de-duplicated, non-empty entries. */
export function envList(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const item = part.trim();
    if (item.length > 0) seen.add(item);
  }
  return Array.from(seen);
}
