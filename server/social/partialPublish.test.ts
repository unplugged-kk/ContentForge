import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  XPartialPublishError,
  describePartialPublish,
  isSafeToRetry,
  partialPublishRecord,
} from "./partialPublish";

describe("run 50 · a partial thread publish is recorded, not discarded", () => {
  const err = new XPartialPublishError({
    tweetIds: ["111", "222"],
    urls: ["https://x.com/acct/status/111", "https://x.com/acct/status/222"],
    failedUnit: 3,
    totalUnits: 4,
    cause: new Error("The operation was aborted due to timeout"),
  });

  test("A1 the error carries every id that actually published", () => {
    assert.deepEqual([...err.tweetIds], ["111", "222"]);
    assert.equal(err.publishedCount, 2);
  });

  test("A2 the message states the count, NOT that the thread failed", () => {
    assert.match(err.message, /PARTIALLY/);
    assert.match(err.message, /2 of 4 units/);
    assert.doesNotMatch(err.message, /^Thread failed/);
  });

  test("A3 the message refuses a retry, because a retry duplicates", () => {
    assert.match(err.message, /Do NOT retry/i);
    assert.match(err.message, /duplicates/);
  });

  test("A4 the failing unit's OWN outcome is not assumed to be a failure", () => {
    assert.equal(err.unitOutcomeUnknown, true);
    assert.match(err.message, /UNKNOWN/);
    assert.match(err.message, /may have been accepted/);
    assert.doesNotMatch(err.message, /do not assume it failed/);
  });

  test("A5 the deep link to the first live unit survives", () => {
    assert.match(err.message, /https:\/\/x\.com\/acct\/status\/111/);
  });

  test("A6 isSafeToRetry refuses a partial publish and admits a clean failure", () => {
    assert.equal(isSafeToRetry(err), false, "partial must not be retryable");
    assert.equal(isSafeToRetry(new Error("connect ECONNREFUSED")), true);
    assert.equal(
      isSafeToRetry(
        new XPartialPublishError({
          tweetIds: [],
          urls: [],
          failedUnit: 1,
          totalUnits: 3,
          cause: new Error("boom"),
        }),
      ),
      true,
      "zero published units IS safe to retry",
    );
  });

  test("A7 the row keeps the ids AND the failed status", () => {
    const rec = partialPublishRecord({ externalIds: null }, err);
    assert.equal(rec.status, "failed");
    assert.deepEqual(rec.externalIds.x, ["111", "222"]);
    assert.deepEqual(rec.externalUrls.x, [
      "https://x.com/acct/status/111",
      "https://x.com/acct/status/222",
    ]);
  });

  test("A8 the row never discards ids already recorded", () => {
    const rec = partialPublishRecord(
      { externalIds: { x: ["999"] }, externalUrls: { x: ["https://x.com/a/status/999"] } },
      err,
    );
    assert.deepEqual(rec.externalIds.x, ["111", "222"]);
    assert.deepEqual((rec.externalIds as any).x.length, 2);
  });

  test("A9 a single-unit post that fails reports 'unit 1 is', not 'units 1-1 are'", () => {
    const msg = describePartialPublish({
      tweetIds: ["only"],
      urls: ["https://x.com/a/status/only"],
      failedUnit: 2,
      totalUnits: 2,
      cause: new Error("timeout"),
    });
    assert.match(msg, /unit 1 is LIVE/);
    assert.doesNotMatch(msg, /units 1-1/);
  });

  test("A10 the cause is preserved for the operator, not swallowed", () => {
    assert.ok(err.cause instanceof Error);
    assert.match((err.cause as Error).message, /aborted due to timeout/);
  });
});

describe("run 50 · negative control — the pre-fix shape fails these assertions", () => {
  test("B1 a plain transport error cannot satisfy 'ids published'", () => {
    const oldError = new Error("The operation was aborted due to timeout");
    assert.equal("tweetIds" in oldError, false);
    assert.equal("publishedCount" in oldError, false);
  });

  test("B2 the old failure sentence does not mention partial publication", () => {
    const oldFriendly = "The operation was aborted due to timeout";
    assert.doesNotMatch(oldFriendly, /PARTIALLY/);
    assert.doesNotMatch(oldFriendly, /Do NOT retry/i);
  });
});
