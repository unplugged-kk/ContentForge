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
    assert.equal(rowHasLiveUnits({ status: "failed", externalIds: { x: "not-an-array" } }), false);
    assert.equal(rowHasLiveUnits({ status: "failed", externalIds: 42 as any }), false);
    assert.equal(rowHasLiveUnits(null), false);
    assert.equal(rowHasLiveUnits(undefined), false);
  });

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

  test("R8 retryBlockedReason explains why, and names the live units", () => {
    const row = partialPublishRecord({ externalIds: null }, partialErr());
    const reason = retryBlockedReason(row);
    assert.ok(reason, "a blocked retry must carry an explanation");
    assert.match(reason!, /2 unit\(s\) are LIVE/);
    assert.match(reason!, /do not retry/i);
  });

  test("R9 retryBlockedReason is null when a retry is fine", () => {
    assert.equal(retryBlockedReason({ status: "failed", externalIds: null }), null);
  });

  test("R10 the REAL gate refuses a partial row for manual publish", () => {
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

  test("R15 a partial row produced from a row that ALREADY had ids keeps both", () => {
    const row = partialPublishRecord(
      { externalIds: { x: ["1800000000000000001"] } },
      partialErr(),
    );
    const ids = (row.externalIds as any).x as string[];
    assert.equal(ids.length, 2);
    assert.ok(ids.includes("1800000000000000001"));
  });

  test("R16 the refusal carries status 409 so its message reaches the operator", () => {
    const row = partialPublishRecord({ externalIds: null }, partialErr());
    try {
      assertEligibleForXPublish(row as any, { invokedBy: "user" });
      assert.fail("the gate should have refused a partial row");
    } catch (e: any) {
      assert.equal(e.status, 409, "refusal must be a 4xx the handler will echo");
    }
  });
});
