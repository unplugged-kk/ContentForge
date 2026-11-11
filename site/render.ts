import { renderHome } from "./home";
import { renderAgentPages } from "./agent";
import { SITE_CSS } from "./styles";
import { SITE_JS } from "./script";

const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#7c3aed"/><path d="M10 6h13v5h-8v4h7v5h-7v6h-5V6Z" fill="#fff"/></svg>';

/** Every public marketing route, keyed by URL path. */
export function renderSite(): Record<string, { body: string; type: string }> {
  const html = (body: string) => ({ body, type: "text/html; charset=utf-8" });
  return {
    "/": html(renderHome()),
    ...Object.fromEntries(Object.entries(renderAgentPages()).map(([p, b]) => [p, html(b)])),
    "/_site/site.css": { body: SITE_CSS, type: "text/css; charset=utf-8" },
    "/_site/site.js": { body: SITE_JS, type: "text/javascript; charset=utf-8" },
    "/_site/favicon.svg": { body: FAVICON, type: "image/svg+xml" },
  };
}

/** Where each path lands as a static file (index.html per page, assets as-is). */
export function staticFileFor(path: string): string {
  if (path === "/") return "index.html";
  if (path.startsWith("/_site/")) return path.slice(1);
  return `${path.slice(1)}/index.html`;
}
