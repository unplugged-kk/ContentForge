/**
 * Real-Postgres tests for Phase 29.3 — Human-Gated Policy Activation.
 *
 * Tests transactional activation, the single-active-per-scope invariant,
 * idempotency, ownership isolation, guardrail/eligibility rejection,
 * rollback, full lineage reconstruction, and that future GenerationJobs
 * bind to the newly-activated revision while historical jobs keep their
 * original policy_id untouched.
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import {
  experiments,
  experimentVariants,
  experimentEvaluations,
  policyCandidates,
  policyActivations,
  generationPolicies,
  generationJobs,
  opportunities,
  stories,
  researchJobs,
  researchSources,
  researchEvidence,
} from "@shared/schema";
import {
  activatePolicyCandidate,
  rollbackPolicyForCandidate,
  getActivePolicyForKey,
  listPolicyHistoryForOwner,
  policyKeyForScope,
  PolicyActivationError,
} from "./activation";
import { DatabaseContentStorage } from "../storage";
import { DatabaseStoryStorage } from "../../story/storage";
import { createOpportunityFromStory } from "../opportunity";
import { createGenerationJob, type GenerationModelPort, type GenerationRequest } from "../generation";
import { registerBuiltinChannelAdapters } from "../adapters";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `pa_${Date.now().toString(36)}`;
const OWNER_A = 950_000 + (Date.now() % 40_000);
const OWNER_B = OWNER_A + 1;

describeDb("human-gated policy activation (Phase 29.3 db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  const content = () => new DatabaseContentStorage(db);
  const storyStore = () => new DatabaseStoryStorage(db);

  before(async () => {
    if (!CONNECTION) return;
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    registerBuiltinChannelAdapters();
  });

  after(async () => {
    if (!CONNECTION) return;
    await db.delete(policyActivations).where(inArray(policyActivations.userId, [OWNER_A, OWNER_B]));
    await db.delete(policyCandidates).where(inArray(policyCandidates.userId, [OWNER_A, OWNER_B]));
    await db.delete(experimentEvaluations).where(inArray(experimentEvaluations.userId, [OWNER_A, OWNER_B]));
    await db.delete(experimentVariants).where(inArray(experimentVariants.userId, [OWNER_A, OWNER_B]));
    await db.delete(experiments).where(inArray(experiments.userId, [OWNER_A, OWNER_B]));
    await db.delete(generationJobs).where(inArray(generationJobs.userId, [OWNER_A, OWNER_B]));
    await db.delete(opportunities).where(inArray(opportunities.userId, [OWNER_A, OWNER_B]));
    await db.delete(stories).where(inArray(stories.userId, [OWNER_A, OWNER_B]));
    await db.delete(generationPolicies).where(inArray(generationPolicies.userId, [OWNER_A, OWNER_B]));
    await pool.end();
  });

  let seq = 0;
  /** Builds a fully eligible (experiment completed, decision permits, evaluation clean) candidate. */
  async function seedEligibleCandidate(
    owner: number,
    opts: { channel?: string; format?: string; guardrailRegressed?: boolean; evidenceQuality?: string; decision?: string } = {},
  ) {
    seq += 1;
    const tag = `${RUN}-${seq}`;
    const channel = opts.channel ?? "linkedin";
    const format = opts.format ?? `carousel${seq}`;
    const scope = `channel:${channel};format:${format}`;

    const [exp] = await db
      .insert(experiments)
      .values({
        userId: owner,
        name: `Exp ${tag}`,
        hypothesis: "h",
        objective: "o",
        targetScope: scope,
        experimentType: "format_distribution",
        primaryMetric: "engagements_per_post",
        status: "completed",
        decision: opts.decision ?? "variant_preferred",
        identityKey: `pa-exp:${tag}`,
      })
      .returning();

    const [variant] = await db
      .insert(experimentVariants)
      .values({
        userId: owner,
        experimentId: exp.id,
        variantKey: "variant_a",
        name: "Variant A",
        isControl: false,
        policySnapshot: { format, objective: `Tested config ${tag}` },
        trafficWeight: 50,
      })
      .returning();

    const [evaluation] = await db
      .insert(experimentEvaluations)
      .values({
        userId: owner,
        experimentId: exp.id,
        evaluationWindow: "final",
        primaryMetric: "engagements_per_post",
        evidenceQuality: opts.evidenceQuality ?? "repeatable",
        recommendedDecision: "variant_preferred",
        guardrailResults: opts.guardrailRegressed
          ? [{ metric: "publication_failure_rate", controlValue: "1%", variantValue: "20%", differencePercentage: "19%", status: "regressed" }]
          : [],
        summary: "Observed higher engagement under controlled assignment.",
        identityKey: `pa-eval:${tag}`,
      })
      .returning();

    const [candidate] = await db
      .insert(policyCandidates)
      .values({
        userId: owner,
        experimentId: exp.id,
        variantId: variant.id,
        evaluationId: evaluation.id,
        title: `Candidate ${tag}`,
        rationale: "Promoted from controlled experiment",
        targetScope: scope,
        proposedConfiguration: { format, tone: "energetic", note: tag },
        status: "approved_for_future",
        identityKey: `pa-cand:${tag}`,
      })
      .returning();

    return { exp, variant, evaluation, candidate, scope, format, channel };
  }

  it("activates a candidate: creates an active revision and archives the prior one", async () => {
    const { candidate, scope } = await seedEligibleCandidate(OWNER_A);
    const policyKey = policyKeyForScope(scope);

    const result = await activatePolicyCandidate(db, candidate.id, OWNER_A, "first activation");
    assert.equal(result.alreadyActivated, false);
    assert.equal(result.policy.status, "active");
    assert.equal(result.policy.policyKey, policyKey);
    assert.equal(result.previousPolicy, null, "no prior policy existed for a brand-new scope");

    const active = await getActivePolicyForKey(db, policyKey);
    assert.equal(active?.id, result.policy.id);

    const [auditRow] = await db.select().from(policyActivations).where(eq(policyActivations.id, result.activation.id));
    assert.equal(auditRow.action, "activate");
    assert.equal(auditRow.policyCandidateId, candidate.id);
    assert.equal(auditRow.experimentId, candidate.experimentId);
    assert.equal(auditRow.evaluationId, candidate.evaluationId);
    assert.equal(auditRow.userId, OWNER_A);
  });

  it("archives the previously active revision when a second candidate activates for the same scope", async () => {
    const scope = `channel:x;format:${RUN}-shared`;
    const first = await seedEligibleCandidate(OWNER_A, { channel: "x", format: `${RUN}-shared` });
    const second = await seedEligibleCandidate(OWNER_A, { channel: "x", format: `${RUN}-shared` });

    const r1 = await activatePolicyCandidate(db, first.candidate.id, OWNER_A);
    const r2 = await activatePolicyCandidate(db, second.candidate.id, OWNER_A);

    assert.equal(r2.previousPolicy?.id, r1.policy.id);

    const [p1] = await db.select().from(generationPolicies).where(eq(generationPolicies.id, r1.policy.id));
    const [p2] = await db.select().from(generationPolicies).where(eq(generationPolicies.id, r2.policy.id));
    assert.equal(p1.status, "archived", "first revision must be archived, never deleted or mutated in content");
    assert.equal(p2.status, "active");
    assert.equal((p1.constraints as any).tone, "energetic", "archiving never mutates the historical row's content");

    const active = await getActivePolicyForKey(db, policyKeyForScope(scope));
    assert.equal(active?.id, r2.policy.id, "exactly one authoritative active policy for the scope");
  });

  it("is idempotent: repeated activation of the same candidate returns the same activation, never a second revision", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A);

    const first = await activatePolicyCandidate(db, candidate.id, OWNER_A);
    const second = await activatePolicyCandidate(db, candidate.id, OWNER_A);

    assert.equal(second.alreadyActivated, true);
    assert.equal(second.activation.id, first.activation.id);
    assert.equal(second.policy.id, first.policy.id);

    const events = await db.select().from(policyActivations).where(eq(policyActivations.policyCandidateId, candidate.id));
    assert.equal(events.length, 1, "no duplicate activation event was created");
  });

  it("rejects activation of a foreign owner's candidate", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A);
    await assert.rejects(
      () => activatePolicyCandidate(db, candidate.id, OWNER_B),
      (err: unknown) => {
        assert.ok(err instanceof PolicyActivationError);
        assert.equal((err as PolicyActivationError).code, "FORBIDDEN");
        return true;
      },
    );
  });

  it("rejects activation when the candidate was never human-approved", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A);
    await db.update(policyCandidates).set({ status: "candidate" }).where(eq(policyCandidates.id, candidate.id));
    await assert.rejects(
      () => activatePolicyCandidate(db, candidate.id, OWNER_A),
      (err: unknown) => {
        assert.ok(err instanceof PolicyActivationError);
        assert.equal((err as PolicyActivationError).code, "NOT_APPROVED");
        return true;
      },
    );
  });

  it("rejects activation when a guardrail regressed", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A, { guardrailRegressed: true });
    await assert.rejects(
      () => activatePolicyCandidate(db, candidate.id, OWNER_A),
      (err: unknown) => {
        assert.ok(err instanceof PolicyActivationError);
        assert.equal((err as PolicyActivationError).code, "GUARDRAIL_FAILED");
        return true;
      },
    );
  });

  it("rejects activation when evidence is insufficient", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A, { evidenceQuality: "insufficient_data" });
    await assert.rejects(
      () => activatePolicyCandidate(db, candidate.id, OWNER_A),
      (err: unknown) => {
        assert.ok(err instanceof PolicyActivationError);
        assert.equal((err as PolicyActivationError).code, "INSUFFICIENT_EVIDENCE");
        return true;
      },
    );
  });

  it("rejects activation when the experiment decision does not permit promotion", async () => {
    const { candidate } = await seedEligibleCandidate(OWNER_A, { decision: "inconclusive" });
    await assert.rejects(
      () => activatePolicyCandidate(db, candidate.id, OWNER_A),
      (err: unknown) => {
        assert.ok(err instanceof PolicyActivationError);
        assert.equal((err as PolicyActivationError).code, "DECISION_DOES_NOT_PERMIT");
        return true;
      },
    );
  });

  it("resolves two concurrent activations for the same scope deterministically (one wins, one gets a clean conflict)", async () => {
    const channel = "instagram";
    const format = `${RUN}-race`;
    const a = await seedEligibleCandidate(OWNER_A, { channel, format });
    const b = await seedEligibleCandidate(OWNER_A, { channel, format });

    const results = await Promise.allSettled([
      activatePolicyCandidate(db, a.candidate.id, OWNER_A),
      activatePolicyCandidate(db, b.candidate.id, OWNER_A),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    // Both may legitimately succeed if they ran sequentially under the pool's
    // connection scheduling; the invariant that must always hold is below.
    assert.ok(fulfilled.length >= 1, "at least one activation must succeed");

    const activeRows = await db
      .select()
      .from(generationPolicies)
      .where(eq(generationPolicies.policyKey, policyKeyForScope(a.scope)));
    const activeCount = activeRows.filter((r) => r.status === "active").length;
    assert.equal(activeCount, 1, "exactly one authoritative active policy for the scope, even under a race");
  });

  it("rolls back to the immediately-prior revision as a new immutable event, preserving history", async () => {
    const scope = `channel:threads;format:${RUN}-rb`;
    const first = await seedEligibleCandidate(OWNER_A, { channel: "threads", format: `${RUN}-rb` });
    const second = await seedEligibleCandidate(OWNER_A, { channel: "threads", format: `${RUN}-rb` });

    const r1 = await activatePolicyCandidate(db, first.candidate.id, OWNER_A);
    const r2 = await activatePolicyCandidate(db, second.candidate.id, OWNER_A);

    const rollback = await rollbackPolicyForCandidate(db, second.candidate.id, OWNER_A, "reverting bad rollout");
    assert.equal(rollback.alreadyActivated, false);
    assert.equal(rollback.policy.id, r1.policy.id, "rollback re-activates the immediately prior revision");
    assert.equal(rollback.activation.action, "rollback");

    const active = await getActivePolicyForKey(db, policyKeyForScope(scope));
    assert.equal(active?.id, r1.policy.id);

    const [p2AfterRollback] = await db.select().from(generationPolicies).where(eq(generationPolicies.id, r2.policy.id));
    assert.equal(p2AfterRollback.status, "archived");

    // History is additive, never rewritten: 2 activate events + 1 rollback event.
    const history = await listPolicyHistoryForOwner(db, OWNER_A, policyKeyForScope(scope));
    assert.equal(history.length, 3);
    assert.equal(history[0].activation.action, "rollback");
  });

  it("rollback is idempotent: rolling back twice does not toggle or duplicate events", async () => {
    const first = await seedEligibleCandidate(OWNER_A, { channel: "youtube", format: `${RUN}-rb2` });
    const second = await seedEligibleCandidate(OWNER_A, { channel: "youtube", format: `${RUN}-rb2` });
    await activatePolicyCandidate(db, first.candidate.id, OWNER_A);
    await activatePolicyCandidate(db, second.candidate.id, OWNER_A);

    const rb1 = await rollbackPolicyForCandidate(db, second.candidate.id, OWNER_A);
    const rb2 = await rollbackPolicyForCandidate(db, second.candidate.id, OWNER_A);

    assert.equal(rb2.alreadyActivated, true);
    assert.equal(rb2.policy.id, rb1.policy.id);
  });

  it("reconstructs full experiment -> evaluation -> candidate -> activation lineage", async () => {
    const { candidate, exp, evaluation } = await seedEligibleCandidate(OWNER_A, { channel: "x", format: `${RUN}-lineage` });
    const result = await activatePolicyCandidate(db, candidate.id, OWNER_A, "lineage check");

    assert.equal(result.activation.policyCandidateId, candidate.id);
    assert.equal(result.activation.experimentId, exp.id);
    assert.equal(result.activation.evaluationId, evaluation.id);
    assert.equal(
      (result.policy.contextSnapshot as any)?.activatedFrom?.policyCandidateId,
      candidate.id,
      "the activated policy revision itself carries candidate provenance",
    );
  });

  // ── Future-generation binding + historical immutability (§15, §16, §35) ──

  let oppSeq = 0;
  async function seedOpportunityFor(owner: number, format: string, channel: string) {
    oppSeq += 1;
    const tag = `${RUN}-${format}-${channel}-${oppSeq}`;
    const [job] = await db
      .insert(researchJobs)
      .values({
        userId: owner,
        correlationId: tag,
        idempotencyKey: `${tag}-idem`,
        kind: "directed",
        query: "policy activation fixture",
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
        excerpt: "policy activation fixture evidence",
        excerptHash: `${tag}`.padEnd(64, "0").slice(0, 64),
        retrievedAt: new Date(),
      })
      .returning();
    const [story] = await db
      .insert(stories)
      .values({
        userId: owner,
        researchJobId: job.id,
        provenance: "researched",
        title: `${tag} story`,
        insightBody: "Fixture story for policy-activation generation binding.",
        angles: ["fixture"],
        evidenceRefs: [evidence.id],
        status: "ready",
      })
      .returning();
    return createOpportunityFromStory(
      story.id,
      { concept: "explain", objective: "educate", format, channel },
      { opportunities: content(), stories: storyStore() },
    );
  }

  function fakeModel(): GenerationModelPort {
    return {
      provider: "fake-model",
      async generate(request: GenerationRequest) {
        return { payload: { text: "fixture output" }, model: "fake-1", provider: "fake-model", cost: null, usage: {} };
      },
    };
  }

  function generationDeps(activePolicyReader: (format: string, channel: string) => Promise<any>) {
    return {
      content: content(),
      stories: { getStory: (id: number) => storyStore().getStory(id) },
      evidence: { listEvidence: async () => [] },
      model: fakeModel(),
      defaultModel: "fake-1",
      activePolicyReader,
    };
  }

  it("future GenerationJobs resolve the currently active policy; earlier jobs keep their original revision", async () => {
    // Every real generation carries its own frozen per-request context hash
    // (Ticket 10), so a GenerationJob's resolved policy is always its OWN
    // content-addressed revision -- never literally the same row id as the
    // activated one. "Resolves the active policy" means the job's revision
    // carries the active policy's configuration (here: the candidate's
    // distinguishing `constraints.note`), which is what these assertions prove.
    const channel = "x";
    const format = "x_post";
    const first = await seedEligibleCandidate(OWNER_A, { channel, format });
    const r1 = await activatePolicyCandidate(db, first.candidate.id, OWNER_A);
    const r1Note = (r1.policy.constraints as any).note;

    const reader = (f: string, c: string) => getActivePolicyForKey(db, policyKeyForScope(`channel:${c};format:${f}`));

    const opp1 = await seedOpportunityFor(OWNER_A, format, channel);
    const job1 = await createGenerationJob(opp1.id, {}, generationDeps(reader));
    const [job1Policy] = await db.select().from(generationPolicies).where(eq(generationPolicies.id, job1.effective.policyId));
    assert.equal((job1Policy.constraints as any).note, r1Note, "GenerationJob's resolved policy carries the active policy's configuration");

    // Activate a second, newer revision for the same scope.
    const second = await seedEligibleCandidate(OWNER_A, { channel, format });
    const r2 = await activatePolicyCandidate(db, second.candidate.id, OWNER_A);
    const r2Note = (r2.policy.constraints as any).note;
    assert.notEqual(r2Note, r1Note);

    const opp2 = await seedOpportunityFor(OWNER_A, format, channel);
    const job2 = await createGenerationJob(opp2.id, {}, generationDeps(reader));
    const [job2Policy] = await db.select().from(generationPolicies).where(eq(generationPolicies.id, job2.effective.policyId));
    assert.equal((job2Policy.constraints as any).note, r2Note, "a NEW job resolves the NEW active revision's configuration");

    // §16: inspect the EARLIER job again -- it must still reference its OWN original revision.
    const [reloadedJob1] = await db.select().from(generationJobs).where(eq(generationJobs.id, job1.job.id));
    assert.equal(reloadedJob1.policyId, job1.effective.policyId, "historical GenerationJob is never retroactively relabeled");
    const [reloadedJob1Policy] = await db.select().from(generationPolicies).where(eq(generationPolicies.id, reloadedJob1.policyId!));
    assert.equal((reloadedJob1Policy.constraints as any).note, r1Note, "earlier content still reflects the OLD activated configuration, not the new one");
  });

  it("an explicit caller-supplied voiceId/objective always wins over the active policy default", async () => {
    const channel = "x";
    const format = "x_post";
    const { candidate } = await seedEligibleCandidate(OWNER_A, { channel, format });
    const activated = await activatePolicyCandidate(db, candidate.id, OWNER_A);
    const reader = (f: string, c: string) => getActivePolicyForKey(db, policyKeyForScope(`channel:${c};format:${f}`));

    const opp = await seedOpportunityFor(OWNER_A, format, channel);
    const job = await createGenerationJob(
      opp.id,
      { objective: "an explicit human-supplied objective" },
      generationDeps(reader),
    );

    assert.notEqual(job.effective.policyId, activated.policy.id, "an explicit override always produces its own revision");
  });
});
