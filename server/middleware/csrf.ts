import Tokens from "csrf";
import type { Request, RequestHandler, Response } from "express";

/**
 * CSRF protection via the synchronizer-token pattern (the `csrf` npm package).
 *
 * Flow:
 *   1. Client fetches GET /api/csrf-token once per session.
 *      Server ensures req.session.csrfSecret exists, stores it in the session,
 *      and returns tokens.create(secret).
 *   2. Client sends X-CSRF-Token header on every non-GET request.
 *   3. verifyCsrf compares the header against tokens.create(req.session.csrfSecret).
 *
 * Skipped for:
 *   - /api/auth/*   (login flows use a password, not cookie-borne credentials;
 *                    also we want users to log in without first hitting /api/csrf-token)
 *   - /api/webhooks/* (signed via HMAC instead, applied per-webhook)
 *   - GET / HEAD / OPTIONS (safe methods)
 */

const tokens = new Tokens();

declare module "express-session" {
  interface SessionData {
    csrfSecret?: string;
  }
}

export function ensureCsrfSession(req: Request): string {
  if (!req.session) {
    throw new Error("ensureCsrfSession requires an active session");
  }
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }
  return req.session.csrfSecret;
}

export function issueCsrfToken(req: Request, res: Response): void {
  const secret = ensureCsrfSession(req);
  const token = tokens.create(secret);
  res.json({ csrfToken: token });
}

function safeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isExempt(path: string): boolean {
  return (
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/webhooks/") ||
    path === "/api/csrf-token"
  );
}

export const verifyCsrf: RequestHandler = (req, res, next) => {
  if (safeMethod(req.method)) return next();
  if (isExempt(req.path)) return next();

  const secret = req.session?.csrfSecret;
  const token = req.header("x-csrf-token");
  if (!secret || !token || !tokens.verify(secret, token)) {
    return res.status(403).json({ message: "Invalid or missing CSRF token" });
  }
  next();
};
