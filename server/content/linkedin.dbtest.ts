/**
 * DB-backed tests for Phase 6 (first non-X channel adapter).
 *
 * Real PostgreSQL, real publication persistence, real channel adapter
 * registry, real LinkedIn adapter (`server/social/linkedin.ts`) — the ONLY
 * thing doubled is the genuine external boundary: a plain Node `http` server
 * standing in for LinkedIn's Posts API.
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
import { registerBuiltinChannelAdapters } from "./adapters";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `li${Date.now().toString(36)}`;

// ── Deterministic LinkedIn Posts API double (genuine external boundary only) ──
type StoredPost = { commentary: string; createdAt: number };

function startLinkedInFixture() {
  const posts: StoredPost[] = [];
  let mode: "immediate" | "network-fail" = "immediate";
  let urnSeq = 0;

  const server = http.createServer((req, res) => {
    if (mode === "network-fail" && req.method === "POST") {
      mode = "immediate";
      req.destroy(); // simulate a connection reset before any response is sent
      return;
    }

    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/rest/posts") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        urnSeq += 1;
        const urn = `urn:li:share:${RUN}-${urnSeq}`;
        posts.push({ commentary: parsed.commentary, createdAt: Date.now() });
        return send(201, undefined, { "x-restli-id": urn });
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/rest/posts") {
      const elements = posts.map((p, i) => ({ id: `urn:li:share:${RUN}-listed-${i}`, commentary: p.commentary, createdAt: p.createdAt }));
      return send(200, { elements });
    }

    return send(404, { message: "not found" });
  });

  return {
    server,
    armNetworkFailure: () => {
      mode = "network-fail";
    },
    /** Record a post as if LinkedIn had actually received it (for the "still-unknown -> discoverable later" path). */
    recordPost: (commentary: string) => posts.push({ commentary, createdAt: Date.now() }),
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describeDb("LinkedIn channel adapter (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const fixture = startLinkedInFixture();
  let savedEnv: Record<string, string | undefined> = {};

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    registerBuiltinChannelAdapters();

    const port = await fixture.start();
    savedEnv = {
      LINKEDIN_API_BASE_URL: process.env.LINKEDIN_API_BASE_URL,
      LINKEDIN_ACCESS_TOKEN: process.env.LINKEDIN_ACCESS_TOKEN,
      LINKEDIN_AUTHOR_URN: process.env.LINKEDIN_AUTHOR_URN,
      LINKEDIN_TIMEOUT_MS: process.env.LINKEDIN_TIMEOUT_MS,
    };
    process.env.LINKEDIN_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.LINKEDIN_ACCESS_TOKEN = "fixture-token";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:cf_test";
    process.env.LINKEDIN_TIMEOUT_MS = "3000";
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
    const pubRows = schedIds.length
      ? await db.select({ id: publications.id }).from(publications).where(inArray(publications.scheduleId, schedIds))
      : [];
    const pubIds = pubRows.map((r) => r.id);

    if (pubIds.length) await db.delete(results).where(inArray(results.publicationId, pubIds));
    if (pubIds.length) await db.delete(publications).where(inArray(publications.id, pubIds));
    if (schedIds.length)
      await db.delete(scheduleOccurrences).where(inArray(scheduleOccurrences.scheduleId, schedIds));
    if (schedIds.length) await db.delete(schedules).where(inArray(schedules.id, schedIds));
    if (artIds.length) await db.delete(artifacts).where(inArray(artifacts.id, artIds));
    if (oppIds.length) await db.delete(generationJobs).where(inArray(generationJobs.opportunityId, oppIds));
    if (oppIds.length) await db.delete(opportunities).where(inArray(opportunities.id, oppIds));
    if (storyIds.length) await db.delete(stories).where(inArray(stories.id, storyIds));
    if (jobIds.length) await db.delete(researchEvidence).where(inArray(researchEvidence.jobId, jobIds));
    if (jobIds.length) await db.delete(researchSources).where(inArray(researchSources.jobId, jobIds));
    if (jobIds.length) await db.delete(researchJobs).where(inArray(researchJobs.id, jobIds));
    await pool.end().catch(() => {});
  });

  /** Approved linkedin_post (or x_post) Artifact -> Schedule -> materialized Occurrence -> queued Publication. */
  async function seedPendingPublication(
    suffix: string,
    opts: {
      format?: string;
      channel?: string;
      text?: string;
      recurrence?: { recurrence: string; count: number; startAt: string };
    } = {},
  ) {
    const format = opts.format ?? "linkedin_post";
    const channel = opts.channel ?? "linkedin";
    const text = opts.text ?? `${RUN}-${suffix} probe`;
    const tag = `${RUN}-${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: 1,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "linkedin",
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
        excerpt: "a new channel adapter proves the pipeline is channel-agnostic",
        excerptHash: `${tag}`.padEnd(64, "0").slice(0, 64),
        retrievedAt: new Date(),
      })
      .returning();
    const [story] = await db
      .insert(stories)
      .values({
        userId: 1,
        researchJobId: job.id,
        provenance: "researched",
        title: `${tag} story`,
        insightBody: "Same Artifact model, a different channel.",
        angles: [],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "linkedin", objective: "educate", format, channel },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format,
        channel,
        payload: { text },
        attribution: [{ kind: "research_evidence", researchJobId: job.id, evidenceIds: [] }],
      },
      { artifacts: store },
    );
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });

    const schedule = await createSchedule(approved.id, opts.recurrence ?? {}, { content: store });
    await dispatchDueOccurrences(new Date(), { content: store, enqueuePublication: async () => true });
    const pubRows = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    return { artifact: approved, schedule, publications: pubRows, publication: pubRows[0] };
  }

  function reconcileDeps(): ReconcileDeps {
    return {
      content: content(),
      enqueuePublication: async (p) => runPublication(p.id, { content: content() }).then((r) => r.status !== "skipped"),
    };
  }

  it("golden path: publishes a LinkedIn text post and persists the provider URN as externalId", async () => {
    const { publication, schedule } = await seedPendingPublication("golden", { text: "Golden path LinkedIn post" });
    const run = await runPublication(publication.id, { content: content() });
    assert.equal(run.status, "published");

    const [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.channel, "linkedin");
    assert.equal(pubRow.state, "published");
    assert.ok(pubRow.externalId?.startsWith("urn:li:share:"), "externalId is the provider URN");

    const [resultRow] = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRow.outcome, "published");

    const [scheduleRow] = await db.select().from(schedules).where(eq(schedules.id, schedule.id));
    assert.equal(scheduleRow.status, "exhausted", "one-shot schedule completes normally");
  });

  it("ambiguous publish (network failure before response) becomes `unknown`, never falsely published", async () => {
    fixture.armNetworkFailure();
    const { publication } = await seedPendingPublication("ambiguous", { text: `${RUN}-ambiguous body` });
    const run = await runPublication(publication.id, { content: content() });
    assert.equal(run.status, "failed");
    assert.equal(run.failureClass, "unknown");

    const [row] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(row.state, "failed");
    assert.equal(row.providerCalled, true);
    assert.equal(row.externalId, null, "never a synthetic external id");

    const [resultRow] = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRow.outcome, "unknown");
    const metrics = resultRow.metrics as Record<string, unknown>;
    assert.equal(metrics.commentary, `${RUN}-ambiguous body`);
    assert.ok(typeof metrics.attemptedAt === "string");

    // Drain it so it doesn't leak into later tests' `listUnknownPublications` scans.
    fixture.recordPost(`${RUN}-ambiguous body`);
    await reconcileUnknownPublications(new Date(), reconcileDeps());
  });

  it("reconciliation discovers the post LinkedIn actually received and resolves the SAME Result row", async () => {
    fixture.armNetworkFailure();
    const text = `${RUN}-resolve body`;
    const { publication } = await seedPendingPublication("resolve", { text });
    await runPublication(publication.id, { content: content() });
    const [before] = await db.select().from(results).where(eq(results.publicationId, publication.id));

    // LinkedIn actually received the write despite the dropped response.
    fixture.recordPost(text);

    const out = await reconcileUnknownPublications(new Date(), reconcileDeps());
    assert.equal(out.resolved, 1);

    const [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.state, "published");
    assert.ok(pubRow.externalId?.startsWith("urn:li:share:"));

    const resultRows = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRows.length, 1, "resolved in place, not duplicated");
    assert.equal(resultRows[0].id, before.id, "the SAME row was updated");
    assert.equal(resultRows[0].outcome, "published");
  });

  it(
    "still unknown when LinkedIn's listing has no match: never invents a not-published outcome, " +
      "bounded by MAX_RECONCILE_ATTEMPTS and survives restart-equivalent recovery",
    async () => {
      fixture.armNetworkFailure();
      const { publication } = await seedPendingPublication("still-unknown", { text: `${RUN}-still-unknown body` });
      await runPublication(publication.id, { content: content() });
      // Do NOT record the post — LinkedIn's listing genuinely has no match.

      const first = await reconcileUnknownPublications(new Date(), reconcileDeps());
      assert.equal(first.stillUnknown, 1);
      let [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
      assert.equal(pubRow.state, "failed", "must not get stuck in \"publishing\"");

      // "Restart": a brand-new DatabaseContentStorage instance, no in-memory state.
      const restarted = { content: new DatabaseContentStorage(db), enqueuePublication: reconcileDeps().enqueuePublication };
      const second = await reconcileUnknownPublications(new Date(), restarted);
      assert.equal(second.stillUnknown, 1);

      const resultRows = await db.select().from(results).where(eq(results.publicationId, publication.id));
      assert.equal(resultRows.length, 1);
      assert.equal(resultRows[0].outcome, "unknown", "a listing miss is never treated as confirmed-not-published");

      // Drain it so it doesn't leak into later tests' `listUnknownPublications` scans.
      fixture.recordPost(`${RUN}-still-unknown body`);
      await reconcileUnknownPublications(new Date(), reconcileDeps());
    },
  );

  it("cross-channel independence: one Artifact publishes independently to X and LinkedIn", async () => {
    // LinkedIn Publication for a linkedin_post Artifact.
    const linkedinRun = await seedPendingPublication("cross-li", { text: `${RUN}-cross-li body` });
    const liResult = await runPublication(linkedinRun.publication.id, { content: content() });
    assert.equal(liResult.status, "published");

    // Independent X Publication for a separate x_post Artifact (same pipeline, different channel).
    // Force xQuick config off so the X leg fails deterministically, proving LinkedIn's success
    // above was not achieved by leaking a shared/global adapter or credential.
    const savedXAccount = process.env.XQUIK_ACCOUNT;
    delete process.env.XQUIK_ACCOUNT;
    const xRun = await seedPendingPublication("cross-x", {
      format: "x_post",
      channel: "x",
      text: "cross-channel x probe",
    });
    const xResult = await runPublication(xRun.publication.id, { content: content() });
    if (savedXAccount === undefined) delete process.env.XQUIK_ACCOUNT;
    else process.env.XQUIK_ACCOUNT = savedXAccount;
    assert.equal(xResult.status, "failed");

    const [liRow] = await db.select().from(publications).where(eq(publications.id, linkedinRun.publication.id));
    assert.equal(liRow.state, "published", "the X failure did not alter the already-published LinkedIn Publication");
    const [xRow] = await db.select().from(publications).where(eq(publications.id, xRun.publication.id));
    assert.equal(xRow.channel, "x");
    assert.notEqual(xRow.state, "published");
  });

  it("recurrence: repeated LinkedIn Publications from one pinned Artifact revision, no regeneration", async () => {
    const startAt = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5h in the past: all 3 hourly slots already due
    const { publications: pubRows, artifact, schedule } = await seedPendingPublication("recurring", {
      text: `${RUN}-recurring body`,
      recurrence: { recurrence: "every:1h", count: 3, startAt: startAt.toISOString() },
    });
    assert.equal(pubRows.length, 1, "bounded catch-up materializes one slot per tick");

    await runPublication(pubRows[0].id, { content: content() });
    await dispatchDueOccurrences(new Date(), { content: content(), enqueuePublication: async () => true });
    const afterTick2 = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    assert.equal(afterTick2.length, 2);
    await runPublication(afterTick2[1].id, { content: content() });

    await dispatchDueOccurrences(new Date(), { content: content(), enqueuePublication: async () => true });
    const afterTick3 = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    assert.equal(afterTick3.length, 3);
    await runPublication(afterTick3[2].id, { content: content() });

    const finalPubs = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    assert.equal(finalPubs.length, 3);
    for (const p of finalPubs) {
      assert.equal(p.channel, "linkedin");
      assert.equal(p.artifactId, artifact.id, "every slot pins the SAME Artifact revision");
      assert.equal(p.state, "published");
    }

    const resultRows = await db
      .select()
      .from(results)
      .where(
        inArray(
          results.publicationId,
          finalPubs.map((p) => p.id),
        ),
      );
    assert.equal(resultRows.length, 3);

    const [scheduleRow] = await db.select().from(schedules).where(eq(schedules.id, schedule.id));
    assert.equal(scheduleRow.status, "exhausted");

    const jobCountAfter = await db
      .select()
      .from(researchJobs)
      .where(like(researchJobs.correlationId, `${RUN}-recurring%`));
    assert.equal(jobCountAfter.length, 1, "recurrence never triggers regeneration/re-research");
  });
});
