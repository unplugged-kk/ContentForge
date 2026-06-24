import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

/**
 * Rate limiting for ContentForge.
 *
 * Three tiers:
 * - globalLimiter: 100 req/min per IP across /api. Skips static + the CSRF
 *   token endpoint so first-page-load doesn't burn the budget.
 * - authLimiter:   10 req/min per IP for /api/auth/* (login, register, OAuth).
 *                  Brute-force protection.
 * - publishLimiter: 30 req/min per IP for /api/social/* write endpoints.
 *                   xQuick writes are paid; cap them.
 *
 * Trust proxy is set on the app (trust proxy: 1) so req.ip resolves to the
 * X-Forwarded-For client when running behind Railway / Vercel / etc.
 */

export const globalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => {
    const p = req.path;
    // Only rate-limit /api routes. Vite HMR, static assets, and uploads bypass.
    if (!p.startsWith("/api")) return true;
    return (
      p === "/api/csrf-token" ||
      p === "/api/health" ||
      p === "/favicon.ico"
    );
  },
  message: { message: "Too many requests, please slow down." },
});

export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many auth attempts. Try again in a minute." },
});

export const publishLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Publish rate limit exceeded." },
});
