/**
 * run48 step 3 — prove the guard through the REAL service layer against the REAL
 * database, without leaving a row behind.
 *
 * Runs createArtifact with the live ContentStorage against a killed opportunity,
 * then rolls the transaction back. Two assertions:
 *   1. before the guard would have applied (raw insert) the row exists  -> proven
 *      separately in probe_killed_opportunity.sql
 *   2. createArtifact itself now refuses, and writes nothing
 *
 * DATABASE_URL is used but never printed.
 */
import { createArtifact } from "../server/content/artifact";
import { DatabaseContentStorage } from "../server/content/storage";
import { db } from "../server/db";

async function main() {
  const store = new DatabaseContentStorage();
  const target = Number(process.argv[2] ?? "17");

  const opp = await store.getOpportunity(target);
  if (!opp) {
    console.log(`opportunity ${target} not found`);
    process.exit(3);
  }
  console.log(`opportunity ${target}: status=${opp.status} (must be proposed to start)`);

  const before = (await store.listArtifactsByOpportunity(target)).length;

  // Kill it for real, then try the service call, then restore. All inside one
  // transaction so the live table is untouched either way.
  let refused: string | null = null;
  let created: number | null = null;

  await db.transaction(async (tx) => {
    await tx.execute(`UPDATE opportunities SET status='killed', kill_reason='run48 verify (rolled back)' WHERE id=${target}`);
    const txStore = new DatabaseContentStorage(tx as never);
    try {
      const artifact = await createArtifact(
        {
          userId: 1,
          generationJobId: null,
          opportunityId: target,
          format: "x_post",
          channel: "x",
          payload: { text: "run48 verify" },
          provenance: "human_edit",
          attribution: [],
          attributionReason: "run48 verify: no evidence",
        } as any,
        { artifacts: txStore },
      );
      created = artifact.id;
    } catch (e: any) {
      refused = `${e?.name}: ${e?.message}`;
    }
    throw new RollbackSignal();
  }).catch((e) => {
    if (!(e instanceof RollbackSignal)) throw e;
  });

  console.log("createArtifact outcome:", created !== null ? `CREATED id=${created}` : `REFUSED -> ${refused}`);

  const after = (await store.listArtifactsByOpportunity(target)).length;
  const statusNow = (await store.getOpportunity(target))?.status;
  console.log(`artifact count for opportunity ${target}: ${before} -> ${after}`);
  console.log(`opportunity status after rollback: ${statusNow}`);

  const pass = created === null && /ArtifactOpportunityKilledError/.test(refused ?? "") && before === after;
  console.log("VERDICT:", pass ? "guard refuses a killed opportunity through the real service + DB" : "FAILED");
  process.exit(pass ? 0 : 1);
}

class RollbackSignal extends Error {}

main().catch((e) => {
  console.error("ERR", e?.message ?? e);
  process.exit(3);
});
