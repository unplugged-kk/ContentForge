import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  artifacts,
  connectedAccounts,
  opportunities,
  posts,
  researchEvidence,
  researchJobs,
  researchSources,
  scheduleOccurrences,
  schedules,
  stories,
  tweets,
  users,
} from "@shared/schema";
import { db, pool } from "../db";
import { offboardUser } from "./offboard";

describe("offboardUser (real PostgreSQL)", () => {
  let userA = 0;
  let userB = 0;
  let legacyPostId = 0;
  let userBResearchJobId = 0;
  let userBScheduleId = 0;

  before(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [a, b] = await db
      .insert(users)
      .values([
        { email: `offboard-a-${stamp}@example.test`, name: "Offboard User A" },
        { email: `offboard-b-${stamp}@example.test`, name: "Offboard User B" },
      ])
      .returning({ id: users.id });
    userA = a.id;
    userB = b.id;

    // Legacy NULL-owned post must never be touched by offboarding user A.
    const [legacyPost] = await db
      .insert(posts)
      .values({ userId: null, postType: "tweet", status: "draft" })
      .returning({ id: posts.id });
    legacyPostId = legacyPost.id;

    // Seed full relational data for both user A and user B.
    for (const [label, uid] of [
      ["a", userA],
      ["b", userB],
    ] as const) {
      const [post] = await db
        .insert(posts)
        .values({ userId: uid, postType: "thread", status: "draft" })
        .returning({ id: posts.id });
      await db.insert(tweets).values([
        { userId: uid, postId: post.id, position: 0, content: `User ${label} tweet 1`, charCount: 15 },
        { userId: uid, postId: post.id, position: 1, content: `User ${label} tweet 2`, charCount: 15 },
      ]);

      await db.insert(connectedAccounts).values({
        userId: uid,
        platform: "x",
        username: `offboard_${label}_${stamp}`,
        displayName: `User ${label}`,
        isActive: true,
      });

      const [rJob] = await db
        .insert(researchJobs)
        .values({
          userId: uid,
          correlationId: `offboard-corr-${label}-${stamp}`,
          idempotencyKey: `offboard-idem-${label}-${stamp}`,
          query: `Topic for ${label}`,
          status: "complete",
        })
        .returning({ id: researchJobs.id });

      const [rSource] = await db
        .insert(researchSources)
        .values({
          jobId: rJob.id,
          provider: "web",
          kind: "article",
          nativeId: `native-${label}-${stamp}`,
          canonicalUrl: `https://example.test/${label}/${stamp}`,
          retrievedAt: new Date(),
          contentHash: `hash-${label}-${stamp}`.slice(0, 64),
        })
        .returning({ id: researchSources.id });

      await db.insert(researchEvidence).values({
        jobId: rJob.id,
        sourceId: rSource.id,
        excerpt: `Evidence excerpt for ${label}`,
        excerptHash: `evhash-${label}-${stamp}`.slice(0, 64),
        retrievedAt: new Date(),
      });

      const [story] = await db
        .insert(stories)
        .values({
          userId: uid,
          researchJobId: rJob.id,
          title: `Story for ${label}`,
          insightBody: `Insight for ${label}`,
          status: "ready",
        })
        .returning({ id: stories.id });

      const [opp] = await db
        .insert(opportunities)
        .values({
          userId: uid,
          storyId: story.id,
          concept: `Concept ${label}`,
          objective: `Objective ${label}`,
          format: "x_post",
          channel: "x",
        })
        .returning({ id: opportunities.id });

      const [artV1] = await db
        .insert(artifacts)
        .values({
          userId: uid,
          opportunityId: opp.id,
          format: "x_post",
          channel: "x",
          payload: { text: `V1 for ${label}` },
          readiness: "draft",
          provenance: "generated",
          attribution: [],
          attributionReason: "test",
        })
        .returning({ id: artifacts.id });

      const [artV2] = await db
        .insert(artifacts)
        .values({
          userId: uid,
          opportunityId: opp.id,
          format: "x_post",
          channel: "x",
          payload: { text: `V2 for ${label}` },
          readiness: "approved",
          approvedAt: new Date(),
          supersedesId: artV1.id,
          provenance: "human_edit",
          attribution: [],
          attributionReason: "test",
        })
        .returning({ id: artifacts.id });

      const [sched] = await db
        .insert(schedules)
        .values({
          userId: uid,
          artifactId: artV2.id,
          channel: "x",
          startAt: new Date(),
          count: 1,
        })
        .returning({ id: schedules.id });

      await db.insert(scheduleOccurrences).values({
        scheduleId: sched.id,
        occurrenceTime: new Date(),
        status: "pending",
      });

      if (label === "b") {
        userBResearchJobId = rJob.id;
        userBScheduleId = sched.id;
      }
    }
  });

  after(async () => {
    try {
      if (userB) {
        await offboardUser(db, userB, { dryRun: false });
      }
      if (legacyPostId) {
        await db.delete(posts).where(eq(posts.id, legacyPostId));
      }
    } finally {
      await pool.end();
    }
  });

  it("dryRun reports exact counts without deleting any rows, then live run removes only user A", async () => {
    const dry = await offboardUser(db, userA, { dryRun: true });
    assert.equal(dry.found, true);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.counts.users, 1);
    assert.equal(dry.counts.posts, 1);
    assert.equal(dry.counts.tweets, 2);
    assert.equal(dry.counts.stories, 1);
    assert.equal(dry.counts.opportunities, 1);
    assert.equal(dry.counts.artifacts, 2);
    assert.equal(dry.counts.schedules, 1);
    assert.equal(dry.counts.schedule_occurrences, 1);
    assert.equal(dry.counts.connected_accounts, 1);
    assert.equal(dry.counts.research_jobs, 1);
    assert.equal(dry.counts.research_sources, 1);
    assert.equal(dry.counts.research_evidence, 1);

    // Dry run must leave user A untouched.
    const aAfterDry = await db.select({ id: users.id }).from(users).where(eq(users.id, userA));
    assert.equal(aAfterDry.length, 1);

    // Live delete for user A.
    const live = await offboardUser(db, userA, { dryRun: false });
    assert.equal(live.found, true);
    assert.equal(live.dryRun, false);
    assert.deepEqual(live.counts, dry.counts);

    // User A and all user A rows are gone.
    assert.equal((await db.select({ id: users.id }).from(users).where(eq(users.id, userA))).length, 0);
    assert.equal((await db.select({ id: posts.id }).from(posts).where(eq(posts.userId, userA))).length, 0);
    assert.equal((await db.select({ id: tweets.id }).from(tweets).where(eq(tweets.userId, userA))).length, 0);
    assert.equal((await db.select({ id: stories.id }).from(stories).where(eq(stories.userId, userA))).length, 0);
    assert.equal((await db.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.userId, userA))).length, 0);
    assert.equal((await db.select({ id: connectedAccounts.id }).from(connectedAccounts).where(eq(connectedAccounts.userId, userA))).length, 0);
    assert.equal((await db.select({ id: researchJobs.id }).from(researchJobs).where(eq(researchJobs.userId, userA))).length, 0);

    // Re-running for user A returns found: false cleanly.
    const repeat = await offboardUser(db, userA, { dryRun: false });
    assert.equal(repeat.found, false);
    assert.deepEqual(repeat.counts, {});

    // User B and all of user B's rows remain 100% intact.
    assert.equal((await db.select({ id: users.id }).from(users).where(eq(users.id, userB))).length, 1);
    assert.equal((await db.select({ id: posts.id }).from(posts).where(eq(posts.userId, userB))).length, 1);
    assert.equal((await db.select({ id: tweets.id }).from(tweets).where(eq(tweets.userId, userB))).length, 2);
    assert.equal((await db.select({ id: stories.id }).from(stories).where(eq(stories.userId, userB))).length, 1);
    assert.equal((await db.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.userId, userB))).length, 2);
    assert.equal((await db.select({ id: connectedAccounts.id }).from(connectedAccounts).where(eq(connectedAccounts.userId, userB))).length, 1);
    assert.equal((await db.select({ id: researchJobs.id }).from(researchJobs).where(eq(researchJobs.userId, userB))).length, 1);
    assert.equal((await db.select({ id: researchSources.id }).from(researchSources).where(eq(researchSources.jobId, userBResearchJobId))).length, 1);
    assert.equal((await db.select({ id: researchEvidence.id }).from(researchEvidence).where(eq(researchEvidence.jobId, userBResearchJobId))).length, 1);
    assert.equal((await db.select({ id: scheduleOccurrences.id }).from(scheduleOccurrences).where(eq(scheduleOccurrences.scheduleId, userBScheduleId))).length, 1);

    // Legacy userId: null row remains untouched.
    assert.equal((await db.select({ id: posts.id }).from(posts).where(eq(posts.id, legacyPostId))).length, 1);
  });
});
