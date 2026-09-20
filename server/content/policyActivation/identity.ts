export function activationIdentityKey(policyCandidateId: number): string {
  return `activate:${policyCandidateId}`;
}

export function rollbackIdentityKey(policyKey: string, targetPolicyId: number, timestampMs: number): string {
  return `rollback:${policyKey}:${targetPolicyId}:${timestampMs}`;
}
