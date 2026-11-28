import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalisePostBody, POST_DATE_FIELDS } from "./postBody";

const FIELDS = [...POST_DATE_FIELDS];

describe("A. normalisePostBody — value", () => {
  test("A1 an ISO string becomes a Date", () => {
    const { value, bad } = normalisePostBody({ scheduledAt: "2026-11-25T09:00:00.000Z" });
    assert.ok(value.scheduledAt instanceof Date);
    assert.equal((value.scheduledAt as Date).toISOString(), "2026-11-25T09:00:00.000Z");
    assert.deepEqual(bad, []);
  });

  test("A2 a Date is passed through unchanged", () => {
    const d = new Date("2026-11-25T09:00:00.000Z");
    const { value } = normalisePostBody({ postedAt: d });
    assert.equal(value.postedAt, d);
  });

  test("A3 every declared date field is handled, not just scheduledAt", () => {
    const body: Record<string, string> = {};
    for (const f of FIELDS) body[f] = "2026-11-25T09:00:00.000Z";
    const { value, bad } = normalisePostBody(body);
    assert.deepEqual(bad, []);
    for (const f of FIELDS) {
      assert.ok(value[f] instanceof Date, `${f} was not converted`);
    }
  });

  test("A4 an unparseable string is reported and REMOVED (never sent to the driver)", () => {
    const { value, bad } = normalisePostBody({ scheduledAt: "next tuesday", tone: "provocative" });
    assert.deepEqual(bad, ["scheduledAt"]);
    assert.equal("scheduledAt" in value, false);
    assert.equal(value.tone, "provocative");
  });

  test("A5 null / undefined / '' pass through (clear-or-ignore is storage's call)", () => {
    for (const raw of [null, undefined, ""]) {
      const { value, bad } = normalisePostBody({ scheduledAt: raw });
      assert.deepEqual(bad, [], `bad for ${String(raw)}`);
      assert.equal(value.scheduledAt, raw);
    }
  });

  test("A6 a numeric timestamp is refused, not silently used as ms", () => {
    const { value, bad } = normalisePostBody({ scheduledAt: 1795000000000 });
    assert.deepEqual(bad, ["scheduledAt"]);
    assert.equal("scheduledAt" in value, false);
  });

  test("A7 a non-object body yields an empty value and no crash", () => {
    for (const b of [null, undefined, "string", 42, []]) {
      const r = normalisePostBody(b);
      assert.deepEqual(r.value, {});
      assert.deepEqual(r.bad, []);
    }
  });
});

describe("B. normalisePostBody — safety", () => {
  test("B1 no other field is altered", () => {
    const body = {
      status: "draft", tone: "educational", postType: "thread",
      targetPlatform: "x", pillarId: 3, autopilot: true,
      scheduledAt: "2026-11-25T09:00:00.000Z",
    };
    const { value } = normalisePostBody(body);
    assert.equal(value.status, "draft");
    assert.equal(value.tone, "educational");
    assert.equal(value.pillarId, 3);
    assert.equal(value.autopilot, true);
  });

  test("B2 the input object is not mutated", () => {
    const body = { scheduledAt: "2026-11-25T09:00:00.000Z" };
    normalisePostBody(body);
    assert.equal(typeof body.scheduledAt, "string");
  });

  test("B3 an empty body stays empty (no fields invented)", () => {
    const { value } = normalisePostBody({});
    assert.deepEqual(value, {});
    assert.equal("scheduledAt" in value, false);
  });

  test("B4 a body with ONLY a bad date yields no date field at all", () => {
    const { value, bad } = normalisePostBody({ scheduledAt: "not-a-date" });
    assert.deepEqual(bad, ["scheduledAt"]);
    assert.deepEqual(value, {});
  });
});

describe("C. reach — the PUT route uses it", () => {
  const routes = readFileSync(resolve(process.cwd(), "server/routes.ts"), "utf8");

  test("C0 the route exists (cannot pass vacuously)", () => {
    assert.ok(routes.includes('app.put("/api/posts/:id"'));
  });

  test("C1 PUT /api/posts/:id normalises the body before storage", () => {
    const i = routes.indexOf('app.put("/api/posts/:id"');
    const block = routes.slice(i, i + 1200);
    assert.match(block, /normalisePostBody/);
    assert.doesNotMatch(block, /updatePost\([^)]*req\.body\s*\)/);
  });
});
