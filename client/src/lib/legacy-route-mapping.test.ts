import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_ROUTE_MAPPINGS,
  getCreateModeHref,
  getLegacyRouteTarget,
} from "./legacy-route-mapping";

describe("legacy route mapping", () => {
  it("contains the exact duplicate and canonical Create mappings", () => {
    assert.deepEqual(LEGACY_ROUTE_MAPPINGS, {
      "/generate": { path: "/create" },
      "/queue": { path: "/schedule", params: { tab: "queue" } },
      "/calendar": { path: "/schedule", params: { tab: "calendar" } },
      "/analytics": { path: "/insights", params: { view: "performance" } },
      "/ai-usage": { path: "/insights", params: { view: "ai-usage" } },
      "/discover": { path: "/sources", params: { view: "discover" } },
      "/ingest": { path: "/sources", params: { view: "ingest" } },
      "/ideas": { path: "/sources", params: { view: "ideas" } },
      "/vault": { path: "/sources", params: { view: "vault" } },
      "/references": { path: "/sources", params: { view: "references" } },
      "/hooks": { path: "/create", params: { mode: "hooks" } },
      "/carousel": { path: "/create", params: { mode: "carousel" } },
      "/images": { path: "/create", params: { mode: "images" } },
      "/articles": { path: "/create", params: { mode: "articles" } },
      "/templates": { path: "/create", params: { mode: "templates" } },
      "/formatter": { path: "/create", params: { mode: "formatter" } },
      "/canned-responses": { path: "/create", params: { mode: "canned-responses" } },
      "/chat": { path: "/create", params: { mode: "chat-post" } },
    });
  });

  it("preserves existing query parameters and a bookmark hash", () => {
    const target = getLegacyRouteTarget(
      "/queue",
      "?tab=calendar&filter=ready&filter=mine#post-42",
      "#post-42",
    );
    assert.ok(target);
    const url = new URL(target, "https://contentforge.test");
    assert.equal(url.pathname, "/schedule");
    assert.equal(url.searchParams.get("tab"), "queue");
    assert.equal(url.searchParams.getAll("filter").join(","), "ready,mine");
    assert.equal(url.hash, "#post-42");
  });

  it("overrides only the canonical selector parameter", () => {
    const target = getLegacyRouteTarget("/analytics", "?view=learning&range=30d");
    assert.ok(target);
    const url = new URL(target, "https://contentforge.test");
    assert.equal(url.pathname, "/insights");
    assert.equal(url.searchParams.get("view"), "performance");
    assert.equal(url.searchParams.get("range"), "30d");
  });

  it("leaves YouTube unmapped because its canonical home is deferred", () => {
    assert.equal(getLegacyRouteTarget("/youtube"), null);
  });
});

describe("Create mode links", () => {
  it("keeps useful deep-link parameters while changing modes", () => {
    assert.equal(
      getCreateModeHref("hooks", "?storyId=7&ideaId=8&artifact=99&empty=true"),
      "/create?storyId=7&ideaId=8&mode=hooks",
    );
  });

  it("removes the mode selector for Post and Thread", () => {
    assert.equal(
      getCreateModeHref("post-thread", "?mode=hooks&storyId=7"),
      "/create?storyId=7",
    );
  });
});
