import type { RequestHandler } from "express";
import { requireAuthMiddleware } from "./userContext";

/**
 * Phase 30.1 — global API authentication gate (B1 remediation).
 *
 * The application is authenticated-only: every /api path requires a
 * server-side session identity EXCEPT an explicit public allowlist. Owner
 * identity always comes from `req.session.userId` (see server/auth.ts);
 * client-supplied owner IDs are never consulted here or anywhere else.
 *
 * Mounted in server/index.ts AFTER express-session (the gate reads the
 * session) and BEFORE all route registration, so no route can be reached
 * without passing through it. Order inside the gate follows the security
 * ordering: authentication first, everything else later.
 */

export const PUBLIC_API_PREFIXES: readonly string[] = ["/api/auth/"];

export const PUBLIC_API_EXACT: readonly string[] = [
  "/api/csrf-token",
  "/api/health",
  "/api/ready",
];

export function isPublicApiPath(path: string): boolean {
  if ((PUBLIC_API_EXACT as readonly string[]).includes(path)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export const authGate: RequestHandler = (req, res, next) => {
  // NOTE: mounted globally (app.use(authGate)), so req.path is the full
  // path. Do NOT mount on a sub-path: Express strips the mount point from
  // req.path inside the middleware, which would break allowlist matching.
  if (!req.path.startsWith("/api")) return next();
  if (isPublicApiPath(req.path)) return next();
  requireAuthMiddleware(req, res, next);
};
