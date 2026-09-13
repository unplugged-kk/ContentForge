/**
 * Unit tests for Phase 4 recurrence: the `every:<n><unit>` grammar, the
 * derived occurrence-index arithmetic, `createSchedule` validation, and the
 * scheduler's one-slot-per-tick catch-up behavior (in-memory port; DB
 * correctness/uniqueness is covered in a companion .dbtest.ts).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Artifact, Publication, Schedule, ScheduleOccurrence } from "@shared/schema";
import {
  computeOccurrenceTime,
  createSchedule,
  dispatchDueOccurrences,
  parseRecurrenceIntervalMs,
  ScheduleInputError,
} from "./scheduling";
import type { ContentStoragePort } from "./storage";

describe("parseRecurrenceIntervalMs", () => {
  it("accepts every:<n><unit> for m/h/d/w", () => {
    assert.equal(parseRecurrenceIntervalMs("every:1m"), 60_000);
    assert.equal(parseRecurrenceIntervalMs("every:2h"), 2 * 3_600_000);
    assert.equal(parseRecurrenceIntervalMs("every:7d"), 7 * 86_400_000);
    assert.equal(parseRecurrenceIntervalMs("every:4w"), 4 * 604_800_000);
  });

  it("rejects malformed grammar", () => {
    for (const bad of ["daily", "every:1", "every:1x", "every:0d", "every:-1d", "1d", "every:1D", ""]) {
      assert.throws(() => parseRecurrenceIntervalMs(bad), ScheduleInputError, bad);
    }
  });

  it("rejects an interval over the 90-day ceiling", () => {
    assert.throws(() => parseRecurrenceIntervalMs("every:91d"), ScheduleInputError);
    assert.doesNotThrow(() => parseRecurrenceIntervalMs("every:90d"));
  });
});

describe("computeOccurrenceTime", () => {
  const startAt = new Date("2026-01-01T00:00:00.000Z");

  it("one-shot: index 0 is startAt, any other index throws", () => {
    const schedule = { startAt, recurrence: null };
    assert.equal(computeOccurrenceTime(schedule, 0).getTime(), startAt.getTime());
    assert.throws(() => computeOccurrenceTime(schedule, 1));
  });

  it("recurring: index n is startAt + n * interval", () => {
    const schedule = { startAt, recurrence: "every:1d" };
    assert.equal(computeOccurrenceTime(schedule, 0).getTime(), startAt.getTime());
    assert.equal(
      computeOccurrenceTime(schedule, 3).getTime(),
      startAt.getTime() + 3 * 86_400_000,
    );
  });

  it("crosses a date boundary deterministically", () => {
    const lateNight = new Date("2026-03-01T23:30:00.000Z");
    const schedule = { startAt: lateNight, recurrence: "every:1h" };
    const next = computeOccurrenceTime(schedule, 1);
    assert.equal(next.toISOString(), "2026-03-02T00:30:00.000Z");
  });
});

// ── createSchedule validation ────────────────────────────────────────────────
function approvedArtifactStore(): ContentStoragePort {
  const artifact = { id: 1, userId: 1, readiness: "approved", channel: "x", format: "x_post" } as unknown as Artifact;
  return {
    async getArtifact() {
      return artifact;
    },
    async insertSchedule(row: unknown) {
      return { id: 1, ...(row as object) } as unknown as Schedule;
    },
  } as unknown as ContentStoragePort;
}

describe("createSchedule recurrence validation", () => {
  it("rejects recurrence with count < 2", async () => {
    await assert.rejects(
      createSchedule(1, { recurrence: "every:1d", count: 1 }, { content: approvedArtifactStore() }),
      ScheduleInputError,
    );
  });

  it("rejects malformed recurrence before touching storage", async () => {
    await assert.rejects(
      createSchedule(1, { recurrence: "daily", count: 3 }, { content: approvedArtifactStore() }),
      ScheduleInputError,
    );
  });

  it("accepts a well-formed recurring schedule", async () => {
    const schedule = await createSchedule(
      1,
      { recurrence: "every:1d", count: 5 },
      { content: approvedArtifactStore() },
    );
    assert.equal(schedule.recurrence, "every:1d");
    assert.equal(schedule.count, 5);
  });

  it("regression: still rejects count != 1 without recurrence", async () => {
    await assert.rejects(
      createSchedule(1, { count: 2 }, { content: approvedArtifactStore() }),
      ScheduleInputError,
    );
  });

  it("regression: one-shot (no recurrence, count = 1) still works", async () => {
    const schedule = await createSchedule(1, {}, { content: approvedArtifactStore() });
    assert.equal(schedule.recurrence, null);
    assert.equal(schedule.count, 1);
  });
});

// ── Recurring dispatch: catch-up, exhaustion, retry vs recurrence ───────────
function recurringStore(overrides: { count: number; recurrence: string; startAt: Date }) {
  const schedule = {
    id: 1,
    artifactId: 1,
    channel: "x",
    status: "active",
    count: overrides.count,
    recurrence: overrides.recurrence,
    startAt: overrides.startAt,
    userId: 1,
  } as unknown as Schedule;
  const artifact = { id: 1, readiness: "approved", channel: "x", format: "x_post" } as unknown as Artifact;

  const occurrences: ScheduleOccurrence[] = [];
  let publicationSeq = 0;
  const publicationKeys = new Set<string>();

  const content: Partial<ContentStoragePort> = {
    async listActiveSchedules(now: Date) {
      return schedule.status === "active" && schedule.startAt.getTime() <= now.getTime() ? [schedule] : [];
    },
    async countOccurrences() {
      return occurrences.length;
    },
    async materializeOccurrence(scheduleId: number, at: Date) {
      const existing = occurrences.find((o) => o.scheduleId === scheduleId && o.occurrenceTime.getTime() === at.getTime());
      if (existing) return existing;
      const row = { id: occurrences.length + 1, scheduleId, occurrenceTime: at, status: "pending" } as unknown as ScheduleOccurrence;
      occurrences.push(row);
      return row;
    },
    async setScheduleStatus(_id: number, status: string) {
      schedule.status = status;
    },
    async listDueOccurrences(now: Date) {
      return occurrences.filter(
        (o) => (o.status === "pending" || o.status === "enqueued") && o.occurrenceTime.getTime() <= now.getTime(),
      );
    },
    async markOccurrenceStatusIf(id: number, from: string, to: string) {
      const row = occurrences.find((o) => o.id === id);
      if (!row || row.status !== from) return false;
      row.status = to;
      return true;
    },
    async getSchedule() {
      return schedule;
    },
    async getArtifact() {
      return artifact;
    },
    async claimPublication(row: { idempotencyKey: string }) {
      if (publicationKeys.has(row.idempotencyKey)) {
        return { publication: { id: 0 } as unknown as Publication, created: false };
      }
      publicationKeys.add(row.idempotencyKey);
      publicationSeq += 1;
      return {
        publication: { id: publicationSeq, idempotencyKey: row.idempotencyKey } as unknown as Publication,
        created: true,
      };
    },
  };

  return { content: content as ContentStoragePort, schedule, occurrences };
}

describe("recurring dispatch", () => {
  it("materializes at most one occurrence per schedule per tick (bounded catch-up)", async () => {
    const startAt = new Date(Date.now() - 10 * 86_400_000); // 10 days ago
    const store = recurringStore({ count: 5, recurrence: "every:1d", startAt });
    const now = new Date();

    const first = await dispatchDueOccurrences(now, {
      content: store.content,
      enqueuePublication: async () => true,
    });
    assert.equal(first.materialized, 1, "only one slot materialized even though many are overdue");
    assert.equal(store.occurrences.length, 1);
    assert.equal(store.occurrences[0].occurrenceTime.getTime(), startAt.getTime());

    const second = await dispatchDueOccurrences(now, {
      content: store.content,
      enqueuePublication: async () => true,
    });
    assert.equal(second.materialized, 1, "next tick catches up the next slot, still one at a time");
    assert.equal(store.occurrences.length, 2);
    assert.equal(store.occurrences[1].occurrenceTime.getTime(), startAt.getTime() + 86_400_000);
  });

  it("marks the schedule exhausted once the last occurrence materializes, and never over-materializes", async () => {
    const startAt = new Date(Date.now() - 10 * 86_400_000);
    const store = recurringStore({ count: 2, recurrence: "every:1d", startAt });
    const now = new Date();

    await dispatchDueOccurrences(now, { content: store.content, enqueuePublication: async () => true });
    assert.equal(store.schedule.status, "active");

    await dispatchDueOccurrences(now, { content: store.content, enqueuePublication: async () => true });
    assert.equal(store.schedule.status, "exhausted");
    assert.equal(store.occurrences.length, 2);

    // A schedule with status still "active" in the fake (simulating a stale
    // read) but a fully materialized series must not create a 3rd occurrence.
    store.schedule.status = "active";
    const third = await dispatchDueOccurrences(now, { content: store.content, enqueuePublication: async () => true });
    assert.equal(third.materialized, 0);
    assert.equal(store.occurrences.length, 2);
  });

  it("two overlapping ticks on the same recurring schedule produce exactly one new occurrence", async () => {
    const startAt = new Date(Date.now() - 1000);
    const store = recurringStore({ count: 3, recurrence: "every:1h", startAt });
    const now = new Date();

    // `materialized` counts attempts (like the pre-existing one-shot metric);
    // the durable unique-per-slot guarantee is what `occurrences.length` proves.
    await Promise.all([
      dispatchDueOccurrences(now, { content: store.content, enqueuePublication: async () => true }),
      dispatchDueOccurrences(now, { content: store.content, enqueuePublication: async () => true }),
    ]);
    assert.equal(store.occurrences.length, 1);
  });

  it("a publication retry (occurrence stays pending) does not create another recurrence slot", async () => {
    const startAt = new Date(Date.now() - 1000);
    const store = recurringStore({ count: 3, recurrence: "every:1h", startAt });
    const now = new Date();

    // First tick materializes slot 0 and enqueues it, but the "publish" never
    // completes (occurrence remains enqueued — simulating a transient failure
    // being retried by the publication worker, not by the scheduler).
    await dispatchDueOccurrences(now, { content: store.content, enqueuePublication: async () => true });
    assert.equal(store.occurrences.length, 1);

    // A second tick, still before slot 1 is due, must not fabricate a new
    // recurrence slot just because slot 0 hasn't published yet.
    const stillEarly = await dispatchDueOccurrences(now, {
      content: store.content,
      enqueuePublication: async () => true,
    });
    assert.equal(stillEarly.materialized, 0);
    assert.equal(store.occurrences.length, 1);
  });
});
