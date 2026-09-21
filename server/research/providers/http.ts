/**
 * Shared outbound HTTP seam for research providers.
 *
 * Every provider fetch goes through `safeFetch` (the centralized SSRF boundary):
 * connect-time DNS validation, per-hop redirect revalidation, byte and time
 * ceilings. This module adds the two guards the SSRF layer deliberately does not
 * own — a URL-length ceiling and a response content-type allowlist — and keeps
 * the network injectable so providers are unit-testable without real egress.
 */

import { resolveAllowedHosts, safeFetch, UnsafeUrlError } from "../../security/ssrf";

export const DEFAULT_URL_MAX_LENGTH = 2000;
/** Providers may only read textual representations; never binaries. */
export const DEFAULT_ALLOWED_CONTENT_TYPES = [
  "application/json",
  "application/atom+xml",
  "application/rss+xml",
  "application/xml",
  "text/xml",
  "text/html",
  "text/plain",
] as const;

export class UrlTooLongError extends Error {
  constructor(length: number, max: number) {
    super(`URL length ${length} exceeds the ${max} character limit`);
    this.name = "UrlTooLongError";
  }
}

export class DisallowedContentTypeError extends Error {
  constructor(
    readonly contentType: string | null,
    readonly allowed: readonly string[],
  ) {
    super(`Response content-type "${contentType ?? "(none)"}" is not allowed`);
    this.name = "DisallowedContentTypeError";
  }
}

export interface ProviderHttpRequest {
  url: string;
  timeoutMs: number;
  maxBytes?: number;
  allowedContentTypes?: readonly string[];
  headers?: Record<string, string>;
}

export interface ProviderHttpResponse {
  status: number;
  body: string;
  contentType: string | null;
  finalUrl: string;
  truncated: boolean;
}

export interface ProviderHttpDeps {
  fetchText(request: ProviderHttpRequest): Promise<ProviderHttpResponse>;
}

/** Parse a content-type header, dropping parameters (`; charset=…`). */
export function normalizeContentType(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const base = header.split(";")[0]?.trim().toLowerCase();
  return base && base.length > 0 ? base : null;
}

export function assertAllowedContentType(
  contentType: string | null,
  allowed: readonly string[],
): void {
  if (contentType === null) return; // servers may omit it; body is still bounded
  if (!allowed.includes(contentType)) {
    throw new DisallowedContentTypeError(contentType, allowed);
  }
}

export function assertUrlLength(url: string, max = DEFAULT_URL_MAX_LENGTH): void {
  if (url.length > max) throw new UrlTooLongError(url.length, max);
}

/**
 * Real deps: SSRF-guarded fetch with the shared guards applied.
 *
 * Note there is intentionally no decompression: `safeFetch` sends
 * `accept-encoding: identity`, so a decompression bomb cannot be delivered, and
 * the byte ceiling is enforced on the raw stream.
 */
export function createSafeFetchDeps(): ProviderHttpDeps {
  return {
    async fetchText(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
      assertUrlLength(request.url);
      const allowed = request.allowedContentTypes ?? [...DEFAULT_ALLOWED_CONTENT_TYPES];
      const response = await safeFetch(request.url, {
        timeoutMs: request.timeoutMs,
        ...(request.maxBytes !== undefined ? { maxBytes: request.maxBytes } : {}),
        ...(request.headers ? { headers: request.headers } : {}),
        // Default-off operator allowlist (RESEARCH_ALLOWED_HOSTS). Everything
        // else stays blocked by the SSRF boundary.
        allowedHosts: resolveAllowedHosts(),
      });
      const contentType = normalizeContentType(response.headers["content-type"]);
      assertAllowedContentType(contentType, allowed);
      return {
        status: response.status,
        body: response.body,
        contentType,
        finalUrl: response.finalUrl,
        truncated: response.truncated,
      };
    },
  };
}

export { UnsafeUrlError };
