/**
 * Multi-format vertical-slice test (INC-06 + INC-07):
 * Proves ONE completed ResearchJob + Story produces BOTH an X post (`x_post` on
 * `x`) AND a Threads post (`x_post` on `threads`) with preserved provenance,
 * `claim_evidence_v1` audit records, word-safe X budget fitting, and ZERO
 * re-research!
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Artifact,
  GenerationJob,
  GenerationPolicy,
  Opportunity,
  ResearchJob,
  Story,
} from "@shared/schema";
import { createStoryFromResearch } from "../story/service";
import { synthesizeStructuredBrief } from "../story/synthesis";
import { createOpportunityFromStory } from "./opportunity";
import { createGenerationJob, runGenerationJob, type GenerationDeps } from "./generation";
import { unwrapModelOutput } from "./model";
import { registerBuiltinChannelAdapters } from "./adapters";
import type { ContentStoragePort, InsertArtifactRow } from "./storage";
import { validateXText } from "../social/xTextLimits";

registerBuiltinChannelAdapters();

function createInMemoryMultiFormatHarness() {
  let seq = 1;
  const nextId = () => seq++;

  const stories = new Map<number, Story>();
  const opportunities = new Map<number, Opportunity>();
  const policies = new Map<number, GenerationPolicy>();
  const jobs = new Map<number, GenerationJob>();
  const artifacts = new Map<number, Artifact>();

  const researchJob: ResearchJob = {
    id: 77,
    userId: 1,
    correlationId: "corr-77",
    idempotencyKey: "idem-77",
    kind: "directed",
    query: "Apache Iceberg v3 deletion vectors",
    status: "complete",
    initiation: {},
    diagnostics: [],
    providerIds: ["web", "hn"],
    errorClass: null,
    errorMessage: null,
    startedAt: new Date("2026-11-27T10:00:00Z"),
    finishedAt: new Date("2026-11-27T10:00:05Z"),
    createdAt: new Date("2026-11-27T10:00:00Z"),
  };

  const evidenceRows = [
    {
      id: 501,
      title: "Iceberg v3 deletion vectors benchmark",
      provider: "web",
      canonicalUrl: "https://example.com/iceberg-v3",
      excerpt: "Apache Iceberg v3 deletion vectors cut CDC read amplification by 3.5x in 2026 benchmarks.",
      kind: "excerpt",
    },
    {
      id: 502,
      title: "Operators on compaction overhead",
      provider: "hn",
      canonicalUrl: "https://news.ycombinator.com/item?id=502",
      excerpt: "Operators argue small-file compaction still needs hourly tuning on high-throughput streams.",
      kind: "excerpt",
    },
  ];

  let researchReadCount = 0;

  const storyStorage = {
    async insertStory(row: any): Promise<Story> {
      const id = nextId();
      const s: Story = {
        id,
        userId: row.userId ?? null,
        researchJobId: row.researchJobId,
        provenance: row.provenance,
        title: row.title,
        insightBody: row.insightBody,
        interpretationMarked: row.interpretationMarked,
        angles: row.angles,
        evidenceRefs: row.evidenceRefs,
        status: row.status,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      stories.set(id, s);
      return s;
    },
    async getStory(id: number) {
      return stories.get(id);
    },
    async listStoriesByResearchJob(jobId: number) {
      return Array.from(stories.values()).filter((s) => s.researchJobId === jobId);
    },
    async updateStoryStatus(id: number, status: any) {
      const s = stories.get(id);
      if (!s) return undefined;
      s.status = status;
      return s;
    },
  };

  const contentStorage = {
    async insertOpportunity(row: any): Promise<Opportunity> {
      const id = nextId();
      const opp: Opportunity = {
        id,
        userId: row.userId ?? null,
        storyId: row.storyId,
        concept: row.concept,
        objective: row.objective,
        audience: row.audience ?? null,
        angle: row.angle ?? null,
        format: row.format,
        channel: row.channel,
        status: row.status ?? "proposed",
        score: null,
        scoreBreakdown: {},
        proposer: row.proposer ?? "human",
        killReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      opportunities.set(id, opp);
      return opp;
    },
    async getOpportunity(id: number) {
      return opportunities.get(id);
    },
    async getGenerationPolicyBySpecHash(specHash: string) {
      return Array.from(policies.values()).find((p) => p.specHash === specHash);
    },
    async nextPolicyVersion(policyKey: string) {
      const same = Array.from(policies.values()).filter((p) => p.policyKey === policyKey);
      return same.length + 1;
    },
    async findOrCreateGenerationPolicy(row: any) {
      const existing = Array.from(policies.values()).find((p) => p.specHash === row.specHash);
      if (existing) return { policy: existing, created: false };
      const id = nextId();
      const policy: GenerationPolicy = {
        id,
        userId: row.userId ?? null,
        policyKey: row.policyKey,
        version: row.version,
        name: row.name,
        format: row.format,
        channel: row.channel,
        voiceId: row.voiceId ?? null,
        templateId: row.templateId ?? null,
        objective: row.objective ?? null,
        audience: row.audience ?? null,
        constraints: row.constraints ?? {},
        modelPreferences: row.modelPreferences ?? {},
        specHash: row.specHash,
        contextSnapshot: row.contextSnapshot ?? {},
        createdAt: new Date(),
      };
      policies.set(id, policy);
      return { policy, created: true };
    },
    async claimGenerationJob(row: any) {
      const existing = Array.from(jobs.values()).find((j) => j.idempotencyKey === row.idempotencyKey);
      if (existing) return { job: existing, created: false };
      const id = nextId();
      const job: GenerationJob = {
        id,
        userId: row.userId ?? null,
        opportunityId: row.opportunityId,
        format: row.format,
        channel: row.channel,
        policySnapshot: row.policySnapshot,
        policyId: row.policyId,
        idempotencyKey: row.idempotencyKey,
        correlationId: row.correlationId,
        status: "queued",
        model: null,
        provider: null,
        cost: null,
        attempt: 0,
        failureClass: null,
        failureMessage: null,
        priorArtifactId: row.priorArtifactId ?? null,
        rejectionReason: row.rejectionReason ?? null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(),
      };
      jobs.set(id, job);
      return { job, created: true };
    },
    async getGenerationJob(id: number) {
      return jobs.get(id);
    },
    async markGenerationRunning(id: number) {
      const j = jobs.get(id);
      if (j) {
        j.status = "running";
        j.attempt += 1;
      }
      return j;
    },
    async markGenerationSucceeded(id: number, meta: any) {
      const j = jobs.get(id);
      if (j) {
        j.status = "succeeded";
        j.model = meta.model;
        j.provider = meta.provider;
      }
      return j;
    },
    async markGenerationFailed(id: number, failureClass: string, message: string) {
      const j = jobs.get(id);
      if (j) {
        j.status = "failed";
        j.failureClass = failureClass;
        j.failureMessage = message;
      }
      return j;
    },
    async insertArtifact(row: InsertArtifactRow): Promise<Artifact> {
      const id = nextId();
      const artifact: Artifact = {
        id,
        userId: row.userId ?? null,
        generationJobId: row.generationJobId,
        opportunityId: row.opportunityId,
        format: row.format,
        channel: row.channel,
        payload: row.payload,
        readiness: row.readiness,
        approvedAt: null,
        supersedesId: row.supersedesId,
        provenance: row.provenance,
        attribution: row.attribution,
        attributionReason: row.attributionReason,
        createdAt: new Date(),
      };
      artifacts.set(id, artifact);
      return artifact;
    },
    async getArtifact(id: number) {
      return artifacts.get(id);
    },
    async getArtifactByGenerationJob(jobId: number) {
      return Array.from(artifacts.values()).find((a) => a.generationJobId === jobId);
    },
    async listArtifactsByOpportunity(oppId: number) {
      return Array.from(artifacts.values()).filter((a) => a.opportunityId === oppId);
    },
  } as unknown as ContentStoragePort;

  return {
    researchJob,
    evidenceRows,
    storyStorage,
    contentStorage,
    getResearchReadCount: () => researchReadCount,
    researchPort: {
      async getJob(id: number) {
        researchReadCount += 1;
        return id === researchJob.id ? researchJob : undefined;
      },
      async listEvidenceIds(id: number) {
        return id === researchJob.id ? evidenceRows.map((e) => e.id) : [];
      },
    },
  };
}

describe("multi-format reuse vertical slice (INC-06 + INC-07)", () => {
  it("produces both an X post and a Threads post from ONE ResearchJob + Story with zero re-research and preserved provenance", async () => {
    const h = createInMemoryMultiFormatHarness();

    const brief = await synthesizeStructuredBrief({
      topic: "Apache Iceberg v3 deletion vectors",
      evidence: h.evidenceRows.map((e) => ({
        id: e.id,
        text: e.excerpt,
        title: e.title,
        provider: e.provider,
        canonicalUrl: e.canonicalUrl,
      })),
    });

    const story = await createStoryFromResearch(
      h.researchJob.id,
      {
        title: "Apache Iceberg v3 deletion vectors",
        insightBody: brief.markdown,
        angles: brief.brief.angles,
        evidenceRefs: [501, 502],
        provenance: "researched",
        status: "ready",
      },
      { stories: h.storyStorage, research: h.researchPort },
    );

    const readsAfterStory = h.getResearchReadCount();
    assert.equal(readsAfterStory, 1, "research job read once during Story creation");

    const xOpp = await createOpportunityFromStory(
      story.id,
      {
        concept: "Concise X breakdown of Iceberg v3 deletion vectors",
        objective: "educate data engineers",
        format: "x_post",
        channel: "x",
      },
      { opportunities: h.contentStorage, stories: h.storyStorage },
    );

    const threadsOpp = await createOpportunityFromStory(
      story.id,
      {
        concept: "Expanded Threads post on Iceberg v3 deletion vectors and compaction",
        objective: "educate data engineers",
        format: "x_post",
        channel: "threads",
      },
      { opportunities: h.contentStorage, stories: h.storyStorage },
    );

    const deps: GenerationDeps = {
      content: h.contentStorage,
      stories: h.storyStorage,
      evidence: {
        async listEvidence(jobId: number) {
          assert.equal(jobId, h.researchJob.id);
          return h.evidenceRows.map((e) => ({ id: e.id, excerpt: e.excerpt, kind: e.kind }));
        },
      },
      defaultModel: "test-model",
      model: {
        provider: "test-provider",
        async generate(req) {
          if (req.channel === "x") {
            // Deliberately >280 chars to verify word-safe X budget fitting in generation.ts!
            return {
              payload: {
                text:
                  "Apache Iceberg v3 deletion vectors cut CDC read amplification by 3.5x in 2026 benchmarks without rewriting full Parquet data files. " +
                  "Teams running heavy upsert pipelines no longer pay the positional-delete scan penalty, though small-file compaction still needs hourly attention on bursty streams and extra careful monitoring across partitions.",
              },
              claims: [
                {
                  unitIndex: 0,
                  claimText: "Apache Iceberg v3 deletion vectors cut CDC read amplification by 3.5x in 2026 benchmarks.",
                  evidenceIds: [501],
                  status: "supported",
                },
              ],
              model: "test-model",
              provider: "test-provider",
              cost: null,
              usage: {},
            };
          }
          // Threads supports up to 500 chars and must NOT be truncated to 280!
          return {
            payload: {
              text:
                "Apache Iceberg v3 deletion vectors cut CDC read amplification by 3.5x in 2026 benchmarks without rewriting every Parquet file on each update. " +
                "That removes one of the biggest operational headaches for streaming table ingestion, while operators still note that hourly small-file compaction tuning remains important when write volume spikes across partitions.",
            },
            claims: [
              {
                unitIndex: 0,
                claimText: "Apache Iceberg v3 deletion vectors cut CDC read amplification by 3.5x in 2026 benchmarks.",
                evidenceIds: [501],
                status: "supported",
              },
            ],
            model: "test-model",
            provider: "test-provider",
            cost: null,
            usage: {},
          };
        },
      },
    };

    const { job: xJob } = await createGenerationJob(xOpp.id, {}, deps);
    const { job: threadsJob } = await createGenerationJob(threadsOpp.id, {}, deps);

    const xRun = await runGenerationJob(xJob.id, deps);
    const threadsRun = await runGenerationJob(threadsJob.id, deps);

    assert.equal(xRun.status, "succeeded");
    assert.equal(threadsRun.status, "succeeded");
    assert.equal(h.getResearchReadCount(), readsAfterStory, "zero re-research during multi-format generation");

    const xArtifact = (await h.contentStorage.getArtifact(xRun.artifactId!))!;
    const threadsArtifact = (await h.contentStorage.getArtifact(threadsRun.artifactId!))!;

    const xText = String(xArtifact.payload.text);
    const threadsText = String(threadsArtifact.payload.text);

    // X artifact fitted cleanly under 280 chars (Wave-1 Medium #1)
    assert.equal(validateXText([xText]).ok, true);
    assert.ok(xText.length <= 280);

    // Threads artifact kept its full >280 <=500 text without X truncation
    assert.ok(threadsText.length > 280 && threadsText.length <= 500);

    // Both artifacts preserve full claim_evidence_v1 provenance pointing to ResearchJob 77 and evidence [501, 502]
    for (const art of [xArtifact, threadsArtifact]) {
      assert.equal(art.attribution.length, 1);
      const attr = art.attribution[0] as any;
      assert.equal(attr.kind, "claim_evidence_v1");
      assert.equal(attr.researchJobId, 77);
      assert.deepEqual(attr.evidenceIds, [501, 502]);
      assert.equal(attr.unsupportedCount, 0);
    }
  });

  it("unwrapModelOutput supports both { payload, claims } and legacy bare { text } / { units }", () => {
    const bare = unwrapModelOutput({ text: "Hello world" });
    assert.deepEqual(bare, { payload: { text: "Hello world" } });

    const wrapped = unwrapModelOutput({
      payload: { units: ["First unit", "Second unit"] },
      claims: [{ unitIndex: 0, claimText: "First unit", evidenceIds: [12], status: "supported" }],
    });
    assert.deepEqual(wrapped.payload, { units: ["First unit", "Second unit"] });
    assert.equal(wrapped.claims?.length, 1);
    assert.deepEqual(wrapped.claims?.[0].evidenceIds, [12]);
  });
});
