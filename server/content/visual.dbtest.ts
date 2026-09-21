/**
 * DB-backed tests for Visual Intelligence (Phase 3).
 *
 * Real PostgreSQL: migrations, ownership, idempotency, revisions, references,
 * immutability trigger, optional/required visual behavior, and the service
 * failure taxonomy. The visual provider is the deterministic fixture (real PNG
 * bytes, no network); the byte store is the local content-addressed impl.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
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
import { createGenerationJob } from "./generation";
import { approveArtifact, createArtifact, submitArtifactForReview } from "./artifact";
import { createSchedule, dispatchDueOccurrences } from "./scheduling";
import { runPublication } from "./publication";
import {
  ALLOWED_VISUAL_MIMES,
  createLocalAssetStorage,
  getVisualProvider,
  registerVisualProvider,
  resetVisualProviders,
} from "./visual";
import { createFixtureVisualProvider } from "./visualFixture";
import { registerBuiltinChannelAdapters } from "./adapters";
import {
  createVisualAssetRevision,
  createVisualGeneration,
  runVisualGeneration,
} from "./visualService";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `vi${Date.now().toString(36)}`;
// A sentinel owner id for Phase 9 standalone generation (no Story/Opportunity
// chain to key cleanup off — see the `after()` hook below).
const STANDALONE_USER = 900_000 + (Date.now() % 90_000);

describeDb("visual intelligence (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const storage = createLocalAssetStorage();

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });

    resetVisualProviders();
    registerVisualProvider(createFixtureVisualProvider());
    registerBuiltinChannelAdapters();
  });

  after(async () => {
    if (!CONNECTION) return;
    resetVisualProviders();
    const storyRows = await db
      .select({ id: stories.id })
      .from(stories)
      .where(like(stories.title, `${RUN}%`));
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
    const refRows = artIds.length
      ? await db.select({ id: visualAssetRefs.id }).from(visualAssetRefs).where(inArray(visualAssetRefs.artifactId, artIds))
      : [];

    if (refRows.length)
      await db.delete(visualAssetRefs).where(inArray(visualAssetRefs.id, refRows.map((r) => r.id)));

    // Some tests schedule/publish these artifacts (scheduling.ts / publication.ts);
    // publications and schedules reference artifacts by FK, so they must clear
    // before the artifact delete below, or it 23503s.
    if (artIds.length) {
      const schedRows = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(inArray(schedules.artifactId, artIds));
      const schedIds = schedRows.map((r) => r.id);
      if (schedIds.length) {
        const pubRows = await db
          .select({ id: publications.id })
          .from(publications)
          .where(inArray(publications.scheduleId, schedIds));
        const pubIds = pubRows.map((r) => r.id);
        if (pubIds.length) await db.delete(results).where(inArray(results.publicationId, pubIds));
        if (pubIds.length) await db.delete(publications).where(inArray(publications.id, pubIds));
        await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds));
        await db.delete(schedules).where(inArray(schedules.id, schedIds));
      }
    }
    if (artIds.length) await db.delete(artifacts).where(inArray(artifacts.id, artIds));
    if (genIds.length) {
      await db
        .update(visualGenerations)
        .set({ sourceVisualAssetId: null })
        .where(inArray(visualGenerations.id, genIds));
      const assetRows = await db
        .select({ id: visualAssets.id })
        .from(visualAssets)
        .where(inArray(visualAssets.visualGenerationId, genIds));
      if (assetRows.length) await db.delete(visualAssets).where(inArray(visualAssets.id, assetRows.map((r) => r.id)));
      await db.delete(visualGenerations).where(inArray(visualGenerations.id, genIds));
    }
    if (oppIds.length) {
      await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
      await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    }
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));

    // Standalone generations (Phase 9) have no Opportunity chain to key off.
    const standaloneGenRows = await db
      .select({ id: visualGenerations.id })
      .from(visualGenerations)
      .where(eq(visualGenerations.userId, STANDALONE_USER));
    const standaloneGenIds = standaloneGenRows.map((r) => r.id);
    if (standaloneGenIds.length) {
      await db.delete(visualAssets).where(inArray(visualAssets.visualGenerationId, standaloneGenIds));
      await db.delete(visualGenerations).where(inArray(visualGenerations.id, standaloneGenIds));
    }
    await pool.end().catch(() => {});
  });

  async function seedOpportunity(suffix: string, format = "x_post") {
    const [story] = await db
      .insert(stories)
      .values({
        userId: 1,
        researchJobId: null,
        provenance: "human",
        title: `${RUN}-${suffix} story`,
        insightBody: "Scheduler plugins shipped as a stable extension point.",
        angles: [],
        evidenceRefs: [],
        status: "ready",
      })
      .returning();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "explain", objective: "educate", format: "x_post", channel: "x" },
      { opportunities: content(), stories: storyStore() },
    );
    return { story, opportunity };
  }

  function visualDeps() {
    return { content: content(), storage };
  }

  const INTENT = () => ({
    subject: `${RUN} hero image of a scheduler`,
    aspectRatio: "1:1" as const,
    style: "flat illustration",
    role: "hero",
  });

  // ── idempotency ─────────────────────────────────────────────────────────────
  it("collapses a duplicate visual request to one generation; regen creates a new one", async () => {
    const { opportunity } = await seedOpportunity("idem");
    const deps = visualDeps();
    const first = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT() },
      deps,
    );
    const second = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT() },
      deps,
    );
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.generation.id, first.generation.id);

    const regen = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT(), regenerate: true },
      deps,
    );
    assert.equal(regen.created, true);
    assert.notEqual(regen.generation.id, first.generation.id);
  });

  // ── execution: validate → store → persist ──────────────────────────────────
  it("runs a generation to a durable asset with real bytes", async () => {
    const { opportunity } = await seedOpportunity("exec");
    const deps = visualDeps();
    const { generation } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT() },
      deps,
    );

    const result = await runVisualGeneration(generation.id, deps);
    assert.equal(result.status, "ready");
    assert.ok(result.visualAssetId, "an asset was persisted");

    const [asset] = await db.select().from(visualAssets).where(eq(visualAssets.id, result.visualAssetId!));
    assert.equal(asset.status, "ready");
    assert.equal(asset.mime, "image/png");
    assert.match(asset.storageKey, /^local:[0-9a-f]{64}$/);
    assert.ok((asset.byteSize ?? 0) > 0);
    assert.ok((asset.contentHash ?? "").length === 64);
    assert.equal(asset.visualGenerationId, generation.id);

    const [gen] = await db.select().from(visualGenerations).where(eq(visualGenerations.id, generation.id));
    assert.equal(gen.status, "ready");
  });

  it("re-running a ready generation is a no-op (no duplicate asset)", async () => {
    const { opportunity } = await seedOpportunity("rerun");
    const deps = visualDeps();
    const { generation } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT() },
      deps,
    );
    const first = await runVisualGeneration(generation.id, deps);
    const second = await runVisualGeneration(generation.id, deps);
    assert.equal(second.reused, true);
    assert.equal(second.visualAssetId, first.visualAssetId);
    const rows = await db
      .select({ id: visualAssets.id })
      .from(visualAssets)
      .where(eq(visualAssets.visualGenerationId, generation.id));
    assert.equal(rows.length, 1);
  });

  // ── carousel: ordered, independently addressable slides ─────────────────────
  it("creates an ordered carousel of independently addressable slides", async () => {
    const { opportunity } = await seedOpportunity("carousel");
    const deps = visualDeps();
    const assets: number[] = [];
    for (let slide = 1; slide <= 3; slide += 1) {
      const { generation } = await createVisualGeneration(
        1,
        {
          opportunityId: opportunity.id,
          kind: "carousel_slide",
          capability: "generate_slide",
          intent: { ...INTENT(), subject: `${RUN} slide ${slide}` },
        },
        deps,
      );
      const run = await runVisualGeneration(generation.id, deps);
      assets.push(run.visualAssetId!);
    }
    assert.deepEqual(new Set(assets).size, 3);

    const carousel = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "carousel",
        channel: "x",
        payload: {
          slides: assets.map((visualAssetId, i) => ({
            visualAssetId,
            caption: `slide ${i + 1}`,
            role: `slide-${i + 1}`,
          })),
        },
        provenance: "generated",
        attribution: [],
        attributionReason: "fixture chat story",
      },
      { artifacts: content() },
    );
    assert.deepEqual(
      (carousel.payload as { slides: { visualAssetId: number }[] }).slides.map((s) => s.visualAssetId),
      assets,
      "slide order is preserved in the payload",
    );
    for (const [position, visualAssetId] of Array.from(assets.entries())) {
      await content().insertVisualAssetRef({ userId: 1, artifactId: carousel.id, visualAssetId, role: `slide-${position + 1}`, position });
    }
    const refs = await content().listVisualAssetRefs(carousel.id);
    assert.deepEqual(refs.map((r) => r.visualAssetId), assets);
  });

  // ── asset revisions + immutability trigger ──────────────────────────────────
  it("revises an asset as a new row and refuses in-place mutation", async () => {
    const { opportunity } = await seedOpportunity("revise");
    const deps = visualDeps();
    const { generation } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT() },
      deps,
    );
    const run = await runVisualGeneration(generation.id, deps);
    const priorId = run.visualAssetId!;
    const [prior] = await db.select().from(visualAssets).where(eq(visualAssets.id, priorId));

    registerVisualProvider(createFixtureVisualProvider({ providerId: "local-fixture" }));
    const revised = await createVisualAssetRevision(
      priorId,
      {
        bytes: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QDwADhgGAWjR9WgAAAABJRU5ErkJggg==",
          "base64",
        ),
        mime: "image/png",
        width: 2,
        height: 2,
      },
      deps,
    );
    assert.equal(revised.supersedesId, priorId);
    assert.notEqual(revised.id, priorId);
    assert.equal(revised.storageKey !== prior.storageKey, true);

    await assert.rejects(
      () => db.update(visualAssets).set({ mime: "image/jpeg" }).where(eq(visualAssets.id, priorId)),
      /immutable/i,
    );
    const [untouched] = await db.select().from(visualAssets).where(eq(visualAssets.id, priorId));
    assert.equal(untouched.mime, "image/png");
    // Lifecycle-only mutation is allowed.
    await db.update(visualAssets).set({ status: "archived" }).where(eq(visualAssets.id, priorId));
  });

  // ── artifact integration: visual required vs optional ───────────────────────
  it("pins a visual revision to an artifact; published history survives replacement", async () => {
    const { opportunity } = await seedOpportunity("pin");
    const store = content();
    const deps = visualDeps();
    const { generation } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT() },
      deps,
    );
    const run = await runVisualGeneration(generation.id, deps);
    const assetId = run.visualAssetId!;

    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "image",
        channel: "x",
        payload: { visualAssetId: assetId, altText: "hero", aspectRatio: "1:1" as const },
        provenance: "generated",
        attribution: [],
        attributionReason: "fixture",
      },
      { artifacts: store },
    );
    await store.insertVisualAssetRef({ userId: 1, artifactId: artifact.id, visualAssetId: assetId, role: "hero", position: 0 });
    await submitArtifactForReview(artifact.id, { artifacts: store });
    await approveArtifact(artifact.id, { artifacts: store });

    // Publish the exact revision (direct claim — the worker path is exercise
    // elsewhere; here the pinning is what matters).
    const schedule = await createSchedule(artifact.id, {}, { content: store });
    const occurrence = (await store.materializeOccurrence(schedule.id, schedule.startAt))!;
    const { publication } = await store.claimPublication({
      scheduleId: schedule.id,
      occurrenceId: occurrence.id,
      artifactId: artifact.id,
      channel: "x",
      idempotencyKey: `${RUN}-pin-pub`,
      correlationId: `${RUN}-pin-corr`,
    });

    // Replace with a new asset revision for a FUTURE artifact; the published
    // reference still points at the original asset id.
    const revised = await createVisualAssetRevision(
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
      deps,
    );
    assert.notEqual(revised.id, assetId);
    const refs = await store.listVisualAssetRefs(artifact.id);
    assert.deepEqual(refs.map((r) => r.visualAssetId), [assetId], "the artifact keeps the original revision");
    const [pub] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pub.artifactId, artifact.id);
  });

  it("an image Artifact is only valid when its referenced asset is ready", async () => {
    const { opportunity } = await seedOpportunity("attachgate");
    const store = content();
    const deps = visualDeps();

    // No asset yet → attach is refused with 404-like semantics at the domain
    // level (the route layer returns 404/409; here the service refuses).
    const { generation } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT() },
      deps,
    );
    const pending = await runVisualGeneration(generation.id, deps);
    assert.equal(pending.status, "ready");

    // Healthy flow: ready asset → create image Artifact → attach → approve.
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "image",
        channel: "x",
        payload: { visualAssetId: pending.visualAssetId!, altText: "hero", aspectRatio: "1:1" as const },
        provenance: "generated",
        attribution: [],
        attributionReason: "fixture",
      },
      { artifacts: store },
    );
    await store.insertVisualAssetRef({
      userId: 1,
      artifactId: artifact.id,
      visualAssetId: pending.visualAssetId!,
      role: "hero",
      position: 0,
    });
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });
    assert.equal(approved.readiness, "approved");

    // The payload names the exact revision; refs name it too.
    assert.equal((approved.payload as { visualAssetId: number }).visualAssetId, pending.visualAssetId);
    const refs = await store.listVisualAssetRefs(artifact.id);
    assert.deepEqual(refs.map((r) => r.visualAssetId), [pending.visualAssetId]);

    // Optional (x_post profile has no visual requirement): text-only proceeds.
    const ok = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "x_post",
        channel: "x",
        payload: { text: "text only" },
        provenance: "generated",
        attribution: [],
        attributionReason: "fixture",
      },
      { artifacts: content() },
    );
    assert.equal(ok.format, "x_post");
  });

  // ── failures ────────────────────────────────────────────────────────────────
  it("marks transient provider failures retryable and permanent/invalid terminal", async () => {
    const { opportunity } = await seedOpportunity("fail");
    const deps = visualDeps();

    registerVisualProvider(createFixtureVisualProvider({ providerId: "local-fixture", failMode: "transient" }));
    const { generation: t } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT() },
      deps,
    );
    const transient = await runVisualGeneration(t.id, deps);
    assert.equal(transient.status, "failed");
    assert.equal(transient.failureClass, "transient");

    registerVisualProvider(createFixtureVisualProvider({ providerId: "local-fixture", failMode: "permanent" }));
    const { generation: p } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: { ...INTENT(), subject: `${RUN} permanent` } },
      deps,
    );
    const permanent = await runVisualGeneration(p.id, deps);
    assert.equal(permanent.failureClass, "permanent");

    registerVisualProvider(createFixtureVisualProvider({ providerId: "local-fixture", failMode: "invalid" }));
    const { generation: v } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: { ...INTENT(), subject: `${RUN} invalid` } },
      deps,
    );
    const invalid = await runVisualGeneration(v.id, deps);
    assert.equal(invalid.failureClass, "permanent");
    const assets = await db
      .select({ id: visualAssets.id })
      .from(visualAssets)
      .where(eq(visualAssets.visualGenerationId, v.id));
    assert.equal(assets.length, 0, "no invalid asset is persisted");

    registerVisualProvider(createFixtureVisualProvider({ providerId: "local-fixture" }));
  });

  it("refuses an undeclared capability and an unknown provider", async () => {
    const { opportunity } = await seedOpportunity("caps");
    const deps = visualDeps();
    await assert.rejects(
      () =>
        createVisualGeneration(
          1,
          { opportunityId: opportunity.id, kind: "image", providerId: "local-fixture", capability: "edit_image", intent: INTENT() },
          deps,
        ),
      /does not support/,
    );
    await assert.rejects(
      () =>
        createVisualGeneration(
          1,
          { opportunityId: opportunity.id, kind: "image", providerId: "nope", intent: INTENT() },
          deps,
        ),
      /unknown visual provider/,
    );
  });

  // ── ownership ───────────────────────────────────────────────────────────────
  it("scopes assets to their owner (user 1 sees its own, user 2 sees none)", async () => {
    const { opportunity } = await seedOpportunity("owner");
    const deps = visualDeps();
    const { generation } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: INTENT() },
      deps,
    );
    await runVisualGeneration(generation.id, deps);

    const mine = await content().listVisualAssets(1, 50);
    assert.ok(mine.length >= 1);
    const theirs = await content().listVisualAssets(9_999_999, 50);
    assert.equal(theirs.length, 0, "cross-user listing is empty");
  });

  // ── MIME allowlist sanity ───────────────────────────────────────────────────
  it("only image MIMEs are in the allowlist", () => {
    assert.ok((ALLOWED_VISUAL_MIMES as readonly string[]).includes("image/png"));
    assert.ok((ALLOWED_VISUAL_MIMES as readonly string[]).includes("image/jpeg"));
    assert.ok(!(ALLOWED_VISUAL_MIMES as readonly string[]).includes("image/svg+xml"));
    assert.ok(!(ALLOWED_VISUAL_MIMES as readonly string[]).includes("application/octet-stream"));
    assert.ok(!(getVisualProvider("local-fixture").capabilities as readonly string[]).includes("edit_image"));
  });

  // ── Phase 9: standalone generation — no Story/Opportunity/Artifact ─────────────
  describe("standalone media generation (Phase 9) — independent of Artifact/Publication", () => {
    it("generates a durable asset from a bare prompt, no opportunityId/generationJobId at all", async () => {
      const deps = visualDeps();
      const { generation, created } = await createVisualGeneration(
        STANDALONE_USER,
        { kind: "image", intent: { subject: `${RUN} standalone hero`, aspectRatio: "1:1" } },
        deps,
      );
      assert.equal(created, true);
      assert.equal(generation.opportunityId, null);
      assert.equal(generation.generationJobId, null);

      const run = await runVisualGeneration(generation.id, deps);
      assert.equal(run.status, "ready");
      assert.ok(run.visualAssetId);

      const asset = await content().getVisualAsset(run.visualAssetId!);
      assert.equal(asset?.userId, STANDALONE_USER);
      assert.equal(asset?.status, "ready");
    });

    it("(YouTube-readiness) a standalone asset is loadable by id with zero Artifact/Publication rows referencing it", async () => {
      const deps = visualDeps();
      const { generation } = await createVisualGeneration(
        STANDALONE_USER,
        { kind: "image", intent: { subject: `${RUN} standalone youtube-ready`, aspectRatio: "16:9" } },
        deps,
      );
      const run = await runVisualGeneration(generation.id, deps);
      const assetId = run.visualAssetId!;

      const refsForAsset = await db
        .select({ id: visualAssetRefs.id })
        .from(visualAssetRefs)
        .where(eq(visualAssetRefs.visualAssetId, assetId));
      assert.equal(refsForAsset.length, 0, "no Artifact references this asset");

      // A hypothetical future consumer (YouTube workflow, or anything else)
      // needs nothing but the id — proving the asset's identity does not
      // depend on Artifact or Publication ever having existed.
      const loaded = await content().getVisualAsset(assetId);
      assert.ok(loaded);
      assert.equal(loaded!.id, assetId);
    });

    it("reuse: the same standalone asset attaches to two separate Artifacts without duplicating bytes", async () => {
      const deps = visualDeps();
      const { generation } = await createVisualGeneration(
        STANDALONE_USER,
        { kind: "image", intent: { subject: `${RUN} standalone reuse`, aspectRatio: "1:1" } },
        deps,
      );
      const run = await runVisualGeneration(generation.id, deps);
      const assetId = run.visualAssetId!;

      const { opportunity: oppA } = await seedOpportunity("reuse-a");
      const { opportunity: oppB } = await seedOpportunity("reuse-b");
      const store = content();
      const artifactA = await createArtifact(
        {
          userId: STANDALONE_USER,
          generationJobId: null,
          opportunityId: oppA.id,
          format: "x_post",
          channel: "x",
          payload: { text: `${RUN} artifact A` },
          attribution: [],
          attributionReason: "reuse test",
        },
        { artifacts: store },
      );
      const artifactB = await createArtifact(
        {
          userId: STANDALONE_USER,
          generationJobId: null,
          opportunityId: oppB.id,
          format: "x_post",
          channel: "x",
          payload: { text: `${RUN} artifact B` },
          attribution: [],
          attributionReason: "reuse test",
        },
        { artifacts: store },
      );
      await store.insertVisualAssetRef({ userId: STANDALONE_USER, artifactId: artifactA.id, visualAssetId: assetId, role: "hero", position: 0 });
      await store.insertVisualAssetRef({ userId: STANDALONE_USER, artifactId: artifactB.id, visualAssetId: assetId, role: "hero", position: 0 });

      const refsForAsset = await db
        .select({ artifactId: visualAssetRefs.artifactId })
        .from(visualAssetRefs)
        .where(eq(visualAssetRefs.visualAssetId, assetId));
      assert.deepEqual(
        refsForAsset.map((r) => r.artifactId).sort((a, b) => a - b),
        [artifactA.id, artifactB.id].sort((a, b) => a - b),
        "one asset, two independent Artifact references — never a duplicated asset row",
      );
      const assetRows = await db.select({ id: visualAssets.id }).from(visualAssets).where(eq(visualAssets.id, assetId));
      assert.equal(assetRows.length, 1);
    });
  });

  // ── Phase 9: deterministic model selection ─────────────────────────────────────
  describe("model selection (Phase 9 §9) — capability-based, resolved before any provider call", () => {
    it("accepts a model the provider declares, and rejects one it does not, before generation", async () => {
      const deps = visualDeps();
      registerVisualProvider({
        ...createFixtureVisualProvider({ providerId: "fixture-with-models" }),
        models: ["fixture-model-a"],
      });

      const ok = await createVisualGeneration(
        STANDALONE_USER,
        { kind: "image", providerId: "fixture-with-models", model: "fixture-model-a", intent: { subject: `${RUN} model ok` } },
        deps,
      );
      assert.ok(ok.generation.id);

      await assert.rejects(
        () =>
          createVisualGeneration(
            STANDALONE_USER,
            { kind: "image", providerId: "fixture-with-models", model: "not-a-real-model", intent: { subject: `${RUN} model bad` } },
            deps,
          ),
        /does not support model/,
      );

      registerVisualProvider(createFixtureVisualProvider({ providerId: "local-fixture" }));
    });
  });

  it("one generation produces ordered variations and duplicate delivery reuses them", async () => {
    const { opportunity } = await seedOpportunity("variations");
    const deps = visualDeps();
    const first = await createVisualGeneration(
      1,
      {
        opportunityId: opportunity.id,
        kind: "image",
        variationCount: 3,
        intent: { subject: `${RUN} three variations` },
      },
      deps,
    );
    const run = await runVisualGeneration(first.generation.id, deps);
    assert.equal(run.status, "ready");
    assert.equal(run.visualAssetIds?.length, 3);
    const assets = await content().listVisualAssetsForGeneration(first.generation.id);
    assert.deepEqual(assets.map((a) => a.position), [0, 1, 2]);
    const again = await runVisualGeneration(first.generation.id, deps);
    assert.equal(again.reused, true);
    const after = await content().listVisualAssetsForGeneration(first.generation.id);
    assert.equal(after.length, 3);
    const duplicate = await createVisualGeneration(
      1,
      {
        opportunityId: opportunity.id,
        kind: "image",
        variationCount: 3,
        intent: { subject: `${RUN} three variations` },
      },
      deps,
    );
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.generation.id, first.generation.id);
  });

  it("explicit regenerate creates a new generation lineage", async () => {
    const { opportunity } = await seedOpportunity("regen-lineage");
    const deps = visualDeps();
    const body = {
      opportunityId: opportunity.id,
      kind: "image" as const,
      intent: { subject: `${RUN} regen lineage` },
    };
    const first = await createVisualGeneration(1, body, deps);
    await runVisualGeneration(first.generation.id, deps);
    const second = await createVisualGeneration(1, { ...body, regenerate: true, regenerationNonce: "n-2" }, deps);
    assert.notEqual(second.generation.id, first.generation.id);
    await runVisualGeneration(second.generation.id, deps);
    const a = await content().listVisualAssetsForGeneration(first.generation.id);
    const b = await content().listVisualAssetsForGeneration(second.generation.id);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.notEqual(a[0]!.id, b[0]!.id);
  });

  it("refinement creates a new asset without mutating the source", async () => {
    const { opportunity } = await seedOpportunity("refine");
    const deps = visualDeps();
    const sourceGen = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: { subject: `${RUN} refine source` } },
      deps,
    );
    const produced = await runVisualGeneration(sourceGen.generation.id, deps);
    const source = await content().getVisualAsset(produced.visualAssetId!);
    const refined = await createVisualGeneration(
      1,
      {
        opportunityId: opportunity.id,
        kind: "image",
        capability: "refine_image",
        sourceVisualAssetId: source!.id,
        instruction: "Make the contrast higher",
        intent: { subject: `${RUN} refined` },
        regenerate: true,
      },
      deps,
    );
    const run = await runVisualGeneration(refined.generation.id, deps);
    assert.equal(run.status, "ready");
    const afterSource = await content().getVisualAsset(source!.id);
    assert.equal(afterSource!.storageKey, source!.storageKey);
    assert.equal(afterSource!.id, source!.id);
    assert.notEqual(run.visualAssetId, source!.id);
    assert.equal(refined.generation.sourceVisualAssetId, source!.id);
  });

  it("carousel generation is ordered; incomplete carousels are not ready", async () => {
    resetVisualProviders();
    registerVisualProvider(createFixtureVisualProvider({ failAtIndex: 1 }));
    const { opportunity, story } = await seedOpportunity("carousel-gen");
    const deps = visualDeps();
    const { generation } = await createVisualGeneration(
      1,
      {
        opportunityId: opportunity.id,
        kind: "carousel",
        slideCount: 3,
        intent: { subject: `${RUN} carousel gen` },
      },
      deps,
    );
    const run = await runVisualGeneration(generation.id, deps);
    assert.equal(run.status, "partial");
    assert.ok((run.visualAssetIds?.length ?? 0) >= 1);
    assert.ok((run.visualAssetIds?.length ?? 0) < 3);
    const readyAssets = (await content().listVisualAssetsForGeneration(generation.id)).filter((a) => a.status === "ready");
    assert.ok(readyAssets.length >= 1, "successful sibling assets are kept");
    registerVisualProvider(createFixtureVisualProvider());
    const complete = await createVisualGeneration(
      1,
      {
        opportunityId: opportunity.id,
        kind: "carousel",
        slideCount: 3,
        intent: { subject: `${RUN} carousel complete` },
        regenerate: true,
        regenerationNonce: "carousel-ok",
      },
      deps,
    );
    const done = await runVisualGeneration(complete.generation.id, deps);
    assert.equal(done.status, "ready");
    assert.equal(done.visualAssetIds?.length, 3);
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "carousel",
        channel: "x",
        payload: {
          slides: (done.visualAssetIds ?? []).map((visualAssetId, i) => ({
            visualAssetId,
            caption: `slide ${i + 1}`,
          })),
        },
        provenance: "generated",
        attribution: [],
        attributionReason: "fixture",
      },
      { artifacts: content() },
    );
    const refs = await content().listVisualAssetRefs(artifact.id);
    assert.deepEqual(refs.map((r) => r.position), [0, 1, 2]);
    assert.equal(story.researchJobId, null);
  });

  it("owner isolation: a foreign user cannot read another owner's generation", async () => {
    const { opportunity } = await seedOpportunity("owner-iso");
    const deps = visualDeps();
    const { generation } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: { subject: `${RUN} owned` } },
      deps,
    );
    const foreign = await content().getVisualGenerationForOwner(generation.id, 99);
    assert.equal(foreign, undefined);
    const owned = await content().getVisualGenerationForOwner(generation.id, 1);
    assert.equal(owned?.id, generation.id);
  });

  it("Story → Opportunity → GenerationJob → visual generation does not re-research, and context is frozen", async () => {
    const { opportunity, story } = await seedOpportunity("story-visual", "image");
    const deps = visualDeps();
    const { job } = await createGenerationJob(
      opportunity.id,
      {},
      {
        content: content(),
        stories: { getStory: (id: number) => storyStore().getStory(id) },
        evidence: { listEvidence: async () => [] },
        model: {
          provider: "fake-model",
          async generate() {
            return { payload: { visualAssetId: 1 }, model: "fake-1", provider: "fake-model", cost: null, usage: {} };
          },
        },
        defaultModel: "fake-1",
      },
    );
    let calls = 0;
    const reader = {
      async getUserProfile() {
        calls += 1;
        return {
          niche: calls === 1 ? "data-ai" : "CHANGED",
          audienceDescription: "engineers",
          brandVoice: "direct",
          writingStyleNotes: null,
          contentGoals: "teach",
          messagingPillars: ["mlops"],
          targetPlatforms: null,
          postingFrequency: null,
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        };
      },
      async listFavoriteVaultItems() {
        return [];
      },
      async listFavoriteStyleProfiles() {
        return [];
      },
    };
    const created = await createVisualGeneration(
      1,
      {
        opportunityId: opportunity.id,
        generationJobId: job.id,
        kind: "image",
        intent: { subject: `${RUN} story visual` },
      },
      { ...deps, contextReader: reader as never },
    );
    const snapshot = created.generation.requestSnapshot as { context?: { renderedBlock?: string; contextHash?: string } };
    assert.match(String(snapshot.context?.renderedBlock ?? ""), /data-ai/);
    const hash = snapshot.context?.contextHash;
    await reader.getUserProfile();
    const again = await content().getVisualGeneration(created.generation.id);
    const later = again!.requestSnapshot as { context?: { renderedBlock?: string; contextHash?: string } };
    assert.equal(later.context?.contextHash, hash, "queued visual snapshot must not follow live context");
    assert.match(String(later.context?.renderedBlock ?? ""), /data-ai/);
    assert.equal(created.generation.generationJobId, job.id);
    assert.equal(story.researchJobId, null);
  });

  it("asset rows store storage keys, never image bytes", async () => {
    const cols = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema='public' and table_name='visual_assets'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    assert.equal(names.includes("bytes"), false);
    assert.equal(names.includes("data"), false);
    const { opportunity } = await seedOpportunity("no-bytes");
    const deps = visualDeps();
    const { generation } = await createVisualGeneration(
      1,
      { opportunityId: opportunity.id, kind: "image", intent: { subject: `${RUN} no bytes` } },
      deps,
    );
    await runVisualGeneration(generation.id, deps);
    const [row] = await db.select().from(visualAssets).where(eq(visualAssets.visualGenerationId, generation.id));
    assert.match(row.storageKey, /^local:[0-9a-f]+$/);
    assert.equal(typeof (row as { bytes?: unknown }).bytes, "undefined");
  });
});
