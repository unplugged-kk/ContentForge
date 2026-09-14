/**
 * DB-backed tests for Phase 5 reconciliation.
 *
 * Real PostgreSQL, real publication persistence, real channel adapter
 * registry, real X adapter (`server/social/x.ts`) — the ONLY thing doubled is
 * the genuine external boundary: a plain Node `http` server standing in for
 * xQuick, driven by env vars exactly like the live E2E harness does.
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
const RUN = `rx${Date.now().toString(36)}`;

// ── Deterministic xQuick double (genuine external boundary only) ────────────
type WriteActionState = { status: "pending" | "success" | "failed"; tweetId?: string; url?: string; message?: string };

function startXQuickFixture() {
  const writeActions = new Map<string, WriteActionState>();
  let nextMode: "immediate" | "pending" = "immediate";
  let tweetSeq = 0;
  let pendingSeq = 0;

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/x/tweets") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (nextMode === "pending") {
          pendingSeq += 1;
          const id = `wa-${RUN}-${pendingSeq}`;
          writeActions.set(id, { status: "pending" });
          nextMode = "immediate";
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

    const tweetLookupMatch = url.pathname.match(/^\/x\/tweets\/(.+)$/);
    if (req.method === "GET" && tweetLookupMatch) {
      return send(404, { message: "not found" }); // never used by these tests; present for completeness
    }

    return send(404, { message: "not found" });
  });

  return {
    server,
    armPending: () => {
      nextMode = "pending";
    },
    resolve: (writeActionId: string, state: WriteActionState) => writeActions.set(writeActionId, state),
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describeDb("X publication reconciliation (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);
  const fixture = startXQuickFixture();
  let savedEnv: Record<string, string | undefined> = {};

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    registerBuiltinChannelAdapters();

    const port = await fixture.start();
    savedEnv = {
      XQUIK_API_BASE_URL: process.env.XQUIK_API_BASE_URL,
      XQUIK_API_KEY: process.env.XQUIK_API_KEY,
      XQUIK_ACCOUNT: process.env.XQUIK_ACCOUNT,
      XQUIK_WRITE_POLL_ATTEMPTS: process.env.XQUIK_WRITE_POLL_ATTEMPTS,
      XQUIK_WRITE_POLL_DELAY_MS: process.env.XQUIK_WRITE_POLL_DELAY_MS,
      XQUIK_TIMEOUT_MS: process.env.XQUIK_TIMEOUT_MS,
    };
    process.env.XQUIK_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.XQUIK_API_KEY = "fixture-key";
    process.env.XQUIK_ACCOUNT = "cf_test";
    process.env.XQUIK_WRITE_POLL_ATTEMPTS = "1";
    process.env.XQUIK_WRITE_POLL_DELAY_MS = "1";
    process.env.XQUIK_TIMEOUT_MS = "3000";
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

  /** Approved x_post Artifact -> Schedule -> materialized Occurrence -> claimed Publication (queued, not yet run). */
  async function seedPendingPublication(suffix: string, text = "hi") {
    const tag = `${RUN}-${suffix}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: 1,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "reconcile",
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
        excerpt: "reconciliation resolves ambiguous publications without duplicating side effects",
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
        insightBody: "Unknown outcomes are resolved, never guessed.",
        angles: [],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "reconcile", objective: "educate", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "x_post",
        channel: "x",
        payload: { text },
        attribution: [{ kind: "research_evidence", researchJobId: job.id, evidenceIds: [] }],
      },
      { artifacts: store },
    );
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });

    const schedule = await createSchedule(approved.id, {}, { content: store });
    await dispatchDueOccurrences(new Date(), { content: store, enqueuePublication: async () => true });
    const [publicationRow] = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));
    return { artifact: approved, schedule, publication: publicationRow };
  }

  function reconcileDeps(): ReconcileDeps {
    return { content: content(), enqueuePublication: async (p) => runPublication(p.id, { content: content() }).then((r) => r.status !== "skipped") };
  }

  it("publish attempt that never resolves becomes `unknown`, not falsely published", async () => {
    fixture.armPending();
    const { publication } = await seedPendingPublication("ambiguous");
    const run = await runPublication(publication.id, { content: content() });
    assert.equal(run.status, "failed");
    assert.equal(run.failureClass, "unknown");

    const [row] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(row.state, "failed");
    assert.equal(row.providerCalled, true);
    const [resultRow] = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRow.outcome, "unknown");
    assert.ok(typeof (resultRow.metrics as Record<string, unknown>).writeActionId === "string", "writeActionId captured");

    // Drain it so it doesn't leak into later tests' `listUnknownPublications` scans.
    fixture.resolve((resultRow.metrics as Record<string, string>).writeActionId, {
      status: "success",
      tweetId: `tweet-${RUN}-ambiguous-drained`,
    });
    await reconcileUnknownPublications(new Date(), reconcileDeps());
  });

  it("golden path: reconciliation discovers the external post and resolves the SAME Result row", async () => {
    fixture.armPending();
    const { publication } = await seedPendingPublication("resolve");
    await runPublication(publication.id, { content: content() });
    const [before] = await db.select().from(results).where(eq(results.publicationId, publication.id));
    const writeActionId = (before.metrics as Record<string, string>).writeActionId;

    fixture.resolve(writeActionId, { status: "success", tweetId: `tweet-${RUN}-resolved`, url: "https://x.com/i/status/resolved" });

    const out = await reconcileUnknownPublications(new Date(), reconcileDeps());
    assert.equal(out.resolved, 1);

    const [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.state, "published");
    assert.equal(pubRow.externalId, `tweet-${RUN}-resolved`);

    const resultRows = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRows.length, 1, "still exactly one Result row — resolved in place, not duplicated");
    assert.equal(resultRows[0].id, before.id, "the SAME row was updated");
    assert.equal(resultRows[0].outcome, "published");

    const [occRow] = await db
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.id, pubRow.occurrenceId));
    assert.equal(occRow.status, "published");

    // Duplicate reconciliation must be harmless.
    const again = await reconcileUnknownPublications(new Date(), reconcileDeps());
    assert.equal(again.resolved, 0, "no longer an unknown candidate");
    const resultRows2 = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRows2.length, 1);
  });

  it("confirmed-not-published: re-queues the SAME Publication and the retried publish reaches exactly one final Result", async () => {
    fixture.armPending();
    const { publication } = await seedPendingPublication("requeue");
    await runPublication(publication.id, { content: content() });
    const [before] = await db.select().from(results).where(eq(results.publicationId, publication.id));
    const writeActionId = (before.metrics as Record<string, string>).writeActionId;

    fixture.resolve(writeActionId, { status: "failed", message: "xQuick write action failed." });

    const out = await reconcileUnknownPublications(new Date(), reconcileDeps());
    assert.equal(out.requeued, 1);

    // reconcileDeps().enqueuePublication actually re-ran runPublication (a
    // fresh publish attempt) as part of the requeue — the fixture now answers
    // normally (armPending was consumed), so it must succeed.
    const [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.state, "published", "the fresh attempt succeeded");

    const resultRows = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRows.length, 1, "exactly one final Result, no artifact of the discarded unknown attempt");
    assert.equal(resultRows[0].outcome, "published");
    assert.notEqual(resultRows[0].id, before.id, "a fresh Result row, not the deleted provisional one");
  });

  it("still unknown after reconciliation: leaves the Publication unknown, bounded, survives restart-equivalent recovery", async () => {
    fixture.armPending();
    const { publication } = await seedPendingPublication("still-unknown");
    await runPublication(publication.id, { content: content() });
    // Do NOT resolve the write action — it stays "pending" forever.

    const first = await reconcileUnknownPublications(new Date(), reconcileDeps());
    assert.equal(first.stillUnknown, 1);
    let [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.state, "failed", "must not get stuck in \"publishing\"");
    assert.equal(pubRow.attempt, 2, "lease attempt counter is the durable bound (1 from publish + 1 from reconcile)");

    // "Restart": a brand-new DatabaseContentStorage instance, no in-memory state.
    const restarted = { content: new DatabaseContentStorage(db), enqueuePublication: reconcileDeps().enqueuePublication };
    const second = await reconcileUnknownPublications(new Date(), restarted);
    assert.equal(second.stillUnknown, 1);
    [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.attempt, 3);

    const resultRows = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRows.length, 1);
    assert.equal(resultRows[0].outcome, "unknown", "never guessed into published or failed");

    // Drain it so it doesn't leak into the concurrency test below.
    const [resultRow] = resultRows;
    fixture.resolve((resultRow.metrics as Record<string, string>).writeActionId, {
      status: "success",
      tweetId: `tweet-${RUN}-still-unknown-drained`,
    });
    await reconcileUnknownPublications(new Date(), reconcileDeps());
  });

  it("concurrency: two reconciliation passes racing the same Publication produce exactly one final outcome", async () => {
    fixture.armPending();
    const { publication } = await seedPendingPublication("concurrent");
    await runPublication(publication.id, { content: content() });
    const [before] = await db.select().from(results).where(eq(results.publicationId, publication.id));
    fixture.resolve((before.metrics as Record<string, string>).writeActionId, {
      status: "success",
      tweetId: `tweet-${RUN}-concurrent`,
    });

    const [a, b, c] = await Promise.all([
      reconcileUnknownPublications(new Date(), reconcileDeps()),
      reconcileUnknownPublications(new Date(), reconcileDeps()),
      reconcileUnknownPublications(new Date(), reconcileDeps()),
    ]);
    const resolvedTotal = a.resolved + b.resolved + c.resolved;
    assert.equal(resolvedTotal, 1, "the lease is the sole arbiter — only one pass resolves it");

    const [pubRow] = await db.select().from(publications).where(eq(publications.id, publication.id));
    assert.equal(pubRow.state, "published");
    const resultRows = await db.select().from(results).where(eq(results.publicationId, publication.id));
    assert.equal(resultRows.length, 1);
  });

  it("recurring Schedule: reconciliation resolves only the ambiguous Occurrence, never advances or alters the series", async () => {
    fixture.armPending();
    const tag = `${RUN}-recurring`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: 1,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "reconcile-recurring",
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
        contentHash: "b".repeat(64),
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
        excerpt: "reconciliation is orthogonal to recurrence",
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
        insightBody: "One ambiguous slot does not perturb the rest of the series.",
        angles: [],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    const store = content();
    const opportunity = await createOpportunityFromStory(
      story.id,
      { concept: "recurring reconcile", objective: "educate", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyStore() },
    );
    const artifact = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: opportunity.id,
        format: "x_post",
        channel: "x",
        payload: { text: "recurring reconcile probe" },
        attribution: [{ kind: "research_evidence", researchJobId: job.id, evidenceIds: [] }],
      },
      { artifacts: store },
    );
    await submitArtifactForReview(artifact.id, { artifacts: store });
    const approved = await approveArtifact(artifact.id, { artifacts: store });

    const startAt = new Date(Date.now() - 1000);
    const schedule = await createSchedule(
      approved.id,
      { recurrence: "every:1h", count: 3, startAt: startAt.toISOString() },
      { content: store },
    );
    await dispatchDueOccurrences(new Date(), { content: store, enqueuePublication: async () => true });
    const [pub1] = await db.select().from(publications).where(eq(publications.scheduleId, schedule.id));

    await runPublication(pub1.id, { content: store }); // ambiguous (armPending consumed)
    const [beforeResult] = await db.select().from(results).where(eq(results.publicationId, pub1.id));
    fixture.resolve((beforeResult.metrics as Record<string, string>).writeActionId, {
      status: "success",
      tweetId: `tweet-${RUN}-slot1`,
    });

    const out = await reconcileUnknownPublications(new Date(), reconcileDeps());
    assert.equal(out.resolved, 1);

    const [scheduleRow] = await db.select().from(schedules).where(eq(schedules.id, schedule.id));
    assert.equal(scheduleRow.recurrence, "every:1h", "recurrence untouched");
    assert.equal(scheduleRow.count, 3, "count untouched");
    assert.equal(scheduleRow.status, "active", "series not exhausted by resolving one slot (count=3)");

    const occRows = await db
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.scheduleId, schedule.id));
    assert.equal(occRows.length, 1, "reconciliation must never materialize another recurrence slot");

    const jobCountAfter = await db.select().from(researchJobs).where(like(researchJobs.correlationId, `${tag}%`));
    assert.equal(jobCountAfter.length, 1, "reconciliation never triggers regeneration/re-research");
  });
});
