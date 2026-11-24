import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSlotDef, DAILY_SLOTS } from "./autopilot";

/**
 * Run 46 — the declared slot definition followed array position, not time of day.
 *
 * `autofillCalendar` did:
 *
 *     const slot = freeSlots[i];                        // i-th FREE slot
 *     const slotDef = DAILY_SLOTS[i % DAILY_SLOTS.length];  // i-th DECLARED slot
 *
 * Those two indices mean different things as soon as one slot is occupied. Under
 * D23 a draft occupies its slot by design, so "any slot occupied" is the normal
 * state, not an edge case. Measured on the old logic: of 6 pairings across four
 * occupancy patterns, 4 mismatched — the 19:30 post received the 13:00 label and
 * the 13:00 "educational" tone.
 *
 * These cases drive the REAL resolver. The old expression is reproduced only in
 * the negative control (E1), which must fail.
 */

const IST = (iso: string) => new Date(iso);

// The three declared slots in UTC for 2026-11-25 (UTC process; 13:00/19:30/23:00 IST).
const SLOT_13 = IST("2026-11-25T07:30:00Z"); // 13:00 IST — EU morning, thread
const SLOT_1930 = IST("2026-11-25T14:00:00Z"); // 19:30 IST — India evening, tweet
const SLOT_23 = IST("2026-11-25T17:30:00Z"); // 23:00 IST — US lunch, long_thread

describe("resolveSlotDef — identity by time, not by position (run 46)", () => {
  it("A1 each declared slot resolves to itself", () => {
    assert.equal(resolveSlotDef(SLOT_13).label, "EU morning");
    assert.equal(resolveSlotDef(SLOT_1930).label, "India evening");
    assert.equal(resolveSlotDef(SLOT_23).label, "US lunch");
  });

  it("A2 the tone stays attached to the hour it describes", () => {
    assert.equal(resolveSlotDef(SLOT_13).tone, "educational");
    assert.equal(resolveSlotDef(SLOT_1930).tone, "provocative");
    assert.equal(resolveSlotDef(SLOT_23).tone, "storytelling");
  });

  it("A3 the declared shape stays attached to the hour it describes", () => {
    assert.equal(resolveSlotDef(SLOT_13).preferredType, "thread");
    assert.equal(resolveSlotDef(SLOT_1930).preferredType, "tweet");
    assert.equal(resolveSlotDef(SLOT_23).preferredType, "long_thread");
  });

  it("B1 an occupied earlier slot does not shift the later slot's definition", () => {
    // This is the exact regression: 13:00 taken, so freeSlots = [19:30, 23:00].
    // The old code gave freeSlots[0] (19:30) the DAILY_SLOTS[0] definition.
    const freeSlots = [SLOT_1930, SLOT_23];
    assert.equal(resolveSlotDef(freeSlots[0]).label, "India evening");
    assert.equal(resolveSlotDef(freeSlots[0]).tone, "provocative");
    assert.equal(resolveSlotDef(freeSlots[1]).label, "US lunch");
  });

  it("B2 every occupancy pattern pairs correctly", () => {
    const all = [SLOT_13, SLOT_1930, SLOT_23];
    const patterns = [[], [0], [1], [2], [0, 1], [1, 2], [0, 2]];
    for (const taken of patterns) {
      const free = all.filter((_, idx) => !taken.includes(idx));
      const resolved = free.map((f) => resolveSlotDef(f));
      const expected = all.filter((_, idx) => !taken.includes(idx)).map((_, k) =>
        // expected definition is the one whose time equals this free slot's time
        DAILY_SLOTS.find(
          (s) =>
            s.hour === new Date(free[k].getTime() + 5.5 * 3600 * 1000).getUTCHours() &&
            s.minute === new Date(free[k].getTime() + 5.5 * 3600 * 1000).getUTCMinutes(),
        ),
      );
      assert.deepEqual(
        resolved.map((r) => r.label),
        expected.map((e) => e?.label),
        `occupancy ${JSON.stringify(taken)} must keep labels on their own hour`,
      );
    }
  });

  it("C1 a non-slot time falls back to the last declared slot that has passed", () => {
    // 15:00 IST is between 13:00 and 19:30 — it should borrow 13:00, not 19:30.
    const at15 = IST("2026-11-25T09:30:00Z");
    assert.equal(resolveSlotDef(at15).label, "EU morning");
    // 21:00 IST is between 19:30 and 23:00.
    const at21 = IST("2026-11-25T15:30:00Z");
    assert.equal(resolveSlotDef(at21).label, "India evening");
  });

  it("C2 a time before every declared slot falls forward to the first", () => {
    const at0600 = IST("2026-11-25T00:30:00Z"); // 06:00 IST
    assert.equal(resolveSlotDef(at0600).label, "EU morning");
  });

  it("E1 NEGATIVE CONTROL — the old positional rule mismatches on the same input", () => {
    // Reproduce the removed expression exactly.
    const oldRule = (freeSlots: Date[], i: number) =>
      DAILY_SLOTS[i % DAILY_SLOTS.length];
    const freeSlots = [SLOT_1930, SLOT_23]; // 13:00 occupied
    const oldLabel = oldRule(freeSlots, 0).label;
    const newLabel = resolveSlotDef(freeSlots[0]).label;
    assert.notEqual(
      oldLabel,
      newLabel,
      "if the old rule agrees here, this suite proves nothing",
    );
    assert.equal(oldLabel, "EU morning", "the old rule gave 19:30 the 13:00 label");
    assert.equal(newLabel, "India evening");
  });
});
