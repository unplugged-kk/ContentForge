/**
 * Manual publish logging for export-first artifacts (INC-08).
 *
 * Operators who copy or export an approved artifact and publish it outside
 * ContentForge (for example directly on X, LinkedIn, or Substack) still need a
 * canonical Publication + Result row so `POST /api/learning/publications/:id/observations`
 * and weekly cohort digests can track performance without a parallel table.
 *
 * Invariants:
 *   - Enforces owner scoping (foreign or missing artifacts throw ArtifactNotFoundError).
 *   - Preserves the approval gate: only `readiness === "approved"` artifacts qualify.
 *   - Zero external provider calls (`providerCalled: false`); Schedule is marked
 *     `exhausted` and Occurrence `published` so the background scheduler never
 *     attempts to dispatch it.
 *   - Idempotent per `(artifactId, externalUrl)` or explicit `idempotencyKey`.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Artifact, Publication, Result, Schedule, ScheduleOccurrence } from "@shared/schema";
import { sha256 } from "../utils/hash";
import { ArtifactNotFoundError } from "./artifact";
import {
  ArtifactNotSchedulableError,
  MANUAL_SCHEDULE_INTENT_PREFIX,
  publicationIdempotencyKey,
} from "./scheduling";
import type { ContentStoragePort, JsonRecord } from "./storage";

export const MANUAL_PUBLISH_HOOK_TYPES = [
  "contrarian",
  "metric",
  "story",
  "how_to",
  "question",
  "other",
] as const;

export type ManualPublishHookType = (typeof MANUAL_PUBLISH_HOOK_TYPES)[number];

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export const manualPublishInputSchema = z.object({
  externalUrl: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine(isValidHttpUrl, { message: "externalUrl must be a valid http or https URL" })
    .optional(),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  topicTag: z.string().trim().min(1).max(120).optional(),
  hookType: z.enum(MANUAL_PUBLISH_HOOK_TYPES).optional(),
  notes: z.string().trim().min(1).max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
});

export type ManualPublishInput = z.input<typeof manualPublishInputSchema>;

export class ManualPublishInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid manual publish input: ${issues.join("; ")}`);
    this.name = "ManualPublishInputError";
    this.issues = issues;
  }
}

export interface ManualPublishDeps {
  content: ContentStoragePort;
  learning?: import("./learning/record").LearningRecorder;
  now?: () => Date;
}

export interface ManualPublishOutcome {
  artifact: Artifact;
  schedule: Schedule;
  occurrence: ScheduleOccurrence;
  publication: Publication;
  result: Result | null;
  created: boolean;
}

export function manualPublishIntentKey(input: {
  artifactId: number;
  externalUrl?: string | null;
  idempotencyKey?: string | null;
}): string {
  if (input.idempotencyKey) {
    return `${MANUAL_SCHEDULE_INTENT_PREFIX}${input.artifactId}:key:${sha256(input.idempotencyKey).slice(0, 40)}`;
  }
  if (input.externalUrl) {
    return `${MANUAL_SCHEDULE_INTENT_PREFIX}${input.artifactId}:url:${sha256(input.externalUrl).slice(0, 40)}`;
  }
  return `${MANUAL_SCHEDULE_INTENT_PREFIX}${input.artifactId}:default`;
}

/**
 * Record an external manual publication of an approved artifact using the
 * canonical Schedule → Occurrence → Publication → Result chain.
 */
export async function logManualPublication(
  artifactId: number,
  ownerId: number,
  input: ManualPublishInput,
  deps: ManualPublishDeps,
): Promise<ManualPublishOutcome> {
  if (!Number.isInteger(artifactId) || artifactId <= 0) {
    throw new ManualPublishInputError(["artifactId must be a positive integer"]);
  }
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    throw new ManualPublishInputError(["ownerId must be a positive integer"]);
  }

  const parsed = manualPublishInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ManualPublishInputError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const body = parsed.data;

  const artifact = await deps.content.getArtifact(artifactId);
  if (!artifact || (artifact.userId !== ownerId)) {
    throw new ArtifactNotFoundError(artifactId);
  }
  if (artifact.readiness !== "approved") {
    throw new ArtifactNotSchedulableError(artifact.id, artifact.readiness);
  }

  const normalizedUrl = body.externalUrl ? new URL(body.externalUrl).toString() : null;
  const publishedAt = body.publishedAt ? new Date(body.publishedAt) : (deps.now?.() ?? new Date());
  const intentKey = manualPublishIntentKey({
    artifactId: artifact.id,
    externalUrl: normalizedUrl,
    idempotencyKey: body.idempotencyKey ?? null,
  });

  const resolvedUserId = artifact.userId ?? ownerId;

  const { schedule } = await deps.content.claimSchedule({
    userId: resolvedUserId,
    artifactId: artifact.id,
    channel: artifact.channel,
    intentKey,
    recurrence: null,
    timezone: "UTC",
    count: 1,
    startAt: publishedAt,
    status: "exhausted",
  });
  if (schedule.status !== "exhausted") {
    await deps.content.setScheduleStatus(schedule.id, "exhausted");
  }

  // Always materialize against `schedule.startAt` so an idempotent replay
  // converges on the exact same (scheduleId, occurrenceTime) row even if
  // `publishedAt` was omitted on the second request.
  const occurrence = await deps.content.materializeOccurrence(schedule.id, schedule.startAt);
  if (!occurrence) {
    throw new Error(`Could not materialize manual occurrence for schedule ${schedule.id}`);
  }
  if (occurrence.status !== "published") {
    await deps.content.markOccurrenceStatus(occurrence.id, "published");
  }

  const pubKey = publicationIdempotencyKey({
    scheduleId: schedule.id,
    occurrenceId: occurrence.id,
    artifactId: artifact.id,
  });
  const { publication: claimedPub, created } = await deps.content.claimPublication({
    userId: resolvedUserId,
    scheduleId: schedule.id,
    occurrenceId: occurrence.id,
    artifactId: artifact.id,
    channel: artifact.channel,
    idempotencyKey: pubKey,
    correlationId: randomUUID(),
  });

  if (claimedPub.state !== "published" || claimedPub.providerCalled) {
    await deps.content.updatePublication(claimedPub.id, {
      state: "published",
      providerCalled: false,
      externalId: normalizedUrl,
      lastError: null,
      releaseLease: true,
    });
  }

  const rawResponse: JsonRecord = {
    source: "manual",
    ...(body.topicTag ? { topicTag: body.topicTag } : {}),
    ...(body.hookType ? { hookType: body.hookType } : {}),
    ...(body.notes ? { notes: body.notes } : {}),
  };

  const resultMetrics: JsonRecord = {
    source: "manual",
    rawResponse,
    ...(body.topicTag ? { topicTag: body.topicTag } : {}),
    ...(body.hookType ? { hookType: body.hookType } : {}),
    ...(body.notes ? { notes: body.notes } : {}),
  };

  const result =
    (await deps.content.insertResult({
      userId: resolvedUserId,
      publicationId: claimedPub.id,
      outcome: "published",
      externalId: normalizedUrl,
      externalUrl: normalizedUrl,
      publishedAt: schedule.startAt,
      metrics: resultMetrics,
      source: "manual",
      errorClass: null,
      errorMessage: null,
      correlationId: claimedPub.correlationId,
    })) ??
    (await deps.content.getResultByPublication(claimedPub.id)) ??
    null;

  const publication: Publication =
    (await deps.content.getPublication(claimedPub.id)) ?? {
      ...claimedPub,
      state: "published",
      providerCalled: false,
      externalId: normalizedUrl,
    };

  if (created && deps.learning) {
    await deps.learning.recordPublication(publication, result);
  }

  return {
    artifact,
    schedule: { ...schedule, status: "exhausted" },
    occurrence: { ...occurrence, status: "published" },
    publication,
    result,
    created,
  };
}
