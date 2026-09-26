export interface LegacyRouteMapping {
  path: string;
  params?: Readonly<Record<string, string>>;
}

/**
 * The complete compatibility map for legacy URLs. A legacy URL is redirected
 * only when its canonical destination is an exact product destination. The
 * YouTube route is intentionally absent: its canonical home is still a product
 * decision, so it remains a live legacy capability until that decision is made.
 */
export const LEGACY_ROUTE_MAPPINGS: Readonly<Record<string, LegacyRouteMapping>> = {
  "/generate": { path: "/create" },
  "/queue": { path: "/schedule", params: { tab: "queue" } },
  "/calendar": { path: "/schedule", params: { tab: "calendar" } },
  "/analytics": { path: "/insights", params: { view: "performance" } },
  "/ai-usage": { path: "/insights", params: { view: "ai-usage" } },
  "/discover": { path: "/sources", params: { view: "discover" } },
  "/ingest": { path: "/sources", params: { view: "ingest" } },
  "/ideas": { path: "/sources", params: { view: "ideas" } },
  "/vault": { path: "/sources", params: { view: "vault" } },
  "/references": { path: "/sources", params: { view: "references" } },
  "/hooks": { path: "/create", params: { mode: "hooks" } },
  "/carousel": { path: "/create", params: { mode: "carousel" } },
  "/images": { path: "/create", params: { mode: "images" } },
  "/articles": { path: "/create", params: { mode: "articles" } },
  "/templates": { path: "/create", params: { mode: "templates" } },
  "/formatter": { path: "/create", params: { mode: "formatter" } },
  "/canned-responses": { path: "/create", params: { mode: "canned-responses" } },
  "/chat": { path: "/create", params: { mode: "chat-post" } },
};

function queryPart(search: string): string {
  const withoutHash = search.split("#", 1)[0] ?? "";
  return withoutHash.startsWith("?") ? withoutHash.slice(1) : withoutHash;
}

function hashPart(hash: string, search: string): string {
  if (hash) return hash.startsWith("#") ? hash : `#${hash}`;
  const embedded = search.indexOf("#");
  return embedded >= 0 ? search.slice(embedded) : "";
}

function withQuery(path: string, params: URLSearchParams, hash: string): string {
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
}

/** Build a canonical replacement for a legacy route without dropping deep-link state. */
export function getLegacyRouteTarget(
  legacyPath: string,
  search = "",
  hash = "",
): string | null {
  const mapping = LEGACY_ROUTE_MAPPINGS[legacyPath];
  if (!mapping) return null;

  const params = new URLSearchParams(queryPart(search));
  for (const [key, value] of Object.entries(mapping.params ?? {})) {
    params.set(key, value);
  }

  return withQuery(mapping.path, params, hashPart(hash, search));
}

/** Change Create's mode while preserving unrelated story/idea/query context. */
export function getCreateModeHref(mode: string, search = ""): string {
  const params = new URLSearchParams(queryPart(search));
  params.delete("artifact");
  params.delete("artifactId");
  params.delete("empty");
  params.delete("mode");

  if (mode !== "post-thread") params.set("mode", mode);

  return withQuery("/create", params, "");
}
