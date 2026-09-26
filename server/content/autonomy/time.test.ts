/**
 * Phase 33.7 — unit tests for the autonomy authoritative-time helpers.
 *
 * Covers the required matrix: UTC, a positive offset (+05:30), a negative
 * offset (−05:00), a date boundary, a week boundary, and DST (both the
 * spring-forward 23 h day and the fall-back 25 h day). All helpers are pure and
 * take an injectable `now`, so no database or clock is needed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTONOMY_TIMEZONE,
  DAILY_WINDOW_MINUTES,
  MS_PER_DAY,
  MS_PER_HOUR,
  WEEKLY_WINDOW_MINUTES,
  autonomyWindowBoundaries,
  cooldownElapsed,
  cooldownElapsedMs,
  startOfDay,
  startOfWeek,
  windowStartMs,
  withinWindow,
} from "./time";

const iso = (ms: number) => new Date(ms).toISOString();
const KOLKATA = "Asia/Kolkata"; // +05:30, no DST
const NEW_YORK = "America/New_York"; // −05:00 / −04:00, observes DST

describe("autonomy time semantics — authoritative timezone (Phase 33.7)", () => {
  it("declares UTC as the authoritative timezone", () => {
    assert.equal(AUTONOMY_TIMEZONE, "UTC");
    assert.equal(DAILY_WINDOW_MINUTES, 24 * 60);
    assert.equal(WEEKLY_WINDOW_MINUTES, 7 * 24 * 60);
  });
});

describe("rolling windows are absolute durations (time-zone/DST agnostic)", () => {
  it("windowStartMs subtracts a fixed duration regardless of zone", () => {
    const now = Date.parse("2024-06-15T12:00:00Z");
    assert.equal(windowStartMs(now, DAILY_WINDOW_MINUTES * 60_000), Date.parse("2024-06-14T12:00:00Z"));
    assert.equal(windowStartMs(now, WEEKLY_WINDOW_MINUTES * 60_000), Date.parse("2024-06-08T12:00:00Z"));
  });

  it("withinWindow is inclusive at the exact boundary and false one ms before", () => {
    const now = Date.parse("2024-06-15T12:00:00Z");
    const day = DAILY_WINDOW_MINUTES * 60_000;
    assert.equal(withinWindow(now - day, now, day), true);
    assert.equal(withinWindow(now - day - 1, now, day), false);
  });

  it("DST does not lengthen or shorten a rolling duration window", () => {
    // Spans the America/New_York spring-forward transition, yet the window is
    // still exactly 24 h of absolute time.
    const now = Date.parse("2024-03-10T16:00:00Z");
    assert.equal(windowStartMs(now, MS_PER_DAY), Date.parse("2024-03-09T16:00:00Z"));
  });
});

describe("cooldownElapsed / cooldownElapsedMs", () => {
  const now = 1_700_000_000_000;
  it("denies immediately after activation", () => {
    assert.equal(cooldownElapsed(new Date(now - 1000), 60, now), false);
    assert.equal(cooldownElapsedMs(1_000, 60), false);
  });
  it("allows once the exact window has elapsed", () => {
    assert.equal(cooldownElapsed(new Date(now - MS_PER_HOUR), 60, now), true);
    assert.equal(cooldownElapsedMs(60 * 60_000, 60), true);
  });
  it("allows when the cooldown is zero and any non-negative time has elapsed", () => {
    assert.equal(cooldownElapsedMs(0, 0), true);
  });
});

describe("startOfDay — UTC", () => {
  it("returns the UTC midnight of the containing day", () => {
    assert.equal(iso(startOfDay(Date.parse("2024-06-15T12:00:00Z"))), "2024-06-15T00:00:00.000Z");
    assert.equal(iso(startOfDay(Date.parse("2024-06-15T00:00:00Z"))), "2024-06-15T00:00:00.000Z");
  });
});

describe("startOfDay — positive offset (+05:30 Asia/Kolkata)", () => {
  it("aligns to local midnight, not UTC midnight", () => {
    // 2024-01-01T00:00Z is 05:30 local on 2024-01-01 → local midnight is 18:30Z on 2023-12-31.
    assert.equal(iso(startOfDay(Date.parse("2024-01-01T00:00:00Z"), KOLKATA)), "2023-12-31T18:30:00.000Z");
  });
});

describe("startOfDay — negative offset (−05:00 America/New_York)", () => {
  it("aligns to local midnight, not UTC midnight", () => {
    // 2024-01-01T00:00Z is 19:00 local on 2023-12-31 → local midnight is 05:00Z on 2023-12-31.
    assert.equal(iso(startOfDay(Date.parse("2024-01-01T00:00:00Z"), NEW_YORK)), "2023-12-31T05:00:00.000Z");
  });
});

describe("date boundary", () => {
  it("flips exactly at local midnight (+05:30)", () => {
    const midnight = Date.parse("2023-12-31T18:30:00Z"); // = 2024-01-01T00:00 local
    assert.equal(iso(startOfDay(midnight, KOLKATA)), "2023-12-31T18:30:00.000Z");
    assert.equal(iso(startOfDay(midnight - 1, KOLKATA)), "2023-12-30T18:30:00.000Z");
  });
});

describe("week boundary (ISO weeks start Monday)", () => {
  it("UTC: Sunday belongs to the previous Monday, Monday starts a new week", () => {
    assert.equal(iso(startOfWeek(Date.parse("2024-01-07T12:00:00Z"))), "2024-01-01T00:00:00.000Z");
    assert.equal(iso(startOfWeek(Date.parse("2024-01-08T00:00:00Z"))), "2024-01-08T00:00:00.000Z");
  });
  it("positive offset: the local Monday is used", () => {
    // 2024-01-08T03:00Z is 08:30 local Monday in Kolkata → week start 2024-01-07T18:30Z.
    assert.equal(iso(startOfWeek(Date.parse("2024-01-08T03:00:00Z"), KOLKATA)), "2024-01-07T18:30:00.000Z");
  });
});

describe("DST transitions (America/New_York)", () => {
  it("spring forward: the local day is 23 h long", () => {
    const before = startOfDay(Date.parse("2024-03-10T12:00:00Z"), NEW_YORK); // 2024-03-10T05:00Z (EST)
    const after = startOfDay(Date.parse("2024-03-11T12:00:00Z"), NEW_YORK); // 2024-03-11T04:00Z (EDT)
    assert.equal(iso(before), "2024-03-10T05:00:00.000Z");
    assert.equal(iso(after), "2024-03-11T04:00:00.000Z");
    assert.equal(after - before, 23 * MS_PER_HOUR);
  });

  it("fall back: the local day is 25 h long", () => {
    const before = startOfDay(Date.parse("2024-11-03T12:00:00Z"), NEW_YORK); // 2024-11-03T04:00Z (EDT)
    const after = startOfDay(Date.parse("2024-11-04T12:00:00Z"), NEW_YORK); // 2024-11-04T05:00Z (EST)
    assert.equal(iso(before), "2024-11-03T04:00:00.000Z");
    assert.equal(iso(after), "2024-11-04T05:00:00.000Z");
    assert.equal(after - before, 25 * MS_PER_HOUR);
  });
});

describe("autonomyWindowBoundaries", () => {
  it("reports the authoritative zone and deterministic day/week starts", () => {
    const now = Date.parse("2024-01-07T12:00:00Z");
    const b = autonomyWindowBoundaries(now);
    assert.equal(b.timeZone, "UTC");
    assert.equal(b.dayStartMs, Date.parse("2024-01-07T00:00:00Z"));
    assert.equal(b.weekStartMs, Date.parse("2024-01-01T00:00:00Z"));
    assert.equal(b.dailyWindowMinutes, DAILY_WINDOW_MINUTES);
    assert.equal(b.weeklyWindowMinutes, WEEKLY_WINDOW_MINUTES);
  });
});
