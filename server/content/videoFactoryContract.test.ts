/**
 * Unit tests for the Video Factory contract + provider adapter (Phase 21).
 *
 * No Postgres. Memory/filesystem transports are the external boundary doubles.
 * HyperFrames/TTS are not invoked.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { JobFailure } from "../jobs/failures";
import {
  VIDEO_FACTORY_CONTRACT_VERSION,
  assertSafeVideoFactoryJobId,
  buildVideoFactoryJobRequest,
  classifyVideoFactoryState,
  parseVideoFactoryJobRequest,
  serializeVideoFactoryJobRequest,
  validateVideoFactoryRenderSpec,
  videoFactoryJobId,
} from "./videoFactoryContract";
import { createFilesystemVideoFactoryTransport, createMemoryVideoFactoryTransport } from "./videoFactoryTransport";
import { createConfiguredVideoFactoryProvider, createVideoFactoryProvider } from "./videoFactoryProvider";
import {
  InvalidVisualInputError,
  listVisualProviders,
  registerVisualProvider,
  resetVisualProviders,
  visualProviderHealth,
} from "./visual";
import { fixtureMp4Bytes } from "./visualFixture";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    intent: {
      subject: "Vertical explainer about frozen context",
      aspectRatio: "9:16",
      durationMs: 1500,
      ...overrides,
    },
    spec: { aspectRatio: "9:16", width: 1080, height: 1920 },
    context: { renderedBlock: "SECRET_CONTEXT", contextHash: "abc" },
  };
}

describe("video-factory.contract.v1", () => {
  it("serializes a bounded textual job and round-trips the version", () => {
    const request = buildVideoFactoryJobRequest({ generationId: 42, snapshot: snapshot() });
    assert.equal(request.contractVersion, VIDEO_FACTORY_CONTRACT_VERSION);
    assert.equal(request.jobId, "cfvg-42");
    assert.equal(request.format, "9:16");
    assert.equal(request.voice.enabled, false);
    assert.equal(request.render.quality, "high");
    assert.doesNotMatch(request.brief, /SECRET_CONTEXT/);
    const parsed = parseVideoFactoryJobRequest(JSON.parse(serializeVideoFactoryJobRequest(request)));
    assert.equal(parsed.jobId, "cfvg-42");
    assert.equal(parsed.durationMs, 1500);
  });

  it("rejects unsupported contract versions", () => {
    const request = buildVideoFactoryJobRequest({ generationId: 1, snapshot: snapshot() });
    assert.throws(
      () => parseVideoFactoryJobRequest({ ...request, contractVersion: "video-factory.contract.v0" }),
      InvalidVisualInputError,
    );
  });

  it("job ids are filesystem-safe and derived from VisualGeneration id", () => {
    assert.equal(videoFactoryJobId(7), "cfvg-7");
    assert.equal(assertSafeVideoFactoryJobId("cfvg-7"), "cfvg-7");
    assert.throws(() => videoFactoryJobId(0), InvalidVisualInputError);
    assert.throws(() => assertSafeVideoFactoryJobId("../etc"), InvalidVisualInputError);
    assert.throws(() => assertSafeVideoFactoryJobId("cfvg-1/../../etc"), InvalidVisualInputError);
    assert.throws(() => assertSafeVideoFactoryJobId("/tmp/cfvg-1"), InvalidVisualInputError);
    assert.throws(() => assertSafeVideoFactoryJobId("cfvg-1\\x"), InvalidVisualInputError);
  });

  it("render options are allowlisted; arrays and command strings are rejected", () => {
    assert.deepEqual(validateVideoFactoryRenderSpec({ quality: "draft" }), { quality: "draft" });
    assert.throws(() => validateVideoFactoryRenderSpec(["--quality", "high"]), InvalidVisualInputError);
    assert.throws(() => validateVideoFactoryRenderSpec("--output /etc/passwd"), InvalidVisualInputError);
    assert.throws(() => validateVideoFactoryRenderSpec({ quality: "high", extra: "--rm" }), InvalidVisualInputError);
    assert.throws(() => validateVideoFactoryRenderSpec({ quality: "ultra" }), InvalidVisualInputError);
  });

  it("intent cannot supply job identity, callback URLs, output paths, or renderArgs", () => {
    assert.throws(
      () => buildVideoFactoryJobRequest({ generationId: 1, snapshot: snapshot({ jobId: "other" }) }),
      InvalidVisualInputError,
    );
    assert.throws(
      () => buildVideoFactoryJobRequest({ generationId: 1, snapshot: snapshot({ renderArgs: ["--output", "x"] }) }),
      InvalidVisualInputError,
    );
    assert.throws(
      () => buildVideoFactoryJobRequest({ generationId: 1, snapshot: snapshot({ callbackUrl: "http://evil" }) }),
      InvalidVisualInputError,
    );
    assert.throws(
      () => buildVideoFactoryJobRequest({ generationId: 1, snapshot: snapshot({ outputPath: "/tmp/out.mp4" }) }),
      InvalidVisualInputError,
    );
  });

  it("maps factory states conservatively — done is not ready, accepted is not ready", () => {
    assert.equal(classifyVideoFactoryState("accepted"), "in_progress");
    assert.equal(classifyVideoFactoryState("queued"), "in_progress");
    assert.equal(classifyVideoFactoryState("rendering"), "in_progress");
    assert.equal(classifyVideoFactoryState("done"), "completed");
    assert.equal(classifyVideoFactoryState("failed"), "permanent");
    assert.equal(classifyVideoFactoryState("unknown"), "unknown");
  });

  it("missing brief and script is an honest missing-artifact failure", () => {
    assert.throws(
      () =>
        buildVideoFactoryJobRequest({
          generationId: 1,
          snapshot: { intent: { aspectRatio: "9:16" }, spec: {} },
        }),
      /missing renderable project artifact/,
    );
  });
});

describe("video-factory provider adapter", () => {
  it("submits once, retries the same identity, and imports only after done", async () => {
    const transport = createMemoryVideoFactoryTransport();
    const provider = createVideoFactoryProvider({ transport, pollBudgetMs: 0 });
    const request = {
      kind: "video" as const,
      capability: "generate_video" as const,
      snapshot: snapshot(),
      correlationId: "c",
      generationId: 11,
    };
    await assert.rejects(() => provider.generate(request), (err: unknown) => {
      return err instanceof JobFailure && err.failureClass === "transient" && /queued/.test(err.message);
    });
    assert.equal(transport.jobs.size, 1);
    assert.equal(transport.jobs.get("cfvg-11")?.state, "queued");

    await assert.rejects(() => provider.generate(request), JobFailure);
    assert.equal(transport.jobs.size, 1, "retry must not create a second factory job");

    transport.complete("cfvg-11", { bytes: fixtureMp4Bytes(), width: 1080, height: 1920, durationMs: 1500 });
    const out = await provider.generate(request);
    assert.equal(out.mime, "video/mp4");
    assert.equal(out.usage.externalJobId, "cfvg-11");
    assert.equal(out.usage.contractVersion, VIDEO_FACTORY_CONTRACT_VERSION);
    assert.equal(typeof out.usage.outputIdentity, "string");
    assert.equal(out.durationMs, 1500);
    assert.doesNotMatch(JSON.stringify(out.usage), /\/Users\//);
  });

  it("unknown state after submit does not mint a new job id", async () => {
    const transport = createMemoryVideoFactoryTransport();
    const provider = createVideoFactoryProvider({ transport, pollBudgetMs: 0 });
    const request = {
      kind: "video" as const,
      capability: "generate_video" as const,
      snapshot: snapshot(),
      correlationId: "c",
      generationId: 12,
    };
    await assert.rejects(() => provider.generate(request), JobFailure);
    transport.setState("cfvg-12", "unknown");
    await assert.rejects(() => provider.generate(request), (err: unknown) => {
      return err instanceof JobFailure && err.failureClass === "transient" && /unknown/.test(err.message);
    });
    assert.equal(transport.jobs.size, 1);
    assert.equal(Array.from(transport.jobs.keys())[0], "cfvg-12");
  });

  it("failed factory job is permanent; missing output after done is permanent", async () => {
    const transport = createMemoryVideoFactoryTransport();
    const provider = createVideoFactoryProvider({ transport, pollBudgetMs: 0 });
    const request = {
      kind: "video" as const,
      capability: "generate_video" as const,
      snapshot: snapshot(),
      correlationId: "c",
      generationId: 13,
    };
    await assert.rejects(() => provider.generate(request), JobFailure);
    transport.fail("cfvg-13", "render failed");
    await assert.rejects(() => provider.generate(request), (err: unknown) => {
      return err instanceof JobFailure && err.failureClass === "permanent";
    });

    const missing = createMemoryVideoFactoryTransport();
    const missingProvider = createVideoFactoryProvider({ transport: missing, pollBudgetMs: 0 });
    const other = { ...request, generationId: 14 };
    await assert.rejects(() => missingProvider.generate(other), JobFailure);
    missing.setState("cfvg-14", "done");
    await assert.rejects(() => missingProvider.generate(other), (err: unknown) => {
      return err instanceof JobFailure && err.failureClass === "permanent" && /output is missing/.test(err.message);
    });
  });

  it("unreachable factory is transient; unconfigured transport is not live-healthy", async () => {
    const transport = createMemoryVideoFactoryTransport();
    transport.setReachable(false);
    const provider = createVideoFactoryProvider({ transport, pollBudgetMs: 0 });
    await assert.rejects(
      () =>
        provider.generate({
          kind: "video",
          capability: "generate_video",
          snapshot: snapshot(),
          correlationId: "c",
          generationId: 1,
        }),
      (err: unknown) => err instanceof JobFailure && err.failureClass === "transient" && /unreachable/.test(err.message),
    );

    const unconfigured = createConfiguredVideoFactoryProvider({ ...process.env, VIDEO_FACTORY_ROOT: "" });
    const health = await unconfigured.health!();
    assert.equal(health.registered, true);
    assert.equal(health.transportConfigured, false);
    assert.equal(health.reachable, false);
    assert.equal(health.capabilities.includes("generate_video"), true);
  });

  it("refine_video is permanently unsupported", async () => {
    const provider = createVideoFactoryProvider({
      transport: createMemoryVideoFactoryTransport(),
      pollBudgetMs: 0,
    });
    await assert.rejects(
      () =>
        provider.generate({
          kind: "video",
          capability: "refine_video",
          snapshot: snapshot(),
          correlationId: "c",
          generationId: 1,
        }),
      (err: unknown) => err instanceof JobFailure && err.failureClass === "permanent" && /refine_video/.test(err.message),
    );
  });

  it("health reports registered generate_video without treating config as a live render", async () => {
    resetVisualProviders();
    const transport = createMemoryVideoFactoryTransport();
    registerVisualProvider(createVideoFactoryProvider({ transport, pollBudgetMs: 0 }));
    const listed = listVisualProviders();
    assert.equal(listed.some((p) => p.providerId === "video-factory"), true);
    const health = await visualProviderHealth(listed.find((p) => p.providerId === "video-factory")!);
    assert.equal(health.registered, true);
    assert.equal(health.reachable, true);
    assert.equal(health.synchronous, false);
    resetVisualProviders();
  });
});

describe("video-factory filesystem transport", () => {
  it("writes a versioned contract folder and rejects path traversal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cf-vf-"));
    try {
      const transport = createFilesystemVideoFactoryTransport(root);
      const request = buildVideoFactoryJobRequest({ generationId: 99, snapshot: snapshot({ script: "Hook." }) });
      const submitted = await transport.submit(request);
      assert.equal(submitted.state, "accepted");
      const queued = path.join(root, "queue", "cfvg-99");
      const contract = JSON.parse(await readFile(path.join(queued, "CONTRACT.json"), "utf8"));
      assert.equal(contract.contractVersion, VIDEO_FACTORY_CONTRACT_VERSION);
      const native = JSON.parse(await readFile(path.join(queued, "job.json"), "utf8"));
      assert.deepEqual(native.renderArgs, ["--quality", "high"]);
      assert.equal(native.voice, false);
      const html = await readFile(path.join(queued, "index.html"), "utf8");
      assert.match(html, /data-composition-id="root"/);
      assert.match(html, /cfvg-99/);
      assert.equal(html.includes("<script>alert"), false);
      const malicious = buildVideoFactoryJobRequest({
        generationId: 100,
        snapshot: snapshot({ title: "<script>alert(1)</script>", subject: "<img src=x onerror=alert(1)>" }),
      });
      await transport.submit(malicious);
      const escaped = await readFile(path.join(root, "queue", "cfvg-100", "index.html"), "utf8");
      assert.match(escaped, /&lt;script&gt;/);
      assert.equal(escaped.includes("<script>alert(1)</script>"), false);

      await assert.rejects(() => transport.getStatus("cfvg-99/../../etc"), InvalidVisualInputError);
      await assert.rejects(() => transport.submit({ ...request, jobId: "cfvg-1/../x" }), InvalidVisualInputError);

      const again = await transport.submit(request);
      assert.equal(again.jobId, "cfvg-99");
      const status = await transport.getStatus("cfvg-99");
      assert.equal(status.state, "queued");
      assert.equal(status.observational, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("imports output bytes without exposing the factory path as identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cf-vf-"));
    try {
      const transport = createFilesystemVideoFactoryTransport(root);
      const request = buildVideoFactoryJobRequest({ generationId: 5, snapshot: snapshot() });
      await transport.submit(request);
      await mkdir(path.join(root, "output"), { recursive: true });
      await writeFile(path.join(root, "output", "cfvg-5.mp4"), fixtureMp4Bytes());
      await mkdir(path.join(root, "state"), { recursive: true });
      await writeFile(path.join(root, "state", "cfvg-5.json"), JSON.stringify({ id: "cfvg-5", status: "done" }));
      const status = await transport.getStatus("cfvg-5");
      assert.equal(status.state, "done");
      const output = await transport.getOutput("cfvg-5");
      assert.ok(output);
      assert.equal(output.mime, "video/mp4");
      assert.equal(output.durationMs, 1500);
      assert.equal(output.outputIdentity.length, 64);
      assert.equal("outputPath" in output, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
