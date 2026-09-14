/**
 * DB-backed tests for Phase 7 — visual delivery.
 *
 * Proves the real chain:
 *   VisualGeneration -> VisualAsset -> image Artifact -> approve -> Schedule
 *   -> Occurrence -> runPublication -> X media upload -> X post -> Result
 *
 * Real PostgreSQL, real publication/media-resolution logic, real X adapter
 * (`server/social/x.ts`) — the ONLY thing doubled is the genuine external
 * boundary: a plain Node `http` server standing in for xQuick's media-upload,
 * write-action and tweet-creation endpoints, driven by env vars exactly like
 * `reconcile.dbtest.ts` and the live E2E harness do.
 *
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
  generationJobs,
  opportunities,
  publications,
  results,
  scheduleOccurrences,
  schedules,
  stories,
  visualAssetRefs,
  visualAssets,
  visualGenerations,
} from "@shared/schema";
import { DatabaseContentStorage } from "./storage";
import { DatabaseStoryStorage } from "../story/storage";
import { createOpportunityFromStory } from "./opportunity";
import { approveArtifact, createArtifact, submitArtifactForReview } from "./artifact";
import { createSchedule, dispatchDueOccurrences } from "./scheduling";
import { runPublication, reconcileUnknownPublications, type ReconcileDeps, type PublicationDeps } from "./publication";
import { registerBuiltinChannelAdapters } from "./adapters";
import { JobFailure } from "../jobs/failures";
import { createLocalAssetStorage, registerVisualProvider, resetVisualProviders } from "./visual";
import { createFixtureVisualProvider } from "./visualFixture";
import { createVisualAssetRevision, createVisualGeneration, runVisualGeneration } from "./visualService";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `vp${Date.now().toString(36)}`;

// ── Deterministic xQuick double: media upload + write-action + post ─────────
type WriteActionState = { status: "pending" | "success" | "failed"; tweetId?: string; url?: string; message?: string };

function startXQuickMediaFixture() {
  const writeActions = new Map<string, WriteActionState>();
  let postMode: "immediate" | "pending" = "immediate";
  let mediaFailuresRemaining = 0;
  let tweetSeq = 0;
  let pendingSeq = 0;
  let mediaSeq = 0;

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/x/media") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (mediaFailuresRemaining > 0) {
          mediaFailuresRemaining -= 1;
          return send(503, { message: "503 upstream media store unavailable" });
        }
        mediaSeq += 1;
        return send(200, { mediaId: `media-${RUN}-${mediaSeq}` });
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/x/tweets") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (postMode === "pending") {
          pendingSeq += 1;
          const id = `wa-${RUN}-${pendingSeq}`;
          writeActions.set(id, { status: "pending" });
          postMode = "immediate";
          return send(202, { writeActionId: id });
        }
        tweetSeq += 1;
        const id = `tweet-${RUN}-${tweetSeq}`;
        return send(200, { id, tweetId: id, url: `https://x.com/i/status/${id}`, username: "cf_test" });
      });
      return;
    }

    const writeActionMatch = url.pathname.match(/^\/x\/write-actions\/(.+)$/);
    if (req.method === "GET" && writeActionMatch) {
      const state = writeActions.get(decodeURIComponent(writeActionMatch[1]));
      if (!state) return send(404, { message: "unknown write action" });
      if (state.status === "pending") return send(200, { status: "pending" });
      if (state.status === "success") return send(200, { status: "success", tweetId: state.tweetId, url: state.url });
      return send(200, { status: "failed", message: state.message ?? "write action failed" });
    }

    return send(404, { message: "not found" });
  });

  return {
    armPostPending: () => {
      postMode = "pending";
    },
    armMediaFailures: (count: number) => {
      mediaFailuresRemaining = count;
    },
    resolveWriteAction: (writeActionId: string, state: WriteActionState) => writeActions.set(writeActionId, state),
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describeDb("visual delivery — image publication through X (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const assetStorage = createLocalAssetStorage();
  const fixture = startXQuickMediaFixture();
  let savedEnv: Record<string, string | undefined> = {};

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    registerBuiltinChannelAdapters();
    resetVisualProviders();
    registerVisualProvider(createFixtureVisualProvider());

    const port = await fixture.start();
    savedEnv = {
      XQUIK_API_BASE_URL: process.env.XQUIK_API_BASE_URL,
      XQUIK_API_KEY: process.env.XQUIK_API_KEY,
      XQUIK_ACCOUNT: process.env.XQUIK_ACCOUNT,
      XQUIK_WRITE_POLL_ATTEMPTS: process.env.XQUIK_WRITE_POLL_ATTEMPTS,
      XQUIK_WRITE_POLL_DELAY_MS: process.env.XQUIK_WRITE_POLL_DELAY_MS,
      XQUIK_TIMEOUT_MS: process.env.XQUIK_TIMEOUT_MS,
      XQUIK_MEDIA_ENDPOINT: process.env.XQUIK_MEDIA_ENDPOINT,
    };
    process.env.XQUIK_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.XQUIK_API_KEY = "fixture-key";
    process.env.XQUIK_ACCOUNT = "cf_test";
    process.env.XQUIK_WRITE_POLL_ATTEMPTS = "1";
    process.env.XQUIK_WRITE_POLL_DELAY_MS = "1";
    process.env.XQUIK_TIMEOUT_MS = "3000";
    process.env.XQUIK_MEDIA_ENDPOINT = "/x/media";
  });

  after(async () => {
    if (!CONNECTION) return;
    resetVisualProviders();
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
    const genRows = oppIds.length
      ? await db.select({ id: visualGenerations.id }).from(visualGenerations).where(inArray(visualGenerations.opportunityId, oppIds))
      : [];
    const genIds = genRows.map((r) => r.id);
    const artRows = oppIds.length
      ? await db.select({ id: artifacts.id }).from(artifacts).where(inArray(artifacts.opportunityId, oppIds))
      : [];
    const artIds = artRows.map((r) => r.id);
    if (artIds.length) await db.delete(visualAssetRefs).where(inArray(visualAssetRefs.artifactId, artIds));
    if (artIds.length) {
      const schedRows = await db.select({ id: schedules.id }).from(schedules).where(inArray(schedules.artifactId, artIds));
      const schedIds = schedRows.map((r) => r.id);
      if (schedIds.length) {
        const pubRows = await db.select({ id: publications.id }).from(publications).where(inArray(publications.scheduleId, schedIds));
        const pubIds = pubRows.map((r) => r.id);
        if (pubIds.length) await db.delete(results).where(inArray(results.publicationId, pubIds));
        if (pubIds.length) await db.delete(publications).where(inArray(publications.id, pubIds));
        await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds));
        await db.delete(schedules).where(inArray(schedules.id, schedIds));
      }
    }
    if (artIds.length) await db.delete(artifacts).where(inArray(artifacts.id, artIds));
    if (genIds.length) {
      const assetRows = await db.select({ id: visualAssets.id }).from(visualAssets).where(inArray(visualAssets.visualGenerationId, genIds));
      if (assetRows.length) await db.delete(visualAssets).where(inArray(visualAssets.id, assetRows.map((r) => r.id)));
      await db.delete(visualGenerations).where(inArray(visualGenerations.id, genIds));
    }
    if (oppIds.length) {
      await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
      await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    }
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    await pool.end().catch(() => {});
  });

  function pubDeps(): PublicationDeps {
    return { content: content(), storage: assetStorage };
  }
  function reconcileDeps(): ReconcileDeps {
    return { content: content(), enqueuePublication: async (p) => runPublication(p.id, pubDeps()).then((r) => r.status !== "skipped") };
  }

  async function seedOpportunity(suffix: string) {
    const [story] = await db
      .insert(stories)
      .values({
        userId: 1,
        researchJobId: null,
        provenance: "human",
        title: `${RUN}-${suffix} story`,
        insightBody: "Visual delivery reaches a real channel.",
        angles: [],
        evidenceRefs: [],
        status: "ready",
      })
      .returning();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "visual delivery", objective: "educate", format: "image", channel: "x" },
      { opportunities: content(), stories: storyStore() },
    );
    return { story, opportunity };
  }

  /** A ready VisualAsset (real PNG bytes, real content-addressed storage). */
  async function seedAsset(opportunityId: number, suffix: string) {
    const deps = { content: content(), storage: assetStorage };
    const { generation } = await createVisualGeneration(
      1,
      {
        opportunityId,
        kind: "image",
        intent: { subject: `${RUN} ${suffix}`, aspectRatio: "1:1" as const, style: "flat illustration", role: "hero" },
      },
      deps,
    );
    const run = await runVisualGeneration(generation.id, deps);
    return run.visualAssetId!;
  }

  /** Approved image Artifact -> Schedule -> materialized Occurrence -> claimed Publication (not yet run). */
  async function seedPendingImagePublication(suffix: string, assetId: number) {
    const { opportunity } = await seedOpportunity(suffix);
    const asset = assetId; // pin the CALLER's exact revision, never "latest"
    const store = content();
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "image",
        channel: "x",
        payload: { visualAssetId: asset, altText: `${RUN} ${suffix}`, aspectRatio: "1:1" as const },
        provenance: "generated",
        attribution: [],
        attributionReason: "fixture",
      },
      { artifacts: store },
    );
    await store.insertVisualAssetRef({ userId: 1, artifactId: artifact.id, visualAssetId: asset, role: "hero", position: 0 });
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });

    const schedule = await createSchedule(approved.id, {}, { content: store });
    await dispatchDueOccurrences(new Date(), { content: store, enqueuePublication: async () => true });
    const [publicationRow] = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    return { artifact: approved, schedule, publication: publicationRow, opportunity };
  }

  it("golden path: VisualAsset -> media upload -> media id -> X post -> Result, exact revision pinned even after a newer revision exists", async () => {
    const { opportunity } = await seedOpportunity("golden");
    const assetId = await seedAsset(opportunity.id, "golden");
    const { publication, artifact } = await seedPendingImagePublication("golden", assetId);

    // A NEWER revision now exists before publish runs. It must not be picked up.
    const newer = await createVisualAssetRevision(
      assetId,
      {
        bytes: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QDwADhgGAWjR9WgAAAABJRU5ErkJggg==",
          "base64",
        ),
        mime: "image/png",
        width: 2,
        height: 2,
      },
      { content: content(), storage: assetStorage },
    );
    assert.notEqual(newer.id, assetId);

    const run = await runPublication(publication.id, pubDeps());
    assert.equal(run.status, "published");

    const [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.state, "published");
    assert.ok(pubRow.externalId?.startsWith(`tweet-${RUN}-`), "externalId is the real POST id, not a media id");

    const [resultRow] = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRow.outcome, "published");
    assert.equal((resultRow.metrics as Record<string, unknown>).mediaCount, 1);

    const refs = await content().listVisualAssetRefs(artifact.id);
    assert.deepEqual(refs.map((r) => r.visualAssetId), [assetId], "the artifact still points at the ORIGINAL revision, not the newer one");
  });

  it("retry: a transient media-upload failure retries the same Publication/Artifact/Asset — no new lineage rows", async () => {
    const { opportunity } = await seedOpportunity("retry");
    const assetId = await seedAsset(opportunity.id, "retry");
    const { publication, schedule, artifact } = await seedPendingImagePublication("retry", assetId);

    fixture.armMediaFailures(1); // 503 once, succeeds on the actual retry
    await assert.rejects(
      () => runPublication(publication.id, pubDeps()),
      (error: unknown) => error instanceof JobFailure && error.failureClass === "transient",
    );

    const [afterFail] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(afterFail.state, "queued", "retry releases the lease back to queued, same identity");
    assert.equal(afterFail.providerCalled, false, "the media upload never got far enough to touch a post");

    const second = await runPublication(publication.id, pubDeps());
    assert.equal(second.status, "published");

    const [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.id, publication.id, "same Publication identity");
    assert.equal(pubRow.artifactId, artifact.id, "same Artifact revision");
    assert.equal(pubRow.scheduleId, schedule.id);

    const occRows = await db.select().from(scheduleOccurrences).where(eq(scheduleOccurrences.scheduleId, schedule.id));
    assert.equal(occRows.length, 1, "no new Occurrence");
    const resultRows = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRows.length, 1, "exactly one final Result");
  });

  it("ambiguity: media upload succeeds, post creation is ambiguous, reconciliation resolves to published with the post's externalId", async () => {
    const { opportunity } = await seedOpportunity("ambiguous");
    const assetId = await seedAsset(opportunity.id, "ambiguous");
    const { publication } = await seedPendingImagePublication("ambiguous", assetId);

    fixture.armPostPending();
    const run = await runPublication(publication.id, pubDeps());
    assert.equal(run.status, "failed");
    assert.equal(run.failureClass, "unknown");

    const [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.state, "failed");
    assert.equal(pubRow.providerCalled, true, "the media WAS uploaded and a post attempt WAS made");

    const [resultRow] = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRow.outcome, "unknown");
    const writeActionId = (resultRow.metrics as Record<string, string>).writeActionId;
    assert.ok(writeActionId, "the durable handle is the post write-action id, never the media id");

    fixture.resolveWriteAction(writeActionId, { status: "success", tweetId: `tweet-${RUN}-resolved`, url: "https://x.com/i/status/resolved" });
    const out = await reconcileUnknownPublications(new Date(), reconcileDeps());
    assert.equal(out.resolved, 1, "no blind second post — resolved via reconciliation");

    const [finalPub] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(finalPub.state, "published");
    assert.equal(finalPub.externalId, `tweet-${RUN}-resolved`, "final externalId identifies the published POST, not the uploaded media");

    const finalResults = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(finalResults.length, 1, "the SAME Result row resolved in place");
    assert.equal(finalResults[0].id, resultRow.id);
  });

  it("recurring image Schedule: every Occurrence publishes the same pinned Artifact/VisualAsset revision", async () => {
    const { opportunity } = await seedOpportunity("recurring");
    const assetId = await seedAsset(opportunity.id, "recurring");
    const store = content();
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "image",
        channel: "x",
        payload: { visualAssetId: assetId, altText: `${RUN} recurring` },
        provenance: "generated",
        attribution: [],
        attributionReason: "fixture",
      },
      { artifacts: store },
    );
    await store.insertVisualAssetRef({ userId: 1, artifactId: artifact.id, visualAssetId: assetId, role: "hero", position: 0 });
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });

    const startAt = new Date(Date.now() - 1000);
    const schedule = await createSchedule(approved.id, { recurrence: "every:1h", count: 2, startAt: startAt.toISOString() }, { content: store });
    await dispatchDueOccurrences(new Date(), { content: store, enqueuePublication: async () => true });
    const [pub1] = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    const run1 = await runPublication(pub1.id, pubDeps());
    assert.equal(run1.status, "published");

    // Advance to the next due slot and materialize/publish it too.
    await dispatchDueOccurrences(new Date(Date.now() + 3_600_000 + 1000), { content: store, enqueuePublication: async () => true });
    const pubRows = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    assert.equal(pubRows.length, 2, "a second Occurrence/Publication materialized");
    const pub2 = pubRows.find((p) => p.id !== pub1.id)!;
    const run2 = await runPublication(pub2.id, pubDeps());
    assert.equal(run2.status, "published");

    const finalPubs = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    for (const p of finalPubs) {
      assert.equal(p.artifactId, approved.id, "every recurring slot pins the SAME Artifact revision");
    }
    const refs = await store.listVisualAssetRefs(approved.id);
    assert.deepEqual(refs.map((r) => r.visualAssetId), [assetId], "no new visual asset was generated per recurrence");
  });

  it("idempotency: concurrent duplicate delivery of the same Publication yields exactly one published Result", async () => {
    const { opportunity } = await seedOpportunity("dup");
    const assetId = await seedAsset(opportunity.id, "dup");
    const { publication } = await seedPendingImagePublication("dup", assetId);

    // Distinct owners simulate genuinely separate workers double-delivering the
    // same queue message — the DB lease's same-owner re-entry (crash-recovery)
    // path must not be confused with this.
    const [a, b, c] = await Promise.all([
      runPublication(publication.id, { ...pubDeps(), owner: "worker-a" }),
      runPublication(publication.id, { ...pubDeps(), owner: "worker-b" }),
      runPublication(publication.id, { ...pubDeps(), owner: "worker-c" }),
    ]);
    const publishedCount = [a, b, c].filter((r) => r.status === "published").length;
    const skippedCount = [a, b, c].filter((r) => r.status === "skipped").length;
    assert.equal(publishedCount, 1, "the DB lease is the sole arbiter — only one delivery actually publishes");
    assert.equal(publishedCount + skippedCount, 3, "the others are cleanly skipped, never a second post");

    const resultRows = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRows.length, 1, "exactly one logical Result survives duplicate delivery");
    assert.equal(resultRows[0].outcome, "published");
  });
});
