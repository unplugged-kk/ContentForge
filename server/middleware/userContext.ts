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
 * Non-throwing accessor. Returns undefined if no user is signed in.
 * Useful for routes that handle both anon and authenticated flows.
 */
export function getUserId(req: Request): number | undefined {
  return req.userId ?? req.session?.userId;
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
