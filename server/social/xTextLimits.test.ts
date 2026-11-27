import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  validateXText,
  xUnitBudget,
  xUnitBudgetAt,
  transportPreserves,
  X_MAX_UNIT_CHARS,
} from "./xTextLimits";
import { addThreadNumbering } from "../utils/threadUtils";

describe("validateXText", () => {
  test("V1 empty input is rejected", () => {
    const r = validateXText([]);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /empty/);
  });

  test("V2 blank units are dropped, not counted", () => {
    const r = validateXText(["hello", "   ", ""]);
    assert.equal(r.ok, true, "one real unit + blanks is a valid single post");
  });

  test("V3 a single 280-char post passes", () => {
    const r = validateXText(["x".repeat(280)]);
    assert.equal(r.ok, true, r.error ?? "");
  });

  test("V4 a single 281-char post is rejected and quantifies the loss", () => {
    const r = validateXText(["x".repeat(281)]);
    assert.equal(r.ok, false);
    assert.equal(r.badUnit, 0);
    assert.equal(r.lostChars, 1);
    assert.match(r.error ?? "", /1 destroyed/);
  });

  test("V5 a 280-char unit in a 3-unit thread is REJECTED (input legal, output lossy)", () => {
    const units = ["x".repeat(280), "y".repeat(200), "z".repeat(200)];

    const numbered = addThreadNumbering(units.map((u) => u.trim()));
    const suffix = "\n\n1/3";
    const body = numbered[0].slice(0, -suffix.length);
    assert.ok(body.length < 280, `transport destroys ${280 - body.length} chars`);
    assert.equal(body.length, 280 - suffix.length);

    const r = validateXText(units);
    assert.equal(r.ok, false, "must reject: the published unit loses characters");
    assert.equal(r.badUnit, 0);
    assert.equal(r.lostChars, suffix.length);
  });

  test("V6 the same 280-char unit as a SINGLE post is accepted (rule is not always-fail)", () => {
    assert.equal(validateXText(["x".repeat(280)]).ok, true);
  });

  test("V7 a unit exactly at the 3-unit budget passes", () => {
    const budget = xUnitBudgetAt(0, 3);
    const units = ["x".repeat(budget), "y".repeat(100), "z".repeat(100)];
    assert.equal(validateXText(units).ok, true, `budget ${budget} must pass`);
  });

  test("V7b one character over that budget is rejected", () => {
    const budget = xUnitBudgetAt(0, 3);
    const units = ["x".repeat(budget + 1), "y".repeat(100), "z".repeat(100)];
    const r = validateXText(units);
    assert.equal(r.ok, false);
    assert.equal(r.lostChars, 1);
  });

  test("V8 a 10-unit thread has a smaller per-unit budget than a 3-unit thread", () => {
    assert.ok(xUnitBudget(10) < xUnitBudget(3), "10/10 is longer than 3/3");
    assert.equal(xUnitBudget(1), X_MAX_UNIT_CHARS);
    assert.equal(xUnitBudget(3), 280 - 2 - "3/3".length);
  });

  test("V9 a 275-char unit in a 10-unit thread is rejected (index-0 budget is 274)", () => {
    assert.equal(xUnitBudgetAt(0, 10), 274);
    assert.equal(xUnitBudgetAt(9, 10), 273);
    const units = Array.from({ length: 10 }, (_, i) => "x".repeat(i === 0 ? 275 : 50));
    const r = validateXText(units);
    assert.equal(r.ok, false);
    assert.equal(r.badUnit, 0);
    assert.equal(r.lostChars, 1);
  });

  test("V9b a 274-char unit at index 0 of a 10-unit thread passes", () => {
    const units = Array.from({ length: 10 }, (_, i) => "x".repeat(i === 0 ? 274 : 50));
    assert.equal(validateXText(units).ok, true);
  });

  test("V9c the LAST unit of a 10-unit thread has the tightest budget (273)", () => {
    const units = Array.from({ length: 10 }, (_, i) => "x".repeat(i === 9 ? 274 : 50));
    const r = validateXText(units);
    assert.equal(r.ok, false, "10/10 suffix leaves only 273");
    assert.equal(r.badUnit, 9);
  });

  test("V10 an ALREADY-numbered unit is judged as-is (idempotent, not double-numbered)", () => {
    const r = validateXText(["hello world\n\n1/2", "second\n\n2/2"]);
    assert.equal(r.ok, true, r.error ?? "");
  });

  test("V10b an already-numbered unit over 280 is still rejected (the slice is flat)", () => {
    const long = "x".repeat(280) + "\n\n1/2";
    assert.ok(long.length > 280);
    const r = validateXText([long, "short\n\n2/2"]);
    assert.equal(r.ok, false);
    assert.equal(r.badUnit, 0);
  });

  test("V11 emoji count as UTF-16 length the way slice() does", () => {
    const s = "🚀".repeat(141);
    assert.equal(s.length, 282);
    const r = validateXText([s]);
    assert.equal(r.ok, false, "282 UTF-16 units exceeds 280");
  });

  test("V12 reports the FIRST bad unit index", () => {
    const units = ["ok".repeat(10), "x".repeat(300), "y".repeat(300)];
    const r = validateXText(units);
    assert.equal(r.ok, false);
    assert.equal(r.badUnit, 1);
  });

  test("C1 accepted input is preserved byte-for-byte by the real transport", () => {
    const cases = [
      ["x".repeat(280)],
      ["x".repeat(xUnitBudgetAt(0, 3)), "y".repeat(100), "z".repeat(100)],
      ["a".repeat(50), "b".repeat(50)],
      Array.from({ length: 10 }, () => "c".repeat(10)),
      ["hello world\n\n1/2", "second\n\n2/2"],
    ];
    for (const c of cases) {
      if (!validateXText(c).ok) continue;
      assert.equal(transportPreserves(c), true, `transport must not damage: ${c.length} units`);
    }
  });

  test("C2 the naive output-comparison rule PASSES the case V5 rejects", () => {
    const units = ["x".repeat(280), "y".repeat(200), "z".repeat(200)];
    const naive = addThreadNumbering(units.map((u) => u.trim())).every(
      (t) => t.length <= X_MAX_UNIT_CHARS,
    );

    assert.equal(naive, true, "the old rule really does pass it");
    assert.equal(validateXText(units).ok, false, "the new rule rejects it");
    assert.notEqual(naive, validateXText(units).ok, "the two rules DISAGREE here");
  });
});
