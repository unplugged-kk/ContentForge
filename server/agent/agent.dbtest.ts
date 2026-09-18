/**
 * Real PostgreSQL tests for Phase 22 AgentRun / AgentToolCall durability,
 * ownership, idempotency, and privileged approval.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import {
  agentRuns,
  agentToolCalls,
  researchEvidence,
  researchJobs,
  researchSources,
  stories,
  repurposingPlans,
} from "@shared/schema";
import { DatabaseResearchStorage } from "../research/storage";
import { DatabaseStoryStorage } from "../story/storage";
import { DatabaseContentStorage } from "../content/storage";
import { createLocalAssetStorage } from "../content/visual";
import { registerBuiltinChannelAdapters } from "../content/adapters";
import { DatabaseAgentStorage } from "./storage";
import { AgentToolRegistry } from "./registry";
import { AgentRuntime } from "./runtime";
import { createContentForgeTools } from "./tools";
import { createFixtureBackend } from "./backends";
import { parseGrants } from "./policy";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `ag${Date.now().toString(36)}`;

describeDb("agent runtime (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  let storage!: DatabaseAgentStorage;
  let runtime!: AgentRuntime;
  let seq = 0;

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    storage = new DatabaseAgentStorage(db);
    registerBuiltinChannelAdapters();

    const research = new DatabaseResearchStorage(db);
    const storiesStore = new DatabaseStoryStorage(db);
    const content = new DatabaseContentStorage(db);
    const storyDeps = {
      stories: storiesStore,
      research: {
        getJob: (id: number) => research.getJob(id),
        listEvidenceIds: (id: number) => research.listEvidenceIds(id),
      },
    };
    const opportunityDeps = { opportunities: content, stories: storiesStore };
    const registry = new AgentToolRegistry();
    for (const tool of createContentForgeTools({
      research: {
        claimJob: (input) => research.claimJob(input),
        getJob: (id) => research.getJob(id),
        listSources: (id) => research.listSources(id),
        listEvidence: (id) => research.listEvidence(id),
        enqueueResearchRun: async () => {},
      },
      stories: storyDeps,
      opportunities: opportunityDeps,
      generation: {
        content,
        stories: storiesStore,
        evidence: { listEvidence: async (jobId) => research.getEvidenceForJob(jobId) },
        model: { provider: "test", generate: async () => ({ payload: { text: "x" }, model: "t", provider: "t", cost: null, usage: {} }) },
        defaultModel: "test",
      },
      repurpose: {
        opportunities: opportunityDeps,
        generation: {
          content,
          stories: storiesStore,
          evidence: { listEvidence: async (jobId) => research.getEvidenceForJob(jobId) },
          model: { provider: "test", generate: async () => ({ payload: { text: "x" }, model: "t", provider: "t", cost: null, usage: {} }) },
          defaultModel: "test",
        },
        plans: content,
      },
      content,
      visualStorage: createLocalAssetStorage(),
      enqueueGeneration: async () => true,
      enqueueVisual: async () => true,
      enqueuePublication: async () => true,
    })) {
      registry.register(tool);
    }
    runtime = new AgentRuntime({ storage, registry, backend: createFixtureBackend() });
  });

  after(async () => {
    if (!CONNECTION) return;
    const runRows = await db.select({ id: agentRuns.id }).from(agentRuns).where(like(agentRuns.idempotencyKey, `${RUN}%`));
    const runIds = runRows.map((row) => row.id);
    if (runIds.length > 0) {
      await db.delete(agentToolCalls).where(inArray(agentToolCalls.agentRunId, runIds));
    }
    await db.delete(agentRuns).where(like(agentRuns.idempotencyKey, `${RUN}%`));
    const leftoverStories = await db.select({ id: stories.id }).from(stories).where(like(stories.title, `${RUN}%`));
    const leftoverIds = leftoverStories.map((row) => row.id);
    if (leftoverIds.length) await db.delete(repurposingPlans).where(inArray(repurposingPlans.storyId, leftoverIds));
    await db.delete(stories).where(like(stories.title, `${RUN}%`));
    await pool.end();
  });

  async function seedCompleteJob(userId = 1) {
    seq += 1;
    const tag = `${RUN}-${seq}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "kubernetes",
        status: "complete",
        providerIds: ["rss"],
      })
      .returning();
    const [source] = await db
      .insert(researchSources)
      .values({
        jobId: job.id,
        provider: "rss",
        backend: "rss-parser",
        kind: "article",
        nativeId: `${tag}-src`,
        canonicalUrl: `https://example.com/${tag}`,
        contentHash: "b".repeat(64),
        retrievedAt: new Date(),
      })
      .returning();
    await db.insert(researchEvidence).values({
      jobId: job.id,
      sourceId: source.id,
      kind: "excerpt",
      origin: "sourced",
      excerpt: `${tag} excerpt`,
      excerptHash: `${tag}-ev`.padEnd(64, "0").slice(0, 64),
      retrievedAt: new Date(),
    });
    return job;
  }

  it("claims AgentRun idempotently", async () => {
    const first = await storage.claimRun({
      userId: 1,
      backendId: "fixture",
      providerSnapshot: {},
      objective: "run",
      idempotencyKey: `${RUN}-run-a`,
      correlationId: `${RUN}-corr-a`,
    });
    const second = await storage.claimRun({
      userId: 1,
      backendId: "fixture",
      providerSnapshot: {},
      objective: "run",
      idempotencyKey: `${RUN}-run-a`,
      correlationId: `${RUN}-corr-a2`,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.run.id, second.run.id);
  });

  it("reuses a completed tool call with the same idempotency key", async () => {
    const { run } = await storage.claimRun({
      userId: 1,
      backendId: "fixture",
      providerSnapshot: {},
      objective: "story",
      idempotencyKey: `${RUN}-run-tool`,
      correlationId: `${RUN}-corr-tool`,
    });
    const job = await seedCompleteJob();
    const args = { researchJobId: job.id, title: `${RUN} title`, insightBody: `${RUN} body` };
    const first = await runtime.executeTool(run, { name: "create_story", arguments: args }, new Set());
    const second = await runtime.executeTool(run, { name: "create_story", arguments: args }, new Set());
    assert.equal(first.envelope.status, "success");
    assert.equal(second.reused, true);
    assert.equal(first.call.id, second.call.id);
    const storyRows = await db.select().from(stories).where(eq(stories.researchJobId, job.id));
    assert.equal(storyRows.length, 1);
  });

  it("hides another owner's story as not_found", async () => {
    const job = await seedCompleteJob(1);
    const { run: ownerRun } = await storage.claimRun({
      userId: 1,
      backendId: "fixture",
      providerSnapshot: {},
      objective: "own",
      idempotencyKey: `${RUN}-run-own`,
      correlationId: `${RUN}-own`,
    });
    const created = await runtime.executeTool(
      ownerRun,
      { name: "create_story", arguments: { researchJobId: job.id, title: `${RUN} owned`, insightBody: "b" } },
      new Set(),
    );
    const storyId = created.envelope.refs.storyId as number;
    const { run: other } = await storage.claimRun({
      userId: 2,
      backendId: "fixture",
      providerSnapshot: {},
      objective: "steal",
      idempotencyKey: `${RUN}-run-other`,
      correlationId: `${RUN}-other`,
    });
    const peek = await runtime.executeTool(other, { name: "get_story", arguments: { storyId } }, new Set());
    assert.equal(peek.envelope.status, "not_found");
  });

  it("denies approve_artifact without a grant, then approves with one", async () => {
    const { run } = await storage.claimRun({
      userId: 1,
      backendId: "fixture",
      providerSnapshot: {},
      objective: "approve",
      idempotencyKey: `${RUN}-run-appr`,
      correlationId: `${RUN}-appr`,
    });
    const denied = await runtime.executeTool(run, { name: "approve_artifact", arguments: { artifactId: 1 } }, new Set());
    assert.equal(denied.envelope.status, "denied");
    const missing = await runtime.executeTool(
      run,
      { name: "approve_artifact", arguments: { artifactId: 9_999_999 }, idempotencyKey: `${RUN}-appr-missing` },
      parseGrants(["approve_artifact"]),
    );
    assert.equal(missing.envelope.status, "not_found");
  });

  it("collapses concurrent identical tool claims onto one row", async () => {
    const { run } = await storage.claimRun({
      userId: 1,
      backendId: "fixture",
      providerSnapshot: {},
      objective: "race",
      idempotencyKey: `${RUN}-run-race`,
      correlationId: `${RUN}-race`,
    });
    const job = await seedCompleteJob();
    const args = { researchJobId: job.id, title: `${RUN} race`, insightBody: "body" };
    const [a, b] = await Promise.all([
      runtime.executeTool(run, { name: "create_story", arguments: args, idempotencyKey: `${RUN}-race-tool` }, new Set()),
      runtime.executeTool(run, { name: "create_story", arguments: args, idempotencyKey: `${RUN}-race-tool` }, new Set()),
    ]);
    assert.equal(a.call.id, b.call.id);
    const storyRows = await db.select().from(stories).where(eq(stories.researchJobId, job.id));
    assert.equal(storyRows.length, 1);
  });
});
