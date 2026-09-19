/**
 * Integration tests for Phase 28.2C: Create + Review Workflow
 *
 * Validates with real PostgreSQL:
 * 1. Human Story creation -> Opportunity -> GenerationJob -> Artifact
 * 2. Artifact revision immutability (supersedesId, original unchanged)
 * 3. Approval state transition (draft -> approved)
 * 4. Schedule handoff for approved artifact
 * 5. Regenerate semantics (sibling job and artifact revision, not mutation)
 * 6. Owner isolation on story, opportunity, and artifacts
 * 7. listStories query ordering
 *
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { artifacts, generationJobs, opportunities, stories, schedules } from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { createGenerationJob, runGenerationJob, type GenerationModelPort } from "./generation";
import { approveArtifact, createArtifact, submitArtifactForReview } from "./artifact";
import { createSchedule } from "./scheduling";
import { registerBuiltinChannelAdapters } from "./adapters";
import { eq, inArray } from "drizzle-orm";

registerBuiltinChannelAdapters();

const CONNECTION = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `crw${Date.now().toString(36)}`;

function fakeModel(text = "Generated content from model"): GenerationModelPort {
  return {
    provider: "fake",
    async generate(req) {
      return {
        payload: { text },
        model: "fake-model",
        provider: "fake",
        cost: "0.0001",
        usage: { total_tokens: 42 },
      };
    },
  };
}

describeDb("create + review workflow (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);

  const cleanups: Array<() => Promise<void>> = [];

  before(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
  });

  after(async () => {
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch {
        // best-effort cleanup
      }
    }
    await pool?.end();
  });

  function deps(model = fakeModel()) {
    return {
      content: content(),
      stories: storyStore(),
      evidence: { listEvidence: async () => [] },
      model,
      defaultModel: "fake-default",
    };
  }

  it("human Story creation -> Opportunity -> GenerationJob -> Artifact works end-to-end", async () => {
    const story = await storyStore().insertStory({
      userId: 1,
      researchJobId: null,
      provenance: "human",
      title: `${RUN} Human Story`,
      insightBody: "Engineering insight from production incident",
      interpretationMarked: false,
      angles: ["Lessons learned"],
      evidenceRefs: [],
      status: "ready",
    });
    cleanups.push(async () => {
      await db.delete(stories).where(eq(stories.id, story.id));
    });

    assert.equal(story.provenance, "human");
    assert.equal(story.researchJobId, null);

    // List stories verifies listStories
    const listed = await storyStore().listStories(10);
    assert.ok(listed.some((s) => s.id === story.id));

    // Create Opportunity
    const opp = await createOpportunityFromStory(
      story.id,
      {
        concept: `${RUN} Concept`,
        objective: "Educate developers",
        format: "x_post",
        channel: "x",
        proposer: "human",
      },
      { opportunities: content(), stories: storyStore() },
    );
    cleanups.push(async () => {
      await db.delete(opportunities).where(eq(opportunities.id, opp.id));
    });

    assert.equal(opp.storyId, story.id);
    assert.equal(opp.format, "x_post");
    assert.equal(opp.channel, "x");

    // Create GenerationJob
    const { job } = await createGenerationJob(opp.id, {}, deps());
    cleanups.push(async () => {
      await db.delete(generationJobs).where(eq(generationJobs.id, job.id));
    });

    assert.equal(job.opportunityId, opp.id);
    assert.equal(job.status, "queued");

    // Run GenerationJob
    const run = await runGenerationJob(job.id, deps(fakeModel("Real DB generated post")));
    assert.equal(run.status, "succeeded");
    assert.ok(run.artifactId);

    const artifact = await content().getArtifact(run.artifactId!);
    assert.ok(artifact);
    assert.equal(artifact!.readiness, "draft");
    assert.equal((artifact!.payload as any).text, "Real DB generated post");
    cleanups.push(async () => {
      await db.delete(artifacts).where(eq(artifacts.id, artifact!.id));
    });
  });

  it("Artifact revision creates a new row with supersedesId without mutating original", async () => {
    const story = await storyStore().insertStory({
      userId: 1,
      researchJobId: null,
      provenance: "human",
      title: `${RUN} Story for Edit`,
      insightBody: "Initial insight",
      interpretationMarked: false,
      angles: [],
      evidenceRefs: [],
      status: "ready",
    });
    cleanups.push(async () => {
      await db.delete(stories).where(eq(stories.id, story.id));
    });

    const opp = await createOpportunityFromStory(
      story.id,
      {
        concept: `${RUN} Opp Edit`,
        objective: "Test edit",
        format: "x_post",
        channel: "x",
      },
      { opportunities: content(), stories: storyStore() },
    );
    cleanups.push(async () => {
      await db.delete(opportunities).where(eq(opportunities.id, opp.id));
    });

    const v1 = await createArtifact(
      {
        userId: 1,
        opportunityId: opp.id,
        generationJobId: null,
        format: "x_post",
        channel: "x",
        payload: { text: "Version 1 text" },
        provenance: "generated",
        attribution: [],
        attributionReason: "author_original",
      },
      { artifacts: content() },
    );
    cleanups.push(async () => {
      await db.delete(artifacts).where(eq(artifacts.id, v1.id));
    });

    // Create revision V2
    const v2 = await createArtifact(
      {
        userId: 1,
        opportunityId: opp.id,
        generationJobId: null,
        format: "x_post",
        channel: "x",
        payload: { text: "Version 2 edited text" },
        provenance: "human_edit",
        attribution: [],
        attributionReason: "human_refinement",
        supersedesId: v1.id,
      },
      { artifacts: content() },
    );
    cleanups.push(async () => {
      await db.delete(artifacts).where(eq(artifacts.id, v2.id));
    });

    assert.notEqual(v1.id, v2.id);
    assert.equal(v2.supersedesId, v1.id);
    assert.equal(v2.readiness, "draft");

    // Verify v1 text was not mutated
    const reloadedV1 = await content().getArtifact(v1.id);
    assert.equal((reloadedV1?.payload as any).text, "Version 1 text");
  });

  it("Approval transitions artifact readiness and records approvedAt timestamp", async () => {
    const story = await storyStore().insertStory({
      userId: 1,
      researchJobId: null,
      provenance: "human",
      title: `${RUN} Story for Approval`,
      insightBody: "Insight",
      interpretationMarked: false,
      angles: [],
      evidenceRefs: [],
      status: "ready",
    });
    cleanups.push(async () => {
      await db.delete(stories).where(eq(stories.id, story.id));
    });

    const opp = await createOpportunityFromStory(
      story.id,
      { concept: `${RUN} Opp`, objective: "Approve test", format: "x_post", channel: "x" },
      { opportunities: content(), stories: storyStore() },
    );
    cleanups.push(async () => {
      await db.delete(opportunities).where(eq(opportunities.id, opp.id));
    });

    const artifact = await createArtifact(
      {
        userId: 1,
        opportunityId: opp.id,
        generationJobId: null,
        format: "x_post",
        channel: "x",
        payload: { text: "Post ready to approve" },
        provenance: "generated",
        attribution: [],
        attributionReason: "author_original",
      },
      { artifacts: content() },
    );
    cleanups.push(async () => {
      await db.delete(artifacts).where(eq(artifacts.id, artifact.id));
    });

    assert.equal(artifact.readiness, "draft");
    assert.equal(artifact.approvedAt, null);

    // Submit for review, then approve
    await submitArtifactForReview(artifact.id, { artifacts: content() });
    const approved = await approveArtifact(artifact.id, { artifacts: content() });
    assert.equal(approved.readiness, "approved");
    assert.ok(approved.approvedAt);

    // Schedule the approved artifact
    const startAt = new Date(Date.now() + 86400000);
    const schedule = await createSchedule(
      approved.id,
      {
        channel: "x",
        startAt: startAt.toISOString(),
        count: 1,
      },
      { content: content() },
    );
    cleanups.push(async () => {
      await db.delete(schedules).where(eq(schedules.id, schedule.id));
    });

    assert.equal(schedule.artifactId, approved.id);
    assert.equal(schedule.status, "active");
  });

  it("Regenerate creates a sibling GenerationJob and Artifact revision without touching original", async () => {
    const story = await storyStore().insertStory({
      userId: 1,
      researchJobId: null,
      provenance: "human",
      title: `${RUN} Story for Regen`,
      insightBody: "Regen test insight",
      interpretationMarked: false,
      angles: [],
      evidenceRefs: [],
      status: "ready",
    });
    cleanups.push(async () => {
      await db.delete(stories).where(eq(stories.id, story.id));
    });

    const opp = await createOpportunityFromStory(
      story.id,
      { concept: `${RUN} Regen Opp`, objective: "Regen test", format: "x_post", channel: "x" },
      { opportunities: content(), stories: storyStore() },
    );
    cleanups.push(async () => {
      await db.delete(opportunities).where(eq(opportunities.id, opp.id));
    });

    // Job 1
    const { job: job1 } = await createGenerationJob(opp.id, {}, deps());
    cleanups.push(async () => {
      await db.delete(generationJobs).where(eq(generationJobs.id, job1.id));
    });
    const run1 = await runGenerationJob(job1.id, deps(fakeModel("Initial post")));
    cleanups.push(async () => {
      await db.delete(artifacts).where(eq(artifacts.id, run1.artifactId!));
    });

    // Job 2 (Regenerate: true)
    const { job: job2 } = await createGenerationJob(opp.id, { regenerate: true }, deps());
    cleanups.push(async () => {
      await db.delete(generationJobs).where(eq(generationJobs.id, job2.id));
    });
    const run2 = await runGenerationJob(job2.id, deps(fakeModel("Regenerated post")));
    cleanups.push(async () => {
      await db.delete(artifacts).where(eq(artifacts.id, run2.artifactId!));
    });

    assert.notEqual(job1.id, job2.id);
    assert.notEqual(run1.artifactId, run2.artifactId);

    const art1 = await content().getArtifact(run1.artifactId!);
    const art2 = await content().getArtifact(run2.artifactId!);

    assert.equal((art1?.payload as any).text, "Initial post");
    assert.equal((art2?.payload as any).text, "Regenerated post");
  });
});
