/**
 * Phase 30 §30 — legacy ingestion must not fetch user-supplied URLs with raw
 * `fetch` (no SSRF boundary: literal internal IPs, `localhost`, metadata
 * endpoints, and redirect/DNS-rebinding hops to them).
 *
 * Root cause: `extractRedditThread`, `extractGenericWebpage`, and
 * `POST /api/vault/extract-url` in server/routes.ts fetched arbitrary
 * caller-supplied URLs directly, while the research providers were already
 * migrated to `safeFetch` (server/security/ssrf.ts). Fixed by routing those
 * three sites through `safeFetch`, which enforces the URL syntax gate,
 * connect-time guarded DNS, per-hop redirect revalidation, and byte/time
 * ceilings.
 *
 * Same methodology as the agent denial tests: pure static source analysis.
 * Excluded from the ban (fixed hosts, not caller-controlled destinations):
 * api.github.com / export.arxiv.org (hosts fixed, path segments extracted by
 * regex), the YouTube oembed URL (built from a validated 11-char videoId),
 * operator-configured base URLs (XQUIK_API_BASE_URL), and same-process
 * localhost self-calls for /api/ingest fan-out.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROUTES_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "routes.ts");

describe("legacy ingestion uses the SSRF boundary (Phase 30 §30)", () => {
  it("routes.ts imports safeFetch", () => {
    const text = readFileSync(ROUTES_PATH, "utf8");
    assert.ok(
      /from "\.\/security\/ssrf"|from '\.\/security\/ssrf'/.test(text),
      "server/routes.ts must import the SSRF boundary",
    );
    assert.ok(text.includes("safeFetch"), "server/routes.ts must use safeFetch");
  });

  it("no raw fetch of a caller-supplied URL remains in the extractors", () => {
    const text = readFileSync(ROUTES_PATH, "utf8");
    const offenders: string[] = [];
    // `fetch(<identifier>)` where the identifier holds a caller-supplied URL
    // (extractRedditThread's cleanUrl, extractGenericWebpage's url,
    // /api/vault/extract-url's url). Fixed-host fetches use apiUrl/oembedUrl
    // and are excluded by design (see header comment).
    for (const match of text.matchAll(/await fetch\((cleanUrl|url)\b/g)) {
      offenders.push(match[0]);
    }
    assert.deepEqual(
      offenders,
      [],
      `user-supplied URL fetches must go through safeFetch, found raw fetch: ${offenders.join(", ")}`,
    );
  });
});
