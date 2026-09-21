/**
 * Real-Postgres tests for Phase 29.2 — Controlled Optimization & Experimentation Foundation.
 *
 * Tests durable experiment persistence, immutable variant snapshots, deterministic assignment,
 * cross-experiment contamination prevention, tenant isolation, evaluation mathematics,
 * guardrail regression detection, policy candidate creation, and zero production policy mutation.
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import {
  experiments,
  experimentVariants,
  experimentAssignments,
  experimentEvaluations,
  policyCandidates,
  learningProposals,
  learningObservations,
  performanceSignals,
  publications,
  results,
  scheduleOccurrences,
  schedules,
  artifacts,
  opportunities,
  stories,
  generationPolicies,
} from "@shared/schema";
import { DatabaseExperimentStorage } from "./store";
import {
  selectDeterministicVariant,
  assignOpportunityToExperiment,
  ExperimentEligibilityError,
} from "./assignment";
import {
  evaluateExperiment,
  createPolicyCandidateFromExperiment,
} from "./evaluation";
import { experimentIdentityKey } from "./identity";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `exp_${Date.now().toString(36)}`;
const OWNER_A = 940_000 + (Date.now() % 50_000);
const OWNER_B = OWNER_A + 1;

describeDb("controlled experimentation domain (Phase 29.2 db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const store = () => new DatabaseExperimentStorage(db);

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
  });

  after(async () => {
    if (!CONNECTION) return;
    await db.delete(policyCandidates).where(inArray(policyCandidates.userId, [OWNER_A, OWNER_B]));
    await db.delete(experimentEvaluations).where(inArray(experimentEvaluations.userId, [OWNER_A, OWNER_B]));
    await db.delete(experimentAssignments).where(inArray(experimentAssignments.userId, [OWNER_A, OWNER_B]));
    await db.delete(experimentVariants).where(inArray(experimentVariants.userId, [OWNER_A, OWNER_B]));
    await db.delete(experiments).where(inArray(experiments.userId, [OWNER_A, OWNER_B]));
    await db.delete(learningProposals).where(inArray(learningProposals.userId, [OWNER_A, OWNER_B]));
    await db.delete(learningObservations).where(inArray(learningObservations.userId, [OWNER_A, OWNER_B]));
    await db.delete(performanceSignals).where(inArray(performanceSignals.userId, [OWNER_A, OWNER_B]));
    await db.delete(results).where(inArray(results.userId, [OWNER_A, OWNER_B]));
    await db.delete(publications).where(inArray(publications.userId, [OWNER_A, OWNER_B]));
    const userSchedules = await db
      .select({ id: schedules.id })
      .from(schedules)
      .where(inArray(schedules.userId, [OWNER_A, OWNER_B]));
    if (userSchedules.length > 0) {
      await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, userSchedules.map((s) => s.id)));
    }
    await db.delete(schedules).where(inArray(schedules.userId, [OWNER_A, OWNER_B]));
    await db.delete(artifacts).where(inArray(artifacts.userId, [OWNER_A, OWNER_B]));
    await db.delete(opportunities).where(inArray(opportunities.userId, [OWNER_A, OWNER_B]));
    await db.delete(stories).where(inArray(stories.userId, [OWNER_A, OWNER_B]));
    await pool.end();
  });

  it("persists experiment with control and variant and enforces unique identityKey", async () => {
    const s = store();
    const idKey = experimentIdentityKey(OWNER_A, "channel:linkedin;format:carousel", "format_distribution", `Exp 1 ${RUN}`);

    const { row: exp, created } = await s.createExperiment({
      userId: OWNER_A,
      sourceProposalId: null,
      name: `Exp 1 ${RUN}`,
      hypothesis: "Carousels will increase engagement compared to single posts",
      objective: "Increase engagement on LinkedIn",
      targetScope: "channel:linkedin;format:carousel",
      experimentType: "format_distribution",
      primaryMetric: "engagements_per_post",
      guardrailMetrics: ["publication_failure_rate"],
      eligibilityRules: { channel: "linkedin", format: "carousel" },
      allocationMethod: "deterministic_hash",
      status: "ready",
      decision: "pending",
      decisionNotes: null,
      decidedAt: null,
      decidedBy: null,
      minSampleSize: 3,
      startedAt: null,
      completedAt: null,
      identityKey: idKey,
    });

    assert.equal(created, true);
    assert.ok(exp.id > 0);
    assert.equal(exp.userId, OWNER_A);

    // Second insert with same key must deduplicate
    const second = await s.createExperiment({
      userId: OWNER_A,
      sourceProposalId: null,
      name: `Exp 1 ${RUN}`,
      hypothesis: "Carousels will increase engagement compared to single posts",
      objective: "Increase engagement on LinkedIn",
      targetScope: "channel:linkedin;format:carousel",
      experimentType: "format_distribution",
      primaryMetric: "engagements_per_post",
      guardrailMetrics: ["publication_failure_rate"],
      eligibilityRules: { channel: "linkedin", format: "carousel" },
      allocationMethod: "deterministic_hash",
      status: "ready",
      decision: "pending",
      decisionNotes: null,
      decidedAt: null,
      decidedBy: null,
      minSampleSize: 3,
      startedAt: null,
      completedAt: null,
      identityKey: idKey,
    });

    assert.equal(second.created, false);
    assert.equal(second.row.id, exp.id);

    // Add control variant and test variant with immutable policySnapshots
    const { row: controlVar } = await s.createVariant({
      userId: OWNER_A,
      experimentId: exp.id,
      variantKey: "control",
      name: "Standard Post (Control)",
      description: "Default single post format",
      isControl: true,
      policySnapshot: { format: "post", promptTemplate: "default_v1" },
      generationPolicyId: null,
      trafficWeight: 50,
    });
    assert.equal(controlVar.isControl, true);

    const { row: testVar } = await s.createVariant({
      userId: OWNER_A,
      experimentId: exp.id,
      variantKey: "variant_carousel",
      name: "Carousel Format (Variant)",
      description: "Carousel multi-slide format",
      isControl: false,
      policySnapshot: { format: "carousel", promptTemplate: "carousel_v1" },
      generationPolicyId: null,
      trafficWeight: 50,
    });
    assert.equal(testVar.isControl, false);

    const detailed = await s.getExperimentForOwner(exp.id, OWNER_A);
    assert.ok(detailed);
    assert.equal(detailed.variants.length, 2);
  });

  it("assigns eligible opportunities deterministically and prevents cross-experiment contamination", async () => {
    const s = store();

    // 1. Create a running experiment
    const idKey = experimentIdentityKey(OWNER_A, "channel:linkedin;format:carousel", "format_distribution", `AssignExp ${RUN}`);
    const { row: exp } = await s.createExperiment({
      userId: OWNER_A,
      sourceProposalId: null,
      name: `AssignExp ${RUN}`,
      hypothesis: "Testing assignment",
      objective: "Test objective",
      targetScope: "channel:linkedin;format:carousel",
      experimentType: "format_distribution",
      primaryMetric: "engagements_per_post",
      guardrailMetrics: [],
      eligibilityRules: { channel: "linkedin", format: "carousel" },
      allocationMethod: "deterministic_hash",
      status: "running",
      decision: "pending",
      decisionNotes: null,
      decidedAt: null,
      decidedBy: null,
      minSampleSize: 3,
      startedAt: new Date(),
      completedAt: null,
      identityKey: idKey,
    });

    const { row: vControl } = await s.createVariant({
      userId: OWNER_A,
      experimentId: exp.id,
      variantKey: "control",
      name: "Control",
      isControl: true,
      policySnapshot: { format: "post" },
      trafficWeight: 50,
    });

    const { row: vTest } = await s.createVariant({
      userId: OWNER_A,
      experimentId: exp.id,
      variantKey: "variant_a",
      name: "Variant A",
      isControl: false,
      policySnapshot: { format: "carousel" },
      trafficWeight: 50,
    });

    // 2. Create Story and Opportunity
    const [story] = await db
      .insert(stories)
      .values({
        userId: OWNER_A,
        title: `Story Assign ${RUN}`,
        insightBody: "Insight body",
        status: "ready",
      })
      .returning();

    const [opp] = await db
      .insert(opportunities)
      .values({
        userId: OWNER_A,
        storyId: story.id,
        concept: "Concept",
        objective: "Objective",
        channel: "linkedin",
        format: "carousel",
        status: "approved",
      })
      .returning();

    // 3. Assign opportunity
    const { assignment: a1, variant: var1, alreadyAssigned: firstAssigned } =
      await assignOpportunityToExperiment(s, exp.id, opp, OWNER_A);

    assert.equal(firstAssigned, false);
    assert.ok(a1.id > 0);
    assert.ok([vControl.id, vTest.id].includes(var1.id));

    // Repeated assignment must be idempotent and return identical variant
    const { assignment: a2, variant: var2, alreadyAssigned: secondAssigned } =
      await assignOpportunityToExperiment(s, exp.id, opp, OWNER_A);

    assert.equal(secondAssigned, true);
    assert.equal(a1.id, a2.id);
    assert.equal(var1.id, var2.id);

    // 4. Test contamination prevention: attempting to assign this same opportunity to Experiment 2 must throw
    const idKey2 = experimentIdentityKey(OWNER_A, "channel:linkedin;format:carousel", "format_distribution", `Exp2 ${RUN}`);
    const { row: exp2 } = await s.createExperiment({
      userId: OWNER_A,
      sourceProposalId: null,
      name: `Exp2 ${RUN}`,
      hypothesis: "Second exp",
      objective: "Second exp",
      targetScope: "channel:linkedin;format:carousel",
      experimentType: "format_distribution",
      primaryMetric: "engagements_per_post",
      guardrailMetrics: [],
      eligibilityRules: { channel: "linkedin", format: "carousel" },
      allocationMethod: "deterministic_hash",
      status: "running",
      decision: "pending",
      decisionNotes: null,
      decidedAt: null,
      decidedBy: null,
      minSampleSize: 3,
      startedAt: new Date(),
      completedAt: null,
      identityKey: idKey2,
    });

    await assert.rejects(
      async () => assignOpportunityToExperiment(s, exp2.id, opp, OWNER_A),
      (err: any) => {
        assert.ok(err instanceof ExperimentEligibilityError);
        assert.equal(err.code, "CONTAMINATED");
        return true;
      },
    );
  });

  it("strictly isolates User A and User B across all experimentation operations", async () => {
    const s = store();

    const idKeyA = experimentIdentityKey(OWNER_A, "channel:linkedin", "format_distribution", `UserA ${RUN}`);
    const { row: expA } = await s.createExperiment({
      userId: OWNER_A,
      name: `UserA ${RUN}`,
      hypothesis: "User A experiment",
      objective: "User A",
      targetScope: "channel:linkedin",
      experimentType: "format_distribution",
      primaryMetric: "engagements_per_post",
      identityKey: idKeyA,
    });

    // User B cannot get User A's experiment
    const fetchB = await s.getExperimentForOwner(expA.id, OWNER_B);
    assert.equal(fetchB, undefined);

    // User B listing only returns User B experiments
    const listB = await s.listExperimentsForOwner(OWNER_B);
    assert.equal(listB.some((e) => e.userId === OWNER_A), false);

    // User B cannot update User A's experiment
    const updated = await s.updateExperiment(expA.id, OWNER_B, { status: "cancelled" });
    assert.equal(updated, undefined);

    // Verify User A experiment was untouched
    const fetchA = await s.getExperimentForOwner(expA.id, OWNER_A);
    assert.equal(fetchA?.status, "draft");
  });

  it("evaluates experiment with primary metrics, guardrails, and deterministic decisions from DB state", async () => {
    const s = store();

    // 1. Create running experiment with guardrail
    const idKey = experimentIdentityKey(OWNER_A, "channel:linkedin;format:carousel", "format_distribution", `EvalExp ${RUN}`);
    const { row: exp } = await s.createExperiment({
      userId: OWNER_A,
      name: `EvalExp ${RUN}`,
      hypothesis: "Carousel format increases engagement",
      objective: "Increase LinkedIn engagement",
      targetScope: "channel:linkedin;format:carousel",
      experimentType: "format_distribution",
      primaryMetric: "likes",
      guardrailMetrics: ["publication_failure_rate"],
      eligibilityRules: { channel: "linkedin", format: "carousel" },
      status: "running",
      minSampleSize: 3,
      startedAt: new Date(),
      identityKey: idKey,
    });

    const { row: vControl } = await s.createVariant({
      userId: OWNER_A,
      experimentId: exp.id,
      variantKey: "control",
      name: "Control (Post)",
      isControl: true,
      policySnapshot: { format: "post" },
      trafficWeight: 50,
    });

    const { row: vVariant } = await s.createVariant({
      userId: OWNER_A,
      experimentId: exp.id,
      variantKey: "variant_a",
      name: "Variant A (Carousel)",
      isControl: false,
      policySnapshot: { format: "carousel" },
      trafficWeight: 50,
    });

    // 2. Setup 3 control publications and 3 variant publications
    const [story] = await db
      .insert(stories)
      .values({
        userId: OWNER_A,
        title: `Story Eval ${RUN}`,
        insightBody: "Insight body",
        status: "ready",
      })
      .returning();

    // Helper to create publication with signal
    async function setupAssignedPub(
      variantId: number,
      format: string,
      likeValue: number,
      outcome: string,
      idx: number,
    ): Promise<void> {
      const [opp] = await db
        .insert(opportunities)
        .values({
          userId: OWNER_A,
          storyId: story.id,
          concept: `Eval concept ${idx}`,
          objective: "Eval objective",
          channel: "linkedin",
          format,
          status: "approved",
        })
        .returning();

      const [art] = await db
        .insert(artifacts)
        .values({
          userId: OWNER_A,
          opportunityId: opp.id,
          channel: "linkedin",
          format,
          payload: { text: `Art ${idx}` },
          readiness: "approved",
        })
        .returning();

      const [sched] = await db
        .insert(schedules)
        .values({
          userId: OWNER_A,
          artifactId: art.id,
          channel: "linkedin",
          startAt: new Date(),
          status: "active",
        })
        .returning();

      const [occ] = await db
        .insert(scheduleOccurrences)
        .values({
          scheduleId: sched.id,
          occurrenceTime: new Date(),
          status: "published",
        })
        .returning();

      const [pub] = await db
        .insert(publications)
        .values({
          userId: OWNER_A,
          scheduleId: sched.id,
          occurrenceId: occ.id,
          artifactId: art.id,
          channel: "linkedin",
          state: outcome === "published" ? "published" : "failed",
          idempotencyKey: `pub:${art.id}:${RUN}`,
          correlationId: `corr-${art.id}-${RUN}`,
        })
        .returning();

      await db.insert(results).values({
        userId: OWNER_A,
        publicationId: pub.id,
        outcome,
        metrics: {},
      });

      // Insert performance signal
      await db.insert(performanceSignals).values({
        userId: OWNER_A,
        publicationId: pub.id,
        artifactId: art.id,
        channel: "linkedin",
        provider: "linkedin",
        externalId: `li-${pub.id}`,
        metric: "likes",
        value: String(likeValue),
        availability: "observed",
        observedAt: new Date(),
        retrievedAt: new Date(),
        measurementWindow: "all_time",
        normalizationVersion: "performance.v1",
        provenance: {},
        identityKey: `perf:${pub.id}:likes:${RUN}`,
      });

      // Insert assignment
      await s.createAssignment({
        userId: OWNER_A,
        experimentId: exp.id,
        variantId,
        opportunityId: opp.id,
        artifactId: art.id,
        publicationId: pub.id,
        idempotencyKey: `assign:${exp.id}:${art.id}:${RUN}`,
      });
    }

    // 3 Control posts: likes = 20, outcome = published
    for (let i = 1; i <= 3; i++) {
      await setupAssignedPub(vControl.id, "post", 20, "published", i);
    }

    // 3 Variant posts: likes = 40 (100% improvement!), outcome = published
    for (let i = 4; i <= 6; i++) {
      await setupAssignedPub(vVariant.id, "carousel", 40, "published", i);
    }

    // 3. Run evaluation
    const evaluation = await evaluateExperiment(db, s, exp.id, OWNER_A);

    assert.ok(evaluation);
    assert.equal(evaluation.experimentId, exp.id);
    assert.equal(evaluation.primaryMetric, "likes");
    assert.equal(evaluation.controlMetrics.sampleCount, 3);
    assert.equal(evaluation.controlMetrics.mean, "20.00");

    const varComp = evaluation.variantMetrics[0];
    assert.ok(varComp);
    assert.equal(varComp.mean, "40.00");
    assert.equal(varComp.difference, "20.00");
    assert.equal(varComp.differencePercentage, "100.0");
    assert.equal(evaluation.evidenceQuality, "observed"); // 3 samples
    assert.equal(evaluation.recommendedDecision, "variant_promising"); // 100% diff on observed tier
    assert.match(evaluation.summary, /variant_promising/);
  });

  it("detects guardrail failures when error rate regresses despite primary metric improvement", async () => {
    const s = store();

    const idKey = experimentIdentityKey(OWNER_A, "channel:x", "prompt_variant", `GuardrailExp ${RUN}`);
    const { row: exp } = await s.createExperiment({
      userId: OWNER_A,
      name: `GuardrailExp ${RUN}`,
      hypothesis: "Test guardrail failure",
      objective: "Test guardrail",
      targetScope: "channel:x",
      experimentType: "prompt_variant",
      primaryMetric: "likes",
      guardrailMetrics: ["publication_failure_rate"],
      status: "running",
      minSampleSize: 3,
      startedAt: new Date(),
      identityKey: idKey,
    });

    const { row: vControl } = await s.createVariant({
      userId: OWNER_A,
      experimentId: exp.id,
      variantKey: "control",
      name: "Control",
      isControl: true,
      trafficWeight: 50,
    });

    const { row: vVariant } = await s.createVariant({
      userId: OWNER_A,
      experimentId: exp.id,
      variantKey: "variant_x",
      name: "Variant X",
      isControl: false,
      trafficWeight: 50,
    });

    const [story] = await db
      .insert(stories)
      .values({
        userId: OWNER_A,
        title: `Story Guardrail ${RUN}`,
        insightBody: "Insight body",
        status: "ready",
      })
      .returning();

    // Setup 3 control publications: 0 failures, likes = 10
    for (let i = 1; i <= 3; i++) {
      const [opp] = await db
        .insert(opportunities)
        .values({
          userId: OWNER_A,
          storyId: story.id,
          concept: `Guardrail concept control ${i}`,
          objective: "Guardrail objective",
          channel: "x",
          format: "post",
          status: "approved",
        })
        .returning();
      const [art] = await db.insert(artifacts).values({ userId: OWNER_A, opportunityId: opp.id, channel: "x", format: "post", payload: {}, readiness: "approved" }).returning();
      const [sched] = await db.insert(schedules).values({ userId: OWNER_A, artifactId: art.id, channel: "x", startAt: new Date(), status: "active" }).returning();
      const [occ] = await db.insert(scheduleOccurrences).values({ scheduleId: sched.id, occurrenceTime: new Date(), status: "published" }).returning();
      const [pub] = await db.insert(publications).values({ userId: OWNER_A, scheduleId: sched.id, occurrenceId: occ.id, artifactId: art.id, channel: "x", state: "published", idempotencyKey: `p:g1:${art.id}:${RUN}`, correlationId: `c:g1:${art.id}:${RUN}` }).returning();
      await db.insert(results).values({ userId: OWNER_A, publicationId: pub.id, outcome: "published", metrics: {} });
      await db.insert(performanceSignals).values({ userId: OWNER_A, publicationId: pub.id, artifactId: art.id, channel: "x", provider: "x", externalId: `x-${pub.id}`, metric: "likes", value: "10", availability: "observed", observedAt: new Date(), retrievedAt: new Date(), measurementWindow: "all_time", normalizationVersion: "performance.v1", provenance: {}, identityKey: `ps:g1:${pub.id}:${RUN}` });
      await s.createAssignment({ userId: OWNER_A, experimentId: exp.id, variantId: vControl.id, opportunityId: opp.id, artifactId: art.id, publicationId: pub.id, idempotencyKey: `as:g1:${exp.id}:${art.id}:${RUN}` });
    }

    // Setup 3 variant publications: 2 failures out of 3 (66% failure rate!), likes = 50 (5x higher!)
    for (let i = 4; i <= 6; i++) {
      const isFailed = i > 4;
      const [opp] = await db
        .insert(opportunities)
        .values({
          userId: OWNER_A,
          storyId: story.id,
          concept: `Guardrail concept variant ${i}`,
          objective: "Guardrail objective",
          channel: "x",
          format: "post",
          status: "approved",
        })
        .returning();
      const [art] = await db.insert(artifacts).values({ userId: OWNER_A, opportunityId: opp.id, channel: "x", format: "post", payload: {}, readiness: "approved" }).returning();
      const [sched] = await db.insert(schedules).values({ userId: OWNER_A, artifactId: art.id, channel: "x", startAt: new Date(), status: "active" }).returning();
      const [occ] = await db.insert(scheduleOccurrences).values({ scheduleId: sched.id, occurrenceTime: new Date(), status: isFailed ? "failed" : "published" }).returning();
      const [pub] = await db.insert(publications).values({ userId: OWNER_A, scheduleId: sched.id, occurrenceId: occ.id, artifactId: art.id, channel: "x", state: isFailed ? "failed" : "published", idempotencyKey: `p:g2:${art.id}:${RUN}`, correlationId: `c:g2:${art.id}:${RUN}` }).returning();
      await db.insert(results).values({ userId: OWNER_A, publicationId: pub.id, outcome: isFailed ? "failed" : "published", metrics: {} });
      await db.insert(performanceSignals).values({ userId: OWNER_A, publicationId: pub.id, artifactId: art.id, channel: "x", provider: "x", externalId: `x-${pub.id}`, metric: "likes", value: "50", availability: "observed", observedAt: new Date(), retrievedAt: new Date(), measurementWindow: "all_time", normalizationVersion: "performance.v1", provenance: {}, identityKey: `ps:g2:${pub.id}:${RUN}` });
      await s.createAssignment({ userId: OWNER_A, experimentId: exp.id, variantId: vVariant.id, opportunityId: opp.id, artifactId: art.id, publicationId: pub.id, idempotencyKey: `as:g2:${exp.id}:${art.id}:${RUN}` });
    }

    const evaluation = await evaluateExperiment(db, s, exp.id, OWNER_A);

    // Guardrail MUST flag regression and decision MUST be guardrail_failed!
    assert.equal(evaluation.guardrailResults.length, 1);
    assert.equal(evaluation.guardrailResults[0].status, "regressed");
    assert.equal(evaluation.recommendedDecision, "guardrail_failed");
    assert.match(evaluation.summary, /guardrail regressions/i);
  });

  it("creates policy candidate upon decision and verifies zero production policy/prompt mutation", async () => {
    const s = store();

    // 1. Setup completed experiment with decision
    const idKey = experimentIdentityKey(OWNER_A, "channel:linkedin;format:carousel", "format_distribution", `CandidateExp ${RUN}`);
    const { row: exp } = await s.createExperiment({
      userId: OWNER_A,
      name: `CandidateExp ${RUN}`,
      hypothesis: "Testing candidate generation",
      objective: "Drive LinkedIn engagement",
      targetScope: "channel:linkedin;format:carousel",
      experimentType: "format_distribution",
      primaryMetric: "engagements_per_post",
      status: "completed",
      decision: "variant_preferred",
      identityKey: idKey,
    });

    const { row: testVar } = await s.createVariant({
      userId: OWNER_A,
      experimentId: exp.id,
      variantKey: "variant_carousel",
      name: "Carousel Format (Tested)",
      isControl: false,
      policySnapshot: { format: "carousel", promptDirectives: ["Use 5 slides", "Metric-driven"] },
      trafficWeight: 50,
    });

    // Record initial production policies count for OWNER_A
    const initialPolicies = await db
      .select()
      .from(generationPolicies)
      .where(eq(generationPolicies.userId, OWNER_A));

    // 2. Generate policy candidate
    const candidate = await createPolicyCandidateFromExperiment(
      s,
      exp.id,
      testVar.id,
      OWNER_A,
      "Proposed Carousel Default for LinkedIn",
      "Human review notes: promising experiment, ready for review",
    );

    assert.ok(candidate);
    assert.equal(candidate.experimentId, exp.id);
    assert.equal(candidate.variantId, testVar.id);
    assert.equal(candidate.status, "candidate");
    assert.deepEqual(candidate.proposedConfiguration, testVar.policySnapshot);

    // 3. Human review action: approve for future consideration
    const reviewed = await s.updatePolicyCandidateReview(
      candidate.id,
      OWNER_A,
      "approved_for_future",
      OWNER_A,
      "Approved as future policy candidate. Production policies remain unchanged.",
    );

    assert.ok(reviewed);
    assert.equal(reviewed.status, "approved_for_future");
    assert.equal(reviewed.reviewedBy, OWNER_A);

    // 4. CRITICAL RULE (§23): Verify zero mutation occurred to active GenerationPolicies
    const currentPolicies = await db
      .select()
      .from(generationPolicies)
      .where(eq(generationPolicies.userId, OWNER_A));

    assert.equal(
      currentPolicies.length,
      initialPolicies.length,
      "Production GenerationPolicy count must be exactly unchanged",
    );
  });
});
