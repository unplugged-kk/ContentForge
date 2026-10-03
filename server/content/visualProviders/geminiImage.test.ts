/**
 * Nano Banana (Gemini image) provider.
 *
 * Pure helpers are tested directly. `generate()` is tested against a local
 * `node:http` double standing in for `:generateContent` — the real external
 * boundary — driven through the provider's own `baseUrl` override, so no Gemini
 * credential is required or used here. The paid-media gate is asserted
 * explicitly, because that gate is the finding this provider closes.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

function pngBytes(width = 2, height = 2): Buffer {
  // Minimal PNG: signature + IHDR (with the given dimensions) + IEND.
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  const iend = Buffer.from("0000000049454e44ae426082", "hex");
  return Buffer.concat([sig, ihdr, iend]);
}

let server: http.Server;
let baseUrl: string;
let mode: "image" | "textonly" | "error429" | "error400" = "image";
let lastBody: Record<string, any> | null = null;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastBody = body ? JSON.parse(body) : {};
      if (mode === "error429") {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "rate limited" } }));
        return;
      }
      if (mode === "error400") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "bad request" } }));
        return;
      }
      if (mode === "textonly") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "I cannot draw that." }] } }] }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Here is the illustration." },
                  { inlineData: { mimeType: "image/png", data: pngBytes(64, 64).toString("base64") } },
                ],
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta`;
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.CONTENTFORGE_ALLOW_PAID_MEDIA = "1";
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("gemini image provider — pure helpers", () => {
  it("forwards only documented aspect ratios", async () => {
    const { aspectRatioFor } = await import("./geminiImage");
    assert.equal(aspectRatioFor({ aspectRatio: "16:9" }), "16:9");
    assert.equal(aspectRatioFor({ aspectRatio: "1:1" }), "1:1");
    // 4:5 is a payload-schema value but not an image-API ratio.
    assert.equal(aspectRatioFor({ aspectRatio: "4:5" }), undefined);
    assert.equal(aspectRatioFor({}), undefined);
  });

  it("accepts both camelCase and snake_case image parts", async () => {
    const { parseGeminiImagePart } = await import("./geminiImage");
    assert.deepEqual(
      parseGeminiImagePart({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAA" } }] } }] }),
      { data: "AAA", mimeType: "image/png" },
    );
    assert.deepEqual(
      parseGeminiImagePart({ candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/jpeg", data: "BBB" } }] } }] }),
      { data: "BBB", mimeType: "image/jpeg" },
    );
    assert.equal(parseGeminiImagePart({ candidates: [{ content: { parts: [{ text: "no image" }] } }] }), null);
    assert.equal(parseGeminiImagePart({}), null);
  });

  it("reads real pixel dimensions out of the encoded bytes", async () => {
    const { imageDimensions } = await import("./geminiImage");
    assert.deepEqual(imageDimensions(pngBytes(64, 32), "image/png"), { width: 64, height: 32 });
    assert.deepEqual(imageDimensions(Buffer.from("not an image"), "image/png"), { width: null, height: null });
  });

  it("classifies upstream failures into the shared taxonomy", async () => {
    const { classifyGeminiImageError } = await import("./geminiImage");
    assert.equal(classifyGeminiImageError({ status: 500 }), "transient");
    assert.equal(classifyGeminiImageError({ status: 429 }), "transient");
    assert.equal(classifyGeminiImageError({ status: 400 }), "permanent");
    assert.equal(classifyGeminiImageError(new Error("socket hang up")), "transient");
  });
});

describe("gemini image provider — generate() against a local double", () => {
  it("declares image-only, synchronous capability", async () => {
    const { createGeminiImageProvider } = await import("./geminiImage");
    const provider = createGeminiImageProvider({ providerId: "gemini-image-test" });
    assert.deepEqual(provider.modalities, ["image"]);
    assert.equal(provider.synchronous, true);
    assert.ok(provider.capabilities.includes("generate_image"));
  });

  it("calls generateContent with both modalities and decodes the inline image", async () => {
    mode = "image";
    const { createGeminiImageProvider } = await import("./geminiImage");
    const provider = createGeminiImageProvider({ providerId: "gemini-image-test", baseUrl, models: ["gemini-3-pro-image"] });
    const output = await provider.generate({
      kind: "image",
      capability: "generate_image",
      snapshot: { intent: { subject: "a scheduler diagram", aspectRatio: "16:9" } },
      correlationId: "c1",
      model: "gemini-3-pro-image",
    });
    assert.equal(output.mime, "image/png");
    assert.ok(output.bytes.length > 0);
    assert.equal(output.width, 64);
    assert.equal(output.height, 64);
    assert.equal(output.model, "gemini-3-pro-image");
    assert.equal(output.provider, "gemini-image-test");
    assert.deepEqual(lastBody?.generationConfig?.responseModalities, ["TEXT", "IMAGE"]);
    assert.equal(lastBody?.generationConfig?.imageConfig?.aspectRatio, "16:9");
  });

  it("fails permanently when the model returns text but no image", async () => {
    mode = "textonly";
    const { createGeminiImageProvider } = await import("./geminiImage");
    const provider = createGeminiImageProvider({ providerId: "gemini-image-test", baseUrl });
    await assert.rejects(
      () =>
        provider.generate({
          kind: "image",
          capability: "generate_image",
          snapshot: { intent: { subject: "x" } },
          correlationId: "c2",
        }),
      /no image part/,
    );
    mode = "image";
  });

  it("classifies 429 transient and 400 permanent via JobFailure", async () => {
    const { createGeminiImageProvider } = await import("./geminiImage");
    const { JobFailure } = await import("../../jobs/failures");
    const provider = createGeminiImageProvider({ providerId: "gemini-image-test", baseUrl });
    mode = "error429";
    await assert.rejects(
      () => provider.generate({ kind: "image", capability: "generate_image", snapshot: {}, correlationId: "c3" }),
      (e: unknown) => e instanceof JobFailure && e.failureClass === "transient",
    );
    mode = "error400";
    await assert.rejects(
      () => provider.generate({ kind: "image", capability: "generate_image", snapshot: {}, correlationId: "c4" }),
      (e: unknown) => e instanceof JobFailure && e.failureClass === "permanent",
    );
    mode = "image";
  });

  it("refuses to call out when the paid-media gate is closed", async () => {
    const saved = process.env.CONTENTFORGE_ALLOW_PAID_MEDIA;
    delete process.env.CONTENTFORGE_ALLOW_PAID_MEDIA;
    try {
      const { createGeminiImageProvider } = await import("./geminiImage");
      const { JobFailure } = await import("../../jobs/failures");
      const provider = createGeminiImageProvider({ providerId: "gemini-image-test", baseUrl });
      await assert.rejects(
        () => provider.generate({ kind: "image", capability: "generate_image", snapshot: {}, correlationId: "c5" }),
        (e: unknown) => e instanceof JobFailure && e.failureClass === "permanent" && /paid generation is blocked/.test((e as Error).message),
      );
    } finally {
      process.env.CONTENTFORGE_ALLOW_PAID_MEDIA = saved;
    }
  });
});
