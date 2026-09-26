/**
 * Phase 33.7 — autonomy time semantics across database session time zones.
 *
 * Reproduces the confirmed defect (3/20 `autonomy.dbtest` failures under a
 * non-UTC session) and proves the fix: the controller's date/window/budget/
 * cooldown arithmetic must yield identical decisions whether the PostgreSQL
 * session time zone is UTC (+00:00), Asia/Kolkata (+05:30) or
 * America/New_York (−05:00/−04:00, DST).
 *
 * Before the fix, a non-UTC session stored `policy_activations.created_at` as
 * session-local wall clock which the `pg` driver read back as if it were UTC, so
 * the activation looked ~5.5 h in the future, `cooldownMinutes = 0` reported
 * COOLDOWN_ACTIVE, and the churn / rollback assertions were masked.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { and as andOp, eq, gte, lt, sql as rawSql } from "drizzle-orm";
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
  autonomyConfigs,
  autonomyDecisions,
} from "@shared/schema";
import { getOrCreateAutonomyConfig, updateAutonomyConfig } from "./config";
import { executeAutonomousActivation, executeAutonomousRollback } from "./controller";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `autz${Date.now().toString(36)}`;

/** UTC, a positive offset (+05:30) and a DST-observing negative offset. */
const ZONES = ["UTC", "Asia/Kolkata", "America/New_York"] as const;

const BASE_OWNER = 950_000 + (Date.now() % 20_000);

function poolFor(timeZone: string): pg.Pool {
  const options = encodeURIComponent(`-c timezone=${timeZone}`);
  const sep = CONNECTION!.includes("?") ? "&" : "?";
  return new pg.Pool({ connectionString: `${CONNECTION}${sep}options=${options}` });
}

type Db = NodePgDatabase<typeof schema>;

async function withZone<T>(timeZone: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const pool = poolFor(timeZone);
  const db = drizzle(pool, { schema });
  try {
    return await fn(db);
  } finally {
    await pool.end();
  }
}

async function seedEligibleCandidate(db: Db, owner: number, tag: string, scopeTag: string) {
  const scope = `channel:x;format:${scopeTag}`;
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
      decision: "variant_preferred",
      identityKey: `autz-exp:${tag}`,
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
      policySnapshot: { format: scopeTag },
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
      evidenceQuality: "repeatable",
      recommendedDecision: "variant_preferred",
      guardrailResults: [],
      summary: "Observed higher engagement under controlled assignment.",
      identityKey: `autz-eval:${tag}`,
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
      proposedConfiguration: { objective: `Tested config ${tag}` },
      status: "approved_for_future",
      identityKey: `autz-cand:${tag}`,
    })
    .returning();
  return { candidate, scope };
}

async function enable(db: Db, owner: number, cooldownMinutes: number, maxConsecutive: number, overrides: Record<string, unknown> = {}) {
  await getOrCreateAutonomyConfig(db, owner);
  return updateAutonomyConfig(
    db,
    owner,
    {
      enabled: true,
      mode: "bounded_activation",
      activationAutomationEnabled: true,
      rollbackEnabled: true,
      minimumEvidenceQuality: "repeatable",
      maxActivationsPerDay: 10,
      maxActivationsPerWeek: 20,
      maxConsecutiveActivations: maxConsecutive,
      cooldownMinutes,
      ...overrides,
    },
    owner,
  );
}

async function cleanup(db: Db, owner: number) {
  const inRange = (col: any) => andOp(gte(col, owner), lt(col, owner + 10));
  await db.delete(autonomyDecisions).where(inRange(autonomyDecisions.userId));
  await db.delete(autonomyConfigs).where(inRange(autonomyConfigs.userId));
  await db.delete(policyActivations).where(inRange(policyActivations.userId));
  await db.delete(policyCandidates).where(inRange(policyCandidates.userId));
  await db.delete(experimentEvaluations).where(inRange(experimentEvaluations.userId));
  await db.delete(experimentVariants).where(inRange(experimentVariants.userId));
  await db.delete(experiments).where(inRange(experiments.userId));
  await db.delete(generationPolicies).where(inRange(generationPolicies.userId));
}

describeDb("autonomy time semantics across DB session time zones (Phase 33.7)", () => {
  ZONES.forEach((zone, zi) => {
    describe(`session timezone = ${zone}`, () => {
      const base = BASE_OWNER + zi * 100;

      it("cooldown=0 does not falsely deny a same-scope re-activation (elapsed is not negative)", async () => {
        await withZone(zone, async (db) => {
          const owner = base + 10;
          const scopeTag = `${RUN}-z${zi}-cd`;
          const c1 = await seedEligibleCandidate(db, owner, `${RUN}-z${zi}-cd1`, scopeTag);
          const c2 = await seedEligibleCandidate(db, owner, `${RUN}-z${zi}-cd2`, scopeTag);
          await enable(db, owner, 0, 5);
          try {
            const r1 = await executeAutonomousActivation(db, owner, c1.candidate.id);
            assert.equal(r1.gate.allowed, true, `${zone}: first activation allowed`);
            // The activation is now; elapsed must be ~0 (never negative), so a
            // zero cooldown is satisfied and the churn gate (not cooldown) fires.
            const r2 = await executeAutonomousActivation(db, owner, c2.candidate.id);
            assert.notEqual(r2.gate.code, "COOLDOWN_ACTIVE", `${zone}: a zero cooldown must not read as active`);
            assert.equal(r2.gate.allowed, true, `${zone}: second activation within churn budget allowed`);
          } finally {
            await cleanup(db, owner);
          }
        });
      });

      it("churn limit reports POLICY_CHURN, not a cooldown masked by timezone skew", async () => {
        await withZone(zone, async (db) => {
          const owner = base + 20;
          const scopeTag = `${RUN}-z${zi}-ch`;
          const c1 = await seedEligibleCandidate(db, owner, `${RUN}-z${zi}-ch1`, scopeTag);
          const c2 = await seedEligibleCandidate(db, owner, `${RUN}-z${zi}-ch2`, scopeTag);
          await enable(db, owner, 0, 1);
          try {
            const r1 = await executeAutonomousActivation(db, owner, c1.candidate.id);
            assert.equal(r1.gate.allowed, true, `${zone}: first activation allowed`);
            const r2 = await executeAutonomousActivation(db, owner, c2.candidate.id);
            assert.equal(r2.gate.code, "POLICY_CHURN", `${zone}: expected POLICY_CHURN, got ${r2.gate.code}`);
          } finally {
            await cleanup(db, owner);
          }
        });
      });

      it("daily budget window is enforced in every session timezone", async () => {
        await withZone(zone, async (db) => {
          const owner = base + 30;
          const c1 = await seedEligibleCandidate(db, owner, `${RUN}-z${zi}-b1`, `${RUN}-z${zi}-b1`);
          const c2 = await seedEligibleCandidate(db, owner, `${RUN}-z${zi}-b2`, `${RUN}-z${zi}-b2`);
          await enable(db, owner, 0, 5, { maxActivationsPerDay: 1 });
          try {
            const r1 = await executeAutonomousActivation(db, owner, c1.candidate.id);
            assert.equal(r1.gate.allowed, true, `${zone}: first activation allowed`);
            const r2 = await executeAutonomousActivation(db, owner, c2.candidate.id);
            assert.equal(r2.gate.code, "BUDGET_EXHAUSTED_DAILY", `${zone}: daily budget enforced`);
          } finally {
            await cleanup(db, owner);
          }
        });
      });

      it("rollback re-activates the prior revision (two same-scope activations succeed)", async () => {
        await withZone(zone, async (db) => {
          const owner = base + 40;
          const scopeTag = `${RUN}-z${zi}-rb`;
          const c1 = await seedEligibleCandidate(db, owner, `${RUN}-z${zi}-rb1`, scopeTag);
          const c2 = await seedEligibleCandidate(db, owner, `${RUN}-z${zi}-rb2`, scopeTag);
          await enable(db, owner, 0, 10);
          try {
            const r1 = await executeAutonomousActivation(db, owner, c1.candidate.id);
            const r2 = await executeAutonomousActivation(db, owner, c2.candidate.id);
            assert.equal(r1.gate.allowed, true, `${zone}: first activation allowed`);
            assert.equal(r2.gate.allowed, true, `${zone}: second same-scope activation allowed`);

            const rollback = await executeAutonomousRollback(db, owner, c2.candidate.id, {
              code: "GUARDRAIL_BREACH",
              reason: "post-activation publication failure rate exceeded threshold",
            });
            assert.equal(rollback.gate.allowed, true, `${zone}: rollback allowed`);
            assert.equal(rollback.activation!.policy.id, r1.activation!.policy.id, `${zone}: rolled back to the prior revision`);
          } finally {
            await cleanup(db, owner);
          }
        });
      });
    });
  });

  it("proves the stored wall clock differs per session but decisions do not", async () => {
    // Sanity check on the mechanism itself: the same insert stores a different
    // wall-clock text per session timezone, yet the SQL-computed elapsed time
    // (the value the controller now trusts) is ~0 in every case.
    for (const zone of ZONES) {
      await withZone(zone, async (db) => {
        const owner = BASE_OWNER + 90 + ZONES.indexOf(zone);
        const cfg = await getOrCreateAutonomyConfig(db, owner);
        const jsDelta = Date.now() - cfg.createdAt.getTime();
        const res = await db.execute(
          rawSql`select extract(epoch from (now() - created_at)) * 1000 as elapsed_ms from autonomy_configs where user_id = ${owner}`,
        );
        const elapsedMs = Number((res.rows[0] as { elapsed_ms: number }).elapsed_ms);
        try {
          assert.ok(Math.abs(elapsedMs) < 5_000, `${zone}: DB-computed elapsed ~0 (got ${elapsedMs})`);
          if (zone !== "UTC") {
            // The driver-materialised JS delta is skewed in a non-UTC session —
            // this is the defect the SQL computation avoids.
            assert.ok(Math.abs(jsDelta) > 1_000_000, `${zone}: JS delta is skewed (got ${jsDelta})`);
          }
        } finally {
          await db.delete(autonomyConfigs).where(eq(autonomyConfigs.userId, owner));
        }
      });
    }
  });
});
