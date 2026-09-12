/**
 * Publication boundary: Publication → Channel Adapter → Result.
 *
 * A Publication is one distribution attempt binding (schedule × occurrence ×
 * exact artifact revision) to a channel adapter (Ticket 03 §1, 07). It owns:
 *   • durable idempotency — the unique key is the arbiter, not a check-then-act
 *   • a single-flight publishing lease — two workers can never both publish it
 *   • reconcile-first unknown handling — an external request that was sent is
 *     NEVER assumed to have succeeded, and is never blindly retried (a partial
 *     thread cannot be un-sent).
 */

import type { Publication } from "@shared/schema";
import { JobFailure } from "../jobs/failures";
import { getChannelAdapter, type ChannelAdapter } from "./adapters";
import type { ContentStoragePort, JsonRecord } from "./storage";

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export interface PublicationDeps {
  content: ContentStoragePort;
  /** Overridable for tests; defaults to the channel adapter registry. */
  adapterFor?: (channel: string) => ChannelAdapter;
  now?: () => Date;
  leaseMs?: number;
  /** Identifies this worker for the lease. */
  owner?: string;
}

export type PublicationRunStatus = "published" | "failed" | "retry" | "skipped";

export interface PublicationRunResult {
  publicationId: number;
  status: PublicationRunStatus;
  reused: boolean;
  externalId?: string | null;
  externalUrl?: string | null;
  failureClass?: string;
  message?: string;
}

function adapterFor(channel: string, deps: PublicationDeps): ChannelAdapter {
  return deps.adapterFor ? deps.adapterFor(channel) : getChannelAdapter(channel);
}

/**
 * Execute one Publication. Safe to call for a duplicate queue delivery: an
 * already-published row is a no-op, and an already-*invoked* row is reconciled
 * rather than re-sent.
 */
export async function runPublication(
  publicationId: number,
  deps: PublicationDeps,
): Promise<PublicationRunResult> {
  const now = deps.now ?? (() => new Date());
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const owner = deps.owner ?? "publication-worker";

  const publication = await deps.content.getPublication(publicationId);
  if (!publication) throw JobFailure.permanent(`Publication ${publicationId} not found`);

  if (publication.state === "published") {
    return {
      publicationId,
      status: "published",
      reused: true,
      externalId: publication.externalId,
    };
  }
  if (publication.state === "cancelled") {
    return { publicationId, status: "skipped", reused: true, message: "cancelled" };
  }

  // The scheduler only ever sees approved revisions; verify the pinned revision
  // still qualifies before any external call.
  const artifact = await deps.content.getArtifact(publication.artifactId);
  if (!artifact) {
    return await recordTerminal(publication, deps, {
      failureClass: "permanent",
      message: `Artifact ${publication.artifactId} not found`,
    });
  }
  if (artifact.readiness !== "approved") {
    return await recordTerminal(publication, deps, {
      failureClass: "policy_human",
      message: `Artifact ${artifact.id} is "${artifact.readiness}"; only approved revisions may publish`,
    });
  }

  // Reconcile-first: a previous attempt already invoked the transport but never
  // reached a known outcome. Re-sending could duplicate a (partial) thread, so
  // record an `unknown` Result for operator reconciliation instead.
  if (publication.providerCalled) {
    await deps.content.updatePublication(publication.id, {
      state: "failed",
      lastError: "reconcile_required: transport was invoked without a confirmed outcome",
      releaseLease: true,
    });
    await deps.content.insertResult({
      userId: publication.userId ?? null,
      publicationId: publication.id,
      outcome: "unknown",
      externalId: publication.externalId,
      externalUrl: null,
      publishedAt: null,
      metrics: {},
      source: publication.channel,
      errorClass: "unknown",
      errorMessage: "reconcile_required",
      correlationId: publication.correlationId,
    });
    return {
      publicationId,
      status: "failed",
      reused: true,
      failureClass: "unknown",
      message: "reconcile_required",
    };
  }

  const leased = await deps.content.acquirePublicationLease(publication.id, owner, leaseMs);
  if (!leased) {
    // Another worker holds the lease — not an error, and not a retry.
    return { publicationId, status: "skipped", reused: true, message: "lease held" };
  }

  let adapter: ChannelAdapter;
  try {
    adapter = adapterFor(leased.channel, deps);
  } catch (error) {
    return await recordTerminal(leased, deps, {
      failureClass: "permanent",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const outcome = await adapter.publish({
    format: artifact.format,
    channel: leased.channel,
    payload: artifact.payload as JsonRecord,
    correlationId: leased.correlationId,
    externalId: leased.externalId,
  });

  if (outcome.ok) {
    await deps.content.updatePublication(leased.id, {
      state: "published",
      providerCalled: true,
      externalId: outcome.externalId,
      lastError: null,
      releaseLease: true,
    });
    await deps.content.insertResult({
      userId: leased.userId ?? null,
      publicationId: leased.id,
      outcome: "published",
      externalId: outcome.externalId,
      externalUrl: outcome.externalUrl,
      publishedAt: outcome.publishedAt ?? now(),
      metrics: outcome.metrics ?? {},
      source: leased.channel,
      errorClass: null,
      errorMessage: null,
      correlationId: leased.correlationId,
    });
    await deps.content.markOccurrenceStatus(leased.occurrenceId, "published");

    // A one-shot series is complete once its single occurrence publishes.
    const schedule = await deps.content.getSchedule(leased.scheduleId);
    if (schedule && schedule.count <= 1) {
      await deps.content.setScheduleStatus(schedule.id, "exhausted");
    }

    return {
      publicationId: leased.id,
      status: "published",
      reused: false,
      externalId: outcome.externalId,
      externalUrl: outcome.externalUrl,
    };
  }

  // The transport was invoked but the outcome is not a clean failure (partial
  // thread, ambiguous error) — never retry into a duplicate.
  if (outcome.providerCalled) {
    await deps.content.updatePublication(leased.id, {
      state: "failed",
      providerCalled: true,
      lastError: outcome.errorMessage ?? "reconcile_required",
      releaseLease: true,
    });
    await deps.content.insertResult({
      userId: leased.userId ?? null,
      publicationId: leased.id,
      outcome: "unknown",
      externalId: null,
      externalUrl: null,
      publishedAt: null,
      metrics: {},
      source: leased.channel,
      errorClass: "unknown",
      errorMessage: outcome.errorMessage ?? "reconcile_required",
      correlationId: leased.correlationId,
    });
    return {
      publicationId: leased.id,
      status: "failed",
      reused: false,
      failureClass: "unknown",
      message: outcome.errorMessage ?? "reconcile_required",
    };
  }

  const failureClass = outcome.errorClass ?? "permanent";
  const message = outcome.errorMessage ?? "publication failed";

  if (failureClass === "transient") {
    await deps.content.updatePublication(leased.id, {
      state: "queued",
      providerCalled: false,
      lastError: message,
      releaseLease: true,
    });
    throw JobFailure.transient(message);
  }

  return await recordTerminal(leased, deps, { failureClass, message });
}

async function recordTerminal(
  publication: Publication,
  deps: PublicationDeps,
  failure: { failureClass: string; message: string },
): Promise<PublicationRunResult> {
  await deps.content.updatePublication(publication.id, {
    state: "failed",
    lastError: failure.message,
    releaseLease: true,
  });
  await deps.content.insertResult({
    userId: publication.userId ?? null,
    publicationId: publication.id,
    outcome: "failed",
    externalId: null,
    externalUrl: null,
    publishedAt: null,
    metrics: {},
    source: publication.channel,
    errorClass: failure.failureClass,
    errorMessage: failure.message,
    correlationId: publication.correlationId,
  });
  return {
    publicationId: publication.id,
    status: "failed",
    reused: false,
    failureClass: failure.failureClass,
    message: failure.message,
  };
}

/**
 * Reconcile-first housekeeping: a lease that expired without an outcome means
 * the worker died mid-flight. The transport may or may not have been invoked, so
 * the publication is parked as an `unknown` Result for a human/operator rather
 * than retried blindly.
 */
export async function reconcileStalePublications(
  now: Date,
  deps: PublicationDeps,
  limit = 50,
): Promise<number> {
  const stale = await deps.content.listStalePublishing(now, limit);
  for (const publication of stale) {
    await recordTerminal(publication, deps, {
      failureClass: "unknown",
      message: "lease expired without an outcome; reconcile_required",
    });
  }
  return stale.length;
}
