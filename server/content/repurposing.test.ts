/**
 * Unit tests for Story → Opportunity[N] repurposing.
 *
 * In-memory ports only — DB-backed proof (no-research, distinct
 * GenerationPolicies per target, restart recovery) lives in
 * `repurposing.dbtest.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ContentTemplate,
  GenerationJob,
  GenerationPolicy,
  Opportunity,
  Story,
  Voice,
} from "@shared/schema";
import {
  repurposeStory,
  RepurposeInputError,
  expandRepurposeTargets,
  repurposeKeyFor,
  aggregatePlanStatus,
  progressFromOutcomes,
  normalizeAngle,
  resolveRepurposeLimits,
  MAX_OPPORTUNITIES_PER_PLAN,
  type RepurposeDeps,
  type RepurposeTargetOutcome,
} from "./repurposing";
import { StoryNotFoundError, StoryNotUsableError, type OpportunityDeps } from "./opportunity";
import type { ContentStoragePort, InsertGenerationJobRow, InsertPolicyRow } from "./storage";
import type { GenerationDeps } from "./generation";
import { registerBuiltinChannelAdapters } from "./adapters";

// The adapter registry is the single authority for (format, channel) validity.
registerBuiltinChannelAdapters();

let seq = 0;
const next = () => ++seq;

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: next(),
    userId: 1,
    researchJobId: 1,
    provenance: "researched",
    title: "A new developer tool changes how teams ship AI agents",
    insightBody: "Shipping agents is now a platform decision, not a library choice.",
    interpretationMarked: true,
    angles: ["platform teams own the agent runtime"],
    evidenceRefs: [1, 2],
    status: "ready",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Minimal in-memory ContentStoragePort covering everything repurposeStory touches. */
function memoryStore() {
  const opps: Opportunity[] = [];
  const jobs: GenerationJob[] = [];
  const policies: GenerationPolicy[] = [];
  const researchJobCreations: unknown[] = [];
  const providerCalls: unknown[] = [];

  const store = {
    opps,
    jobs,
    policies,
    researchJobCreations,
    providerCalls,

    async insertOpportunity(row: Record<string, unknown>): Promise<Opportunity> {
      if (row.repurposeKey && opps.some((o) => o.repurposeKey === row.repurposeKey)) {
        throw new Error('duplicate key value violates unique constraint "opportunities_repurpose_key_uq"');
      }
      const o = {
        id: next(),
        userId: 1,
        storyId: 0,
        concept: "c",
        objective: "o",
        audience: null,
        angle: null,
        format: "x_post",
        channel: "x",
        status: "proposed",
        score: null,
        scoreBreakdown: {},
        proposer: "human",
        chatKey: null,
        repurposeKey: null,
        killReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      } as Opportunity;
      opps.push(o);
      return o;
    },
    async getOpportunity(id: number) {
      return opps.find((o) => o.id === id);
    },
    async getOpportunityByChatKey(chatKey: string) {
      return opps.find((o) => o.chatKey === chatKey);
    },
    async getOpportunityByRepurposeKey(repurposeKey: string) {
      return opps.find((o) => o.repurposeKey === repurposeKey);
    },
    async listOpportunitiesByStory(storyId: number) {
      return opps.filter((o) => o.storyId === storyId);
    },
    async updateOpportunityStatus(id: number, status: string, killReason: string | null) {
      const o = opps.find((x) => x.id === id);
      if (!o) return undefined;
      o.status = status as Opportunity["status"];
      o.killReason = killReason;
      return o;
    },

    async getVoice(_id: number): Promise<Voice | undefined> {
      return undefined;
    },
    async getContentTemplate(_id: number): Promise<ContentTemplate | undefined> {
      return undefined;
    },
    async findOrCreateGenerationPolicy(row: InsertPolicyRow) {
      const existing = policies.find((p) => p.specHash === row.specHash);
      if (existing) return { policy: existing, created: false };
      const policy = { id: next(), status: "active", createdAt: new Date(), ...row } as GenerationPolicy;
      policies.push(policy);
      return { policy, created: true };
    },
    async getGenerationPolicyBySpecHash(specHash: string) {
      return policies.find((p) => p.specHash === specHash);
    },
    async nextPolicyVersion(_policyKey: string) {
      return 1;
    },

    async claimGenerationJob(row: InsertGenerationJobRow) {
      const existing = jobs.find((j) => j.idempotencyKey === row.idempotencyKey);
      if (existing) return { job: existing, created: false };
      const job = {
        id: next(),
        status: "queued",
        attempt: 1,
        attempts: [],
        model: null,
        provider: null,
        cost: null,
        errorClass: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(),
        ...row,
      } as GenerationJob;
      jobs.push(job);
      return { job, created: true };
    },
    async getGenerationJob(id: number) {
      return jobs.find((j) => j.id === id);
    },
    async getLatestGenerationJobForOpportunity(opportunityId: number) {
      const forOpp = jobs.filter((j) => j.opportunityId === opportunityId);
      return forOpp[forOpp.length - 1];
    },
    async listArtifactsByOpportunity(_opportunityId: number) {
      return [];
    },
  };

  return store as unknown as ContentStoragePort & typeof store;
}

const storyPort = (stories: Story[]) => ({
  async getStory(id: number) {
    return stories.find((s) => s.id === id);
  },
  async updateStoryStatus(id: number, status: string) {
    const s = stories.find((x) => x.id === id);
    if (s) s.status = status as Story["status"];
    return s;
  },
});

function harness(stories: Story[]) {
  const content = memoryStore();
  const stories_ = storyPort(stories);
  const opportunities: OpportunityDeps = { opportunities: content, stories: stories_ };
  const generation: GenerationDeps = {
    content,
    stories: stories_,
    evidence: {
      async listEvidence(_researchJobId: number) {
        return [{ id: 1, excerpt: "evidence excerpt", kind: "quote" }];
      },
    },
    model: {
      provider: "unused-in-repurposeStory",
      async generate() {
        throw new Error("repurposeStory must never invoke the model — that is the worker's job");
      },
    },
    defaultModel: "m1",
  };
  const deps: RepurposeDeps = { opportunities, generation };
  return { content, deps, opportunities };
}

describe("repurposeStory", () => {
  it("creates N independently addressable Opportunities from ONE Story, each with a queued GenerationJob", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);

    const result = await repurposeStory(
      s.id,
      {
        targets: [
          { format: "x_post", channel: "x" },
          { format: "x_thread", channel: "x" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      },
      deps,
      1,
    );

    assert.equal(result.outcomes.length, 3);
    assert.ok(result.outcomes.every((o) => o.status === "created"));
    const opportunityIds = result.outcomes.map((o) => o.opportunity?.id);
    assert.equal(new Set(opportunityIds).size, 3, "three distinct Opportunities");
    for (const o of result.outcomes) {
      assert.equal(o.opportunity?.storyId, s.id, "every Opportunity carries Story lineage");
      assert.ok(o.job, "generate defaults to true");
      assert.equal(o.job?.opportunityId, o.opportunity?.id);
    }
    assert.equal(content.opps.length, 3);
    assert.equal(content.jobs.length, 3);
  });

  it("rejects a foreign Story with the same error a missing Story produces (non-leaking ownership)", async () => {
    const s = makeStory({ userId: 42 });
    const { deps } = harness([s]);

    await assert.rejects(
      () => repurposeStory(s.id, { targets: [{ format: "x_post", channel: "x" }] }, deps, 1),
      StoryNotFoundError,
    );
    await assert.rejects(
      () => repurposeStory(999_999, { targets: [{ format: "x_post", channel: "x" }] }, deps, 1),
      StoryNotFoundError,
    );
  });

  it("rejects an archived Story and empty target lists", async () => {
    const s = makeStory({ status: "archived" });
    const { deps } = harness([s]);

    await assert.rejects(
      () => repurposeStory(s.id, { targets: [{ format: "x_post", channel: "x" }] }, deps, 1),
      StoryNotUsableError,
    );
    await assert.rejects(() => repurposeStory(s.id, { targets: [] }, deps, 1), RepurposeInputError);
  });

  it("partial success: an invalid target never rolls back its valid siblings", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);

    const result = await repurposeStory(
      s.id,
      {
        targets: [
          { format: "x_post", channel: "x" },
          { format: "x_post", channel: "some_unregistered_channel" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      },
      deps,
      1,
    );

    assert.equal(result.outcomes[0].status, "created");
    assert.equal(result.outcomes[1].status, "invalid");
    assert.match(result.outcomes[1].error ?? "", /no registered adapter/);
    assert.equal(result.outcomes[2].status, "created");
    assert.equal(content.opps.length, 2, "the invalid target created nothing");
  });

  it("registry-driven capability check: an unregistered format is refused, not a hand-maintained allowlist", async () => {
    const s = makeStory();
    const { deps } = harness([s]);

    const result = await repurposeStory(
      s.id,
      { targets: [{ format: "totally_invented_format", channel: "x" }] },
      deps,
      1,
    );
    assert.equal(result.outcomes[0].status, "invalid");
    assert.match(result.outcomes[0].error ?? "", /does not support it/);
  });

  it("duplicate delivery of the same batch collapses to the SAME logical Opportunities (no siblings)", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);
    const request = {
      requestKey: "client-retry-abc",
      targets: [
        { format: "x_post", channel: "x" },
        { format: "linkedin_post", channel: "linkedin" },
      ],
    };

    const first = await repurposeStory(s.id, request, deps, 1);
    const second = await repurposeStory(s.id, request, deps, 1);

    assert.ok(first.outcomes.every((o) => o.status === "created"));
    assert.ok(second.outcomes.every((o) => o.status === "reused"));
    assert.deepEqual(
      second.outcomes.map((o) => o.opportunity?.id),
      first.outcomes.map((o) => o.opportunity?.id),
    );
    assert.equal(content.opps.length, 2, "duplicate delivery created nothing new");
  });

  it("intentional new derivation (regenerate) creates a NEW Opportunity even with the same requestKey", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);
    const requestKey = "client-retry-abc";

    const first = await repurposeStory(
      s.id,
      { requestKey, targets: [{ format: "x_post", channel: "x" }] },
      deps,
      1,
    );
    const second = await repurposeStory(
      s.id,
      { requestKey, targets: [{ format: "x_post", channel: "x", regenerate: true }] },
      deps,
      1,
    );

    assert.equal(first.outcomes[0].status, "created");
    assert.equal(second.outcomes[0].status, "created", "regenerate bypasses reuse-by-key");
    assert.notEqual(second.outcomes[0].opportunity?.id, first.outcomes[0].opportunity?.id);
    assert.equal(content.opps.length, 2);

    // The base key is still reusable for a THIRD, ordinary duplicate delivery —
    // regenerate never poisons the ability to keep deduplicating normally.
    const third = await repurposeStory(
      s.id,
      { requestKey, targets: [{ format: "x_post", channel: "x" }] },
      deps,
      1,
    );
    assert.equal(third.outcomes[0].status, "reused");
    assert.equal(third.outcomes[0].opportunity?.id, first.outcomes[0].opportunity?.id);
  });

  it("target-specific GenerationPolicy: different formats/channels never share a policy identity", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);

    const result = await repurposeStory(
      s.id,
      {
        targets: [
          { format: "x_post", channel: "x" },
          { format: "x_thread", channel: "x" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      },
      deps,
      1,
    );

    const policyIds = result.outcomes.map((o) => o.job?.policyId);
    assert.equal(new Set(policyIds).size, 3, "three distinct GenerationPolicy revisions");
    assert.equal(content.policies.length, 3);
  });

  it("generate: false creates the Opportunity only — no GenerationJob for that target", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);

    const result = await repurposeStory(
      s.id,
      { targets: [{ format: "x_post", channel: "x", generate: false }] },
      deps,
      1,
    );

    assert.equal(result.outcomes[0].status, "created");
    assert.ok(result.outcomes[0].opportunity);
    assert.equal(result.outcomes[0].job, undefined);
    assert.equal(content.jobs.length, 0);
  });

  it("independent siblings: killing one repurposed Opportunity never touches another", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);

    const result = await repurposeStory(
      s.id,
      {
        targets: [
          { format: "x_post", channel: "x" },
          { format: "linkedin_post", channel: "linkedin" },
        ],
      },
      deps,
      1,
    );

    const [xOpp, liOpp] = result.outcomes.map((o) => o.opportunity!);
    await deps.opportunities.opportunities.updateOpportunityStatus(xOpp.id, "killed", "no longer relevant");

    const reloadedX = content.opps.find((o) => o.id === xOpp.id)!;
    const reloadedLi = content.opps.find((o) => o.id === liOpp.id)!;
    assert.equal(reloadedX.status, "killed");
    assert.equal(reloadedLi.status, "proposed", "sibling untouched");
  });

  it("never touches ResearchJob or a SourceProvider — only reads the Story's existing evidence", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);

    await repurposeStory(
      s.id,
      {
        targets: [
          { format: "x_post", channel: "x" },
          { format: "x_thread", channel: "x" },
        ],
      },
      deps,
      1,
    );

    assert.equal(content.researchJobCreations.length, 0);
    assert.equal(content.providerCalls.length, 0);
  });

  it("expands count into distinct slot identities, not one Opportunity with N posts", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);
    const result = await repurposeStory(
      s.id,
      { requestKey: "batch-a", targets: [{ format: "x_post", channel: "x", count: 3 }] },
      deps,
      1,
    );
    assert.equal(result.outcomes.length, 3);
    assert.deepEqual(
      result.outcomes.map((o) => o.slot),
      [1, 2, 3],
    );
    assert.equal(new Set(result.outcomes.map((o) => o.opportunity?.id)).size, 3);
    assert.equal(content.opps[0].repurposeKey, `repurpose:${s.id}:batch-a:x_post:x`);
    assert.equal(content.opps[1].repurposeKey, `repurpose:${s.id}:batch-a:x_post:x:s2`);
    assert.equal(content.opps[2].repurposeKey, `repurpose:${s.id}:batch-a:x_post:x:s3`);
  });

  it("duplicate count expansion with the same requestKey collapses to the same slots", async () => {
    const s = makeStory();
    const { deps, content } = harness([s]);
    const request = { requestKey: "batch-a", targets: [{ format: "x_post", channel: "x", count: 3 }] };
    const first = await repurposeStory(s.id, request, deps, 1);
    const second = await repurposeStory(s.id, request, deps, 1);
    assert.ok(second.outcomes.every((o) => o.status === "reused"));
    assert.deepEqual(
      second.outcomes.map((o) => o.opportunity?.id),
      first.outcomes.map((o) => o.opportunity?.id),
    );
    assert.equal(content.opps.length, 3);
  });

  it("rejects an over-limit expansion instead of silently creating a storm", async () => {
    const s = makeStory();
    const { deps } = harness([s]);
    await assert.rejects(
      () =>
        repurposeStory(
          s.id,
          { targets: [{ format: "x_post", channel: "x", count: 3 }], limits: { maxOpportunities: 2 } },
          deps,
          1,
        ),
      RepurposeInputError,
    );
  });
});

describe("repurpose target expansion", () => {
  it("accumulates slots across duplicate format×channel targets", () => {
    const { slots } = expandRepurposeTargets(9, "rk", [
      { format: "x_post", channel: "x", angle: "what happened" },
      { format: "x_post", channel: "x", angle: "why it matters" },
    ]);
    assert.equal(slots.length, 2);
    assert.equal(slots[0].slot, 1);
    assert.equal(slots[1].slot, 2);
    assert.equal(slots[0].repurposeKey, "repurpose:9:rk:x_post:x");
    assert.equal(slots[1].repurposeKey, "repurpose:9:rk:x_post:x:s2");
  });

  it("slot 1 preserves the Phase 12 key", () => {
    assert.equal(repurposeKeyFor(1, "r", "x_post", "x"), "repurpose:1:r:x_post:x");
    assert.equal(repurposeKeyFor(1, "r", "x_post", "x", 2), "repurpose:1:r:x_post:x:s2");
  });

  it("normalizes angles for structured distinctness", () => {
    assert.equal(normalizeAngle("  Why It Matters  "), "why it matters");
    assert.equal(normalizeAngle("   "), null);
  });

  it("caps configured limits at the system ceiling", () => {
    const limits = resolveRepurposeLimits({ maxOpportunities: 10_000 });
    assert.equal(limits.maxOpportunities, MAX_OPPORTUNITIES_PER_PLAN);
  });

  it("aggregates partial vs completed vs failed honestly", () => {
    const partial: RepurposeTargetOutcome[] = [
      { format: "x_post", channel: "x", slot: 1, status: "created", job: { status: "succeeded" } as never },
      { format: "x_post", channel: "x", slot: 2, status: "invalid", error: "nope" },
    ];
    assert.equal(aggregatePlanStatus("running", progressFromOutcomes(partial)), "partial");
    const queued: RepurposeTargetOutcome[] = [
      { format: "x_post", channel: "x", slot: 1, status: "created", job: { status: "queued" } as never },
    ];
    assert.equal(aggregatePlanStatus("queued", progressFromOutcomes(queued)), "running");
    assert.equal(aggregatePlanStatus("cancelled", progressFromOutcomes(queued)), "cancelled");
  });
});
