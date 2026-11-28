/**
 * Quality intelligence (signals only — it decides nothing).
 */

export {
  computeQualitySignals,
  qualitySignalRecord,
  type QualityInput,
  type QualityProfile,
  type QualitySignals,
} from "./signals";

export {
  auditArtifactClaims,
  computeParaphraseOverlap,
  type AuditArtifactClaimsInput,
  type AuditedClaim,
  type ClaimEvidenceAttribution,
  type ClaimStatus,
  type ModelClaimInput,
} from "./claimCheck";
