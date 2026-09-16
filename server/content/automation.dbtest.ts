/**
 * DB-backed tests for Phase 13 — the automation / autopilot foundation.
 *
 * Real PostgreSQL, real storages, real Phase 12 repurposing, real GenerationJob
 * creation, real approval transitions and the real scheduling/publication
 * pipeline. The only things stood in for are the two out-of-process workers the
 * real system also delegates to and that are already proven elsewhere:
 * the research engine (a completed ResearchJob is produced the same way the
 * engine produces one — `markRunning` → evidence → `markComplete`) and the AI
 * model port (the documented boundary, exactly as `content.dbtest.ts` and
 * `repurposing.dbtest.ts` do it). No provider, no network.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import {
  artifacts,
  automationPolicies,
  automationRuns,
  contextVault,
  generationJobs,
  generationPolicies,
  opportunities,
  publications,
  researchEvidence,
  researchJobs,
  researchSources,
  results,
  scheduleOccurrences,
  schedules,
  stories,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseAutomationStorage } from "./automationStorage";
import { DatabaseStoryStorage } from "../story/storage";
import { DatabaseResearchStorage } from "../research/storage";
import { createDatabaseContextReader } from "./context";
import { registerBuiltinChannelAdapters } from "./adapters";
import { runGenerationJob, type GenerationModelPort } from "./generation";
import { dispatchDueOccurrences } from "./scheduling";
import { runPublication } from "./publication";
import { JobFailure } from "../jobs/failures";
import { registerBuiltinProviders } from "../research/bootstrap";
import {
  advanceAutomationRun,
  automationResearchIdempotencyKey,
  automationRunIdempotencyKey,
  createAutomationPolicy,
  createAutomationRun,
  dispatchScheduledAutomationPolicies,
  summarizeAutomationRun,
  triggerAutomationPolicy,
  updateAutomationPolicy,
  AutomationLimitError,
  AutomationPolicyNotFoundError,
  isTerminalRunStatus,
  type AutomationDeps,
} from "./automation";

registerBuiltinChannelAdapters();
registerBuiltinProviders();

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `aut${Date.now().toString(36)}`;
const OWNER_A = 810_000 + (Date.now() % 80_000);
const OWNER_B = OWNER_A + 1;
const OWNERS = [OWNER_A, OWNER_B];

describeDb("automation (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
  });

  after(async () => {
    if (!CONNECTION) return;
    const scheds = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(inArray(schedules.userId, OWNERS));
    const schedIds = scheds.map((s) => s.id);
    const pubs = schedIds.length
      ? await db.select({ id: publications.id }).from(publications).where(inArray(publications.scheduleId, schedIds))
      : [];
    const pubIds = pubs.map((p) => p.id);
    if (pubIds.length) await db.delete(results).where(inArray(results.publicationId, pubIds));
    if (schedIds.length) {
      await db.delete(publications).where(inArray(publications.scheduleId, schedIds));
      await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds));
      await db.delete(schedules).where(inArray(schedules.id, schedIds));
    }
    await db.delete(artifacts).where(inArray(artifacts.userId, OWNERS));
    const jobs = await db
      .select({ id: generationJobs.id, policyId: generationJobs.policyId })
      .from(generationJobs)
      .where(inArray(generationJobs.userId, OWNERS));
    const policyIds = jobs.map((j) => j.policyId).filter((id): id is number => id !== null);
    await db.delete(generationJobs).where(inArray(generationJobs.userId, OWNERS));
    if (policyIds.length) {
      try {
        await db.delete(generationPolicies).where(inArray(generationPolicies.id, policyIds));
      } catch {
        // A content-addressed revision is shared by definition; if another
        // suite's still-live GenerationJob references it, leaving it in place is
        // correct. Never sweep the table.
      }
    }
    await db.delete(opportunities).where(inArray(opportunities.userId, OWNERS));
    await db.delete(stories).where(inArray(stories.userId, OWNERS));
    await db.delete(automationRuns).where(inArray(automationRuns.userId, OWNERS));
    await db.delete(automationPolicies).where(inArray(automationPolicies.userId, OWNERS));
    const rjs = await db.select({ id: researchJobs.id }).from(researchJobs).where(inArray(researchJobs.userId, OWNERS));
    const rjIds = rjs.map((r) => r.id);
    if (rjIds.length) {
      await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, rjIds));
      await db.delete(researchSources).where(inArray(researchSources.jobId, rjIds));
      await db.delete(researchJobs).where(inArray(researchJobs.id, rjIds));
    }
    await db.delete(contextVault).where(inArray(contextVault.userId, OWNERS));
    await pool.end().catch(() => {});
  });

  // ── fixtures ────────────────────────────────────────────────────────────────
  function storages() {
    const content = new DatabaseContentStorage(db);
    const stories = new DatabaseStoryStorage(db);
    const research = new DatabaseResearchStorage(db);
    return { content, stories, research };
  }

  function makeDeps(model: GenerationModelPort): { deps: AutomationDeps; content: DatabaseContentStorage; stories: DatabaseStoryStorage } {
    const { content, stories, research } = storages();
    const deps: AutomationDeps = {
      automation: new DatabaseAutomationStorage(db),
      content,
      stories,
      research: {
        claimJob: (input) => research.claimJob(input),
        getJob: (jobId) => research.getJob(jobId),
        listEvidenceIds: (jobId) => research.listEvidenceIds(jobId),
        getEvidence: (jobId) => research.getEvidenceForJob(jobId),
        enqueueResearchRun: async () => {},
      },
      repurpose: {
        opportunities: { opportunities: content, stories },
        generation: {
          content,
          stories,
          evidence: { listEvidence: (researchJobId) => research.getEvidenceForJob(researchJobId) },
          model,
          defaultModel: "fake-1",
          contextReader: createDatabaseContextReader(db),
        },
      },
      enqueueGeneration: async () => true,
      enqueueAutomationRun: async () => true,
    };
    return { deps, content, stories };
  }

  /** The model PORT is the boundary: deterministic text for every format. */
  const okModel = (): GenerationModelPort => ({
    provider: "fake-model",
    async generate(request) {
      const payload =
        request.format === "x_thread" ? { units: ["one", "two"] } : { text: "generated body" };
      return { payload, model: "fake-1", provider: "fake-model", cost: "0", usage: {} };
    },
  });

  const modelFailingFor = (format: string): GenerationModelPort => ({
    provider: "fake-model",
    async generate(request) {
      if (request.format === format) throw JobFailure.permanent("model refused this format");
      return { payload: { text: "generated body" }, model: "fake-1", provider: "fake-model", cost: "0", usage: {} };
    },
  });

  /**
   * Stand in for the research engine's terminal transition using the SAME
   * storage methods the engine uses (queued → running → evidence → complete).
   */
  async function completeResearch(jobId: number, excerpts: string[]) {
    const research = new DatabaseResearchStorage(db);
    await research.markRunning(jobId);
    for (const excerpt of excerpts) {
      await db.insert(researchEvidence).values({
        jobId,
        sourceId: null,
        kind: "excerpt",
        origin: "sourced",
        excerpt,
        excerptHash: createHash("sha256").update(excerpt).digest("hex"),
        retrievedAt: new Date(),
      });
    }
    await research.markComplete(jobId, []);
  }

  /**
   * Advance until the run reaches a terminal state, standing in for the two
   * async workers exactly where the real system waits for them.
   */
  async function advanceToTerminal(runId: number, deps: AutomationDeps, max = 20) {
    for (let i = 0; i < max; i += 1) {
      const before = await deps.automation.getAutomationRun(runId);
      assert.ok(before, `run ${runId} vanished`);
      if (isTerminalRunStatus(before.status)) return before;

      const result = await advanceAutomationRun(runId, deps);
      if (isTerminalRunStatus(result.status ?? before.status)) {
        return (await deps.automation.getAutomationRun(runId))!;
      }
      if (result.reason === "waiting") {
        const run = (await deps.automation.getAutomationRun(runId))!;
        if (run.researchJobId !== null) {
          const job = await storages().research.getJob(run.researchJobId);
          if (job && job.status !== "complete" && job.status !== "failed") {
            await completeResearch(run.researchJobId, [`${RUN} evidence one`, `${RUN} evidence two`]);
            continue;
          }
        }
        // Scope the worker stand-in to THIS run's own GenerationJobs — never a
        // sibling test's row that happens to share the owner.
        const jobIds = (run.outcomes as Array<{ generationJobId: number | null }>)
          .map((o) => o.generationJobId)
          .filter((id): id is number => id !== null);
        const loaded = await Promise.all(jobIds.map((id) => deps.content.getGenerationJob(id)));
        const pending = loaded.filter((j) => j && (j.status === "queued" || j.status === "running"));
        if (pending.length > 0) {
          await runGenerationJob(pending[0]!.id, deps.repurpose.generation);
          continue;
        }
      }
    }
    throw new Error(`run ${runId} did not settle within ${max} advances`);
  }

  const basePolicy = (overrides: Record<string, unknown> = {}) => ({
    name: `${RUN} policy`,
    triggerType: "manual",
    researchConfig: { kind: "directed", query: `${RUN} kubernetes platform engineering`, providerIds: ["rss"] },
    targets: [{ format: "x_post", channel: "x" }],
    ...overrides,
  });

  // ── 1-2. persistence + snapshot immutability ───────────────────────────────
  it("persists an AutomationPolicy and an AutomationRun that freezes the policy it started under", async () => {
    const { deps } = makeDeps(okModel());
    const policy = await createAutomationPolicy(OWNER_A, basePolicy(), deps);
    assert.equal(policy.version, 1);

    const { run, created } = await createAutomationRun({
      policy,
      triggerType: "manual",
      triggerIdentity: `${RUN}-freeze`,
      deps,
    });
    assert.equal(created, true);

    const [persisted] = await db.select().from(automationRuns).where(inArray(automationRuns.id, [run.id]));
    assert.equal(persisted.policyId, policy.id);
    assert.equal(persisted.policyVersion, 1);
    assert.equal(persisted.policySpecHash, policy.specHash);
    assert.equal(persisted.status, "pending");
    assert.equal(persisted.idempotencyKey, automationRunIdempotencyKey(policy.id, "manual", `${RUN}-freeze`));

    // Mutate the policy to v2 with a DIFFERENT, execution-relevant target set.
    const v2 = await updateAutomationPolicy(policy.id, OWNER_A, { targets: [{ format: "x_thread", channel: "x" }] }, deps);
    assert.equal(v2.version, 2);
    assert.notEqual(v2.specHash, policy.specHash);

    const [frozen] = await db.select().from(automationRuns).where(inArray(automationRuns.id, [run.id]));
    assert.equal(frozen.policyVersion, 1, "the running execution keeps its own revision");
    assert.deepEqual(frozen.policySnapshot, persisted.policySnapshot);
    assert.deepEqual(
      (frozen.policySnapshot as { targets: unknown[] }).targets,
      [{ format: "x_post", channel: "x" }],
      "a later policy edit cannot change what this run does",
    );
  });

  it("a NEW trigger after the mutation uses v2", async () => {
    const { deps } = makeDeps(okModel());
    const policy = await createAutomationPolicy(OWNER_A, basePolicy({ name: `${RUN} v2 policy` }), deps);
    await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-v1`, deps });
    const v2 = await updateAutomationPolicy(policy.id, OWNER_A, { targets: [{ format: "x_thread", channel: "x" }] }, deps);
    const next = await createAutomationRun({ policy: v2, triggerType: "manual", triggerIdentity: `${RUN}-v2`, deps });
    assert.equal(next.run.policyVersion, 2);
    assert.deepEqual((next.run.policySnapshot as { targets: unknown[] }).targets, [
      { format: "x_thread", channel: "x" },
    ]);
  });

  // ── 3. owner isolation ──────────────────────────────────────────────────────
  it("enforces owner isolation at the SQL level for both policies and runs", async () => {
    const { deps } = makeDeps(okModel());
    const policy = await createAutomationPolicy(OWNER_A, basePolicy({ name: `${RUN} isolation` }), deps);
    const { run } = await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-iso`, deps });

    assert.ok(await deps.automation.getAutomationPolicyForOwner(policy.id, OWNER_A));
    assert.equal(await deps.automation.getAutomationPolicyForOwner(policy.id, OWNER_B), undefined);
    assert.ok(await deps.automation.getAutomationRunForOwner(run.id, OWNER_A));
    assert.equal(await deps.automation.getAutomationRunForOwner(run.id, OWNER_B), undefined);

    const ownerBList = await deps.automation.listAutomationPoliciesForOwner(OWNER_B, 50);
    assert.equal(ownerBList.length, 0, "owner B's policy list is empty");

    await assert.rejects(() => triggerAutomationPolicy(policy.id, OWNER_B, {}, deps), AutomationPolicyNotFoundError);
    await assert.rejects(
      () => updateAutomationPolicy(policy.id, OWNER_B, { name: "hijacked" }, deps),
      AutomationPolicyNotFoundError,
    );
    const [unchanged] = await db.select().from(automationPolicies).where(inArray(automationPolicies.id, [policy.id]));
    assert.equal(unchanged.name, `${RUN} isolation`, "owner B could not mutate owner A's policy");
  });

  // ── 4-6. trigger collapse, rerun, concurrency arbiter ──────────────────────
  it("collapses duplicate manual triggers and explicit reruns into the right number of runs", async () => {
    const { deps } = makeDeps(okModel());
    const policy = await createAutomationPolicy(OWNER_A, basePolicy({ name: `${RUN} dup` }), deps);

    const first = await triggerAutomationPolicy(policy.id, OWNER_A, { requestKey: `${RUN}-k` }, deps);
    const dup = await triggerAutomationPolicy(policy.id, OWNER_A, { requestKey: `${RUN}-k` }, deps);
    assert.equal(first.created, true);
    assert.equal(dup.created, false);
    assert.equal(dup.run.id, first.run.id);

    const rerun = await triggerAutomationPolicy(policy.id, OWNER_A, { requestKey: `${RUN}-k`, rerun: true }, deps);
    assert.equal(rerun.created, true);
    assert.notEqual(rerun.run.id, first.run.id);

    const third = await triggerAutomationPolicy(policy.id, OWNER_A, { requestKey: `${RUN}-k` }, deps);
    assert.equal(third.run.id, first.run.id, "the base logical key still collapses normally");

    const rows = await db.select().from(automationRuns).where(inArray(automationRuns.userId, [OWNER_A]));
    assert.equal(rows.filter((r) => r.policyId === policy.id).length, 2);
  });

  it("uses the DATABASE unique index as the concurrency arbiter for a duplicate trigger", async () => {
    const { deps } = makeDeps(okModel());
    const policy = await createAutomationPolicy(OWNER_A, basePolicy({ name: `${RUN} race` }), deps);
    const identity = `${RUN}-race`;

    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        createAutomationRun({ policy, triggerType: "manual", triggerIdentity: identity, deps }),
      ),
    );
    assert.equal(claims.filter((c) => c.created).length, 1, "exactly one caller creates the run");
    assert.equal(new Set(claims.map((c) => c.run.id)).size, 1, "every caller sees the same run");

    const rows = await db
      .select()
      .from(automationRuns)
      .where(inArray(automationRuns.idempotencyKey, [automationRunIdempotencyKey(policy.id, "manual", identity)]));
    assert.equal(rows.length, 1);
  });

  it("creates exactly one run per scheduled slot across concurrent ticks", async () => {
    const { deps } = makeDeps(okModel());
    const startAt = new Date(Date.now() - 2 * 86_400_000 + 60_000).toISOString();
    const policy = await createAutomationPolicy(
      OWNER_A,
      basePolicy({
        name: `${RUN} scheduled`,
        triggerType: "scheduled",
        triggerConfig: { startAt, recurrence: "every:1d" },
      }),
      deps,
    );
    const tickNow = new Date();
    const [a, b] = await Promise.all([
      dispatchScheduledAutomationPolicies(tickNow, deps, 25),
      dispatchScheduledAutomationPolicies(tickNow, deps, 25),
    ]);
    assert.equal(a.created + b.created, 1, "one run for the slot, whichever tick wins");
    assert.equal(a.deduplicated + b.deduplicated, 1);

    const rows = await db.select().from(automationRuns).where(inArray(automationRuns.policyId, [policy.id]));
    assert.equal(rows.length, 1);
    assert.match(rows[0].idempotencyKey, /^automation:scheduled:/);
  });

  // ── 7. limits ──────────────────────────────────────────────────────────────
  it("enforces maxRunsPerDay from durable run accounting", async () => {
    const { deps } = makeDeps(okModel());
    const policy = await createAutomationPolicy(OWNER_A, basePolicy({ name: `${RUN} limit`, limits: { maxRunsPerDay: 1 } }), deps);
    await triggerAutomationPolicy(policy.id, OWNER_A, { requestKey: `${RUN}-l1` }, deps);
    await assert.rejects(
      () => triggerAutomationPolicy(policy.id, OWNER_A, { requestKey: `${RUN}-l2` }, deps),
      AutomationLimitError,
    );
    const count = await deps.automation.countAutomationRunsSince(policy.id, new Date(Date.now() - 86_400_000));
    assert.equal(count, 1);
  });

  // ── 8-12. the orchestration path ───────────────────────────────────────────
  it("runs research → story → opportunities → generation jobs, creating each exactly once", async () => {
    const { deps, stories: storyStore } = makeDeps(okModel());
    const policy = await createAutomationPolicy(
      OWNER_A,
      basePolicy({
        name: `${RUN} full`,
        targets: [
          { format: "x_post", channel: "x" },
          { format: "x_thread", channel: "x" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      }),
      deps,
    );
    const { run } = await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-full`, deps });

    // Step 1: research — exactly one ResearchJob, keyed off the run.
    await advanceAutomationRun(run.id, deps);
    const afterResearch = (await deps.automation.getAutomationRun(run.id))!;
    assert.ok(afterResearch.researchJobId);
    const researchKey = automationResearchIdempotencyKey(run.id);
    const researchRows = await db.select().from(researchJobs).where(inArray(researchJobs.idempotencyKey, [researchKey]));
    assert.equal(researchRows.length, 1);

    // A crash between creating the ResearchJob and persisting the reference
    // must not create a second one.
    await deps.automation.patchAutomationRun(run.id, { researchJobId: null });
    await advanceAutomationRun(run.id, deps);
    const stillOne = await db.select().from(researchJobs).where(inArray(researchJobs.idempotencyKey, [researchKey]));
    assert.equal(stillOne.length, 1, "research is not duplicated on retry");

    await completeResearch(afterResearch.researchJobId!, [`${RUN} excerpt alpha`, `${RUN} excerpt beta`]);

    // Step 2: story — exactly one Story, owned by this run.
    await advanceAutomationRun(run.id, deps);
    const story = await storyStore.getStoryByAutomationRun(run.id);
    assert.ok(story, "the run derived a Story");
    assert.equal(story!.userId, OWNER_A, "the Story belongs to the run's owner");
    assert.equal(story!.researchJobId, afterResearch.researchJobId);
    assert.ok(story!.evidenceRefs.length >= 2, "the Story cites the real evidence ids");
    assert.match(story!.insightBody, /excerpt alpha/);

    // Duplicate delivery of the story step must collapse on the unique index.
    await advanceAutomationRun(run.id, deps);
    const storyCount = await db.select().from(stories).where(inArray(stories.userId, [OWNER_A]));
    assert.equal(
      storyCount.filter((s) => s.automationRunId === run.id).length,
      1,
      "one Story per run, enforced by the database",
    );

    // Step 3: fan-out through Phase 12.
    let current = (await deps.automation.getAutomationRun(run.id))!;
    if (((current.outcomes ?? []) as unknown[]).length === 0) {
      const result = await advanceAutomationRun(run.id, deps);
      assert.equal(result.step, "fanout");
    }
    current = (await deps.automation.getAutomationRun(run.id))!;
    const outcomes = current.outcomes as Array<{ format: string; channel: string; opportunityId: number; generationJobId: number }>;
    assert.equal(outcomes.length, 3);

    const opportunityRows = await db.select().from(opportunities).where(inArray(opportunities.storyId, [story!.id]));
    assert.equal(opportunityRows.length, 3, "three Opportunities from ONE Story");
    assert.ok(opportunityRows.every((o) => o.userId === OWNER_A));
    assert.ok(opportunityRows.every((o) => o.storyId === story!.id), "Phase 12's Story lineage is intact");
    assert.deepEqual(
      opportunityRows.map((o) => `${o.format}:${o.channel}`).sort(),
      ["linkedin_post:linkedin", "x_post:x", "x_thread:x"],
    );

    const jobRows = await db
      .select()
      .from(generationJobs)
      .where(inArray(generationJobs.opportunityId, opportunityRows.map((o) => o.id)));
    assert.equal(jobRows.length, 3);
    assert.ok(jobRows.every((j) => j.policyId !== null), "each job pinned an immutable GenerationPolicy revision");
    assert.equal(new Set(jobRows.map((j) => j.policyId)).size, 3, "distinct policy revision per target");

    // Duplicate delivery of the fan-out step must not create siblings.
    await deps.automation.patchAutomationRun(run.id, { outcomes: [] });
    await advanceAutomationRun(run.id, deps);
    const afterRetry = await db.select().from(opportunities).where(inArray(opportunities.storyId, [story!.id]));
    assert.equal(afterRetry.length, 3, "Phase 12's repurpose_key prevents duplicate Opportunities on retry");
  });

  // ── 13. context / style snapshot behaviour ─────────────────────────────────
  it("freezes assembled context onto each GenerationJob, so a later context change cannot reach it", async () => {
    const { deps } = makeDeps(okModel());
    await db.insert(contextVault).values({
      userId: OWNER_A,
      title: `${RUN} ctx v1`,
      content: `${RUN}_CONTEXT_ALPHA`,
      isFavorite: true,
    });

    const policy = await createAutomationPolicy(OWNER_A, basePolicy({ name: `${RUN} ctx` }), deps);
    const first = await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-ctx1`, deps });
    await advanceAutomationRun(first.run.id, deps);
    await completeResearch((await deps.automation.getAutomationRun(first.run.id))!.researchJobId!, [`${RUN} e`]);
    await advanceAutomationRun(first.run.id, deps);
    await advanceAutomationRun(first.run.id, deps);

    const jobsA = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.userId, OWNER_A))
      .orderBy(asc(generationJobs.id));
    const jobA = jobsA[jobsA.length - 1];
    assert.match(JSON.stringify(jobA.policySnapshot), /_CONTEXT_ALPHA/, "the run used the real Phase 10 ContextAssembly");
    assert.match(JSON.stringify(jobA.policySnapshot), /DATA, not instructions/, "context stays DATA, never instructions");

    await db.insert(contextVault).values({
      userId: OWNER_A,
      title: `${RUN} ctx v2`,
      content: `${RUN}_CONTEXT_BETA`,
      isFavorite: true,
    });

    const second = await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-ctx2`, deps });
    await advanceAutomationRun(second.run.id, deps);
    await completeResearch((await deps.automation.getAutomationRun(second.run.id))!.researchJobId!, [`${RUN} e2`]);
    await advanceAutomationRun(second.run.id, deps);
    await advanceAutomationRun(second.run.id, deps);

    const jobsB = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.userId, OWNER_A))
      .orderBy(asc(generationJobs.id));
    const jobB = jobsB[jobsB.length - 1];
    assert.notEqual(jobB.id, jobA.id);
    assert.match(JSON.stringify(jobB.policySnapshot), /_CONTEXT_BETA/);

    const [reloadedA] = await db.select().from(generationJobs).where(inArray(generationJobs.id, [jobA.id]));
    assert.deepEqual(reloadedA.policySnapshot, jobA.policySnapshot, "the earlier job's frozen context is untouched");
    assert.doesNotMatch(JSON.stringify(reloadedA.policySnapshot), /_CONTEXT_BETA/);
  });

  // ── 14. approval gate ──────────────────────────────────────────────────────
  it("stops at a durable awaiting_approval state under approval_required and publishes nothing", async () => {
    const { deps } = makeDeps(okModel());
    const policy = await createAutomationPolicy(OWNER_A, basePolicy({ name: `${RUN} gate` }), deps);
    const { run } = await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-gate`, deps });
    const settled = await advanceToTerminal(run.id, deps);

    assert.equal(settled.status, "awaiting_approval", "approval is an explicit boundary, not a failure");
    assert.equal(settled.errorClass, null);
    assert.ok(settled.finishedAt);

    const summary = await summarizeAutomationRun(settled, deps);
    assert.equal(summary.awaitingApproval, 1);
    assert.equal(summary.published, 0);
    assert.equal(summary.artifacts.length, 1);
    assert.equal(summary.artifacts[0].readiness, "draft");
    assert.ok(summary.storyId);

    const [artifact] = await db.select().from(artifacts).where(inArray(artifacts.id, [summary.artifacts[0].artifactId]));
    assert.equal(artifact.readiness, "draft", "automation created a draft, not an approval");
    assert.equal(artifact.provenance, "generated");
    const scheds = await db.select().from(schedules).where(inArray(schedules.artifactId, [artifact.id]));
    assert.equal(scheds.length, 0, "no Schedule was created — automation made no publication decision");
  });

  // ── 15-16. partial success and independent siblings ────────────────────────
  it("represents partial success: a failing sibling never rolls back the one that succeeded", async () => {
    const { deps } = makeDeps(modelFailingFor("linkedin_post"));
    const policy = await createAutomationPolicy(
      OWNER_A,
      basePolicy({
        name: `${RUN} partial`,
        targets: [
          { format: "x_post", channel: "x" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      }),
      deps,
    );
    const { run } = await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-partial`, deps });
    const settled = await advanceToTerminal(run.id, deps);

    assert.equal(settled.status, "partial", "one target failing is not a global failure");
    const outcomes = settled.outcomes as Array<{ format: string; status: string; artifactId: number | null; error: string | null }>;
    assert.equal(outcomes.length, 2);

    const x = outcomes.find((o) => o.format === "x_post")!;
    const li = outcomes.find((o) => o.format === "linkedin_post")!;
    assert.ok(x.artifactId, "the successful sibling's Artifact is preserved");
    assert.equal(li.status, "failed");
    assert.match(li.error ?? "", /model refused/);

    const artRows = await db.select().from(artifacts).where(inArray(artifacts.id, [x.artifactId!]));
    assert.equal(artRows.length, 1);
    assert.equal(artRows[0].readiness, "draft", "the successful sibling kept its own lifecycle");
    const liArtifacts = await db.select().from(artifacts).where(inArray(artifacts.channel, ["linkedin"]));
    assert.equal(liArtifacts.filter((a) => a.userId === OWNER_A).length, 0, "the failed sibling fabricated no Artifact");

    const summary = await summarizeAutomationRun(settled, deps);
    assert.equal(summary.artifacts.length, 1);
  });

  // ── 17. the publication path, through the existing pipeline only ───────────
  it("trusted + on_approval approves through the Artifact model and schedules via the existing pipeline", async () => {
    const { deps, content } = makeDeps(okModel());
    const policy = await createAutomationPolicy(
      OWNER_A,
      basePolicy({
        name: `${RUN} trusted`,
        approvalMode: "trusted",
        publicationConfig: { mode: "on_approval" },
      }),
      deps,
    );
    const { run } = await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-trusted`, deps });
    const settled = await advanceToTerminal(run.id, deps);
    assert.equal(settled.status, "completed");

    const summary = await summarizeAutomationRun(settled, deps);
    assert.equal(summary.artifacts.length, 1);
    assert.equal(summary.artifacts[0].readiness, "approved", "approved through draft → in_review → approved");
    assert.ok(summary.artifacts[0].scheduleId, "a Schedule was created by the existing createSchedule");

    // The rest of the chain is the UNCHANGED existing pipeline.
    const dispatched = await dispatchDueOccurrences(new Date(Date.now() + 1000), {
      content,
      enqueuePublication: async () => true,
    });
    const publication = dispatched.publications.find((p) => p.scheduleId === summary.artifacts[0].scheduleId);
    assert.ok(publication, "the Schedule materialized an Occurrence + Publication through the real dispatcher");
    assert.equal(publication!.artifactId, summary.artifacts[0].artifactId, "the exact approved revision is pinned");

    const outcome = await runPublication(publication!.id, {
      content,
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

    const afterPublish = await summarizeAutomationRun(
      (await deps.automation.getAutomationRun(run.id))!,
      deps,
    );
    assert.equal(afterPublish.published, 1, "the run's downstream picture reflects the real Result");
    assert.equal(afterPublish.unknown, 0);
  });

  // ── 18. restart equivalence ───────────────────────────────────────────────
  it("re-advances from durable state after an equivalent restart, with no duplicate domain work", async () => {
    const model = okModel();
    const first = makeDeps(model);
    const policy = await createAutomationPolicy(
      OWNER_A,
      basePolicy({
        name: `${RUN} restart`,
        targets: [{ format: "x_post", channel: "x" }, { format: "x_thread", channel: "x" }],
      }),
      first.deps,
    );
    const { run } = await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-restart`, deps: first.deps });
    await advanceAutomationRun(run.id, first.deps);
    await completeResearch((await first.deps.automation.getAutomationRun(run.id))!.researchJobId!, [`${RUN} restart evidence`]);
    await advanceAutomationRun(run.id, first.deps);
    await advanceAutomationRun(run.id, first.deps);

    const beforeRestart = await first.deps.automation.getAutomationRun(run.id);
    const beforeJobs = await db.select().from(generationJobs).where(eq(generationJobs.userId, OWNER_A));
    const beforeStories = await db.select().from(stories).where(eq(stories.userId, OWNER_A));

    // A brand-new set of storage instances stands in for a fresh process: the
    // only thing carried across is the durable state.
    const second = makeDeps(model);
    const resumed = await advanceToTerminal(run.id, second.deps);
    assert.ok(isTerminalRunStatus(resumed.status), `expected terminal, got ${resumed.status}`);
    assert.equal(
      (resumed.outcomes as unknown[]).length,
      (beforeRestart!.outcomes as unknown[]).length,
      "the resumed run kept its recorded outcomes",
    );

    const afterJobs = await db.select().from(generationJobs).where(eq(generationJobs.userId, OWNER_A));
    const afterStories = await db.select().from(stories).where(eq(stories.userId, OWNER_A));
    assert.equal(afterJobs.length, beforeJobs.length, "no duplicate GenerationJob after resume");
    assert.equal(afterStories.length, beforeStories.length, "no duplicate Story after resume");
  });

  // ── the job payload is a durable id, nothing more ──────────────────────────
  it("records only durable ids in the run — never content or a pipeline blob", async () => {
    const { deps } = makeDeps(okModel());
    const policy = await createAutomationPolicy(OWNER_A, basePolicy({ name: `${RUN} shape` }), deps);
    const { run } = await createAutomationRun({ policy, triggerType: "manual", triggerIdentity: `${RUN}-shape`, deps });
    const settled = await advanceToTerminal(run.id, deps);

    for (const outcome of settled.outcomes as Array<Record<string, unknown>>) {
      assert.deepEqual(
        Object.keys(outcome).sort(),
        ["artifactId", "channel", "error", "format", "generationJobId", "opportunityId", "scheduleId", "status"],
        "a run outcome is ids + status only",
      );
    }
    const snapshot = settled.policySnapshot as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(snapshot).sort(),
      [
        "policyId",
        "policyVersion",
        "policySpecHash",
        "name",
        "triggerType",
        "triggerConfig",
        "researchConfig",
        "targets",
        "generationConfig",
        "approvalMode",
        "publicationConfig",
        "limits",
      ].sort(),
      "the frozen snapshot is the policy, not runtime state",
    );
    assert.doesNotMatch(JSON.stringify(snapshot), /generated body/, "no generated content is stored on the run");
  });
});
