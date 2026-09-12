/**
 * External research smoke test — NON-GATING.
 *
 * Hits the real public provider endpoints (no fixture, no mock) to prove the
 * provider code works against production services. It is deliberately NOT part of
 * `npm test` / the E2E gate: public APIs rate-limit, change, and go down, and a
 * flaky third party must never be able to fail the build.
 *
 * Run:  npm run smoke:research
 * Exit code is 0 unless EVERY provider fails, which would indicate a real bug
 * (e.g. a normalization crash) rather than ordinary upstream flakiness.
 */

import { createHnProvider } from "../server/research/providers/hn.ts";
import { createRedditProvider } from "../server/research/providers/reddit.ts";
import { createWebProvider } from "../server/research/providers/web.ts";

const ctx = (config = {}) => ({
  correlationId: `smoke-${Date.now()}`,
  deadline: new Date(Date.now() + 20_000),
  budget: {},
  config,
  signal: AbortSignal.timeout(20_000),
});

const attempts = [
  ["hn (real Algolia front page)", () => createHnProvider().backends[0].discover(ctx({ tags: ["front_page"], defaultLimit: 5 }))],
  ["reddit (real public search)", () => createRedditProvider().backends[0].search(ctx({ subreddits: [], defaultLimit: 5 }), { text: "kubernetes" })],
  ["web (real example.com)", () => createWebProvider().backends[0].search(ctx({ urls: ["https://example.com/"], defaultLimit: 1 }), { text: "" })],
];

let ok = 0;
for (const [label, run] of attempts) {
  const started = Date.now();
  try {
    const sources = await run();
    ok += 1;
    const sample = sources[0] ? `${sources[0].provider}:${sources[0].ref.nativeId} "${sources[0].title.slice(0, 48)}"` : "(no matches)";
    console.log(`  ✔ ${label} — ${sources.length} source(s) in ${Date.now() - started}ms; ${sample}`);
  } catch (error) {
    console.log(`  ⚠ ${label} — unavailable (non-gating): ${error?.message ?? error}`);
  }
}

console.log(`\nexternal smoke: ${ok}/${attempts.length} provider(s) reachable (non-gating)`);
process.exit(ok === 0 ? 1 : 0);
