import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { StateSurface } from "@/components/ui-shared/state-surface";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  testId?: string;
}

/**
 * The one empty state in the product.
 *
 * An empty region is `EmptyState`, not a hand-rolled card (direction §2.2, §5.2).
 * Hand-rolled empties exist today in `components/sources/*`, `pages/agent.tsx`
 * and `pages/today.tsx`; they drift from this one in radius, padding and type,
 * and a region once they are swapped in reads the same everywhere — which is the
 * whole point. Adoption is a drop-in: the props below cover every shape the
 * hand-rolled versions use, and `className` is merged last, so a dense region
 * can pass `className="p-4"` instead of forking the component.
 *
 * Two rules it enforces for you:
 *   - An empty state teaches the space. `title` plus a `description` that says
 *     what belongs here and what fills it; a bare label is not an empty state.
 *   - A failed read is never an empty state. Render `ErrorState`, not this.
 *
 * Its surface comes from `StateSurface`, shared with `ErrorState`, so the two
 * cannot drift apart again.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  testId = "empty-state",
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <StateSurface className={className} data-testid={testId} {...props}>
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground mb-1">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <p className="text-sm font-medium" data-testid="text-empty-state-title">
        {title}
      </p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-sm" data-testid="text-empty-state-description">
          {description}
        </p>
      )}
      {(action || children) && (
        <div className="mt-2 flex items-center gap-2">
          {action}
          {children}
        </div>
      )}
    </StateSurface>
  );
}
