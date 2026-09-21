/**
 * Phase 28.2D: Agent Workspace Domain & State Helpers
 *
 * Provides pure domain logic for:
 * 1. Truthful run status resolution (accounting for partial failures and approvals)
 * 2. Structured run outcome summarization (created stories, opps, artifacts, warnings)
 * 3. Handoff URL resolution to canonical surfaces (/create?artifact=..., /schedule)
 * 4. Step timeline labeling and human-readable diagnostics
 * 5. Relative timestamp formatting
 */

export type TruthfulAgentStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "blocked"
  | "unknown";

export interface ToolCallSummaryInput {
  id?: string | number;
  name?: string;
  toolName?: string;
  status?: string;
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
}

export interface RunOutcomeSummary {
  status: TruthfulAgentStatus;
  statusLabel: string;
  storiesCreated: number;
  opportunitiesCreated: number;
  artifactsCreated: number;
  publicationsCreated: number;
  mediaCreated: number;
  warningCount: number;
  hasArtifactsNeedingReview: boolean;
}

const FAILURE_STATUSES = new Set(["failed", "invalid", "not_found", "conflict", "denied"]);

/**
 * Resolves truthful agent run status without false "Completed" reports when
 * required tools failed or user authorization is pending.
 */
export function deriveRunDisplayStatus(input: {
  rawStatus?: string | null;
  toolCalls?: ToolCallSummaryInput[] | null;
  waitingForApproval?: boolean;
}): TruthfulAgentStatus {
  if (input.waitingForApproval) {
    return "waiting_for_approval";
  }

  const raw = (input.rawStatus ?? "").toLowerCase().replace(/[\s-]+/g, "_");

  if (raw === "waiting_for_approval" || raw === "waiting_approval") {
    return "waiting_for_approval";
  }
  if (raw === "running" || raw === "in_progress" || raw === "active") {
    return "running";
  }
  if (raw === "queued" || raw === "pending") {
    return "queued";
  }
  if (raw === "blocked") {
    return "blocked";
  }
  if (raw === "failed" || raw === "error") {
    return "failed";
  }

  const calls = input.toolCalls ?? [];
  const hasToolFailures = calls.some((c) => {
    const s = (c.status ?? "").toLowerCase();
    return FAILURE_STATUSES.has(s) || Boolean(c.errorMessage);
  });

  if (raw === "completed" || raw === "success" || raw === "complete") {
    if (hasToolFailures) {
      return "completed_with_errors";
    }
    return "completed";
  }

  if (raw === "completed_with_errors" || raw === "completed_with_warnings") {
    return "completed_with_errors";
  }

  return raw ? (raw as TruthfulAgentStatus) : "unknown";
}

/**
 * Computes structured counts of created items and warnings from run outputs.
 */
export function deriveRunOutcomeSummary(input: {
  status: TruthfulAgentStatus;
  toolCalls?: ToolCallSummaryInput[];
  story?: Record<string, unknown> | null;
  opportunities?: Record<string, unknown>[];
  artifactsCount?: number;
  hasDraftArtifacts?: boolean;
}): RunOutcomeSummary {
  const calls = input.toolCalls ?? [];
  let warnings = 0;
  let artifactsCount = input.artifactsCount ?? 0;
  let oppsCount = input.opportunities?.length ?? 0;
  let storiesCount = input.story ? 1 : 0;
  let mediaCount = 0;
  let pubCount = 0;

  for (const call of calls) {
    const name = call.toolName ?? call.name ?? "";
    const s = (call.status ?? "").toLowerCase();
    if (FAILURE_STATUSES.has(s) || call.errorMessage) {
      warnings += 1;
    }
    if (name === "create_story" && s === "completed") {
      storiesCount = Math.max(storiesCount, 1);
    }
    if (name === "find_opportunities" || name === "repurpose_story") {
      const oppRefs = (call.result?.refs as { opportunityIds?: unknown[] } | undefined)?.opportunityIds;
      if (Array.isArray(oppRefs)) {
        oppsCount = Math.max(oppsCount, oppRefs.length);
      }
    }
    if (name === "generate_artifact" && s === "completed") {
      artifactsCount = Math.max(artifactsCount, 1);
    }
    if ((name === "generate_image" || name === "generate_video" || name === "generate_audio") && s === "completed") {
      mediaCount += 1;
    }
    if (name === "publish_now" || name === "schedule_publication") {
      pubCount += 1;
    }
  }

  const statusLabelMap: Record<TruthfulAgentStatus, string> = {
    queued: "Queued",
    running: "Running",
    waiting_for_approval: "Waiting for approval",
    completed: "Completed",
    completed_with_errors: "Completed with warnings",
    failed: "Failed",
    blocked: "Blocked",
    unknown: "Status unknown",
  };

  return {
    status: input.status,
    statusLabel: statusLabelMap[input.status] || "Unknown",
    storiesCreated: storiesCount,
    opportunitiesCreated: oppsCount,
    artifactsCreated: artifactsCount,
    publicationsCreated: pubCount,
    mediaCreated: mediaCount,
    warningCount: warnings,
    hasArtifactsNeedingReview: Boolean(input.hasDraftArtifacts || (artifactsCount > 0 && input.status !== "completed")),
  };
}

/**
 * Returns canonical Review route for an Artifact.
 */
export function getCanonicalReviewUrl(artifactId: number): string {
  return `/create?artifact=${artifactId}`;
}

/**
 * Returns canonical Schedule route.
 */
export function getCanonicalScheduleUrl(): string {
  return "/schedule";
}

/**
 * Humanizes tool names into concise, step-oriented labels.
 */
export function humanizeToolName(toolName: string): { title: string; category: string } {
  switch (toolName) {
    case "research_topic":
    case "research_url":
    case "get_research_job":
      return { title: "Research Topic", category: "Research" };
    case "create_story":
    case "get_story":
      return { title: "Synthesize Story", category: "Story" };
    case "find_opportunities":
      return { title: "Identify Opportunities", category: "Strategy" };
    case "repurpose_story":
      return { title: "Repurpose Across Channels", category: "Generation" };
    case "generate_artifact":
      return { title: "Generate Content Artifact", category: "Generation" };
    case "generate_image":
      return { title: "Generate Visual Asset", category: "Media" };
    case "generate_video":
    case "repurpose_video":
      return { title: "Generate Video Content", category: "Media" };
    case "generate_audio":
      return { title: "Generate Audio Narration", category: "Media" };
    case "approve_artifact":
      return { title: "Approve Artifact", category: "Approval" };
    case "schedule_publication":
      return { title: "Schedule Publication", category: "Distribution" };
    case "publish_now":
      return { title: "Publish Content", category: "Distribution" };
    default:
      return {
        title: toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        category: "System",
      };
  }
}

/**
 * Formats ISO timestamps into compact relative times for run history cards.
 */
export function formatRelativeTime(dateString: string, now: Date = new Date()): string {
  try {
    const past = new Date(dateString);
    const diffMs = now.getTime() - past.getTime();
    if (diffMs < 0) return "just now";

    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return "just now";

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;

    return past.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return dateString;
  }
}
