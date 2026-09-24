import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { pool } from "../db";
import { createXChannelAdapter } from "./adapters";
import { runPublication } from "./publication";

after(async () => {
  await pool.end();
});

describe("runPublication configuration failure classification", () => {
  it("records a deterministic failed result and never an unknown reconciliation result", async () => {
    const updates: any[] = [];
    const results: any[] = [];
    const publication = {
      id: 101,
      userId: 7,
      artifactId: 201,
      scheduleId: 301,
      channel: "x",
      state: "queued",
      attempt: 0,
      providerCalled: false,
      externalId: null,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      idempotencyKey: "phase331-config-failure",
      correlationId: "phase331-config-failure",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const deps = {
      content: {
        getPublication: async () => publication,
        getArtifact: async () => ({
          id: 201,
          userId: 7,
          readiness: "approved",
          format: "x_post",
          payload: { text: "controlled publication" },
        }),
        acquirePublicationLease: async () => publication,
        updatePublication: async (_id: number, patch: unknown) => updates.push(patch),
        insertResult: async (result: unknown) => results.push(result),
        getVisualAsset: async () => undefined,
        getSchedule: async () => null,
        setScheduleStatus: async () => undefined,
      },
      adapterFor: () => createXChannelAdapter(),
    } as any;

    const result = await runPublication(101, deps);

    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "policy_human");
    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, "failed");
    assert.equal(results[0].errorClass, "policy_human");
    assert.equal(updates.some((update) => update.providerCalled === true), false);
  });
});
