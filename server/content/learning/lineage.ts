import { eq } from "drizzle-orm";
import {
  artifacts,
  generationJobs,
  opportunities,
  publications,
  results,
  stories,
  type Artifact,
  type GenerationJob,
  type Opportunity,
  type Publication,
  type Result,
  type Story,
} from "@shared/schema";
import type { ContentDatabase } from "../storage";

export interface SignalLineage {
  artifact: Artifact | null;
  priorArtifact: Artifact | null;
  publication: Publication | null;
  result: Result | null;
  generationJob: GenerationJob | null;
  generationPolicyId: number | null;
  opportunity: Opportunity | null;
  story: Story | null;
  automationRunId: number | null;
}

export async function resolveLineage(
  db: ContentDatabase,
  input: {
    artifactId?: number | null;
    priorArtifactId?: number | null;
    publicationId?: number | null;
  },
): Promise<SignalLineage> {
  const lineage: SignalLineage = {
    artifact: null,
    priorArtifact: null,
    publication: null,
    result: null,
    generationJob: null,
    generationPolicyId: null,
    opportunity: null,
    story: null,
    automationRunId: null,
  };

  if (input.publicationId) {
    const [publication] = await db
      .select()
      .from(publications)
      .where(eq(publications.id, input.publicationId))
      .limit(1);
    lineage.publication = publication ?? null;
    if (publication) {
      const [result] = await db
        .select()
        .from(results)
        .where(eq(results.publicationId, publication.id))
        .limit(1);
      lineage.result = result ?? null;
      if (!input.artifactId) input = { ...input, artifactId: publication.artifactId };
    }
  }

  if (input.artifactId) {
    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, input.artifactId)).limit(1);
    lineage.artifact = artifact ?? null;
  }
  if (input.priorArtifactId) {
    const [prior] = await db.select().from(artifacts).where(eq(artifacts.id, input.priorArtifactId)).limit(1);
    lineage.priorArtifact = prior ?? null;
  }

  const artifact = lineage.artifact;
  if (artifact?.generationJobId) {
    const [job] = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, artifact.generationJobId))
      .limit(1);
    lineage.generationJob = job ?? null;
    lineage.generationPolicyId = job?.policyId ?? null;
  } else if (lineage.priorArtifact?.generationJobId) {
    const [job] = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, lineage.priorArtifact.generationJobId))
      .limit(1);
    lineage.generationJob = job ?? null;
    lineage.generationPolicyId = job?.policyId ?? null;
  }

  const opportunityId = artifact?.opportunityId ?? lineage.generationJob?.opportunityId;
  if (opportunityId) {
    const [opportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);
    lineage.opportunity = opportunity ?? null;
  }

  if (lineage.opportunity?.storyId) {
    const [story] = await db.select().from(stories).where(eq(stories.id, lineage.opportunity.storyId)).limit(1);
    lineage.story = story ?? null;
    lineage.automationRunId = story?.automationRunId ?? null;
  }

  return lineage;
}

export function lineageToExplain(lineage: SignalLineage): Record<string, unknown> {
  return {
    artifactId: lineage.artifact?.id ?? null,
    priorArtifactId: lineage.priorArtifact?.id ?? null,
    publicationId: lineage.publication?.id ?? null,
    resultId: lineage.result?.id ?? null,
    generationJobId: lineage.generationJob?.id ?? null,
    generationPolicyId: lineage.generationPolicyId,
    opportunityId: lineage.opportunity?.id ?? null,
    storyId: lineage.story?.id ?? null,
    automationRunId: lineage.automationRunId,
  };
}
