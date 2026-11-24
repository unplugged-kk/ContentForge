/**
 * Unit-test credential stub.
 *
 * `npm run test:unit` points DATABASE_URL at `postgres://unused@127.0.0.1:1/unused`
 * on purpose: a *unit* suite must not need a live PostgreSQL. The channel
 * transports, however, consult `connected_accounts` before falling back to the
 * operator env credentials, so any suite that exercises a transport's publish
 * path opens a socket and dies `ECONNREFUSED 127.0.0.1:1` — a failure that says
 * nothing about the code under test.
 *
 * This stub detaches credential lookup from the database for the duration of a
 * suite. It returns `undefined`, which is exactly what a live database with no
 * connected account returns, so the transport takes its documented env fallback.
 *
 * Scope it with `t.after()` / `after()` — never leave it installed globally, or
 * a later suite that genuinely asserts DB-backed lookup would be silently
 * passing on a stub.
 */

import { storage } from "../storage";

export interface CredentialStubHandle {
  /** Number of unscoped (`getConnectedAccount`) lookups intercepted. */
  readonly unscopedCalls: number;
  /** Platforms passed to scoped (`getConnectedAccountForOwner`) lookups. */
  readonly scopedCalls: Array<{ platform: string; ownerId: number }>;
  /** Restore the real implementations. Idempotent. */
  restore(): void;
}

/**
 * Replace connected-account lookup with an in-memory "no account connected"
 * answer. Returns a handle reporting what was asked, so a suite can still
 * assert the transport looked up the right platform/owner.
 */
export function stubConnectedAccountLookup(): CredentialStubHandle {
  const originalUnscoped = storage.getConnectedAccount;
  const originalScoped = storage.getConnectedAccountForOwner;

  const scopedCalls: Array<{ platform: string; ownerId: number }> = [];
  let unscopedCalls = 0;
  let restored = false;

  storage.getConnectedAccount = async () => {
    unscopedCalls += 1;
    return undefined;
  };

  storage.getConnectedAccountForOwner = async (platform: string, ownerId: number) => {
    scopedCalls.push({ platform, ownerId });
    return undefined;
  };

  const restore = () => {
    if (restored) return;
    restored = true;
    storage.getConnectedAccount = originalUnscoped;
    storage.getConnectedAccountForOwner = originalScoped;
  };

  return {
    get unscopedCalls() {
      return unscopedCalls;
    },
    get scopedCalls() {
      return scopedCalls;
    },
    restore,
  };
}
