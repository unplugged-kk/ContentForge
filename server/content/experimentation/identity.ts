import crypto from "node:crypto";

export function experimentIdentityKey(
  userId: number,
  targetScope: string,
  experimentType: string,
  name: string,
): string {
  const hash = crypto
    .createHash("sha256")
    .update([userId, targetScope, experimentType, name.trim().toLowerCase()].join(":"))
    .digest("hex")
    .slice(0, 32);
  return `exp:${userId}:${hash}`;
}

export function assignmentIdentityKey(experimentId: number, opportunityId: number): string {
  return `assign:${experimentId}:${opportunityId}`;
}

export function evaluationIdentityKey(
  experimentId: number,
  window: string,
  timestampMs: number,
): string {
  return `eval:${experimentId}:${window}:${timestampMs}`;
}

export function policyCandidateIdentityKey(experimentId: number, variantId: number): string {
  return `polcand:${experimentId}:${variantId}`;
}
