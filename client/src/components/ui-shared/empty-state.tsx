import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  testId?: string;
}

/**
 * Shared EmptyState component established in Phase 28.2B.
 * Presents a restrained, honest empty state with optional icon and call-to-action.
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
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center",
        className
      )}
      data-testid={testId}
      {...props}
    >
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
    </div>
  );
}
