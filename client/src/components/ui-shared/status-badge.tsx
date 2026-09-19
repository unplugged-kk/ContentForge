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
  failed: "destructive",
  blocked: "destructive",
  processing: "outline",
  unknown: "secondary",
};

const STATUS_TONE: Partial<Record<ContentStatus, string>> = {
  scheduled: "text-amber-600 dark:text-amber-400 border-amber-500/30",
  publishing: "text-amber-600 dark:text-amber-400 border-amber-500/30",
  generating: "text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse",
  approved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  published: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

function normalize(status: string): ContentStatus {
  const key = status.toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "in_review") return "needs_review";
  if (key === "rejected") return "failed";
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
