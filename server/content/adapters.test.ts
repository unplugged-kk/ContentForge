import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { pool } from "../db";
import { storage } from "../storage";
import {
  createInstagramChannelAdapter,
  createLinkedInChannelAdapter,
  createThreadsChannelAdapter,
  createXChannelAdapter,
  classifyInstagramFailure,
  classifyThreadsFailure,
  classifyXFailure,
  classifyYouTubeFailure,
  type PublishRequest,
} from "./adapters";

after(async () => {
  await pool.end();
});

const request = (format: string, channel: string, payload: Record<string, unknown> = {}): PublishRequest => ({
  format,
  channel,
  payload: { text: "controlled test", ...payload },
  correlationId: "phase331-test",
  ownerUserId: 987654,
});

describe("publication adapter pre-flight configuration failures", () => {
  it("classifies X configuration failure without claiming a provider call", async () => {
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      networkCalls += 1;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      const outcome = await createXChannelAdapter().publish(request("x_post", "x"));
      assert.equal(outcome.ok, false);
      assert.equal(outcome.providerCalled, false);
      assert.equal(outcome.errorClass, "policy_human");
      assert.match(outcome.errorMessage ?? "", /credentials missing/i);
      assert.equal(networkCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(classifyXFailure("XQUICK_CONFIG_MISSING"), "policy_human");
  });

  it("classifies Threads configuration failure without claiming a provider call", async () => {
    const outcome = await createThreadsChannelAdapter().publish(request("x_post", "threads"));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.equal(outcome.errorClass, "policy_human");
    assert.equal(classifyThreadsFailure("THREADS_CONFIG_MISSING"), "policy_human");
  });

  it("classifies LinkedIn configuration failure without claiming a provider call", async () => {
    const outcome = await createLinkedInChannelAdapter().publish(request("linkedin_post", "linkedin"));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.equal(outcome.errorClass, "policy_human");
  });

  it("uses the publication owner for X metric credential lookup", async () => {
    const originalUnscopedLookup = storage.getConnectedAccount;
    const originalScopedLookup = storage.getConnectedAccountForOwner;
    const unscopedOwners: Array<number | undefined> = [];
    const scopedOwners: number[] = [];
    storage.getConnectedAccount = async () => {
      unscopedOwners.push(undefined);
      return undefined;
    };
    storage.getConnectedAccountForOwner = async (_platform, ownerUserId) => {
      scopedOwners.push(ownerUserId);
      return undefined;
    };

    try {
      await createXChannelAdapter().fetchMetrics?.({
        channel: "x",
        externalId: "123456789",
        publicationId: 1,
        correlationId: "phase331-metrics-owner",
        ownerUserId: 987654,
      });
      assert.deepEqual({ unscopedOwners, scopedOwners }, { unscopedOwners: [], scopedOwners: [987654] });
    } finally {
      storage.getConnectedAccount = originalUnscopedLookup;
      storage.getConnectedAccountForOwner = originalScopedLookup;
    }
  });

  it("keeps Instagram and YouTube setup errors deterministic", () => {
    assert.equal(classifyInstagramFailure("INSTAGRAM_CONFIG_MISSING"), "policy_human");
    assert.equal(classifyYouTubeFailure("YOUTUBE_CONFIG_MISSING"), "policy_human");
  });
});
