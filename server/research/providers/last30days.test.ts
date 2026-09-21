import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LAST30DAYS_HOSTED_SOURCES, createLast30DaysProvider, normalizeLast30DaysItems, parseDoctorReport } from "./last30days";

describe("last30days adapter", () => {
  it("treats doctor JSON as capability truth, not env presence", () => {
    const report = parseDoctorReport({
      engine_version: "3.24.0",
      sources: {
        reddit: { tier: "ok", status: "ok", active_backend: "rss" },
        x: { tier: "off", status: "unconfigured" },
        youtube: { tier: "ok", status: "ok" },
        hackernews: { tier: "ok", status: "ok" },
      },
    });
    assert.equal(report.engineVersion, "3.24.0");
    assert.deepEqual(report.availableHosted.sort(), ["hackernews", "reddit"]);
    assert.ok(!report.availableHosted.includes("x"));
    assert.ok(!report.availableHosted.includes("youtube"));
    assert.ok(LAST30DAYS_HOSTED_SOURCES.includes("reddit"));
  });

  it("normalizes last30days items into ContentForge sources and drops cookie-gated origins", () => {
    const sources = normalizeLast30DaysItems(
      {
        items: [
          { item_id: "1", source: "hackernews", title: "AI agents", url: "https://news.ycombinator.com/item?id=1", body: "points" },
          { item_id: "2", source: "x", title: "tweet", url: "https://x.com/a/status/1", body: "cookie path" },
        ],
      },
      new Date("2026-09-18T00:00:00.000Z"),
      10,
    );
    assert.equal(sources.length, 1);
    assert.equal(sources[0].provider, "last30days");
    assert.equal(sources[0].ref.kind, "hackernews");
    assert.equal(sources[0].accessClass, "open");
  });

  it("probes unconfigured when the script is missing", async () => {
    const provider = createLast30DaysProvider({
      scriptPath: null,
      runCommand: async () => ({ code: 0, stdout: "{}", stderr: "" }),
    });
    const health = await provider.backends[0].probe!();
    assert.equal(health.state, "unavailable");
    assert.match(health.message ?? "", /not found|unconfigured/i);
  });
});
