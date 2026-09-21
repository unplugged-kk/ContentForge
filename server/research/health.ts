/**
 * Provider/backend health with cooldown and circuit breaking.
 *
 * Selection is deterministic; only *availability* adapts. A backend that fails
 * is cooled down for that specific capability, so one broken backend does not
 * disable a provider's other capabilities.
 */

import type {
  AccessClass,
  BackendHealthState,
  Capability,
  ProviderBackend,
  ProviderHealth,
} from "./contracts";

export interface BackendCapabilityHealth {
  state: BackendHealthState;
  consecutiveFailures: number;
  cooldownUntil: number | null;
  lastSuccessAt: string | null;
  lastProbeAt: string | null;
  lastError: { class: string; message: string } | null;
}

export interface HealthStoreOptions {
  /** Consecutive transient failures before a backend is tripped open. */
  failureThreshold?: number;
  /** Base cooldown once tripped, in ms. */
  cooldownMs?: number;
  /** Upper bound for cooldown growth. */
  maxCooldownMs?: number;
  now?: () => number;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_COOLDOWN_MS = 30 * 60_000;

function key(providerId: string, backendId: string, capability: Capability): string {
  return `${providerId}::${backendId}::${capability}`;
}

export class ProviderHealthStore {
  private readonly entries = new Map<string, BackendCapabilityHealth>();
  private readonly options: Required<Omit<HealthStoreOptions, "now">> & {
    now: () => number;
  };

  constructor(options: HealthStoreOptions = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
      cooldownMs: options.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      maxCooldownMs: options.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS,
      now: options.now ?? (() => Date.now()),
    };
  }

  private entry(providerId: string, backendId: string, capability: Capability) {
    const k = key(providerId, backendId, capability);
    let existing = this.entries.get(k);
    if (!existing) {
      existing = {
        state: "unknown",
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastSuccessAt: null,
        lastProbeAt: null,
        lastError: null,
      };
      this.entries.set(k, existing);
    }
    return existing;
  }

  get(providerId: string, backendId: string, capability: Capability): BackendCapabilityHealth {
    return { ...this.entry(providerId, backendId, capability) };
  }

  /** A backend is usable when it is not cooled down. */
  isAvailable(providerId: string, backendId: string, capability: Capability): boolean {
    const entry = this.entry(providerId, backendId, capability);
    if (entry.cooldownUntil === null) return true;
    if (entry.cooldownUntil <= this.options.now()) {
      // Cooldown elapsed: half-open, allow one attempt.
      entry.cooldownUntil = null;
      entry.state = "degraded";
      return true;
    }
    return false;
  }

  recordSuccess(providerId: string, backendId: string, capability: Capability): void {
    const entry = this.entry(providerId, backendId, capability);
    entry.state = "healthy";
    entry.consecutiveFailures = 0;
    entry.cooldownUntil = null;
    entry.lastError = null;
    entry.lastSuccessAt = new Date(this.options.now()).toISOString();
  }

  recordFailure(
    providerId: string,
    backendId: string,
    capability: Capability,
    failure: { failureClass: string; message: string; retryAfterMs?: number },
  ): void {
    const entry = this.entry(providerId, backendId, capability);
    const now = this.options.now();
    entry.consecutiveFailures += 1;
    entry.lastError = { class: failure.failureClass, message: failure.message };

    if (failure.failureClass === "permanent" || failure.failureClass === "policy_human") {
      entry.state = "unavailable";
      entry.cooldownUntil = now + this.options.maxCooldownMs;
      return;
    }

    if (failure.failureClass === "rate_limited") {
      entry.state = "degraded";
      entry.cooldownUntil = now + (failure.retryAfterMs ?? this.options.cooldownMs);
      return;
    }

    if (entry.consecutiveFailures >= this.options.failureThreshold) {
      const growth = 2 ** (entry.consecutiveFailures - this.options.failureThreshold);
      entry.state = "unavailable";
      entry.cooldownUntil = Math.min(
        now + this.options.cooldownMs * growth,
        now + this.options.maxCooldownMs,
      );
      return;
    }

    entry.state = "degraded";
  }

  recordProbe(
    providerId: string,
    backendId: string,
    capability: Capability,
    state: BackendHealthState,
    message?: string,
  ): void {
    const entry = this.entry(providerId, backendId, capability);
    entry.lastProbeAt = new Date(this.options.now()).toISOString();
    entry.state = state;
    if (state === "healthy") {
      entry.consecutiveFailures = 0;
      entry.cooldownUntil = null;
      entry.lastError = null;
    } else if (message) {
      entry.lastError = { class: "probe", message };
    }
  }

  /** True when at least one *other* backend could serve the capability. */
  fallbackAvailable(
    providerId: string,
    backends: readonly ProviderBackend[],
    capability: Capability,
    current: string,
  ): boolean {
    return backends.some(
      (backend) =>
        backend.id !== current &&
        backend.capabilities.includes(capability) &&
        this.isAvailable(providerId, backend.id, capability),
    );
  }

  snapshot(
    providerId: string,
    version: string,
    contractVersion: string,
    accessClass: AccessClass,
    backends: readonly ProviderBackend[],
  ): ProviderHealth {
    const capabilities: ProviderHealth["capabilities"] = {};
    let anyHealthy = false;
    let anyKnown = false;

    for (const capability of ["discover", "search", "fetch"] as const) {
      const candidates = backends.filter((b) => b.capabilities.includes(capability));
      if (candidates.length === 0) continue;

      const states = candidates.map((b) => ({
        backend: b,
        entry: this.entry(providerId, b.id, capability),
      }));
      const usable = states.find(
        ({ backend }) => this.isAvailable(providerId, backend.id, capability),
      );
      const chosen = usable ?? states[0];
      const healthy = usable !== undefined;
      if (healthy) anyHealthy = true;
      anyKnown = true;

      capabilities[capability] = {
        state: healthy ? chosen.entry.state : "unavailable",
        backend: chosen.backend.id,
        lastSuccessAt: chosen.entry.lastSuccessAt ?? undefined,
        lastProbeAt: chosen.entry.lastProbeAt ?? undefined,
        lastError: chosen.entry.lastError ?? undefined,
        fallbackAvailable: this.fallbackAvailable(
          providerId,
          backends,
          capability,
          chosen.backend.id,
        ),
      };
    }

    return {
      provider: providerId,
      version,
      contractVersion,
      accessClass,
      state: !anyKnown ? "unknown" : anyHealthy ? "healthy" : "unavailable",
      capabilities,
      checkedAt: new Date(this.options.now()).toISOString(),
    };
  }

  reset(): void {
    this.entries.clear();
  }
}
