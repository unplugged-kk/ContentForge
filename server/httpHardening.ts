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

export interface LogoutRequest {
  session?: { destroy: (cb: (err?: unknown) => void) => void };
}

export interface LogoutResponse {
  clearCookie: (name: string, options?: Record<string, unknown>) => void;
  json: (body: unknown) => void;
}

/**
 * Log out: clear the client cookie immediately, then destroy the server-side
 * session. The response is always success — a missing session (or a session
 * store outage) must not leave a usable cookie behind.
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
    res.json({ success: true });
    return;
  }
  req.session.destroy(() => {
    res.json({ success: true });
  });
}
