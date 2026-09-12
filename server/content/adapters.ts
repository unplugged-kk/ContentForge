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
import { postContentToX, translateXError } from "../social/x";

export type AdapterFailureClass = "transient" | "permanent" | "policy_human";

export interface PublishRequest {
  format: string;
  channel: string;
  payload: JsonRecord;
  correlationId: string;
  /** Present when reconciling a previously attempted publication. */
  externalId?: string | null;
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
  const supported = new Set(["x_post", "x_thread"]);

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

  return {
    channel: "x",
    supports: (format) => supported.has(format),

    async publish(request: PublishRequest): Promise<PublishOutcome> {
      if (!supported.has(request.format)) return unavailable(request.format, "x");

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
     * Reconciliation stub. `postContentToX` does not return partially-created
     * ids on failure, so a mid-thread failure cannot currently be confirmed from
     * here — the caller records an `unknown` Result for operator reconciliation
     * rather than guessing.
     */
    async reconcile(request: PublishRequest): Promise<PublishOutcome | null> {
      if (!request.externalId) return null;
      return null;
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

export function listChannelAdapters(): ChannelAdapter[] {
  const out: ChannelAdapter[] = [];
  registry.forEach((a) => out.push(a));
  return out;
}

export function resetChannelAdapters(): void {
  registry.clear();
}

/** Idempotent: registers the Phase-B channel set (X only). */
export function registerBuiltinChannelAdapters(): void {
  if (!hasChannelAdapter("x")) registerChannelAdapter(createXChannelAdapter());
}
