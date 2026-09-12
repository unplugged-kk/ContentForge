/**
 * Schedule boundary: approved Artifact → Schedule (series) → Occurrence.
 *
 * A Schedule is the *intent* to publish one exact approved Artifact revision;
 * Occurrences are the concrete execution instances materialized from it
 * (Ticket 03 §1). A one-shot is a series with `count = 1`.
 *
 * The scheduler owns WHEN. It never publishes: it materializes due occurrences
 * and enqueues `publication.run`, so the scheduler cannot scan every post every
 * minute and cannot become a second publisher.
 *
 * Phase B supports one-shot schedules only. Recurrence strings are stored but
 * not expanded yet — expanding RRULEs is deliberately left as future work rather
 * than inventing interval semantics here.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Artifact, Publication, Schedule, ScheduleOccurrence } from "@shared/schema";
import type { ContentStoragePort } from "./storage";

export interface SchedulingDeps {
  content: ContentStoragePort;
}

export class ScheduleInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid schedule input: ${issues.join("; ")}`);
    this.name = "ScheduleInputError";
    this.issues = issues;
  }
}

export class ArtifactNotSchedulableError extends Error {
  constructor(
    readonly artifactId: number,
    readonly readiness: string,
  ) {
    super(`Artifact ${artifactId} is "${readiness}"; only approved revisions can be scheduled`);
    this.name = "ArtifactNotSchedulableError";
  }
}

export class ScheduleNotFoundError extends Error {
  constructor(readonly scheduleId: number) {
    super(`Schedule ${scheduleId} not found`);
    this.name = "ScheduleNotFoundError";
  }
}

export const createScheduleSchema = z.object({
  startAt: z.string().datetime().optional(),
  timezone: z.string().trim().min(1).max(64).default("UTC"),
  count: z.number().int().positive().max(1000).default(1),
  recurrence: z.string().trim().min(1).max(200).optional(),
});

export type CreateScheduleInput = z.input<typeof createScheduleSchema>;

/**
 * Create the intent to publish an approved Artifact revision. Rejected artifacts
 * (and drafts/in-review) are refused here — the scheduler only ever sees
 * approved content.
 */
export async function createSchedule(
  artifactId: number,
  input: CreateScheduleInput,
  deps: SchedulingDeps,
): Promise<Schedule> {
  if (!Number.isInteger(artifactId) || artifactId <= 0) {
    throw new ScheduleInputError(["artifactId must be a positive integer"]);
  }
  const parsed = createScheduleSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ScheduleInputError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const body = parsed.data;

  if (body.recurrence) {
    throw new ScheduleInputError([
      "recurrence is not supported yet; Phase B materializes one-shot schedules (count = 1)",
    ]);
  }
  if (body.count !== 1) {
    throw new ScheduleInputError([
      "only count = 1 (one-shot) schedules are supported in Phase B",
    ]);
  }

  const artifact = await deps.content.getArtifact(artifactId);
  if (!artifact) throw new ArtifactNotSchedulableError(artifactId, "missing");
  if (artifact.readiness !== "approved") {
    throw new ArtifactNotSchedulableError(artifactId, artifact.readiness);
  }

  const startAt = body.startAt ? new Date(body.startAt) : new Date();
  return deps.content.insertSchedule({
    userId: artifact.userId ?? null,
    artifactId: artifact.id,
    channel: artifact.channel,
    recurrence: null,
    timezone: body.timezone,
    count: body.count,
    startAt,
  });
}

/**
 * Durable publication identity: schedule × occurrence × artifact revision
 * (Ticket 03 §1 / 07). The same occurrence can never publish the same revision
 * twice, even when two workers race — the unique constraint is the arbiter.
 */
export function publicationIdempotencyKey(input: {
  scheduleId: number;
  occurrenceId: number;
  artifactId: number;
}): string {
  return `publication:${input.scheduleId}:${input.occurrenceId}:${input.artifactId}`;
}

export interface DispatchDeps {
  content: ContentStoragePort;
  /** Enqueue the publication worker (pg-boss). Never publish inline. */
  enqueuePublication: (publication: Publication) => Promise<boolean>;
}

export interface DispatchResult {
  materialized: number;
  enqueued: number;
  publications: Publication[];
}

/**
 * One scheduler tick: materialize due one-shot occurrences, then create and
 * enqueue Publications for them. Idempotent — re-running creates nothing new.
 */
export async function dispatchDueOccurrences(
  now: Date,
  deps: DispatchDeps,
  limit = 50,
): Promise<DispatchResult> {
  const result: DispatchResult = { materialized: 0, enqueued: 0, publications: [] };

  // Materialize: an active one-shot whose start time has arrived but which has
  // no occurrence yet. `(schedule_id, occurrence_time)` makes this idempotent.
  const active = await deps.content.listActiveSchedules(now, limit);
  for (const schedule of active) {
    const existing = await deps.content.getOccurrenceByScheduleTime(schedule.id, schedule.startAt);
    if (!existing) {
      const created = await deps.content.materializeOccurrence(schedule.id, schedule.startAt);
      if (created) result.materialized += 1;
    }
  }

  const due = await deps.content.listDueOccurrences(now, limit);
  for (const occurrence of due) {
    // Claim the occurrence first (compare-and-set), so of two overlapping
    // scheduler ticks exactly one proceeds. `enqueued` rows are re-processed
    // (not re-claimed) so a crash before enqueue self-heals.
    if (occurrence.status === "pending") {
      const claimed = await deps.content.markOccurrenceStatusIf(
        occurrence.id,
        "pending",
        "enqueued",
      );
      if (!claimed) continue;
    }

    const publication = await ensurePublicationForOccurrence(occurrence, deps);
    // Only the caller that actually created the Publication enqueues it; the
    // UNIQUE (schedule × occurrence × artifact revision) key is the arbiter.
    if (!publication) continue;

    const enqueued = await deps.enqueuePublication(publication);
    if (enqueued) result.enqueued += 1;
    result.publications.push(publication);
  }

  return result;
}

/** Create the Publication that binds this occurrence (returns it only when created). */
async function ensurePublicationForOccurrence(
  occurrence: ScheduleOccurrence,
  deps: DispatchDeps,
): Promise<Publication | undefined> {
  if (occurrence.status === "published" || occurrence.status === "cancelled") return undefined;

  const schedule = await deps.content.getSchedule(occurrence.scheduleId);
  if (!schedule) return undefined;
  if (schedule.status === "cancelled" || schedule.status === "paused") return undefined;

  const artifact = await deps.content.getArtifact(schedule.artifactId);
  if (!artifact) return undefined;

  const { publication, created } = await deps.content.claimPublication({
    userId: schedule.userId ?? null,
    scheduleId: schedule.id,
    occurrenceId: occurrence.id,
    artifactId: artifact.id,
    channel: schedule.channel,
    idempotencyKey: publicationIdempotencyKey({
      scheduleId: schedule.id,
      occurrenceId: occurrence.id,
      artifactId: artifact.id,
    }),
    correlationId: randomUUID(),
  });

  // Not created → another tick already produced it (it enqueues, not us).
  return created ? publication : undefined;
}

export type { Artifact, Schedule, ScheduleOccurrence };
