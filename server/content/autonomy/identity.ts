/**
 * Identity keys for the autonomy decision journal (Phase 29.4 §34).
 *
 * Unlike `policyActivation/identity.ts` (which makes the actual production
 * mutation idempotent), these keys are NOT meant to suppress re-logging --
 * the journal is append-only and every evaluation (allowed or denied)
 * should produce its own row, since budget/cooldown/evidence state changes
 * over time and each check is a distinct, truthful audit fact. The
 * timestamp keeps the key unique; the *action* itself (activation/rollback)
 * retains its own separate idempotency via `policyActivations.identityKey`.
 */
let counter = 0;
function nextSuffix(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now()}-${counter}`;
}

export function activationDecisionIdentityKey(userId: number, candidateId: number, code: string): string {
  return `autonomy:activate:${userId}:${candidateId}:${code}:${nextSuffix()}`;
}

export function rollbackDecisionIdentityKey(userId: number, candidateId: number, code: string): string {
  return `autonomy:rollback:${userId}:${candidateId}:${code}:${nextSuffix()}`;
}

export function experimentSelectionDecisionIdentityKey(userId: number, proposalId: number | null, code: string): string {
  return `autonomy:experiment_selection:${userId}:${proposalId ?? "none"}:${code}:${nextSuffix()}`;
}
