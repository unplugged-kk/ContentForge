#!/usr/bin/env node
/**
 * Phase 28.1B — ONE real YouTube upload of an existing VideoAsset.
 *
 * Requires:
 *   CONTENTFORGE_REAL_PUBLISH_E2E=1
 *   CONTENTFORGE_PUBLISH_CERTIFICATION=1
 *   Google OAuth client + connected YouTube account (refresh token)
 *   Isolated DB with existing fal VideoAsset (default id 688)
 *
 * Does NOT call fal.ai queue submit or ElevenLabs.
 * May GET an already-completed fal request only to rehydrate in-memory bytes.
 *
 * Usage:
 *   CONTENTFORGE_REAL_PUBLISH_E2E=1 CONTENTFORGE_PUBLISH_CERTIFICATION=1 \
 *     DATABASE_URL='postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live' \
 *     npx tsx script/publish-certify-youtube.ts
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_URL = process.env.E2E_LIVE_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? "postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live";
const EVIDENCE_PATH = path.join(ROOT, ".scratch", "publish-cert-youtube-evidence.json");
const BUDGET_PATH = process.env.PUBLISH_CERT_BUDGET_PATH
  ?? path.join(ROOT, ".scratch", "publish-cert-budget.json");
const VIDEO_CACHE = path.join(ROOT, ".scratch", "media-cert-videos", "688.mp4");
const CERT_KEY = "phase28.1-youtube-certification-v1";
const ASSET_ID = Number(process.env.YOUTUBE_CERT_ASSET_ID ?? 688);
const FAL_REQUEST_ID = process.env.FAL_RECONCILE_REQUEST_ID ?? "01a0b55f-c335-75e1-b4d8-8bae750bc76d";
const RUN = `ytcert${Date.now().toString(36)}`;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function readEvidence(): Record<string, unknown> {
  if (!existsSync(EVIDENCE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeEvidence(evidence: Record<string, unknown>) {
  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function rehydrateBytes(expectedHash: string, expectedSize: number): Promise<Buffer> {
  if (existsSync(VIDEO_CACHE)) {
    const cached = readFileSync(VIDEO_CACHE);
    const hash = createHash("sha256").update(cached).digest("hex");
    assert(hash === expectedHash, "cached video hash mismatch");
    return cached;
  }

  const falKey = (process.env.FAL_KEY || process.env.FAL_API_KEY || "").trim();
  assert(falKey, "BLOCKED — need FAL_KEY only to rehydrate existing asset bytes (no new generation)");

  console.log("→ rehydrating existing fal result (GET only, no queue submit)…");
  const res = await fetch(`https://queue.fal.run/fal-ai/wan/requests/${FAL_REQUEST_ID}`, {
    headers: { Authorization: `Key ${falKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  assert(res.ok, `fal result GET failed: ${res.status}`);
  const json = await res.json() as {
    video?: { url?: string };
    data?: { video?: { url?: string } };
  };
  const videoUrl = json.video?.url || json.data?.video?.url;
  assert(videoUrl, "fal result missing video.url");
  const media = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  assert(media.ok, `video download failed: ${media.status}`);
  const bytes = Buffer.from(await media.arrayBuffer());
  assert(bytes.length === expectedSize, `byte size ${bytes.length} != ${expectedSize}`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert(hash === expectedHash, "downloaded video hash mismatch vs ContentForge asset");
  mkdirSync(path.dirname(VIDEO_CACHE), { recursive: true });
  writeFileSync(VIDEO_CACHE, bytes);
  return bytes;
}

async function main() {
  console.log("════════════════════════════════════════════════════════");
  console.log("REAL PUBLISH TEST — Phase 28.1B YouTube certification");
  console.log("════════════════════════════════════════════════════════");

  assert(process.env.CONTENTFORGE_REAL_PUBLISH_E2E === "1", "CONTENTFORGE_REAL_PUBLISH_E2E=1 required");
  assert(process.env.CONTENTFORGE_PUBLISH_CERTIFICATION === "1", "CONTENTFORGE_PUBLISH_CERTIFICATION=1 required");
  assert(/127\.0\.0\.1:5433\/cf_e2e_live/.test(DB_URL), "REFUSING: must use isolated cf_e2e_live DB");
  assert(!process.env.MEDIA_CERT_REGENERATE, "regenerate flag must not be set");

  process.env.DATABASE_URL = DB_URL;
  process.env.PUBLISH_CERT_BUDGET_PATH = BUDGET_PATH;

  const prior = readEvidence();
  if (prior.status === "PASS" && prior.youtubeVideoId && prior.certificationKey === CERT_KEY) {
    console.log("Prior successful certification evidence found — refusing duplicate upload");
    console.log(JSON.stringify({
      publicationId: prior.publicationId,
      youtubeVideoId: prior.youtubeVideoId,
      visibility: prior.visibility,
      certificationKey: CERT_KEY,
      realUploads: 1,
      reconciliation: prior.reconciliation,
    }, null, 2));
    return;
  }

  if (existsSync(BUDGET_PATH)) {
    const budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8")) as {
      youtubePublishes?: number;
      youtubeCertKey?: string;
    };
    if ((budget.youtubePublishes ?? 0) >= 1 && budget.youtubeCertKey === CERT_KEY) {
      throw new Error(`YouTube certification key "${CERT_KEY}" already consumed — reuse durable Publication`);
    }
  }

  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  const assetRes = await client.query(
    `SELECT id, kind, mime, byte_size, storage_key, content_hash, duration_ms, width, height, user_id, status
     FROM visual_assets WHERE id=$1`,
    [ASSET_ID],
  );
  const asset = assetRes.rows[0];
  assert(asset, `VideoAsset ${ASSET_ID} not found`);
  assert(asset.kind === "video", "asset must be video");
  assert(asset.mime === "video/mp4", "asset must be video/mp4");
  assert(asset.status === "ready", `asset status is ${asset.status}`);
  await client.end();

  const bytes = await rehydrateBytes(asset.content_hash, Number(asset.byte_size));

  const { visualAssetStorage, registerBuiltinVisualProviders } = await import("../server/content/service");
  registerBuiltinVisualProviders();
  await visualAssetStorage.put(bytes, "video/mp4");

  const { storage } = await import("../server/storage");
  const { db } = await import("../server/db");
  const { DatabaseContentStorage } = await import("../server/content/storage");
  const { DatabaseStoryStorage } = await import("../server/story/storage");
  const { createOpportunityFromStory } = await import("../server/content/opportunity");
  const {
    createArtifact,
    submitArtifactForReview,
    approveArtifact,
  } = await import("../server/content/artifact");
  const { createSchedule, dispatchDueOccurrences } = await import("../server/content/scheduling");
  const { runPublication } = await import("../server/content/publication");
  const { registerBuiltinChannelAdapters } = await import("../server/content/adapters");
  const { getYouTubeConfigSummary, reconcileYouTubeVideo } = await import("../server/social/youtube");
  const { eq } = await import("drizzle-orm");
  const { publications, results, stories } = await import("@shared/schema");

  registerBuiltinChannelAdapters();

  const ownerId = asset.user_id != null ? Number(asset.user_id) : 1;
  const status = await getYouTubeConfigSummary(ownerId);
  console.log("YouTube status:", JSON.stringify({
    clientConfigured: status.clientConfigured,
    accountConnected: status.accountConnected,
    refreshCredentialPresent: status.refreshCredentialPresent,
    channelDiscovered: status.channelDiscovered,
    channelId: status.channelId,
    channelTitle: status.channelTitle,
    publicationReady: status.publicationReady,
  }));

  if (!status.refreshCredentialPresent) {
    throw new Error(
      "BLOCKED — YouTube OAuth refresh credential unavailable. Connect via /api/social/youtube/connect",
    );
  }

  const account = await storage.getConnectedAccountForOwner("youtube", ownerId)
    ?? await storage.getConnectedAccount("youtube");
  assert(account?.refreshToken, "connected youtube refresh token missing");

  const content = new DatabaseContentStorage(db);
  const storyStore = new DatabaseStoryStorage(db);

  const [story] = await db
    .insert(stories)
    .values({
      userId: ownerId,
      researchJobId: null,
      provenance: "human",
      title: `${RUN} youtube cert`,
      insightBody: "Phase 28.1B YouTube certification story",
      angles: [],
      evidenceRefs: [],
      status: "ready",
    })
    .returning();

  const opportunity = await createOpportunityFromStory(
    story.id,
    {
      concept: "youtube certification",
      objective: "educate",
      format: "video",
      channel: "youtube",
    },
    { opportunities: content, stories: storyStore },
  );

  const artifact = await createArtifact(
    {
      userId: ownerId,
      generationJobId: null,
      opportunityId: opportunity.id,
      format: "video",
      channel: "youtube",
      payload: {
        visualAssetId: ASSET_ID,
        altText: "ContentForge Phase 28.1B cert",
        title: "CF cert 28.1",
        description: "ContentForge Phase 28.1B certification upload (private).",
        privacyStatus: "private",
        certificationKey: CERT_KEY,
      },
      provenance: "generated",
      attribution: [],
      attributionReason: "phase28.1B-youtube-certification",
    },
    { artifacts: content },
  );
  await submitArtifactForReview(artifact.id, { artifacts: content });
  const approved = await approveArtifact(artifact.id, { artifacts: content });
  const schedule = await createSchedule(approved.id, {}, { content });
  await dispatchDueOccurrences(new Date(), {
    content,
    enqueuePublication: async () => true,
  });

  const [publication] = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
  assert(publication, "publication not materialized");

  console.log(`→ runPublication ${publication.id} (VideoAsset ${ASSET_ID})…`);
  const run = await runPublication(publication.id, {
    content,
    storage: visualAssetStorage,
  });

  assert(run.status === "published", `expected published, got ${run.status}: ${run.message ?? ""}`);
  assert(run.externalId, "missing YouTube video id");

  console.log("→ reconcile…");
  const reconciled = await reconcileYouTubeVideo(
    { videoId: run.externalId, title: "CF cert 28.1" },
    ownerId,
  );

  const [resultRow] = await db.select().from(results).where(eq(results.publicationId, publication.id));
  assert(resultRow?.outcome === "published", `Result outcome=${resultRow?.outcome}`);

  const evidence = {
    status: "PASS",
    phase: "28.1B",
    certificationKey: CERT_KEY,
    visualAssetId: ASSET_ID,
    artifactId: approved.id,
    publicationId: publication.id,
    youtubeVideoId: run.externalId,
    url: `https://www.youtube.com/watch?v=${run.externalId}`,
    visibility: "private",
    channelId: status.channelId,
    channelTitle: status.channelTitle,
    reconciliation: reconciled,
    resultOutcome: resultRow.outcome,
    realYouTubeUploads: 1,
    completedAt: new Date().toISOString(),
  };
  writeEvidence(evidence);
  console.log("✓ YouTube certification PASS");
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((err) => {
  console.error("YouTube certification FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
