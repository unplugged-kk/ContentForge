import assert from "node:assert/strict";
import test from "node:test";
import { renderSite } from "../site/render";

const PAGES = ["/", "/chatgpt", "/dots", "/claude", "/claude-cowork"];

test("marketing site renders every page and asset", () => {
  const site = renderSite();
  for (const p of [...PAGES, "/_site/site.css", "/_site/site.js", "/_site/favicon.svg"]) {
    assert.ok(site[p]?.body.length > 0, `${p} is missing or empty`);
  }
});

test("marketing pages have balanced sections and divs, a title and one h1", () => {
  const site = renderSite();
  for (const p of PAGES) {
    const html = site[p].body;
    const count = (re: RegExp) => (html.match(re) ?? []).length;
    assert.equal(count(/<section\b/g), count(/<\/section>/g), `${p}: section tags`);
    assert.equal(count(/<div\b/g), count(/<\/div>/g), `${p}: div tags`);
    assert.equal(count(/<h1\b/g), 1, `${p}: exactly one h1`);
    assert.match(html, /<title>[^<]+<\/title>/, `${p}: title`);
  }
});

test("agent pages never claim the MCP connector is live", () => {
  const site = renderSite();
  for (const p of PAGES.slice(1)) assert.match(site[p].body, /planned/i, `${p} should say the connector is planned`);
});
