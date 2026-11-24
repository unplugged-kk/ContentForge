/**
 * run 51 / B66 — the retry gate must judge the ROW, not a vanished error.
 *
 * run 50 fixed the record: a partially published thread writes `status="failed"`
 * with its live tweet ids on the row, and exported `isSafeToRetry(err)`.
 *
 * Measured with the real gate (evidence/run51/probe_retry_gate.ts), that is not
 * enough. A retry is a LATER HTTP request. The error object lived in the previous
 * request's stack and was never persisted, so `isSafeToRetry(err)` cannot be
 * asked at retry time — there is no `err` to pass. The only survivor is the row.
 * And the row was ADMITTED for manual publish while carrying 2 live units.
 *
 * So the predicate has to exist in a form that takes a ROW. These tests pin
 * that, and pin the two controls that must not regress: a clean failure stays
 * retryable, and a posted row stays refused.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assertEligibleForXPublish } from "@shared/xDeveloperRisk";
import {
  isSafeToRetry,
  partialPublishRecord,
  retryBlockedReason,
  rowHasLiveUnits,
  XPartialPublishError,
} from "./partialPublish";

const partialErr = () =>
  new XPartialPublishError({
    tweetIds: ["1800000000000000001", "1800000000000000002"],
    urls: [
      "https://x.com/i/status/1800000000000000001",
      "https://x.com/i/status/1800000000000000002",
    ],
    failedUnit: 3,
    totalUnits: 4,
    cause: new Error("The operation was aborted due to timeout"),
  });

describe("run 51 · B66 the retry gate sees a row that already published", () => {
  // --- the shape a later request actually holds ---------------------------

  test("R1 rowHasLiveUnits is true for a row carrying recorded ids", () => {
    const row = partialPublishRecord({ externalIds: null }, partialErr());
    assert.equal(rowHasLiveUnits(row), true);
  });

  test("R2 rowHasLiveUnits is false for a clean failure", () => {
    assert.equal(rowHasLiveUnits({ status: "failed", externalIds: null }), false);
    assert.equal(rowHasLiveUnits({ status: "failed", externalIds: {} }), false);
    assert.equal(rowHasLiveUnits({ status: "failed", externalIds: { x: [] } }), false);
  });

  test("R3 rowHasLiveUnits tolerates junk without throwing", () => {
    // A row read back from JSONB is not guaranteed to be well-formed. An
    // exception here would become a 500 on the retry path, hiding the reason.
    assert.equal(rowHasLiveUnits({ status: "failed", externalIds: { x: "not-an-array" } }), false);
    assert.equal(rowHasLiveUnits({ status: "failed", externalIds: 42 as any }), false);
    assert.equal(rowHasLiveUnits(null), false);
    assert.equal(rowHasLiveUnits(undefined), false);
  });

  // --- the predicate the retry path asks ---------------------------------

  test("R4 a partial row is NOT safe to retry", () => {
    const row = partialPublishRecord({ externalIds: null }, partialErr());
    assert.equal(isSafeToRetry(row), false);
  });

  test("R5 a clean failure IS safe to retry", () => {
    assert.equal(isSafeToRetry({ status: "failed", externalIds: null }), true);
  });

  test("R6 isSafeToRetry still accepts an ERROR (run 50's contract, unbroken)", () => {
    assert.equal(isSafeToRetry(partialErr()), false);
    assert.equal(isSafeToRetry(new Error("connect ECONNREFUSED")), true);
  });

  test("R7 a posted row is not 'retryable' — there is nothing to retry", () => {
    assert.equal(isSafeToRetry({ status: "posted", externalIds: { x: ["1"] } }), false);
  });

  // --- the reason a human is shown ---------------------------------------

  test("R8 retryBlockedReason explains why, and names the live units", () => {
    const row = partialPublishRecord({ externalIds: null }, partialErr());
    const reason = retryBlockedReason(row);
    assert.ok(reason, "a blocked retry must carry an explanation");
    // The row persists the ids and not the intended total, so the honest claim is
    // the count that actually reached the provider ("2 unit(s) are LIVE"), never
    // "2 of 4" — inventing the denominator would be the error message claiming
    // more than it measured. The operator-facing `errorMessage` from run 50 does
    // carry "2 of 4", because it is built from the error, not from the row.
    assert.match(reason!, /2 unit\(s\) are LIVE/);
    assert.match(reason!, /do not retry/i);
  });

  test("R9 retryBlockedReason is null when a retry is fine", () => {
    assert.equal(retryBlockedReason({ status: "failed", externalIds: null }), null);
  });

  // --- the gate is where it has to hold ----------------------------------

  test("R10 the REAL gate refuses a partial row for manual publish", () => {
    // This is the defect: before the fix this call did not throw.
    const row = partialPublishRecord({ externalIds: null }, partialErr());
    assert.throws(
      () => assertEligibleForXPublish(row as any, { invokedBy: "user" }),
      /already published|partially/i,
    );
  });

  test("R11 the gate still admits a CLEAN failed row (no regression)", () => {
    assert.doesNotThrow(() =>
      assertEligibleForXPublish({ status: "failed", scheduledAt: null, externalIds: null }, { invokedBy: "user" }),
    );
  });

  test("R12 the gate still admits ready and scheduled (no regression)", () => {
    assert.doesNotThrow(() =>
      assertEligibleForXPublish({ status: "ready", scheduledAt: null, externalIds: null }, { invokedBy: "user" }),
    );
    assert.doesNotThrow(() =>
      assertEligibleForXPublish(
        { status: "scheduled", scheduledAt: new Date(Date.now() - 1000).toISOString(), externalIds: null },
        { invokedBy: "user" },
      ),
    );
  });

  test("R13 the gate still refuses a posted row (no regression)", () => {
    assert.throws(
      () => assertEligibleForXPublish({ status: "posted", scheduledAt: null, externalIds: { x: ["1"] } }, { invokedBy: "user" }),
      /already published/i,
    );
  });

  test("R14 the gate still refuses a draft (no regression)", () => {
    assert.throws(
      () => assertEligibleForXPublish({ status: "draft", scheduledAt: null, externalIds: null }, { invokedBy: "user" }),
      /Ready or Scheduled/i,
    );
  });

  // --- the union must not be lost by the guard ---------------------------

  test("R15 a partial row produced from a row that ALREADY had ids keeps both", () => {
    // Second attempt on the same post: units 1-2 were live from attempt one, the
    // retry added nothing, and a third unit timed out. Losing either set would
    // recreate B65 one layer up.
    const row = partialPublishRecord(
      { externalIds: { x: ["1800000000000000001"] } },
      partialErr(),
    );
    const ids = (row.externalIds as any).x as string[];
    assert.equal(ids.length, 2);
    assert.ok(ids.includes("1800000000000000001"));
  });

  // --- the refusal must be legible to the operator -----------------------

  test("R16 the refusal carries status 409 so its message reaches the operator", () => {
    // server/middleware/errorHandler.ts only echoes a message for a recognised
    // 4xx; anything else becomes "Internal server error". A refusal the operator
    // cannot read is one they will work around — and here, working around it
    // means republishing live units.
    const row = partialPublishRecord({ externalIds: null }, partialErr());
    try {
      assertEligibleForXPublish(row as any, { invokedBy: "user" });
      assert.fail("the gate should have refused a partial row");
    } catch (e: any) {
      assert.equal(e.status, 409, "refusal must be a 4xx the handler will echo");
    }
  });
});
