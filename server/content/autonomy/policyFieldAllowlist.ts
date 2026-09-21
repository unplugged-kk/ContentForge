/**
 * Policy field allowlist (Phase 29.4 §12).
 *
 * These are exactly the `GenerationPolicy` fields Phase 29.3's activation
 * transaction actually writes from a candidate's `proposedConfiguration`
 * (see `activation.ts`'s insert into `generationPolicies`) and the fields
 * `GenerationDeps.activePolicyReader` resolves into a generation request
 * (see `server/content/generation.ts`). Nothing else is ever read out of an
 * autonomously-sourced configuration -- credentials, tokens, owner IDs, and
 * autonomy configuration itself are never part of this schema at all, so
 * there is no path for them to appear here.
 */
export const ALLOWED_AUTONOMOUS_POLICY_FIELDS = [
  "voiceId",
  "templateId",
  "objective",
  "audience",
  "constraints",
  "model",
] as const;

export class ForbiddenPolicyFieldError extends Error {
  constructor(readonly fields: string[]) {
    super(`Configuration contains fields not on the autonomous policy allowlist: ${fields.join(", ")}`);
    this.name = "ForbiddenPolicyFieldError";
  }
}

export function assertAllowedPolicyFields(config: Record<string, unknown>): void {
  const forbidden = Object.keys(config).filter(
    (key) => !(ALLOWED_AUTONOMOUS_POLICY_FIELDS as readonly string[]).includes(key),
  );
  if (forbidden.length > 0) {
    throw new ForbiddenPolicyFieldError(forbidden);
  }
}
