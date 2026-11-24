/**
 * D24 wiring test — does the X adapter actually REFUSE an over-long unit before
 * calling the provider?
 *
 * The suite in xTextLimits.test.ts proves the validator works. This proves the
 * adapter USES it, which is a different assertion and the one that failed in run
 * 32 ("measured last run, enforced by nothing").
 *
 * Subject = the adapter's own PublishOutcome. No provider is configured on this
 * host, so a unit that reaches the provider fails with a credentials/config error
 * while a unit refused by the gate returns `providerCalled: false`. That
 * difference is the observable.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createXChannelAdapter } from "./adapters";

function req(format: string, payload: Record<string, unknown>) {
  return {
    format,
    payload,
    ownerUserId: 1,
    media: [],
  } as any;
}

describe("D24 · the X adapter refuses over-long units BEFORE the provider", () => {
  test("W1 an over-long single post is refused without calling the provider", async () => {
    const adapter = createXChannelAdapter();
    const out = await adapter.publish(req("x_post", { text: "x".repeat(400) }));
    assert.equal(out.ok, false);
    assert.equal(out.providerCalled, false, "must not reach the provider");
    assert.equal(out.errorClass, "permanent");
    assert.match(out.errorMessage ?? "", /cut|limit|280/i);
  });

  /**
   * W2 — the case a flat-280 check would have shipped: 280 chars is legal as
   * submitted, but a 3-unit thread numbers it and destroys characters.
   */
  test("W2 a 280-char unit in a 3-unit thread is refused without calling the provider", async () => {
    const adapter = createXChannelAdapter();
    const out = await adapter.publish(
      req("x_thread", { units: ["x".repeat(280), "y".repeat(100), "z".repeat(100)] }),
    );
    assert.equal(out.ok, false);
    assert.equal(out.providerCalled, false, "must not reach the provider");
    assert.match(out.errorMessage ?? "", /suffix|cut/i);
  });

  /**
   * W3 — the control. A legal payload must NOT be refused by the length gate; it
   * should get past the gate and fail later (config), which is a DIFFERENT
   * observable. If W3 ever starts failing with providerCalled:false and a
   * length message, the gate has become always-fail.
   */
  test("W3 a legal thread is NOT refused by the length gate", async () => {
    const adapter = createXChannelAdapter();
    const out = await adapter.publish(
      req("x_thread", { units: ["a".repeat(100), "b".repeat(100), "c".repeat(100)] }),
    );
    const refusedByLength = /cut|suffix|limit \d+|empty/i.test(out.errorMessage ?? "");
    if (out.ok === false && out.providerCalled === false) {
      assert.equal(
        refusedByLength,
        false,
        `legal payload must not be refused by the length gate: ${out.errorMessage}`,
      );
    }
  });

  test("W4 an empty x_post is still refused as unusable", async () => {
    const adapter = createXChannelAdapter();
    const out = await adapter.publish(req("x_post", { text: "   " }));
    assert.equal(out.ok, false);
    assert.equal(out.providerCalled, false);
  });
});
