import { eq } from "drizzle-orm";
import { publications } from "@shared/schema";
import type { Artifact, Publication, Result } from "@shared/schema";
import type { ContentDatabase, JsonRecord } from "../storage";
import { db as defaultDb } from "../../db";
import {
  APPROVAL_SCHEMA_VERSION,
  EDIT_SCHEMA_VERSION,
  LEARNING_SCHEMA_VERSION,
  PUBLICATION_SCHEMA_VERSION,
} from "./constants";
import { deriveApprovalDecision, derivedKindForApproval } from "./approval";
import { deriveEditMetrics } from "./edit";
import { learningIdentityKey } from "./identity";
import { lineageToExplain, resolveLineage } from "./lineage";
import { derivedIdentity, type LearningStoragePort } from "./store";

export interface LearningRecorder {
  recordEdit(prior: Artifact, next: Artifact): Promise<void>;
  recordApproval(artifact: Artifact, chain: Artifact[]): Promise<void>;
  recordPublication(publication: Publication, result: Result | null): Promise<void>;
}

export function createLearningRecorder(
  store: LearningStoragePort,
  database: ContentDatabase = defaultDb,
): LearningRecorder {
  return {
    async recordEdit(prior, next) {
      const metrics = deriveEditMetrics(prior.payload as JsonRecord, next.payload as JsonRecord);
      const lineage = await resolveLineage(database, {
        artifactId: next.id,
        priorArtifactId: prior.id,
      });
      const priorPubs = await database
        .select({ state: publications.state })
        .from(publications)
        .where(eq(publications.artifactId, prior.id));
      const published = priorPubs.some((p) => p.state === "published");
      const observedAt = next.createdAt ?? new Date();
      const payload = {
        kind: "edit",
        ...metrics,
        beforeApproval: prior.readiness !== "approved",
        beforePublication: !published,
        lineage: lineageToExplain(lineage),
      };
      const { row } = await store.insertLearningSignal({
        userId: next.userId ?? prior.userId ?? null,
        signalType: "edit",
        sourceType: "artifact_revision",
        sourceId: next.id,
        artifactId: next.id,
        priorArtifactId: prior.id,
        publicationId: null,
        resultId: null,
        performanceSignalId: null,
        generationJobId: lineage.generationJob?.id ?? prior.generationJobId ?? null,
        generationPolicyId: lineage.generationPolicyId,
        opportunityId: next.opportunityId,
        storyId: lineage.story?.id ?? null,
        automationRunId: lineage.automationRunId,
        channel: next.channel,
        format: next.format,
        observedAt,
        schemaVersion: EDIT_SCHEMA_VERSION,
        payload,
        confidence: "observed",
        identityKey: learningIdentityKey(["v1", "edit", next.id]),
      });
      if (metrics.substantial) {
        await store.insertLearningSignal({
          userId: row.userId,
          signalType: "derived",
          sourceType: "artifact_revision",
          sourceId: next.id,
          artifactId: next.id,
          priorArtifactId: prior.id,
          publicationId: null,
          resultId: null,
          performanceSignalId: null,
          generationJobId: row.generationJobId,
          generationPolicyId: row.generationPolicyId,
          opportunityId: row.opportunityId,
          storyId: row.storyId,
          automationRunId: row.automationRunId,
          channel: next.channel,
          format: next.format,
          observedAt,
          schemaVersion: LEARNING_SCHEMA_VERSION,
          payload: { kind: "edit_required", editSignalId: row.id, lineage: lineageToExplain(lineage) },
          confidence: "observed",
          identityKey: derivedIdentity("edit_required", next.id, observedAt),
        });
      }
    },

    async recordApproval(artifact, chain) {
      const decision = deriveApprovalDecision(artifact, chain);
      const lineage = await resolveLineage(database, { artifactId: artifact.id });
      const observedAt = artifact.approvedAt ?? new Date();
      const payload = {
        kind: decision,
        rejected: artifact.readiness === "rejected",
        revisionCount: chain.length,
        humanEditCount: chain.filter((a) => a.provenance === "human_edit").length,
        lineage: lineageToExplain(lineage),
      };
      const { row } = await store.insertLearningSignal({
        userId: artifact.userId ?? null,
        signalType: "approval",
        sourceType: "artifact_revision",
        sourceId: artifact.id,
        artifactId: artifact.id,
        priorArtifactId: artifact.supersedesId,
        publicationId: null,
        resultId: null,
        performanceSignalId: null,
        generationJobId: lineage.generationJob?.id ?? artifact.generationJobId,
        generationPolicyId: lineage.generationPolicyId,
        opportunityId: artifact.opportunityId,
        storyId: lineage.story?.id ?? null,
        automationRunId: lineage.automationRunId,
        channel: artifact.channel,
        format: artifact.format,
        observedAt,
        schemaVersion: APPROVAL_SCHEMA_VERSION,
        payload,
        confidence: "observed",
        identityKey: learningIdentityKey(["v1", "approval", artifact.id, artifact.readiness, decision]),
      });
      const derived = derivedKindForApproval(decision);
      if (derived) {
        await store.insertLearningSignal({
          userId: row.userId,
          signalType: "derived",
          sourceType: "artifact_revision",
          sourceId: artifact.id,
          artifactId: artifact.id,
          priorArtifactId: artifact.supersedesId,
          publicationId: null,
          resultId: null,
          performanceSignalId: null,
          generationJobId: row.generationJobId,
          generationPolicyId: row.generationPolicyId,
          opportunityId: row.opportunityId,
          storyId: row.storyId,
          automationRunId: row.automationRunId,
          channel: artifact.channel,
          format: artifact.format,
          observedAt,
          schemaVersion: LEARNING_SCHEMA_VERSION,
          payload: { kind: derived, approvalSignalId: row.id, decision, lineage: lineageToExplain(lineage) },
          confidence: "observed",
          identityKey: derivedIdentity(derived, artifact.id, observedAt),
        });
      }
    },

    async recordPublication(publication, result) {
      const lineage = await resolveLineage(database, {
        publicationId: publication.id,
        artifactId: publication.artifactId,
      });
      const observedAt = result?.publishedAt ?? publication.updatedAt ?? new Date();
      const payload = {
        kind: "publication",
        status: publication.state,
        resultOutcome: result?.outcome ?? null,
        externalId: publication.externalId ?? result?.externalId ?? null,
        publishedAt: result?.publishedAt?.toISOString() ?? null,
        lineage: lineageToExplain(lineage),
      };
      const { row } = await store.insertLearningSignal({
        userId: publication.userId ?? null,
        signalType: "publication",
        sourceType: "publication",
        sourceId: publication.id,
        artifactId: publication.artifactId,
        priorArtifactId: null,
        publicationId: publication.id,
        resultId: result?.id ?? lineage.result?.id ?? null,
        performanceSignalId: null,
        generationJobId: lineage.generationJob?.id ?? null,
        generationPolicyId: lineage.generationPolicyId,
        opportunityId: lineage.opportunity?.id ?? null,
        storyId: lineage.story?.id ?? null,
        automationRunId: lineage.automationRunId,
        channel: publication.channel,
        format: lineage.artifact?.format ?? null,
        observedAt,
        schemaVersion: PUBLICATION_SCHEMA_VERSION,
        payload,
        confidence: "observed",
        identityKey: learningIdentityKey(["v1", "publication", publication.id]),
      });
      if (publication.state === "published" && result?.outcome === "published") {
        await store.insertLearningSignal({
          userId: row.userId,
          signalType: "derived",
          sourceType: "publication",
          sourceId: publication.id,
          artifactId: publication.artifactId,
          priorArtifactId: null,
          publicationId: publication.id,
          resultId: row.resultId,
          performanceSignalId: null,
          generationJobId: row.generationJobId,
          generationPolicyId: row.generationPolicyId,
          opportunityId: row.opportunityId,
          storyId: row.storyId,
          automationRunId: row.automationRunId,
          channel: publication.channel,
          format: row.format,
          observedAt,
          schemaVersion: LEARNING_SCHEMA_VERSION,
          payload: { kind: "publication_success", publicationSignalId: row.id, lineage: lineageToExplain(lineage) },
          confidence: "observed",
          identityKey: derivedIdentity("publication_success", publication.id, observedAt),
        });
      }
    },
  };
}
