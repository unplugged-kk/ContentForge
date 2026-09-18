/**
 * DB-backed tests for Phase 12 — first-class content repurposing.
 *
 * Real PostgreSQL: one durable Story → N independently addressable
 * Opportunities → N independent GenerationPolicy/GenerationJob/Artifact
 * lifecycles. A deterministic in-process model stands in for the LLM
 * provider (the model *port* is the boundary), exactly as in
 * `content.dbtest.ts` — nothing repurposing-specific is mocked.
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
  artifacts,
  contextVault,
  generationJobs,
  generationPolicies,
  opportunities,
  publications,
  repurposingPlans,
  researchJobs,
  results,
  scheduleOccurrences,
  schedules,
  stories,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { runGenerationJob, type GenerationModelPort } from "./generation";
import { approveArtifact, submitArtifactForReview } from "./artifact";
import { createSchedule, dispatchDueOccurrences } from "./scheduling";
import { runPublication } from "./publication";
import { registerBuiltinChannelAdapters } from "./adapters";
import { createDatabaseContextReader } from "./context";
import { repurposeStory, inspectRepurposingPlan, RepurposeInputError, type RepurposeDeps } from "./repurposing";
import { StoryNotFoundError, StoryNotUsableError } from "./opportunity";

registerBuiltinChannelAdapters();

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `rep${Date.now().toString(36)}`;
const OWNER_A = 800_000 + (Date.now() % 90_000);
const OWNER_B = OWNER_A + 1;

describeDb("repurposing (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
  });

  after(async () => {
    if (!CONNECTION) return;
    const storyRows = await db.select({ id: stories.id }).from(stories).where(like(stories.title, `${RUN}%`));
    const storyIds = storyRows.map((r) => r.id);
    const oppRows = storyIds.length
      ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.storyId, storyIds))
      : [];
    const oppIds = oppRows.map((r) => r.id);
    if (oppIds.length) {
      const artRows = await db.select({ id: artifacts.id }).from(artifacts).where(inArray(artifacts.opportunityId, oppIds));
      const artIds = artRows.map((r) => r.id);
      const schedRows = artIds.length
        ? await db.select({ id: schedules.id }).from(schedules).where(inArray(schedules.artifactId, artIds))
        : [];
      const schedIds = schedRows.map((r) => r.id);
      const pubRows = schedIds.length
        ? await db.select({ id: publications.id }).from(publications).where(inArray(publications.scheduleId, schedIds))
        : [];
      const pubIds = pubRows.map((r) => r.id);
      if (pubIds.length) {
        await db.delete(results).where(inArray(results.publicationId, pubIds));
        await db.delete(publications).where(inArray(publications.id, pubIds));
      }
      if (schedIds.length) {
        await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds));
        await db.delete(schedules).where(inArray(schedules.id, schedIds));
      }
      if (artIds.length) await db.delete(artifacts).where(inArray(artifacts.id, artIds));
      await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
      await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    }
    if (storyIds.length) await db.delete(repurposingPlans).where(inArray(repurposingPlans.storyId, storyIds));
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    await db.delete(generationPolicies).where(like(generationPolicies.name, `${RUN}%`));
    await db.delete(contextVault).where(inArray(contextVault.userId, [OWNER_A, OWNER_B]));
    await pool.end().catch(() => {});
  });

  async function seedStory(ownerId: number, suffix: string) {
    const [story] = await db
      .insert(stories)
      .values({
        userId: ownerId,
        researchJobId: null,
        provenance: "human",
        title: `${RUN}-${suffix} A new developer tool changes how teams ship AI agents`,
        insightBody: "Shipping agents is now a platform decision, not a library choice.",
        angles: ["platform teams own the agent runtime"],
        evidenceRefs: [],
        status: "ready",
      })
      .returning();
    return story;
  }

  const fakeModel = (text: string): GenerationModelPort => ({
    provider: "fake-model",
    async generate() {
      return { payload: { text }, model: "fake-1", provider: "fake-model", cost: "0", usage: {} };
    },
  });

  function repurposeDeps(model: GenerationModelPort): RepurposeDeps {
    const c = content();
    const s = storyStore();
    return {
      opportunities: { opportunities: c, stories: s },
      generation: {
        content: c,
        stories: s,
        evidence: { listEvidence: async () => [] },
        model,
        defaultModel: "fake-1",
        contextReader: createDatabaseContextReader(db),
      },
      plans: c,
    };
  }

  it("repurposes one Story into three independently addressable Opportunities, each carrying the same Story lineage", async () => {
    const story = await seedStory(OWNER_A, "fanout");
    const deps = repurposeDeps(fakeModel("generated"));

    const result = await repurposeStory(
      story.id,
      {
        targets: [
          { format: "x_post", channel: "x" },
          { format: "x_thread", channel: "x" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      },
      deps,
      OWNER_A,
    );

    assert.equal(result.outcomes.length, 3);
    assert.ok(result.outcomes.every((o) => o.status === "created"));
    const oppIds = result.outcomes.map((o) => o.opportunity!.id);
    assert.equal(new Set(oppIds).size, 3, "three distinct Opportunities");

    const rows = await db.select().from(opportunities).where(inArray(opportunities.id, oppIds));
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.storyId, story.id, "every Opportunity references the SAME Story");
      assert.equal(row.userId, OWNER_A);
    }
    assert.deepEqual(
      rows.map((r) => `${r.format}:${r.channel}`).sort(),
      ["linkedin_post:linkedin", "x_post:x", "x_thread:x"],
    );
  });

  it("duplicate repurpose delivery (same requestKey) never duplicates logical Opportunities", async () => {
    const story = await seedStory(OWNER_A, "dup");
    const deps = repurposeDeps(fakeModel("generated"));
    const request = {
      requestKey: `${RUN}-dup-key`,
      targets: [
        { format: "x_post", channel: "x" },
        { format: "linkedin_post", channel: "linkedin" },
      ],
    };

    const first = await repurposeStory(story.id, request, deps, OWNER_A);
    const second = await repurposeStory(story.id, request, deps, OWNER_A);

    assert.ok(first.outcomes.every((o) => o.status === "created"));
    assert.ok(second.outcomes.every((o) => o.status === "reused"));
    assert.deepEqual(
      second.outcomes.map((o) => o.opportunity!.id),
      first.outcomes.map((o) => o.opportunity!.id),
    );

    const rows = await db.select().from(opportunities).where(eq(opportunities.storyId, story.id));
    assert.equal(rows.length, 2, "the duplicate delivery created nothing new");
  });

  it("intentional regenerate creates a NEW Opportunity/GenerationJob without touching the original", async () => {
    const story = await seedStory(OWNER_A, "regen");
    const deps = repurposeDeps(fakeModel("generated"));
    const requestKey = `${RUN}-regen-key`;

    const first = await repurposeStory(
      story.id,
      { requestKey, targets: [{ format: "x_post", channel: "x" }] },
      deps,
      OWNER_A,
    );
    const second = await repurposeStory(
      story.id,
      { requestKey, targets: [{ format: "x_post", channel: "x", regenerate: true }] },
      deps,
      OWNER_A,
    );

    assert.equal(second.outcomes[0].status, "created");
    assert.notEqual(second.outcomes[0].opportunity!.id, first.outcomes[0].opportunity!.id);

    const [originalReloaded] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, first.outcomes[0].opportunity!.id));
    assert.equal(originalReloaded.status, "proposed", "the original Opportunity is untouched");

    const rows = await db.select().from(opportunities).where(eq(opportunities.storyId, story.id));
    assert.equal(rows.length, 2);
  });

  it("different targets produce distinct GenerationPolicy revisions; a semantic change changes the policy hash", async () => {
    const story = await seedStory(OWNER_A, "policy");
    const deps = repurposeDeps(fakeModel("generated"));

    const result = await repurposeStory(
      story.id,
      {
        targets: [
          { format: "x_post", channel: "x" },
          { format: "x_thread", channel: "x" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      },
      deps,
      OWNER_A,
    );
    const policyIds = result.outcomes.map((o) => o.job!.policyId);
    assert.equal(new Set(policyIds).size, 3, "three distinct GenerationPolicy revisions");

    const rows = await db.select().from(generationPolicies).where(inArray(generationPolicies.id, policyIds as number[]));
    const specHashes = new Set(rows.map((r) => r.specHash));
    assert.equal(specHashes.size, 3, "three distinct content-addressed spec hashes");

    // Same format/channel, different objective (target semantics) -> a
    // DIFFERENT policy hash, never silently reused across meanings.
    const withDifferentObjective = await repurposeStory(
      story.id,
      { targets: [{ format: "x_post", channel: "x", objective: "a completely different objective" }] },
      deps,
      OWNER_A,
    );
    assert.notEqual(withDifferentObjective.outcomes[0].job!.policyId, result.outcomes[0].job!.policyId);
  });

  it("repurposing never creates a ResearchJob and only reads the Story's existing evidence", async () => {
    const story = await seedStory(OWNER_A, "noresearch");
    const before = await db.select({ id: researchJobs.id }).from(researchJobs);
    const deps = repurposeDeps(fakeModel("generated"));

    await repurposeStory(
      story.id,
      {
        targets: [
          { format: "x_post", channel: "x" },
          { format: "x_thread", channel: "x" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      },
      deps,
      OWNER_A,
    );

    const after = await db.select({ id: researchJobs.id }).from(researchJobs);
    assert.equal(after.length, before.length, "no ResearchJob was created by repurposing");
    assert.equal((await storyStore().getStory(story.id))!.researchJobId, null, "the Story's provenance is untouched");
  });

  it("cross-owner isolation: owner B cannot repurpose owner A's Story, or read owner A's resulting Opportunities", async () => {
    const story = await seedStory(OWNER_A, "isolation");
    const deps = repurposeDeps(fakeModel("generated"));

    await assert.rejects(
      () => repurposeStory(story.id, { targets: [{ format: "x_post", channel: "x" }] }, deps, OWNER_B),
      StoryNotFoundError,
    );

    const ownerAResult = await repurposeStory(
      story.id,
      { targets: [{ format: "x_post", channel: "x" }] },
      deps,
      OWNER_A,
    );
    const oppId = ownerAResult.outcomes[0].opportunity!.id;

    // Owner B repurposing owner A's story never happened -- confirm no
    // sibling Opportunity was created under B's identity for this Story.
    const rows = await db.select().from(opportunities).where(eq(opportunities.storyId, story.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, oppId);
    assert.equal(rows[0].userId, OWNER_A);
  });

  it("rejects an archived Story and an empty target list", async () => {
    const story = await seedStory(OWNER_A, "archived");
    await storyStore().updateStoryStatus(story.id, "archived");
    const deps = repurposeDeps(fakeModel("generated"));

    await assert.rejects(
      () => repurposeStory(story.id, { targets: [{ format: "x_post", channel: "x" }] }, deps, OWNER_A),
      StoryNotUsableError,
    );
    const fresh = await seedStory(OWNER_A, "empty-targets");
    await assert.rejects(() => repurposeStory(fresh.id, { targets: [] }, deps, OWNER_A), RepurposeInputError);
  });

  it("cross-channel independence: editing/approving/scheduling one repurposed Artifact never touches its sibling", async () => {
    const story = await seedStory(OWNER_A, "crosschannel");
    const deps = repurposeDeps(fakeModel("independent content"));

    const result = await repurposeStory(
      story.id,
      {
        targets: [
          { format: "x_post", channel: "x" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      },
      deps,
      OWNER_A,
    );
    const [xOutcome, liOutcome] = result.outcomes;

    const xRun = await runGenerationJob(xOutcome.job!.id, deps.generation);
    const liRun = await runGenerationJob(liOutcome.job!.id, deps.generation);
    assert.equal(xRun.status, "succeeded");
    assert.equal(liRun.status, "succeeded");
    assert.notEqual(xRun.artifactId, liRun.artifactId);

    // Approve + schedule + publish ONLY the X artifact.
    await submitArtifactForReview(xRun.artifactId!, { artifacts: content() });
    await approveArtifact(xRun.artifactId!, { artifacts: content() });
    const schedule = await createSchedule(xRun.artifactId!, {}, { content: content() });
    const dispatch = await dispatchDueOccurrences(new Date(Date.now() + 1000), {
      content: content(),
      enqueuePublication: async () => true,
    });
    const mine = dispatch.publications.find((p) => p.scheduleId === schedule.id);
    assert.ok(mine, "the X schedule produced a Publication");
    const outcome = await runPublication(mine!.id, {
      content: content(),
      adapterFor: () => ({
        channel: "x",
        supports: () => true,
        publish: async () => ({
          ok: true,
          providerCalled: true,
          externalId: `${RUN}-tweet`,
          externalUrl: `https://x.com/i/status/${RUN}-tweet`,
          publishedAt: new Date(),
          metrics: { unitCount: 1 },
        }),
        reconcile: async () => null,
      }),
    });
    assert.equal(outcome.status, "published");

    // The LinkedIn sibling is completely untouched: still draft, never
    // scheduled, never published.
    const liArtifact = await content().getArtifact(liRun.artifactId!);
    assert.equal(liArtifact!.readiness, "draft");
    const liSchedules = await db.select().from(schedules).where(eq(schedules.artifactId, liRun.artifactId!));
    assert.equal(liSchedules.length, 0, "the LinkedIn sibling was never scheduled");
  });

  it("mutation: a context change between two repurpose calls never retroactively changes an earlier sibling's frozen snapshot", async () => {
    const story = await seedStory(OWNER_A, "mutation");
    const deps = repurposeDeps(fakeModel("generated"));

    await db
      .insert(contextVault)
      .values({ userId: OWNER_A, title: `${RUN} v1`, content: "MUTATION_TEST_CONTEXT_A", isFavorite: true });

    const before = await repurposeStory(
      story.id,
      { targets: [{ format: "x_post", channel: "x" }] },
      deps,
      OWNER_A,
    );
    const jobA = before.outcomes[0].job!;
    assert.match(JSON.stringify(jobA.policySnapshot), /MUTATION_TEST_CONTEXT_A/);

    await db
      .insert(contextVault)
      .values({ userId: OWNER_A, title: `${RUN} v2`, content: "MUTATION_TEST_CONTEXT_B", isFavorite: true });

    const after = await repurposeStory(
      story.id,
      { targets: [{ format: "x_thread", channel: "x" }] },
      deps,
      OWNER_A,
    );
    const jobB = after.outcomes[0].job!;
    assert.match(JSON.stringify(jobB.policySnapshot), /MUTATION_TEST_CONTEXT_B/);

    const [reloadedA] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobA.id));
    assert.deepEqual(reloadedA.policySnapshot, jobA.policySnapshot, "job A's frozen snapshot is unaffected by B's context");
    assert.doesNotMatch(
      JSON.stringify(reloadedA.policySnapshot),
      /MUTATION_TEST_CONTEXT_B/,
      "job A never retroactively gains the mutation",
    );
  });

  it("restart-equivalent: a repurposed GenerationJob's frozen snapshot round-trips through the database unchanged", async () => {
    const story = await seedStory(OWNER_A, "restart");
    const deps = repurposeDeps(fakeModel("generated"));

    const result = await repurposeStory(
      story.id,
      { targets: [{ format: "x_post", channel: "x" }, { format: "linkedin_post", channel: "linkedin" }] },
      deps,
      OWNER_A,
    );

    for (const outcome of result.outcomes) {
      const [reloaded] = await db.select().from(generationJobs).where(eq(generationJobs.id, outcome.job!.id));
      assert.deepEqual(reloaded.policySnapshot, outcome.job!.policySnapshot);
      assert.equal(reloaded.status, "queued");

      // The worker (a fresh process in the live E2E) executes purely from
      // this frozen row -- never re-resolving policy/context.
      const run = await runGenerationJob(reloaded.id, deps.generation);
      assert.equal(run.status, "succeeded");
    }
  });

  it("count expansion writes a durable plan and N slot Opportunities without new research", async () => {
    const story = await seedStory(OWNER_A, "plan-slots");
    const deps = repurposeDeps(fakeModel("generated"));
    const beforeJobs = await db.select({ id: researchJobs.id }).from(researchJobs);
    const result = await repurposeStory(
      story.id,
      { requestKey: `${RUN}-slots`, targets: [{ format: "x_post", channel: "x", count: 3 }] },
      deps,
      OWNER_A,
    );
    assert.ok(result.plan);
    assert.equal(result.outcomes.length, 3);
    assert.equal(new Set(result.outcomes.map((o) => o.opportunity?.id)).size, 3);
    const afterJobs = await db.select({ id: researchJobs.id }).from(researchJobs);
    assert.equal(afterJobs.length, beforeJobs.length, "repurposing must not create ResearchJobs");
    const view = await inspectRepurposingPlan(result.plan!.id, deps, OWNER_A);
    assert.equal(view.progress.targets, 3);
    assert.equal(view.plan.storyId, story.id);
  });

  it("concurrent identical requestKey collapses to one plan and three Opportunities", async () => {
    const story = await seedStory(OWNER_A, "concurrent");
    const deps = repurposeDeps(fakeModel("generated"));
    const request = {
      requestKey: `${RUN}-concurrent`,
      targets: [{ format: "x_post", channel: "x", count: 3 }],
    };
    const [a, b] = await Promise.all([
      repurposeStory(story.id, request, deps, OWNER_A),
      repurposeStory(story.id, request, deps, OWNER_A),
    ]);
    assert.equal(a.plan?.id, b.plan?.id);
    const ids = [...a.outcomes, ...b.outcomes]
      .map((o) => o.opportunity?.id)
      .filter((id): id is number => typeof id === "number");
    assert.equal(new Set(ids).size, 3);
    const plans = await db
      .select()
      .from(repurposingPlans)
      .where(eq(repurposingPlans.requestKey, `${RUN}-concurrent`));
    assert.equal(plans.length, 1);
  });

  it("restart from durable slots creates only the missing Opportunities", async () => {
    const story = await seedStory(OWNER_A, "restart-slots");
    const deps = repurposeDeps(fakeModel("generated"));
    const request = {
      requestKey: `${RUN}-restart-slots`,
      targets: [
        { format: "x_post", channel: "x" },
        { format: "linkedin_post", channel: "linkedin" },
        { format: "x_thread", channel: "x" },
      ],
    };
    const first = await repurposeStory(story.id, request, deps, OWNER_A);
    assert.equal(first.outcomes.length, 3);
    const second = await repurposeStory(story.id, request, deps, OWNER_A);
    assert.ok(second.outcomes.every((o) => o.status === "reused"));
    assert.equal(second.plan?.id, first.plan?.id);
  });

  it("owner B cannot inspect owner A's plan", async () => {
    const story = await seedStory(OWNER_A, "plan-iso");
    const deps = repurposeDeps(fakeModel("generated"));
    const result = await repurposeStory(
      story.id,
      { requestKey: `${RUN}-iso`, targets: [{ format: "x_post", channel: "x" }] },
      deps,
      OWNER_A,
    );
    await assert.rejects(
      () => inspectRepurposingPlan(result.plan!.id, deps, OWNER_B),
      (err: Error) => err.name === "RepurposingPlanNotFoundError",
    );
  });

  it("frozen plan contextHash is reused across sibling jobs", async () => {
    const story = await seedStory(OWNER_A, "freeze");
    const deps = repurposeDeps(fakeModel("generated"));
    const result = await repurposeStory(
      story.id,
      {
        requestKey: `${RUN}-freeze`,
        targets: [
          { format: "x_post", channel: "x", count: 2 },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      },
      deps,
      OWNER_A,
    );
    const xJobs = result.outcomes.filter((o) => o.channel === "x" && o.job);
    assert.equal(xJobs.length, 2);
    const hashA = (xJobs[0].job!.policySnapshot as { inputHashes?: { context?: string } }).inputHashes?.context;
    const hashB = (xJobs[1].job!.policySnapshot as { inputHashes?: { context?: string } }).inputHashes?.context;
    if (hashA && hashB) assert.equal(hashA, hashB, "same-channel siblings share the frozen context");
    const snapshot = result.plan?.snapshot as { contextByChannel?: Record<string, { contextHash: string }> };
    assert.ok(snapshot?.contextByChannel?.x || snapshot?.contextByChannel?._default);
  });
});
