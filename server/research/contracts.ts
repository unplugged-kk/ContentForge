/**
 * SourceProvider contract.
 *
 * Deliberately small: three optional operations plus declaration and an
 * optional deep health probe. Provider-specific mechanics (HTTP, auth,
 * pagination, parsing, backends) stay behind this seam; the research engine
 * only ever sees `NormalizedSource`.
 *
 * See plans/contentforge-product/RESEARCH-PROVIDERS.md §3–§4.
 */

import type { z } from "zod";

/** Operations a provider can perform. */
export type Capability = "discover" | "search" | "fetch";

/**
 * How a provider reaches its sources. Enforced at dispatch: a deployment that
 * forbids `local-agent-only` will never run such a provider.
 */
export type AccessClass = "open" | "credentialed" | "local-agent-only";

/**
 * Descriptive hints for planning. Never a code path in the engine — the engine
 * must not branch on these.
 */
export type SourceCapability =
  | "transcript"
  | "comments"
  | "engagement"
  | "time-window"
  | "historical"
  | "structured-metadata"
  | "pagination"
  | "bulk";

export interface SourceRef {
  provider: string;
  /** Provider-defined content kind, e.g. "article" | "post" | "video". */
  kind: string;
  /** Provider-native identifier. Must be stable for evidence identity. */
  nativeId: string;
  canonicalUrl: string;
}

export interface TimeWindow {
  /** ISO-8601 inclusive lower bound. */
  from?: string;
  /** ISO-8601 exclusive upper bound. */
  to?: string;
}

export interface ProviderBudget {
  maxCalls?: number;
  maxFetches?: number;
  maxBytes?: number;
}

export interface BaseContext {
  /** ResearchJob id. Stamped on every result for provenance and tracing. */
  correlationId: string;
  /** Absolute deadline; providers must not exceed it. */
  deadline: Date;
  budget: ProviderBudget;
  /** This provider's configuration slice. */
  config: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}

export interface DiscoverContext extends BaseContext {
  window?: TimeWindow;
  limit?: number;
}

export interface SearchContext extends BaseContext {
  window?: TimeWindow;
  limit?: number;
}

export type FetchContext = BaseContext;

export interface ResearchQuery {
  text: string;
  window?: TimeWindow;
  limit?: number;
}

export interface NormalizedContent {
  /** Normalized plain text — the only form the engine reads. */
  text: string;
  /** Sanitized HTML when available. Never rendered raw. */
  html?: string;
  mime: string;
  length: number;
  truncated: boolean;
}

export interface NormalizedEngagement {
  /** Provider-namespaced raw counters. Not comparable across providers. */
  raw: Record<string, number | string>;
  /** Set only by a ranking hook, never by a provider. */
  normalized?: number;
}

export interface NormalizedAuthor {
  name?: string;
  handle?: string;
  id?: string;
}

export interface NormalizedDegradation {
  reason: string;
  backendAttempts: string[];
}

/** The only shape that crosses the provider seam into the engine. */
export interface NormalizedSource {
  ref: SourceRef;
  provider: string;
  /** Which backend produced this. Recorded, never reasoned about. */
  backend: string;
  providerVersion: string;
  integrationVersion?: string;
  retrievalMethod: string;
  accessClass: AccessClass;

  canonicalUrl: string;
  title: string | null;
  author: NormalizedAuthor | null;
  publishedAt: string | null;
  retrievedAt: string;

  excerpt?: string;
  content?: NormalizedContent;

  /** Hash of normalized text; the dedupe identity below canonical URL. */
  contentHash: string;
  engagement?: NormalizedEngagement;

  /** Provider-specific extras. Opaque to core code. */
  metadata: Record<string, unknown>;
  warnings?: string[];
  degraded?: NormalizedDegradation;
}

export type BackendHealthState =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "unsupported"
  | "unknown";

export interface CapabilityHealth {
  state: BackendHealthState;
  backend?: string;
  lastSuccessAt?: string;
  lastProbeAt?: string;
  lastError?: { class: string; message: string };
  fallbackAvailable: boolean;
}

export interface ProviderHealth {
  provider: string;
  contractVersion: string;
  version: string;
  accessClass: AccessClass;
  state: BackendHealthState | "unconfigured";
  capabilities: Partial<Record<Capability, CapabilityHealth>>;
  checkedAt: string;
}

export interface BackendProbeResult {
  state: BackendHealthState;
  capabilities?: Partial<Record<Capability, { state: BackendHealthState; message?: string }>>;
  message?: string;
}

/**
 * One concrete mechanism (API, feed, CLI, sidecar). A provider holds an ordered
 * list of these; the first healthy one wins (Tier 1 fallback).
 */
export interface ProviderBackend {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly sourceCapabilities?: readonly SourceCapability[];
  discover?(ctx: DiscoverContext, query?: ResearchQuery): Promise<NormalizedSource[]>;
  search?(ctx: SearchContext, query: ResearchQuery): Promise<NormalizedSource[]>;
  fetch?(ctx: FetchContext, ref: SourceRef): Promise<NormalizedSource>;
  probe?(): Promise<BackendProbeResult>;
}

export interface ProviderDefinition {
  /** Stable registry key. Never reused with a different meaning. */
  readonly id: string;
  readonly contractVersion: string;
  readonly version: string;
  readonly accessClass: AccessClass;
  readonly description?: string;
  /** Ordered by preference: index 0 is preferred. */
  readonly backends: readonly ProviderBackend[];
  /** Optional payload/config validation for the provider's config slice. */
  readonly configSchema?: z.ZodType<unknown>;
  /**
   * Resolve this provider's config slice for a research run. Providers own
   * where their config lives (feeds, subreddits, geos); the engine and job
   * handler stay blind to it.
   */
  readonly resolveConfig?: (ctx: {
    userId?: number | null;
  }) => Promise<Record<string, unknown>>;
}

/** Diagnostics for one provider operation, after Tier-1 fallback. */
export interface ProviderCallDiagnostics {
  provider: string;
  backend: string | null;
  capability: Capability;
  outcome: "ok" | "empty" | "failed" | "skipped";
  failureClass?: string;
  message?: string;
  fallbackOccurred: boolean;
  backendsAttempted: string[];
  latencyMs: number;
  resultCount: number;
}

export interface ProviderCallResult<T> {
  data: T;
  diagnostics: ProviderCallDiagnostics;
}
