import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { JobFailure } from "../jobs/failures";
import type {
  BackendProbeResult,
  NormalizedSource,
  ProviderBackend,
  ProviderDefinition,
} from "./contracts";
import { ProviderHealthStore } from "./health";
import {
  AccessClassNotPermittedError,
  CapabilityUnsupportedError,
  ProviderExecutor,
  ProviderNotRegisteredError,
  ProviderUnavailableError,
  getProvider,
  hasProvider,
  listProviders,
  registerProvider,
  resetProviderRegistry,
} from "./registry";

function source(provider: string, backend: string, id: string): NormalizedSource {
  return {
    ref: { provider, kind: "article", nativeId: id, canonicalUrl: `https://e.test/${id}` },
    provider,
    backend,
    providerVersion: "1",
    retrievalMethod: "test",
    accessClass: "open",
    canonicalUrl: `https://e.test/${id}`,
    title: id,
    author: null,
    publishedAt: null,
    retrievedAt: new Date().toISOString(),
    contentHash: id,
    metadata: {},
  };
}

function backend(
  id: string,
  behaviour: () => Promise<NormalizedSource[]> | NormalizedSource[],
  capabilities: ProviderBackend["capabilities"] = ["discover"],
): ProviderBackend {
  return {
    id,
    capabilities,
    discover: async () => behaviour(),
  };
}

function provider(id: string, backends: ProviderBackend[], accessClass: ProviderDefinition["accessClass"] = "open"): ProviderDefinition {
  return { id, contractVersion: "1", version: "1", accessClass, backends };
}

const ctx = () => ({
  correlationId: "corr-1",
  deadline: new Date(Date.now() + 5_000),
  budget: {},
  config: {},
});

describe("provider registry", () => {
  beforeEach(() => resetProviderRegistry());

  it("registers and resolves a provider", () => {
    registerProvider(provider("p1", [backend("b1", () => [])]));
    assert.equal(hasProvider("p1"), true);
    assert.equal(getProvider("p1").id, "p1");
    assert.deepEqual(
      listProviders().map((p) => p.id),
      ["p1"],
    );
  });

  it("rejects duplicate ids and providers with no backends", () => {
    registerProvider(provider("p1", [backend("b1", () => [])]));
    assert.throws(() => registerProvider(provider("p1", [backend("b2", () => [])])), /already registered/);
    assert.throws(() => registerProvider(provider("p2", [])), /at least one backend/);
  });

  it("throws for an unknown provider", () => {
    assert.throws(() => getProvider("nope"), ProviderNotRegisteredError);
  });
});

describe("provider executor", () => {
  beforeEach(() => resetProviderRegistry());

  it("returns normalized sources with diagnostics", async () => {
    registerProvider(provider("p1", [backend("b1", () => [source("p1", "b1", "one")])]));
    const executor = new ProviderExecutor();
    const result = await executor.discover("p1", ctx());

    assert.equal(result.data.length, 1);
    assert.equal(result.diagnostics.outcome, "ok");
    assert.equal(result.diagnostics.backend, "b1");
    assert.equal(result.diagnostics.fallbackOccurred, false);
    assert.equal(result.diagnostics.resultCount, 1);
  });

  it("marks an empty result as empty, not failed", async () => {
    registerProvider(provider("p1", [backend("b1", () => [])]));
    const result = await new ProviderExecutor().discover("p1", ctx());
    assert.equal(result.diagnostics.outcome, "empty");
    assert.equal(result.data.length, 0);
  });

  it("falls back to the next backend when the preferred one throws", async () => {
    registerProvider(
      provider("p1", [
        backend("broken", () => {
          throw new Error("backend down");
        }),
        backend("good", () => [source("p1", "good", "two")]),
      ]),
    );

    const result = await new ProviderExecutor().discover("p1", ctx());
    assert.equal(result.diagnostics.backend, "good");
    assert.equal(result.diagnostics.fallbackOccurred, true);
    assert.deepEqual(result.diagnostics.backendsAttempted, ["broken", "good"]);
  });

  it("skips a backend that cannot serve the capability", async () => {
    registerProvider(
      provider("p1", [
        { id: "fetch-only", capabilities: ["fetch"], fetch: async () => source("p1", "fetch-only", "x") },
        backend("discover-capable", () => [source("p1", "discover-capable", "y")]),
      ]),
    );

    const result = await new ProviderExecutor().discover("p1", ctx());
    assert.equal(result.diagnostics.backend, "discover-capable");
  });

  it("raises a typed error when every backend fails", async () => {
    registerProvider(
      provider("p1", [
        backend("a", () => {
          throw new Error("a down");
        }),
        backend("b", () => {
          throw new Error("b down");
        }),
      ]),
    );

    await assert.rejects(
      () => new ProviderExecutor().discover("p1", ctx()),
      (error: unknown) => {
        assert.ok(error instanceof ProviderUnavailableError);
        assert.deepEqual(error.diagnostics.backendsAttempted, ["a", "b"]);
        assert.equal(error.diagnostics.outcome, "failed");
        return true;
      },
    );
  });

  it("throws when the capability is unsupported", async () => {
    registerProvider(provider("p1", [backend("b1", () => [], ["discover"])]));
    await assert.rejects(
      () => new ProviderExecutor().search("p1", ctx(), { text: "x" }),
      CapabilityUnsupportedError,
    );
  });

  it("refuses a provider whose access class the deployment forbids", async () => {
    registerProvider(provider("local", [backend("b1", () => [])], "local-agent-only"));
    await assert.rejects(
      () => new ProviderExecutor().discover("local", ctx()),
      AccessClassNotPermittedError,
    );
  });

  it("permits a local-agent provider only when explicitly allowed", async () => {
    registerProvider(provider("local", [backend("b1", () => [source("local", "b1", "z")])], "local-agent-only"));
    const executor = new ProviderExecutor({ allowedAccessClasses: ["local-agent-only"] });
    const result = await executor.discover("local", ctx());
    assert.equal(result.data.length, 1);
  });

  it("cools a failing backend down and then reports the provider unavailable", async () => {
    let calls = 0;
    registerProvider(
      provider("p1", [
        backend("b1", () => {
          calls += 1;
          throw new Error("always down");
        }),
      ]),
    );

    const executor = new ProviderExecutor({ healthOptions: { failureThreshold: 1, cooldownMs: 60_000 } });

    await assert.rejects(() => executor.discover("p1", ctx()), ProviderUnavailableError);
    const firstCalls = calls;

    // Second attempt: the backend is in cooldown, so no additional work is done.
    await assert.rejects(() => executor.discover("p1", ctx()), ProviderUnavailableError);
    assert.equal(calls, firstCalls, "cooled-down backend is not called again");

    const health = executor.healthSnapshot("p1");
    assert.equal(health.capabilities.discover?.state, "unavailable");
  });

  it("recovers a backend once the cooldown expires", async () => {
    let now = 1_000_000;
    const store = new ProviderHealthStore({
      failureThreshold: 1,
      cooldownMs: 1_000,
      now: () => now,
    });

    let healthy = false;
    registerProvider(
      provider("p1", [
        backend("b1", () => {
          if (!healthy) throw new Error("down");
          return [source("p1", "b1", "ok")];
        }),
      ]),
    );

    const executor = new ProviderExecutor({ health: store });
    await assert.rejects(() => executor.discover("p1", ctx()), ProviderUnavailableError);

    healthy = true;
    now += 5_000;
    const result = await executor.discover("p1", ctx());
    assert.equal(result.diagnostics.outcome, "ok");
  });

  it("treats a terminal failure on one backend as eligible for another", async () => {
    registerProvider(
      provider("p1", [
        backend("a", () => {
          throw JobFailure.permanent("bad credentials");
        }),
        backend("b", () => [source("p1", "b", "from-b")]),
      ]),
    );

    const result = await new ProviderExecutor().discover("p1", ctx());
    assert.equal(result.diagnostics.backend, "b");
    assert.equal(result.diagnostics.fallbackOccurred, true);
  });

  it("probes backends and records capability health", async () => {
    registerProvider(
      provider("p1", [
        {
          id: "b1",
          capabilities: ["discover"],
          discover: async () => [],
          probe: async (): Promise<BackendProbeResult> => ({
            state: "degraded",
            capabilities: { discover: { state: "degraded", message: "partial" } },
          }),
        },
      ]),
    );

    const health = await new ProviderExecutor().probe("p1");
    assert.equal(health.capabilities.discover?.state, "degraded");
    assert.ok(health.capabilities.discover?.lastProbeAt);
  });

  it("reports fallback availability for a capability", async () => {
    registerProvider(
      provider("p1", [
        backend("a", () => []),
        backend("b", () => []),
      ]),
    );
    const executor = new ProviderExecutor();
    assert.equal(executor.eligibleBackends("p1", "discover").length, 2);
    assert.equal(executor.healthSnapshot("p1").capabilities.discover?.fallbackAvailable, true);
  });
});
