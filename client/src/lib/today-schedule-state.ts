/**
 * Phase 28.2F: Today & Schedule Domain State Helpers
 *
 * Pure domain logic for:
 * 1. Composing Attention items (needs review / waiting approval / failed /
 *    needs verification) from the canonical pipeline, priority-sorted
 * 2. Plain-language date bucketing (Today / Tomorrow / Sep 21)
 * 3. Short content previews for list rows
 * 4. Canonical action-routing (reuses agent-workspace-state's URL builders)
 */

import { isSameDay, addDays, format } from "date-fns";
import { getCanonicalReviewUrl } from "./agent-workspace-state";

export type AttentionSeverity = "action_required" | "warning" | "informational";

export type AttentionKind =
  | "needs_review"
  | "waiting_approval"
  | "failed_publication"
  | "unknown_publication";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  title: string;
  subtitle: string;
  timestamp: string;
  actionLabel: string;
  actionUrl: string;
}

export interface ArtifactLike {
  id: number;
  channel: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface PublicationLike {
  id: number;
  artifactId: number;
  channel: string;
  state: string;
  lastError: string | null;
  createdAt: string;
  result: { outcome: string; errorMessage?: string | null } | null;
}

export interface RunLike {
  id: number;
  objective: string;
  needsApproval: boolean;
  createdAt: string;
}

/** Short, honest preview of an artifact's text content — never the raw JSON payload. */
export function previewArtifactPayload(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  if (typeof payload.text === "string") return payload.text;
  if (Array.isArray(payload.units)) {
    return payload.units
      .map((unit) => (typeof unit === "string" ? unit : typeof (unit as { text?: string }).text === "string" ? (unit as { text: string }).text : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function truncate(text: string, max = 100): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Composes the 4 canonical attention sources into one priority-sorted list.
 * Never turns routine success into an attention item.
 */
export function deriveAttentionItems(input: {
  artifactsNeedingReview: ArtifactLike[];
  runsNeedingApproval: RunLike[];
  failedPublications: PublicationLike[];
  unknownPublications: PublicationLike[];
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const artifact of input.artifactsNeedingReview) {
    items.push({
      id: `review-${artifact.id}`,
      kind: "needs_review",
      severity: "action_required",
      title: `${artifact.channel} post needs review`,
      subtitle: truncate(previewArtifactPayload(artifact.payload)) || "(empty draft)",
      timestamp: artifact.createdAt,
      actionLabel: "Review",
      actionUrl: getCanonicalReviewUrl(artifact.id),
    });
  }

  for (const run of input.runsNeedingApproval) {
    items.push({
      id: `approval-${run.id}`,
      kind: "waiting_approval",
      severity: "action_required",
      title: "Agent run waiting for approval",
      subtitle: truncate(run.objective) || "Untitled run",
      timestamp: run.createdAt,
      actionLabel: "Review",
      actionUrl: `/agent?runId=${run.id}`,
    });
  }

  for (const pub of input.failedPublications) {
    items.push({
      id: `failed-${pub.id}`,
      kind: "failed_publication",
      severity: "warning",
      title: "Publication failed",
      subtitle: pub.result?.errorMessage || pub.lastError || "The channel reported a failure.",
      timestamp: pub.createdAt,
      actionLabel: "View details",
      actionUrl: getCanonicalReviewUrl(pub.artifactId),
    });
  }

  for (const pub of input.unknownPublications) {
    items.push({
      id: `unknown-${pub.id}`,
      kind: "unknown_publication",
      severity: "warning",
      title: "Publication needs verification",
      subtitle: "We couldn't confirm what happened with the platform.",
      timestamp: pub.createdAt,
      actionLabel: "Check status",
      actionUrl: getCanonicalReviewUrl(pub.artifactId),
    });
  }

  const severityRank: Record<AttentionSeverity, number> = {
    action_required: 0,
    warning: 1,
    informational: 2,
  };

  return items.sort((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
}

/** Plain-language date bucket for schedule rows: Today / Tomorrow / Sep 21. */
export function formatDateBucket(dateInput: string | Date, now: Date = new Date()): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isSameDay(date, now)) return "Today";
  if (isSameDay(date, addDays(now, 1))) return "Tomorrow";
  return format(date, "MMM d");
}

/** Compact time-of-day for schedule rows. */
export function formatTimeOfDay(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return format(date, "h:mm a");
}
