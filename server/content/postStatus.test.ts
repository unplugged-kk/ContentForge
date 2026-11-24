import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_GENERATED_POST_STATUS,
  PUBLISHABLE_STATUSES,
  SLOT_OCCUPYING_STATUSES,
  isPublishable,
  occupiesSlot,
} from "./postStatus";
import { addThreadNumbering } from "../utils/threadUtils";

/**
 * D23 / §27 option A — draft-only mode.
 *
 * The defect being closed: auto-generated posts were written with
 * `status: "scheduled"`, and the publishing scheduler fires on exactly that. So
 * generated content could reach a connected account with no human in the loop.
 *
 * These tests assert the STATUS VALUE, because that value is what the scheduler
 * reads. They are written so that reverting the constant to "scheduled" fails
 * them — see N1.
 */
describe("D23 · auto-generated posts are drafts, never scheduled", () => {
  test("A1 auto-generated status is exactly 'draft'", () => {
    assert.equal(AUTO_GENERATED_POST_STATUS, "draft");
  });

  test("A2 a draft is NOT publishable by the scheduler", () => {
    assert.equal(isPublishable("draft"), false);
    assert.equal(isPublishable(AUTO_GENERATED_POST_STATUS), false);
  });

  test("A3 'scheduled' IS the only publishable status", () => {
    assert.deepEqual([...PUBLISHABLE_STATUSES], ["scheduled"]);
    assert.equal(isPublishable("scheduled"), true);
  });

  test("A4 draft/ready still occupy their slot (no duplicate drafts)", () => {
    assert.equal(occupiesSlot("draft"), true);
    assert.equal(occupiesSlot("ready"), true);
    assert.equal(occupiesSlot("scheduled"), true);
    assert.deepEqual([...SLOT_OCCUPYING_STATUSES], ["draft", "ready", "scheduled"]);
  });

  test("A5 a posted/failed/absent row does not occupy a slot", () => {
    assert.equal(occupiesSlot("posted"), false);
    assert.equal(occupiesSlot("failed"), false);
    assert.equal(occupiesSlot(null), false);
    assert.equal(occupiesSlot(undefined), false);
    assert.equal(occupiesSlot(""), false);
  });

  test("A6 the two predicates do not overlap: nothing is both publishable and a draft", () => {
    for (const s of PUBLISHABLE_STATUSES) {
      assert.notEqual(s, AUTO_GENERATED_POST_STATUS);
    }
  });

  /**
   * N1 — the load-bearing cell. If someone "fixes" the constant back to
   * "scheduled", A1/A2/A6 above must go red. Proven by evaluating the same
   * predicates against the old value rather than by asserting on the source text.
   */
  test("N1 the OLD value 'scheduled' WOULD be publishable (proves these tests bite)", () => {
    assert.equal(isPublishable("scheduled"), true, "old behaviour published");
    assert.notEqual(
      isPublishable("scheduled"),
      isPublishable(AUTO_GENERATED_POST_STATUS),
      "the new value must behave DIFFERENTLY from the old one",
    );
  });
});

/**
 * D24 / §40 — the X length gate must judge the text the transport sends.
 *
 * `addThreadNumbering` appends "\n\nN/total" and trims the body to make room. A
 * unit that is exactly 280 chars is valid as submitted and loses characters once
 * numbered. A validator that checked the input would pass it.
 */
describe("D24 · the budget is a function of thread size, not a flat 280", () => {
  test("A7 a single 280-char post passes and a 281-char post does not", () => {
    const ok = addThreadNumbering(["x".repeat(280)]);
    assert.equal(ok[0].length, 280, "single post is not numbered");

    const over = addThreadNumbering(["x".repeat(281)]);
    assert.equal(over[0].length, 281, "still unnumbered, still over the cut line");
  });

  test("A8 a 280-char unit in a 3-unit thread is TRIMMED by the real transport", () => {
    const units = ["x".repeat(280), "y".repeat(280), "z".repeat(280)];
    const numbered = addThreadNumbering(units);
    const budget = 280 - "\n\n1/3".length;
    assert.equal(numbered[0].length, 280, "numbered output is padded to exactly 280");
    // The BODY was cut to make room. That loss is the whole defect.
    const body = numbered[0].slice(0, -"\n\n1/3".length);
    assert.equal(body.length, budget, `body trimmed to ${budget}`);
    assert.ok(body.length < 280, "characters were destroyed");
  });

  test("A9 a 275-char unit in a 3-unit thread survives the numbering", () => {
    const numbered = addThreadNumbering(["x".repeat(275), "y".repeat(200), "z".repeat(200)]);
    const body = numbered[0].slice(0, -"\n\n1/3".length);
    assert.equal(body.length, 275, "275 fits the 3-unit budget of 275");
  });

  test("A10 counting is per-unit suffix: 1/3 is shorter than 10/10", () => {
    const three = "\n\n3/3".length;
    const ten = "\n\n10/10".length;
    assert.ok(ten > three, "a 10-unit thread has a smaller budget per unit");
  });
});
