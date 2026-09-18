/**
 * Unit tests for Phase 16 multi-channel distribution.
 *
 * Generation still requires a format profile (`formatChannelError`).
 * Distribution of an existing Artifact uses `channelSupportsFormat` only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Artifact, Publication, Schedule } from "@shared/schema";
import type { ContentStoragePort, InsertScheduleRow } from "./storage";
import { channelSupportsFormat, getChannelAdapter, registerBuiltinChannelAdapters } from "./adapters";
import { formatChannelError } from "./opportunity";
import { ArtifactNotFoundError } from "./artifact";
import { ArtifactNotSchedulableError, createSchedule, ScheduleInputError } from "./scheduling";
import {
  distributionIntentKey,
  publishArtifactToChannels,
  DistributionInputError,
} from "./distribution";

registerBuiltinChannelAdapters();

let seq = 0;
const next = () => ++seq;

function approvedArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 1,
    userId: 1,
    generationJobId: null,
    opportunityId: 1,
    format: "x_post",
    channel: "x",
    payload: { text: "shared revision" },
    readiness: "approved",
    approvedAt: new Date(),
    supersedesId: null,
    provenance: "generated",
    attribution: [],
    attributionReason: null,
    createdAt: new Date(),
    ...overrides,
  } as Artifact;
}

function memoryDistributionStore(artifact: Artifact) {
  const schedules: Schedule[] = [];
  const publications: Publication[] = [];
  const byIntent = new Map<string, Schedule>();

  const store = {
    async getArtifact(id: number) {
      return artifact.id === id ? artifact : undefined;
    },
    async getArtifactForOwner(id: number, ownerId: number) {
      if (artifact.id !== id) return undefined;
      if (artifact.userId !== ownerId) return undefined;
      return artifact;
    },
    async insertSchedule(row: InsertScheduleRow): Promise<Schedule> {
      const s = {
        id: next(),
        userId: row.userId ?? null,
        artifactId: row.artifactId,
        channel: row.channel,
        intentKey: row.intentKey ?? null,
        recurrence: row.recurrence,
        timezone: row.timezone,
        count: row.count,
        startAt: row.startAt,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Schedule;
      schedules.push(s);
      if (s.intentKey) byIntent.set(s.intentKey, s);
      return s;
    },
    async claimSchedule(row: InsertScheduleRow) {
      if (row.intentKey && byIntent.has(row.intentKey)) {
        return { schedule: byIntent.get(row.intentKey)!, created: false };
      }
      return { schedule: await this.insertSchedule(row), created: true };
    },
    async getScheduleByIntentKey(intentKey: string) {
      return byIntent.get(intentKey);
    },
    async getSchedule(id: number) {
      return schedules.find((s) => s.id === id);
    },
    async listSchedulesByArtifact(artifactId: number) {
      return schedules.filter((s) => s.artifactId === artifactId);
    },
    async listPublicationsByArtifact(artifactId: number) {
      return publications.filter((p) => p.artifactId === artifactId);
    },
    async listActiveSchedules() {
      return [] as Schedule[];
    },
    async listDueOccurrences() {
      return [];
    },
    schedules,
    publications,
  };

  return store as unknown as ContentStoragePort & typeof store;
}

describe("format vs channel", () => {
  it("generation still refuses x_post×linkedin (no format profile)", () => {
    assert.match(String(formatChannelError("x_post", "linkedin")), /cannot target channel/);
    assert.equal(formatChannelError("x_post", "x"), null);
    assert.equal(formatChannelError("x_post", "threads"), null);
    assert.equal(formatChannelError("image", "instagram"), null);
    assert.equal(formatChannelError("linkedin_post", "linkedin"), null);
  });

  it("distribution allows compatible { text } formats on both registered adapters", () => {
    assert.equal(channelSupportsFormat("x", "x_post"), true);
    assert.equal(channelSupportsFormat("x", "linkedin_post"), true);
    assert.equal(channelSupportsFormat("linkedin", "linkedin_post"), true);
    assert.equal(channelSupportsFormat("linkedin", "x_post"), true);
    assert.equal(channelSupportsFormat("threads", "x_post"), true);
    assert.equal(channelSupportsFormat("threads", "linkedin_post"), true);
    assert.equal(channelSupportsFormat("threads", "x_thread"), false);
    assert.equal(channelSupportsFormat("linkedin", "image"), false);
    assert.equal(channelSupportsFormat("linkedin", "x_thread"), false);
    assert.equal(channelSupportsFormat("x", "carousel"), false);
    assert.equal(channelSupportsFormat("instagram", "image"), true);
    assert.equal(channelSupportsFormat("instagram", "carousel"), true);
    assert.equal(channelSupportsFormat("instagram", "x_post"), false);
    assert.equal(channelSupportsFormat("instagram", "x_thread"), false);
    assert.equal(channelSupportsFormat("instagram", "thumbnail"), false);
    assert.equal(channelSupportsFormat("threads", "image"), false);
    assert.equal(channelSupportsFormat("x", "video"), true, "video is generation-ready on x");
    assert.equal(channelSupportsFormat("instagram", "video"), false, "Reels publishing is deferred");
  });

  it("x adapter refuses to publish video without calling a provider", async () => {
    registerBuiltinChannelAdapters();
    const adapter = getChannelAdapter("x");
    const outcome = await adapter.publish({
      format: "video",
      channel: "x",
      payload: { visualAssetId: 1 },
      correlationId: "c",
      media: [],
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.equal(outcome.errorClass, "permanent");
    assert.match(String(outcome.errorMessage), /not implemented/);
  });
});

describe("distributionIntentKey", () => {
  it("is stable for the same revision, channel, and schedule shape", () => {
    const a = distributionIntentKey({
      artifactId: 9,
      channel: "x",
      count: 1,
      nonce: "default",
    });
    const b = distributionIntentKey({
      artifactId: 9,
      channel: "x",
      count: 1,
      nonce: "default",
    });
    assert.equal(a, b);
    assert.notEqual(
      a,
      distributionIntentKey({ artifactId: 9, channel: "linkedin", count: 1, nonce: "default" }),
    );
    assert.notEqual(
      a,
      distributionIntentKey({ artifactId: 9, channel: "x", count: 1, nonce: "again" }),
    );
  });
});

describe("createSchedule channel override", () => {
  it("pins Schedule.channel independently of Artifact.channel", async () => {
    const artifact = approvedArtifact();
    const store = memoryDistributionStore(artifact);
    const schedule = await createSchedule(
      artifact.id,
      { channel: "linkedin" },
      { content: store },
    );
    assert.equal(schedule.channel, "linkedin");
    assert.equal(artifact.channel, "x");
  });

  it("rejects incompatible format×channel at the schedule boundary", async () => {
    const artifact = approvedArtifact({ format: "image" });
    const store = memoryDistributionStore(artifact);
    await assert.rejects(
      () => createSchedule(artifact.id, { channel: "linkedin" }, { content: store }),
      ScheduleInputError,
    );
  });
});

describe("publishArtifactToChannels", () => {
  it("fans one Artifact revision out to X, LinkedIn, and Threads without cloning it", async () => {
    const artifact = approvedArtifact();
    const store = memoryDistributionStore(artifact);
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "linkedin" }, { channel: "threads" }] },
      { content: store },
    );
    assert.equal(result.outcomes.length, 3);
    assert.ok(result.outcomes.every((o) => o.status === "created"));
    assert.deepEqual(result.outcomes.map((o) => o.schedule?.channel).sort(), ["linkedin", "threads", "x"]);
    assert.equal(new Set(result.outcomes.map((o) => o.schedule?.id)).size, 3);
    assert.equal(store.schedules.length, 3);
  });

  it("collapses duplicate targets in one request and is idempotent across requests", async () => {
    const artifact = approvedArtifact();
    const store = memoryDistributionStore(artifact);
    const first = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "x" }, { channel: "linkedin" }] },
      { content: store },
    );
    assert.equal(first.outcomes.filter((o) => o.status === "created").length, 2);
    assert.equal(first.outcomes.filter((o) => o.status === "reused").length, 1);
    const second = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "linkedin" }] },
      { content: store },
    );
    assert.ok(second.outcomes.every((o) => o.status === "reused"));
    assert.equal(store.schedules.length, 2);
    assert.equal(second.outcomes[0].schedule?.id, first.outcomes[0].schedule?.id);
  });

  it("explicit republishKey creates a new logical Publication intent", async () => {
    const artifact = approvedArtifact();
    const store = memoryDistributionStore(artifact);
    const first = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }] },
      { content: store },
    );
    const second = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }], republishKey: "again" },
      { content: store },
    );
    assert.equal(second.outcomes[0].status, "created");
    assert.notEqual(second.outcomes[0].schedule?.id, first.outcomes[0].schedule?.id);
    assert.equal(store.schedules.length, 2);
  });

  it("does not force incompatible formats onto a channel", async () => {
    const artifact = approvedArtifact({ format: "x_thread" });
    const store = memoryDistributionStore(artifact);
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "linkedin" }] },
      { content: store },
    );
    assert.equal(result.outcomes[0].status, "created");
    assert.equal(result.outcomes[1].status, "invalid");
    assert.match(String(result.outcomes[1].error), /cannot be distributed/);
    assert.equal(store.schedules.length, 1);
  });

  it("keeps sibling schedule state independent", async () => {
    const artifact = approvedArtifact();
    const store = memoryDistributionStore(artifact);
    const t1 = "2026-09-17T09:00:00.000Z";
    const t2 = "2026-09-17T12:00:00.000Z";
    const result = await publishArtifactToChannels(
      artifact.id,
      {
        targets: [
          { channel: "x", startAt: t1 },
          { channel: "linkedin", startAt: t2 },
        ],
      },
      { content: store },
    );
    assert.equal(result.outcomes[0].schedule?.startAt.toISOString(), t1);
    assert.equal(result.outcomes[1].schedule?.startAt.toISOString(), t2);
    result.outcomes[0].schedule!.status = "cancelled";
    assert.equal(result.outcomes[1].schedule?.status, "active");
  });

  it("requires Artifact approval (canonical content approval)", async () => {
    const artifact = approvedArtifact({ readiness: "draft" });
    const store = memoryDistributionStore(artifact);
    await assert.rejects(
      () =>
        publishArtifactToChannels(
          artifact.id,
          { targets: [{ channel: "x" }] },
          { content: store },
        ),
      ArtifactNotSchedulableError,
    );
  });

  it("does not leak a foreign Artifact (same 404 as missing)", async () => {
    const artifact = approvedArtifact({ userId: 2 });
    const store = memoryDistributionStore(artifact);
    await assert.rejects(
      () =>
        publishArtifactToChannels(
          artifact.id,
          { targets: [{ channel: "x" }] },
          { content: store },
          1,
        ),
      ArtifactNotFoundError,
    );
  });

  it("rejects an empty target list", async () => {
    const artifact = approvedArtifact();
    const store = memoryDistributionStore(artifact);
    await assert.rejects(
      () => publishArtifactToChannels(artifact.id, { targets: [] }, { content: store }),
      DistributionInputError,
    );
  });
});
