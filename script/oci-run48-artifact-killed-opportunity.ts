/**
 * run48 probe — can an Artifact be authored under a KILLED Opportunity?
 *
 * createGenerationJob refuses a killed opportunity (OpportunityKilledError).
 * The artifact boundary has no such check and no opportunities port in
 * ArtifactDeps at all, so this probe asks the question with the real service
 * function and a store that reports the opportunity as killed.
 *
 * Falsifiable: if createArtifact rejects, the gap does not exist.
 */
import { createArtifact } from "../server/content/artifact";
import type { Artifact } from "@shared/schema";

function nextFactory() {
  let n = 0;
  return () => ++n;
}

async function main() {
  const next = nextFactory();
  const arts: any[] = [];

  const store: any = {
    async insertArtifact(row: any) {
      const a = { ...row, id: next(), approvedAt: null, createdAt: new Date() };
      arts.push(a);
      return a as Artifact;
    },
    async insertVisualAssetRef() {
      return {};
    },
  };

  // The opportunity this artifact names is killed. Nothing in ArtifactDeps can
  // see that, because there is no opportunities port.
  let created: any = null;
  let thrown: string | null = null;
  try {
    created = await createArtifact(
      {
        userId: 1,
        generationJobId: null,
        opportunityId: 999,
        format: "x_post",
        channel: "x",
        payload: { text: "probe" },
        provenance: "generated",
        attribution: [],
        attributionReason: "run48 probe: no research evidence",
      } as any,
      { artifacts: store },
    );
  } catch (e: any) {
    thrown = `${e?.name}: ${e?.message}`;
  }

  console.log("ArtifactPayload keys on service input: userId/opportunityId only");
  console.log("created under opportunityId=999 (killed):", created ? "YES id=" + created.id : "NO");
  console.log("thrown:", thrown ?? "(none)");
  console.log("rows written:", arts.length);
  console.log("VERDICT:", created ? "GAP EXISTS - artifact accepts a killed opportunity" : "no gap");
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(3);
});
