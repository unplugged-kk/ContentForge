/**
 * Unit-test credential stub.
 *
 * `npm run test:unit` points DATABASE_URL at an unroutable local address on
 * purpose: a unit suite must not require a live PostgreSQL instance. Social
 * transports consult `connected_accounts` before falling back, so without a
 * stub those unit tests fail on `ECONNREFUSED` instead of exercising transport
 * behaviour. Scope with `before()`/`after()` and always call `restore()`.
 */

import { storage } from "../storage";

export interface CredentialStubHandle {
  readonly unscopedCalls: number;
  readonly scopedCalls: Array<{ platform: string; ownerId: number }>;
  restore(): void;
}

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
