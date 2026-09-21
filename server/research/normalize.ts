/**
 * Shared normalization rules for provider output.
 *
 * Canonical URLs and content hashes must be produced identically by every
 * provider, otherwise dedupe silently fails across sources.
 */

import { createHash } from "node:crypto";

/** Query parameters that never change a document's identity. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^ref$/i,
  /^ref_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^igshid$/i,
  /^_hsenc$/i,
  /^_hsmi$/i,
  /^source$/i,
];

/**
 * Produce a stable canonical URL: lowercase scheme/host, no `www.`, no
 * fragment, no tracking parameters, no empty query, no trailing slash.
 */
export function canonicalizeUrl(rawUrl: string, base?: string): string {
  let url: URL;
  try {
    url = base ? new URL(rawUrl, base) : new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }

  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  const params: string[] = [];
  url.searchParams.forEach((_value, key) => params.push(key));
  for (const key of params) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key);
    }
  }
  // Sort remaining params so ordering differences do not fork identity.
  url.searchParams.sort();

  let out = url.toString();
  if (url.pathname !== "/" && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/**
 * Collapse all whitespace runs (including newlines) so cosmetic formatting
 * differences do not fork a content hash.
 */
export function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Content-addressed identity of a document's normalized text. */
export function computeContentHash(text: string): string {
  return createHash("sha256").update(normalizeText(text), "utf8").digest("hex");
}

/**
 * Stable content identity for a source. Falls back to the canonical URL when
 * there is no body (e.g. a Stage-1 candidate).
 */
export function computeSourceHash(canonicalUrl: string, text?: string): string {
  const basis = text && normalizeText(text).length > 0 ? normalizeText(text) : canonicalUrl;
  return createHash("sha256").update(basis, "utf8").digest("hex");
}

/** Short, human-scannable excerpt for ranking without a Stage-2 fetch. */
export function buildExcerpt(text: string, maxLength = 240): string {
  const collapsed = normalizeText(text).replace(/\s+/g, " ");
  if (collapsed.length <= maxLength) return collapsed;
  const clipped = collapsed.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
