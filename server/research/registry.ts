/**
 * Provider registry and capability executor.
 *
 * The engine asks for a capability; the registry resolves the implementation.
 * Tier 1 fallback (ordered backends inside one provider) lives here and is
 * invisible to the engine, which only receives `NormalizedSource` plus
 * diagnostics.
 */

import {
  classifyError,
  describeError,
  dispositionFor,
} from "../jobs/failures";
import type { LogSink } from "../jobs/logger";
import type {
  AccessClass,
  Capability,
  DiscoverContext,
  FetchContext,
  NormalizedSource,
  ProviderBackend,
  ProviderCallDiagnostics,
  ProviderCallResult,
  ProviderDefinition,
  ProviderHealth,
  ResearchQuery,
  SearchContext,
  SourceRef,
} from "./contracts";
import { ProviderHealthStore, type HealthStoreOptions } from "./health";

const providers = new Map<string, ProviderDefinition>();

export class ProviderNotRegisteredError extends Error {
  constructor(providerId: string) {
    super(`No provider registered with id "${providerId}"`);
    this.name = "ProviderNotRegisteredError";
  }
}

export class CapabilityUnsupportedError extends Error {
  constructor(providerId: string, capability: Capability) {
    super(`Provider "${providerId}" does not support capability "${capability}"`);
    this.name = "CapabilityUnsupportedError";
  }
}

export class AccessClassNotPermittedError extends Error {
  constructor(providerId: string, accessClass: AccessClass) {
    super(
      `Provider "${providerId}" requires access class "${accessClass}", which this deployment does not permit`,
    );
    this.name = "AccessClassNotPermittedError";
  }
}

export class ProviderUnavailableError extends Error {
  readonly diagnostics: ProviderCallDiagnostics;

  constructor(diagnostics: ProviderCallDiagnostics) {
    super(
      `Provider "${diagnostics.provider}" failed capability "${diagnostics.capability}" after ${diagnostics.backendsAttempted.length} backend(s): ${diagnostics.message ?? "unknown error"}`,
    );
    this.name = "ProviderUnavailableError";
    this.diagnostics = diagnostics;
  }
}

export function registerProvider(definition: ProviderDefinition): void {
  if (!definition.id) throw new Error("provider id is required");
  if (providers.has(definition.id)) {
    throw new Error(`Provider "${definition.id}" is already registered`);
  }
  if (definition.backends.length === 0) {
    throw new Error(`Provider "${definition.id}" must declare at least one backend`);
  }
  providers.set(definition.id, definition);
}

export function getProvider(providerId: string): ProviderDefinition {
  const provider = providers.get(providerId);
  if (!provider) throw new ProviderNotRegisteredError(providerId);
  return provider;
}

export function hasProvider(providerId: string): boolean {
  return providers.has(providerId);
}

export function listProviders(): ProviderDefinition[] {
  const out: ProviderDefinition[] = [];
  providers.forEach((provider) => out.push(provider));
  return out;
}

export function resetProviderRegistry(): void {
  providers.clear();
}

/**
 * Server deployments default to refusing `local-agent-only` providers, per the
 * research-provider architecture (browser-session access never enters the core).
 */
export const DEFAULT_ALLOWED_ACCESS_CLASSES: readonly AccessClass[] = [
  "open",
  "credentialed",
];

export interface ProviderExecutorOptions {
  allowedAccessClasses?: readonly AccessClass[];
  health?: ProviderHealthStore;
  healthOptions?: HealthStoreOptions;
  logSink?: LogSink;
}

export class ProviderExecutor {
  private readonly allowedAccessClasses: readonly AccessClass[];
  readonly health: ProviderHealthStore;
  private readonly logSink?: LogSink;

  constructor(options: ProviderExecutorOptions = {}) {
    this.allowedAccessClasses =
      options.allowedAccessClasses ?? DEFAULT_ALLOWED_ACCESS_CLASSES;
    this.health = options.health ?? new ProviderHealthStore(options.healthOptions);
    this.logSink = options.logSink;
  }

  async discover(
    providerId: string,
    ctx: DiscoverContext,
  ): Promise<ProviderCallResult<NormalizedSource[]>> {
    const provider = this.resolve(providerId, "discover");
    return this.run(
      provider,
      "discover",
      ctx,
      (backend) => backend.discover!(ctx),
      (data) => data.length,
    );
  }

  async search(
    providerId: string,
    ctx: SearchContext,
    query: ResearchQuery,
  ): Promise<ProviderCallResult<NormalizedSource[]>> {
    const provider = this.resolve(providerId, "search");
    return this.run(
      provider,
      "search",
      ctx,
      (backend) => backend.search!(ctx, query),
      (data) => data.length,
    );
  }

  async fetch(
    providerId: string,
    ctx: FetchContext,
    ref: SourceRef,
  ): Promise<ProviderCallResult<NormalizedSource>> {
    const provider = this.resolve(providerId, "fetch");
    return this.run(
      provider,
      "fetch",
      ctx,
      (backend) => backend.fetch!(ctx, ref),
      () => 1,
    );
  }

  /** Backends that could serve a capability, in preference order. */
  eligibleBackends(providerId: string, capability: Capability): ProviderBackend[] {
    const provider = getProvider(providerId);
    return provider.backends.filter((backend) =>
      backend.capabilities.includes(capability),
    );
  }

  /** Whether any backend declares the capability. Never throws for a known provider. */
  supportsCapability(providerId: string, capability: Capability): boolean {
    return this.eligibleBackends(providerId, capability).length > 0;
  }

  healthSnapshot(providerId: string): ProviderHealth {
    const provider = getProvider(providerId);
    return this.health.snapshot(
      provider.id,
      provider.version,
      provider.contractVersion,
      provider.accessClass,
      provider.backends,
    );
  }

  /** Run a backend's own deep probe and fold the result into the health store. */
  async probe(providerId: string): Promise<ProviderHealth> {
    const provider = this.resolve(providerId, undefined);
    for (const backend of provider.backends) {
      if (!backend.probe) continue;
      try {
        const result = await backend.probe();
        for (const capability of backend.capabilities) {
          const detail = result.capabilities?.[capability];
          this.health.recordProbe(
            providerId,
            backend.id,
            capability,
            detail?.state ?? result.state,
            detail?.message ?? result.message,
          );
        }
      } catch (error) {
        for (const capability of backend.capabilities) {
          this.health.recordProbe(
            providerId,
            backend.id,
            capability,
            "unavailable",
            describeError(error),
          );
        }
      }
    }
    return this.healthSnapshot(providerId);
  }

  private resolve(providerId: string, capability?: Capability): ProviderDefinition {
    const provider = getProvider(providerId);

    if (!this.allowedAccessClasses.includes(provider.accessClass)) {
      throw new AccessClassNotPermittedError(providerId, provider.accessClass);
    }
    if (capability) {
      const supports = provider.backends.some((b) => b.capabilities.includes(capability));
      if (!supports) throw new CapabilityUnsupportedError(providerId, capability);
    }
    return provider;
  }

  private async run<T>(
    provider: ProviderDefinition,
    capability: Capability,
    ctx: { deadline: Date; correlationId: string },
    invoke: (backend: ProviderBackend) => Promise<T>,
    count: (data: T) => number,
  ): Promise<ProviderCallResult<T>> {
    const startedAt = Date.now();
    const attempted: string[] = [];
    let lastMessage: string | undefined;
    let lastClass: string | undefined;

    for (const backend of provider.backends) {
      if (!backend.capabilities.includes(capability)) continue;

      if (!this.health.isAvailable(provider.id, backend.id, capability)) {
        attempted.push(backend.id);
        lastMessage = "backend in cooldown";
        lastClass = "transient";
        continue;
      }

      attempted.push(backend.id);
      try {
        const data = await invoke(backend);
        this.health.recordSuccess(provider.id, backend.id, capability);
        const resultCount = count(data);
        const diagnostics: ProviderCallDiagnostics = {
          provider: provider.id,
          backend: backend.id,
          capability,
          outcome: resultCount === 0 ? "empty" : "ok",
          fallbackOccurred: attempted.length > 1,
          backendsAttempted: attempted,
          latencyMs: Date.now() - startedAt,
          resultCount,
        };
        this.log(diagnostics, ctx.correlationId);
        return { data, diagnostics };
      } catch (error) {
        const failureClass = classifyError(error);
        lastClass = failureClass;
        lastMessage = describeError(error);

        if (dispositionFor(failureClass) === "terminal") {
          this.health.recordFailure(provider.id, backend.id, capability, {
            failureClass,
            message: lastMessage,
          });
          // A terminal failure is not retried on this backend, but another
          // backend may have its own credentials and still work.
          continue;
        }

        this.health.recordFailure(provider.id, backend.id, capability, {
          failureClass,
          message: lastMessage,
          retryAfterMs:
            typeof error === "object" && error !== null && "retryAfterMs" in error
              ? (error as { retryAfterMs?: number }).retryAfterMs
              : undefined,
        });
      }
    }

    const diagnostics: ProviderCallDiagnostics = {
      provider: provider.id,
      backend: null,
      capability,
      outcome: "failed",
      failureClass: lastClass ?? "transient",
      message: lastMessage ?? "all backends failed",
      fallbackOccurred: attempted.length > 1,
      backendsAttempted: attempted,
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
    };
    this.log(diagnostics, ctx.correlationId);
    throw new ProviderUnavailableError(diagnostics);
  }

  private log(diagnostics: ProviderCallDiagnostics, correlationId: string): void {
    if (!this.logSink) return;
    this.logSink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: diagnostics.outcome === "failed" ? "warn" : "info",
        msg: "provider call",
        correlationId,
        ...diagnostics,
      }),
    );
  }
}
