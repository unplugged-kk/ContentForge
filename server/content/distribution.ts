/**
 * Multi-channel distribution: one Artifact revision → N Publications.
 *
 * This is a batch composition over existing Schedule → Occurrence → Publication
 * primitives. It does not introduce a second lifecycle owner (no
 * DistributionBatch, MultiChannelArtifact, or ChannelFanoutEngine).
 *
 * Artifact = immutable content revision (format + payload).
 * Publication = channel-specific delivery intent; Publication.channel is
 * authoritative at execution. Artifact.channel is historical origin only.
 *
 * Generation still requires a format profile (`formatChannelError`). Distribution
 * of an existing revision uses `channelSupportsFormat` only, so a compatible
 * `{ text }` payload (x_post / linkedin_post) can be delivered on both X and
 * LinkedIn without cloning the Artifact.
 */

import type { Publication, Schedule } from "@shared/schema";
import { z } from "zod";
import { ArtifactNotFoundError } from "./artifact";
import { channelSupportsFormat, hasChannelAdapter } from "./adapters";
import {
  ArtifactNotSchedulableError,
  createSchedule,
  dispatchDueOccurrences,
  ScheduleInputError,
} from "./scheduling";
import type { ContentStoragePort } from "./storage";

export const publicationTargetSchema = z.object({
  channel: z.string().trim().min(1).max(50),
  startAt: z.string().datetime().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  count: z.number().int().positive().max(1000).optional(),
  recurrence: z.string().trim().min(1).max(200).optional(),
  /** Per-target explicit republish nonce. Distinct from duplicate fan-out. */
  republishKey: z.string().trim().min(1).max(100).optional(),
});

export const publishArtifactToChannelsSchema = z.object({
  targets: z.array(publicationTargetSchema).min(1).max(20),
  /**
   * Batch-level explicit republish nonce applied to every target that does
   * not set its own `republishKey`. Omit for idempotent duplicate fan-out.
   */
  republishKey: z.string().trim().min(1).max(100).optional(),
});

export type PublicationTargetInput = z.input<typeof publicationTargetSchema>;
export type PublishArtifactToChannelsInput = z.input<typeof publishArtifactToChannelsSchema>;

export class DistributionInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid distribution input: ${issues.join("; ")}`);
    this.name = "DistributionInputError";
    this.issues = issues;
  }
}

/**
 * Logical identity for one Artifact revision × channel × schedule shape.
 * Database uniqueness on `schedules.intent_key` is the concurrency arbiter.
 */
export function distributionIntentKey(input: {
  artifactId: number;
  channel: string;
  startAt?: string | null;
  count: number;
  recurrence?: string | null;
  nonce: string;
}): string {
  const start = input.startAt ?? "asap";
  const rec = input.recurrence ?? "once";
  return `dist:${input.artifactId}:${input.channel}:${start}:${input.count}:${rec}:${input.nonce}`;
}

export type DistributionOutcomeStatus = "created" | "reused" | "invalid";

export interface DistributionTargetOutcome {
  channel: string;
  status: DistributionOutcomeStatus;
  schedule?: Schedule;
  publication?: Publication;
  created?: boolean;
  error?: string;
}

export interface DistributionResult {
  artifactId: number;
  outcomes: DistributionTargetOutcome[];
}

export interface DistributionDeps {
  content: ContentStoragePort;
  enqueuePublication?: (publication: Publication) => Promise<boolean>;
  now?: () => Date;
}

function targetError(channel: string, message: string): DistributionTargetOutcome {
  return { channel, status: "invalid", error: message };
}

/**
 * Create independent Schedules (and due Publications) for each target channel
 * against one approved Artifact revision. Partial success: an invalid target
 * does not roll back valid siblings.
 */
export async function publishArtifactToChannels(
  artifactId: number,
  input: PublishArtifactToChannelsInput,
  deps: DistributionDeps,
  callerUserId?: number | null,
): Promise<DistributionResult> {
  if (!Number.isInteger(artifactId) || artifactId <= 0) {
    throw new DistributionInputError(["artifactId must be a positive integer"]);
  }
  const parsed = publishArtifactToChannelsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new DistributionInputError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const body = parsed.data;

  const artifact =
    callerUserId != null
      ? await deps.content.getArtifactForOwner(artifactId, callerUserId)
      : await deps.content.getArtifact(artifactId);
  if (!artifact) throw new ArtifactNotFoundError(artifactId);
  if (artifact.readiness !== "approved") {
    throw new ArtifactNotSchedulableError(artifactId, artifact.readiness);
  }

  const seen = new Set<string>();
  const outcomes: DistributionTargetOutcome[] = [];

  for (const target of body.targets) {
    const nonce = target.republishKey ?? body.republishKey ?? "default";
    const count = target.count ?? 1;
    const intentKey = distributionIntentKey({
      artifactId: artifact.id,
      channel: target.channel,
      startAt: target.startAt ?? null,
      count,
      recurrence: target.recurrence ?? null,
      nonce,
    });
    if (seen.has(intentKey)) {
      const prior = outcomes.find((o) => o.schedule?.intentKey === intentKey);
      outcomes.push({
        channel: target.channel,
        status: prior?.status === "invalid" ? "invalid" : "reused",
        schedule: prior?.schedule,
        publication: prior?.publication,
        created: false,
        error: prior?.error,
      });
      continue;
    }
    seen.add(intentKey);

    if (!hasChannelAdapter(target.channel)) {
      outcomes.push(targetError(target.channel, `channel "${target.channel}" has no registered adapter`));
      continue;
    }
    if (!channelSupportsFormat(target.channel, artifact.format)) {
      outcomes.push(
        targetError(
          target.channel,
          `format "${artifact.format}" cannot be distributed on channel "${target.channel}" — no registered adapter supports it`,
        ),
      );
      continue;
    }

    try {
      const before = await deps.content.getScheduleByIntentKey(intentKey);
      const schedule = await createSchedule(
        artifact.id,
        {
          startAt: target.startAt,
          timezone: target.timezone,
          count: target.count,
          recurrence: target.recurrence,
          channel: target.channel,
          intentKey,
        },
        { content: deps.content },
      );
      const created = !before;
      outcomes.push({
        channel: target.channel,
        status: created ? "created" : "reused",
        schedule,
        created,
      });
    } catch (error) {
      if (error instanceof ScheduleInputError) {
        outcomes.push(targetError(target.channel, error.message));
        continue;
      }
      throw error;
    }
  }

  if (deps.enqueuePublication) {
    await dispatchDueOccurrences(
      deps.now ? deps.now() : new Date(),
      { content: deps.content, enqueuePublication: deps.enqueuePublication },
      100,
    );
  }

  const publications = await deps.content.listPublicationsByArtifact(artifact.id);
  for (const outcome of outcomes) {
    if (!outcome.schedule) continue;
    const match = publications.find((p) => p.scheduleId === outcome.schedule!.id);
    if (match) outcome.publication = match;
  }

  return { artifactId: artifact.id, outcomes };
}
