import { I, LOGO, AGENT_GLYPH } from "./icons";

export const APP_PATH = "/today";
export const REPO_URL = "https://github.com/unplugged-kk/ContentForge";
export const DOCS_URL = `${REPO_URL}/tree/main/docs`;

export const AGENT_PAGES = [
  { path: "/chatgpt", name: "ChatGPT", note: "Connector + MCP", glyph: "chatgpt", bg: "#3f9f87" },
  { path: "/dots", name: "OpenAI dots", note: "Always-on agent", glyph: "dots", bg: "#6d3ef0" },
  { path: "/claude", name: "Claude", note: "Connector + MCP", glyph: "claude", bg: "#d4774d" },
  { path: "/claude-cowork", name: "Claude Cowork", note: "Desktop agent", glyph: "cowork", bg: "#b85a2e" },
] as const;

export const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const agentLink = (a: (typeof AGENT_PAGES)[number]) =>
  `<a href="${a.path}" aria-label="${a.name}"><span class="ch" style="background:${a.bg}">${AGENT_GLYPH[a.glyph]}</span><span>${a.name}<small>${a.note}</small></span></a>`;

export function header(): string {
  return `<header class="site-header">
  <div class="wrap">
    <a class="logo" href="/" aria-label="ContentForge home">${LOGO}<span>contentforge</span></a>
    <nav class="main-nav" aria-label="Main">
      <details class="menu"><summary>AI Agents ${I.chevron}</summary>
        <div class="menu-panel">${AGENT_PAGES.map(agentLink).join("")}</div>
      </details>
      <a href="${DOCS_URL}">Dev Docs</a>
      <details class="menu"><summary>Product ${I.chevron}</summary>
        <div class="menu-panel">
          <a href="/#intelligence" aria-label="Intelligence"><span>Intelligence<small>Trends, research, opportunities</small></span></a>
          <a href="/#creation" aria-label="Creation"><span>Creation<small>Posts, threads, scripts, carousels</small></span></a>
          <a href="/#repurposing" aria-label="Repurposing"><span>Repurposing<small>One story, every platform</small></span></a>
          <a href="/#distribution" aria-label="Distribution"><span>Distribution<small>Approve, schedule, publish, measure</small></span></a>
        </div>
      </details>
      <a href="/#lifecycle">Lifecycle</a>
      <a href="/#faq">FAQ</a>
      <a href="${REPO_URL}">GitHub</a>
    </nav>
    <div class="header-cta">
      <a class="btn btn-ghost" href="${APP_PATH}">Log In</a>
      <a class="btn btn-light" href="${APP_PATH}">Start for $0 ${I.arrows}</a>
    </div>
    <button class="burger" type="button" data-burger aria-expanded="false" aria-controls="mobile-nav" aria-label="Open menu">${I.burger}</button>
  </div>
  <nav class="mobile-nav" id="mobile-nav" data-mobile-nav hidden aria-label="Mobile">
    ${AGENT_PAGES.map((a) => `<a href="${a.path}" aria-label="${a.name}">${a.name}</a>`).join("")}
    <a href="/#lifecycle" aria-label="Lifecycle">Lifecycle</a>
    <a href="/#faq" aria-label="FAQ">FAQ</a>
    <a href="${DOCS_URL}" aria-label="Dev Docs">Dev Docs</a>
    <a href="${REPO_URL}" aria-label="GitHub">GitHub</a>
    <a class="btn btn-ghost" href="${APP_PATH}" aria-label="Log In">Log In</a>
    <a class="btn btn-light" href="${APP_PATH}" aria-label="Start for $0">Start for $0 ${I.arrows}</a>
  </nav>
</header>`;
}

export function footer(cta = true): string {
  return `<footer class="site-footer">
  <div class="fwrap">
    ${cta ? `<div class="foot-cta">
      <h3 class="head">Ready to get started?</h3>
      <p>Research once, create many formats, publish everywhere and learn what works.</p>
      <a class="btn btn-light" href="${APP_PATH}">Start for $0 ${I.arrows}</a>
    </div>
    <div class="foot-art" aria-hidden="true"><b>Research</b> <span>to</span> <b>Story</b> <span>to</span> <b>Artifact</b> <span>to</span> <b>Approval</b> <span>to</span> <b>Schedule</b> <span>to</span> <b>Result</b></div>` : ""}
    <div class="foot-grid">
      <div class="foot-brand">
        <a class="logo" href="/">${LOGO}<span>contentforge</span></a>
        <p>AI-native content intelligence and growth operating system (self-hosted).</p>
        <div class="socials"><a href="${REPO_URL}" aria-label="ContentForge on GitHub">${I.github}</a><a href="${DOCS_URL}" aria-label="Documentation">${I.book}</a></div>
      </div>
      <div><h4>Product</h4><ul>
        <li><a href="/#intelligence">Intelligence</a></li><li><a href="/#creation">Creation</a></li>
        <li><a href="/#repurposing">Repurposing</a></li><li><a href="/#distribution">Distribution</a></li>
      </ul></div>
      <div><h4>AI Agents</h4><ul>${AGENT_PAGES.map((a) => `<li><a href="${a.path}">${a.name}</a></li>`).join("")}</ul></div>
      <div><h4>Resources</h4><ul>
        <li><a href="${DOCS_URL}">Docs</a></li><li><a href="${REPO_URL}">GitHub</a></li>
        <li><a href="${REPO_URL}/blob/main/CURRENT_ARCHITECTURE.md">Architecture</a></li>
        <li><a href="${APP_PATH}">Open the app</a></li>
      </ul></div>
    </div>
    <div class="copyright"><span>© ContentForge, ${new Date().getFullYear()}. All rights reserved.</span><span>Research is the durable asset.</span></div>
  </div>
</footer>`;
}

export function page(opts: { title: string; description: string; path: string; body: string; footerCta?: boolean }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta name="theme-color" content="#0e0e0e">
<link rel="icon" href="/_site/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,100..1000&family=Plus+Jakarta+Sans:wght@200..800&display=swap">
<link rel="stylesheet" href="/_site/site.css">
<script src="/_site/site.js" defer></script>
</head>
<body>
<a class="sr-only" href="#main">Skip to content</a>
${header()}
<main id="main"><div class="mx">
${opts.body}
</div></main>
${footer(opts.footerCta ?? true)}
</body>
</html>`;
}
