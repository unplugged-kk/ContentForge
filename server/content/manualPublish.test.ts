import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Artifact, Publication, Result, Schedule, ScheduleOccurrence } from "@shared/schema";
import { ArtifactNotFoundError } from "./artifact";
import { ArtifactNotSchedulableError } from "./scheduling";
import {
  logManualPublication,
  ManualPublishInputError,
} from "./manualPublish";
import type { ContentStoragePort } from "./storage";

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 42,
    userId: 7,
    generationJobId: 10,
    opportunityId: 5,
    format: "x_thread",
    channel: "x",
    payload: { units: ["Hook", "Takeaway"] },
    readiness: "approved",
    approvedAt: new Date("2026-11-20T10:00:00Z"),
    supersedesId: null,
    provenance: "human_edit",
    attribution: [],
    attributionReason: null,
    createdAt: new Date("2026-11-20T09:00:00Z"),
    ...overrides,
  };
}

function makeMemoryContentStore(seedArtifacts: Artifact[]) {
  const artifactMap = new Map<number, Artifact>(seedArtifacts.map((a) => [a.id, a]));
  const scheduleById = new Map<number, Schedule>();
  const scheduleByIntent = new Map<string, Schedule>();
  const occurrenceById = new Map<number, ScheduleOccurrence>();
  const occurrenceByKey = new Map<string, ScheduleOccurrence>();
  const publicationById = new Map<number, Publication>();
  const publicationByKey = new Map<string, Publication>();
  const resultByPubId = new Map<number, Result>();

  let nextId = 100;

  const store = {
    async getArtifact(id: number) {
      return artifactMap.get(id);
    },
    async claimSchedule(row: Parameters<ContentStoragePort["claimSchedule"]>[0]) {
      if (row.intentKey && scheduleByIntent.has(row.intentKey)) {
        return { schedule: scheduleByIntent.get(row.intentKey)!, created: false };
      }
      const now = new Date();
      const schedule: Schedule = {
        id: ++nextId,
        userId: row.userId ?? null,
        artifactId: row.artifactId,
        channel: row.channel,
        intentKey: row.intentKey ?? null,
        recurrence: row.recurrence,
        timezone: row.timezone,
        count: row.count,
        startAt: row.startAt,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      scheduleById.set(schedule.id, schedule);
      if (schedule.intentKey) scheduleByIntent.set(schedule.intentKey, schedule);
      return { schedule, created: true };
    },
    async setScheduleStatus(id: number, status: string) {
      const existing = scheduleById.get(id);
      if (existing) existing.status = status;
    },
    async materializeOccurrence(scheduleId: number, at: Date) {
      const key = `${scheduleId}:${at.getTime()}`;
      if (occurrenceByKey.has(key)) return occurrenceByKey.get(key)!;
      const occurrence: ScheduleOccurrence = {
        id: ++nextId,
        scheduleId,
        occurrenceTime: at,
        status: "pending",
        createdAt: new Date(),
      };
      occurrenceById.set(occurrence.id, occurrence);
      occurrenceByKey.set(key, occurrence);
      return occurrence;
    },
    async markOccurrenceStatus(id: number, status: string) {
      const existing = occurrenceById.get(id);
      if (existing) existing.status = status;
    },
    async claimPublication(row: Parameters<ContentStoragePort["claimPublication"]>[0]) {
      if (publicationByKey.has(row.idempotencyKey)) {
        return { publication: publicationByKey.get(row.idempotencyKey)!, created: false };
      }
      const now = new Date();
      const publication: Publication = {
        id: ++nextId,
        userId: row.userId ?? null,
        scheduleId: row.scheduleId,
        occurrenceId: row.occurrenceId,
        artifactId: row.artifactId,
        channel: row.channel,
        idempotencyKey: row.idempotencyKey,
        state: "queued",
        attempt: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        providerCalled: false,
        externalId: null,
        lastError: null,
        correlationId: row.correlationId,
        createdAt: now,
        updatedAt: now,
      };
      publicationById.set(publication.id, publication);
      publicationByKey.set(publication.idempotencyKey, publication);
      return { publication, created: true };
    },
    async updatePublication(
      id: number,
      patch: Parameters<ContentStoragePort["updatePublication"]>[1],
    ) {
      const pub = publicationById.get(id);
      if (!pub) return;
      if (patch.state !== undefined) pub.state = patch.state;
      if (patch.providerCalled !== undefined) pub.providerCalled = patch.providerCalled;
      if (patch.externalId !== undefined) pub.externalId = patch.externalId;
      if (patch.lastError !== undefined) pub.lastError = patch.lastError;
      if (patch.releaseLease) {
        pub.leaseOwner = null;
        pub.leaseExpiresAt = null;
      }
    },
    async getPublication(id: number) {
      return publicationById.get(id);
    },
    async insertResult(row: Parameters<ContentStoragePort["insertResult"]>[0]) {
      if (resultByPubId.has(row.publicationId)) {
        return resultByPubId.get(row.publicationId)!;
      }
      const now = new Date();
      const result: Result = {
        id: ++nextId,
        userId: row.userId ?? null,
        publicationId: row.publicationId,
        outcome: row.outcome,
        externalId: row.externalId,
        externalUrl: row.externalUrl,
        publishedAt: row.publishedAt,
        metrics: row.metrics,
        source: row.source,
        errorClass: row.errorClass,
        errorMessage: row.errorMessage,
        correlationId: row.correlationId,
        createdAt: now,
        updatedAt: now,
      };
      resultByPubId.set(row.publicationId, result);
      return result;
    },
    async getResultByPublication(publicationId: number) {
      return resultByPubId.get(publicationId);
    },
  } as unknown as ContentStoragePort;

  return {
    store,
    counts: () => ({
      schedules: scheduleById.size,
      occurrences: occurrenceById.size,
      publications: publicationById.size,
      results: resultByPubId.size,
    }),
  };
}

describe("manual publish logging (INC-08)", () => {
  it("logs an approved artifact into canonical Schedule/Publication/Result and returns publicationId", async () => {
    const { store, counts } = makeMemoryContentStore([makeArtifact()]);
    const recorded: Array<{ pubId: number; outcome: string | null }> = [];

    const outcome = await logManualPublication(
      42,
      7,
      {
        externalUrl: "https://x.com/operator/status/123456789",
        publishedAt: "2026-11-25T15:30:00Z",
        topicTag: "postgres-pooling",
        hookType: "metric",
        notes: "Posted manually after export",
      },
      {
        content: store,
        learning: {
          recordEdit: async () => {},
          recordApproval: async () => {},
          recordPublication: async (pub, res) => {
            recorded.push({ pubId: pub.id, outcome: res?.outcome ?? null });
          },
        },
      },
    );

    assert.equal(outcome.created, true);
    assert.ok(outcome.publication.id > 0);
    assert.equal(outcome.publication.state, "published");
    assert.equal(outcome.publication.providerCalled, false);
    assert.equal(outcome.publication.channel, "x");
    assert.equal(outcome.schedule.status, "exhausted");
    assert.equal(outcome.occurrence.status, "published");
    assert.equal(outcome.result?.outcome, "published");
    assert.equal(outcome.result?.source, "manual");
    assert.equal(outcome.result?.externalUrl, "https://x.com/operator/status/123456789");
    assert.deepEqual(outcome.result?.metrics.rawResponse, {
      source: "manual",
      topicTag: "postgres-pooling",
      hookType: "metric",
      notes: "Posted manually after export",
    });
    assert.deepEqual(counts(), { schedules: 1, occurrences: 1, publications: 1, results: 1 });
    assert.deepEqual(recorded, [{ pubId: outcome.publication.id, outcome: "published" }]);
  });

  it("rejects draft, in_review, and rejected artifacts without creating records", async () => {
    for (const readiness of ["draft", "in_review", "rejected"] as const) {
      const { store, counts } = makeMemoryContentStore([makeArtifact({ id: 50, readiness })]);
      await assert.rejects(
        () => logManualPublication(50, 7, { externalUrl: "https://x.com/a/status/1" }, { content: store }),
        (err: unknown) => err instanceof ArtifactNotSchedulableError && err.readiness === readiness,
      );
      assert.deepEqual(counts(), { schedules: 0, occurrences: 0, publications: 0, results: 0 });
    }
  });

  it("rejects a foreign owner with ArtifactNotFoundError (non-leaking)", async () => {
    const { store, counts } = makeMemoryContentStore([makeArtifact({ id: 42, userId: 7 })]);
    await assert.rejects(
      () => logManualPublication(42, 99, { externalUrl: "https://x.com/a/status/1" }, { content: store }),
      (err: unknown) => err instanceof ArtifactNotFoundError,
    );
    assert.deepEqual(counts(), { schedules: 0, occurrences: 0, publications: 0, results: 0 });
  });

  it("rejects non-http/https and malformed URLs", async () => {
    const { store, counts } = makeMemoryContentStore([makeArtifact()]);
    for (const badUrl of ["not-a-url", "javascript:alert(1)", "ftp://example.com/post"]) {
      await assert.rejects(
        () => logManualPublication(42, 7, { externalUrl: badUrl }, { content: store }),
        (err: unknown) => err instanceof ManualPublishInputError,
      );
    }
    assert.deepEqual(counts(), { schedules: 0, occurrences: 0, publications: 0, results: 0 });
  });

  it("replays idempotently for the same (artifactId, externalUrl) without duplicating records", async () => {
    const { store, counts } = makeMemoryContentStore([makeArtifact()]);
    let tick = 0;
    const clock = () => new Date(Date.parse("2026-11-25T10:00:00Z") + tick++ * 60_000);

    const first = await logManualPublication(
      42,
      7,
      { externalUrl: "https://x.com/operator/status/999", topicTag: "mlops", hookType: "contrarian" },
      { content: store, now: clock },
    );
    const second = await logManualPublication(
      42,
      7,
      { externalUrl: "https://x.com/operator/status/999", topicTag: "mlops", hookType: "contrarian" },
      { content: store, now: clock },
    );

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.publication.id, first.publication.id);
    assert.equal(second.schedule.id, first.schedule.id);
    assert.equal(second.occurrence.id, first.occurrence.id);
    assert.equal(second.result?.id, first.result?.id);
    assert.deepEqual(counts(), { schedules: 1, occurrences: 1, publications: 1, results: 1 });
  });

  it("replays idempotently by explicit idempotencyKey and creates distinct rows for distinct keys", async () => {
    const { store, counts } = makeMemoryContentStore([makeArtifact()]);

    const first = await logManualPublication(
      42,
      7,
      { idempotencyKey: "export-batch-1", notes: "First manual share" },
      { content: store },
    );
    const replay = await logManualPublication(
      42,
      7,
      { idempotencyKey: "export-batch-1", notes: "First manual share" },
      { content: store },
    );
    const distinct = await logManualPublication(
      42,
      7,
      { idempotencyKey: "export-batch-2", notes: "Second manual share" },
      { content: store },
    );

    assert.equal(replay.created, false);
    assert.equal(replay.publication.id, first.publication.id);
    assert.equal(distinct.created, true);
    assert.notEqual(distinct.publication.id, first.publication.id);
    assert.deepEqual(counts(), { schedules: 2, occurrences: 2, publications: 2, results: 2 });
  });
});
