/**
 * Deterministic RSS fixture for live E2E verification.
 *
 * Runs inside a Docker container publishing host port 80, so the real
 * ContentForge RSS provider fetches it over real HTTP on the only port the SSRF
 * syntax gate permits for `http:` (80). The fixture content is fixed — the
 * primary E2E never depends on an external site.
 *
 * Endpoints:
 *   GET /health           liveness probe
 *   GET /feed.xml         deterministic feed with 3 well-known items
 *   GET /empty.xml        valid feed with zero items (no usable research)
 *   GET /flaky.xml        fails on the FIRST request only, then serves /feed.xml
 *   GET /flaky-long.xml   FIRST request returns an item whose native id exceeds the
 *                         research_sources.native_id column, making persistence fail
 *                         (a genuine transient/DB-class failure); later requests
 *                         serve /feed.xml so the pg-boss retry can succeed
 *   GET /slow.xml?delay=N delays N ms (default 8000) before serving /feed.xml
 *   GET /reset            resets fixture counters
 *   GET /stats            fixture counters as JSON
 *
 * This file is TEST INFRASTRUCTURE. It is never imported by the application.
 */

import http from "node:http";

const PORT = Number(process.env.FIXTURE_PORT ?? 80);
const RUN = process.env.FIXTURE_RUN ?? "e2e";
const ORIGIN = `https://fixture.contentforge.test/${RUN}`;

const ITEMS = [
  {
    title: "Kubernetes scheduler plugins reach general availability",
    link: `${ORIGIN}/kubernetes-scheduler-plugins`,
    guid: `${RUN}-k8s-scheduler`,
    date: "2026-09-01T00:00:00.000Z",
    snippet:
      "Kubernetes scheduler plugins are now a stable extension point for custom placement decisions across large clusters.",
  },
  {
    title: "Operating Kubernetes control planes at scale",
    link: `${ORIGIN}/kubernetes-control-plane`,
    guid: `${RUN}-k8s-control-plane`,
    date: "2026-09-02T00:00:00.000Z",
    snippet:
      "Kubernetes control plane capacity planning and API server latency under sustained load.",
  },
  {
    title: "Cost signals for Kubernetes workloads",
    link: `${ORIGIN}/kubernetes-cost`,
    guid: `${RUN}-k8s-cost`,
    date: "2026-09-03T00:00:00.000Z",
    snippet:
      "Measuring the real cost of Kubernetes workloads with request-to-limit ratios and bin packing.",
  },
];

function feedXml() {
  const items = ITEMS.map(
    (item) => `
    <item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <guid isPermaLink="false">${item.guid}</guid>
      <pubDate>${new Date(item.date).toUTCString()}</pubDate>
      <description>${item.snippet}</description>
    </item>`,
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ContentForge Deterministic Fixture ${RUN}</title>
    <link>${ORIGIN}</link>
    <description>Deterministic RSS fixture for ContentForge live E2E</description>
    <lastBuildDate>${new Date("2026-09-03T00:00:00.000Z").toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;
}

function emptyFeedXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ContentForge Empty Fixture ${RUN}</title>
    <link>${ORIGIN}/empty</link>
    <description>Valid feed with no items</description>
  </channel>
</rss>`;
}

let flakyHits = 0;
let flakyLongHits = 0;
let requests = 0;
let tweetCounter = 0;

/** Read a JSON request body (bounded). */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Deterministic OpenAI-compatible completion, so the REAL model gateway
 * (`server/ai` + `aiCall`) is exercised end to end without calling a provider.
 * Returns the payload shape the format's registry schema expects.
 */
function completionBody(format) {
  const content =
    format === "x_thread"
      ? JSON.stringify({ units: ["Kubernetes scheduling is now a policy surface.", "Platform teams can own placement."] })
      : JSON.stringify({ text: "Kubernetes scheduling is now a policy surface, not a hardcoded heuristic." });
  return {
    id: "chatcmpl-fixture",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "fixture-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

/**
 * POST handlers double the EXTERNAL services only:
 *   POST /v1/chat/completions  → the model provider (AI_BASE_URL)
 *   POST /x/tweets             → xQuick (XQUICK_API_BASE_URL)
 * ContentForge's own code paths (gateway, adapter, workers) run for real.
 */
async function handlePost(req, res, url) {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname.endsWith("/chat/completions")) {
    const body = await readBody(req);
    const prompt = JSON.stringify(body.messages ?? []);
    return send(200, completionBody(prompt.includes("x_thread") ? "x_thread" : "x_post"));
  }

  if (url.pathname.startsWith("/x/")) {
    await readBody(req);
    tweetCounter += 1;
    const id = `tweet-${tweetCounter}`;
    return send(200, { id, tweetId: id, url: `https://x.com/cf_e2e/status/${id}`, username: "cf_e2e", status: "ok" });
  }

  return send(404, { error: "not found" });
}

/**
 * One item whose native id (guid) exceeds `research_sources.native_id`
 * varchar(500). The provider collects it happily; persistence fails, which the
 * engine classifies as a transient failure and pg-boss retries.
 */
function overlongFeedXml() {
  const guid = "o".repeat(600);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ContentForge Overlong Fixture ${RUN}</title>
    <link>${ORIGIN}/overlong</link>
    <description>Single item with an over-long native id</description>
    <item>
      <title>Kubernetes overlong native id probe</title>
      <link>${ORIGIN}/overlong-item</link>
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${new Date("2026-09-03T00:00:00.000Z").toUTCString()}</pubDate>
      <description>Kubernetes item whose native id exceeds the persistence column, so the write fails.</description>
    </item>
  </channel>
</rss>`;
}

const server = http.createServer(async (req, res) => {
  requests += 1;
  const url = new URL(req.url, "http://localhost");

  if (req.method === "POST") return handlePost(req, res, url);

  const send = (status, body, type = "application/rss+xml; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };

  switch (url.pathname) {
    case "/health":
      return send(200, "ok", "text/plain");
    case "/feed.xml":
      return send(200, feedXml());
    case "/empty.xml":
      return send(200, emptyFeedXml());
    case "/flaky.xml": {
      flakyHits += 1;
      if (flakyHits === 1) {
        return send(500, "fixture: deliberate first-request failure", "text/plain");
      }
      return send(200, feedXml());
    }
    case "/flaky-long.xml": {
      flakyLongHits += 1;
      if (flakyLongHits === 1) return send(200, overlongFeedXml());
      return send(200, feedXml());
    }
    case "/slow.xml": {
      const delay = Number(url.searchParams.get("delay") ?? 8000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return send(200, feedXml());
    }
    case "/reset":
      flakyHits = 0;
      flakyLongHits = 0;
      return send(200, "reset", "text/plain");
    case "/stats":
      return send(200, JSON.stringify({ flakyHits, flakyLongHits, requests }), "application/json");
    default:
      return send(404, "not found", "text/plain");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`rss fixture listening on 0.0.0.0:${PORT} (run=${RUN})`);
});
