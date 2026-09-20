/**
 * Unit tests for the human-gated policy activation service (Phase 29.3).
 * Pure-function coverage only; transactional/DB behavior is covered by
 * policyActivation.dbtest.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { policyKeyForScope, PolicyActivationError } from "./activation";

describe("policyKeyForScope (Phase 29.3)", () => {
  it("derives the exact pol:<format>:<channel> scheme resolveGenerationPolicy already uses", () => {
    assert.equal(policyKeyForScope("channel:linkedin;format:carousel"), "pol:carousel:linkedin");
    assert.equal(policyKeyForScope("format:x_post;channel:x"), "pol:x_post:x");
  });

  it("throws a machine-readable error when scope is missing channel or format", () => {
    assert.throws(() => policyKeyForScope("channel:linkedin"), (err) => {
      assert.ok(err instanceof PolicyActivationError);
      assert.equal((err as PolicyActivationError).code, "INVALID_SCOPE");
      return true;
    });
    assert.throws(() => policyKeyForScope("format:carousel"), (err) => {
      assert.ok(err instanceof PolicyActivationError);
      assert.equal((err as PolicyActivationError).code, "INVALID_SCOPE");
      return true;
    });
    assert.throws(() => policyKeyForScope("nonsense"), PolicyActivationError);
  });

  it("is deterministic and order-independent within the scope string", () => {
    const a = policyKeyForScope("channel:x;format:x_post");
    const b = policyKeyForScope("format:x_post;channel:x");
    assert.equal(a, b);
  });
});
