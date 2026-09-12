import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  PayloadSchemaNotRegisteredError,
  PayloadSchemaRegistry,
  PayloadValidationError,
  payloadSchemaRegistry,
} from "./payloadSchemas";

describe("payload schema registry", () => {
  it("registers the X formats and the Phase 3 visual formats", () => {
    assert.deepEqual(payloadSchemaRegistry.formats(), [
      "carousel",
      "image",
      "thumbnail",
      "x_post",
      "x_thread",
    ]);
    assert.deepEqual(payloadSchemaRegistry.versions("x_post"), [1]);
    assert.deepEqual(payloadSchemaRegistry.versions("image"), [1]);
  });

  it("validates a good x_post payload", () => {
    const parsed = payloadSchemaRegistry.validate<{ text: string }>("x_post", {
      text: "hello",
    });
    assert.equal(parsed.text, "hello");
  });

  it("validates a good x_thread payload with multiple units", () => {
    const parsed = payloadSchemaRegistry.validate<{ units: string[] }>("x_thread", {
      units: ["one", "two", "three"],
    });
    assert.equal(parsed.units.length, 3);
  });

  it("rejects an invalid payload with all issues listed", () => {
    assert.throws(
      () => payloadSchemaRegistry.validate("x_post", { text: "" }),
      (error: unknown) => {
        assert.ok(error instanceof PayloadValidationError);
        assert.equal(error.format, "x_post");
        assert.ok(error.issues.length >= 1);
        return true;
      },
    );
  });

  it("rejects an empty thread", () => {
    assert.throws(
      () => payloadSchemaRegistry.validate("x_thread", { units: [] }),
      PayloadValidationError,
    );
  });

  it("rejects a payload with the wrong shape for its format", () => {
    assert.throws(
      () => payloadSchemaRegistry.validate("x_thread", { text: "not a thread" }),
      PayloadValidationError,
    );
  });

  it("throws a typed error for an unregistered format", () => {
    assert.throws(
      () => payloadSchemaRegistry.validate("linkedin_post", {}),
      PayloadSchemaNotRegisteredError,
    );
    assert.equal(payloadSchemaRegistry.has("linkedin_post"), false);
  });

  it("validates a good image payload referencing a visual asset", () => {
    const parsed = payloadSchemaRegistry.validate<{ visualAssetId: number }>("image", {
      visualAssetId: 7,
    });
    assert.equal(parsed.visualAssetId, 7);
  });

  it("validates an ordered carousel payload and rejects an empty one", () => {
    const parsed = payloadSchemaRegistry.validate<{ slides: unknown[] }>("carousel", {
      slides: [{ visualAssetId: 1 }, { visualAssetId: 2 }],
    });
    assert.equal(parsed.slides.length, 2);
    assert.throws(
      () => payloadSchemaRegistry.validate("carousel", { slides: [] }),
      PayloadValidationError,
    );
  });

  it("exposes advisory limits without enforcing them", () => {
    const entry = payloadSchemaRegistry.get("x_post");
    assert.equal(entry.limits?.maxCharacters, 280);
    // The registry is deliberately permissive here: authoritative character
    // counting belongs to the channel adapter, not the payload schema.
    assert.doesNotThrow(() =>
      payloadSchemaRegistry.validate("x_post", { text: "x".repeat(500) }),
    );
  });

  it("allows a new format to be added without touching the domain", () => {
    const registry = new PayloadSchemaRegistry();
    registry.register({
      format: "linkedin_post",
      version: 1,
      schema: z.object({ text: z.string().min(1), hashtags: z.array(z.string()).default([]) }),
    });

    const parsed = registry.validate<{ text: string; hashtags: string[] }>("linkedin_post", {
      text: "hello",
    });
    assert.deepEqual(parsed.hashtags, []);
    assert.deepEqual(registry.formats(), ["linkedin_post"]);
  });

  it("resolves the highest version by default and exact versions on request", () => {
    const registry = new PayloadSchemaRegistry();
    registry.register({ format: "f", version: 1, schema: z.object({ a: z.string() }) });
    registry.register({
      format: "f",
      version: 2,
      schema: z.object({ a: z.string(), b: z.number() }),
    });

    assert.equal(registry.get("f").version, 2);
    assert.equal(registry.get("f", 1).version, 1);
    assert.deepEqual(registry.versions("f"), [1, 2]);
    assert.throws(() => registry.get("f", 99), PayloadSchemaNotRegisteredError);
  });

  it("refuses a duplicate format+version registration", () => {
    const registry = new PayloadSchemaRegistry();
    registry.register({ format: "f", version: 1, schema: z.object({}) });
    assert.throws(
      () => registry.register({ format: "f", version: 1, schema: z.object({}) }),
      /already registered/,
    );
  });
});
