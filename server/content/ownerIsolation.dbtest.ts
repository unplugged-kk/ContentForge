/**
 * Phase 30.2 §3/§8 — cross-owner isolation at the real HTTP boundary.
 *
 * Mounts the REAL story + content routers (REAL authGate, stubbed sessions
 * standing in for express-session) against a REAL database and proves:
 *
 * - anonymous → 401 on reads, mutations, paid-adjacent runs, and publish
 *   intent (handler never runs);
 * - owner A builds story → opportunity → artifact → approval → schedule;
 * - owner B gets non-leaking 404 on every A row (read AND state-changing),
 *   and cannot branch (opportunity/job/schedule/story) from A's rows;
 * - owner A still reaches every own row (no lockout from the 30.2 checks);
 * - legacy NULL-attributed rows remain visible (documented bridge, pinned).
 *
 * Requires TEST_DATABASE_URL (skipped otherwise). Uses unique owner ids per
 * run; cleans up its rows afterwards.
 */
import assert from "node:assert/strict";
import express from "express";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { artifacts } from "@shared/schema";
import { authGate } from "../middleware/authGate";
import { createDefaultStoryRouter } from "../story/routes";
import { createDefaultContentRouter } from "./routes";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const OWNER_A = 820_000 + (Date.now() % 70_000);
const OWNER_B = OWNER_A + 1;
const RUN = `oi${Date.now().toString(36)}`;

describeDb("owner isolation across story/content routers (db, HTTP boundary)", () => {
  let baseUrl = "";
  let server: ReturnType<typeof express.application.listen> | undefined;
  let db!: NodePgDatabase<typeof schema>;
  let pool: pg.Pool;

  const ids = {} as Record<string, number>;
  const createdStoryIds: number[] = [];

  const as = (who: "a" | "b" | "anon") => {
    // Connection: close — undici fetch keep-alive sockets would otherwise
    // hold the test process open after the server closes.
    const headers: Record<string, string> = { "Content-Type": "application/json", Connection: "close" };
    if (who === "a") headers.Cookie = "owner=a";
    if (who === "b") headers.Cookie = "owner=b";
    return headers;
  };
  const api = async (who: "a" | "b" | "anon", method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: as(who),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
  };

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });

    const app = express();
    app.use(express.json());
    // Stub for express-session: cookies map to server-side identities.
    app.use((req, _res, next) => {
      const cookie = String(req.headers.cookie ?? "");
      const userId = cookie.includes("owner=a") ? OWNER_A : cookie.includes("owner=b") ? OWNER_B : undefined;
      (req as unknown as { session?: { userId?: number } }).session =
        userId === undefined ? undefined : { userId };
      next();
    });
    app.use(authGate);
    app.use("/api/stories", await createDefaultStoryRouter());
    app.use("/api", await createDefaultContentRouter());
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server?.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;

    // Owner A builds the full chain through the real routes.
    const story = await (await api("a", "POST", "/api/stories", {
      title: `${RUN} story`,
      insightBody: "isolation probe",
      provenance: "human",
      status: "ready",
    })).json();
    assert.ok(story.id, "A creates story");
    ids.story = story.id;
    createdStoryIds.push(story.id);

    const opp = await (await api("a", "POST", "/api/opportunities", {
      storyId: story.id, concept: "c", objective: "o", format: "x_post", channel: "x",
    })).json();
    assert.ok(opp.id, "A creates opportunity");
    ids.opp = opp.id;

    const artifact = await (await api("a", "POST", `/api/opportunities/${opp.id}/artifacts`, {
      payload: { text: `${RUN} artifact body` },
      attributionReason: "human-authored isolation probe",
    })).json();
    assert.ok(artifact.id, "A creates artifact");
    ids.artifact = artifact.id;

    for (const action of ["submit-review", "approve"]) {
      const r = await api("a", "POST", `/api/artifacts/${artifact.id}/${action}`);
      assert.equal(r.status, 200, `A ${action}`);
    }
    // Generation job owned by A (created through the real route; the queue
    // itself is not running in this test, so 503-with-id is acceptable).
    const jobRes = await api("a", "POST", "/api/generation-jobs", { opportunityId: opp.id });
    assert.ok([200, 201, 503].includes(jobRes.status), `A creates job (got ${jobRes.status})`);
    const jobBody = await jobRes.json();
    assert.ok(jobBody.id, "job row exists");
    ids.job = jobBody.id;
    const schedule = await (await api("a", "POST", "/api/schedules", {
      artifactId: artifact.id,
    })).json();
    assert.ok(schedule.id, "A creates schedule");
    ids.schedule = schedule.id;

    // Legacy NULL-attributed bridge row: A's second artifact, unattributed.
    const artifact2 = await (await api("a", "POST", `/api/opportunities/${opp.id}/artifacts`, {
      payload: { text: `${RUN} legacy bridge` },
      attributionReason: "bridge probe",
    })).json();
    ids.legacyArtifact = artifact2.id;
    await db.update(artifacts).set({ userId: null }).where(eq(artifacts.id, artifact2.id));
  });

  after(async () => {
    if (!CONNECTION) return;
    for (const storyId of createdStoryIds) {
      const opps = await db.select().from(schema.opportunities).where(eq(schema.opportunities.storyId, storyId));
      for (const o of opps) {
        const arts = await db.select().from(schema.artifacts).where(eq(schema.artifacts.opportunityId, o.id));
        for (const a of arts) {
          const scheds = await db.select().from(schema.schedules).where(eq(schema.schedules.artifactId, a.id));
          for (const s of scheds) {
            const spubs = await db.select().from(schema.publications).where(eq(schema.publications.scheduleId, s.id));
            for (const p of spubs) {
              await db.delete(schema.results).where(eq(schema.results.publicationId, p.id));
              await db.delete(schema.publications).where(eq(schema.publications.id, p.id));
            }
            await db.delete(schema.scheduleOccurrences).where(eq(schema.scheduleOccurrences.scheduleId, s.id));
            await db.delete(schema.schedules).where(eq(schema.schedules.id, s.id));
          }
          await db.delete(schema.visualAssetRefs).where(eq(schema.visualAssetRefs.artifactId, a.id));
          // Approval writes learning/performance signals referencing the
          // artifact — remove those before the artifact row itself (FK).
          await db.delete(schema.learningSignals).where(eq(schema.learningSignals.artifactId, a.id));
          await db.delete(schema.performanceSignals).where(eq(schema.performanceSignals.artifactId, a.id));
          await db.delete(schema.artifacts).where(eq(schema.artifacts.id, a.id));
        }
        const jobs = await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.opportunityId, o.id));
        for (const j of jobs) await db.delete(schema.generationJobs).where(eq(schema.generationJobs.id, j.id));
        await db.delete(schema.opportunities).where(eq(schema.opportunities.id, o.id));
      }
      await db.delete(schema.stories).where(eq(schema.stories.id, storyId));
    }
    // closeIdleConnections releases keep-alive sockets first: otherwise
    // close() waits for them indefinitely and the runner hangs at teardown.
    server!.closeIdleConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((err) => (err ? reject(err) : resolve())),
    );
    await pool.end();
    // Module-level pools held by the imported service graph (server/db and
    // anything built on it) keep the event loop alive; each dbtest file runs
    // in its own process, so ending the shared pool here is safe.
    const { pool: sharedPool } = await import("../db.js");
    await sharedPool.end();
  });

  it("anonymous callers get 401 on reads, mutations, and intent", async () => {
    for (const [method, path, body] of [
      ["GET", `/api/stories/${ids.story}`, undefined],
      ["GET", `/api/opportunities/${ids.opp}`, undefined],
      ["GET", `/api/artifacts/${ids.artifact}`, undefined],
      ["GET", `/api/schedules/${ids.schedule}`, undefined],
      ["POST", `/api/opportunities/${ids.opp}/select`, undefined],
      ["POST", `/api/opportunities/${ids.opp}/kill`, { killReason: "x" }],
      ["POST", `/api/artifacts/${ids.artifact}/approve`, undefined],
      ["POST", "/api/schedules", { artifactId: ids.artifact }],
      ["POST", `/api/artifacts/${ids.artifact}/publications`, { targets: [] }],
    ] as const) {
      const res = await api("anon", method, path, body);
      assert.equal(res.status, 401, `anon ${method} ${path}`);
    }
  });

  it("owner B gets 404 (non-leaking) on every A row, read or write", async () => {
    const probes: Array<[string, string, unknown?]> = [
      ["GET", `/api/stories/${ids.story}`],
      ["GET", `/api/opportunities/${ids.opp}`],
      ["GET", `/api/opportunities?storyId=${ids.story}`],
      ["GET", `/api/generation-jobs/${ids.job}`],
      ["GET", `/api/artifacts/${ids.artifact}`],
      ["GET", `/api/artifacts/${ids.artifact}/history`],
      ["GET", `/api/schedules/${ids.schedule}`],
      ["POST", `/api/opportunities/${ids.opp}/select`],
      ["POST", `/api/opportunities/${ids.opp}/kill`, { killReason: "x" }],
      ["POST", `/api/artifacts/${ids.artifact}/revise`, { baseArtifactId: ids.artifact, payload: { text: "hijack" }, attributionReason: "x" }],
      ["POST", `/api/artifacts/${ids.artifact}/visuals`, { visualAssetId: 1 }],
      ["POST", `/api/generation-jobs/${ids.job}/run`, undefined],
    ];
    for (const [method, path, body] of probes) {
      const res = await api("b", method, path, body);
      assert.equal(res.status, 404, `B ${method} ${path} must not resolve A's row`);
    }
  });

  it("owner B cannot branch paid/state-changing work from A's rows", async () => {
    const opp = await api("b", "POST", "/api/opportunities", {
      storyId: ids.story, concept: "hijack", objective: "o", format: "x_post", channel: "x",
    });
    assert.equal(opp.status, 404);
    const job = await api("b", "POST", "/api/generation-jobs", { opportunityId: ids.opp });
    assert.equal(job.status, 404);
    const sched = await api("b", "POST", "/api/schedules", { artifactId: ids.artifact });
    assert.equal(sched.status, 404);
  });

  it("owner A still reaches every own row (no lockout)", async () => {
    for (const path of [
      `/api/stories/${ids.story}`,
      `/api/opportunities/${ids.opp}`,
      `/api/opportunities?storyId=${ids.story}`,
      `/api/generation-jobs/${ids.job}`,
      `/api/artifacts/${ids.artifact}`,
      `/api/artifacts/${ids.artifact}/history`,
      `/api/schedules/${ids.schedule}`,
    ]) {
      const res = await api("a", "GET", path);
      assert.equal(res.status, 200, `A GET ${path}`);
    }
  });

  it("legacy NULL-attributed rows remain visible (documented bridge)", async () => {
    const res = await api("b", "GET", `/api/artifacts/${ids.legacyArtifact}`);
    assert.equal(res.status, 200);
  });
});
