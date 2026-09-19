import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ContentStatus =
  | "draft"
  | "needs_review"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
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
  failed: "destructive",
  blocked: "destructive",
  processing: "outline",
  unknown: "secondary",
};

const STATUS_TONE: Partial<Record<ContentStatus, string>> = {
  scheduled: "text-amber-600 dark:text-amber-400 border-amber-500/30",
  publishing: "text-amber-600 dark:text-amber-400 border-amber-500/30",
  approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  published: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

function normalize(status: string): ContentStatus {
  const key = status.toLowerCase().replace(/[\s-]+/g, "_");
  return (key in STATUS_LABEL ? key : "unknown") as ContentStatus;
}

/** Finite status vocabulary shared across Queue/Calendar/Agent surfaces. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const key = normalize(status);
  return (
    <Badge
      variant={STATUS_VARIANT[key]}
      className={cn(STATUS_TONE[key], className)}
      data-testid={`status-badge-${key}`}
    >
      {STATUS_LABEL[key]}
    </Badge>
  );
}
