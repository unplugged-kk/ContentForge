/**
 * Unit tests for the `ResearchJob → Story` service.
 *
 * The Story service depends only on a story-write port and a read-only research
 * port. These tests use fakes, so they run without a database — the DB-backed
 * behaviour lives in `story.dbtest.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResearchJob, Story } from "@shared/schema";
import {
  createStoryFromResearch,
  InvalidStoryInputError,
  ResearchJobHasNoEvidenceError,
  ResearchJobNotCompleteError,
  ResearchJobNotFoundError,
  type CreateStoryDeps,
  type StorySynthesis,
} from "./service";
import type { InsertStoryRow, StoryStoragePort } from "./storage";

const BASE_SYNTHESIS = {
  title: "Kubernetes scheduling is changing",
  insightBody: "Scheduler plugins moved from alpha to a first-class extension point.",
};

function researchJob(overrides: Partial<ResearchJob> = {}): ResearchJob {
  return {
    id: 1,
    userId: 1,
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    kind: "directed",
    query: "kubernetes",
    status: "complete",
    initiation: {},
    diagnostics: [],
    providerIds: ["rss"],
    errorClass: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date("2026-09-10T00:00:00Z"),
    ...overrides,
  };
}

interface Harness {
  deps: CreateStoryDeps;
  inserted: InsertStoryRow[];
  researchCalls: string[];
  setJob(job: ResearchJob | undefined): void;
  setEvidence(ids: number[]): void;
}

function harness(jobValue: ResearchJob | undefined, evidenceIds: number[]): Harness {
  let job = jobValue;
  let evidence = evidenceIds;
  const inserted: InsertStoryRow[] = [];
  const researchCalls: string[] = [];
  let seq = 1;

  const stories: StoryStoragePort = {
    async insertStory(row: InsertStoryRow): Promise<Story> {
      inserted.push(row);
      return {
        id: seq++,
        userId: row.userId ?? null,
        researchJobId: row.researchJobId,
        provenance: row.provenance,
        title: row.title,
        insightBody: row.insightBody,
        interpretationMarked: row.interpretationMarked,
        angles: row.angles,
        evidenceRefs: row.evidenceRefs,
        status: row.status,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    async getStory() {
      return undefined;
    },
    async listStoriesByResearchJob() {
      return [];
    },
    async updateStoryStatus() {
      return undefined;
    },
  };

  const research: CreateStoryDeps["research"] = {
    async getJob(id) {
      researchCalls.push(`getJob:${id}`);
      return job;
    },
    async listEvidenceIds(id) {
      researchCalls.push(`listEvidenceIds:${id}`);
      return evidence;
    },
  };

  return {
    deps: { stories, research },
    inserted,
    researchCalls,
    setJob: (value) => {
      job = value;
    },
    setEvidence: (value) => {
      evidence = value;
    },
  };
}

describe("createStoryFromResearch", () => {
  it("creates a Story from a completed ResearchJob and preserves researchJobId", async () => {
    const h = harness(researchJob({ id: 42 }), [10, 11]);
    const story = await createStoryFromResearch(42, BASE_SYNTHESIS, h.deps);

    assert.equal(story.researchJobId, 42);
    assert.equal(story.provenance, "researched");
    assert.equal(story.status, "draft");
    assert.equal(story.interpretationMarked, true);
    assert.equal(h.inserted.length, 1);
    assert.equal(h.inserted[0].researchJobId, 42);
    assert.equal(h.inserted[0].userId, 1, "inherits the research owner");
  });

  it("defaults evidenceRefs to the job's full evidence set (IDs only)", async () => {
    const h = harness(researchJob(), [10, 11, 12]);
    const story = await createStoryFromResearch(1, BASE_SYNTHESIS, h.deps);
    assert.deepEqual(story.evidenceRefs, [10, 11, 12]);
  });

  it("accepts an explicit subset of evidenceRefs and de-duplicates", async () => {
    const h = harness(researchJob(), [10, 11, 12]);
    const story = await createStoryFromResearch(
      1,
      { ...BASE_SYNTHESIS, evidenceRefs: [12, 10, 12] },
      h.deps,
    );
    assert.deepEqual(story.evidenceRefs, [12, 10]);
  });

  it("rejects evidenceRefs that do not belong to the ResearchJob", async () => {
    const h = harness(researchJob(), [10, 11]);
    await assert.rejects(
      () => createStoryFromResearch(1, { ...BASE_SYNTHESIS, evidenceRefs: [99] }, h.deps),
      InvalidStoryInputError,
    );
    assert.equal(h.inserted.length, 0);
  });

  it("rejects an explicitly empty evidenceRefs list", async () => {
    const h = harness(researchJob(), [10, 11]);
    await assert.rejects(
      () => createStoryFromResearch(1, { ...BASE_SYNTHESIS, evidenceRefs: [] }, h.deps),
      InvalidStoryInputError,
    );
  });

  it("rejects a nonexistent ResearchJob and never reads evidence", async () => {
    const h = harness(undefined, []);
    await assert.rejects(
      () => createStoryFromResearch(7, BASE_SYNTHESIS, h.deps),
      ResearchJobNotFoundError,
    );
    assert.deepEqual(h.researchCalls, ["getJob:7"]);
    assert.equal(h.inserted.length, 0);
  });

  for (const status of ["queued", "running", "failed", "cancelled"]) {
    it(`rejects a ${status} ResearchJob`, async () => {
      const h = harness(researchJob({ status }), [10]);
      await assert.rejects(
        () => createStoryFromResearch(1, BASE_SYNTHESIS, h.deps),
        (error: unknown) =>
          error instanceof ResearchJobNotCompleteError && error.status === status,
      );
      assert.equal(h.inserted.length, 0);
    });
  }

  it("rejects a completed ResearchJob with no usable output", async () => {
    const h = harness(researchJob(), []);
    await assert.rejects(
      () => createStoryFromResearch(1, BASE_SYNTHESIS, h.deps),
      ResearchJobHasNoEvidenceError,
    );
    assert.equal(h.inserted.length, 0);
  });

  it("rejects invalid input before loading the ResearchJob", async () => {
    const h = harness(researchJob(), [10]);
    await assert.rejects(
      () => createStoryFromResearch(1, { ...BASE_SYNTHESIS, title: "   " }, h.deps),
      InvalidStoryInputError,
    );
    await assert.rejects(
      () => createStoryFromResearch(1, { ...BASE_SYNTHESIS, insightBody: "" }, h.deps),
      InvalidStoryInputError,
    );
    assert.equal(h.researchCalls.length, 0, "validation happens before any read");
  });

  it("rejects invalid researchJobId values", async () => {
    const h = harness(researchJob(), [10]);
    for (const id of [0, -3, 1.5, Number.NaN]) {
      await assert.rejects(
        () => createStoryFromResearch(id, BASE_SYNTHESIS, h.deps),
        InvalidStoryInputError,
      );
    }
  });

  it("cannot create a Story directly as used or archived", async () => {
    const h = harness(researchJob(), [10]);
    for (const status of ["used", "archived"]) {
      await assert.rejects(
        () =>
          createStoryFromResearch(
            1,
            { ...BASE_SYNTHESIS, status } as unknown as StorySynthesis,
            h.deps,
          ),
        InvalidStoryInputError,
      );
    }
    assert.equal(h.inserted.length, 0);
  });

  it("allows multiple Stories from the same ResearchJob without re-running research", async () => {
    const h = harness(researchJob({ id: 5 }), [10, 11]);

    const first = await createStoryFromResearch(5, { ...BASE_SYNTHESIS, title: "Angle A" }, h.deps);
    const second = await createStoryFromResearch(5, { ...BASE_SYNTHESIS, title: "Angle B" }, h.deps);

    assert.equal(h.inserted.length, 2, "two Stories persisted");
    assert.notEqual(first.id, second.id);
    assert.deepEqual(
      h.inserted.map((row) => row.researchJobId),
      [5, 5],
    );

    // The only research interaction is reading the job and its evidence IDs.
    // There is no provider execution and no ResearchJob creation anywhere in
    // the deps surface, so a Story can never trigger new research.
    assert.deepEqual(Object.keys(h.deps.research).sort(), ["getJob", "listEvidenceIds"]);
    assert.deepEqual(h.researchCalls, [
      "getJob:5",
      "listEvidenceIds:5",
      "getJob:5",
      "listEvidenceIds:5",
    ]);
  });
});
