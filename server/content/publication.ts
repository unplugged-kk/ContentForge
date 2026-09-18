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

import type { Artifact, Publication } from "@shared/schema";
import { JobFailure } from "../jobs/failures";
import { payloadSchemaRegistry } from "../artifacts/payloadSchemas";
import { getChannelAdapter, type ChannelAdapter, type PublishMedia, type PublishOutcome } from "./adapters";
import type { AssetStoragePort } from "./visual";
import type { ContentStoragePort, JsonRecord } from "./storage";

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export interface PublicationDeps {
  content: ContentStoragePort;
  /**
   * Resolves pinned visual media bytes. Optional at the type level so
   * text-only callers/tests need not supply it; a format that carries media
   * fails cleanly (never silently) when it is absent.
   */
  storage?: AssetStoragePort;
  /** Overridable for tests; defaults to the channel adapter registry. */
  adapterFor?: (channel: string) => ChannelAdapter;
  now?: () => Date;
  leaseMs?: number;
  /** Identifies this worker for the lease. */
  owner?: string;
  learning?: import("./learning/record").LearningRecorder;
}

/** A media reference could not be resolved to a publishable, pinned attachment. */
export class MediaResolutionError extends Error {
  readonly failureClass: "transient" | "permanent" | "policy_human";
  constructor(failureClass: "transient" | "permanent" | "policy_human", message: string) {
    super(message);
    this.name = "MediaResolutionError";
    this.failureClass = failureClass;
  }
}

/**
 * Resolve an Artifact's pinned visual references to concrete, ordered media.
 *
 * The payload names the exact immutable revision (`mediaRefs`); this resolves
 * each id against `visual_assets` (never "latest") and loads its bytes through
 * the `AssetStoragePort`. The core resolves; the adapter only consumes. Owner
 * isolation is enforced here, so a Publication can never publish another
 * owner's asset.
 */
export async function resolvePublicationMedia(
  artifact: Pick<Artifact, "id" | "userId" | "format" | "payload">,
  deps: PublicationDeps,
): Promise<PublishMedia[]> {
  const refs = payloadSchemaRegistry.mediaRefs(artifact.format, artifact.payload);
  if (refs.length === 0) return [];
  if (!deps.storage) {
    throw new MediaResolutionError(
      "permanent",
      `media storage is not configured for format "${artifact.format}"`,
    );
  }

  const ordered = [...refs].sort((a, b) => a.position - b.position);
  const media: PublishMedia[] = [];
  for (const ref of ordered) {
    const asset = await deps.content.getVisualAsset(ref.visualAssetId);
    if (!asset) {
      throw new MediaResolutionError(
        "permanent",
        `visual asset ${ref.visualAssetId} referenced by artifact ${artifact.id} was not found`,
      );
    }
    if (asset.userId !== null && asset.userId !== artifact.userId) {
      throw new MediaResolutionError(
        "permanent",
        `visual asset ${asset.id} does not belong to the artifact owner`,
      );
    }
    if (asset.status !== "ready") {
      throw new MediaResolutionError("permanent", `visual asset ${asset.id} is "${asset.status}", not ready`);
    }

    let bytes: Buffer;
    try {
      bytes = await deps.storage.get(asset.storageKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = /unavailable|not found|archived|unsafe|invalid/i.test(message);
      throw new MediaResolutionError(
        permanent ? "permanent" : "transient",
        `could not load visual asset ${asset.id}: ${message}`,
      );
    }

    let providerFetchUrl: string | null = null;
    if (deps.storage.issueProviderFetchUrl) {
      const issued = await deps.storage.issueProviderFetchUrl({ storageKey: asset.storageKey });
      providerFetchUrl = issued?.url ?? null;
    }

    media.push({
      visualAssetId: asset.id,
      mime: asset.mime,
      role: ref.role ?? asset.role ?? null,
      position: ref.position,
      altText: ref.altText ?? asset.altText ?? null,
      bytes,
      providerFetchUrl,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      byteSize: asset.byteSize,
      kind: asset.kind,
    });
  }
  return media;
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

  // Resolve the exact pinned media (if this format carries any) BEFORE invoking
  // the transport. A resolution failure is a classified failure, never an
  // ambiguous Publication, and the transport is never called.
  let media: PublishMedia[];
  try {
    media = await resolvePublicationMedia(artifact, deps);
  } catch (error) {
    if (error instanceof MediaResolutionError) {
      if (error.failureClass === "transient") {
        await deps.content.updatePublication(leased.id, {
          state: "queued",
          providerCalled: false,
          lastError: error.message,
          releaseLease: true,
        });
        throw JobFailure.transient(error.message);
      }
      return await recordTerminal(leased, deps, {
        failureClass: error.failureClass,
        message: error.message,
      });
    }
    throw error;
  }

  const outcome = await adapter.publish({
    format: artifact.format,
    channel: leased.channel,
    payload: artifact.payload as JsonRecord,
    correlationId: leased.correlationId,
    externalId: leased.externalId,
    media,
    ownerUserId: leased.userId ?? null,
  });

  if (outcome.ok) {
    await recordPublished(leased, outcome, deps, now());
    return {
      publicationId: leased.id,
      status: "published",
      reused: false,
      externalId: outcome.externalId,
      externalUrl: outcome.externalUrl,
    };
  }

  // The transport was invoked but the outcome is not a clean failure (partial
  // thread, ambiguous error) — never retry into a duplicate. `outcome.metrics`
  // (e.g. an xQuick `writeActionId`) is preserved on the Result so a later
  // reconciliation pass has something durable to ask the provider about.
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
      metrics: outcome.metrics ?? {},
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

/**
 * Record a confirmed-published outcome and its downstream effects. Shared by
 * the normal publish path and reconciliation — the only difference between
 * "just published" and "reconciliation discovered it was published all along"
 * is which caller reaches this function.
 */
async function recordPublished(
  publication: Publication,
  outcome: PublishOutcome,
  deps: PublicationDeps,
  publishedAt: Date,
): Promise<void> {
  await deps.content.updatePublication(publication.id, {
    state: "published",
    providerCalled: true,
    externalId: outcome.externalId,
    lastError: null,
    releaseLease: true,
  });
  // `insertResult` resolves an existing `unknown` Result in place, or inserts
  // fresh when there was none — either way exactly one Result survives.
  await deps.content.insertResult({
    userId: publication.userId ?? null,
    publicationId: publication.id,
    outcome: "published",
    externalId: outcome.externalId,
    externalUrl: outcome.externalUrl,
    publishedAt: outcome.publishedAt ?? publishedAt,
    metrics: outcome.metrics ?? {},
    source: publication.channel,
    errorClass: null,
    errorMessage: null,
    correlationId: publication.correlationId,
  });
  await deps.content.markOccurrenceStatus(publication.occurrenceId, "published");

  if (deps.learning) {
    const result = await deps.content.getResultByPublication(publication.id);
    await deps.learning.recordPublication(
      {
        ...publication,
        state: "published",
        externalId: outcome.externalId ?? publication.externalId,
      },
      result ?? null,
    );
  }

  // A one-shot series is complete once its single occurrence publishes.
  const schedule = await deps.content.getSchedule(publication.scheduleId);
  if (schedule && schedule.count <= 1) {
    await deps.content.setScheduleStatus(schedule.id, "exhausted");
  }
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

/**
 * A Publication's `attempt` counter is durable (incremented on every lease
 * acquisition, including reconciliation's own). Once a Publication has been
 * *reconciliation-leased* this many times without resolving, it is left
 * `unknown` for an operator rather than checked forever — the bound lives in
 * this counter, not in process memory, so it survives restarts.
 */
export const MAX_RECONCILE_ATTEMPTS = 5;

export interface ReconcileDeps extends PublicationDeps {
  /** Enqueue a fresh `publication.run` attempt after a confirmed non-publication. */
  enqueuePublication: (publication: Publication) => Promise<boolean>;
}

export interface ReconcileUnknownResult {
  /** Adapter confirmed the external post exists; Publication now `published`. */
  resolved: number;
  /** Adapter confirmed no matching post; Publication reset and re-queued. */
  requeued: number;
  /** Adapter could not establish the outcome this pass; left `unknown`. */
  stillUnknown: number;
  /** Durable attempt bound reached; left `unknown` permanently for an operator. */
  exhausted: number;
}

/**
 * Attempt real provider-side reconciliation for Publications parked as
 * `unknown` (transport invoked, outcome never confirmed — see
 * `runPublication`'s `providerCalled` branch). This is the mechanism that
 * turns "unknown" into a known outcome; nothing else in the system does.
 *
 * Concurrency: reconciliation reuses the exact same single-flight lease as a
 * normal publish attempt (`acquirePublicationLease` already allows leasing
 * from `failed`), so two reconciliation passes — or a reconciliation pass
 * racing a publish retry — can never act on the same Publication at once.
 * PostgreSQL's compare-and-set lease is the only correctness mechanism; there
 * is no in-memory lock.
 */
export async function reconcileUnknownPublications(
  now: Date,
  deps: ReconcileDeps,
  limit = 50,
): Promise<ReconcileUnknownResult> {
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const owner = deps.owner ?? "reconcile-worker";
  const result: ReconcileUnknownResult = { resolved: 0, requeued: 0, stillUnknown: 0, exhausted: 0 };

  const candidates = await deps.content.listUnknownPublications(limit);
  for (const candidate of candidates) {
    if (candidate.attempt >= MAX_RECONCILE_ATTEMPTS) {
      result.exhausted += 1;
      continue;
    }

    const leased = await deps.content.acquirePublicationLease(candidate.id, owner, leaseMs);
    if (!leased) continue; // another worker/tick already holds it

    const artifact = await deps.content.getArtifact(leased.artifactId);
    let adapter: ChannelAdapter;
    try {
      adapter = adapterFor(leased.channel, deps);
    } catch {
      // The lease acquisition itself moved state to "publishing"; releasing it
      // must restore "failed" (still unknown) or the row would never be
      // picked up by a future scan again (`listUnknownPublications` filters
      // on `state = "failed"`).
      await deps.content.updatePublication(leased.id, { state: "failed", releaseLease: true });
      result.stillUnknown += 1;
      continue;
    }
    if (!artifact) {
      await deps.content.updatePublication(leased.id, { state: "failed", releaseLease: true });
      result.stillUnknown += 1;
      continue;
    }

    // The provisional `unknown` Result carries whatever continuity data the
    // original ambiguous `publish()` attempt captured (e.g. an xQuick
    // `writeActionId`) — that is the durable identifier reconciliation checks.
    const existingResult = await deps.content.getResultByPublication(leased.id);
    const reconciliationHint = (existingResult?.metrics as JsonRecord | undefined) ?? null;

    const outcome = await adapter.reconcile({
      format: artifact.format,
      channel: leased.channel,
      payload: artifact.payload as JsonRecord,
      correlationId: leased.correlationId,
      externalId: leased.externalId,
      reconciliationHint,
      ownerUserId: leased.userId ?? null,
    });

    if (outcome === null) {
      await deps.content.updatePublication(leased.id, { state: "failed", releaseLease: true });
      result.stillUnknown += 1;
      continue;
    }

    if (outcome.ok) {
      await recordPublished(leased, outcome, deps, now);
      result.resolved += 1;
      continue;
    }

    // Confirmed: the provider has no record of this publication ever having
    // succeeded. Never call publish() again from inside this loop — reset the
    // SAME Publication row (same idempotency key, no new Occurrence, no new
    // row) to `queued` and hand it back to the normal durable queue, exactly
    // like an ordinary transient-failure retry.
    await deps.content.deleteUnknownResult(leased.id);
    await deps.content.updatePublication(leased.id, {
      state: "queued",
      providerCalled: false,
      externalId: null,
      lastError: outcome.errorMessage ?? "reconcile confirmed no matching external publication; re-queued",
      releaseLease: true,
    });
    const requeued = {
      ...leased,
      state: "queued" as const,
      providerCalled: false,
      externalId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      // The Publication's real `idempotencyKey` (schedule×occurrence×artifact)
      // is a PERMANENT identity and is never changed in the database — but the
      // FIRST publish attempt's completed pg-boss job used that exact string
      // as its own singleton dedup key, and pg-boss's singleton window
      // (`singletonSeconds`, independent of job outcome) can still be open.
      // A fresh `send()` with the same key would be silently dropped as a
      // duplicate, leaving this Publication reset to "queued" with no job
      // behind it. This suffix only affects the ephemeral queue-dedup key
      // passed to `enqueuePublication` below — it is never persisted.
      idempotencyKey: `${leased.idempotencyKey}:retry:${leased.attempt}`,
    };
    const enqueued = await deps.enqueuePublication(requeued);
    if (enqueued) result.requeued += 1;
  }

  return result;
}
