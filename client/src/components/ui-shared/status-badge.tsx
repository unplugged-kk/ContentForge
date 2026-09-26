import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Ban,
  Check,
  CircleAlert,
  CircleHelp,
  CircleX,
  Clock,
  Eye,
  FileText,
  Loader2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

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
  | "rejected"
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
  rejected: "Rejected",
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
  rejected: "destructive",
  blocked: "destructive",
  processing: "outline",
  unknown: "secondary",
};

/**
 * Colour is reinforcement. Every state also carries a glyph, because a state
 * distinguished by hue alone is invisible to a colour-blind operator, and a
 * state distinguished by an animation alone is invisible to anyone running
 * `prefers-reduced-motion: reduce` — which is exactly how `generating` and
 * `running` used to collapse into identical pixels.
 *
 * Every key in `STATUS_LABEL` has an entry here, so a new status cannot ship
 * without a non-colour signal. The glyphs are grouped by meaning and each group
 * is a distinct shape:
 *
 *   spinner  generating / running / publishing / processing  (in flight)
 *   clock    waiting_for_approval / scheduled / queued       (not started)
 *   check    approved / published / completed                (settled well)
 *   alert    failed / blocked / rejected                     (settled badly)
 *            completed_with_errors: alert, but a different one from `failed`,
 *            because "some of it worked" is not "it did not work"
 *   neutral  draft / needs_review / unknown
 *
 * `ActorBadge` is the model: a distinct icon *and* a distinct word, so the
 * meaning survives greyscale, reduced motion, and heavy truncation.
 */
const STATUS_ICON: Record<ContentStatus, LucideIcon> = {
  draft: FileText,
  needs_review: Eye,
  approved: Check,
  scheduled: Clock,
  publishing: Loader2,
  published: Check,
  generating: Loader2,
  queued: Clock,
  running: Loader2,
  waiting_for_approval: Clock,
  completed: Check,
  completed_with_errors: TriangleAlert,
  failed: CircleAlert,
  rejected: CircleX,
  blocked: Ban,
  processing: Loader2,
  unknown: CircleHelp,
};

/** States whose glyph is a spinner. The spin is reinforcement; the arc shape is the signal. */
const STATUS_SPINS: ReadonlySet<ContentStatus> = new Set<ContentStatus>([
  "generating",
  "running",
  "publishing",
  "processing",
]);

/**
 * Tones are semantic tokens, never palette literals: `--warning` for states that
 * need the operator, `--info` for work in flight, `--success` for settled-well
 * states. Direction §4.2 fixes these names and W-A defines them in `index.css`.
 * The `pulse-live` pulse stays on in-flight states as reinforcement only — it is
 * never the differentiator, and it is removed entirely under reduced motion.
 */
const STATUS_TONE: Partial<Record<ContentStatus, string>> = {
  scheduled: "text-warning border-warning/30",
  publishing: "text-warning border-warning/30",
  generating: "text-info border-info/30 pulse-live",
  running: "text-info border-info/30 pulse-live",
  waiting_for_approval: "bg-warning/10 text-warning border-warning/30 pulse-live",
  completed_with_errors: "bg-warning/10 text-warning border-warning/30",
  approved: "bg-success/10 text-success border-success/30",
  completed: "bg-success/10 text-success border-success/30",
  published: "bg-success/10 text-success border-success/30",
};

function normalize(status: string): ContentStatus {
  const key = status.toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "in_review") return "needs_review";
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
  const Icon = STATUS_ICON[key];
  return (
    <Badge
      variant={STATUS_VARIANT[key]}
      className={cn("gap-1", STATUS_TONE[key], className)}
      data-testid={testId || props["data-testid"] || `status-badge-${key}`}
      {...props}
    >
      <Icon
        className={cn("h-3 w-3 shrink-0", STATUS_SPINS.has(key) && "animate-spin")}
        aria-hidden="true"
      />
      {STATUS_LABEL[key]}
    </Badge>
  );
}
