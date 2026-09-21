import type { Request, RequestHandler, Response } from "express";
import { db } from "../db";
import { auditLogs } from "@shared/schema";
import { createHash } from "crypto";

/**
 * Audit log middleware. Records every non-safe HTTP request after the response
 * finishes, capturing who, what, when, and a body hash (NOT the body itself,
 * so we don't leak tokens/passwords into the audit table).
 *
 * Insert is fire-and-forget — we don't want audit failures to break requests.
 * In high-volume production this should be batched/queued; for now a single
 * async insert is fine.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Paths we never audit (high-frequency, low-signal)
const SKIP_PREFIXES = [
  "/uploads",
  "/api/health",
  "/favicon.ico",
  "/api/csrf-token",
];

function methodAction(method: string): string {
  switch (method) {
    case "POST": return "create";
    case "PUT":
    case "PATCH": return "update";
    case "DELETE": return "delete";
    default: return method.toLowerCase();
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function shouldSkip(path: string): boolean {
  return SKIP_PREFIXES.some((p) => path.startsWith(p));
}

export const auditLog: RequestHandler = (req: Request, res: Response, next) => {
  if (SAFE_METHODS.has(req.method) || shouldSkip(req.path)) return next();

  const start = Date.now();
  const userId = req.session?.userId ?? null;
  const ip = (req.ip || req.socket.remoteAddress || "").toString().slice(0, 64);
  const userAgent = (req.header("user-agent") || "").slice(0, 1024);
  const bodyHash = req.rawBody ? sha256(String(req.rawBody)).slice(0, 64) : null;

  res.on("finish", () => {
    if (res.statusCode >= 500) {
      // Don't pollute audit log with noise from error paths; the structured
      // error log already captures these.
      return;
    }
    db.insert(auditLogs)
      .values({
        userId,
        method: req.method,
        path: req.path.slice(0, 512),
        action: methodAction(req.method),
        resourceType: null,
        resourceId: null,
        ip,
        userAgent,
        bodyHash,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      })
      .catch((err) => {
        // Best-effort: never let audit failures break a request.
        console.error("[audit] failed to write audit log:", err.message);
      });
  });

  next();
};
