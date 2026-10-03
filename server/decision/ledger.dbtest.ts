/**
 * DB-backed tests for the decision ledger — against real PostgreSQL.
 *
 * Covers the layer unit tests cannot: the SQL itself. In particular
 * `attachOutcomeByRef`, whose correctness depends on JSONB extraction from the
 * `refs` column matching a publication or artifact, and the owner-scoped read.
 *
 * Requires TEST_DATABASE_URL (skipped otherwise), matching every other
 * `*.dbtest.ts` in the repo.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { jevDecisions } from "@shared/schema";
import { DatabaseDecisionLedger } from "./ledgerStore";
import { newDecisionId, type DecisionLedgerEntry } from "./ledger";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;

const OWNER = 910_000 + (Date.now() % 70_000);
const OTHER_OWNER = OWNER + 1;

describeDb("decision ledger (db)", () => {
  let pool: pg.Pool;
  let db!: NodePgDatabase<typeof schema>;
  let ledger: DatabaseDecisionLedger;

  before(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION });
    db = drizzle(pool, { schema });
    ledger = new DatabaseDecisionLedger(db);
  });

  after(async () => {
    await db.delete(jevDecisions).where(eq(jevDecisions.userId, OWNER));
    await db.delete(jevDecisions).where(eq(jevDecisions.userId, OTHER_OWNER));
    await pool.end();
  });

  function entry(overrides: Partial<DecisionLedgerEntry> = {}): DecisionLedgerEntry {
    return {
      decisionId: newDecisionId(),
      userId: OWNER,
      decisionType: "quality_gate",
      policyId: "quality-gate",
      policyVersion: "v1",
      inputStateHash: "a".repeat(64),
      decision: { outcome: "revise" },
      confidence: 0.5125,
      reasons: ["composite 0.5125 → revise"],
      signals: { repetition: 0.1 },
      fallback: false,
      refs: { artifactId: 4242 },
      ...overrides,
    };
  }

  it("round-trips a decision, including the numeric confidence and refs", async () => {
    const inserted = entry();
    const { decisionId } = await ledger.insert(inserted);

    const row = await ledger.get(decisionId);
    assert.ok(row);
    assert.equal(row.userId, OWNER);
    assert.equal(row.policyId, "quality-gate");
    assert.equal(row.policyVersion, "v1");
    assert.equal(row.inputStateHash, "a".repeat(64));
    // `numeric` comes back from Postgres as a string; the port must speak numbers.
    assert.equal(row.confidence, 0.5125);
    assert.deepEqual(row.decision, { outcome: "revise" });
    assert.deepEqual(row.refs, { artifactId: 4242 });
    assert.equal(row.actual, null);
  });

  it("scopes the read to the owner, in the query", async () => {
    await ledger.insert(entry({ userId: OWNER, decisionType: "research_triage" }));
    await ledger.insert(entry({ userId: OTHER_OWNER, decisionType: "research_triage" }));

    const mine = await ledger.list({ limit: 50, userId: OWNER });
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((row) => row.userId === OWNER), "another owner's rows must not appear");

    const filtered = await ledger.list({ limit: 50, userId: OWNER, decisionType: "research_triage" });
    assert.ok(filtered.every((row) => row.decisionType === "research_triage"));
  });

  it("attaches an outcome by decision id", async () => {
    const { decisionId } = await ledger.insert(entry());
    const updated = await ledger.attachOutcome(decisionId, { metrics: { impressions: 9_000 } });
    assert.ok(updated);
    assert.deepEqual(updated.actual, { metrics: { impressions: 9_000 } });
    assert.ok(updated.actualAt instanceof Date);
  });

  it("attaches an outcome by PUBLICATION ref across every decision that referenced it", async () => {
    // Three decisions behind one publication: a publish gate, a score, a strategy.
    for (const type of ["publish_gate", "opportunity_score", "content_strategy"]) {
      await ledger.insert(entry({ decisionType: type, refs: { publicationId: 777 } }));
    }
    await ledger.insert(entry({ decisionType: "publish_gate", refs: { publicationId: 778 } }));

    const updated = await ledger.attachOutcomeByRef(
      { publicationId: 777 },
      { metrics: { impressions: 12_000 }, observedCount: 1 },
    );

    assert.equal(updated, 3, "every decision behind that publication is updated");
    const rows = await ledger.list({ limit: 50, userId: OWNER });
    const attached = rows.filter((row) => row.actual !== null && row.refs?.publicationId === 777);
    assert.equal(attached.length, 3);
    // A publication id that matched nothing must not touch anything.
    assert.equal(await ledger.attachOutcomeByRef({ publicationId: 999_999 }, { metrics: {} }), 0);
  });

  it("attaches an outcome by ARTIFACT ref too, and never double-counts a ref", async () => {
    const { decisionId } = await ledger.insert(entry({ refs: { artifactId: 5000, publicationId: 5001 } }));

    const updated = await ledger.attachOutcomeByRef({ artifactId: 5000, publicationId: 5001 }, { metrics: { likes: 5 } });
    assert.equal(updated, 1, "the same row matched by both refs counts once");

    const row = await ledger.get(decisionId);
    assert.deepEqual(row?.actual, { metrics: { likes: 5 } });
  });
});
