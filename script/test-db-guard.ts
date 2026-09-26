/**
 * Phase 33.7 — preflight isolation guard for `npm run test:db`.
 *
 * Runs before any DB suite. It pins one `ENCRYPTION_KEY` for the run and clears
 * `connected_accounts` — the only table whose rows carry run-specific encryption.
 * Removing them up front means a row written by an earlier run (under a now
 * rotated key) can never be read, and fail to decrypt, by this run.
 *
 * Idempotent and cheap (a single DELETE). It no-ops, loudly, when there is no
 * test database configured, and never touches a database that is not local or
 * named like a test/e2e database.
 */
import { pinTestEncryptionKey, purgeStaleConnectedAccounts, testDatabaseUrl } from "../server/testing/testIsolation";

pinTestEncryptionKey();

if (!testDatabaseUrl()) {
  console.log("[test-db-guard] no TEST_DATABASE_URL/DATABASE_URL — nothing to reset");
} else {
  const removed = await purgeStaleConnectedAccounts();
  console.log(
    removed === null
      ? "[test-db-guard] target is not a test database — reset skipped"
      : `[test-db-guard] cleared ${removed} stale connected_accounts row(s) before run`,
  );
}
