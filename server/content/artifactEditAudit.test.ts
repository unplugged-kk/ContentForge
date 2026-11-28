import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Artifact } from "@shared/schema";
import {
  claimEvidenceAttributionSchema,
  createHumanEditRevision,
  type ArtifactDeps,
} from "./artifact";
import type { ContentStoragePort } from "./storage";
import { auditArtifactClaims } from "../intelligence/quality/claimCheck";

function makeMemoryArtifactStore(seed: Artifact[]): {
  store: ContentStoragePort;
  rows: Map<number, Artifact>;
} {
  const rows = new Map<number, Artifact>(seed.map((a) => [a.id, a]));
  let nextId = Math.max(0, ...seed.map((a) => a.id)) + 1;

  const store = {
    async getArtifact(id: number) {
      return rows.get(id);
    },
    async insertArtifact(input: Record<string, unknown>) {
      const artifact: Artifact = {
        id: nextId++,
        userId: (input.userId as number | null) ?? null,
        generationJobId: (input.generationJobId as number | null) ?? null,
        opportunityId: input.opportunityId as number,
        format: input.format as string,
        channel: input.channel as string,
        payload: input.payload as Record<string, unknown>,
        readiness: (input.readiness as string) ?? "draft",
        approvedAt: null,
        supersedesId: (input.supersedesId as number | null) ?? null,
        provenance: (input.provenance as string) ?? "human_edit",
        attribution: (input.attribution as unknown[]) ?? [],
        attributionReason: (input.attributionReason as string | null) ?? null,
        createdAt: new Date(),
      };
      rows.set(artifact.id, artifact);
      return artifact;
    },
  } as unknown as ContentStoragePort;

  return { store, rows };
}

function findClaimAudit(artifact: Artifact) {
  const entry = (artifact.attribution ?? []).find(
    (e) => e && typeof e === "object" && (e as { kind?: unknown }).kind === "claim_evidence_v1",
  );
  return entry ? claimEvidenceAttributionSchema.parse(entry) : undefined;
}

describe("createHumanEditRevision claim re-audit", () => {
  it("clears uncited number warnings and refreshes claim_evidence_v1 when human removes the uncited metric", async () => {
    const evidence = [
      { id: 101, text: "Postgres 18 async IO boosted NVMe sequential scan throughput by 28%." },
    ];
    const initialAudit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      payload: {
        text: "Postgres 18 async IO boosted NVMe scans by 28% and cut cloud bills by 65%.",
      },
      researchJobId: 44,
      evidence,
    });
    assert.equal(initialAudit.unsupportedCount, 1);

    const prior: Artifact = {
      id: 1,
      userId: 7,
      generationJobId: 10,
      opportunityId: 20,
      format: "x_post",
      channel: "x",
      payload: {
        text: "Postgres 18 async IO boosted NVMe scans by 28% and cut cloud bills by 65%.",
      },
      readiness: "in_review",
      approvedAt: null,
      supersedesId: null,
      provenance: "generated",
      attribution: [
        { kind: "research_evidence", researchJobId: 44, evidenceIds: [101] },
        initialAudit,
      ],
      attributionReason: null,
      createdAt: new Date(),
    };

    const { store } = makeMemoryArtifactStore([prior]);
    const deps: ArtifactDeps = { artifacts: store };

    const revised = await createHumanEditRevision(
      prior.id,
      { text: "Postgres 18 async IO boosted NVMe scans by 28% in early beta benchmarks." },
      deps,
      { evidence },
    );

    assert.equal(revised.supersedesId, prior.id);
    assert.equal(revised.provenance, "human_edit");
    const refreshed = findClaimAudit(revised);
    assert.ok(refreshed, "refreshed claim_evidence_v1 entry is written");
    assert.equal(refreshed.researchJobId, 44);
    assert.deepEqual(refreshed.evidenceIds, [101]);
    assert.equal(refreshed.unsupportedCount, 0);
    assert.equal(
      refreshed.claims.some((c) => c.status === "unsupported"),
      false,
    );
    assert.equal(
      revised.attribution.some(
        (e) => e && typeof e === "object" && (e as { kind?: unknown }).kind === "research_evidence",
      ),
      true,
      "preserves non-claim_evidence_v1 provenance entries",
    );
  });

  it("re-audits from prior claim_evidence_v1 even when options.evidence is omitted", async () => {
    const evidence = [
      { id: 201, text: "Async IO improved scan throughput by 28%." },
    ];
    const initialAudit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      payload: {
        text: "Async IO improved scan throughput by 28%. Cost dropped 50%.",
      },
      researchJobId: 55,
      evidence,
    });
    assert.equal(initialAudit.unsupportedCount, 1);

    const prior: Artifact = {
      id: 2,
      userId: 7,
      generationJobId: 11,
      opportunityId: 21,
      format: "x_post",
      channel: "x",
      payload: {
        text: "Async IO improved scan throughput by 28%. Cost dropped 50%.",
      },
      readiness: "draft",
      approvedAt: null,
      supersedesId: null,
      provenance: "generated",
      attribution: [initialAudit],
      attributionReason: null,
      createdAt: new Date(),
    };

    const { store } = makeMemoryArtifactStore([prior]);
    const revised = await createHumanEditRevision(
      prior.id,
      { text: "Async IO improved scan throughput by 28% on NVMe." },
      { artifacts: store },
    );

    const refreshed = findClaimAudit(revised);
    assert.ok(refreshed);
    assert.equal(refreshed.researchJobId, 55);
    assert.deepEqual(refreshed.evidenceIds, [201]);
    assert.equal(refreshed.unsupportedCount, 0);
    assert.equal(refreshed.qualityFlags.includes("paraphrase_heavy"), false);
  });

  it("surfaces uncited numbers and ungrounded first-person war stories introduced in a human edit", async () => {
    const evidence = [
      { id: 301, text: "Iceberg v3 adds deletion vector improvements for large tables." },
    ];
    const cleanAudit = auditArtifactClaims({
      format: "x_post",
      channel: "x",
      payload: { text: "Iceberg v3 improves deletion vectors for large analytical tables." },
      researchJobId: 66,
      evidence,
    });
    assert.equal(cleanAudit.unsupportedCount, 0);

    const prior: Artifact = {
      id: 3,
      userId: 9,
      generationJobId: 12,
      opportunityId: 22,
      format: "x_post",
      channel: "x",
      payload: { text: "Iceberg v3 improves deletion vectors for large analytical tables." },
      readiness: "in_review",
      approvedAt: null,
      supersedesId: null,
      provenance: "generated",
      attribution: [cleanAudit],
      attributionReason: null,
      createdAt: new Date(),
    };

    const { store } = makeMemoryArtifactStore([prior]);
    const revised = await createHumanEditRevision(
      prior.id,
      { text: "We migrated our production cluster last week and cut query latency by 75%." },
      { artifacts: store },
      { evidence },
    );

    const refreshed = findClaimAudit(revised);
    assert.ok(refreshed);
    assert.ok(refreshed.unsupportedCount >= 1);
    assert.ok(refreshed.qualityFlags.includes("ungrounded_first_person"));
    assert.ok(
      refreshed.claims.some(
        (c) => c.status === "unsupported" && /uncited metric\/number.*75%/i.test(c.reason ?? ""),
      ),
    );

    const grounded = await createHumanEditRevision(
      revised.id,
      { text: "We migrated our production cluster last week and cut query latency by 75%." },
      { artifacts: store },
      {
        evidence,
        creatorNotes: "We migrated our production cluster and measured 75% lower query latency.",
      },
    );
    const groundedAudit = findClaimAudit(grounded);
    assert.ok(groundedAudit);
    assert.equal(groundedAudit.unsupportedCount, 0);
    assert.equal(groundedAudit.qualityFlags.includes("ungrounded_first_person"), false);
  });

  it("preserves prior.attribution untouched for legacy artifacts without claim_evidence_v1 and without options.evidence", async () => {
    const legacyAttribution = [
      { kind: "research_evidence", researchJobId: 12, evidenceIds: [5, 6] },
    ];
    const prior: Artifact = {
      id: 4,
      userId: 11,
      generationJobId: 13,
      opportunityId: 23,
      format: "x_post",
      channel: "x",
      payload: { text: "Legacy post copy." },
      readiness: "draft",
      approvedAt: null,
      supersedesId: null,
      provenance: "generated",
      attribution: legacyAttribution,
      attributionReason: null,
      createdAt: new Date(),
    };

    const { store } = makeMemoryArtifactStore([prior]);
    const revised = await createHumanEditRevision(
      prior.id,
      { text: "Edited legacy post copy with 42% metric." },
      { artifacts: store },
    );

    assert.deepEqual(revised.attribution, legacyAttribution);
    assert.equal(findClaimAudit(revised), undefined);
  });
});
