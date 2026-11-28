import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Artifact, Schedule } from "@shared/schema";
import { registerBuiltinChannelAdapters } from "./adapters";
import { createSchedule } from "./scheduling";
import type { ContentStoragePort } from "./storage";

registerBuiltinChannelAdapters();

function makeSchedulingStore(artifact: Artifact): ContentStoragePort {
  let nextScheduleId = 1;
  return {
    async getArtifact(id: number) {
      return id === artifact.id ? artifact : undefined;
    },
    async insertSchedule(input: {
      userId: number | null;
      artifactId: number;
      channel: string;
      intentKey?: string | null;
      recurrence: string | null;
      timezone: string;
      count: number;
      startAt: Date;
    }): Promise<Schedule> {
      return {
        id: nextScheduleId++,
        userId: input.userId,
        artifactId: input.artifactId,
        channel: input.channel,
        intentKey: input.intentKey ?? null,
        recurrence: input.recurrence,
        timezone: input.timezone,
        count: input.count,
        startAt: input.startAt,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  } as unknown as ContentStoragePort;
}

function approvedArtifact(userId: number | null): Artifact {
  return {
    id: 10,
    userId,
    generationJobId: null,
    opportunityId: 5,
    format: "x_post",
    channel: "x",
    payload: { text: "Approved post" },
    readiness: "approved",
    approvedAt: new Date(),
    supersedesId: null,
    provenance: "generated",
    attribution: [],
    attributionReason: "test",
    createdAt: new Date(),
  };
}

describe("createSchedule legacy userId binding", () => {
  it("binds a legacy userId: null artifact schedule to ownerUserId when supplied", async () => {
    const store = makeSchedulingStore(approvedArtifact(null));
    const schedule = await createSchedule(10, { ownerUserId: 42 }, { content: store });
    assert.equal(schedule.userId, 42);
  });

  it("preserves null userId on legacy artifacts when ownerUserId is omitted", async () => {
    const store = makeSchedulingStore(approvedArtifact(null));
    const schedule = await createSchedule(10, {}, { content: store });
    assert.equal(schedule.userId, null);
  });

  it("keeps artifact.userId authoritative when the artifact already has an owner", async () => {
    const store = makeSchedulingStore(approvedArtifact(7));
    const schedule = await createSchedule(10, { ownerUserId: 42 }, { content: store });
    assert.equal(schedule.userId, 7);
  });
});
