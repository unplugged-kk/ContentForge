import http from "node:http";
import pg from "pg";
import { test, expect } from "@playwright/test";

const FEED_PORT = 8088;
const STORY_URL = "https://example.com/contentforge-ui-intake";

let marker = "ui-intake";

function feedXml() {
  const published = new Date().toUTCString();
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>e2e</title><item><title>${marker}</title><link>${STORY_URL}</link><guid isPermaLink="false">${marker}</guid><pubDate>${published}</pubDate><description>${marker} persisted research source from Discover intake.</description></item></channel></rss>`;
}

function startFeed() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/rss+xml" });
    res.end(feedXml());
  });
  return new Promise<http.Server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(FEED_PORT, "127.0.0.1", () => resolve(server));
  });
}

test("Discover intake persists a research source and shows the job in history", async ({ page }) => {
  test.setTimeout(120_000);
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "DATABASE_URL").toBeTruthy();

  const feed = await startFeed();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("delete from rss_sources where name = $1", ["e2e-ui-intake"]);
  const inserted = await client.query(
    "insert into rss_sources (name, feed_url, is_active) values ($1, $2, true) returning id",
    ["e2e-ui-intake", `http://localhost:${FEED_PORT}/feed.xml`],
  );
  const feedId = inserted.rows[0].id as number;

  try {
    marker = `ui-intake-${Date.now()}`;
    await page.goto("/sources");
    await page.getByTestId("input-research-query").fill(marker);
    await page.getByTestId("button-start-research").click();

    let jobId = 0;
    await expect(async () => {
      const res = await page.request.get("/api/research/jobs?limit=50");
      expect(res.ok(), await res.text()).toBeTruthy();
      const jobs = await res.json();
      const hit = jobs.find((job: { id: number; query?: string }) => job.query === marker);
      expect(hit).toBeTruthy();
      jobId = hit.id;
    }).toPass({ timeout: 20_000 });

    const deadline = Date.now() + 90_000;
    let matched = false;
    let terminal = "";
    while (Date.now() < deadline) {
      const sourcesRes = await page.request.get(`/api/research/jobs/${jobId}/sources`);
      expect(sourcesRes.ok()).toBeTruthy();
      const rows = await sourcesRes.json();
      matched = rows.some((row: { canonicalUrl?: string }) => row.canonicalUrl === STORY_URL);
      if (matched) break;
      const jobRes = await page.request.get(`/api/research/jobs/${jobId}`);
      const job = await jobRes.json();
      if (job.status === "complete" || job.status === "failed") {
        terminal = `${job.status} ${job.errorMessage ?? ""}`.trim();
        break;
      }
      await page.waitForTimeout(400);
    }
    expect(matched, terminal || "timed out before a source").toBeTruthy();

    await page.getByTestId("tab-sources-view-research").click();
    await expect(page.getByTestId("list-research-history")).toContainText(marker);
  } finally {
    await client.query("delete from rss_sources where id = $1", [feedId]);
    await client.end();
    await new Promise<void>((resolve) => feed.close(() => resolve()));
  }
});
