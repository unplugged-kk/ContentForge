import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  checkScheduledAt,
  checkScheduleWrite,
  needsFutureSchedule,
  SCHEDULE_SKEW_MS,
} from "./scheduleTime";

const NOW = new Date("2026-11-24T18:00:00.000Z");
const iso = (msOffset: number) => new Date(NOW.getTime() + msOffset).toISOString();

describe("A. checkScheduledAt — value", () => {
  test("A1 accepts a time one hour in the future", () => {
    assert.equal(checkScheduledAt(iso(3600_000), NOW).ok, true);
  });

  test("A2 REFUSES a time six hours in the past (the measured defect)", () => {
    const r = checkScheduledAt(iso(-6 * 3600_000), NOW);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /in the past/);
  });

  test("A3 REFUSES one second past the skew allowance", () => {
    const r = checkScheduledAt(
      new Date(NOW.getTime() - SCHEDULE_SKEW_MS - 1000).toISOString(), NOW);
    assert.equal(r.ok, false);
  });

  test("A4 accepts a time inside the skew allowance (clock drift, not a defect)", () => {
    assert.equal(checkScheduledAt(new Date(NOW.getTime() - 30_000).toISOString(), NOW).ok, true);
  });

  test("A5 accepts exactly now", () => {
    assert.equal(checkScheduledAt(NOW.toISOString(), NOW).ok, true);
  });

  test("A6 a MISSING value is allowed — 'keep the time it already has'", () => {
    assert.equal(checkScheduledAt(undefined, NOW).ok, true);
    assert.equal(checkScheduledAt(null, NOW).ok, true);
    assert.equal(checkScheduledAt("", NOW).ok, true);
  });

  test("A7 an unparseable string is refused, and says so", () => {
    const r = checkScheduledAt("tomorrow-ish", NOW);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /valid ISO/);
  });

  test("A8 a non-string is refused rather than coerced", () => {
    const r = checkScheduledAt(1795000000000 as unknown as string, NOW);
    assert.equal(r.ok, false);
  });

  test("A9 the message states how far in the past, so the operator can act", () => {
    const r = checkScheduledAt(iso(-90 * 60_000), NOW);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /90 minute/);
  });
});

describe("B. only status='scheduled' needs a future time", () => {
  test("B1 draft / ready / posted / failed are never blocked by a stale time", () => {
    for (const s of ["draft", "ready", "posted", "failed"]) {
      assert.equal(needsFutureSchedule(s), false, s);
      assert.equal(checkScheduleWrite(s, iso(-6 * 3600_000), NOW).ok, true, s);
    }
  });

  test("B2 status='scheduled' with a past time is refused", () => {
    assert.equal(checkScheduleWrite("scheduled", iso(-6 * 3600_000), NOW).ok, false);
  });

  test("B3 status='scheduled' with NO time is allowed — promote at the time it has", () => {
    assert.equal(checkScheduleWrite("scheduled", undefined, NOW).ok, true);
  });

  test("B4 the scheduler's OWN retry path does not go through this predicate", () => {
    const src = readFileSync(resolve(process.cwd(), "server/scheduler.ts"), "utf8");
    const i = src.indexOf("Retrying post=");
    assert.ok(i > 0, "the retry block was not found — this test must track it");
    const block = src.slice(Math.max(0, i - 900), i + 400);
    assert.match(block, /status:\s*"scheduled"/);
    assert.match(block, /storage\.updatePost\(/);
    assert.doesNotMatch(block, /checkScheduleWrite|checkScheduledAt/);
  });
});

describe("C. reach — every writer of status='scheduled' is accounted for", () => {
  const routes = readFileSync(resolve(process.cwd(), "server/routes.ts"), "utf8");

  test("C0 the census found the routes it expects (cannot pass vacuously)", () => {
    assert.ok(routes.includes('app.patch("/api/posts/:id/status"'));
    assert.ok(routes.includes('app.put("/api/posts/:id"'));
    assert.ok(routes.includes('app.post("/api/posts/schedule"'));
  });

  test("C1 the /status route calls the guard", () => {
    const i = routes.indexOf('app.patch("/api/posts/:id/status"');
    assert.match(routes.slice(i, i + 900), /checkScheduleWrite/);
  });

  test("C2 the PUT /api/posts/:id route calls the guard and resolves existing status when scheduledAt is sent alone", () => {
    const i = routes.indexOf('app.put("/api/posts/:id"');
    const slice = routes.slice(i, i + 1100);
    assert.match(slice, /checkScheduleWrite/);
    assert.match(slice, /storage\.getPost/);
  });

  test("C2b the POST /api/posts route calls the guard", () => {
    const i = routes.indexOf('app.post("/api/posts"');
    assert.match(routes.slice(i, i + 600), /checkScheduleWrite/);
  });

  test("C3 the pre-existing /api/posts/schedule route keeps its own future check", () => {
    const i = routes.indexOf('app.post("/api/posts/schedule"');
    assert.match(routes.slice(i, i + 800), /must be a valid future datetime/);
  });
});
