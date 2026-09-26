import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/**
 * ---------------------------------------------------------------------------
 * Phase 33.7 — PostgreSQL pool error handling
 * ---------------------------------------------------------------------------
 *
 * Defect (observed live): this module registered no `'error'` listener on the
 * pool. `pg.Pool` is an EventEmitter and forwards an *idle* client's error
 * verbatim (`pg-pool/index.js` → `client.on('error', idleListener)`). With no
 * listener, Node's default behaviour for an `'error'` event applies: rethrow.
 * A backend that PostgreSQL terminates (`57P01 terminating connection due to
 * administrator command`) therefore produced
 * `Unhandled 'error' event on BoundPool` and killed the whole server process.
 *
 * The fix is one listener that distinguishes two classes of error:
 *
 *  • RECOVERABLE — a lost *established* connection. The pool has already
 *    dropped the dead client and will dial a fresh one on the next acquire, so
 *    the process must log and keep running.
 *
 *  • FATAL — a genuine configuration/authorization fault (wrong password,
 *    missing role, missing database, missing privilege). Retrying can never
 *    succeed, so it is surfaced loudly instead of being swallowed.
 *
 * How the two are distinguished (explicitly, two independent signals):
 *
 *  1. SOURCE. The `'error'` event only fires for clients that were *idle in an
 *     already-established pool* (`pg-pool`'s `idleListener`). It can therefore
 *     only describe a connection that was previously working and has since
 *     been lost — i.e. by construction a post-startup, recoverable event.
 *     Startup/configuration failures never travel this path: they surface as
 *     the rejection of the first awaited connection attempt (`index.ts` runs
 *     `await pool.query(...)` and `migrate(db, ...)` during bootstrap), which
 *     fails the boot loudly by itself.
 *  2. CODES. Within the listener we additionally classify the SQLSTATE/errno
 *     carried by the error (see `classifyPoolError`). Known non-transient
 *     configuration SQLSTATEs escalate as fatal; transient connection codes
 *     (SQLSTATE classes 08/53/57/58, socket errnos ECONNRESET/EPIPE/…) and
 *     anything unrecognised stay recoverable — an unnamed error must never be
 *     allowed to take down a running server.
 */

export type PoolErrorClass = "recoverable" | "fatal";

/**
 * SQLSTATE classes that describe a transient loss of an established
 * connection, or a server-side condition that a retry can clear:
 *   08 — connection_exception      53 — insufficient_resources
 *   57 — operator_intervention     58 — system_error
 */
const RECOVERABLE_SQLSTATE_CLASSES = ["08", "53", "57", "58"] as const;

/**
 * Non-transient configuration/authorization SQLSTATEs. These mean the
 * deployment is misconfigured, so they are never swallowed:
 *   28000 invalid_authorization_specification (role does not exist)
 *   28P01 invalid_password
 *   3D000 invalid_catalog_name (database does not exist)
 *   42501 insufficient_privilege
 */
const FATAL_CONFIG_SQLSTATE_CODES = new Set(["28000", "28P01", "3D000", "42501"]);

/**
 * Socket-level errnos that reach the idle-client path. All are a lost
 * connection the pool recovers from on the next acquire.
 */
const RECOVERABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EPROTO",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/** pg exposes the SQLSTATE as `code` and socket errnos as `code` too. */
function poolErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return null;
}

/**
 * Classify a pool error as recoverable (log and continue) or fatal
 * (configuration/authorization fault that must be surfaced).
 */
export function classifyPoolError(error: unknown): PoolErrorClass {
  const code = poolErrorCode(error);
  if (code === null) return "recoverable";

  // Non-transient configuration faults are the only fatal class.
  if (FATAL_CONFIG_SQLSTATE_CODES.has(code)) return "fatal";

  // Recognised transient connection loss.
  if ((RECOVERABLE_SQLSTATE_CLASSES as readonly string[]).includes(code.slice(0, 2))) {
    return "recoverable";
  }
  if (RECOVERABLE_NETWORK_CODES.has(code)) return "recoverable";

  // Reached the idle-client path without a code we recognise: still a lost
  // connection. Never let an unnamed error crash the process.
  return "recoverable";
}

export interface PoolErrorSummary {
  code: string | null;
  severity: string | null;
  message: string;
}

/**
 * Strip credentials from any text before it is logged. Handles connection URLs
 * (`postgresql://user:password@host`), `password=…` key/value pairs, and the
 * configured DSN itself if it appears verbatim.
 */
export function redactDbCredentials(text: string): string {
  let out = text;
  out = out.replace(/(postgres(?:ql)?:\/\/)([^@\s/]+)@/gi, "$1[redacted]@");
  out = out.replace(/\b(password|passwd|pwd)\s*=\s*([^\s&;]+)/gi, "$1=[redacted]");
  const dsn = process.env.DATABASE_URL;
  if (dsn && out.includes(dsn)) out = out.split(dsn).join("[redacted]");
  return out;
}

/** Build a credential-free summary of a pool error for logging. */
export function describePoolError(error: unknown): PoolErrorSummary {
  const code = poolErrorCode(error);
  const severity =
    error && typeof error === "object" && typeof (error as { severity?: unknown }).severity === "string"
      ? ((error as { severity: string }).severity)
      : null;
  const raw = error instanceof Error ? error.message : String(error);
  return { code, severity, message: redactDbCredentials(raw) };
}

function formatPoolError(summary: PoolErrorSummary): string {
  const parts = [summary.code ? `code=${summary.code}` : null, summary.severity ? `severity=${summary.severity}` : null]
    .filter(Boolean)
    .join(" ");
  return `${parts ? parts + " " : ""}${summary.message}`;
}

pool.on("error", (error: unknown) => {
  const summary = describePoolError(error);
  const detail = formatPoolError(summary);

  if (classifyPoolError(error) === "fatal") {
    // Configuration/authorization fault: fail loudly rather than pretend the
    // deployment is healthy. Re-throw a *sanitized* error asynchronously so it
    // surfaces as an uncaught exception (crash + stack) without leaking
    // credentials that the raw driver error may carry.
    console.error(`[db] fatal pool error (configuration/authorization): ${detail}`);
    const escalated = new Error(`fatal database pool error: ${detail}`);
    if (summary.code) (escalated as Error & { code?: string }).code = summary.code;
    setImmediate(() => {
      throw escalated;
    });
    return;
  }

  // Recoverable: an idle client's backend went away. pg has already removed it
  // and the pool will reconnect on the next acquire — log and keep serving.
  console.error(`[db] recoverable pool error (connection lost, pool will reconnect): ${detail}`);
});
