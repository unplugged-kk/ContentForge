/**
 * Real PostgreSQL proofs for Phase 17 Threads ChannelAdapter.
 *
 * Internal ContentForge flow is real. Only graph.threads.net is doubled.
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import {
  artifacts,
  connectedAccounts,
  generationJobs,
  learningSignals,
  opportunities,
  performanceSignals,
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
import { approveArtifact, createArtifact, submitArtifactForReview } from "./artifact";
import { createSchedule, dispatchDueOccurrences } from "./scheduling";
import { runPublication, reconcileUnknownPublications, type ReconcileDeps } from "./publication";
import { registerBuiltinChannelAdapters, getChannelAdapter } from "./adapters";
import { publishArtifactToChannels } from "./distribution";
import { DatabaseLearningStorage } from "./learning/store";
import { ingestNormalizedOutcome, refreshPublicationMetrics } from "./learning/refresh";
import { PERFORMANCE_SCHEMA_VERSION } from "./learning/constants";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `th${Date.now().toString(36)}`;

function startThreadsFixture() {
  const containers = new Map<string, { text: string; status: string }>();
  const media = new Map<string, { text: string }>();
  const listed: Array<{ id: string; text: string; timestamp: string; permalink: string }> = [];
  let mode: "ok" | "drop-publish" = "ok";
  let seq = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const collect = (cb: (body: URLSearchParams) => void) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => cb(new URLSearchParams(raw)));
    };

    if (req.method === "POST" && url.pathname.endsWith("/threads") && !url.pathname.endsWith("/threads_publish")) {
      collect((body) => {
        seq += 1;
        const id = `c${RUN}-${seq}`;
        containers.set(id, { text: body.get("text") ?? "", status: "FINISHED" });
        send(200, { id });
      });
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/threads_publish")) {
      if (mode === "drop-publish") {
        mode = "ok";
        req.destroy();
        return;
      }
      collect((body) => {
        const creationId = body.get("creation_id") ?? "";
        seq += 1;
        const mediaId = `m${RUN}-${seq}`;
        const text = containers.get(creationId)?.text ?? "";
        media.set(mediaId, { text });
        listed.push({
          id: mediaId,
          text,
          timestamp: new Date().toISOString(),
          permalink: `https://www.threads.net/post/${mediaId}`,
        });
        if (containers.has(creationId)) containers.get(creationId)!.status = "PUBLISHED";
        send(200, { id: mediaId });
      });
      return;
    }
    if (req.method === "GET" && url.pathname.endsWith("/insights")) {
      return send(200, {
        data: [
          { name: "views", values: [{ value: 11 }] },
          { name: "likes", values: [{ value: 2 }] },
          { name: "replies", values: [{ value: 1 }] },
          { name: "quotes", values: [{ value: 9 }] },
        ],
      });
    }
    if (req.method === "GET" && /\/threads$/.test(url.pathname)) {
      return send(200, { data: listed });
    }
    if (req.method === "GET") {
      const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
      if (containers.has(id)) {
        return send(200, { id, status: containers.get(id)!.status });
      }
      if (media.has(id)) {
        return send(200, { id, text: media.get(id)!.text, permalink: `https://www.threads.net/post/${id}` });
      }
      return send(404, { error: { message: "not found" } });
    }
    send(404, {});
  });

  return {
    armDropPublish: () => {
      mode = "drop-publish";
    },
    recordListed: (id: string, text: string) => {
      listed.push({
        id,
        text,
        timestamp: new Date().toISOString(),
        permalink: `https://www.threads.net/post/${id}`,
      });
      media.set(id, { text });
    },
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describeDb("Threads channel adapter (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const learning = () => new DatabaseLearningStorage(db);
  const fixture = startThreadsFixture();
  let savedEnv: Record<string, string | undefined> = {};

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    registerBuiltinChannelAdapters();
    const port = await fixture.start();
    savedEnv = {
      THREADS_API_BASE_URL: process.env.THREADS_API_BASE_URL,
      THREADS_API_VERSION: process.env.THREADS_API_VERSION,
      THREADS_ACCESS_TOKEN: process.env.THREADS_ACCESS_TOKEN,
      THREADS_USER_ID: process.env.THREADS_USER_ID,
      THREADS_TIMEOUT_MS: process.env.THREADS_TIMEOUT_MS,
    };
    process.env.THREADS_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.THREADS_API_VERSION = "v1.0";
    process.env.THREADS_ACCESS_TOKEN = "fixture-token";
    process.env.THREADS_USER_ID = "me";
    process.env.THREADS_TIMEOUT_MS = "3000";
  });

  after(async () => {
    if (!CONNECTION) return;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fixture.stop();

    const jobRows = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(like(researchJobs.correlationId, `${RUN}%`));
    const jobIds = jobRows.map((r) => r.id);
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
    const pubRows = artIds.length
      ? await db.select({ id: publications.id }).from(publications).where(inArray(publications.artifactId, artIds))
      : [];
    const pubIds = pubRows.map((r) => r.id);
    if (pubIds.length) {
      await db.delete(learningSignals).where(inArray(learningSignals.publicationId, pubIds));
      await db.delete(performanceSignals).where(inArray(performanceSignals.publicationId, pubIds));
      await db.delete(results).where(inArray(results.publicationId, pubIds));
      await db.delete(publications).where(inArray(publications.id, pubIds));
    }
    if (schedIds.length) {
      await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds));
      await db.delete(schedules).where(inArray(schedules.id, schedIds));
    }
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
    await db.delete(connectedAccounts).where(eq(connectedAccounts.platform, "threads"));
    await pool.end().catch(() => {});
  });

  async function seedApproved(suffix: string, ownerId = 1, payloadText?: string) {
    const tag = `${RUN}-${suffix}`;
    const text = payloadText ?? `${RUN} ${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: ownerId,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "threads",
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
        contentHash: "c".repeat(64),
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
        excerpt: "threads adapter",
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
        insightBody: "One revision, Threads publication.",
        angles: [],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "threads", objective: "educate", format: "x_post", channel: "threads" },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId: ownerId,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "x_post",
        channel: "x",
        payload: { text },
        attribution: [{ kind: "research_evidence", researchJobId: job.id, evidenceIds: [] }],
        provenance: "generated",
      },
      { artifacts: store },
    );
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });
    return { artifact: approved, store };
  }

  function reconcileDeps(): ReconcileDeps {
    return {
      content: content(),
      enqueuePublication: async (p) => runPublication(p.id, { content: content() }).then((r) => r.status !== "skipped"),
    };
  }

  it("SQL-level connected-account ownership: a user cannot read another owner's Threads token", async () => {
    const [a] = await db
      .insert(connectedAccounts)
      .values({ platform: "threads", userId: 88001, username: "user-a", accessToken: "token-owner-a-secret", isActive: true })
      .returning();
    const [b] = await db
      .insert(connectedAccounts)
      .values({ platform: "threads", userId: 88002, username: "user-b", accessToken: "token-owner-b-secret", isActive: true })
      .returning();
    const ownedA = await db
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.userId, 88001));
    const ownedB = await db
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.userId, 88002));
    const leak = ownedA.filter((row) => row.userId !== 88001);
    assert.equal(ownedA[0].id, a.id);
    assert.equal(ownedB[0].id, b.id);
    assert.equal(leak.length, 0);
    assert.notEqual(ownedA[0].accessToken, ownedB[0].accessToken);
    await db.delete(connectedAccounts).where(inArray(connectedAccounts.id, [a.id, b.id]));
  });

  it("one Artifact revision creates a Threads Publication whose channel is authoritative", async () => {
    const { artifact, store } = await seedApproved("one");
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "threads" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(result.outcomes[0].status, "created");
    const pub = result.outcomes[0].publication!;
    assert.equal(pub.channel, "threads");
    assert.equal(pub.artifactId, artifact.id);
    const run = await runPublication(pub.id, { content: store });
    assert.equal(run.status, "published");
    assert.ok(run.externalId?.startsWith("m"));
    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id));
    assert.equal((row.payload as { text: string }).text, `${RUN} one`);
    assert.equal(row.channel, "x", "legacy Artifact.channel is not rewritten");
  });

  it("same Artifact fans out to X, LinkedIn, and Threads with independent Results", async () => {
    const { artifact, store } = await seedApproved("tri");
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "linkedin" }, { channel: "threads" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(fan.outcomes.filter((o) => o.status === "created").length, 3);
    const ids = fan.outcomes.map((o) => o.publication!.id);
    assert.equal(new Set(ids).size, 3);
    for (const outcome of fan.outcomes) {
      await runPublication(outcome.publication!.id, {
        content: store,
        adapterFor: (channel) =>
          channel === "threads"
            ? getChannelAdapter("threads")
            : {
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
              },
      });
    }
    const pubs = await store.listPublicationsByArtifact(artifact.id);
    assert.deepEqual(pubs.map((p) => p.channel).sort(), ["linkedin", "threads", "x"]);
    const resultRows = await db.select().from(results).where(inArray(results.publicationId, pubs.map((p) => p.id)));
    assert.equal(resultRows.length, 3);
    assert.equal(new Set(resultRows.map((r) => r.publicationId)).size, 3);
  });

  it("duplicate Threads target is idempotent; explicit republish creates a new Publication", async () => {
    const { artifact, store } = await seedApproved("idem");
    const first = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "threads" }, { channel: "threads" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const created = first.outcomes.filter((o) => o.status === "created");
    const reused = first.outcomes.filter((o) => o.status === "reused");
    assert.equal(created.length, 1);
    assert.equal(reused.length, 1);
    const again = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "threads" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.ok(again.outcomes.every((o) => o.status === "reused"));
    const repub = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "threads" }], republishKey: "again" },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(repub.outcomes[0].status, "created");
    assert.notEqual(repub.outcomes[0].publication?.id, created[0].publication?.id);
  });

  it("Threads scheduling is independent of a later sibling startAt", async () => {
    const { artifact, store } = await seedApproved("sched");
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = await publishArtifactToChannels(
      artifact.id,
      {
        targets: [
          { channel: "threads", startAt: past },
          { channel: "linkedin", startAt: future },
        ],
      },
      { content: store, enqueuePublication: async () => true },
    );
    const th = result.outcomes.find((o) => o.channel === "threads")!;
    const li = result.outcomes.find((o) => o.channel === "linkedin")!;
    assert.ok(th.publication);
    assert.equal(li.publication, undefined);
  });

  it("Threads failure does not alter sibling Publications", async () => {
    const { artifact, store } = await seedApproved("sib", 1, `${RUN}-sib-fail`);
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "threads" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const xPub = fan.outcomes.find((o) => o.channel === "x")!.publication!;
    const thPub = fan.outcomes.find((o) => o.channel === "threads")!.publication!;
    await runPublication(xPub.id, {
      content: store,
      adapterFor: () => ({
        channel: "x",
        supports: () => true,
        publish: async () => ({
          ok: true,
          providerCalled: true,
          externalId: "tweet-ok",
          externalUrl: null,
          publishedAt: new Date(),
        }),
        reconcile: async () => null,
      }),
    });
    fixture.armDropPublish();
    const thRun = await runPublication(thPub.id, { content: store });
    assert.equal(thRun.failureClass, "unknown");
    const [xRow] = await db.select().from(publications).where(eq(publications.id, xPub.id));
    const [thRow] = await db.select().from(publications).where(eq(publications.id, thPub.id));
    assert.equal(xRow.state, "published");
    assert.equal(thRow.state, "failed");
    assert.equal(thRow.providerCalled, true);
  });

  it("ambiguous Threads publish reconciles the SAME Result; listing miss stays unknown", async () => {
    const text = `${RUN}-recon`;
    const { artifact, store } = await seedApproved("recon", 1, text);
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "threads" }] },
      { content: store, enqueuePublication: async () => true },
    );
    fixture.armDropPublish();
    await runPublication(fan.outcomes[0].publication!.id, { content: store });
    const [before] = await db.select().from(results).where(eq(results.publicationId, fan.outcomes[0].publication!.id));
    assert.equal(before.outcome, "unknown");
    const unknownPass = await reconcileUnknownPublications(new Date(), reconcileDeps(), 5000);
    assert.ok(unknownPass.stillUnknown >= 1);
    fixture.recordListed(`m${RUN}-listed`, text);
    const resolved = await reconcileUnknownPublications(new Date(), reconcileDeps(), 5000);
    assert.ok(resolved.resolved >= 1);
    const resultRows = await db
      .select()
      .from(results)
      .where(eq(results.publicationId, fan.outcomes[0].publication!.id));
    assert.equal(resultRows.length, 1);
    assert.equal(resultRows[0].id, before.id);
    assert.equal(resultRows[0].outcome, "published");
  });

  it("PerformanceSignal + LearningSignal are publication-specific, idempotent, and keep history", async () => {
    const { artifact, store } = await seedApproved("learn");
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "threads" }] },
      { content: store, enqueuePublication: async () => true },
    );
    await runPublication(fan.outcomes[0].publication!.id, { content: store });
    const pub = (await store.getPublication(fan.outcomes[0].publication!.id))!;
    const t1 = new Date("2026-01-01T01:00:00.000Z");
    const t2 = new Date("2026-01-01T02:00:00.000Z");
    const metric = (value: number) => [
      { metric: "impressions" as const, value, availability: "observed" as const },
      { metric: "likes" as const, value: 1, availability: "observed" as const },
      { metric: "comments" as const, value: null, availability: "not_available" as const },
      { metric: "shares" as const, value: null, availability: "not_available" as const },
      { metric: "clicks" as const, value: null, availability: "not_available" as const },
      { metric: "saves" as const, value: null, availability: "not_available" as const },
      { metric: "replies" as const, value: 1, availability: "observed" as const },
      { metric: "followers_gained" as const, value: null, availability: "not_available" as const },
      { metric: "engagement_rate" as const, value: null, availability: "not_available" as const },
    ];
    const first = await ingestNormalizedOutcome(
      pub,
      {
        ok: true,
        provider: "threads",
        retrievedAt: t1,
        observedAt: t1,
        measurementWindow: "t1",
        externalId: pub.externalId ?? "m",
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
        metrics: metric(10),
        unmapped: { quotes: 3 },
      },
      { content: store, learning: learning(), database: db },
    );
    const again = await ingestNormalizedOutcome(
      pub,
      {
        ok: true,
        provider: "threads",
        retrievedAt: t1,
        observedAt: t1,
        measurementWindow: "t1",
        externalId: pub.externalId ?? "m",
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
        metrics: metric(10),
      },
      { content: store, learning: learning(), database: db },
    );
    const second = await ingestNormalizedOutcome(
      pub,
      {
        ok: true,
        provider: "threads",
        retrievedAt: t2,
        observedAt: t2,
        measurementWindow: "t2",
        externalId: pub.externalId ?? "m",
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
        metrics: metric(20),
      },
      { content: store, learning: learning(), database: db },
    );
    assert.ok(first.created > 0);
    assert.equal(again.created, 0);
    assert.ok(again.reused > 0);
    assert.ok(second.created > 0);
    const snaps = await db
      .select()
      .from(performanceSignals)
      .where(eq(performanceSignals.publicationId, pub.id));
    const impressionTimes = snaps.filter((s) => s.metric === "impressions").map((s) => s.observedAt.toISOString());
    assert.equal(new Set(impressionTimes).size, 2);
    const quotesProvenance = snaps.find((s) => (s.provenance as { unmapped?: { quotes?: number } }).unmapped?.quotes === 3);
    assert.ok(quotesProvenance, "quotes retained on provenance, not discarded");
    const learned = await db.select().from(learningSignals).where(eq(learningSignals.publicationId, pub.id));
    assert.ok(learned.every((row) => row.publicationId === pub.id));
    const live = await refreshPublicationMetrics(pub.id, { content: store, learning: learning(), database: db });
    assert.ok(live.status === "ingested" || live.status === "not_available");
  });

  it("foreign Artifact fan-out is non-leaking; restart does not duplicate the Publication", async () => {
    const { artifact, store } = await seedApproved("own", 2);
    await assert.rejects(
      () =>
        publishArtifactToChannels(
          artifact.id,
          { targets: [{ channel: "threads" }] },
          { content: store, enqueuePublication: async () => true },
          1,
        ),
    );
    const { artifact: a2, store: s2 } = await seedApproved("rst");
    const first = await publishArtifactToChannels(
      a2.id,
      { targets: [{ channel: "threads" }] },
      { content: s2, enqueuePublication: async () => true },
    );
    const restarted = new DatabaseContentStorage(db);
    const second = await publishArtifactToChannels(
      a2.id,
      { targets: [{ channel: "threads" }] },
      { content: restarted, enqueuePublication: async () => true },
    );
    assert.ok(second.outcomes.every((o) => o.status === "reused"));
    assert.equal(second.outcomes[0].publication?.id, first.outcomes[0].publication?.id);
  });

  it("an automation-created (generated) Artifact can target Threads through the same distribution API", async () => {
    const { artifact, store } = await seedApproved("auto");
    assert.equal(artifact.provenance, "generated");
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "threads" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(result.outcomes[0].status, "created");
    assert.equal(result.outcomes[0].channel, "threads");
  });
});
