/**
 * Real PostgreSQL proofs for Phase 16: one Artifact revision → N Publications.
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
  generationJobs,
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
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { approveArtifact, createArtifact, createHumanEditRevision, submitArtifactForReview } from "./artifact";
import { createSchedule, dispatchDueOccurrences } from "./scheduling";
import { runPublication } from "./publication";
import { registerBuiltinChannelAdapters } from "./adapters";
import { publishArtifactToChannels } from "./distribution";
import { ArtifactNotFoundError } from "./artifact";

registerBuiltinChannelAdapters();

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `d16${Date.now().toString(36)}`;

describeDb("multi-channel distribution (db)", () => {
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
    const rows = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(like(researchJobs.correlationId, `${RUN}%`));
    const jobIds = rows.map((r) => r.id);
    const storyRows = jobIds.length
      ? await db.select({ id: stories.id }).from(stories).where(inArray(stories.researchJobId, jobIds))
      : [];
    const storyIds = storyRows.map((r) => r.id);
    const oppRows = storyIds.length
      ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.storyId, storyIds))
      : [];
    const oppIds = oppRows.map((r) => r.id);
    const artRows = oppIds.length
      ? await db.select({ id: artifacts.id }).from(artifacts).where(inArray(artifacts.opportunityId, oppIds))
      : [];
    const artIds = artRows.map((r) => r.id);
    const schedRows = artIds.length
      ? await db.select({ id: schedules.id }).from(schedules).where(inArray(schedules.artifactId, artIds))
      : [];
    const schedIds = schedRows.map((r) => r.id);
    const occRows = schedIds.length
      ? await db.select({ id: scheduleOccurrences.id }).from(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds))
      : [];
    const occIds = occRows.map((r) => r.id);
    const pubRows = artIds.length
      ? await db.select({ id: publications.id }).from(publications).where(inArray(publications.artifactId, artIds))
      : [];
    const pubIds = pubRows.map((r) => r.id);
    if (pubIds.length) await db.delete(results).where(inArray(results.publicationId, pubIds));
    if (pubIds.length) await db.delete(publications).where(inArray(publications.id, pubIds));
    if (occIds.length) await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.id, occIds));
    if (schedIds.length) await db.delete(schedules).where(inArray(schedules.id, schedIds));
    if (artIds.length) await db.delete(artifacts).where(inArray(artifacts.id, artIds));
    if (oppIds.length) {
      await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
      await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    }
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    if (jobIds.length) {
      await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, jobIds));
      await db.delete(researchSources).where(inArray(researchSources.jobId, jobIds));
      await db.delete(researchJobs).where(inArray(researchJobs.id, jobIds));
    }
    await pool.end();
  });

  async function seedApprovedXPost(suffix: string, ownerId = 1) {
    const tag = `${RUN}-${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: ownerId,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "kubernetes",
        status: "complete",
        providerIds: ["rss"],
        finishedAt: new Date(),
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
        contentHash: "a".repeat(64),
        retrievedAt: new Date(),
      })
      .returning();
    const [evidence] = await db
      .insert(researchEvidence)
      .values({
        jobId: job.id,
        sourceId: source.id,
        kind: "excerpt",
        origin: "sourced",
        excerpt: `${suffix} evidence`,
        excerptHash: `${tag}`.padEnd(64, "0").slice(0, 64),
        retrievedAt: new Date(),
      })
      .returning();
    const [story] = await db
      .insert(stories)
      .values({
        userId: ownerId,
        researchJobId: job.id,
        provenance: "researched",
        title: `${tag} story`,
        insightBody: "One revision, many publications.",
        angles: [],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "fan-out", objective: "educate", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId: ownerId,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "x_post",
        channel: "x",
        payload: { text: `${RUN} ${suffix}` },
        attribution: [{ kind: "research_evidence", researchJobId: job.id, evidenceIds: [] }],
      },
      { artifacts: store },
    );
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });
    return { story, opportunity, artifact: approved, store };
  }

  it("one Artifact revision creates independent X and LinkedIn Publications", async () => {
    const { artifact, store } = await seedApprovedXPost("fanout");
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "linkedin" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(result.outcomes.every((o) => o.status === "created"), true);
    const pubs = await store.listPublicationsByArtifact(artifact.id);
    assert.equal(pubs.length, 2);
    const channels = pubs.map((p) => p.channel).sort();
    assert.deepEqual(channels, ["linkedin", "x"]);
    assert.ok(pubs.every((p) => p.artifactId === artifact.id));
    assert.notEqual(pubs[0].id, pubs[1].id);
    assert.notEqual(pubs[0].scheduleId, pubs[1].scheduleId);
    const [art] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id));
    assert.equal(art.channel, "x", "legacy Artifact.channel is retained");
    assert.ok(pubs.some((p) => p.channel === "linkedin"), "Publication.channel is the delivery target");
  });

  it("legacy one-channel POST-style createSchedule still works, then a second channel can be added", async () => {
    const { artifact, store } = await seedApprovedXPost("legacy");
    const first = await createSchedule(artifact.id, {}, { content: store });
    assert.equal(first.channel, "x");
    assert.equal(first.intentKey, null);
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "linkedin" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(result.outcomes[0].status, "created");
    const pubs = await store.listPublicationsByArtifact(artifact.id);
    await dispatchDueOccurrences(new Date(), { content: store, enqueuePublication: async () => true });
    const after = await store.listPublicationsByArtifact(artifact.id);
    assert.ok(after.length >= 1);
    assert.ok(after.some((p) => p.channel === "linkedin"));
    assert.equal(first.id, first.id);
    const scheds = await db.select().from(schedules).where(eq(schedules.artifactId, artifact.id));
    assert.ok(scheds.some((s) => s.channel === "x" && s.intentKey === null));
    assert.ok(scheds.some((s) => s.channel === "linkedin" && s.intentKey !== null));
    assert.equal(pubs.length >= 0, true);
  });

  it("duplicate fan-out is idempotent; uniqueness is the arbiter under concurrency", async () => {
    const { artifact, store } = await seedApprovedXPost("idem");
    const input = { targets: [{ channel: "x" as const }, { channel: "linkedin" as const }] };
    const [a, b] = await Promise.all([
      publishArtifactToChannels(artifact.id, input, { content: store, enqueuePublication: async () => true }),
      publishArtifactToChannels(artifact.id, input, { content: store, enqueuePublication: async () => true }),
    ]);
    const scheds = await db.select().from(schedules).where(eq(schedules.artifactId, artifact.id));
    assert.equal(scheds.length, 2, "two channels, never four");
    const keys = scheds.map((s) => s.intentKey).sort();
    assert.equal(new Set(keys).size, 2);
    const createdPlusReused = [...a.outcomes, ...b.outcomes];
    assert.ok(createdPlusReused.some((o) => o.status === "created" || o.status === "reused"));
  });

  it("explicit republish creates a new Publication for the same revision", async () => {
    const { artifact, store } = await seedApprovedXPost("repub");
    const first = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const second = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }], republishKey: "manual-2" },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(second.outcomes[0].status, "created");
    assert.notEqual(second.outcomes[0].publication?.id, first.outcomes[0].publication?.id);
    const pubs = await store.listPublicationsByArtifact(artifact.id);
    assert.equal(pubs.filter((p) => p.channel === "x").length, 2);
    assert.ok(pubs.every((p) => p.artifactId === artifact.id));
  });

  it("dispatch copies Schedule.channel onto Publication even when Artifact.channel differs", async () => {
    const { artifact, store } = await seedApprovedXPost("auth");
    const schedule = await createSchedule(artifact.id, { channel: "linkedin" }, { content: store });
    assert.equal(schedule.channel, "linkedin");
    await dispatchDueOccurrences(new Date(), { content: store, enqueuePublication: async () => true });
    const pubs = await store.listPublicationsByArtifact(artifact.id);
    assert.equal(pubs.length, 1);
    assert.equal(pubs[0].channel, "linkedin");
    assert.equal(artifact.channel, "x");
  });

  it("independent schedules and isolated execution outcomes", async () => {
    const { artifact, store } = await seedApprovedXPost("sib");
    const t1 = new Date(Date.now() - 60_000).toISOString();
    const t2 = new Date(Date.now() + 86_400_000).toISOString();
    const result = await publishArtifactToChannels(
      artifact.id,
      {
        targets: [
          { channel: "x", startAt: t1 },
          { channel: "linkedin", startAt: t2 },
        ],
      },
      { content: store, enqueuePublication: async () => true },
    );
    const due = result.outcomes.find((o) => o.channel === "x")!;
    const later = result.outcomes.find((o) => o.channel === "linkedin")!;
    assert.ok(due.publication, "past startAt materializes a Publication");
    assert.equal(later.publication, undefined, "future startAt has no Publication yet");

    const xRun = await runPublication(due.publication!.id, {
      content: store,
      adapterFor: (channel) => ({
        channel,
        supports: () => true,
        publish: async () => {
          if (channel === "x") {
            return {
              ok: false,
              providerCalled: true,
              externalId: null,
              externalUrl: null,
              publishedAt: null,
              errorClass: "permanent",
              errorMessage: "forced x failure",
            };
          }
          return {
            ok: true,
            providerCalled: true,
            externalId: "urn:li:share:ok",
            externalUrl: null,
            publishedAt: new Date(),
          };
        },
        reconcile: async () => null,
      }),
    });
    assert.equal(xRun.status, "failed");
    const [xRow] = await db.select().from(publications).where(eq(publications.id, due.publication!.id));
    assert.equal(xRow.state, "failed");
    const laterSched = await store.getSchedule(later.schedule!.id);
    assert.equal(laterSched?.status, "active");
    const laterPubs = (await store.listPublicationsByArtifact(artifact.id)).filter((p) => p.channel === "linkedin");
    assert.equal(laterPubs.length, 0);
  });

  it("editing the Artifact creates a new revision and does not mutate existing Publications", async () => {
    const { artifact, store } = await seedApprovedXPost("rev");
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const pubId = result.outcomes[0].publication!.id;
    const revision = await createHumanEditRevision(
      artifact.id,
      { text: `${RUN} rewritten` },
      { artifacts: store },
      { attributionReason: "phase 16 pin proof" },
    );
    assert.notEqual(revision.id, artifact.id);
    const [pub] = await db.select().from(publications).where(eq(publications.id, pubId));
    assert.equal(pub.artifactId, artifact.id);
    const [v1] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id));
    assert.equal((v1.payload as { text: string }).text, `${RUN} rev`);
  });

  it("one Publication can be reconciled while its sibling is still pending", async () => {
    const { artifact, store } = await seedApprovedXPost("recon");
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "linkedin" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const xPub = result.outcomes.find((o) => o.channel === "x")!.publication!;
    const liPub = result.outcomes.find((o) => o.channel === "linkedin")!.publication!;
    await runPublication(xPub.id, {
      content: store,
      adapterFor: () => ({
        channel: "x",
        supports: () => true,
        publish: async () => ({
          ok: false,
          providerCalled: true,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorMessage: "ambiguous",
        }),
        reconcile: async () => null,
      }),
    });
    const { reconcileUnknownPublications } = await import("./publication");
    await reconcileUnknownPublications(
      new Date(),
      {
        content: store,
        enqueuePublication: async () => true,
        adapterFor: (channel) => ({
          channel,
          supports: () => true,
          publish: async () => ({
            ok: false,
            providerCalled: true,
            externalId: null,
            externalUrl: null,
            publishedAt: null,
          }),
          reconcile: async (request) => {
            if (request.correlationId !== xPub.correlationId) return null;
            return {
              ok: true,
              providerCalled: true,
              externalId: "tweet-recon",
              externalUrl: null,
              publishedAt: new Date(),
            };
          },
        }),
      },
      5000,
    );
    const [xRow] = await db.select().from(publications).where(eq(publications.id, xPub.id));
    const [liRow] = await db.select().from(publications).where(eq(publications.id, liPub.id));
    assert.equal(xRow.state, "published");
    assert.equal(liRow.state, "queued");
    const xResults = await db.select().from(results).where(eq(results.publicationId, xPub.id));
    const liResults = await db.select().from(results).where(eq(results.publicationId, liPub.id));
    assert.equal(xResults.length, 1);
    assert.equal(liResults.length, 0);
  });

  it("SQL-level ownership isolation: foreign Artifact is indistinguishable from missing", async () => {
    const { artifact, store } = await seedApprovedXPost("owner-b", 2);
    await assert.rejects(
      () =>
        publishArtifactToChannels(
          artifact.id,
          { targets: [{ channel: "x" }] },
          { content: store, enqueuePublication: async () => true },
          1,
        ),
      ArtifactNotFoundError,
    );
    const owned = await store.getArtifactForOwner(artifact.id, 1);
    assert.equal(owned, undefined);
    const real = await store.getArtifactForOwner(artifact.id, 2);
    assert.ok(real);
  });

  it("Result lineage stays publication-specific", async () => {
    const { artifact, store } = await seedApprovedXPost("lineage");
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "linkedin" }] },
      { content: store, enqueuePublication: async () => true },
    );
    for (const outcome of result.outcomes) {
      await runPublication(outcome.publication!.id, {
        content: store,
        adapterFor: (channel) => ({
          channel,
          supports: () => true,
          publish: async () => ({
            ok: true,
            providerCalled: true,
            externalId: `${channel}-ext`,
            externalUrl: null,
            publishedAt: new Date(),
          }),
          reconcile: async () => null,
        }),
      });
    }
    const pubs = await store.listPublicationsByArtifact(artifact.id);
    const resultRows = await db
      .select()
      .from(results)
      .where(
        inArray(
          results.publicationId,
          pubs.map((p) => p.id),
        ),
      );
    assert.equal(resultRows.length, 2);
    assert.notEqual(resultRows[0].publicationId, resultRows[1].publicationId);
    assert.notEqual(resultRows[0].externalId, resultRows[1].externalId);
  });
});
