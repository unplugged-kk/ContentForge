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
  postContentToX,
  reconcileXQuickWriteAction,
  translateXError,
  uploadMediaToX,
  XWriteActionPendingError,
} from "../social/x";
import {
  LinkedInPublishAmbiguousError,
  postTextToLinkedIn,
  reconcileLinkedInPost,
  translateLinkedInError,
} from "../social/linkedin";

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
  // deliberately NOT supported by this transport yet.
  const supported = new Set(["x_post", "x_thread", "image", "thumbnail"]);

  function unitsFor(format: string, payload: JsonRecord): string[] | null {
    if (format === "x_post") {
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
  const supported = new Set(["linkedin_post"]);

  function textFor(format: string, payload: JsonRecord): string | null {
    if (format !== "linkedin_post") return null;
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
 * The single authoritative `(format, channel)` distributability decision. Both
 * Opportunity validity and Schedule creation consult this — never a second,
 * hand-maintained allowlist that can drift from the adapter's real capability.
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

/** Idempotent: registers the Phase-B channel set (X, LinkedIn). */
export function registerBuiltinChannelAdapters(): void {
  if (!hasChannelAdapter("x")) registerChannelAdapter(createXChannelAdapter());
  if (!hasChannelAdapter("linkedin")) registerChannelAdapter(createLinkedInChannelAdapter());
}
