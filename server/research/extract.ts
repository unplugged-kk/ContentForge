/**
 * Readable-text extraction for fetched HTML.
 *
 * Used by providers as the Stage-2 step. Kept separate from the older inline
 * extractor in `server/routes.ts` so the new provider layer can own the logic
 * without rewriting that route; the route can adopt this module later.
 *
 * Output is plain text. HTML is never passed to the model raw.
 */

import * as cheerio from "cheerio";

export interface ExtractedPage {
  title: string | null;
  author: string | null;
  description: string | null;
  text: string;
}

const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  ".sidebar",
  ".ad",
  ".advertisement",
  ".cookie-banner",
  "[role='navigation']",
];

const CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".post-content",
  ".entry-content",
  ".article-body",
  ".content",
];

export function extractReadableText(
  html: string,
  options: { maxLength?: number } = {},
): ExtractedPage {
  const maxLength = options.maxLength ?? 20_000;
  const $ = cheerio.load(html);

  const meta = (name: string): string | null =>
    $(`meta[property="${name}"]`).attr("content")?.trim() ||
    $(`meta[name="${name}"]`).attr("content")?.trim() ||
    null;

  const title = meta("og:title") ?? $("title").first().text().trim() ?? null;
  const author = meta("author") ?? meta("article:author") ?? null;
  const description = meta("og:description") ?? meta("description") ?? null;

  for (const selector of STRIP_SELECTORS) $(selector).remove();

  let body = "";
  for (const selector of CONTENT_SELECTORS) {
    const candidate = $(selector).first().text();
    if (candidate && candidate.trim().length > body.length) body = candidate;
  }
  if (body.trim().length === 0) body = $("body").text();

  const text = body
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return { title, author, description, text };
}
