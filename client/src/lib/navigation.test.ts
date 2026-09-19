import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRouteActive, CANONICAL_NAV_ITEMS } from "../components/app-sidebar";

describe("Canonical Navigation — AppSidebar (Phase 28.2B)", () => {
  it("exposes exactly the 7 canonical top-level navigation items in order", () => {
    const titles = CANONICAL_NAV_ITEMS.map((item) => item.title);
    assert.deepEqual(titles, [
      "Today",
      "Create",
      "Sources",
      "Agent",
      "Schedule",
      "Insights",
      "Settings",
    ]);

    const urls = CANONICAL_NAV_ITEMS.map((item) => item.url);
    assert.deepEqual(urls, [
      "/today",
      "/create",
      "/sources",
      "/agent",
      "/schedule",
      "/insights",
      "/settings",
    ]);
  });

  it("activates Today for / and /today and nested /today/*", () => {
    assert.equal(isRouteActive("/today", "/"), true);
    assert.equal(isRouteActive("/today", "/today"), true);
    assert.equal(isRouteActive("/today", "/today/attention"), true);
    assert.equal(isRouteActive("/today", "/create"), false);
    assert.equal(isRouteActive("/today", "/settings"), false);
  });

  it("activates Create for /create and all legacy create routes", () => {
    assert.equal(isRouteActive("/create", "/create"), true);
    assert.equal(isRouteActive("/create", "/create/post"), true);
    assert.equal(isRouteActive("/create", "/generate"), true);
    assert.equal(isRouteActive("/create", "/formatter"), true);
    assert.equal(isRouteActive("/create", "/hooks"), true);
    assert.equal(isRouteActive("/create", "/carousel"), true);
    assert.equal(isRouteActive("/create", "/images"), true);
    assert.equal(isRouteActive("/create", "/articles"), true);
    assert.equal(isRouteActive("/create", "/templates"), true);
    assert.equal(isRouteActive("/create", "/canned-responses"), true);
    assert.equal(isRouteActive("/create", "/chat"), true);
    assert.equal(isRouteActive("/create", "/queue"), false);
    assert.equal(isRouteActive("/create", "/sources"), false);
  });

  it("activates Sources for /sources and all legacy sources routes", () => {
    assert.equal(isRouteActive("/sources", "/sources"), true);
    assert.equal(isRouteActive("/sources", "/sources/ideas"), true);
    assert.equal(isRouteActive("/sources", "/ingest"), true);
    assert.equal(isRouteActive("/sources", "/discover"), true);
    assert.equal(isRouteActive("/sources", "/ideas"), true);
    assert.equal(isRouteActive("/sources", "/vault"), true);
    assert.equal(isRouteActive("/sources", "/references"), true);
    assert.equal(isRouteActive("/sources", "/youtube"), true);
    assert.equal(isRouteActive("/sources", "/create"), false);
    assert.equal(isRouteActive("/sources", "/schedule"), false);
  });

  it("activates Agent for /agent and nested /agent/*", () => {
    assert.equal(isRouteActive("/agent", "/agent"), true);
    assert.equal(isRouteActive("/agent", "/agent/runs"), true);
    assert.equal(isRouteActive("/agent", "/today"), false);
    assert.equal(isRouteActive("/agent", "/create"), false);
  });

  it("activates Schedule for /schedule and legacy /queue, /calendar", () => {
    assert.equal(isRouteActive("/schedule", "/schedule"), true);
    assert.equal(isRouteActive("/schedule", "/schedule/queue"), true);
    assert.equal(isRouteActive("/schedule", "/queue"), true);
    assert.equal(isRouteActive("/schedule", "/calendar"), true);
    assert.equal(isRouteActive("/schedule", "/insights"), false);
    assert.equal(isRouteActive("/schedule", "/today"), false);
  });

  it("activates Insights for /insights and legacy /analytics, /ai-usage", () => {
    assert.equal(isRouteActive("/insights", "/insights"), true);
    assert.equal(isRouteActive("/insights", "/insights/summary"), true);
    assert.equal(isRouteActive("/insights", "/analytics"), true);
    assert.equal(isRouteActive("/insights", "/ai-usage"), true);
    assert.equal(isRouteActive("/insights", "/schedule"), false);
    assert.equal(isRouteActive("/insights", "/settings"), false);
  });

  it("activates Settings for /settings and nested /settings/*", () => {
    assert.equal(isRouteActive("/settings", "/settings"), true);
    assert.equal(isRouteActive("/settings", "/settings/accounts"), true);
    assert.equal(isRouteActive("/settings", "/today"), false);
    assert.equal(isRouteActive("/settings", "/create"), false);
  });
});
