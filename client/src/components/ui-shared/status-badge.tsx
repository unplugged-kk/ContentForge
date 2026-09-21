import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ContentStatus =
  | "draft"
  | "needs_review"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "generating"
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "blocked"
  | "processing"
  | "unknown";

const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  approved: "Approved",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  generating: "Generating",
  queued: "Queued",
  running: "Running",
  waiting_for_approval: "Waiting for approval",
  completed: "Completed",
  completed_with_errors: "Completed with warnings",
  failed: "Failed",
  blocked: "Blocked",
  processing: "Processing",
  unknown: "Unknown",
};

const STATUS_VARIANT: Record<ContentStatus, BadgeProps["variant"]> = {
  draft: "secondary",
  needs_review: "outline",
  approved: "default",
  scheduled: "outline",
  publishing: "outline",
  published: "default",
  generating: "outline",
  queued: "secondary",
  running: "outline",
  waiting_for_approval: "outline",
  completed: "default",
  completed_with_errors: "outline",
  failed: "destructive",
  blocked: "destructive",
  processing: "outline",
  unknown: "secondary",
};

const STATUS_TONE: Partial<Record<ContentStatus, string>> = {
  scheduled: "text-amber-600 dark:text-amber-400 border-amber-500/30",
  publishing: "text-amber-600 dark:text-amber-400 border-amber-500/30",
  generating: "text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse",
  running: "text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse",
  waiting_for_approval: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 animate-pulse",
  completed_with_errors: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  published: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

function normalize(status: string): ContentStatus {
  const key = status.toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "in_review") return "needs_review";
  if (key === "rejected") return "failed";
  if (key === "in_progress") return "running";
  if (key === "waiting_approval") return "waiting_for_approval";
  if (key === "completed_with_warnings") return "completed_with_errors";
  if (key === "success" || key === "complete") return "completed";
  return (key in STATUS_LABEL ? key : "unknown") as ContentStatus;
}

/** Finite status vocabulary shared across Queue/Calendar/Agent surfaces. */
export function StatusBadge({
  status,
  className,
  testId,
  ...props
}: {
  status: string;
  className?: string;
  testId?: string;
  [key: string]: any;
}) {
  const key = normalize(status);
  return (
    <Badge
      variant={STATUS_VARIANT[key]}
      className={cn(STATUS_TONE[key], className)}
      data-testid={testId || props["data-testid"] || `status-badge-${key}`}
      {...props}
    >
      {STATUS_LABEL[key]}
    </Badge>
  );
}
