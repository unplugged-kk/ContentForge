/**
 * Unit tests for Phase 5 reconciliation: the tri-state `reconcile()` result
 * handling in `reconcileUnknownPublications` (in-memory ports, no I/O). Real
 * X-specific adapter behavior (writeActionId extraction, tweet lookup) is
 * covered against real Postgres in reconcile.dbtest.ts, and end to end in the
 * live E2E harness.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Artifact, Publication, Result, Schedule } from "@shared/schema";
import type { ChannelAdapter } from "./adapters";
import {
  MAX_RECONCILE_ATTEMPTS,
  reconcileUnknownPublications,
  runPublication,
  type PublicationDeps,
  type ReconcileDeps,
} from "./publication";
import type { ContentStoragePort } from "./storage";

function unknownPublication(overrides: Partial<Publication> = {}): Publication {
  return {
    id: 1,
    userId: 1,
    scheduleId: 1,
    occurrenceId: 1,
    artifactId: 1,
    channel: "x",
    idempotencyKey: "publication:1:1:1",
    state: "failed",
    attempt: 1,
    leaseOwner: null,
    leaseExpiresAt: null,
    providerCalled: true,
    externalId: null,
    lastError: "reconcile_required",
    correlationId: "corr",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Publication;
}

function reconcileStore(options: {
  publication: Publication;
  resultMetrics?: Record<string, unknown>;
  reconcile: ChannelAdapter["reconcile"];
}) {
  const publication = { ...options.publication };
  let result: Result | undefined = {
    id: 1,
    userId: 1,
    publicationId: publication.id,
    outcome: "unknown",
    externalId: null,
    externalUrl: null,
    publishedAt: null,
    metrics: options.resultMetrics ?? {},
    source: "x",
    errorClass: "unknown",
    errorMessage: "reconcile_required",
    correlationId: "corr",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Result;

  const enqueued: number[] = [];
  const leaseAcquisitions: number[] = [];

  const content: Partial<ContentStoragePort> = {
    listUnknownPublications: async () => [publication],
    acquirePublicationLease: async (id) => {
      if (id !== publication.id) return undefined;
      leaseAcquisitions.push(id);
      publication.attempt += 1;
      publication.state = "publishing";
      return { ...publication };
    },
    getArtifact: async () =>
      ({ id: 1, readiness: "approved", format: "x_post", channel: "x", payload: { text: "hi" } }) as unknown as Artifact,
    getResultByPublication: async () => result,
    updatePublication: async (_id, patch) => {
      Object.assign(publication, patch);
      if (patch.releaseLease) {
        publication.state = patch.state ?? publication.state;
      }
    },
    insertResult: async (row) => {
      // Mirrors the real "resolve unknown in place" semantics.
      if (!result || result.outcome === "unknown") {
        result = { ...result, ...(row as Partial<Result>) } as Result;
      }
      return result;
    },
    deleteUnknownResult: async () => {
      if (result?.outcome === "unknown") {
        result = undefined;
        return true;
      }
      return false;
    },
    markOccurrenceStatus: async () => {},
    getSchedule: async () => ({ id: 1, count: 1 }) as unknown as Schedule,
    setScheduleStatus: async () => {},
  };

  const deps: ReconcileDeps = {
    content: content as ContentStoragePort,
    adapterFor: () => ({
      channel: "x",
      supports: () => true,
      publish: async () => {
        throw new Error("publish() must never be called by reconciliation");
      },
      reconcile: options.reconcile,
    }),
    enqueuePublication: async (p) => {
      enqueued.push(p.id);
      return true;
    },
  };

  return { publication: () => publication, result: () => result, enqueued, leaseAcquisitions, deps };
}

describe("reconcileUnknownPublications: tri-state handling", () => {
  it("still unknown (null): leaves the Publication and Result untouched", async () => {
    const store = reconcileStore({ publication: unknownPublication(), reconcile: async () => null });
    const out = await reconcileUnknownPublications(new Date(), store.deps);
    assert.equal(out.stillUnknown, 1);
    assert.equal(out.resolved, 0);
    assert.equal(out.requeued, 0);
    assert.equal(store.publication().state, "failed");
    assert.equal(store.result()?.outcome, "unknown");
  });

  it("confirmed published: resolves the SAME Result row to published, marks occurrence, no new row", async () => {
    const store = reconcileStore({
      publication: unknownPublication(),
      reconcile: async () => ({
        ok: true,
        providerCalled: true,
        externalId: "tweet-99",
        externalUrl: "https://x.com/i/status/tweet-99",
        publishedAt: new Date(),
      }),
    });
    const out = await reconcileUnknownPublications(new Date(), store.deps);
    assert.equal(out.resolved, 1);
    assert.equal(store.publication().state, "published");
    assert.equal(store.publication().externalId, "tweet-99");
    assert.equal(store.result()?.outcome, "published");
    assert.equal(store.result()?.externalId, "tweet-99");
  });

  it("confirmed not published: resets the Publication, clears the unknown Result, re-queues (never calls publish directly)", async () => {
    const store = reconcileStore({
      publication: unknownPublication(),
      reconcile: async () => ({
        ok: false,
        providerCalled: true,
        externalId: null,
        externalUrl: null,
        publishedAt: null,
        errorClass: "permanent",
        errorMessage: "xQuick write action failed",
      }),
    });
    const out = await reconcileUnknownPublications(new Date(), store.deps);
    assert.equal(out.requeued, 1);
    assert.equal(store.publication().state, "queued");
    assert.equal(store.publication().providerCalled, false);
    assert.equal(store.result(), undefined, "the provisional unknown Result must be cleared");
    assert.deepEqual(store.enqueued, [1], "re-queued through the durable job, not called inline");
  });

  it("durable bound: a Publication at MAX_RECONCILE_ATTEMPTS is never checked again", async () => {
    let calls = 0;
    const store = reconcileStore({
      publication: unknownPublication({ attempt: MAX_RECONCILE_ATTEMPTS }),
      reconcile: async () => {
        calls += 1;
        return null;
      },
    });
    const out = await reconcileUnknownPublications(new Date(), store.deps);
    assert.equal(out.exhausted, 1);
    assert.equal(calls, 0, "reconcile() must never be invoked past the durable bound");
    assert.equal(store.leaseAcquisitions.length, 0, "no lease is even attempted once exhausted");
  });

  it("duplicate reconciliation is harmless: a second pass on an already-published Publication finds no unknown candidates", async () => {
    const store = reconcileStore({
      publication: unknownPublication(),
      reconcile: async () => ({ ok: true, providerCalled: true, externalId: "tweet-1", externalUrl: null, publishedAt: new Date() }),
    });
    await reconcileUnknownPublications(new Date(), store.deps);
    assert.equal(store.publication().state, "published");

    // A real `listUnknownPublications` would no longer return this row (state
    // is "published", not "failed"). Simulate that by pointing the fake at an
    // empty candidate list, as the real query would.
    (store.deps.content as unknown as { listUnknownPublications: () => Promise<Publication[]> }).listUnknownPublications =
      async () => [];
    const second = await reconcileUnknownPublications(new Date(), store.deps);
    assert.deepEqual(second, { resolved: 0, requeued: 0, stillUnknown: 0, exhausted: 0 });
  });

  it("concurrency: a Publication already leased by another worker is skipped, not double-processed", async () => {
    const publication = unknownPublication();
    const content: Partial<ContentStoragePort> = {
      listUnknownPublications: async () => [publication],
      acquirePublicationLease: async () => undefined, // another worker holds it
    };
    const deps: ReconcileDeps = {
      content: content as ContentStoragePort,
      adapterFor: () => {
        throw new Error("adapter must never be looked up when the lease is not acquired");
      },
      enqueuePublication: async () => true,
    };
    const out = await reconcileUnknownPublications(new Date(), deps);
    assert.deepEqual(out, { resolved: 0, requeued: 0, stillUnknown: 0, exhausted: 0 });
  });
});

describe("runPublication: ambiguous outcome carries reconciliation continuity data", () => {
  it("persists outcome.metrics (e.g. a writeActionId) onto the unknown Result", async () => {
    const record = unknownPublication({ state: "queued", providerCalled: false, attempt: 0 });
    const results: Array<Record<string, unknown>> = [];
    const deps: PublicationDeps = {
      content: {
        getPublication: async () => record,
        getArtifact: async () =>
          ({ id: 1, readiness: "approved", format: "x_post", channel: "x", payload: { text: "hi" } }) as unknown as Artifact,
        acquirePublicationLease: async () => {
          record.state = "publishing";
          return record;
        },
        updatePublication: async (_id, patch) => Object.assign(record, patch),
        insertResult: async (row) => {
          results.push(row as Record<string, unknown>);
          return row as never;
        },
        markOccurrenceStatus: async () => {},
        getSchedule: async () => undefined,
        setScheduleStatus: async () => {},
      } as unknown as ContentStoragePort,
      adapterFor: () => ({
        channel: "x",
        supports: () => true,
        publish: async () => ({
          ok: false,
          providerCalled: true,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorMessage: "xQuick write action wa-123 is still pending after 6 checks.",
          metrics: { writeActionId: "wa-123" },
        }),
        reconcile: async () => null,
      }),
    };
    const result = await runPublication(record.id, deps);
    assert.equal(result.failureClass, "unknown");
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].metrics, { writeActionId: "wa-123" });
  });
});
