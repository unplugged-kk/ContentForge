import type { Artifact } from "@shared/schema";

export type ApprovalDecision =
  | "rejected"
  | "approved_without_edit"
  | "edited_then_approved"
  | "approved_after_multiple_revisions";

export function deriveApprovalDecision(
  artifact: Pick<Artifact, "readiness" | "provenance">,
  chain: Array<Pick<Artifact, "id" | "provenance">>,
): ApprovalDecision {
  if (artifact.readiness === "rejected") return "rejected";
  const humanEdits = chain.filter((a) => a.provenance === "human_edit").length;
  if (chain.length >= 3 || humanEdits >= 2) return "approved_after_multiple_revisions";
  if (artifact.provenance === "human_edit" || humanEdits > 0) return "edited_then_approved";
  return "approved_without_edit";
}

export function derivedKindForApproval(decision: ApprovalDecision): "approval_clean" | "edit_required" | null {
  if (decision === "approved_without_edit") return "approval_clean";
  if (decision === "edited_then_approved" || decision === "approved_after_multiple_revisions") {
    return "edit_required";
  }
  return null;
}
