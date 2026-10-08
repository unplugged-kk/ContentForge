import type { Request, RequestHandler } from "express";
import { requireAuthMiddleware } from "./userContext";

/**
 * Phase 30.1 — global API authentication gate (B1 remediation).
 *
 * The application is authenticated-only: every /api path requires an
 * identity EXCEPT an explicit public allowlist. Identity is either the
 * server-side session or a validated Auth0 access token resolved to users.id.
 * Either way the gate writes `req.userId`; client-supplied owner IDs are
 * never consulted here or anywhere else.
 *
 * Mounted in server/index.ts AFTER express-session (the gate reads the
 * session) and BEFORE all route registration, so no route can be reached
 * without passing through it. Order inside the gate follows the security
 * ordering: authentication first, everything else later.
 */

export const PUBLIC_API_PREFIXES: readonly string[] = [
  /**
   * Provider media fetch (finding F2).
   *
   * External providers (Meta, and any future fetcher) cannot present a session
   * cookie, so this path is authenticated by its OWN credential instead: the
   * 48-hex, short-TTL grant token minted by `issueProviderFetchUrl` and carried
   * in the URL. Opening the prefix is safe because exactly ONE route lives
   * under it — `GET /api/provider-media/:token` (server/content/routes.ts) —
   * and nothing here mints, lists or extends a grant; a bad, expired or unknown
   * token yields 404, never data and never a 401 (which would only tell a
   * prober that the path exists).
   */
  "/api/provider-media/",
];

/**
 * The pre-login endpoints, named one by one. A whole `/api/auth/` prefix used
 * to be public, which left GET/PUT /api/auth/me outside the gate and outside
 * CSRF; /api/auth/me is now an ordinary protected route.
 */
export const PUBLIC_AUTH_PATHS: readonly string[] = [
  "/api/auth/config",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/auth/auth0/session",
];

export const PUBLIC_API_EXACT: readonly string[] = [
  ...PUBLIC_AUTH_PATHS,
  "/api/csrf-token",
  "/api/health",
  "/api/ready",
];

export function isPublicApiPath(path: string): boolean {
  if ((PUBLIC_API_EXACT as readonly string[]).includes(path)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export type BearerAuthentication =
  | { ok: true; userId: number }
  | { ok: false; status: 401 | 403; message: string };

export type BearerAuthenticator = (accessToken: string) => Promise<BearerAuthentication>;

const UNAUTHORIZED = { message: "Unauthorized" };

/**
 * A request carrying `Authorization` is judged on that header alone: a valid
 * Auth0 access token authenticates it, anything else is 401. It never falls
 * back to the session cookie, so one request can never mix two identities.
 */
async function authenticateBearer(
  req: Request,
  loadAuthenticator: () => Promise<BearerAuthenticator | null>,
): Promise<BearerAuthentication> {
  const token = bearerToken(req.headers.authorization);
  const authenticate = token ? await loadAuthenticator() : null;
  if (!token || !authenticate) return { ok: false, status: 401, message: UNAUTHORIZED.message };
  return authenticate(token);
}

/** The token from `Authorization: Bearer <token>`, or null for anything else. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(header?.trim() ?? "");
  return match ? match[1] : null;
}

export function createAuthGate(
  loadAuthenticator: () => Promise<BearerAuthenticator | null>,
): RequestHandler {
  return (req, res, next) => {
    // NOTE: mounted globally (app.use(authGate)), so req.path is the full
    // path. Do NOT mount on a sub-path: Express strips the mount point from
    // req.path inside the middleware, which would break allowlist matching.
    //
    // Case folding is required, not cosmetic. Express routing is
    // case-insensitive by default, so `/API/research/jobs` reaches the same
    // handler as `/api/research/jobs` — but a case-sensitive comparison here
    // did not match, and the gate stepped aside. That made every protected
    // route reachable unauthenticated with a single capital letter, which in
    // turn reached the `getUserId(req) ?? 1` fallbacks and served (and wrote)
    // owner 1's data. The comparison must match the router's behaviour.
    const path = req.path.toLowerCase();
    if (!path.startsWith("/api")) return next();
    if (isPublicApiPath(path)) return next();
    if (req.headers.authorization === undefined) return requireAuthMiddleware(req, res, next);

    authenticateBearer(req, loadAuthenticator).then((result) => {
      if (!result.ok) {
        res.status(result.status).json({ message: result.message });
        return;
      }
      req.userId = result.userId;
      req.authMethod = "bearer";
      next();
    }, next);
  };
}

// Loaded on the first bearer request so importing the gate never pulls in
// the database layer (the Auth0 resolver needs it).
export const authGate = createAuthGate(async () => {
  const { auth0FromEnv } = await import("../auth0");
  return auth0FromEnv()?.authenticate ?? null;
});
