import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../db";
import { stubConnectedAccountLookup, type CredentialStubHandle } from "../testing/unitCredentialStub";
import { createXChannelAdapter } from "./adapters";

after(async () => {
  await pool.end();
});

function req(format: string, payload: Record<string, unknown>) {
  return {
    format,
    payload,
    ownerUserId: 1,
    media: [],
  } as any;
}

describe("D24 · the X adapter refuses over-long units BEFORE the provider", () => {
  let credentials: CredentialStubHandle;

  before(() => {
    credentials = stubConnectedAccountLookup();
  });

  after(() => {
    credentials.restore();
  });

  test("W1 an over-long single post is refused without calling the provider", async () => {
    const adapter = createXChannelAdapter();
    const out = await adapter.publish(req("x_post", { text: "x".repeat(400) }));
    assert.equal(out.ok, false);
    assert.equal(out.providerCalled, false, "must not reach the provider");
    assert.equal(out.errorClass, "permanent");
    assert.match(out.errorMessage ?? "", /cut|limit|280/i);
  });

  test("W2 a 280-char unit in a 3-unit thread is refused without calling the provider", async () => {
    const adapter = createXChannelAdapter();
    const out = await adapter.publish(
      req("x_thread", { units: ["x".repeat(280), "y".repeat(100), "z".repeat(100)] }),
    );
    assert.equal(out.ok, false);
    assert.equal(out.providerCalled, false, "must not reach the provider");
    assert.match(out.errorMessage ?? "", /suffix|cut/i);
  });

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
