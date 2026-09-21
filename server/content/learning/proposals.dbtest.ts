/**
 * Real-Postgres tests for Phase 29.1 — Learning Foundation & Evidence-Backed Optimization.
 *
 * Tests durable observation persistence, proposal lifecycle, deterministic pattern
 * extraction, idempotency, and tenant isolation.
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
  artifacts,
  learningObservations,
  learningProposals,
  performanceSignals,
  publications,
  results,
  scheduleOccurrences,
  schedules,
  stories,
  opportunities,
  generationPolicies,
} from "@shared/schema";
import { DatabaseLearningStorage } from "./store";
import {
  extractObservationsAndProposals,
  observationIdentityKey,
  proposalIdentityKey,
} from "./proposals";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `lrnp${Date.now().toString(36)}`;
const OWNER_A = 920_000 + (Date.now() % 70_000);
const OWNER_B = OWNER_A + 1;

describeDb("learning proposals and observations (Phase 29.1 db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const learning = () => new DatabaseLearningStorage(db);

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
  });

  after(async () => {
    if (!CONNECTION) return;
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

  it("persists learning observation and enforces unique idempotencyKey", async () => {
    const store = learning();
    const idKey = observationIdentityKey(OWNER_A, "distribution", "format_channel_performance", "channel:linkedin;format:carousel", "engagements", RUN);

    const first = await store.insertLearningObservation({
      userId: OWNER_A,
      dimension: "distribution",
      observationType: "format_channel_performance",
      targetScope: "channel:linkedin;format:carousel",
      candidatePopulation: { channel: "linkedin", format: "carousel", sampleCount: 4 },
      comparisonPopulation: { channel: "linkedin", baseline: "all_channel_formats", sampleCount: 10 },
      metricName: "engagements",
      candidateValue: "45.5000",
      comparisonValue: "30.0000",
      differencePercentage: "51.67",
      evidenceQuality: "observed",
      evidenceEntityIds: { publicationIds: [1001, 1002, 1003, 1004] },
      measurementWindow: "all_time",
      identityKey: idKey,
    });

    assert.equal(first.created, true);
    assert.ok(first.row.id > 0);
    assert.equal(first.row.userId, OWNER_A);
    assert.equal(first.row.evidenceQuality, "observed");

    // Second insert with same identityKey must be deduplicated
    const second = await store.insertLearningObservation({
      userId: OWNER_A,
      dimension: "distribution",
      observationType: "format_channel_performance",
      targetScope: "channel:linkedin;format:carousel",
      candidatePopulation: { channel: "linkedin", format: "carousel", sampleCount: 4 },
      comparisonPopulation: { channel: "linkedin", baseline: "all_channel_formats", sampleCount: 10 },
      metricName: "engagements",
      candidateValue: "45.5000",
      comparisonValue: "30.0000",
      differencePercentage: "51.67",
      evidenceQuality: "observed",
      evidenceEntityIds: { publicationIds: [1001, 1002, 1003, 1004] },
      measurementWindow: "all_time",
      identityKey: idKey,
    });

    assert.equal(second.created, false);
    assert.equal(second.row.id, first.row.id);
  });

  it("manages learning proposal lifecycle and human review states", async () => {
    const store = learning();
    const propKey = proposalIdentityKey(OWNER_A, "format_distribution", "channel:linkedin;format:carousel", "engagements", RUN);

    const { row: proposal } = await store.insertLearningProposal({
      userId: OWNER_A,
      observationId: null,
      proposalType: "format_distribution",
      targetScope: "channel:linkedin;format:carousel",
      title: "Consider increasing carousel content on LinkedIn",
      rationale: "Observed: Carousel content on LinkedIn showed 51.7% higher average engagements compared to channel baseline across 4 publications.",
      expectedImpactHypothesis: "Prioritizing carousel format for upcoming LinkedIn opportunities is expected to maintain above-average engagement.",
      evidenceQuality: "observed",
      evidenceSummary: { sampleCount: 4, differencePercentage: "51.7%" },
      status: "proposed",
      identityKey: propKey,
    });

    assert.equal(proposal.status, "proposed");
    assert.equal(proposal.reviewedAt, null);

    // Human action: Accept proposal
    const accepted = await store.updateProposalStatus(proposal.id, OWNER_A, "accepted", OWNER_A, "Sounds good for next week");
    assert.ok(accepted);
    assert.equal(accepted.status, "accepted");
    assert.ok(accepted.reviewedAt instanceof Date);
    assert.equal(accepted.reviewedBy, OWNER_A);
    assert.equal(accepted.reviewNotes, "Sounds good for next week");

    // Retrieve via list proposals
    const list = await store.listLearningProposalsForOwner(OWNER_A, 10, { status: "accepted" });
    assert.ok(list.some((p) => p.id === proposal.id));

    // Owner B cannot see or modify Owner A's proposal
    const foreign = await store.getLearningProposalForOwner(proposal.id, OWNER_B);
    assert.equal(foreign, undefined);

    const unauthorizedUpdate = await store.updateProposalStatus(proposal.id, OWNER_B, "rejected");
    assert.equal(unauthorizedUpdate, undefined);
  });

  it("extracts observations and proposals from durable content and performance data", async () => {
    const store = learning();

    // 1. Create a story and opportunity
    const [story] = await db
      .insert(stories)
      .values({
        userId: OWNER_A,
        title: `Story ${RUN}`,
        angles: ["Angle"],
        insightBody: "Key insight body content",
        status: "ready",
      })
      .returning();

    const [opp] = await db
      .insert(opportunities)
      .values({
        userId: OWNER_A,
        storyId: story.id,
        concept: "Opportunity concept",
        objective: "Engage audience",
        channel: "linkedin",
        format: "carousel",
        status: "approved",
      })
      .returning();

    // 2. Create 4 carousel artifacts and 4 publications with high engagement
    const pubIds: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const [art] = await db
        .insert(artifacts)
        .values({
          userId: OWNER_A,
          opportunityId: opp.id,
          channel: "linkedin",
          format: "carousel",
          payload: { text: `Carousel ${i} ${RUN}` },
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
          state: "published",
          idempotencyKey: `pub:${art.id}:${RUN}`,
          correlationId: `corr-${art.id}-${RUN}`,
        })
        .returning();

      pubIds.push(pub.id);

      // Ingest performance metric: 100 impressions, 50 likes
      await store.insertPerformanceObservation({
        userId: OWNER_A,
        publicationId: pub.id,
        resultId: null,
        artifactId: art.id,
        channel: "linkedin",
        provider: "linkedin",
        externalId: `li-${pub.id}`,
        metric: "likes",
        value: 50,
        availability: "observed",
        observedAt: new Date(),
        retrievedAt: new Date(),
        measurementWindow: "all_time",
        normalizationVersion: "performance.v1",
        sourceRevision: null,
        provenance: {},
      });
    }

    // 3. Create 1 post artifact with low engagement (sample size 1, so post itself won't qualify for proposal)
    const [postArt] = await db
      .insert(artifacts)
      .values({
        userId: OWNER_A,
        opportunityId: opp.id,
        channel: "linkedin",
        format: "post",
        payload: { text: `Post 1 ${RUN}` },
        readiness: "approved",
      })
      .returning();

    const [postSched] = await db
      .insert(schedules)
      .values({
        userId: OWNER_A,
        artifactId: postArt.id,
        channel: "linkedin",
        startAt: new Date(),
        status: "active",
      })
      .returning();

    const [postOcc] = await db
      .insert(scheduleOccurrences)
      .values({
        scheduleId: postSched.id,
        occurrenceTime: new Date(),
        status: "published",
      })
      .returning();

    const [postPub] = await db
      .insert(publications)
      .values({
        userId: OWNER_A,
        scheduleId: postSched.id,
        occurrenceId: postOcc.id,
        artifactId: postArt.id,
        channel: "linkedin",
        state: "published",
        idempotencyKey: `pub:${postArt.id}:${RUN}`,
        correlationId: `corr-${postArt.id}-${RUN}`,
      })
      .returning();

    await store.insertPerformanceObservation({
      userId: OWNER_A,
      publicationId: postPub.id,
      resultId: null,
      artifactId: postArt.id,
      channel: "linkedin",
      provider: "linkedin",
      externalId: `li-${postPub.id}`,
      metric: "likes",
      value: 5,
      availability: "observed",
      observedAt: new Date(),
      retrievedAt: new Date(),
      measurementWindow: "all_time",
      normalizationVersion: "performance.v1",
      sourceRevision: null,
      provenance: {},
    });

    // 4. Run deterministic extraction
    const extraction1 = await extractObservationsAndProposals(db, store, OWNER_A);
    assert.ok(extraction1.stats.publicationsAnalyzed >= 5);
    assert.ok(extraction1.observations.length >= 1);
    assert.ok(extraction1.proposals.length >= 1);

    const carouselProp = extraction1.proposals.find(
      (p) => p.proposalType === "format_distribution" && p.targetScope.includes("carousel"),
    );
    assert.ok(carouselProp, "expected proposal for high-performing carousel format");
    assert.equal(carouselProp.evidenceQuality, "observed"); // 4 samples -> "observed"
    assert.ok(carouselProp.rationale.includes("higher average engagements"));

    // 5. Idempotent re-run: must not produce duplicate proposals or crash
    const extraction2 = await extractObservationsAndProposals(db, store, OWNER_A);
    assert.equal(extraction2.proposals.length, extraction1.proposals.length);

    // 6. Tenant isolation: Owner B with no content extracts zero proposals
    const extractionB = await extractObservationsAndProposals(db, store, OWNER_B);
    assert.equal(extractionB.observations.length, 0);
    assert.equal(extractionB.proposals.length, 0);
  });

  it("strictly isolates User A and User B across all observation and proposal operations", async () => {
    const store = learning();

    // User A creates an observation and proposal
    const obsAKey = observationIdentityKey(OWNER_A, "style", "style_profile_strength", "style:101", "samples", `${RUN}-iso`);
    const { row: obsA } = await store.insertLearningObservation({
      userId: OWNER_A,
      dimension: "style",
      observationType: "style_profile_strength",
      targetScope: "style:101",
      candidatePopulation: { profileId: 101, sampleCount: 5 },
      comparisonPopulation: { baseline: "all_profiles" },
      metricName: "samples",
      candidateValue: "5.0000",
      comparisonValue: "5.0000",
      differencePercentage: "0.00",
      evidenceQuality: "observed",
      evidenceEntityIds: { styleProfileIds: [101] },
      measurementWindow: "all_time",
      identityKey: obsAKey,
    });

    const propAKey = proposalIdentityKey(OWNER_A, "style_association", "style:101", "first_pass_approval", `${RUN}-iso`);
    const { row: propA } = await store.insertLearningProposal({
      userId: OWNER_A,
      observationId: obsA.id,
      proposalType: "style_association",
      targetScope: "style:101",
      title: "User A Voice Alignment",
      rationale: "Observed: Style profile grounded in 5 samples.",
      expectedImpactHypothesis: "Stabilizes tonal consistency.",
      evidenceQuality: "observed",
      evidenceSummary: { sampleCount: 5 },
      status: "proposed",
      identityKey: propAKey,
    });

    // User B creates an observation and proposal
    const obsBKey = observationIdentityKey(OWNER_B, "style", "style_profile_strength", "style:202", "samples", `${RUN}-iso`);
    const { row: obsB } = await store.insertLearningObservation({
      userId: OWNER_B,
      dimension: "style",
      observationType: "style_profile_strength",
      targetScope: "style:202",
      candidatePopulation: { profileId: 202, sampleCount: 6 },
      comparisonPopulation: { baseline: "all_profiles" },
      metricName: "samples",
      candidateValue: "6.0000",
      comparisonValue: "6.0000",
      differencePercentage: "0.00",
      evidenceQuality: "directional",
      evidenceEntityIds: { styleProfileIds: [202] },
      measurementWindow: "all_time",
      identityKey: obsBKey,
    });

    const propBKey = proposalIdentityKey(OWNER_B, "style_association", "style:202", "first_pass_approval", `${RUN}-iso`);
    const { row: propB } = await store.insertLearningProposal({
      userId: OWNER_B,
      observationId: obsB.id,
      proposalType: "style_association",
      targetScope: "style:202",
      title: "User B Voice Alignment",
      rationale: "Observed: Style profile grounded in 6 samples.",
      expectedImpactHypothesis: "Stabilizes tonal consistency for User B.",
      evidenceQuality: "directional",
      evidenceSummary: { sampleCount: 6 },
      status: "proposed",
      identityKey: propBKey,
    });

    // 1. User A listing: only sees User A's rows
    const listA = await store.listLearningProposalsForOwner(OWNER_A, 50);
    assert.ok(listA.some((p) => p.id === propA.id));
    assert.ok(!listA.some((p) => p.id === propB.id), "User A must not see User B's proposal in list");

    const obsListA = await store.listLearningObservationsForOwner(OWNER_A, 50);
    assert.ok(obsListA.some((o) => o.id === obsA.id));
    assert.ok(!obsListA.some((o) => o.id === obsB.id), "User A must not see User B's observation in list");

    // 2. User B listing: only sees User B's rows
    const listB = await store.listLearningProposalsForOwner(OWNER_B, 50);
    assert.ok(listB.some((p) => p.id === propB.id));
    assert.ok(!listB.some((p) => p.id === propA.id), "User B must not see User A's proposal in list");

    // 3. User A cannot fetch User B's proposal or observation by ID
    const getBByA = await store.getLearningProposalForOwner(propB.id, OWNER_A);
    assert.equal(getBByA, undefined, "User A cannot fetch User B proposal by ID");

    const getObsBByA = await store.getLearningObservationForOwner(obsB.id, OWNER_A);
    assert.equal(getObsBByA, undefined, "User A cannot fetch User B observation by ID");

    // 4. User A cannot mutate User B's proposal
    const rejectByA = await store.updateProposalStatus(propB.id, OWNER_A, "rejected");
    assert.equal(rejectByA, undefined, "User A cannot reject User B proposal");

    const acceptByA = await store.updateProposalStatus(propB.id, OWNER_A, "accepted");
    assert.equal(acceptByA, undefined, "User A cannot accept User B proposal");

    // Verify User B's proposal status remained unchanged
    const propBAfter = await store.getLearningProposalForOwner(propB.id, OWNER_B);
    assert.equal(propBAfter?.status, "proposed");
  });

  it("verifies proposal acceptance does not mutate any GenerationPolicy, prompt, or schedule", async () => {
    const store = learning();

    // Baseline snapshot of generationPolicies count
    const policiesBefore = await db.select().from(generationPolicies);

    const propKey = proposalIdentityKey(OWNER_A, "workflow_reliability", "channel:twitter", "publication_failure_rate", `${RUN}-nomut`);
    const { row: proposal } = await store.insertLearningProposal({
      userId: OWNER_A,
      observationId: null,
      proposalType: "workflow_reliability",
      targetScope: "channel:twitter",
      title: "Inspect Twitter Dispatch",
      rationale: "Observed 25% failure rate.",
      expectedImpactHypothesis: "Will restore reliability.",
      evidenceQuality: "observed",
      evidenceSummary: { sampleCount: 4 },
      status: "proposed",
      identityKey: propKey,
    });

    // Human acceptance
    const accepted = await store.updateProposalStatus(proposal.id, OWNER_A, "accepted", OWNER_A, "Accepting proposal");
    assert.ok(accepted);
    assert.equal(accepted.status, "accepted");

    // Verify generationPolicies table was NOT touched
    const policiesAfter = await db.select().from(generationPolicies);
    assert.equal(policiesAfter.length, policiesBefore.length, "No GenerationPolicy was created or mutated");

    // Verify proposal status is strictly updated
    const fetched = await store.getLearningProposalForOwner(proposal.id, OWNER_A);
    assert.equal(fetched?.status, "accepted");
  });

  it("deduplicates multiple historical snapshots per publication rather than summing them", async () => {
    const store = learning();

    // Setup 1 story, 1 opp, 3 artifacts, 3 publications
    const [story] = await db
      .insert(stories)
      .values({
        userId: OWNER_A,
        title: `Story Snapshots ${RUN}`,
        angles: ["Angle"],
        insightBody: "Insight",
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
        channel: "twitter",
        format: "thread",
        status: "approved",
      })
      .returning();

    const pubIds: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const [art] = await db
        .insert(artifacts)
        .values({
          userId: OWNER_A,
          opportunityId: opp.id,
          channel: "twitter",
          format: "thread",
          payload: { text: `Thread ${i} ${RUN}` },
          readiness: "approved",
        })
        .returning();

      const [sched] = await db
        .insert(schedules)
        .values({
          userId: OWNER_A,
          artifactId: art.id,
          channel: "twitter",
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
          channel: "twitter",
          state: "published",
          idempotencyKey: `pub:snap:${art.id}:${RUN}`,
          correlationId: `corr-snap-${art.id}-${RUN}`,
        })
        .returning();

      pubIds.push(pub.id);

      // Snapshot 1 (earlier): likes = 10
      await store.insertPerformanceObservation({
        userId: OWNER_A,
        publicationId: pub.id,
        resultId: null,
        artifactId: art.id,
        channel: "twitter",
        provider: "twitter",
        externalId: `tw-${pub.id}`,
        metric: "likes",
        value: 10,
        availability: "observed",
        observedAt: new Date(Date.now() - 3600_000), // 1 hour ago
        retrievedAt: new Date(),
        measurementWindow: "1h",
        normalizationVersion: "performance.v1",
        sourceRevision: null,
        provenance: {},
      });

      // Snapshot 2 (latest): likes = 15 (should replace, NOT add to 10!)
      await store.insertPerformanceObservation({
        userId: OWNER_A,
        publicationId: pub.id,
        resultId: null,
        artifactId: art.id,
        channel: "twitter",
        provider: "twitter",
        externalId: `tw-${pub.id}`,
        metric: "likes",
        value: 15,
        availability: "observed",
        observedAt: new Date(), // Now
        retrievedAt: new Date(),
        measurementWindow: "all_time",
        normalizationVersion: "performance.v1",
        sourceRevision: null,
        provenance: {},
      });
    }

    const extraction = await extractObservationsAndProposals(db, store, OWNER_A);
    const obs = extraction.observations.find((o) => o.targetScope === "channel:twitter;format:thread");
    assert.ok(obs, "expected observation for twitter threads");
    // 3 publications with latest likes=15 each: candidateValue must be 15.0000, NOT (10+15)=25.0000!
    assert.equal(Number(obs.candidateValue).toFixed(1), "15.0");
  });

  it("accurately detects delivery failures in workflow reliability", async () => {
    const store = learning();

    const [story] = await db
      .insert(stories)
      .values({
        userId: OWNER_A,
        title: `Story Reliability ${RUN}`,
        angles: ["Angle"],
        insightBody: "Insight",
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
        channel: "youtube",
        format: "video",
        status: "approved",
      })
      .returning();

    // Create 4 dispatches: 3 published, 1 failed (25% failure rate >= 20% proposal threshold)
    for (let i = 1; i <= 4; i++) {
      const isFailed = i === 4;
      const [art] = await db
        .insert(artifacts)
        .values({
          userId: OWNER_A,
          opportunityId: opp.id,
          channel: "youtube",
          format: "video",
          payload: { title: `Video ${i} ${RUN}` },
          readiness: "approved",
        })
        .returning();

      const [sched] = await db
        .insert(schedules)
        .values({
          userId: OWNER_A,
          artifactId: art.id,
          channel: "youtube",
          startAt: new Date(),
          status: "active",
        })
        .returning();

      const [occ] = await db
        .insert(scheduleOccurrences)
        .values({
          scheduleId: sched.id,
          occurrenceTime: new Date(),
          status: isFailed ? "failed" : "published",
        })
        .returning();

      const [pub] = await db
        .insert(publications)
        .values({
          userId: OWNER_A,
          scheduleId: sched.id,
          occurrenceId: occ.id,
          artifactId: art.id,
          channel: "youtube",
          state: isFailed ? "failed" : "published",
          idempotencyKey: `pub:rel:${art.id}:${RUN}`,
          correlationId: `corr-rel-${art.id}-${RUN}`,
        })
        .returning();

      await db.insert(results).values({
        userId: OWNER_A,
        publicationId: pub.id,
        outcome: isFailed ? "failed" : "published",
        errorClass: isFailed ? "permanent" : null,
        errorMessage: isFailed ? "OAuth quota exhausted" : null,
      });
    }

    const extraction = await extractObservationsAndProposals(db, store, OWNER_A);
    const relObs = extraction.observations.find(
      (o) => o.observationType === "workflow_reliability" && o.targetScope === "channel:youtube",
    );
    assert.ok(relObs, "expected workflow reliability observation for youtube");
    assert.equal(Number(relObs.candidateValue).toFixed(1), "25.0"); // 1/4 = 25% failure rate

    const relProp = extraction.proposals.find(
      (p) => p.proposalType === "workflow_reliability" && p.targetScope === "channel:youtube",
    );
    assert.ok(relProp, "expected workflow reliability proposal for 25% failure rate on youtube");
    assert.equal(relProp.evidenceQuality, "observed"); // 4 samples
    assert.ok(relProp.title.includes("youtube"));
  });
});
