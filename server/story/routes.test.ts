import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import type { ResearchJob, Story } from "@shared/schema";
import { CREATOR_NOTES_HEADER, RESEARCH_THESIS_HEADER } from "./inputSchema";
import { createStoryRouter, type StoryRouterDeps } from "./routes";
import type { InsertStoryRow, StoryStoragePort } from "./storage";

function makeJob(overrides: Partial<ResearchJob> = {}): ResearchJob {
  return {
    id: 10,
    userId: 1,
    correlationId: "corr-10",
    idempotencyKey: "idem-10",
    kind: "directed",
    query: "Postgres 18 async IO",
    status: "complete",
    initiation: {},
    diagnostics: [],
    providerIds: ["web"],
    errorClass: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

describe("story routes (co-primary StoryInput + synthesize-brief)", () => {
  let server: http.Server;
  let baseUrl: string;
  let activeUserId = 1;
  let seq = 1;
  const inserted: Story[] = [];
  const jobs = new Map<number, ResearchJob>([
    [10, makeJob({ id: 10, userId: 1, status: "complete" })],
    [11, makeJob({ id: 11, userId: 1, status: "running" })],
    [12, makeJob({ id: 12, userId: 2, status: "complete" })],
  ]);
  const evidenceByJob = new Map<
    number,
    Array<{ id: number; sourceId: number | null; excerpt: string; kind: string }>
  >([
    [
      10,
      [
        {
          id: 101,
          sourceId: 501,
          excerpt: "Postgres 18 NVMe sequential scans improved 28% in beta benchmarks.",
          kind: "excerpt",
        },
        {
          id: 102,
          sourceId: 502,
          excerpt: "Operators argue connection pooling remains the primary production bottleneck.",
          kind: "excerpt",
        },
      ],
    ],
    [12, [{ id: 201, sourceId: null, excerpt: "Foreign owner excerpt.", kind: "excerpt" }]],
  ]);
  const sourcesByJob = new Map<
    number,
    Array<{ id: number; title: string; canonicalUrl: string; provider: string }>
  >([
    [
      10,
      [
        {
          id: 501,
          title: "Postgres 18 IO benchmarks",
          canonicalUrl: "https://example.com/pg18",
          provider: "web",
        },
        {
          id: 502,
          title: "HN Postgres 18 thread",
          canonicalUrl: "https://news.ycombinator.com/item?id=502",
          provider: "hn",
        },
      ],
    ],
  ]);

  before(async () => {
    const stories: StoryStoragePort = {
      async insertStory(row: InsertStoryRow): Promise<Story> {
        const story: Story = {
          id: seq++,
          userId: row.userId ?? null,
          researchJobId: row.researchJobId,
          provenance: row.provenance,
          title: row.title,
          insightBody: row.insightBody,
          interpretationMarked: row.interpretationMarked,
          angles: row.angles,
          evidenceRefs: row.evidenceRefs,
          status: row.status,
          automationRunId: row.automationRunId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        inserted.push(story);
        return story;
      },
      async getStory(id: number) {
        return inserted.find((s) => s.id === id);
      },
      async listStories() {
        return inserted;
      },
      async listStoriesByResearchJob(jobId: number) {
        return inserted.filter((s) => s.researchJobId === jobId);
      },
      async updateStoryStatus() {
        return undefined;
      },
    };

    const deps: StoryRouterDeps = {
      stories,
      research: {
        async getJob(id) {
          return jobs.get(id);
        },
        async listEvidenceIds(id) {
          return (evidenceByJob.get(id) ?? []).map((e) => e.id);
        },
      },
      briefResearch: {
        async listEvidence(id) {
          return evidenceByJob.get(id) ?? [];
        },
        async listSources(id) {
          return sourcesByJob.get(id) ?? [];
        },
      },
    };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.userId = activeUserId;
      next();
    });
    app.use("/api/stories", createStoryRouter(deps));

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        assert.ok(addr && typeof addr === "object");
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function postJson(path: string, body: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  }

  it("preserves legacy POST /api/stories for both human and researched payloads", async () => {
    const human = await postJson("/api/stories", {
      title: "Legacy human story",
      insightBody: "Direct practitioner insight.",
      provenance: "human",
      status: "ready",
    });
    assert.equal(human.status, 201);
    assert.equal(human.body.provenance, "human");
    assert.equal(human.body.researchJobId, null);

    const researched = await postJson("/api/stories", {
      researchJobId: 10,
      title: "Legacy researched story",
      insightBody: "Synthesized from research job 10.",
      angles: ["Angle 1"],
    });
    assert.equal(researched.status, 201);
    assert.equal(researched.body.provenance, "researched");
    assert.equal(researched.body.researchJobId, 10);
    assert.deepEqual(researched.body.evidenceRefs, [101, 102]);
  });

  it("accepts discriminated storyInputSchema payloads (first_hand, researched, hybrid)", async () => {
    const firstHand = await postJson("/api/stories", {
      mode: "first_hand",
      title: "PgBouncer pooling in prod",
      observation: "Transaction pooling cut P99 latency.",
      proofPoints: ["Dropped P99 from 420ms to 85ms"],
      angles: ["Pooling vs raw IO"],
    });
    assert.equal(firstHand.status, 201);
    assert.equal(firstHand.body.provenance, "human");
    assert.equal(firstHand.body.researchJobId, null);
    assert.ok(String(firstHand.body.insightBody).includes(CREATOR_NOTES_HEADER));
    assert.match(String(firstHand.body.insightBody), /420ms to 85ms/);

    const researched = await postJson("/api/stories", {
      mode: "researched",
      researchJobId: 10,
      evidenceRefs: [101],
      title: "Postgres 18 IO benchmarks",
      thesis: "Async IO improves NVMe sequential scan throughput by 28%.",
    });
    assert.equal(researched.status, 201);
    assert.equal(researched.body.provenance, "researched");
    assert.equal(researched.body.researchJobId, 10);
    assert.deepEqual(researched.body.evidenceRefs, [101]);
    assert.ok(String(researched.body.insightBody).includes(RESEARCH_THESIS_HEADER));

    const hybrid = await postJson("/api/stories", {
      mode: "hybrid",
      researchJobId: 10,
      evidenceRefs: [101, 102],
      title: "Async IO meets real pooling bottlenecks",
      thesis: "Benchmarks show 28% scan gains, while operators flag connection pooling.",
      observation: "In our cluster, PgBouncer saturation hid storage gains.",
      proofPoints: ["Idle connections dropped from 1,800 to 120"],
    });
    assert.equal(hybrid.status, 201);
    assert.equal(hybrid.body.provenance, "researched");
    assert.deepEqual(hybrid.body.evidenceRefs, [101, 102]);
    assert.ok(String(hybrid.body.insightBody).includes(RESEARCH_THESIS_HEADER));
    assert.ok(String(hybrid.body.insightBody).includes(CREATOR_NOTES_HEADER));
  });

  it("rejects invalid discriminated mode payloads with 400", async () => {
    const emptyRefs = await postJson("/api/stories", {
      mode: "researched",
      researchJobId: 10,
      evidenceRefs: [],
      title: "Invalid",
      thesis: "Missing refs",
    });
    assert.equal(emptyRefs.status, 400);

    const bogusMode = await postJson("/api/stories", {
      mode: "unknown_mode",
      title: "Invalid",
    });
    assert.equal(bogusMode.status, 400);
  });

  it("synthesizes a structured brief via POST /api/stories/synthesize-brief with owner isolation", async () => {
    const ok = await postJson("/api/stories/synthesize-brief", {
      researchJobId: 10,
      evidenceRefs: [101, 102],
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.researchJobId, 10);
    assert.deepEqual(ok.body.evidenceRefs, [101, 102]);
    assert.equal(ok.body.usedFallback, false);
    assert.match(String(ok.body.markdown), /## Grounded Facts/);
    assert.ok(Array.isArray(ok.body.brief.facts) && ok.body.brief.facts.length >= 1);

    const foreignRef = await postJson("/api/stories/synthesize-brief", {
      researchJobId: 10,
      evidenceRefs: [999],
    });
    assert.equal(foreignRef.status, 400);

    const incomplete = await postJson("/api/stories/synthesize-brief", {
      researchJobId: 11,
    });
    assert.equal(incomplete.status, 409);

    const foreignOwner = await postJson("/api/stories/synthesize-brief", {
      researchJobId: 12,
    });
    assert.equal(foreignOwner.status, 404);
  });
});
