/**
 * SSRF boundary for outbound research fetches.
 *
 * Arbitrary-URL research must never reach private, loopback, link-local, or
 * cloud-metadata addresses — including through redirects or DNS rebinding.
 *
 * Defence in depth:
 *   1. URL syntax gate (scheme, credentials, port) before any network call.
 *   2. A guarded DNS `lookup` that validates every resolved address *at connect
 *      time*, which closes the rebinding window between check and use.
 *   3. Manual redirect handling that re-validates each hop.
 *   4. Byte and time ceilings so a hostile response cannot exhaust the worker.
 *
 * No provider may fetch a user-supplied URL without going through this module.
 */

import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";

export class UnsafeUrlError extends Error {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? `Blocked outbound URL (${reason})`);
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }
}

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response exceeded the ${maxBytes} byte limit`);
    this.name = "ResponseTooLargeError";
  }
}

/** RFC1918 / loopback / link-local / CGNAT / documentation / multicast / reserved. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_V6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const DEFAULT_ALLOWED_PORTS: readonly number[] = [80, 443];
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function ipv6ToBytes(ip: string): number[] | null {
  let input = ip;
  // IPv4-mapped / IPv4-embedded (::ffff:1.2.3.4, ::1.2.3.4).
  const lastColon = input.lastIndexOf(":");
  const tail = input.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToBytes(tail);
    if (!v4) return null;
    input = `${input.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${(
      (v4[2] << 8) |
      v4[3]
    ).toString(16)}`;
  }

  const halves = input.split("::");
  if (halves.length > 2) return null;

  const toWords = (segment: string): number[] | null => {
    if (segment === "") return [];
    const words: number[] = [];
    for (const group of segment.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      words.push(parseInt(group, 16));
    }
    return words;
  };

  let words: number[];
  if (halves.length === 2) {
    const head = toWords(halves[0]);
    const tailWords = toWords(halves[1]);
    if (!head || !tailWords) return null;
    const missing = 8 - head.length - tailWords.length;
    if (missing < 0) return null;
    words = [...head, ...new Array(missing).fill(0), ...tailWords];
  } else {
    const all = toWords(input);
    if (!all) return null;
    words = all;
  }
  if (words.length !== 8) return null;

  const bytes: number[] = [];
  for (const word of words) bytes.push((word >> 8) & 0xff, word & 0xff);
  return bytes;
}

function matchesCidr(bytes: number[], network: string, prefix: number): boolean {
  const networkBytes = network.includes(":") ? ipv6ToBytes(network) : ipv4ToBytes(network);
  if (!networkBytes || bytes.length !== networkBytes.length) return false;
  let bitsLeft = prefix;
  for (let i = 0; i < networkBytes.length && bitsLeft > 0; i++) {
    const take = Math.min(8, bitsLeft);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (networkBytes[i] & mask)) return false;
    bitsLeft -= take;
  }
  return true;
}

/** True when an IP literal must never be contacted by a research provider. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const bytes = ipv4ToBytes(ip);
    if (!bytes) return true;
    return BLOCKED_V4.some(([net, prefix]) => matchesCidr(bytes, net, prefix));
  }
  if (family === 6) {
    const bytes = ipv6ToBytes(ip);
    if (!bytes) return true;
    // IPv4-mapped ::ffff:a.b.c.d — validate the embedded v4 address.
    const isMapped =
      bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
    if (isMapped) {
      return isBlockedAddress(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
    }
    return BLOCKED_V6.some(([net, prefix]) => matchesCidr(bytes, net, prefix));
  }
  // Not an IP literal — never trust it as an address.
  return true;
}

export interface UrlValidationOptions {
  allowedPorts?: readonly number[];
}

/** Syntax gate applied before any network activity. */
export function validateUrlSyntax(
  raw: string,
  options: UrlValidationOptions = {},
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("invalid_url", `Not a valid absolute URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(
      "unsupported_protocol",
      `Only http and https are allowed (got ${url.protocol})`,
    );
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("credentials_in_url", "URLs with embedded credentials are rejected");
  }

  const allowedPorts = options.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!allowedPorts.includes(port)) {
    throw new UnsafeUrlError("disallowed_port", `Port ${port} is not allowed`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) {
    throw new UnsafeUrlError("blocked_address", `Address ${host} is not routable for research`);
  }

  return url;
}

export type LookupFn = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (err: Error | null, address?: unknown, family?: number) => void,
) => void;

/**
 * DNS lookup that rejects any hostname resolving to a blocked address.
 * Passed to the HTTP agent so validation happens at connect time.
 */
export function createGuardedLookup(): LookupFn {
  return (hostname, options, callback) => {
    dnsLookup(
      hostname,
      { all: true, verbatim: true },
      (err: NodeJS.ErrnoException | null, addresses?: { address: string; family: number }[]) => {
        if (err) return callback(err);
        const resolved = addresses ?? [];
        if (resolved.length === 0) {
          return callback(new UnsafeUrlError("dns_no_records", `No addresses for ${hostname}`));
        }
        const blocked = resolved.filter((a) => isBlockedAddress(a.address));
        if (blocked.length > 0) {
          return callback(
            new UnsafeUrlError(
              "blocked_address",
              `Host ${hostname} resolved to a non-routable address (${blocked
                .map((b) => b.address)
                .join(", ")})`,
            ),
          );
        }
        if (options?.all) {
          return callback(null, resolved);
        }
        return callback(null, resolved[0].address, resolved[0].family);
      },
    );
  };
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedPorts?: readonly number[];
  headers?: Record<string, string>;
  /** Injection point for tests; defaults to the SSRF-guarded resolver. */
  lookup?: LookupFn;
}

export interface SafeFetchResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  finalUrl: string;
  truncated: boolean;
}

function requestOnce(
  url: URL,
  options: SafeFetchOptions,
  lookup: LookupFn,
  timeoutMs: number,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string; truncated: boolean; location?: string }> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          "user-agent": "ContentForge-Research/1.0",
          accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.5",
          "accept-encoding": "identity",
          ...(options.headers ?? {}),
        },
        lookup: lookup as never,
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;

        if (status >= 300 && status < 400 && location) {
          res.resume();
          finish(() => resolve({ status, headers: res.headers, body: "", truncated: false, location }));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;

        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            truncated = true;
            res.destroy();
            finish(() =>
              resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated: true }),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          finish(() =>
            resolve({
              status,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
              truncated,
            }),
          ),
        );
        res.on("error", (error) => finish(() => reject(error)));
      },
    );

    req.on("timeout", () => {
      req.destroy(new UnsafeUrlError("timeout", `Request timed out after ${timeoutMs}ms`));
    });
    req.on("error", (error) => finish(() => reject(error)));
    req.end();
  });
}

/**
 * Fetch a URL with SSRF protection. Every hop is syntax-checked, and the
 * connect-time lookup rejects non-routable addresses resolved at that moment.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const lookup = options.lookup ?? createGuardedLookup();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const deadline = Date.now() + timeoutMs;

  let current = validateUrlSyntax(rawUrl, options);
  let redirects = 0;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new UnsafeUrlError("timeout", "Request deadline exceeded");

    const response = await requestOnce(current, options, lookup, remaining);

    if (response.location) {
      if (redirects >= maxRedirects) {
        throw new UnsafeUrlError("too_many_redirects", `Exceeded ${maxRedirects} redirects`);
      }
      redirects += 1;
      let next: URL;
      try {
        next = new URL(response.location, current);
      } catch {
        throw new UnsafeUrlError("invalid_redirect", "Redirect target is not a valid URL");
      }
      current = validateUrlSyntax(next.toString(), options);
      continue;
    }

    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
      finalUrl: current.toString(),
      truncated: response.truncated,
    };
  }
}
