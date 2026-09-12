/**
 * DB-backed tests for the `ResearchJob → Story` slice.
 *
 * Real PostgreSQL, real schema, real FK: Story references a persisted
 * ResearchJob and its evidence by ID. Proves the transition is a read of durable
 * research — creating a Story never runs research, never creates a ResearchJob,
 * and never writes provider output.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import {
  researchEvidence,
  researchJobs,
  researchSources,
  stories,
  type ResearchJob,
} from "@shared/schema";
import { DatabaseResearchStorage } from "../research/storage";
import { DatabaseStoryStorage } from "./storage";
import {
  createStoryFromResearch,
  ResearchJobHasNoEvidenceError,
  ResearchJobNotCompleteError,
  ResearchJobNotFoundError,
  type CreateStoryDeps,
} from "./service";
import { createStoryRouter } from "./routes";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;

const RUN = `st${Date.now().toString(36)}`;

describeDb("story domain (db)", () => {
  let pool: pg.Pool;
  let db: NodePgDatabase<typeof schema>;
  let deps: CreateStoryDeps;
  let server: Server;
  let baseUrl: string;
  let seq = 0;

  async function seedJob(options: { status: string; evidence?: number }): Promise<ResearchJob> {
    seq += 1;
    const tag = `${RUN}-${seq}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: 1,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "kubernetes",
        status: options.status,
        providerIds: ["rss"],
      })
      .returning();

    const evidenceCount = options.evidence ?? 0;
    if (evidenceCount > 0) {
      const [source] = await db
        .insert(researchSources)
        .values({
          jobId: job.id,
          provider: "rss",
          backend: "rss-parser",
          kind: "article",
          nativeId: `${tag}-src`,
          canonicalUrl: `https://example.com/${tag}`,
          contentHash: "a".repeat(64),
          retrievedAt: new Date(),
        })
        .returning();

      for (let i = 0; i < evidenceCount; i += 1) {
        await db.insert(researchEvidence).values({
          jobId: job.id,
          sourceId: source.id,
          kind: "excerpt",
          origin: "sourced",
          excerpt: `${tag} excerpt ${i}`,
          excerptHash: `${tag}-${i}`.padEnd(64, "0").slice(0, 64),
          retrievedAt: new Date(),
        });
      }
    }
    return job;
  }

  async function countsForJob(jobId: number) {
    const [sources, evidence, jobs] = await Promise.all([
      db
        .select({ id: researchSources.id })
        .from(researchSources)
        .where(eq(researchSources.jobId, jobId)),
      db
        .select({ id: researchEvidence.id })
        .from(researchEvidence)
        .where(eq(researchEvidence.jobId, jobId)),
      db
        .select({ id: researchJobs.id })
        .from(researchJobs)
        .where(like(researchJobs.correlationId, `${RUN}%`)),
    ]);
    return { sources: sources.length, evidence: evidence.length, jobs: jobs.length };
  }

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });

    const storyStorage = new DatabaseStoryStorage(db);
    const researchStorage = new DatabaseResearchStorage(db);
    deps = {
      stories: storyStorage,
      research: {
        getJob: (jobId) => researchStorage.getJob(jobId),
        listEvidenceIds: (jobId) => researchStorage.listEvidenceIds(jobId),
      },
    };

    const app = express();
    app.use(express.json());
    app.use("/api/stories", createStoryRouter(deps));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (!CONNECTION) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const jobs = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(like(researchJobs.correlationId, `${RUN}%`));
    const jobIds = jobs.map((job) => job.id);
    // Stories first — the FK (ON DELETE no action) protects provenance. The
    // title sweep also removes Stories with a null research_job_id (human
    // provenance), which the FK-based delete cannot match.
    await db.delete(stories).where(like(stories.title, `${RUN}%`));
    if (jobIds.length > 0) {
      await db.delete(stories).where(inArray(stories.researchJobId, jobIds));
      await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, jobIds));
      await db.delete(researchSources).where(inArray(researchSources.jobId, jobIds));
      await db.delete(researchJobs).where(inArray(researchJobs.id, jobIds));
    }
    await pool.end();
  });

  async function postStory(body: unknown) {
    const response = await fetch(`${baseUrl}/api/stories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function getStory(id: number) {
    const response = await fetch(`${baseUrl}/api/stories/${id}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  // ── Schema ──────────────────────────────────────────────────────────────────

  it("persists a Story that references a ResearchJob", async () => {
    const job = await seedJob({ status: "complete", evidence: 1 });
    const story = await deps.stories.insertStory({
      userId: 1,
      researchJobId: job.id,
      provenance: "researched",
      title: `${RUN} schema story`,
      insightBody: "synthesized thesis",
      interpretationMarked: true,
      angles: ["angle a"],
      evidenceRefs: [],
      status: "draft",
    });

    assert.ok(story.id > 0);
    assert.equal(story.researchJobId, job.id);
    assert.equal(story.status, "draft");
  });

  it("enforces the ResearchJob foreign key", async () => {
    await assert.rejects(() =>
      deps.stories.insertStory({
        researchJobId: 2_000_000_000,
        provenance: "researched",
        title: `${RUN} dangling`,
        insightBody: "no such job",
        interpretationMarked: true,
        angles: [],
        evidenceRefs: [],
        status: "draft",
      }),
    );
  });

  it("allows a null researchJobId (human/imported provenance) but requires title and insight_body", async () => {
    const story = await deps.stories.insertStory({
      researchJobId: null,
      provenance: "human",
      title: `${RUN} human story`,
      insightBody: "author statement",
      interpretationMarked: false,
      angles: [],
      evidenceRefs: [],
      status: "draft",
    });
    assert.equal(story.researchJobId, null);

    await assert.rejects(() =>
      pool.query("insert into stories (insight_body) values ('missing title')"),
    );
    await assert.rejects(() =>
      pool.query("insert into stories (title) values ('missing insight')"),
    );
  });

  // ── Service ─────────────────────────────────────────────────────────────────

  it("creates a Story from a completed ResearchJob", async () => {
    const job = await seedJob({ status: "complete", evidence: 2 });
    const evidenceIds = await deps.research.listEvidenceIds(job.id);

    const story = await createStoryFromResearch(
      job.id,
      { title: `${RUN} service story`, insightBody: "synthesis", angles: ["hook"] },
      deps,
    );

    assert.equal(story.researchJobId, job.id);
    assert.equal(story.provenance, "researched");
    assert.equal(story.interpretationMarked, true);
    assert.deepEqual(story.evidenceRefs, evidenceIds, "defaults to the job's evidence IDs");
    assert.deepEqual(story.angles, ["hook"]);
  });

  it("rejects an incomplete ResearchJob", async () => {
    const job = await seedJob({ status: "running", evidence: 1 });
    await assert.rejects(
      () => createStoryFromResearch(job.id, { title: "t", insightBody: "b" }, deps),
      ResearchJobNotCompleteError,
    );
  });

  it("rejects a failed ResearchJob", async () => {
    const job = await seedJob({ status: "failed", evidence: 1 });
    await assert.rejects(
      () => createStoryFromResearch(job.id, { title: "t", insightBody: "b" }, deps),
      ResearchJobNotCompleteError,
    );
  });

  it("rejects a missing ResearchJob", async () => {
    await assert.rejects(
      () => createStoryFromResearch(2_000_000_000, { title: "t", insightBody: "b" }, deps),
      ResearchJobNotFoundError,
    );
  });

  it("rejects a completed ResearchJob with no evidence", async () => {
    const job = await seedJob({ status: "complete", evidence: 0 });
    await assert.rejects(
      () => createStoryFromResearch(job.id, { title: "t", insightBody: "b" }, deps),
      ResearchJobHasNoEvidenceError,
    );
  });

  it("rejects evidence refs from another ResearchJob", async () => {
    const jobA = await seedJob({ status: "complete", evidence: 1 });
    const jobB = await seedJob({ status: "complete", evidence: 1 });
    const foreign = (await deps.research.listEvidenceIds(jobB.id))[0];

    await assert.rejects(
      () =>
        createStoryFromResearch(
          jobA.id,
          { title: `${RUN} cross`, insightBody: "b", evidenceRefs: [foreign] },
          deps,
        ),
      /evidenceRefs do not belong/,
    );
  });

  it("creates multiple Stories from one ResearchJob without re-running research", async () => {
    const job = await seedJob({ status: "complete", evidence: 2 });
    const before = await countsForJob(job.id);

    const first = await createStoryFromResearch(
      job.id,
      { title: `${RUN} multi A`, insightBody: "A" },
      deps,
    );
    const second = await createStoryFromResearch(
      job.id,
      { title: `${RUN} multi B`, insightBody: "B" },
      deps,
    );

    assert.notEqual(first.id, second.id);
    assert.equal((await deps.stories.listStoriesByResearchJob(job.id)).length, 2);

    // Durability proof: identical research/source/evidence counts after two
    // derivations. Stories are cheap reads of durable research.
    const after = await countsForJob(job.id);
    assert.deepEqual(after, before, "no ResearchJob, source, or evidence was created");

    const reloaded = await deps.stories.getStory(first.id);
    assert.equal(reloaded?.researchJobId, job.id);
  });

  // ── API ─────────────────────────────────────────────────────────────────────

  it("POST /api/stories creates a Story and GET /api/stories/:id returns it", async () => {
    const job = await seedJob({ status: "complete", evidence: 2 });

    const created = await postStory({
      researchJobId: job.id,
      title: `${RUN} api story`,
      insightBody: "api synthesis",
      angles: ["api angle"],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.researchJobId, job.id);
    assert.equal(created.body.status, "draft");
    assert.equal(created.body.provenance, "researched");
    assert.equal(created.body.interpretationMarked, true);

    const fetched = await getStory(created.body.id as number);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.id, created.body.id);
    assert.equal(fetched.body.title, `${RUN} api story`);
  });

  it("POST /api/stories returns 400 on invalid input", async () => {
    const { status } = await postStory({ researchJobId: 1, insightBody: "no title" });
    assert.equal(status, 400);
  });

  it("POST /api/stories returns 404 for a missing ResearchJob", async () => {
    const { status } = await postStory({
      researchJobId: 2_000_000_000,
      title: "x",
      insightBody: "y",
    });
    assert.equal(status, 404);
  });

  it("POST /api/stories returns 409 for an incomplete ResearchJob", async () => {
    const job = await seedJob({ status: "queued", evidence: 1 });
    const { status, body } = await postStory({
      researchJobId: job.id,
      title: "x",
      insightBody: "y",
    });
    assert.equal(status, 409);
    assert.match(String(body.message), /not "complete"/);
  });

  it("POST /api/stories returns 422 for a completed ResearchJob with no evidence", async () => {
    const job = await seedJob({ status: "complete", evidence: 0 });
    const { status } = await postStory({ researchJobId: job.id, title: "x", insightBody: "y" });
    assert.equal(status, 422);
  });

  it("GET /api/stories/:id returns 404 for an unknown story", async () => {
    const { status } = await getStory(2_000_000_000);
    assert.equal(status, 404);
  });
});
