/**
 * Regression tests for Phase 30 production HTTP hardening.
 *
 * Root causes covered:
 * - prod booted with a publicly-known default SESSION_SECRET (fail-open);
 * - the /api access log serialized full response bodies, including tokens;
 * - no liveness/readiness endpoint existed (deploy healthcheck probed a
 *   static config JSON that returns 200 with the DB down);
 * - logout destroyed the server session but left the cookie set.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleLogout,
  livenessPayload,
  readinessPayload,
  redactForAccessLog,
  resolveSessionSecret,
} from "./httpHardening";

describe("resolveSessionSecret", () => {
  it("uses the configured secret when present", () => {
    assert.equal(
      resolveSessionSecret({ SESSION_SECRET: "s3cret", NODE_ENV: "production" }),
      "s3cret",
    );
  });

  it("throws in production when SESSION_SECRET is missing", () => {
    assert.throws(
      () => resolveSessionSecret({ NODE_ENV: "production" }),
      /SESSION_SECRET must be set in production/,
    );
    assert.throws(
      () => resolveSessionSecret({ SESSION_SECRET: "", NODE_ENV: "production" }),
      /SESSION_SECRET must be set in production/,
    );
  });

  it("falls back to the dev default outside production", () => {
    assert.equal(resolveSessionSecret({ NODE_ENV: "development" }), "contentforge-dev-secret");
    assert.equal(resolveSessionSecret({}), "contentforge-dev-secret");
  });
});

describe("redactForAccessLog", () => {
  it("redacts credential-shaped keys at any depth", () => {
    const out = redactForAccessLog({
      id: 1,
      email: "a@b.c",
      accessToken: "live-token",
      nested: { refresh_token: "r", items: [{ apiKey: "k", label: "x" }] },
    }) as Record<string, unknown>;
    assert.equal(out.id, 1);
    assert.equal(out.email, "a@b.c");
    assert.equal(out.accessToken, "[redacted]");
    assert.equal((out.nested as Record<string, unknown>).refresh_token, "[redacted]");
    const items = (out.nested as Record<string, { apiKey: string; label: string }>).items;
    assert.equal(items[0].apiKey, "[redacted]");
    assert.equal(items[0].label, "x");
  });

  it("leaves primitives and non-sensitive shapes untouched", () => {
    assert.equal(redactForAccessLog("abc"), "abc");
    assert.equal(redactForAccessLog(null), null);
    assert.deepEqual(redactForAccessLog([1, "x"]), [1, "x"]);
  });
});

describe("liveness / readiness", () => {
  it("liveness exposes status only (no secrets, no internals)", () => {
    const payload = livenessPayload();
    assert.equal(payload.status, "ok");
    assert.deepEqual(Object.keys(payload).sort(), ["status", "uptimeSec"]);
  });

  it("readiness reports ready when the probe succeeds", async () => {
    assert.deepEqual(await readinessPayload(async () => {}), {
      status: "ready",
      checks: { database: "up" },
    });
  });

  it("readiness reports not_ready without leaking the driver error", async () => {
    const payload = await readinessPayload(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432 (internal-host)");
    });
    assert.deepEqual(payload, { status: "not_ready", checks: { database: "down" } });
    assert.ok(!JSON.stringify(payload).includes("10.0.0.5"));
  });
});

describe("handleLogout", () => {
  it("clears the cookie and destroys the session", () => {
    let cleared = "";
    let body: unknown;
    let destroyed = false;
    handleLogout(
      { session: { destroy: (cb) => { destroyed = true; cb(); } } },
      {
        clearCookie: (name) => { cleared = name; },
        json: (b) => { body = b; },
      },
    );
    assert.equal(cleared, "connect.sid");
    assert.equal(destroyed, true);
    assert.deepEqual(body, { success: true });
  });

  it("still clears the cookie when there is no session", () => {
    let cleared = "";
    let body: unknown;
    handleLogout(
      {},
      {
        clearCookie: (name) => { cleared = name; },
        json: (b) => { body = b; },
      },
    );
    assert.equal(cleared, "connect.sid");
    assert.deepEqual(body, { success: true });
  });

  it("still responds success when session destroy fails", () => {
    let body: unknown;
    handleLogout(
      { session: { destroy: (cb) => { cb(new Error("store down")); } } },
      {
        clearCookie: () => {},
        json: (b) => { body = b; },
      },
    );
    assert.deepEqual(body, { success: true });
  });
});
