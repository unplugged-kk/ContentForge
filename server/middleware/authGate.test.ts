/**
 * Phase 30.1 §13 — authentication-gate regression tests (B1 remediation).
 *
 * Proves at the real HTTP boundary (ephemeral express app + fetch):
 *  1. unauthenticated request to a protected path → 401, handler never runs
 *     (no read, no mutation, no external side effect possible).
 *  2. allowlisted paths (auth flows, csrf-token, health/ready) pass without
 *     a session.
 *  3. a request WITH a server-side session passes (identity comes from the
 *     session, established server-side — the gate never reads client
 *     identity).
 *  4. forged client identity (X-Owner-Id header, body/query ownerId) does NOT
 *     authenticate: still 401 without a session.
 *  5. the gate is mounted before route registration in server/index.ts and
 *     the public allowlist contains exactly the intended entries (static
 *     pin: no silent widening of the unauthenticated surface).
 */
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import {
  authGate,
  isPublicApiPath,
  PUBLIC_API_EXACT,
  PUBLIC_API_PREFIXES,
} from "./authGate";

describe("authGate (HTTP boundary)", () => {
  let baseUrl = "";
  let server: ReturnType<typeof express.application.listen> | undefined;
  let handlerRan = 0;

  before(async () => {
    const app = express();
    app.use(express.json());
    // Stub session middleware: only requests bearing the test session cookie
    // get a server-side session, exactly like express-session. Client headers
    // and bodies are never consulted.
    app.use((req, _res, next) => {
      const cookie = String(req.headers.cookie ?? "");
      (req as unknown as { session?: { userId?: number } }).session =
        cookie.includes("testsess=valid") ? { userId: 7 } : undefined;
      next();
    });
    app.use(authGate);
    app.get("/api/protected", (_req, res) => {
      handlerRan += 1;
      res.json({ ok: true });
    });
    app.post("/api/protected", (_req, res) => {
      handlerRan += 1;
      res.json({ ok: true });
    });
    app.get("/api/auth/login", (_req, res) => res.json({ public: true }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server!.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("rejects unauthenticated GET and POST with 401 before the handler runs", async () => {
    handlerRan = 0;
    const get = await fetch(`${baseUrl}/api/protected`);
    assert.equal(get.status, 401);
    assert.deepEqual(await get.json(), { message: "Unauthorized" });
    const post = await fetch(`${baseUrl}/api/protected`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: 1 }),
    });
    assert.equal(post.status, 401);
    assert.equal(handlerRan, 0);
  });

  it("ignores forged client identity (headers, body, query)", async () => {
    const res = await fetch(`${baseUrl}/api/protected?ownerId=1&userId=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Owner-Id": "1",
        "X-User-Id": "1",
      },
      body: JSON.stringify({ ownerId: 1, userId: 1 }),
    });
    assert.equal(res.status, 401);
    assert.equal(handlerRan, 0);
  });

  it("allows allowlisted paths without a session", async () => {
    for (const path of ["/api/auth/login", "/api/auth/register", "/api/csrf-token", "/api/health", "/api/ready"]) {
      assert.ok(isPublicApiPath(path), `${path} must be public`);
    }
    const res = await fetch(`${baseUrl}/api/auth/login`);
    assert.equal(res.status, 200);
  });

  it("passes requests carrying a server-side session", async () => {
    const res = await fetch(`${baseUrl}/api/protected`, {
      headers: { Cookie: "testsess=valid" },
    });
    assert.equal(res.status, 200);
    assert.equal(handlerRan, 1);
  });
});

describe("authGate wiring (static pins)", () => {
  const INDEX_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

  it("the public allowlist is exactly the intended surface", () => {
    assert.deepEqual([...PUBLIC_API_PREFIXES], ["/api/auth/"]);
    assert.deepEqual([...PUBLIC_API_EXACT], ["/api/csrf-token", "/api/health", "/api/ready"]);
  });

  it("isPublicApiPath classifies correctly", () => {
    assert.equal(isPublicApiPath("/api/auth/login"), true);
    assert.equal(isPublicApiPath("/api/auth/config"), true);
    assert.equal(isPublicApiPath("/api/csrf-token"), true);
    assert.equal(isPublicApiPath("/api/health"), true);
    assert.equal(isPublicApiPath("/api/ready"), true);
    assert.equal(isPublicApiPath("/api/posts"), false);
    assert.equal(isPublicApiPath("/api/posts/1/publish"), false);
    assert.equal(isPublicApiPath("/api/autonomy/run"), false);
    assert.equal(isPublicApiPath("/api/accounts"), false);
    assert.equal(isPublicApiPath("/api/images/generate"), false);
    assert.equal(isPublicApiPath("/api"), false);
  });

  it("the gate is mounted before any route registration", () => {
    const text = readFileSync(INDEX_PATH, "utf8");
    const gatePos = text.indexOf("app.use(authGate)");
    assert.ok(gatePos !== -1, "authGate must be mounted globally in server/index.ts");
    for (const marker of ["registerRoutes(httpServer, app)", '"/api/research"', '"/api/agent"', '"/api/autonomy"']) {
      const pos = text.indexOf(marker);
      assert.ok(pos !== -1 && gatePos < pos, `authGate must precede ${marker}`);
    }
  });

  it("no owner-1 fallback remains in the central identity helpers", () => {
    const routesText = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "routes.ts"),
      "utf8",
    );
    assert.ok(!/\?\? 1\b/.test(routesText), "server/routes.ts must not default to owner 1");
    assert.ok(!/\|\| 1\b/.test(routesText), "server/routes.ts must not default to owner 1");
    const agentText = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "agent", "routes.ts"),
      "utf8",
    );
    assert.ok(!/getUserId\(req as never\) \?\? 1/.test(agentText), "agent ownerId() must not default to owner 1");
  });
});
