/**
 * Unit tests for the core content lifecycle boundaries.
 *
 * These exercise the domain decisions (readiness transitions, frozen policy,
 * durable identity keys, adapter classification, publication outcome rules)
 * against in-memory ports. DB-backed behaviour lives in `content.dbtest.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Artifact,
  GenerationJob,
  Opportunity,
  Publication,
  Schedule,
  ScheduleOccurrence,
  Story,
} from "@shared/schema";
import type { ContentStoragePort, InsertArtifactRow } from "./storage";
import {
  createOpportunityFromStory,
  killOpportunity,
  selectOpportunity,
  formatChannelError,
  InvalidOpportunityInputError,
  StoryNotUsableError,
} from "./opportunity";
import { generationIdempotencyKey } from "./generation";
import {
  assembleEffectiveRequest,
  canonicalJson,
  policySpecHash,
  resolveGenerationPolicy,
  voiceContentHash,
  PolicyInputError,
  type PolicySpec,
} from "./policy";
import { getFormatProfile, hasFormatProfile } from "./formatProfiles";
import { EMPTY_CONTEXT_ASSEMBLY } from "./context";
import {
  approveArtifact,
  createArtifact,
  rejectArtifact,
  submitArtifactForReview,
  ArtifactMediaReferenceError,
  InvalidArtifactPayloadError,
  ArtifactStateError,
} from "./artifact";
import { publicationIdempotencyKey } from "./scheduling";
import {
  channelSupportsFormat,
  classifyLinkedInFailure,
  classifyThreadsFailure,
  classifyInstagramFailure,
  classifyXFailure,
  createLinkedInChannelAdapter,
  createThreadsChannelAdapter,
  createInstagramChannelAdapter,
  createXChannelAdapter,
  registerBuiltinChannelAdapters,
} from "./adapters";
import {
  MediaResolutionError,
  resolvePublicationMedia,
  runPublication,
  type PublicationDeps,
} from "./publication";

// The adapter registry is the single authority for (format, channel) validity,
// so the domain tests must run with the built-in adapters registered.
registerBuiltinChannelAdapters();

// ── builders ──────────────────────────────────────────────────────────────────
let seq = 0;
const next = () => ++seq;

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: next(),
    userId: 1,
    researchJobId: 1,
    provenance: "researched",
    title: "Kubernetes scheduling",
    insightBody: "Scheduler plugins became a stable extension point.",
    interpretationMarked: true,
    angles: ["platform teams own placement"],
    evidenceRefs: [1, 2],
    status: "ready",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: next(),
    userId: 1,
    storyId: 1,
    concept: "explain the shift",
    objective: "educate platform engineers",
    audience: "platform teams",
    angle: "placement is now policy",
    format: "x_post",
    channel: "x",
    status: "proposed",
    score: null,
    scoreBreakdown: {},
    proposer: "human",
    killReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Minimal in-memory store covering the surfaces these unit tests touch. */
function memoryStore() {
  const opps: Opportunity[] = [];
  const arts: Artifact[] = [];
  const pubs: Publication[] = [];
  const results: unknown[] = [];

  const store = {
    opps,
    arts,
    pubs,
    results,
    async insertOpportunity(row: Record<string, unknown>): Promise<Opportunity> {
      const o = { ...opportunity(), ...row, id: next() } as Opportunity;
      opps.push(o);
      return o;
    },
    async getOpportunity(id: number) {
      return opps.find((o) => o.id === id);
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
    async insertArtifact(row: InsertArtifactRow): Promise<Artifact> {
      const a = { ...row, id: next(), approvedAt: null, createdAt: new Date() } as unknown as Artifact;
      arts.push(a);
      return a;
    },
    async getArtifact(id: number) {
      return arts.find((a) => a.id === id);
    },
    async getArtifactByGenerationJob(generationJobId: number) {
      return arts.find((a) => a.generationJobId === generationJobId);
    },
    async setArtifactReadiness(id: number, readiness: string, approvedAt: Date | null) {
      const a = arts.find((x) => x.id === id);
      if (!a) return undefined;
      a.readiness = readiness as Artifact["readiness"];
      a.approvedAt = approvedAt;
      return a;
    },
    async getPublication(id: number) {
      return pubs.find((p) => p.id === id);
    },
    async insertResult(row: Record<string, unknown>) {
      results.push(row);
      return row;
    },
    async markOccurrenceStatus() {},
    async getSchedule() {
      return undefined as Schedule | undefined;
    },
    async setScheduleStatus() {},
    async updatePublication(id: number, patch: Record<string, unknown>) {
      const p = pubs.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    },
    async listStalePublishing() {
      return [] as Publication[];
    },
  };

  return store as unknown as ContentStoragePort & typeof store;
}

const storyPort = (s: Story | undefined) => ({
  async getStory() {
    return s;
  },
  async updateStoryStatus(_id: number, status: string) {
    if (s) s.status = status as Story["status"];
    return s;
  },
});

// ── Opportunity ───────────────────────────────────────────────────────────────
describe("opportunity boundary", () => {
  it("creates an Opportunity from a Story without touching research or providers", async () => {
    const store = memoryStore();
    const s = story();
    const created = await createOpportunityFromStory(
      s.id,
      { concept: "c", objective: "o", format: "x_post", channel: "x" },
      { opportunities: store, stories: storyPort(s) },
    );
    assert.equal(created.status, "proposed");
    assert.equal(created.storyId, s.id);
    assert.equal(created.format, "x_post");
    assert.equal(created.channel, "x");
    // The deps surface has no evidence, queue, or provider reachable at all.
    assert.deepEqual(Object.keys({ opportunities: store, stories: storyPort(s) }).sort(), [
      "opportunities",
      "stories",
    ]);
  });

  it("allows many Opportunities per Story and leaves the Story reusable", async () => {
    const store = memoryStore();
    const s = story();
    const deps = { opportunities: store, stories: storyPort(s) };
    await createOpportunityFromStory(s.id, { concept: "a", objective: "o", format: "x_post", channel: "x" }, deps);
    await createOpportunityFromStory(s.id, { concept: "b", objective: "o", format: "x_thread", channel: "x" }, deps);
    assert.equal((await store.listOpportunitiesByStory(s.id)).length, 2);
    assert.equal(s.status, "ready", "the Story is untouched by Opportunity creation");
  });

  it("rejects an archived Story and a missing Story", async () => {
    const store = memoryStore();
    await assert.rejects(
      () =>
        createOpportunityFromStory(
          1,
          { concept: "c", objective: "o", format: "x_post", channel: "x" },
          { opportunities: store, stories: storyPort(story({ status: "archived" })) },
        ),
      StoryNotUsableError,
    );
    await assert.rejects(
      () =>
        createOpportunityFromStory(
          1,
          { concept: "c", objective: "o", format: "x_post", channel: "x" },
          { opportunities: store, stories: storyPort(undefined) },
        ),
      /not found/,
    );
  });

  it("rejects a nonsense format × channel pair", async () => {
    assert.equal(formatChannelError("x_post", "x"), null);
    // The registered adapter is the single source of truth; a pair no adapter
    // supports is rejected, not silently allowed.
    assert.match(String(formatChannelError("video_script", "video_factory")), /no registered adapter/);
    assert.match(String(formatChannelError("x_post", "linkedin")), /cannot target channel/);
    assert.equal(formatChannelError("image", "x"), null, "X now supports the single-image format");
    assert.equal(formatChannelError("x_post", "threads"), null, "Threads text uses the x_post payload");
    assert.match(String(formatChannelError("carousel", "x")), /cannot target channel/, "carousel delivery is deferred");

    const store = memoryStore();
    await assert.rejects(
      () =>
        createOpportunityFromStory(
          1,
          { concept: "c", objective: "o", format: "x_post", channel: "linkedin" },
          { opportunities: store, stories: storyPort(story()) },
        ),
      InvalidOpportunityInputError,
    );
  });

  it("select marks the Story used; kill is terminal and requires a reason", async () => {
    const store = memoryStore();
    const s = story();
    const deps = { opportunities: store, stories: storyPort(s) };
    const o = await createOpportunityFromStory(
      s.id,
      { concept: "c", objective: "o", format: "x_post", channel: "x" },
      deps,
    );

    const selected = await selectOpportunity(o.id, deps);
    assert.equal(selected.status, "selected");
    assert.equal(s.status, "used", "selecting an Opportunity marks the Story used (informational)");

    await assert.rejects(() => selectOpportunity(o.id, deps), /cannot be selected/);
    const killed = await killOpportunity(o.id, "off-brand", deps);
    assert.equal(killed.status, "killed");
    assert.equal(killed.killReason, "off-brand");
    await assert.rejects(() => killOpportunity(o.id, "again", deps), /cannot be killed/);
    await assert.rejects(() => killOpportunity(o.id, "  ", deps), InvalidOpportunityInputError);
  });
});

// ── Generation policy ─────────────────────────────────────────────────────────
describe("generation policy", () => {
  const spec = (over: Partial<PolicySpec> = {}): PolicySpec => ({
    format: "x_post",
    channel: "x",
    formatPolicyRef: "x_post@1",
    voiceId: null,
    voiceHash: "none",
    templateId: null,
    templateHash: "none",
    objective: "o",
    audience: null,
    constraints: { maxCharacters: 280 },
    model: "m1",
    ...over,
  });

  it("hashes the canonical spec deterministically and order-independently", () => {
    assert.equal(policySpecHash(spec()), policySpecHash(spec()));
    assert.equal(
      policySpecHash(spec({ constraints: { a: 1, b: 2 } })),
      policySpecHash(spec({ constraints: { b: 2, a: 1 } })),
      "key order must not change the hash",
    );
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it("changes the spec hash when the voice or template content changes", () => {
    const base = spec();
    assert.notEqual(
      policySpecHash(base),
      policySpecHash(spec({ voiceId: 7, voiceHash: voiceContentHash({ id: 7, name: "v", tone: "direct" } as never) })),
    );
    assert.notEqual(
      policySpecHash(base),
      policySpecHash(spec({ templateId: 3, templateHash: "abc" })),
    );
  });

  it("distinguishes duplicate delivery from intentional regeneration", () => {
    const h = "a".repeat(64);
    assert.equal(generationIdempotencyKey(5, h), generationIdempotencyKey(5, h), "duplicate collapses");
    assert.notEqual(
      generationIdempotencyKey(5, h),
      generationIdempotencyKey(5, h, "regen-uuid"),
      "an explicit regeneration nonce produces a distinct job",
    );
  });

  it("resolves a policy to an immutable, content-addressed revision", async () => {
    const created: Record<string, unknown>[] = [];
    const content = {
      getVoice: async () => ({ id: 1, name: "Direct", tone: "technical", vocabulary: [], sentenceStyle: null, formatting: {}, doRules: ["be concrete"], dontRules: [], examples: [], status: "active" }),
      getContentTemplate: async () => undefined,
      listGenerationPolicies: async () => created as never,
      getGenerationPolicyBySpecHash: async (hash: string) =>
        (created as Array<Record<string, unknown>>).find((p) => p.specHash === hash) as never,
      nextPolicyVersion: async () => created.length + 1,
      findOrCreateGenerationPolicy: async (row: Record<string, unknown>) => {
        const policy = { ...row, id: created.length + 1 };
        created.push(policy);
        return { policy: policy as never, created: true };
      },
    } as never;

    const first = await resolveGenerationPolicy(
      { format: "x_post", channel: "x", voiceId: 1, model: "m1" },
      { content },
    );
    assert.equal(first.created, true);
    assert.equal(first.policy.version, 1);
    assert.equal(first.voice?.name, "Direct");
    assert.equal(first.profile.format, "x_post");
    // A different voice produces a different spec hash → a new revision.
    const second = await resolveGenerationPolicy(
      { format: "x_post", channel: "x", model: "m1" },
      { content },
    );
    assert.notEqual(second.specHash, first.specHash);
  });

  it("rejects formats without a payload schema or a format profile", async () => {
    const content = { listGenerationPolicies: async () => [] } as never;
    await assert.rejects(
      () => resolveGenerationPolicy({ format: "video_script", channel: "video_factory" }, { content }),
      PolicyInputError,
    );
    await assert.rejects(
      () => resolveGenerationPolicy({ format: "x_post", channel: "linkedin" }, { content }),
      PolicyInputError,
    );
  });

  it("assembles a deterministic effective request carrying policy + voice + template + platform rules", () => {
    const resolved = {
      policy: { id: 9, policyKey: "pol:x_post:x", version: 2, format: "x_post", channel: "x", constraints: { maxCharacters: 280 }, modelPreferences: { model: "m1" } },
      voice: { id: 1, name: "Direct", tone: "technical", vocabulary: [], sentenceStyle: null, formatting: {}, doRules: ["be concrete"], dontRules: ["no hype"], examples: [] },
      template: { id: 2, name: "Hook → Insight → Takeaway", description: null, structure: [{ name: "hook" }, { name: "insight" }, { name: "takeaway" }], variables: [], constraints: {}, instructions: "Keep it tight." },
      profile: getFormatProfile("x_post", "x")!,
      specHash: "a".repeat(64),
      created: false,
      context: EMPTY_CONTEXT_ASSEMBLY,
    } as never;
    const ctx = {
      story: { id: 1, title: "Scheduling", insightBody: "policy surface", angles: [] },
      opportunity: { id: 2, concept: "c", objective: "o", audience: null, angle: null },
      evidence: [{ id: 3, excerpt: "evidence text", kind: "excerpt" }],
    };

    const a = assembleEffectiveRequest(resolved, ctx, "m1");
    const b = assembleEffectiveRequest(resolved, ctx, "m1");
    assert.deepEqual(a, b, "assembly is deterministic");
    assert.equal(a.policyId, 9);
    assert.match(a.systemPrompt, /Platform guidance/);
    assert.match(a.systemPrompt, /be concrete/);
    assert.match(a.systemPrompt, /hook → insight → takeaway/);
    assert.match(a.userPrompt, /evidence text/);
    assert.equal(a.inputHashes.voice.length, 64);
    assert.equal(a.format, "x_post");
  });

  it("only supports formats that are genuinely implemented", () => {
    assert.equal(hasFormatProfile("x_post", "x"), true);
    assert.equal(hasFormatProfile("x_thread", "x"), true);
    assert.equal(hasFormatProfile("image", "x"), true);
    assert.equal(hasFormatProfile("carousel", "x"), true);
    assert.equal(hasFormatProfile("thumbnail", "x"), true);
    assert.equal(hasFormatProfile("linkedin_post", "linkedin"), true, "Phase 6: genuinely implemented");
    assert.equal(hasFormatProfile("video_script", "video_factory"), false, "no fake placeholders");
    assert.deepEqual(
      ["image", "carousel", "thumbnail"].map((f) => getFormatProfile(f, "x")?.constraints.visual),
      ["required", "required", "required"],
    );
  });
});

// ── Artifact + readiness ──────────────────────────────────────────────────────
describe("artifact boundary", () => {
  const base = {
    generationJobId: 9,
    opportunityId: 1,
    format: "x_post",
    channel: "x",
    attribution: [{ kind: "research_evidence", researchJobId: 1, evidenceIds: [1] }],
  };

  it("validates payloads through the registry and starts as draft", async () => {
    const store = memoryStore();
    const artifact = await createArtifact(
      { ...base, payload: { text: "hello" } },
      { artifacts: store },
    );
    assert.equal(artifact.readiness, "draft");
  });

  it("rejects a payload that does not match the registered format schema", async () => {
    const store = memoryStore();
    await assert.rejects(
      () => createArtifact({ ...base, payload: { units: [] } }, { artifacts: store }),
      InvalidArtifactPayloadError,
    );
    await assert.rejects(
      () => createArtifact({ ...base, format: "carousel", payload: {} }, { artifacts: store }),
      InvalidArtifactPayloadError,
    );
  });

  it("requires attribution (snippets or an explicit reason)", async () => {
    const store = memoryStore();
    await assert.rejects(
      () => createArtifact({ ...base, payload: { text: "x" }, attribution: [] }, { artifacts: store }),
      /attribution is mandatory/,
    );
    const ok = await createArtifact(
      { ...base, payload: { text: "x" }, attribution: [], attributionReason: "no evidence" },
      { artifacts: store },
    );
    assert.equal(ok.attributionReason, "no evidence");
  });

  it("enforces draft → in_review → approved | rejected", async () => {
    const store = memoryStore();
    const a = await createArtifact({ ...base, payload: { text: "x" } }, { artifacts: store });

    await assert.rejects(() => approveArtifact(a.id, { artifacts: store }), ArtifactStateError);
    const inReview = await submitArtifactForReview(a.id, { artifacts: store });
    assert.equal(inReview.readiness, "in_review");
    const approved = await approveArtifact(a.id, { artifacts: store });
    assert.equal(approved.readiness, "approved");
    assert.ok(approved.approvedAt, "approval is timestamped and pinned to this revision");
    await assert.rejects(() => rejectArtifact(a.id, { artifacts: store }), ArtifactStateError);
  });

  it("keeps rejection terminal for schedulability", async () => {
    const store = memoryStore();
    const a = await createArtifact({ ...base, payload: { text: "x" } }, { artifacts: store });
    await submitArtifactForReview(a.id, { artifacts: store });
    const rejected = await rejectArtifact(a.id, { artifacts: store });
    assert.equal(rejected.readiness, "rejected");
    await assert.rejects(() => approveArtifact(a.id, { artifacts: store }), ArtifactStateError);
  });

  it("approving revision N does not approve N+1", async () => {
    const store = memoryStore();
    const first = await createArtifact({ ...base, payload: { text: "v1" } }, { artifacts: store });
    await submitArtifactForReview(first.id, { artifacts: store });
    await approveArtifact(first.id, { artifacts: store });

    const second = await createArtifact(
      { ...base, payload: { text: "v2" }, supersedesId: first.id },
      { artifacts: store },
    );
    assert.equal(second.readiness, "draft", "a new revision starts unapproved");
  });
});

// ── image Artifact authoring (format-driven, same createArtifact) ──────────────
describe("image artifact authoring", () => {
  const base = {
    userId: 1,
    generationJobId: null,
    opportunityId: 1,
    format: "image",
    channel: "x",
    attributionReason: "generated image",
  };

  it("creates a draft image Artifact from a ready, owned VisualAsset and pins the exact revision", async () => {
    const store = memoryStore() as unknown as ContentStoragePort & {
      refs: unknown[];
    };
    (store as any).getVisualAsset = async (id: number) =>
      ({ id, userId: 1, status: "ready", mime: "image/png", storageKey: `local:${"a".repeat(64)}`, role: null, altText: null }) as never;
    (store as any).refs = [];
    (store as any).insertVisualAssetRef = async (row: Record<string, unknown>) => {
      (store as any).refs.push(row);
      return { id: 1, ...row } as never;
    };

    const artifact = await createArtifact(
      { ...base, payload: { visualAssetId: 42 } },
      { artifacts: store },
    );
    assert.equal(artifact.readiness, "draft");
    assert.equal((artifact.payload as { visualAssetId: number }).visualAssetId, 42);
    assert.deepEqual((store as any).refs.map((r: any) => r.visualAssetId), [42]);
  });

  it("rejects a nonexistent VisualAsset before creating any Artifact row", async () => {
    const store = memoryStore();
    (store as any).getVisualAsset = async () => undefined;
    await assert.rejects(
      () => createArtifact({ ...base, payload: { visualAssetId: 999 } }, { artifacts: store }),
      ArtifactMediaReferenceError,
    );
    assert.equal(store.arts.length, 0, "no partial Artifact row on invalid media reference");
  });

  it("rejects a VisualAsset owned by another user, same 404-shaped message as not-found", async () => {
    const store = memoryStore();
    (store as any).getVisualAsset = async (id: number) =>
      ({ id, userId: 2, status: "ready", mime: "image/png" }) as never;
    await assert.rejects(
      () => createArtifact({ ...base, payload: { visualAssetId: 42 } }, { artifacts: store }),
      (error: unknown) => error instanceof ArtifactMediaReferenceError && /not found/.test(error.message),
    );
    assert.equal(store.arts.length, 0);
  });

  it("rejects a VisualAsset that is not ready", async () => {
    const store = memoryStore();
    (store as any).getVisualAsset = async (id: number) =>
      ({ id, userId: 1, status: "processing", mime: "image/png" }) as never;
    await assert.rejects(
      () => createArtifact({ ...base, payload: { visualAssetId: 42 } }, { artifacts: store }),
      /not ready/,
    );
    assert.equal(store.arts.length, 0);
  });

  it("rejects a malformed image payload before touching any visual asset lookup", async () => {
    const store = memoryStore();
    let looked = false;
    (store as any).getVisualAsset = async () => {
      looked = true;
      return undefined;
    };
    await assert.rejects(
      () => createArtifact({ ...base, payload: {} }, { artifacts: store }),
      InvalidArtifactPayloadError,
    );
    assert.equal(looked, false, "schema validation runs before media resolution");
  });

  it("a later VisualAsset revision does not alter an already-created Artifact's payload", async () => {
    const store = memoryStore();
    (store as any).getVisualAsset = async (id: number) =>
      ({ id, userId: 1, status: "ready", mime: "image/png" }) as never;
    (store as any).insertVisualAssetRef = async (row: Record<string, unknown>) => row as never;

    const artifact = await createArtifact(
      { ...base, payload: { visualAssetId: 5 } },
      { artifacts: store },
    );
    // A newer revision existing elsewhere never changes what this Artifact
    // named — the payload holds the exact id, never a query for "latest".
    assert.equal((artifact.payload as { visualAssetId: number }).visualAssetId, 5);
  });
});

// ── X adapter ─────────────────────────────────────────────────────────────────
describe("x channel adapter", () => {
  it("declares exactly the formats it can publish", () => {
    const adapter = createXChannelAdapter();
    assert.equal(adapter.supports("x_post"), true);
    assert.equal(adapter.supports("x_thread"), true);
    assert.equal(adapter.supports("image"), true, "Phase 7: single-image delivery");
    assert.equal(adapter.supports("thumbnail"), true, "thumbnail shares the single-image mechanic");
    assert.equal(adapter.supports("carousel"), false, "multi-media delivery is deferred");
    assert.equal(
      adapter.supports("linkedin_post"),
      true,
      "compatible { text } payload can be delivered on X without cloning the Artifact",
    );
  });

  it("refuses a visual format with no resolved media without invoking the transport", async () => {
    const adapter = createXChannelAdapter();
    const outcome = await adapter.publish({
      format: "image",
      channel: "x",
      payload: { visualAssetId: 1 },
      correlationId: "c",
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.equal(outcome.errorClass, "permanent");
    assert.match(String(outcome.errorMessage), /no resolved visual media/);
  });

  it("refuses an unsupported format without invoking the transport", async () => {
    const adapter = createXChannelAdapter();
    const outcome = await adapter.publish({
      format: "carousel",
      channel: "x",
      payload: {},
      correlationId: "c",
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.equal(outcome.errorClass, "permanent");
  });

  it("classifies xQuick failures deterministically", () => {
    assert.equal(classifyXFailure("XQUICK_CONFIG_MISSING"), "policy_human");
    assert.equal(classifyXFailure("XQUICK_POST_ID_MISSING"), "policy_human");
    assert.equal(classifyXFailure("request timeout after 10000ms"), "transient");
    assert.equal(classifyXFailure("connect ECONNREFUSED 127.0.0.1:9999"), "transient");
    assert.equal(classifyXFailure("upstream returned 503"), "transient");
    assert.equal(classifyXFailure("rate limit exceeded"), "transient");
    assert.equal(classifyXFailure("invalid payload shape"), "permanent");
  });
});

// ── LinkedIn adapter ─────────────────────────────────────────────────────────
describe("linkedin channel adapter", () => {
  it("declares exactly the formats it can publish", () => {
    const adapter = createLinkedInChannelAdapter();
    assert.equal(adapter.supports("linkedin_post"), true);
    assert.equal(
      adapter.supports("x_post"),
      true,
      "compatible { text } payload can be delivered on LinkedIn without cloning the Artifact",
    );
    assert.equal(adapter.supports("x_thread"), false);
    assert.equal(adapter.supports("image"), false);
  });

  it("refuses an unsupported format without invoking the transport", async () => {
    const adapter = createLinkedInChannelAdapter();
    const outcome = await adapter.publish({
      format: "x_thread",
      channel: "linkedin",
      payload: {},
      correlationId: "c",
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.equal(outcome.errorClass, "permanent");
  });

  it("refuses an empty payload without invoking the transport", async () => {
    const adapter = createLinkedInChannelAdapter();
    const outcome = await adapter.publish({
      format: "linkedin_post",
      channel: "linkedin",
      payload: { text: "" },
      correlationId: "c",
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.providerCalled, false);
    assert.equal(outcome.errorClass, "permanent");
  });

  it("classifies LinkedIn failures deterministically", () => {
    assert.equal(classifyLinkedInFailure("LINKEDIN_CONFIG_MISSING"), "policy_human");
    assert.equal(classifyLinkedInFailure("LINKEDIN_POST_ID_MISSING"), "policy_human");
    assert.equal(classifyLinkedInFailure("request timeout after 10000ms"), "transient");
    assert.equal(classifyLinkedInFailure("connect ECONNREFUSED 127.0.0.1:9999"), "transient");
    assert.equal(classifyLinkedInFailure("upstream returned 503"), "transient");
    assert.equal(classifyLinkedInFailure("rate limit exceeded"), "transient");
    assert.equal(classifyLinkedInFailure("invalid payload shape"), "permanent");
  });

  it("reconcile returns null (still unknown) without a reconciliation hint", async () => {
    const adapter = createLinkedInChannelAdapter();
    const outcome = await adapter.reconcile({
      format: "linkedin_post",
      channel: "linkedin",
      payload: { text: "hi" },
      correlationId: "c",
    });
    assert.equal(outcome, null);
  });
});

describe("threads channel adapter", () => {
  it("declares text formats only and classifies failures", () => {
    const adapter = createThreadsChannelAdapter();
    assert.equal(adapter.supports("x_post"), true);
    assert.equal(adapter.supports("linkedin_post"), true);
    assert.equal(adapter.supports("carousel"), false);
    assert.equal(classifyThreadsFailure("THREADS_CONFIG_MISSING"), "policy_human");
    assert.equal(classifyThreadsFailure("429"), "transient");
  });
});

describe("instagram channel adapter", () => {
  it("declares image and carousel only and classifies failures", () => {
    const adapter = createInstagramChannelAdapter();
    assert.equal(adapter.supports("image"), true);
    assert.equal(adapter.supports("carousel"), true);
    assert.equal(adapter.supports("x_post"), false);
    assert.equal(classifyInstagramFailure("INSTAGRAM_CONFIG_MISSING"), "policy_human");
    assert.equal(classifyInstagramFailure("429"), "transient");
  });
});

// ── Publication outcome rules ─────────────────────────────────────────────────
function publicationStore(pub: Partial<Publication>) {
  const record = {
    id: 1,
    userId: 1,
    scheduleId: 1,
    occurrenceId: 1,
    artifactId: 1,
    channel: "x",
    idempotencyKey: "publication:1:1:1",
    state: "queued",
    attempt: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    providerCalled: false,
    externalId: null,
    lastError: null,
    correlationId: "corr",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...pub,
  } as Publication;

  const updates: Array<Record<string, unknown>> = [];
  const results: Array<Record<string, unknown>> = [];
  const deps: PublicationDeps = {
    content: {
      getPublication: async () => record,
      getArtifact: async () =>
        ({ id: 1, readiness: "approved", format: "x_post", channel: "x", payload: { text: "hi" } }) as unknown as Artifact,
      acquirePublicationLease: async () => {
        if (record.state === "publishing") return undefined;
        record.state = "publishing";
        return record;
      },
      updatePublication: async (_id, patch) => {
        updates.push(patch as Record<string, unknown>);
        Object.assign(record, patch);
      },
      insertResult: async (row) => {
        results.push(row as unknown as Record<string, unknown>);
        return row as never;
      },
      markOccurrenceStatus: async () => {},
      getSchedule: async () => undefined,
      setScheduleStatus: async () => {},
      listStalePublishing: async () => [],
    } as unknown as ContentStoragePort,
    adapterFor: () => ({
      channel: "x",
      supports: () => true,
      publish: async () => ({
        ok: true,
        providerCalled: true,
        externalId: "tweet-1",
        externalUrl: "https://x.com/i/status/tweet-1",
        publishedAt: new Date(),
        metrics: { unitCount: 1 },
      }),
      reconcile: async () => null,
    }),
  };

  return { record, updates, results, deps };
}

describe("publication boundary", () => {
  it("publishes, records exactly one Result, and marks the occurrence", async () => {
    const { record, results, deps } = publicationStore({});
    const result = await runPublication(record.id, deps);
    assert.equal(result.status, "published");
    assert.equal(record.state, "published");
    assert.equal(record.externalId, "tweet-1");
    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, "published");
  });

  it("selects the adapter from Publication.channel, not Artifact.channel", async () => {
    const { record, deps } = publicationStore({ channel: "linkedin" });
    const seen: string[] = [];
    deps.adapterFor = (channel) => {
      seen.push(channel);
      return {
        channel,
        supports: () => true,
        publish: async (request) => {
          seen.push(`payload:${request.channel}`);
          return {
            ok: true,
            providerCalled: true,
            externalId: "urn:li:share:1",
            externalUrl: null,
            publishedAt: new Date(),
          };
        },
        reconcile: async () => null,
      };
    };
    const result = await runPublication(record.id, deps);
    assert.equal(result.status, "published");
    assert.equal(seen[0], "linkedin");
    assert.equal(seen[1], "payload:linkedin");
  });

  it("is idempotent: an already-published publication is a no-op", async () => {
    const { record, results, deps } = publicationStore({ state: "published", externalId: "t1" });
    const result = await runPublication(record.id, deps);
    assert.equal(result.reused, true);
    assert.equal(results.length, 0, "no second Result is written");
  });

  it("never re-invokes a transport that was already called without a known outcome", async () => {
    const { record, results, deps } = publicationStore({ providerCalled: true });
    let invoked = false;
    deps.adapterFor = () => ({
      channel: "x",
      supports: () => true,
      publish: async () => {
        invoked = true;
        return { ok: true, providerCalled: true, externalId: "x", externalUrl: null, publishedAt: null };
      },
      reconcile: async () => null,
    });

    const result = await runPublication(record.id, deps);
    assert.equal(invoked, false, "must not resend a possibly-sent thread");
    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "unknown");
    assert.equal(record.state, "failed");
    assert.equal(results[0].outcome, "unknown", "recorded for reconciliation");
  });

  it("retries a transient failure that never reached the transport", async () => {
    const { record, deps } = publicationStore({});
    deps.adapterFor = () => ({
      channel: "x",
      supports: () => true,
      publish: async () => ({
        ok: false,
        providerCalled: false,
        externalId: null,
        externalUrl: null,
        publishedAt: null,
        errorClass: "transient",
        errorMessage: "connection reset",
      }),
      reconcile: async () => null,
    });

    await assert.rejects(() => runPublication(record.id, deps), /connection reset/);
    assert.equal(record.state, "queued", "re-queued for a real retry");
  });

  it("refuses to publish a revision that is not approved", async () => {
    const { record, results, deps } = publicationStore({});
    deps.content.getArtifact = async () =>
      ({ id: 1, readiness: "in_review", format: "x_post", channel: "x", payload: {} }) as unknown as Artifact;
    const result = await runPublication(record.id, deps);
    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "policy_human");
    assert.equal(results[0].outcome, "failed");
  });

  it("resolves the pinned media from the artifact payload and passes it to the adapter", async () => {
    const { record, deps } = publicationStore({});
    deps.content.getArtifact = async () =>
      ({ id: 1, userId: 1, readiness: "approved", format: "image", channel: "x", payload: { visualAssetId: 42, caption: "hero" } }) as unknown as Artifact;
    deps.content.getVisualAsset = async (id) =>
      ({ id, userId: 1, status: "ready", mime: "image/png", storageKey: `local:${"a".repeat(64)}`, role: "hero", altText: null }) as never;
    deps.storage = {
      get: async () => Buffer.from("png-bytes"),
      put: async () => ({ storageKey: `local:${"a".repeat(64)}`, contentHash: "a".repeat(64), byteSize: 9 }),
      archive: async () => {},
    };
    let seen: { media?: Array<{ visualAssetId: number; mime: string; bytes: Buffer }> } | undefined;
    deps.adapterFor = () => ({
      channel: "x",
      supports: () => true,
      publish: async (request) => {
        seen = request;
        return { ok: true, providerCalled: true, externalId: "t1", externalUrl: null, publishedAt: new Date() };
      },
      reconcile: async () => null,
    });

    const result = await runPublication(record.id, deps);
    assert.equal(result.status, "published");
    assert.equal(seen?.media?.length, 1);
    assert.equal(seen?.media?.[0].visualAssetId, 42, "the exact revision is pinned");
    assert.equal(seen?.media?.[0].mime, "image/png");
    assert.equal(seen?.media?.[0].bytes.toString(), "png-bytes");
  });

  it("fails permanently before the transport when a referenced asset is missing", async () => {
    const { record, results, deps } = publicationStore({});
    deps.content.getArtifact = async () =>
      ({ id: 1, userId: 1, readiness: "approved", format: "image", channel: "x", payload: { visualAssetId: 999 } }) as unknown as Artifact;
    deps.content.getVisualAsset = async () => undefined;
    deps.storage = { get: async () => Buffer.from(""), put: async () => ({ storageKey: "x", contentHash: "x", byteSize: 0 }), archive: async () => {} };
    let invoked = false;
    deps.adapterFor = () => ({
      channel: "x",
      supports: () => true,
      publish: async () => {
        invoked = true;
        return { ok: true, providerCalled: true, externalId: null, externalUrl: null, publishedAt: null };
      },
      reconcile: async () => null,
    });

    const result = await runPublication(record.id, deps);
    assert.equal(result.status, "failed");
    assert.equal(result.failureClass, "permanent");
    assert.equal(invoked, false, "the transport is never called when media cannot be resolved");
    assert.equal(results[0].outcome, "failed");
  });

  it("rejects a media reference owned by another user (owner isolation)", async () => {
    const { record, deps } = publicationStore({});
    deps.content.getArtifact = async () =>
      ({ id: 1, userId: 1, readiness: "approved", format: "image", channel: "x", payload: { visualAssetId: 42 } }) as unknown as Artifact;
    deps.content.getVisualAsset = async (id) =>
      ({ id, userId: 2, status: "ready", mime: "image/png", storageKey: `local:${"a".repeat(64)}` }) as never;
    deps.storage = { get: async () => Buffer.from("x"), put: async () => ({ storageKey: "x", contentHash: "x", byteSize: 1 }), archive: async () => {} };

    await assert.rejects(
      () => resolvePublicationMedia({ id: 1, userId: 1, format: "image", payload: { visualAssetId: 42 } } as unknown as Artifact, deps),
      MediaResolutionError,
    );
  });

  it("pins the exact revision named by the payload, never the latest", async () => {
    const requested: number[] = [];
    const deps = publicationStore({}).deps;
    deps.content.getVisualAsset = async (id) => {
      requested.push(id);
      return { id, userId: 1, status: "ready", mime: "image/png", storageKey: `local:${"a".repeat(64)}`, role: null, altText: null } as never;
    };
    deps.storage = { get: async () => Buffer.from("bytes"), put: async () => ({ storageKey: "x", contentHash: "x", byteSize: 1 }), archive: async () => {} };

    const media = await resolvePublicationMedia(
      { id: 1, userId: 1, format: "image", payload: { visualAssetId: 7 } } as unknown as Artifact,
      deps,
    );
    assert.deepEqual(requested, [7], "only the payload's exact revision is fetched");
    assert.equal(media[0].visualAssetId, 7);
  });
});

describe("publication identity", () => {
  it("is the composite of schedule × occurrence × artifact revision", () => {
    assert.equal(
      publicationIdempotencyKey({ scheduleId: 1, occurrenceId: 2, artifactId: 3 }),
      "publication:1:2:3",
    );
    assert.notEqual(
      publicationIdempotencyKey({ scheduleId: 1, occurrenceId: 2, artifactId: 3 }),
      publicationIdempotencyKey({ scheduleId: 1, occurrenceId: 2, artifactId: 4 }),
    );
  });
});

export type { GenerationJob, ScheduleOccurrence };
