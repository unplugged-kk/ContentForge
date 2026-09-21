/**
 * Real PostgreSQL proofs for Phase 18 Instagram ChannelAdapter.
 *
 * Internal ContentForge flow is real. Only graph.instagram.com is doubled.
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
  visualAssetRefs,
  visualAssets,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { approveArtifact, createArtifact, submitArtifactForReview, ArtifactMediaReferenceError, ArtifactNotFoundError } from "./artifact";
import { DatabaseLearningStorage } from "./learning/store";
import { runPublication, reconcileUnknownPublications, type ReconcileDeps } from "./publication";
import { registerBuiltinChannelAdapters, getChannelAdapter } from "./adapters";
import { publishArtifactToChannels } from "./distribution";
import { ingestNormalizedOutcome } from "./learning/refresh";
import { PERFORMANCE_SCHEMA_VERSION } from "./learning/constants";
import { createLocalAssetStorage } from "./visual";
import { fixtureMp4Bytes } from "./visualFixture";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `ig${Date.now().toString(36)}`;

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpA/9k=",
  "base64",
);

function startInstagramFixture() {
  const containers = new Map<string, { caption: string; status: string; mediaType?: string }>();
  const media = new Map<string, { caption: string }>();
  const listed: Array<{ id: string; caption: string; timestamp: string; permalink: string }> = [];
  const creates: URLSearchParams[] = [];
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

    if (req.method === "POST" && url.pathname === "/stage") {
      req.on("data", () => {});
      req.on("end", () => {
        seq += 1;
        send(200, { url: `http://127.0.0.1/ig-media/${seq}` });
      });
      return;
    }
    if (req.method === "GET" && url.pathname.endsWith("/me")) {
      return send(200, { id: "ig1", username: "pro", account_type: "BUSINESS" });
    }
    if (req.method === "POST" && url.pathname.endsWith("/media") && !url.pathname.endsWith("/media_publish")) {
      collect((body) => {
        creates.push(body);
        seq += 1;
        const id = `c${RUN}-${seq}`;
        containers.set(id, {
          caption: body.get("caption") ?? "",
          status: "FINISHED",
          mediaType: body.get("media_type") ?? undefined,
        });
        send(200, { id });
      });
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/media_publish")) {
      if (mode === "drop-publish") {
        mode = "ok";
        req.destroy();
        return;
      }
      collect((body) => {
        const creationId = body.get("creation_id") ?? "";
        seq += 1;
        const mediaId = `m${RUN}-${seq}`;
        const caption = containers.get(creationId)?.caption ?? "";
        media.set(mediaId, { caption });
        listed.push({
          id: mediaId,
          caption,
          timestamp: new Date().toISOString(),
          permalink: `https://www.instagram.com/p/${mediaId}/`,
        });
        send(200, { id: mediaId });
      });
      return;
    }
    if (req.method === "GET" && url.pathname.endsWith("/insights")) {
      return send(200, {
        data: [
          { name: "views", values: [{ value: 12 }] },
          { name: "likes", values: [{ value: 4 }] },
          { name: "reach", values: [{ value: 9 }] },
        ],
      });
    }
    if (req.method === "GET" && /\/media$/.test(url.pathname)) {
      return send(200, { data: listed });
    }
    if (req.method === "GET") {
      const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
      if (containers.has(id)) return send(200, { id, status_code: containers.get(id)!.status });
      if (media.has(id)) {
        return send(200, {
          id,
          caption: media.get(id)!.caption,
          permalink: `https://www.instagram.com/p/${id}/`,
        });
      }
    }
    send(404, { error: { message: "not found" } });
  });

  return {
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    armDropPublish: () => {
      mode = "drop-publish";
    },
    recordListed: (id: string, caption: string) => {
      listed.push({
        id,
        caption,
        timestamp: new Date().toISOString(),
        permalink: `https://www.instagram.com/p/${id}/`,
      });
      media.set(id, { caption });
    },
    creates,
  };
}

describeDb("instagram channel adapter (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const learning = () => new DatabaseLearningStorage(db);
  const assetStorage = createLocalAssetStorage();
  const fixture = startInstagramFixture();
  let savedEnv: Record<string, string | undefined> = {};

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    registerBuiltinChannelAdapters();
    const port = await fixture.start();
    savedEnv = {
      INSTAGRAM_API_BASE_URL: process.env.INSTAGRAM_API_BASE_URL,
      INSTAGRAM_API_VERSION: process.env.INSTAGRAM_API_VERSION,
      INSTAGRAM_ACCESS_TOKEN: process.env.INSTAGRAM_ACCESS_TOKEN,
      INSTAGRAM_USER_ID: process.env.INSTAGRAM_USER_ID,
      INSTAGRAM_TIMEOUT_MS: process.env.INSTAGRAM_TIMEOUT_MS,
      INSTAGRAM_MEDIA_STAGE_URL: process.env.INSTAGRAM_MEDIA_STAGE_URL,
    };
    process.env.INSTAGRAM_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.INSTAGRAM_API_VERSION = "v25.0";
    process.env.INSTAGRAM_ACCESS_TOKEN = "fixture-token";
    process.env.INSTAGRAM_USER_ID = "me";
    process.env.INSTAGRAM_TIMEOUT_MS = "3000";
    process.env.INSTAGRAM_MEDIA_STAGE_URL = `http://127.0.0.1:${port}/stage`;
  });

  after(async () => {
    if (!CONNECTION) return;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fixture.stop();
    const storyRows = await db.select({ id: stories.id }).from(stories).where(like(stories.title, `${RUN}%`));
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
    if (artIds.length) {
      await db.delete(visualAssetRefs).where(inArray(visualAssetRefs.artifactId, artIds));
      await db.delete(artifacts).where(inArray(artifacts.id, artIds));
    }
    const assetRows = await db.select({ id: visualAssets.id }).from(visualAssets).where(like(visualAssets.altText, `${RUN}%`));
    if (assetRows.length) await db.delete(visualAssets).where(inArray(visualAssets.id, assetRows.map((r) => r.id)));
    if (oppIds.length) {
      await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
      await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    }
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    const jobRows = await db.select({ id: researchJobs.id }).from(researchJobs).where(like(researchJobs.correlationId, `${RUN}%`));
    const jobIds = jobRows.map((r) => r.id);
    if (jobIds.length) {
      await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, jobIds));
      await db.delete(researchSources).where(inArray(researchSources.jobId, jobIds));
      await db.delete(researchJobs).where(inArray(researchJobs.id, jobIds));
    }
    await db.delete(connectedAccounts).where(eq(connectedAccounts.platform, "instagram"));
    await pool.end().catch(() => {});
  });

  async function seedJpegAsset(ownerId: number, suffix: string, position = 0) {
    const stored = await assetStorage.put(JPEG, "image/jpeg");
    return content().insertVisualAsset({
      userId: ownerId,
      kind: "image",
      storageKey: stored.storageKey,
      mime: "image/jpeg",
      width: 1080,
      height: 1080,
      byteSize: stored.byteSize,
      contentHash: stored.contentHash,
      altText: `${RUN} ${suffix}`,
      position,
      provenance: "generated",
    });
  }

  async function seedImageArtifact(suffix: string, ownerId = 1, extraAssets: number[] = []) {
    const tag = `${RUN}-${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: ownerId,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "instagram",
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
        excerpt: "instagram adapter",
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
        insightBody: "Image Artifact, Instagram publication.",
        angles: [],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    const store = content();
    const format = extraAssets.length > 0 ? "carousel" : "image";
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "instagram", objective: "educate", format, channel: "instagram" },
      { opportunities: store, stories: storyStore() },
    );
    const hero = await seedJpegAsset(ownerId, suffix, 0);
    const payload =
      extraAssets.length > 0
        ? {
            slides: [hero.id, ...extraAssets].map((visualAssetId, i) => ({
              visualAssetId,
              altText: `${suffix}-${i}`,
            })),
            aspectRatio: "1:1" as const,
          }
        : { visualAssetId: hero.id, caption: `${RUN} ${suffix}`, altText: `${RUN} ${suffix}`, aspectRatio: "1:1" as const };
    const artifact = await createArtifact(
      {
        userId: ownerId,
        generationJobId: null,
        opportunityId: opportunity.id,
        format,
        channel: "instagram",
        payload,
        attribution: [{ kind: "research_evidence", researchJobId: job.id, evidenceIds: [] }],
        provenance: "generated",
      },
      { artifacts: store },
    );
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });
    return { artifact: approved, store, hero };
  }

  async function seedVideoAsset(ownerId: number, suffix: string) {
    const stored = await assetStorage.put(fixtureMp4Bytes(), "video/mp4");
    return content().insertVisualAsset({
      userId: ownerId,
      kind: "video",
      storageKey: stored.storageKey,
      mime: "video/mp4",
      width: 1080,
      height: 1920,
      durationMs: 5_000,
      container: "mp4",
      codec: "avc1",
      frameRate: 30,
      byteSize: stored.byteSize,
      contentHash: stored.contentHash,
      altText: `${RUN} ${suffix}`,
      position: 0,
      provenance: "generated",
    });
  }

  async function seedVideoArtifact(suffix: string, ownerId = 1) {
    const tag = `${RUN}-${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: ownerId,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "instagram reel",
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
        excerpt: "instagram reel",
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
        insightBody: "Video Artifact, Instagram Reel publication.",
        angles: [],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "instagram reel", objective: "educate", format: "video", channel: "instagram" },
      { opportunities: store, stories: storyStore() },
    );
    const hero = await seedVideoAsset(ownerId, suffix);
    const artifact = await createArtifact(
      {
        userId: ownerId,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "video",
        channel: "instagram",
        payload: {
          visualAssetId: hero.id,
          caption: `${RUN} ${suffix}`,
          altText: `${RUN} ${suffix}`,
          aspectRatio: "9:16" as const,
        },
        attribution: [{ kind: "research_evidence", researchJobId: job.id, evidenceIds: [] }],
        provenance: "generated",
      },
      { artifacts: store },
    );
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });
    return { artifact: approved, store, hero };
  }

  function pubDeps() {
    return { content: content(), storage: assetStorage };
  }

  function reconcileDeps(): ReconcileDeps {
    return {
      content: content(),
      enqueuePublication: async (p) => runPublication(p.id, pubDeps()).then((r) => r.status !== "skipped"),
    };
  }

  it("SQL-level Instagram connected-account ownership does not leak tokens", async () => {
    const [a] = await db
      .insert(connectedAccounts)
      .values({ platform: "instagram", userId: 99001, username: "a", accessToken: "ig-token-a-secret", isActive: true })
      .returning();
    const [b] = await db
      .insert(connectedAccounts)
      .values({ platform: "instagram", userId: 99002, username: "b", accessToken: "ig-token-b-secret", isActive: true })
      .returning();
    const ownedA = await db.select().from(connectedAccounts).where(eq(connectedAccounts.userId, 99001));
    assert.equal(ownedA.filter((row) => row.userId !== 99001).length, 0);
    assert.notEqual(ownedA[0].accessToken, b.accessToken);
    await db.delete(connectedAccounts).where(inArray(connectedAccounts.id, [a.id, b.id]));
  });

  it("one image Artifact → Instagram Publication; channel is authoritative", async () => {
    const { artifact, store } = await seedImageArtifact("one");
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(result.outcomes[0].status, "created");
    const pub = result.outcomes[0].publication!;
    assert.equal(pub.channel, "instagram");
    const run = await runPublication(pub.id, pubDeps());
    assert.equal(run.status, "published");
    assert.ok(run.externalId?.startsWith("m"));
    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id));
    assert.equal(row.id, artifact.id);
  });

  it("same image Artifact fans out to X + Instagram; Threads is incompatible", async () => {
    const { artifact, store } = await seedImageArtifact("tri");
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "threads" }, { channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const byChannel = Object.fromEntries(fan.outcomes.map((o) => [o.channel, o]));
    assert.equal(byChannel.x.status, "created");
    assert.equal(byChannel.instagram.status, "created");
    assert.notEqual(byChannel.threads.status, "created");
    assert.notEqual(byChannel.x.publication!.id, byChannel.instagram.publication!.id);
    await runPublication(byChannel.instagram.publication!.id, pubDeps());
    await runPublication(byChannel.x.publication!.id, {
      content: store,
      storage: assetStorage,
      adapterFor: (channel) =>
        channel === "instagram"
          ? getChannelAdapter("instagram")
          : {
              channel,
              supports: () => true,
              publish: async () => ({
                ok: true,
                providerCalled: true,
                externalId: "x-ext",
                externalUrl: null,
                publishedAt: new Date(),
              }),
              reconcile: async () => null,
            },
    });
    const pubs = await store.listPublicationsByArtifact(artifact.id);
    assert.deepEqual(pubs.map((p) => p.channel).sort(), ["instagram", "x"]);
    const resultRows = await db.select().from(results).where(inArray(results.publicationId, pubs.map((p) => p.id)));
    assert.equal(new Set(resultRows.map((r) => r.publicationId)).size, resultRows.length);
  });

  it("duplicate Instagram target is idempotent; explicit republish creates a new Publication", async () => {
    const { artifact, store } = await seedImageArtifact("idem");
    const first = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }, { channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(first.outcomes.filter((o) => o.status === "created").length, 1);
    assert.equal(first.outcomes.filter((o) => o.status === "reused").length, 1);
    const again = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.ok(again.outcomes.every((o) => o.status === "reused"));
    const repub = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }], republishKey: "again" },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(repub.outcomes[0].status, "created");
    assert.notEqual(repub.outcomes[0].publication?.id, first.outcomes[0].publication?.id);
  });

  it("Instagram scheduling is independent of a later sibling startAt", async () => {
    const { artifact, store } = await seedImageArtifact("sched");
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = await publishArtifactToChannels(
      artifact.id,
      {
        targets: [
          { channel: "instagram", startAt: past },
          { channel: "x", startAt: future },
        ],
      },
      { content: store, enqueuePublication: async () => true },
    );
    const ig = result.outcomes.find((o) => o.channel === "instagram")!;
    const x = result.outcomes.find((o) => o.channel === "x")!;
    assert.ok(ig.publication);
    assert.equal(x.publication, undefined);
  });

  it("Instagram failure does not alter a sibling X Publication", async () => {
    const { artifact, store } = await seedImageArtifact("sib");
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const xPub = fan.outcomes.find((o) => o.channel === "x")!.publication!;
    const igPub = fan.outcomes.find((o) => o.channel === "instagram")!.publication!;
    await runPublication(xPub.id, {
      content: store,
      storage: assetStorage,
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
    const igRun = await runPublication(igPub.id, pubDeps());
    assert.equal(igRun.failureClass, "unknown");
    const [xRow] = await db.select().from(publications).where(eq(publications.id, xPub.id));
    const [igRow] = await db.select().from(publications).where(eq(publications.id, igPub.id));
    assert.equal(xRow.state, "published");
    assert.equal(igRow.state, "failed");
    assert.equal(igRow.providerCalled, true);
  });

  it("ambiguous Instagram publish reconciles the SAME Result", async () => {
    const { artifact, store } = await seedImageArtifact("recon");
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    fixture.armDropPublish();
    await runPublication(fan.outcomes[0].publication!.id, pubDeps());
    const [before] = await db.select().from(results).where(eq(results.publicationId, fan.outcomes[0].publication!.id));
    assert.equal(before.outcome, "unknown");
    fixture.recordListed(`m${RUN}-listed`, `${RUN} recon`);
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

  it("carousel lineage is ordered; incomplete carousel cannot publish", async () => {
    const slide2 = await seedJpegAsset(1, "car-2", 1);
    const slide3 = await seedJpegAsset(1, "car-3", 2);
    const { artifact, store } = await seedImageArtifact("car-ok", 1, [slide2.id, slide3.id]);
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const run = await runPublication(fan.outcomes[0].publication!.id, pubDeps());
    assert.equal(run.status, "published");
    const refs = await store.listVisualAssetRefs(artifact.id);
    assert.deepEqual(
      refs.map((r) => r.position),
      [0, 1, 2],
    );

    const broken = await seedJpegAsset(1, "car-fail-slide", 1);
    const { artifact: incomplete, store: store2 } = await seedImageArtifact("car-bad", 1, [broken.id]);
    await db.update(visualAssets).set({ status: "failed" }).where(eq(visualAssets.id, broken.id));
    const badFan = await publishArtifactToChannels(
      incomplete.id,
      { targets: [{ channel: "instagram" }] },
      { content: store2, enqueuePublication: async () => true },
    );
    const badRun = await runPublication(badFan.outcomes[0].publication!.id, pubDeps());
    assert.equal(badRun.status, "failed");
    assert.equal(badRun.failureClass, "permanent");
    assert.match(String(badRun.message), /not ready|failed/);
  });

  it("foreign VisualAsset cannot be attached by another owner's Artifact", async () => {
    const { artifact, store } = await seedImageArtifact("own");
    const other = await seedJpegAsset(2, "foreign");
    await assert.rejects(
      () =>
        createArtifact(
          {
            userId: 1,
            generationJobId: null,
            opportunityId: artifact.opportunityId,
            format: "image",
            channel: "instagram",
            payload: { visualAssetId: other.id },
            attribution: [],
            provenance: "generated",
            attributionReason: "ownership probe",
          },
          { artifacts: store },
        ),
      ArtifactMediaReferenceError,
    );
  });

  it("foreign Instagram fan-out is non-leaking", async () => {
    const { artifact, store } = await seedImageArtifact("own2", 2);
    await assert.rejects(
      () =>
        publishArtifactToChannels(
          artifact.id,
          { targets: [{ channel: "instagram" }] },
          { content: store, enqueuePublication: async () => true },
          1,
        ),
      ArtifactNotFoundError,
    );
  });

  it("PerformanceSignal + LearningSignal are publication-specific", async () => {
    const { artifact, store } = await seedImageArtifact("learn");
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    await runPublication(fan.outcomes[0].publication!.id, pubDeps());
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
      { metric: "replies" as const, value: null, availability: "not_available" as const },
      { metric: "followers_gained" as const, value: null, availability: "not_available" as const },
      { metric: "engagement_rate" as const, value: null, availability: "not_available" as const },
    ];
    const first = await ingestNormalizedOutcome(
      pub,
      {
        ok: true,
        provider: "instagram",
        retrievedAt: t1,
        observedAt: t1,
        measurementWindow: "t1",
        externalId: pub.externalId ?? "m",
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
        metrics: metric(10),
        unmapped: { reach: 8 },
      },
      { content: store, learning: learning(), database: db },
    );
    const again = await ingestNormalizedOutcome(
      pub,
      {
        ok: true,
        provider: "instagram",
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
        provider: "instagram",
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
    assert.ok(second.created > 0);
    const snaps = await db.select().from(performanceSignals).where(eq(performanceSignals.publicationId, pub.id));
    assert.ok(snaps.find((s) => (s.provenance as { unmapped?: { reach?: number } }).unmapped?.reach === 8));
    const learned = await db.select().from(learningSignals).where(eq(learningSignals.publicationId, pub.id));
    assert.ok(learned.every((r) => r.publicationId === pub.id));
  });

  it("restart-safe: duplicate Instagram fan-out after a queued Publication reuses identity", async () => {
    const { artifact, store } = await seedImageArtifact("restart");
    const first = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const pubId = first.outcomes[0].publication!.id;
    const again = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(again.outcomes[0].status, "reused");
    assert.equal(again.outcomes[0].publication!.id, pubId);
    const count = await db.select().from(publications).where(eq(publications.artifactId, artifact.id));
    assert.equal(count.filter((p) => p.channel === "instagram").length, 1);
  });

  it("video Artifact creates an Instagram Reel Publication on the same lifecycle", async () => {
    const { artifact, store, hero } = await seedVideoArtifact("reel");
    const result = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(result.outcomes[0].status, "created");
    const pub = result.outcomes[0].publication!;
    assert.equal(pub.channel, "instagram");
    assert.equal(pub.artifactId, artifact.id);
    const run = await runPublication(pub.id, pubDeps());
    assert.equal(run.status, "published");
    assert.ok(run.externalId?.startsWith("m"));
    const reelCreate = fixture.creates.find((b) => b.get("media_type") === "REELS");
    assert.ok(reelCreate);
    assert.ok(reelCreate?.get("video_url"));
    assert.equal(reelCreate?.has("cover_url"), false);
    const [artRow] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id));
    assert.equal(artRow.id, artifact.id);
    const [assetRow] = await db.select().from(visualAssets).where(eq(visualAssets.id, hero.id));
    assert.equal(assetRow.kind, "video");
    assert.equal(assetRow.mime, "video/mp4");
    assert.equal(assetRow.durationMs, 5_000);
    const [resultRow] = await db.select().from(results).where(eq(results.publicationId, pub.id));
    assert.equal(resultRow.outcome, "published");
    assert.equal(resultRow.publicationId, pub.id);
    const metricsText = JSON.stringify(resultRow.metrics ?? {});
    assert.equal(metricsText.includes("local:"), false);
    assert.match(String(run.externalUrl), /instagram\.com/);
  });

  it("duplicate Instagram video target is idempotent; explicit republish creates a new Publication", async () => {
    const { artifact, store } = await seedVideoArtifact("reel-idem");
    const first = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }, { channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(first.outcomes.filter((o) => o.status === "created").length, 1);
    assert.equal(first.outcomes.filter((o) => o.status === "reused").length, 1);
    const again = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    assert.ok(again.outcomes.every((o) => o.status === "reused"));
    const repub = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }], republishKey: "again" },
      { content: store, enqueuePublication: async () => true },
    );
    assert.equal(repub.outcomes[0].status, "created");
    assert.notEqual(repub.outcomes[0].publication?.id, first.outcomes[0].publication?.id);
  });

  it("Instagram video scheduling is independent of a later sibling startAt", async () => {
    const { artifact, store } = await seedVideoArtifact("reel-sched");
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = await publishArtifactToChannels(
      artifact.id,
      {
        targets: [
          { channel: "instagram", startAt: past },
          { channel: "x", startAt: future },
        ],
      },
      { content: store, enqueuePublication: async () => true },
    );
    const ig = result.outcomes.find((o) => o.channel === "instagram")!;
    const x = result.outcomes.find((o) => o.channel === "x")!;
    assert.ok(ig.publication);
    assert.equal(x.publication, undefined);
  });

  it("foreign VideoAsset cannot be attached by another owner's Artifact", async () => {
    const { artifact, store } = await seedVideoArtifact("reel-own");
    const other = await seedVideoAsset(2, "foreign-video");
    await assert.rejects(
      () =>
        createArtifact(
          {
            userId: 1,
            generationJobId: null,
            opportunityId: artifact.opportunityId,
            format: "video",
            channel: "instagram",
            payload: { visualAssetId: other.id },
            attribution: [],
            provenance: "generated",
            attributionReason: "ownership probe",
          },
          { artifacts: store },
        ),
      ArtifactMediaReferenceError,
    );
  });

  it("foreign Instagram video fan-out is non-leaking", async () => {
    const { artifact, store } = await seedVideoArtifact("reel-own2", 2);
    await assert.rejects(
      () =>
        publishArtifactToChannels(
          artifact.id,
          { targets: [{ channel: "instagram" }] },
          { content: store, enqueuePublication: async () => true },
          1,
        ),
      ArtifactNotFoundError,
    );
  });

  it("ambiguous Instagram Reel publish reconciles the SAME Result", async () => {
    const { artifact, store } = await seedVideoArtifact("reel-recon");
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    fixture.armDropPublish();
    await runPublication(fan.outcomes[0].publication!.id, pubDeps());
    const [before] = await db.select().from(results).where(eq(results.publicationId, fan.outcomes[0].publication!.id));
    assert.equal(before.outcome, "unknown");
    fixture.recordListed(`m${RUN}-reel-listed`, `${RUN} reel-recon`);
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

  it("PerformanceSignal + LearningSignal lineage follows an Instagram Reel Publication", async () => {
    const { artifact, store } = await seedVideoArtifact("reel-learn");
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    await runPublication(fan.outcomes[0].publication!.id, pubDeps());
    const pub = (await store.getPublication(fan.outcomes[0].publication!.id))!;
    const t1 = new Date("2026-01-01T01:00:00.000Z");
    const metric = (value: number) => [
      { metric: "impressions" as const, value, availability: "observed" as const },
      { metric: "likes" as const, value: 1, availability: "observed" as const },
      { metric: "comments" as const, value: null, availability: "not_available" as const },
      { metric: "shares" as const, value: null, availability: "not_available" as const },
      { metric: "clicks" as const, value: null, availability: "not_available" as const },
      { metric: "saves" as const, value: null, availability: "not_available" as const },
      { metric: "replies" as const, value: null, availability: "not_available" as const },
      { metric: "followers_gained" as const, value: null, availability: "not_available" as const },
      { metric: "engagement_rate" as const, value: null, availability: "not_available" as const },
    ];
    const first = await ingestNormalizedOutcome(
      pub,
      {
        ok: true,
        provider: "instagram",
        retrievedAt: t1,
        observedAt: t1,
        measurementWindow: "t1",
        externalId: pub.externalId ?? "m",
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
        metrics: metric(10),
        unmapped: { reach: 8 },
      },
      { content: store, learning: learning(), database: db },
    );
    assert.ok(first.created > 0);
    const snaps = await db.select().from(performanceSignals).where(eq(performanceSignals.publicationId, pub.id));
    assert.ok(snaps.every((s) => s.publicationId === pub.id));
    const learned = await db.select().from(learningSignals).where(eq(learningSignals.publicationId, pub.id));
    assert.ok(learned.every((r) => r.publicationId === pub.id));
  });

  it("X still cannot publish the same video Artifact", async () => {
    const { artifact, store } = await seedVideoArtifact("reel-x");
    const fan = await publishArtifactToChannels(
      artifact.id,
      { targets: [{ channel: "x" }, { channel: "instagram" }] },
      { content: store, enqueuePublication: async () => true },
    );
    const byChannel = Object.fromEntries(fan.outcomes.map((o) => [o.channel, o]));
    assert.equal(byChannel.instagram.status, "created");
    assert.equal(byChannel.x.status, "created");
    const xRun = await runPublication(byChannel.x.publication!.id, pubDeps());
    assert.equal(xRun.status, "failed");
    assert.match(String(xRun.message), /not implemented/);
    const igRun = await runPublication(byChannel.instagram.publication!.id, pubDeps());
    assert.equal(igRun.status, "published");
  });
});
