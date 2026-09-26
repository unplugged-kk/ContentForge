import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

/**
 * User context helpers for multi-user isolation (Phase C slice b).
 *
 * These give route handlers a typed way to:
 *   1. Demand an authenticated user (requireUserId)
 *   2. Scope any Drizzle query to the current user (forUser)
 *   3. Read the current userId off the request (getUserId)
 *
 * Slice (b) ONLY adds the helpers and the Request type augmentation.
 * Slice (c) wires requireUserId into per-route handlers and rewrites
 * storage methods to take userId. Routes are deliberately untouched
 * here so this commit stays reviewable.
 *
 * Pattern in a route (forward-looking):
 *
 *   app.get("/api/posts", async (req, res) => {
 *     const userId = requireUserId(req, res);
 *     if (!userId) return;
 *     const rows = await db.select().from(posts).where(forUser(posts, userId));
 *     res.json(rows);
 *   });
 */

declare global {
  namespace Express {
    // Augment Express's Request with the fields sessionUser populates.
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      userId?: number;
    }
  }
}

/**
 * Pulls req.session.userId onto req.userId so route handlers don't have to
 * navigate the session object. Mounted AFTER express-session in the
 * middleware stack (see server/index.ts).
 *
 * Does NOT enforce authentication — use requireUserId in routes that need
 * a logged-in user. This middleware just makes the session value easy to
 * reach in a typed way.
 */
export const sessionUser: RequestHandler = (req, _res, next) => {
  if (req.session?.userId) {
    req.userId = req.session.userId;
  }
  next();
};

/**
 * Returns the current userId or sends 401 and returns null. Use:
 *
 *   const userId = requireUserId(req, res);
 *   if (!userId) return; // 401 already sent
 *   ... use userId ...
 */
export function requireUserId(req: Request, res: Response): number | null {
  const userId = req.userId ?? req.session?.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
}

/**
 * Express-middleware form of the same guard. Sends 401 unless a server-side
 * session identity exists, otherwise passes through. This is the single
 * enforcement primitive mounted globally on /api by the Phase 30.1 authGate
 * (server/middleware/authGate.ts). Defined here (not in server/auth.ts) so
 * importing it never pulls in the database layer; server/auth.ts's legacy
 * copy was removed (it had zero call sites).
 */
export function requireAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export function getUserId(req: Request): number | undefined {
  return req.userId ?? req.session?.userId;
}

/**
 * Owner id for an authenticated request, failing closed by throwing.
 *
 * Replaces the `getUserId(req) ?? 1` pattern used across the content and
 * research routers. That pattern silently attributed an unauthenticated
 * request to owner 1, so anything that got past the auth gate — a routing
 * case difference was one — became anonymous read and write of owner 1's data.
 *
 * Distinct from `requireUserId(req, res)` above, which writes a 401 response
 * and returns null; this one is for call sites whose surrounding code already
 * assumes an authenticated owner and just needs the id.
 *
 * The auth gate guarantees a session before any handler runs, so this is
 * unreachable on a protected route. If it is ever reached, throwing is the
 * correct outcome: an error is recoverable, serving the wrong owner's data
 * is not.
 */
export function requireOwnerId(req: Request): number {
  const id = req.userId ?? req.session?.userId;
  if (!id) throw new Error("requireOwnerId requires an authenticated session");
  return id;
}

/**
 * Query fragment that scopes any per-user table to the given userId.
 * Use with Drizzle's `.where()`:
 *
 *   db.select().from(posts).where(forUser(posts, userId))
 *
 * The table parameter must declare `user_id` as a Drizzle column (i.e.
 * the schema has userId: integer("user_id")). The generic constraint
 * keeps callers honest at compile time.
 */
export function forUser<T extends { userId: PgColumn }>(
  table: T,
  userId: number,
) {
  return eq(table.userId, userId);
}
