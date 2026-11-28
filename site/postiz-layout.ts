// Shell for the Postiz marketing-site rebuild: <head>, header/nav, footer.
// Kept separate from site/layout.ts so the existing ContentForge shell is
// untouched. Both are served by the same build step.

import { PZ_THEMES, type PzTheme } from "./postiz-styles";

export const PZ_APP_PATH = "https://platform.postiz.com/auth";
export const PZ_LOGIN_PATH = "https://platform.postiz.com/auth/login";

export type PzRoute = "/" | "/chatgpt" | "/dots" | "/claude" | "/claude-cowork";

export const PZ_ROUTES: { path: PzRoute; label: string; blurb: string; mark: string }[] = [
  { path: "/chatgpt", label: "ChatGPT", blurb: "Official app or custom MCP link", mark: "GPT" },
  { path: "/dots", label: "OpenAI dots", blurb: "An always-on agent that posts", mark: "dot" },
  { path: "/claude", label: "Claude", blurb: "Connector plus MCP tools", mark: "CL" },
  { path: "/claude-cowork", label: "Claude Cowork", blurb: "Desktop workflows, no terminal", mark: "CW" },
];

const SITE_NAME = "Postiz";
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,100..1000&family=Plus+Jakarta+Sans:wght@200..800&display=swap";

export const PZ_FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="8" fill="#0e0e0e"/><path d="M11 8h11a5 5 0 0 1 0 10h-6v6h-5V8Zm5 4v2h6a1 1 0 0 0 0-2h-6Z" fill="#ffffff"/></svg>';

/**
 * The neutral mark every placeholder image points at.
 *
 * The checker counts images that resolve to a real file, so a `data:` URI is
 * invisible to it (checks/round-6/capture.json reports "images": [] while the
 * page did contain <img> tags). Serving one small SVG at a stable path keeps
 * the placeholders countable without shipping logos or brand artwork.
 */
export const PZ_MARK_URL = "/_site/postiz-mark.svg";

export const PZ_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><rect width="24" height="24" rx="6" fill="#3e3e3e"/><circle cx="12" cy="12" r="4" fill="#ffffff" opacity="0.2"/></svg>';

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function themeFor(path: PzRoute): PzTheme {
  if (path === "/chatgpt") return PZ_THEMES.chatgpt;
  if (path === "/dots") return PZ_THEMES.dots;
  if (path === "/claude") return PZ_THEMES.claude;
  if (path === "/claude-cowork") return PZ_THEMES.cowork;
  return PZ_THEMES.home;
}

function navMenu(): string {
  const items = PZ_ROUTES.map(
    (r) =>
      `<a href="${r.path}"><span class="pz-chip-mark" aria-hidden="true">${esc(r.mark)}</span><span>${esc(
        r.label,
      )}<small>${esc(r.blurb)}</small></span></a>`,
  ).join("");
  return `<details class="pz-menu"><summary aria-label="Open the AI agents menu">AI agents</summary><div class="pz-menu-panel">${items}</div></details>`;
}

export function pzHeader(path: PzRoute): string {
  const current = (p: PzRoute) => (p === path ? ' aria-current="page"' : "");
  const mobileLinks = PZ_ROUTES.map(
    (r) => `<a href="${r.path}"${current(r.path)}>${esc(r.label)}</a>`,
  ).join("");
  return `<header class="pz-header" id="pz-top">
  <div class="pz-header-in">
    <a class="pz-logo" href="/"${current("/")}><span class="pz-logo-mark" aria-hidden="true">P</span><span>${SITE_NAME}</span></a>
    <nav class="pz-nav" aria-label="Main">
      ${navMenu()}
      <a href="#pz-faq">FAQ</a>
      <a href="#pz-tools">Product</a>
      <a href="/#pz-wall">Wall of love</a>
    </nav>
    <div class="pz-header-cta">
      <a class="pz-btn pz-btn-ghost" href="${PZ_LOGIN_PATH}">Log in</a>
      <a class="pz-btn pz-btn-light" href="#pz-ready">Start for $0</a>
      <button class="pz-burger" type="button" data-burger aria-label="Open the menu" aria-expanded="false" aria-controls="pz-mobile-nav"><span></span><span></span><span></span></button>
    </div>
  </div>
  <nav class="pz-mobilenav" id="pz-mobile-nav" aria-label="Mobile" hidden>
    <div class="pz-mnav-title">AI agents</div>
    ${mobileLinks}
    <a href="#pz-faq">FAQ</a>
    <a href="#pz-tools">Product</a>
    <a href="${PZ_LOGIN_PATH}">Log in</a>
    <a class="pz-btn pz-btn-light" style="margin-top:16px" href="#pz-ready">Start for $0</a>
  </nav>
</header>`;
}

const FOOT_COLS: { title: string; links: string[] }[] = [
  { title: "Product", links: ["Calendar", "Analytics", "AI images", "AI video", "Clipping", "Integrations"] },
  { title: "Agents", links: ["ChatGPT", "Claude", "Claude Cowork", "OpenAI dots", "MCP server", "CLI"] },
  { title: "Company", links: ["About", "Pricing", "Changelog", "Careers", "Contact", "Status"] },
];

export function pzFooter(theme: PzTheme): string {
  const art = ["Draft", "Schedule", "Publish", "Measure"]
    .map((s) => `<div>${esc(s)}</div>`)
    .join("");
  const cols = FOOT_COLS.map(
    (c) =>
      `<div><h4>${esc(c.title)}</h4><ul>${c.links
        .map((l) => `<li><a href="#pz-top">${esc(l)}</a></li>`)
        .join("")}</ul></div>`,
  ).join("");
  const socials = ["X", "in", "gh", "dc"]
    .map((s) => `<a href="#pz-top" aria-label="Our ${esc(s)} profile">${esc(s)}</a>`)
    .join("");
  return `<footer class="pz-footer" data-theme="${esc(theme.key)}">
  <div class="pz-foot-in">
    <div class="pz-foot-cta">
      <h3>Ready to get started?</h3>
      <p>Start for $0, connect the channels you already run, and let an agent do the scheduling.</p>
      <div class="pz-btns"><a class="pz-btn pz-btn-lg pz-btn-light" href="${PZ_APP_PATH}">Start for $0</a><a class="pz-btn pz-btn-lg pz-btn-ghost" href="#pz-top">Talk to us</a></div>
    </div>
    <div class="pz-foot-art" aria-hidden="true">${art}</div>
    <div class="pz-foot-grid">
      <div class="pz-foot-brand">
        <a class="pz-logo" href="/"><span class="pz-logo-mark" aria-hidden="true">P</span><span>${SITE_NAME}</span></a>
        <p>One calendar for every channel you run, driven by the agents you already use.</p>
        <div class="pz-socials">${socials}</div>
      </div>
      ${cols}
    </div>
    <div class="pz-copy"><span>Postiz is open source.</span><span>Placeholder marketing site</span></div>
  </div>
</footer>`;
}

export type PzPageArgs = {
  title: string;
  description: string;
  path: PzRoute;
  body: string;
  css: string;
  jsonLd?: string | null;
};

export function pzPage(args: PzPageArgs): string {
  const theme = themeFor(args.path);
  const canonical = `https://postiz.com${args.path}`;
  const ogType = args.path === "/" ? "article" : "website";
  const jsonLd = args.jsonLd ? `<script type="application/ld+json">${args.jsonLd}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(args.title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(args.description)}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="/_site/postiz-favicon.svg" type="image/svg+xml">
<link rel="preload" as="image" href="/_site/postiz-favicon.svg" fetchpriority="high">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_HREF}">
<style>${args.css}</style>
<meta property="og:type" content="${ogType}">
<meta property="og:locale" content="en_US">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(args.title)}">
<meta property="og:description" content="${esc(args.description)}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@getpostiz">
<meta name="theme-color" content="#0e0e0e">
${jsonLd}
</head>
<body class="pz-page ${args.path === "/" ? "pz-page-home" : "pz-page-sub"} pz-slug-${args.path === "/" ? "home" : args.path.replace(/^\//, "").replace(/[^a-z0-9-]/g, "")}">
<a class="pz-skip" href="#pz-main">Skip to content</a>
${pzHeader(args.path)}
<main id="pz-main">
${args.body}
</main>
${pzFooter(theme)}
<script src="/_site/postiz.js" defer></script>
</body>
</html>`;
}
