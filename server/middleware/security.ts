import helmet from "helmet";
import type { RequestHandler } from "express";

const isProd = process.env.NODE_ENV === "production";

/**
 * Helmet configuration tuned for ContentForge:
 * - HSTS only in production (cert required; local dev uses plain http://).
 * - CSP allows Vite's HMR client (ws: + inline eval) in development; tightens
 *   to self-only in production.
 * - frameguard DENY keeps the app out of hostile iframes.
 * - referrerPolicy strict-origin-when-cross-origin avoids leaking the session
 *   cookie via Referer.
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      // Vite dev injects an inline <script type=module>; same for the React
      // Refresh runtime. Production builds inline-hash only what they need.
      scriptSrc: isProd
        ? ["'self'"]
        : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "https:", "blob:"],
      connectSrc: isProd
        ? ["'self'", "https:"]
        : ["'self'", "ws:", "wss:", "http:", "https:"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // would block CDN-hosted media embeds
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-site" },
  frameguard: { action: "deny" },
  hidePoweredBy: true,
  hsts: isProd
    ? { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true, preload: true }
    : false,
  noSniff: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true,
});
