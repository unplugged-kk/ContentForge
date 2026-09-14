/**
 * Unit tests for the real OpenAI(-compatible) image provider (Phase 9 §12).
 *
 * Pure helpers (size mapping, prompt building, failure classification) are
 * tested directly with no I/O. The `generate()` HTTP call itself is tested
 * against a local `node:http` double standing in for the images-generation
 * endpoint — the genuine external-provider boundary — driven purely through
 * `AI_BASE_URL`/`AI_API_KEY`, the SAME configuration seam every other AI call
 * in this repo already uses. No real OpenAI credential is required or used.
 *
 * `AI_BASE_URL` must be set BEFORE `server/ai/config.ts` is first imported
 * (it constructs its client once, at module load), so this file sets env vars
 * and only then dynamically imports the provider under test.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

function pngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
}

let server: http.Server;
let baseUrl: string;
let lastRequestBody: Record<string, unknown> | null = null;
let mode: "ok" | "error500" | "url" = "ok";

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/fixture.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(pngBytes());
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastRequestBody = body ? JSON.parse(body) : {};
      if (mode === "error500") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "upstream overloaded" } }));
        return;
      }
      if (mode === "url") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ url: `${baseUrl}/fixture.png` }] }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: pngBytes().toString("base64") }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // MUST happen before the dynamic import below — server/ai/config.ts
  // constructs its client once, at import time.
  process.env.AI_BASE_URL = `${baseUrl}/v1`;
  process.env.AI_API_KEY = "test-key-not-real";
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("openai image provider — pure helpers (no I/O)", () => {
  it("maps aspect ratio to the nearest fixed OpenAI size preset", async () => {
    const { sizeForAspectRatio } = await import("./openaiImage");
    assert.equal(sizeForAspectRatio("1:1"), "1024x1024");
    assert.equal(sizeForAspectRatio("16:9"), "1536x1024");
    assert.equal(sizeForAspectRatio("9:16"), "1024x1536");
    assert.equal(sizeForAspectRatio("4:5"), "1024x1536");
    assert.equal(sizeForAspectRatio(undefined), "1024x1024");
  });

  it("builds a prompt from the intent fields, falling back when empty", async () => {
    const { buildPrompt } = await import("./openaiImage");
    assert.match(buildPrompt({ subject: "a scheduler diagram", style: "flat" }), /scheduler diagram.*Style: flat/);
    assert.equal(buildPrompt({}), "A clean, professional illustration.");
  });

  it("classifies provider failures into the existing transient/permanent taxonomy", async () => {
    const { classifyOpenAiImageError } = await import("./openaiImage");
    assert.equal(classifyOpenAiImageError({ status: 500 }), "transient");
    assert.equal(classifyOpenAiImageError({ status: 429 }), "transient");
    assert.equal(classifyOpenAiImageError({ status: 401 }), "permanent");
    assert.equal(classifyOpenAiImageError({ status: 400 }), "permanent");
    assert.equal(classifyOpenAiImageError(new Error("fetch failed")), "transient");
    assert.equal(classifyOpenAiImageError(new Error("nonsense")), "permanent");
  });
});

describe("openai image provider — real HTTP call against a local double", () => {
  it("declares image-only capabilities and the configured model, synchronously", async () => {
    const { createOpenAiImageProvider } = await import("./openaiImage");
    const provider = createOpenAiImageProvider({ providerId: "openai-image-test", models: ["gpt-image-1"] });
    assert.deepEqual(provider.capabilities, ["generate_image"]);
    assert.deepEqual(provider.modalities, ["image"]);
    assert.deepEqual(provider.models, ["gpt-image-1"]);
    assert.equal(provider.synchronous, true);
  });

  it("calls the real images.generate contract and decodes b64_json into durable bytes", async () => {
    mode = "ok";
    const { createOpenAiImageProvider } = await import("./openaiImage");
    const provider = createOpenAiImageProvider({ providerId: "openai-image-test", models: ["gpt-image-1"] });
    const output = await provider.generate({
      kind: "image",
      capability: "generate_image",
      snapshot: { intent: { subject: "hero image of a scheduler", aspectRatio: "1:1" } },
      correlationId: "c1",
      model: "gpt-image-1",
    });
    assert.equal(output.mime, "image/png");
    assert.deepEqual(output.bytes, pngBytes());
    assert.equal(output.model, "gpt-image-1");
    assert.equal(output.provider, "openai-image-test");
    assert.equal(lastRequestBody?.model, "gpt-image-1");
    assert.equal(lastRequestBody?.size, "1024x1024");
  });

  it("follows a url-shaped response and fetches the bytes", async () => {
    mode = "url";
    const { createOpenAiImageProvider } = await import("./openaiImage");
    const provider = createOpenAiImageProvider({ providerId: "openai-image-test", models: ["dall-e-3"] });
    const output = await provider.generate({
      kind: "image",
      capability: "generate_image",
      snapshot: { intent: { subject: "x" } },
      correlationId: "c2",
      model: "dall-e-3",
    });
    assert.deepEqual(output.bytes, pngBytes());
    mode = "ok";
  });

  it("classifies a real 5xx from the provider as transient, via JobFailure", async () => {
    mode = "error500";
    const { createOpenAiImageProvider } = await import("./openaiImage");
    const { JobFailure } = await import("../../jobs/failures");
    const provider = createOpenAiImageProvider({ providerId: "openai-image-test", models: ["gpt-image-1"] });
    await assert.rejects(
      () =>
        provider.generate({
          kind: "image",
          capability: "generate_image",
          snapshot: { intent: { subject: "x" } },
          correlationId: "c3",
          model: "gpt-image-1",
        }),
      (error: unknown) => error instanceof JobFailure && error.failureClass === "transient",
    );
    mode = "ok";
  });
});
