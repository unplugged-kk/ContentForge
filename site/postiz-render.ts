// Assembles the Postiz marketing-site rebuild into the same shape that
// site/render.ts produces, so script/build.ts can write both sites in one pass.
//
// Five HTML pages plus two shared assets. The stylesheet is inlined in each
// page's <head> (see pzPage), so there is no /_site/postiz.css.

import { PZ_THEMES, postizCss, POSTIZ_JS } from "./postiz-styles";
import { PZ_FAVICON, PZ_MARK_SVG, PZ_MARK_URL, pzPage, type PzRoute } from "./postiz-layout";
import { postizHomeBody, PZ_HOME_FAQ } from "./postiz-home";
import { postizAgentBody, PZ_AGENT_META } from "./postiz-agent";

type SitePage = { body: string; type: string };

const HOME_TITLE = "Postiz: The Agentic Social Media Scheduling Platform";
const HOME_DESCRIPTION =
  "Postiz is the agentic social media scheduling platform. Claude, ChatGPT, Cursor or OpenClaw plan, schedule and publish to 30+ channels from one calendar.";

/** JSON-LD with `<` neutralised so it can never close the script early. */
function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function faqJsonLd(items: { q: string; a: string }[]): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  });
}

function page(
  path: PzRoute,
  title: string,
  description: string,
  body: string,
  key: keyof typeof PZ_THEMES,
  ld?: string,
): SitePage {
  return {
    body: pzPage({
      title,
      description,
      path,
      body,
      css: postizCss(PZ_THEMES[key]),
      jsonLd: ld ?? null,
    }),
    type: "text/html; charset=utf-8",
  };
}

/** Route → theme key. "/claude-cowork" maps to "cowork", so the slug cannot be sliced. */
const THEME_KEY = {
  "/chatgpt": "chatgpt",
  "/dots": "dots",
  "/claude": "claude",
  "/claude-cowork": "cowork",
} as const satisfies Record<string, keyof typeof PZ_THEMES>;

export function renderPostizSite(): Record<string, SitePage> {
  const agentPaths = ["/chatgpt", "/dots", "/claude", "/claude-cowork"] as const;

  const pages: Record<string, SitePage> = {
    "/": page("/", HOME_TITLE, HOME_DESCRIPTION, postizHomeBody(), "home", faqJsonLd(PZ_HOME_FAQ)),
  };

  for (const path of agentPaths) {
    const meta = PZ_AGENT_META[path];
    pages[path] = page(path, meta.title, meta.description, postizAgentBody(path), THEME_KEY[path]);
  }

  pages["/_site/postiz.js"] = { body: POSTIZ_JS, type: "text/javascript; charset=utf-8" };
  pages["/_site/postiz-favicon.svg"] = { body: PZ_FAVICON, type: "image/svg+xml" };
  pages[PZ_MARK_URL] = { body: PZ_MARK_SVG, type: "image/svg+xml" };

  return pages;
}
