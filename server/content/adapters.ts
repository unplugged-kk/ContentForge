/**
 * Channel adapter boundary.
 *
 * Publication → ChannelAdapter → transport. Every platform mechanic lives here
 * (or behind it); the core domain never contains X-specific fields or calls X
 * directly. Adding a channel is a registration, never a core change.
 *
 * Outcomes are three-valued on purpose: `ok`, a classified failure, or an
 * *unknown* outcome. A thread is not published merely because its first unit
 * succeeded, and an external request that was sent is never assumed to have
 * succeeded.
 */

import type { JsonRecord } from "./storage";
import {
  fetchTweetTextByIdViaOfficialApi,
  fetchXPublicMetrics,
  postContentToX,
  reconcileXQuickWriteAction,
  translateXError,
  uploadMediaToX,
  XWriteActionPendingError,
} from "../social/x";
import { PERFORMANCE_SCHEMA_VERSION } from "./learning/constants";
import { hourWindow } from "./learning/identity";
import {
  classifyMetricsHttpFailure,
  missingMetricsOutcome,
  normalizeProviderMetrics,
  type MetricFetchOutcome,
  type MetricFetchRequest,
} from "./learning/metrics";
import {
  LinkedInPublishAmbiguousError,
  postTextToLinkedIn,
  reconcileLinkedInPost,
  translateLinkedInError,
} from "../social/linkedin";
import {
  fetchThreadsInsights,
  postTextToThreads,
  reconcileThreadsPost,
  ThreadsPublishAmbiguousError,
  translateThreadsError,
  unmappedThreadsMetrics,
  validateThreadsText,
} from "../social/threads";
import {
  fetchInstagramInsights,
  InstagramPublishAmbiguousError,
  postMediaToInstagram,
  reconcileInstagramPost,
  translateInstagramError,
  unmappedInstagramMetrics,
  validateInstagramCaption,
  validateInstagramPublishMedia,
} from "../social/instagram";

export type AdapterFailureClass = "transient" | "permanent" | "policy_human";

/**
 * One resolved media attachment on a publish request, pinned to an exact
 * immutable VisualAsset revision. The core resolves the reference and the bytes
 * (through `AssetStoragePort`); the adapter only consumes them. `bytes` are
 * in-memory only and never persisted or placed on the queue.
 */
export interface PublishMedia {
  /** Exact VisualAsset revision this media pins — never "latest". */
  visualAssetId: number;
  mime: string;
  role: string | null;
  position: number;
  altText: string | null;
  /** Resolved bytes of that exact revision. */
  bytes: Buffer;
  /** Optional provider-fetchable URL from AssetStoragePort (never a directory listing). */
  providerFetchUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  byteSize?: number | null;
  kind?: string | null;
}

export interface PublishRequest {
  format: string;
  channel: string;
  payload: JsonRecord;
  correlationId: string;
  /** Present when reconciling a previously attempted publication. */
  externalId?: string | null;
  /**
   * Ordered, already-resolved media attachments for formats that carry visuals.
   * Shaped for N items; a single-image transport implements N=1 today.
   */
  media?: PublishMedia[];
  /**
   * Opaque, adapter-specific continuity data captured from an earlier ambiguous
   * `publish()` attempt (e.g. a provider write-action id). Generic at this
   * interface level; only the adapter that produced it knows how to read it.
   */
  reconciliationHint?: JsonRecord | null;
  /**
   * Publication owner, used by adapters that look up connected-account credentials.
   * Never a token. Optional so existing adapters stay unchanged.
   */
  ownerUserId?: number | null;
}

export interface PublishOutcome {
  ok: boolean;
  /** True once the transport was actually invoked (gates blind retries). */
  providerCalled: boolean;
  externalId: string | null;
  externalUrl: string | null;
  publishedAt: Date | null;
  /** Set when `ok` is false. */
  errorClass?: AdapterFailureClass;
  errorMessage?: string;
  /** Provider-reported metrics (bounded). */
  metrics?: JsonRecord;
}

export interface ChannelAdapter {
  readonly channel: string;
  /** Which core formats this adapter can distribute. */
  supports(format: string): boolean;
  publish(request: PublishRequest): Promise<PublishOutcome>;
  /** Best-effort resolution of an unknown outcome. Null = cannot determine. */
  reconcile(request: PublishRequest): Promise<PublishOutcome | null>;
  /**
   * Optional analytics capability. Maps provider observations into the shared
   * NormalizedPerformanceSignal model. Missing metrics are `not_available`.
   */
  fetchMetrics?(request: MetricFetchRequest): Promise<MetricFetchOutcome>;
}

function unavailable(format: string, channel: string): PublishOutcome {
  return {
    ok: false,
    providerCalled: false,
    externalId: null,
    externalUrl: null,
    publishedAt: null,
    errorClass: "permanent",
    errorMessage: `${channel} adapter does not support format "${format}"`,
  };
}

/**
 * Classify a transport failure for the X adapter. Exported so the mapping is
 * testable without calling the network:
 *   • missing/misconfigured xQuick → terminal policy failure (retrying cannot fix it)
 *   • timeouts, connection resets, 5xx, throttling → transient (retry)
 *   • everything else → permanent
 */
export function classifyXFailure(message: string): AdapterFailureClass {
  if (/XQUICK_CONFIG_MISSING|not connected|XQUICK_POST_ID_MISSING/i.test(message)) {
    return "policy_human";
  }
  if (/timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b|429|rate limit/i.test(message)) {
    return "transient";
  }
  return "permanent";
}

/**
 * X adapter — transport only. All X mechanics (thread numbering, 280-char
 * slicing, the finisher CTA, xQuick payload shape) stay inside `server/social/x`
 * and are reached through `postContentToX`.
 */
export function createXChannelAdapter(): ChannelAdapter {
  // image/thumbnail are single-image formats; carousel (multi-media) is
  // deliberately NOT supported by this transport yet. `linkedin_post` shares
  // the `{ text }` payload with `x_post` so an existing Artifact can be
  // delivered on X without cloning the revision.
  const supported = new Set(["x_post", "x_thread", "image", "thumbnail", "linkedin_post", "video"]);

  function unitsFor(format: string, payload: JsonRecord): string[] | null {
    if (format === "x_post" || format === "linkedin_post") {
      const text = typeof payload.text === "string" ? payload.text : null;
      return text ? [text] : null;
    }
    if (format === "x_thread") {
      const units = Array.isArray(payload.units) ? payload.units : null;
      const cleaned = (units ?? []).filter((u): u is string => typeof u === "string" && u.trim().length > 0);
      return cleaned.length > 0 ? cleaned : null;
    }
    return null;
  }

  function classify(message: string): AdapterFailureClass {
    return classifyXFailure(message);
  }

  /** The post body that accompanies a single image/thumbnail attachment. */
  function mediaTextFor(format: string, payload: JsonRecord): string {
    if (format === "image") {
      const caption = typeof payload.caption === "string" ? payload.caption : null;
      const alt = typeof payload.altText === "string" ? payload.altText : null;
      return (caption ?? alt ?? "").trim();
    }
    if (format === "thumbnail") {
      const alt = typeof payload.altText === "string" ? payload.altText : null;
      return (alt ?? "").trim();
    }
    return "";
  }

  /**
   * Single-image delivery: upload the pinned media, then create the post with
   * its provider media id. The two provider calls have different semantics — a
   * failed *upload* leaves no post behind, so it is a plain classified failure
   * (never `unknown`); a failed *post* after a successful upload is ambiguous
   * and follows the same unknown/reconcile path as a text post. The contract is
   * N-capable; this transport is deliberately N=1 for now.
   */
  async function publishWithMedia(request: PublishRequest): Promise<PublishOutcome> {
    const media = request.media ?? [];
    if (media.length === 0) {
      return {
        ok: false,
        providerCalled: false,
        externalId: null,
        externalUrl: null,
        publishedAt: null,
        errorClass: "permanent",
        errorMessage: `${request.format} payload references no resolved visual media`,
      };
    }
    if (media.length > 1) {
      return {
        ok: false,
        providerCalled: false,
        externalId: null,
        externalUrl: null,
        publishedAt: null,
        errorClass: "permanent",
        errorMessage: `x media transport supports one attachment, got ${media.length}`,
      };
    }

    const attachment = media[0];
    let mediaId: string;
    try {
      mediaId = await uploadMediaToX({
        bytes: attachment.bytes,
        mime: attachment.mime,
        altText: attachment.altText,
      });
    } catch (error) {
      // No post exists yet: a failed upload is retryable or terminal, never unknown.
      const raw = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        providerCalled: false,
        externalId: null,
        externalUrl: null,
        publishedAt: null,
        errorClass: classify(raw),
        errorMessage: translateXError(raw),
      };
    }

    try {
      const result = await postContentToX([mediaTextFor(request.format, request.payload)], {
        mediaIds: [mediaId],
      });
      return {
        ok: true,
        providerCalled: true,
        externalId: result.tweetIds.join(","),
        externalUrl: result.urls[0] ?? null,
        publishedAt: new Date(),
        metrics: { unitCount: result.tweetIds.length, mediaCount: 1, username: result.username },
      };
    } catch (error) {
      // Same ambiguity contract as a text post: the media is uploaded, the post
      // call's outcome is unknown, and the durable handle is the writeActionId.
      if (error instanceof XWriteActionPendingError) {
        return {
          ok: false,
          providerCalled: true,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorMessage: error.message,
          metrics: { writeActionId: error.writeActionId },
        };
      }
      const raw = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        providerCalled: true,
        externalId: null,
        externalUrl: null,
        publishedAt: null,
        errorClass: classify(raw),
        errorMessage: translateXError(raw),
      };
    }
  }

  return {
    channel: "x",
    supports: (format) => supported.has(format),

    async publish(request: PublishRequest): Promise<PublishOutcome> {
      if (!supported.has(request.format)) return unavailable(request.format, "x");

      if (request.format === "video") {
        return {
          ok: false,
          providerCalled: false,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: "x video publishing is not implemented",
        };
      }

      if (request.format === "image" || request.format === "thumbnail") {
        return publishWithMedia(request);
      }

      const texts = unitsFor(request.format, request.payload);
      if (!texts) {
        return {
          ok: false,
          providerCalled: false,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: `x payload for ${request.format} is unusable`,
        };
      }

      try {
        const result = await postContentToX(texts);
        return {
          ok: true,
          providerCalled: true,
          externalId: result.tweetIds.join(","),
          externalUrl: result.urls[0] ?? null,
          publishedAt: new Date(),
          metrics: { unitCount: result.tweetIds.length, username: result.username },
        };
      } catch (error) {
        // xQuick accepted the write (202 + writeActionId) but we gave up
        // polling before it resolved. The write action id is the durable
        // handle reconciliation later asks xQuick about — never a tweet id.
        if (error instanceof XWriteActionPendingError) {
          // No errorClass: `providerCalled: true` + `ok: false` is what tells
          // the caller this is ambiguous ("unknown"), not a classified failure.
          return {
            ok: false,
            providerCalled: true,
            externalId: null,
            externalUrl: null,
            publishedAt: null,
            errorMessage: error.message,
            metrics: { writeActionId: error.writeActionId },
          };
        }
        const raw = error instanceof Error ? error.message : String(error);
        // The transport was invoked; a partial thread may exist. Never report
        // success, and never silently retry into a duplicate thread.
        return {
          ok: false,
          providerCalled: true,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: classify(raw),
          errorMessage: translateXError(raw),
        };
      }
    },

    /**
     * Reconciliation. Two durable identifiers are recognized, exact
     * provider-side lookup only — no scraping, no guessing:
     *
     *   1. `reconciliationHint.writeActionId` — set when a prior `publish()`
     *      call got a 202 from xQuick but gave up polling before it resolved.
     *      Re-checked once against the same xQuick write-action endpoint.
     *   2. `externalId` — an already-known post id (e.g. re-reconciling an
     *      already-resolved Publication); confirmed by direct tweet lookup.
     *
     * `null` ("still unknown") is returned whenever the provider cannot be
     * asked right now, or answers inconclusively — never invented as
     * "confirmed not published".
     */
    async reconcile(request: PublishRequest): Promise<PublishOutcome | null> {
      const writeActionId =
        typeof request.reconciliationHint?.writeActionId === "string"
          ? request.reconciliationHint.writeActionId
          : null;

      if (writeActionId) {
        const status = await reconcileXQuickWriteAction(writeActionId);
        if (!status || status.status === "pending") return null; // still unknown
        if (status.status === "success") {
          return {
            ok: true,
            providerCalled: true,
            externalId: status.tweetId,
            externalUrl: status.url,
            publishedAt: new Date(),
          };
        }
        // Confirmed: xQuick itself reports this write action failed — the
        // post was never created.
        return {
          ok: false,
          providerCalled: true,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: status.message,
        };
      }

      if (request.externalId) {
        // A read-API miss is not proof of absence (private, deleted, rate
        // limited, or no read endpoint configured all look identical) — stay
        // unknown rather than assume "not published".
        const text = await fetchTweetTextByIdViaOfficialApi(request.externalId);
        if (text) {
          return {
            ok: true,
            providerCalled: true,
            externalId: request.externalId,
            externalUrl: null,
            publishedAt: new Date(),
          };
        }
        return null;
      }

      // No durable identifier to check at all.
      return null;
    },

    async fetchMetrics(request: MetricFetchRequest): Promise<MetricFetchOutcome> {
      const now = new Date();
      const window = hourWindow(now);
      const ids = request.externalId.split(",").map((s) => s.trim()).filter(Boolean);
      const fetched = await fetchXPublicMetrics(ids);
      if (!fetched.ok) {
        if (fetched.status === 501) {
          return missingMetricsOutcome("x", request.externalId, fetched.retrievedAt, window.observedAt, window.window);
        }
        const errorClass = classifyMetricsHttpFailure(fetched.status, fetched.message);
        return {
          ok: false,
          provider: "x",
          retrievedAt: fetched.retrievedAt,
          observedAt: window.observedAt,
          measurementWindow: window.window,
          externalId: request.externalId,
          normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
          metrics: [],
          errorClass,
          errorMessage: fetched.message,
        };
      }
      const merged: Record<string, unknown> = {};
      for (const row of fetched.rows) {
        if (row && typeof row === "object") Object.assign(merged, row);
      }
      return {
        ok: true,
        provider: "x",
        retrievedAt: fetched.retrievedAt,
        observedAt: window.observedAt,
        measurementWindow: window.window,
        externalId: request.externalId,
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
        metrics: normalizeProviderMetrics(merged, "x"),
      };
    },
  };
}

/**
 * Classify a Threads transport failure. Missing credentials are terminal-by-policy.
 * Timeouts, 5xx, and 429 map to transient. Missing ids after a parsed response are
 * permanent (the Graph body was decisive).
 */
export function classifyThreadsFailure(message: string): AdapterFailureClass {
  if (/THREADS_CONFIG_MISSING|not connected/i.test(message)) {
    return "policy_human";
  }
  if (/THREADS_CONTAINER_ID_MISSING|THREADS_PUBLISH_ID_MISSING/i.test(message)) {
    return "permanent";
  }
  if (/timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b|429|rate limit/i.test(message)) {
    return "transient";
  }
  return "permanent";
}

/**
 * Threads adapter — text posts only (media_type=TEXT). Carousel/video/replies
 * are not registered. Compatible `{ text }` payloads (`x_post`, `linkedin_post`)
 * are accepted; over-limit LinkedIn-length text is a permanent validation failure
 * (never truncated). Provider has no documented idempotency key.
 */
export function createThreadsChannelAdapter(): ChannelAdapter {
  const supported = new Set(["x_post", "linkedin_post"]);

  function textFor(format: string, payload: JsonRecord): string | null {
    if (format !== "x_post" && format !== "linkedin_post") return null;
    const text = typeof payload.text === "string" ? payload.text : null;
    return text && text.trim().length > 0 ? text : null;
  }

  return {
    channel: "threads",
    supports: (format) => supported.has(format),

    async publish(request: PublishRequest): Promise<PublishOutcome> {
      if (!supported.has(request.format)) return unavailable(request.format, "threads");
      const text = textFor(request.format, request.payload);
      if (!text) {
        return {
          ok: false,
          providerCalled: false,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: `threads payload for ${request.format} is unusable`,
        };
      }
      const limitError = validateThreadsText(text);
      if (limitError) {
        return {
          ok: false,
          providerCalled: false,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: limitError,
        };
      }
      try {
        const result = await postTextToThreads(text, request.ownerUserId);
        return {
          ok: true,
          providerCalled: true,
          externalId: result.mediaId,
          externalUrl: result.url,
          publishedAt: new Date(),
        };
      } catch (error) {
        if (error instanceof ThreadsPublishAmbiguousError) {
          return {
            ok: false,
            providerCalled: true,
            externalId: null,
            externalUrl: null,
            publishedAt: null,
            errorMessage: error.message,
            metrics: {
              text: error.hint.text,
              attemptedAt: error.hint.attemptedAt,
              ...(error.hint.creationId ? { creationId: error.hint.creationId } : {}),
            },
          };
        }
        const raw = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          providerCalled: true,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: classifyThreadsFailure(raw),
          errorMessage: translateThreadsError(raw),
        };
      }
    },

    async reconcile(request: PublishRequest): Promise<PublishOutcome | null> {
      const hint = request.reconciliationHint ?? {};
      const text = typeof hint.text === "string" ? hint.text : null;
      const attemptedAt = typeof hint.attemptedAt === "string" ? hint.attemptedAt : null;
      const creationId = typeof hint.creationId === "string" ? hint.creationId : null;
      const externalId = request.externalId ?? (typeof hint.externalId === "string" ? hint.externalId : null);
      if (!text && !creationId && !externalId) return null;

      const status = await reconcileThreadsPost(
        {
          text: text ?? undefined,
          attemptedAt: attemptedAt ?? undefined,
          creationId: creationId ?? undefined,
          externalId: externalId ?? undefined,
        },
        request.ownerUserId,
      );
      if (!status || status.status === "pending") return null;
      if (status.status === "absent") {
        return {
          ok: false,
          providerCalled: true,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: status.message,
        };
      }
      return {
        ok: true,
        providerCalled: true,
        externalId: status.mediaId,
        externalUrl: status.url,
        publishedAt: new Date(),
      };
    },

    async fetchMetrics(request: MetricFetchRequest): Promise<MetricFetchOutcome> {
      const now = new Date();
      const window = hourWindow(now);
      const fetched = await fetchThreadsInsights(request.externalId, request.ownerUserId);
      if (!fetched.ok) {
        const errorClass = classifyMetricsHttpFailure(fetched.status, fetched.message);
        return {
          ok: false,
          provider: "threads",
          retrievedAt: fetched.retrievedAt,
          observedAt: window.observedAt,
          measurementWindow: window.window,
          externalId: request.externalId,
          normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
          metrics: [],
          errorClass,
          errorMessage: fetched.message,
        };
      }
      const source: Record<string, unknown> = { ...fetched.insights };
      return {
        ok: true,
        provider: "threads",
        retrievedAt: fetched.retrievedAt,
        observedAt: window.observedAt,
        measurementWindow: window.window,
        externalId: request.externalId,
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
        metrics: normalizeProviderMetrics(source, "threads"),
        unmapped: unmappedThreadsMetrics(fetched.insights),
      };
    },
  };
}

/**
 * Classify a LinkedIn transport failure. LinkedIn's Posts API is
 * synchronous, so almost every failure is decisive; only a missing
 * configuration is terminal-by-policy and only network-level errors are
 * worth retrying.
 */
export function classifyLinkedInFailure(message: string): AdapterFailureClass {
  if (/LINKEDIN_CONFIG_MISSING|not connected|LINKEDIN_POST_ID_MISSING/i.test(message)) {
    return "policy_human";
  }
  if (/timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b|429|rate limit/i.test(message)) {
    return "transient";
  }
  return "permanent";
}

/**
 * LinkedIn adapter — transport only, second channel proving the adapter
 * boundary is genuinely generic. LinkedIn's Posts API has no client-supplied
 * idempotency key and no async write-action protocol of its own, so:
 *   • duplicate suppression relies entirely on ContentForge's own
 *     Publication.idempotencyKey + pg-boss queue dedup — never on the
 *     provider (documented limitation, see docs/STATUS.md).
 *   • ambiguity arises only at the network layer (timeout/reset before a
 *     response arrives), handled via `LinkedInPublishAmbiguousError`.
 *   • reconciliation can confirm "published" by re-listing recent posts and
 *     matching the pinned text, but can never safely confirm "not
 *     published" — a listing miss is not proof of absence, so it stays
 *     unknown and is bounded by `MAX_RECONCILE_ATTEMPTS` (Phase 5's existing
 *     terminal safety net), never blindly retried forever.
 */
export function createLinkedInChannelAdapter(): ChannelAdapter {
  // `x_post` is the same `{ text }` payload family as `linkedin_post`.
  const supported = new Set(["linkedin_post", "x_post"]);

  function textFor(format: string, payload: JsonRecord): string | null {
    if (format !== "linkedin_post" && format !== "x_post") return null;
    const text = typeof payload.text === "string" ? payload.text : null;
    return text && text.trim().length > 0 ? text : null;
  }

  return {
    channel: "linkedin",
    supports: (format) => supported.has(format),

    async publish(request: PublishRequest): Promise<PublishOutcome> {
      if (!supported.has(request.format)) return unavailable(request.format, "linkedin");

      const text = textFor(request.format, request.payload);
      if (!text) {
        return {
          ok: false,
          providerCalled: false,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: `linkedin payload for ${request.format} is unusable`,
        };
      }

      try {
        const result = await postTextToLinkedIn(text);
        return {
          ok: true,
          providerCalled: true,
          externalId: result.postUrn,
          externalUrl: result.url,
          publishedAt: new Date(),
        };
      } catch (error) {
        if (error instanceof LinkedInPublishAmbiguousError) {
          // No errorClass: `providerCalled: true` + `ok: false` signals
          // "unknown" to the caller, same convention as the X adapter.
          return {
            ok: false,
            providerCalled: true,
            externalId: null,
            externalUrl: null,
            publishedAt: null,
            errorMessage: error.message,
            metrics: { commentary: error.hint.commentary, attemptedAt: error.hint.attemptedAt },
          };
        }
        const raw = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          providerCalled: true,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: classifyLinkedInFailure(raw),
          errorMessage: translateLinkedInError(raw),
        };
      }
    },

    /**
     * Reconciliation: only the `reconciliationHint` (commentary + attempt
     * timestamp) path exists — LinkedIn gives no request/write-action id to
     * re-check the way xQuick does, and an already-known `externalId`
     * publish is never ambiguous in the first place (the API is synchronous).
     */
    async reconcile(request: PublishRequest): Promise<PublishOutcome | null> {
      const commentary =
        typeof request.reconciliationHint?.commentary === "string" ? request.reconciliationHint.commentary : null;
      const attemptedAt =
        typeof request.reconciliationHint?.attemptedAt === "string" ? request.reconciliationHint.attemptedAt : null;
      if (!commentary || !attemptedAt) return null;

      const status = await reconcileLinkedInPost({ commentary, attemptedAt });
      if (!status || status.status === "pending") return null; // still unknown, never assumed absent
      return {
        ok: true,
        providerCalled: true,
        externalId: status.postUrn,
        externalUrl: status.url,
        publishedAt: new Date(),
      };
    },

    async fetchMetrics(request: MetricFetchRequest): Promise<MetricFetchOutcome> {
      const now = new Date();
      const window = hourWindow(now);
      return missingMetricsOutcome(
        "linkedin",
        request.externalId,
        now,
        window.observedAt,
        window.window,
      );
    },
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────
const registry = new Map<string, ChannelAdapter>();

export class ChannelAdapterNotRegisteredError extends Error {
  constructor(channel: string) {
    super(`No channel adapter registered for "${channel}"`);
    this.name = "ChannelAdapterNotRegisteredError";
  }
}

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  registry.set(adapter.channel, adapter);
}

export function hasChannelAdapter(channel: string): boolean {
  return registry.has(channel);
}

export function getChannelAdapter(channel: string): ChannelAdapter {
  const adapter = registry.get(channel);
  if (!adapter) throw new ChannelAdapterNotRegisteredError(channel);
  return adapter;
}

/**
 * The single authoritative `(format, channel)` distributability decision.
 * Generation still also requires a format profile (`formatChannelError`).
 * Distribution of an existing Artifact uses this function only.
 */
export function channelSupportsFormat(channel: string, format: string): boolean {
  const adapter = registry.get(channel);
  return adapter ? adapter.supports(format) : false;
}

export function listChannelAdapters(): ChannelAdapter[] {
  const out: ChannelAdapter[] = [];
  registry.forEach((a) => out.push(a));
  return out;
}

export function resetChannelAdapters(): void {
  registry.clear();
}

/**
 * Classify an Instagram transport failure. Missing credentials / personal
 * accounts / missing media URLs are terminal-by-policy. Timeouts, 5xx, and 429
 * map to transient. Invalid media and missing ids after a parsed response are
 * permanent.
 */
export function classifyInstagramFailure(message: string): AdapterFailureClass {
  if (
    /INSTAGRAM_CONFIG_MISSING|not connected|INSTAGRAM_ACCOUNT_UNSUPPORTED|INSTAGRAM_MEDIA_URL_MISSING/i.test(
      message,
    )
  ) {
    return "policy_human";
  }
  if (/INSTAGRAM_CONTAINER_ID_MISSING|INSTAGRAM_PUBLISH_ID_MISSING/i.test(message)) {
    return "permanent";
  }
  if (/timeout|ECONN|ENOTFOUND|fetch failed|socket|\b5\d\d\b|429|rate limit/i.test(message)) {
    return "transient";
  }
  return "permanent";
}

/**
 * Instagram adapter — professional-account image, carousel, and Reel publishing.
 * Text formats (`x_post`, `linkedin_post`) are not registered: Instagram feed
 * publishing is media-first. Stories / Live remain unregistered.
 * Provider has no documented idempotency key.
 */
export function createInstagramChannelAdapter(): ChannelAdapter {
  const supported = new Set(["image", "carousel", "video"]);

  function captionFor(payload: JsonRecord): string {
    const caption = typeof payload.caption === "string" ? payload.caption : "";
    return caption.trim();
  }

  return {
    channel: "instagram",
    supports: (format) => supported.has(format),

    async publish(request: PublishRequest): Promise<PublishOutcome> {
      if (!supported.has(request.format)) return unavailable(request.format, "instagram");
      const media = request.media ?? [];
      const caption = captionFor(request.payload);
      const captionError = validateInstagramCaption(caption);
      if (captionError) {
        return {
          ok: false,
          providerCalled: false,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: captionError,
        };
      }
      const mediaError = validateInstagramPublishMedia(request.format, media);
      if (mediaError) {
        return {
          ok: false,
          providerCalled: false,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: mediaError,
        };
      }
      try {
        const result = await postMediaToInstagram(
          { format: request.format as "image" | "carousel" | "video", caption, media },
          request.ownerUserId,
        );
        return {
          ok: true,
          providerCalled: true,
          externalId: result.mediaId,
          externalUrl: result.url,
          publishedAt: new Date(),
        };
      } catch (error) {
        if (error instanceof InstagramPublishAmbiguousError) {
          return {
            ok: false,
            providerCalled: true,
            externalId: null,
            externalUrl: null,
            publishedAt: null,
            errorMessage: error.message,
            metrics: {
              caption: error.hint.caption,
              attemptedAt: error.hint.attemptedAt,
              ...(error.hint.creationId ? { creationId: error.hint.creationId } : {}),
              ...(error.hint.childIds ? { childIds: error.hint.childIds } : {}),
            },
          };
        }
        const raw = error instanceof Error ? error.message : String(error);
        const providerCalled = !/INSTAGRAM_CONFIG_MISSING|INSTAGRAM_ACCOUNT_UNSUPPORTED|INSTAGRAM_MEDIA_URL_MISSING|instagram requires|instagram image|instagram caption|instagram carousel|instagram video|instagram reel/i.test(
          raw,
        );
        return {
          ok: false,
          providerCalled,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: classifyInstagramFailure(raw),
          errorMessage: translateInstagramError(raw),
        };
      }
    },

    async reconcile(request: PublishRequest): Promise<PublishOutcome | null> {
      const hint = request.reconciliationHint ?? {};
      const caption = typeof hint.caption === "string" ? hint.caption : null;
      const attemptedAt = typeof hint.attemptedAt === "string" ? hint.attemptedAt : null;
      const creationId = typeof hint.creationId === "string" ? hint.creationId : null;
      const externalId = request.externalId ?? (typeof hint.externalId === "string" ? hint.externalId : null);
      if (!caption && !creationId && !externalId) return null;

      const status = await reconcileInstagramPost(
        {
          caption: caption ?? undefined,
          attemptedAt: attemptedAt ?? undefined,
          creationId: creationId ?? undefined,
          externalId: externalId ?? undefined,
        },
        request.ownerUserId,
      );
      if (!status || status.status === "pending") return null;
      if (status.status === "absent") {
        return {
          ok: false,
          providerCalled: true,
          externalId: null,
          externalUrl: null,
          publishedAt: null,
          errorClass: "permanent",
          errorMessage: status.message,
        };
      }
      return {
        ok: true,
        providerCalled: true,
        externalId: status.mediaId,
        externalUrl: status.url,
        publishedAt: new Date(),
      };
    },

    async fetchMetrics(request: MetricFetchRequest): Promise<MetricFetchOutcome> {
      const now = new Date();
      const window = hourWindow(now);
      const fetched = await fetchInstagramInsights(request.externalId, request.ownerUserId);
      if (!fetched.ok) {
        const errorClass = classifyMetricsHttpFailure(fetched.status, fetched.message);
        return {
          ok: false,
          provider: "instagram",
          retrievedAt: fetched.retrievedAt,
          observedAt: window.observedAt,
          measurementWindow: window.window,
          externalId: request.externalId,
          normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
          metrics: [],
          errorClass,
          errorMessage: fetched.message,
        };
      }
      const source: Record<string, unknown> = { ...fetched.insights };
      return {
        ok: true,
        provider: "instagram",
        retrievedAt: fetched.retrievedAt,
        observedAt: window.observedAt,
        measurementWindow: window.window,
        externalId: request.externalId,
        normalizationVersion: PERFORMANCE_SCHEMA_VERSION,
        metrics: normalizeProviderMetrics(source, "instagram"),
        unmapped: unmappedInstagramMetrics(fetched.insights),
      };
    },
  };
}

/** Idempotent: registers the Phase-B channel set (X, LinkedIn, Threads, Instagram). */
export function registerBuiltinChannelAdapters(): void {
  if (!hasChannelAdapter("x")) registerChannelAdapter(createXChannelAdapter());
  if (!hasChannelAdapter("linkedin")) registerChannelAdapter(createLinkedInChannelAdapter());
  if (!hasChannelAdapter("threads")) registerChannelAdapter(createThreadsChannelAdapter());
  if (!hasChannelAdapter("instagram")) registerChannelAdapter(createInstagramChannelAdapter());
}
