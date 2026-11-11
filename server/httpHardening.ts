/**
 * Production HTTP hardening (Phase 30 launch gate).
 *
 * Small, cohesive helpers for production-only safety behavior:
 *
 * - `resolveSessionSecret` — fail closed when SESSION_SECRET is missing in
 *   production instead of booting with a publicly-known dev default.
 * - `redactForAccessLog` — strip credential-shaped keys from API response
 *   bodies before they reach stdout (mirrors server/jobs/logger.ts `redact`).
 * - `livenessPayload` / `readinessPayload` — minimal health shapes with no
 *   secrets or internal detail (readiness reports up/down only; the driver
 *   error is logged server-side by the caller).
 * - `handleLogout` — destroy the server session AND clear the session cookie
 *   so a logged-out cookie cannot be replayed.
 * - `establishSession` — issue a fresh session id on every login so an id
 *   planted before authentication never becomes an authenticated one.
 */

export function resolveSessionSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set in production (refusing to boot with the dev default)",
    );
  }
  return "contentforge-dev-secret";
}

const REDACTED = "[redacted]";

/** Key-name fragments that must never appear in logs, matched case-insensitively. */
const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|cookie|authorization|auth|api[_-]?key|access[_-]?key|session|credential|private[_-]?key)/i;

export function redactForAccessLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactForAccessLog(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactForAccessLog(val, depth + 1);
  }
  return out;
}

export interface LivenessPayload {
  status: "ok";
  uptimeSec: number;
}

/** Liveness: the process is alive. No dependency checks, no secrets. */
export function livenessPayload(): LivenessPayload {
  return { status: "ok", uptimeSec: Math.floor(process.uptime()) };
}

export type ReadinessProbe = () => Promise<void>;

export interface ReadinessPayload {
  status: "ready" | "not_ready";
  checks: { database: "up" | "down" };
}

/**
 * Readiness: can this instance serve traffic? The probe (typically
 * `SELECT 1` against the pool) runs first; only up/down is exposed.
 * Callers must log the underlying error server-side.
 */
export async function readinessPayload(probe: ReadinessProbe): Promise<ReadinessPayload> {
  try {
    await probe();
    return { status: "ready", checks: { database: "up" } };
  } catch {
    return { status: "not_ready", checks: { database: "down" } };
  }
}

export type SessionAuthMethod = "password" | "google" | "auth0";

export interface LogoutRequest {
  session?: { authMethod?: SessionAuthMethod; destroy: (cb: (err?: unknown) => void) => void };
}

export interface LogoutResponse {
  clearCookie: (name: string, options?: Record<string, unknown>) => void;
  json: (body: unknown) => void;
}

/**
 * Log out: clear the client cookie immediately, then destroy the server-side
 * session. The response is always success — a missing session (or a session
 * store outage) must not leave a usable cookie behind. `idpLogout` tells the
 * client the session came from Auth0, whose own SSO session it must end too.
 */
export function handleLogout(
  req: LogoutRequest,
  res: LogoutResponse,
  opts: { secureCookie?: boolean } = {},
): void {
  res.clearCookie("connect.sid", {
    httpOnly: true,
    sameSite: "lax",
    ...(opts.secureCookie ? { secure: true } : {}),
  });
  if (!req.session) {
    res.json({ success: true, idpLogout: false });
    return;
  }
  const idpLogout = req.session.authMethod === "auth0";
  req.session.destroy(() => {
    res.json({ success: true, idpLogout });
  });
}

export interface RegenerableSession {
  regenerate: (cb: (err?: unknown) => void) => void;
  save: (cb: (err?: unknown) => void) => void;
  userId?: number;
  authMethod?: SessionAuthMethod;
}

/**
 * Replace the session with a new id, then bind the user to it. Anything held
 * by the pre-login session (CSRF secret, OAuth state) is dropped with it.
 */
export function establishSession(
  req: { session: RegenerableSession },
  userId: number,
  authMethod: SessionAuthMethod,
): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) return reject(regenerateErr);
      req.session.userId = userId;
      req.session.authMethod = authMethod;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}
