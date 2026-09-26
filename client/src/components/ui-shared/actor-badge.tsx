import { Badge, type BadgeProps } from "@/components/ui/badge";
import { User, Bot, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Who did this: a person, or the system.
 *
 * This is a product requirement, not a nicety. The agent proposes and a human
 * disposes, and the operator has to be able to tell at a glance which happened
 * — "Activated by You" and "Activated Automatically" are the whole safety
 * story for bounded autonomous optimization
 * (docs/ux-audit/DONT_BUILD.md D1: "Anything that acts without a person present
 * needs an explicit owner decision recorded").
 *
 * Three rules this component enforces:
 *
 *   1. Never color alone. A hue cannot carry who acted, so every variant pairs
 *      a distinct icon with a distinct word. Color is reinforcement, never the
 *      signal.
 *   2. Human wording is never ambiguous. "User" alone is weak; the label says
 *      who specifically, because the accountability question is real.
 *   3. One component, so the three places that were drifting
 *      (learning-view, artifact-review) cannot drift further.
 */

/**
 * Labels are exact and covered by e2e assertions
 * (`e2e/experiments.e2e.spec.ts:477` expects "Activated by You"), so the words
 * here are part of the product contract, not a stylistic choice. This component
 * adds the part that was missing: an icon, so who acted survives greyscale,
 * colorblindness, and dense tables where the text is truncated.
 */
export type ActorKind = "human" | "agent" | "automatic";

const ACTOR: Record<
  ActorKind,
  { label: string; short: string; icon: LucideIcon; className: string }
> = {
  human: {
    label: "Activated by You",
    short: "By You",
    icon: User,
    className: "text-foreground border-border",
  },
  agent: {
    label: "Agent suggestion",
    short: "Suggested",
    icon: Bot,
    className: "text-muted-foreground border-border",
  },
  automatic: {
    label: "Activated Automatically",
    short: "Automatic",
    icon: Bot,
    className:
      "text-amber-700 dark:text-amber-400 border-amber-500/40 bg-amber-500/10",
  },
};

export interface ActorBadgeProps extends Omit<BadgeProps, "children"> {
  kind: ActorKind;
  /** Use the short form in dense tables where space is the constraint. */
  compact?: boolean;
  testId?: string;
}

export function ActorBadge({
  kind,
  compact = false,
  className,
  testId,
  ...props
}: ActorBadgeProps) {
  const { label, short, icon: Icon, className: tone } = ACTOR[kind];
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-normal", tone, className)}
      data-testid={testId ?? `actor-badge-${kind}`}
      {...props}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {compact ? short : label}
    </Badge>
  );
}
