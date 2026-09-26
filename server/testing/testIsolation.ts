/**
 * Phase 33.7 — shared test-isolation helpers.
 *
 * The DB suites share one PostgreSQL database (`TEST_DATABASE_URL`). Each suite
 * seeds and cleans its own rows, but that cleanup lives in the suite's best-effort
 * `after()` hook: it is skipped whenever a run is interrupted (crash, timeout,
 * SIGINT) or a suite aborts before its hook runs. A `connected_accounts` row left
 * behind by an earlier run was encrypted with *that* run's `ENCRYPTION_KEY`; the
 * next run (under a different key) then fails inside `storage.ts#safeDecrypt`
 * with "Failed to decrypt stored accessToken" the moment an account is resolved
 * (`server/social/threads.ts#getThreadsConfig`). That is a deterministic failure,
 * not a flake: the same tree scores lower on a reused database than a fresh one.
 *
 * These helpers make the secret store deterministic per run:
 *   • `pinTestEncryptionKey()` — one stable key for every suite process in a run.
 *   • `purgeStaleConnectedAccounts()` — deterministic, owner/platform-scoped
 *     cleanup of test-created rows, usable between suites or as a run preflight.
 *
 * Safety: the purge refuses to touch a database that is neither local nor named
 * like a test database, so it can never delete real credentials.
 */
import pg from "pg";

/** Canonical run key: base64 of 32 zero bytes. Stable across every suite in a run. */
export const TEST_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/** Pin `ENCRYPTION_KEY` for this process so all suites in a run use one key. */
export function pinTestEncryptionKey(): void {
  if (!process.env.ENCRYPTION_KEY?.trim()) {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", ""]);

/** The connection the DB suites themselves use, in the same precedence order. */
export function testDatabaseUrl(): string | undefined {
  return (
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    undefined
  );
}

/** True only for a local host or a database whose name marks it as test/e2e. */
export function isTestDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, "");
    return LOCAL_HOSTS.has(parsed.hostname) || /(^|[_-])(test|e2e)([_-]|$)/i.test(name);
  } catch {
    return false;
  }
}

export interface PurgeScope {
  /** Restrict to one channel, e.g. "threads". Omit to clear every channel. */
  platform?: string;
  /** Restrict to these owner ids — deterministic, owner-scoped cleanup. */
  ownerIds?: number[];
}

/**
 * Deterministic cleanup of test-created `connected_accounts` rows. Scoped by
 * platform and/or owner when given, otherwise clears the whole secret store for
 * a clean run. Returns the number of rows removed, or `null` when it declined to
 * touch a non-test database.
 */
export async function purgeStaleConnectedAccounts(
  scope: PurgeScope = {},
  existingPool?: pg.Pool,
): Promise<number | null> {
  const ownsPool = !existingPool;
  let pool: pg.Pool;
  if (existingPool) {
    pool = existingPool;
  } else {
    const url = testDatabaseUrl();
    if (!url || !isTestDatabaseUrl(url)) {
      console.warn(
        "[testIsolation] refusing to purge connected_accounts: target is not a recognized test database",
      );
      return null;
    }
    pool = new pg.Pool({ connectionString: url });
  }
  try {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (scope.platform) {
      values.push(scope.platform);
      clauses.push(`platform = $${values.length}`);
    }
    if (scope.ownerIds?.length) {
      values.push(scope.ownerIds);
      clauses.push(`user_id = ANY($${values.length})`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const result = await pool.query(`DELETE FROM connected_accounts${where}`, values);
    return result.rowCount ?? 0;
  } finally {
    if (ownsPool) await pool.end().catch(() => {});
  }
}
