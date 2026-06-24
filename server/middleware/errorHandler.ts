import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";

/**
 * Standardized error handler. Logs full error server-side, returns a
 * sanitized message to the client. No stack traces, no SQL details, no
 * filesystem paths.
 *
 * Recognised "safe" errors (operational, expected) get their .message echoed
 * back. Unknown errors (5xx) get a generic message; the real cause lives in
 * the server logs only.
 */

const SAFE_STATUS_CODES = new Set([400, 401, 403, 404, 409, 410, 413, 415, 422, 429]);

interface AppError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  // Some middleware (express-rate-limit, multer) attach details we don't
  // want to leak; we explicitly do NOT echo err.details / err.stack.
}

export const errorHandler: ErrorRequestHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) => {
  const status = err.status || err.statusCode || 500;
  const safe = SAFE_STATUS_CODES.has(status);

  // Always log full server-side.
  console.error("[error]", {
    status,
    code: err.code,
    message: err.message,
    // stack only on unexpected (5xx) to avoid log spam from expected 4xx
    ...(status >= 500 ? { stack: err.stack } : {}),
  });

  if (res.headersSent) {
    // Can't send a clean response; delegate to default handler which closes.
    res.end();
    return;
  }

  if (safe) {
    res.status(status).json({ message: err.message || "Request failed" });
    return;
  }

  // 5xx and anything we don't recognise: never leak details.
  res.status(500).json({ message: "Internal server error" });
};
