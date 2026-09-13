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
 * Recurrence (Phase 4): a bounded fixed-interval grammar, not RRULE/cron —
 * `every:<n><unit>` (unit one of m/h/d/w), e.g. `every:1d`, `every:6h`. The
 * n-th occurrence's time is `startAt + n * interval`, computed once at create
 * time in absolute (UTC instant) terms — the same way one-shot `startAt`
 * already works. `timezone` remains stored metadata only (as it already was
 * for one-shot); this phase does not add calendar-aware/DST-aware recurrence,
 * since nothing in the existing model resolved wall-clock time from it either.
 *
 * The durable "next occurrence index" is derived, not stored: it is the count
 * of ScheduleOccurrence rows already materialized for the schedule. No mutable
 * cursor column exists or is needed — `(schedule_id, occurrence_time)` stays
 * the single unique arbiter, so two concurrent ticks computing the same next
 * index and the same next time collapse to one row exactly as one-shot always
 * has (see `materializeOccurrence`'s `onConflictDoNothing`).
 *
 * Catch-up policy: at most one occurrence is materialized per schedule per
 * tick, oldest-due-first (the derived index always points at the next
 * unmaterialized slot). A schedule that missed N slots while the scheduler was
 * offline catches up one slot per tick until it reaches `now`, then resumes
 * normal cadence — bounded by `schedule.count`, never backfilled in a single
 * burst, never silently skipped.
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

/** `every:<n><unit>` — bounded fixed-interval recurrence, not RRULE/cron. */
const RECURRENCE_PATTERN = /^every:([1-9][0-9]{0,3})(m|h|d|w)$/;
const RECURRENCE_UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};
const RECURRENCE_MAX_MS = 90 * RECURRENCE_UNIT_MS.d;

/** Parse `recurrence` into a fixed millisecond interval, or throw. */
export function parseRecurrenceIntervalMs(recurrence: string): number {
  const match = RECURRENCE_PATTERN.exec(recurrence);
  if (!match) {
    throw new ScheduleInputError([
      `recurrence must match "every:<n><unit>" (unit one of m/h/d/w), got "${recurrence}"`,
    ]);
  }
  const ms = Number(match[1]) * RECURRENCE_UNIT_MS[match[2]];
  if (ms > RECURRENCE_MAX_MS) {
    throw new ScheduleInputError([`recurrence interval too large (max 90 days), got "${recurrence}"`]);
  }
  return ms;
}

/**
 * The absolute time of the `index`-th occurrence (0-based) in a series.
 * One-shot schedules (`recurrence === null`) only ever have index 0.
 */
export function computeOccurrenceTime(
  schedule: Pick<Schedule, "startAt" | "recurrence">,
  index: number,
): Date {
  if (!schedule.recurrence) {
    if (index !== 0) throw new Error("one-shot schedule has no occurrence beyond index 0");
    return schedule.startAt;
  }
  const intervalMs = parseRecurrenceIntervalMs(schedule.recurrence);
  return new Date(schedule.startAt.getTime() + index * intervalMs);
}

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
    // Throws ScheduleInputError on malformed/out-of-range recurrence.
    parseRecurrenceIntervalMs(body.recurrence);
    if (body.count < 2) {
      throw new ScheduleInputError([
        "recurrence requires count >= 2 (omit recurrence for a one-shot schedule)",
      ]);
    }
  } else if (body.count !== 1) {
    throw new ScheduleInputError([
      "only count = 1 (one-shot) schedules are supported without recurrence",
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
    recurrence: body.recurrence ?? null,
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

  // Materialize: for each active schedule, the next unmaterialized slot (the
  // count of existing occurrences is the durable index — see module docs). At
  // most one slot per schedule per tick, so an offline catch-up drains
  // one-slot-per-tick rather than bursting. `(schedule_id, occurrence_time)`
  // makes this idempotent under overlapping ticks.
  const active = await deps.content.listActiveSchedules(now, limit);
  for (const schedule of active) {
    const existingCount = await deps.content.countOccurrences(schedule.id);
    if (existingCount >= schedule.count) continue; // series fully materialized

    const nextTime = computeOccurrenceTime(schedule, existingCount);
    if (nextTime.getTime() > now.getTime()) continue; // next slot not due yet

    const created = await deps.content.materializeOccurrence(schedule.id, nextTime);
    if (created) {
      result.materialized += 1;
      if (existingCount + 1 >= schedule.count) {
        await deps.content.setScheduleStatus(schedule.id, "exhausted");
      }
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
